import Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException, Body, Controller, Injectable, Logger, Module, ParseFilePipe, MaxFileSizeValidator, Post, ServiceUnavailableException,
  UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumberString, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { createHash } from 'crypto';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { detectMime } from '../receipts/receipts.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService } from '../transactions/transactions.service';
import { TransfersModule } from '../transfers/transfers.module';
import { TransfersService } from '../transfers/transfers.service';
import { buildStatementPrompt, descKey, looseKey, sanitizeStatement, STATEMENT_SCHEMA, StatementExtraction } from './statement';

const D = Prisma.Decimal;
const MAX_BYTES = 10 * 1024 * 1024;
const DAY = 86_400_000;
/** Días de diferencia con que un movimiento ya anotado se reconoce en el estado de cuenta. */
const MATCH_DAYS = 3;

class ImportRowDto {
  @ApiProperty() @IsDateString({ strict: true })
  date: string;

  @ApiProperty() @IsString() @MaxLength(200)
  description: string;

  @ApiProperty({ description: 'Con signo, en la moneda de la cuenta: negativo = salió' }) @Matches(/^-?\d+(\.\d{1,2})?$/)
  amount: string;

  @ApiPropertyOptional() @IsOptional() @Matches(/^-?\d+(\.\d{1,2})?$/)
  balance?: string;

  @ApiProperty({ enum: ['TX', 'TRANSFER'] }) @IsIn(['TX', 'TRANSFER'])
  kind: 'TX' | 'TRANSFER';

  @ApiPropertyOptional() @IsOptional() @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Transferencia: la otra cuenta (de donde vino o a donde fue)' }) @IsOptional() @IsString()
  otherAccountId?: string;

  @ApiPropertyOptional({ description: 'Transferencia: el monto en la otra cuenta, si es de otra moneda (ej. USD que salieron de Binance)' })
  @IsOptional() @IsNumberString()
  otherAmount?: string;
}

class CommitDto {
  @ApiProperty() @IsString()
  accountId: string;

  @ApiProperty({ type: [ImportRowDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}

type Candidate = { id: string; kind: 'TX' | 'TRANSFER' | 'DEBT'; date: Date; amount: Prisma.Decimal; label: string };

@Injectable()
export class ImportsService {
  private readonly log = new Logger(ImportsService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  /** La misma lectura no se paga dos veces mientras el usuario revisa */
  private cache = new Map<string, { at: number; ex: StatementExtraction }>();

  constructor(
    private prisma: PrismaService,
    private transactions: TransactionsService,
    private transfers: TransfersService,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey, baseURL: config.get('ANTHROPIC_BASE_URL') || undefined, timeout: 120_000, maxRetries: 2 }) : null;
    this.model = config.get('STATEMENTS_MODEL') || config.get('RECEIPTS_MODEL') || 'claude-haiku-5-5';
  }

  /** Lee el estado de cuenta y propone cada fila: nueva, ya anotada o ya importada. No guarda nada. */
  async preview(userId: string, accountId: string, files: Express.Multer.File[]) {
    if (!this.client) throw new ServiceUnavailableException('La lectura de estados de cuenta no está configurada: falta ANTHROPIC_API_KEY en el .env de la API');
    if (!files?.length) throw new BadRequestException('Adjunta el PDF o las capturas del estado de cuenta en el campo "files"');
    const account = await this.transactions.assertAccount(userId, accountId);
    const parts = files.map((f) => {
      const mime = detectMime(f.buffer);
      if (!mime) throw new BadRequestException(`"${f.originalname}" no es JPG, PNG, WEBP ni PDF`);
      return { mime, data: f.buffer.toString('base64') };
    });
    const hash = createHash('sha256').update(userId).update(files.map((f) => createHash('sha256').update(f.buffer).digest('hex')).join()).digest('hex');
    for (const [k, v] of this.cache) if (Date.now() - v.at > 3_600_000) this.cache.delete(k);
    let ex = this.cache.get(hash)?.ex;
    if (!ex) {
      ex = await this.extract(userId, parts);
      this.cache.set(hash, { at: Date.now(), ex });
    }
    if (!ex.isStatement) throw new BadRequestException('No encontré movimientos bancarios en el archivo');

    const rows = ex.rows;
    const dates = rows.map((r) => parseDateOnly(r.date).getTime());
    const from = new Date(Math.min(...dates) - MATCH_DAYS * DAY);
    const to = new Date(Math.max(...dates) + MATCH_DAYS * DAY);
    const ves = account.currency === 'VES';

    // Lo que ya está anotado en esa cuenta por esas fechas
    const [txs, trs, pays, imported, learned] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, accountId, date: { gte: from, lte: to } },
        select: { id: true, type: true, date: true, amountUsd: true, amountVes: true, description: true, source: true, externalId: true },
      }),
      this.prisma.transfer.findMany({
        where: { userId, date: { gte: from, lte: to }, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
        include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
      }),
      this.prisma.debtPayment.findMany({
        where: { accountId, transactionId: null, date: { gte: from, lte: to }, debt: { userId } },
        select: { id: true, date: true, amount: true, accountAmount: true, debt: { select: { direction: true, person: true } } },
      }),
      this.prisma.transaction.findMany({ where: { userId, source: 'IMPORT', externalId: { startsWith: `stmt:${accountId}:` } }, select: { externalId: true } }),
      // Lo que elegiste antes para cada descripción
      this.prisma.transaction.findMany({
        where: { userId, source: 'IMPORT', categoryId: { not: null } },
        orderBy: { createdAt: 'desc' }, take: 1000, select: { categoryId: true, type: true, rawData: true },
      }),
    ]);
    const done = new Set(imported.map((t) => t.externalId));
    const cands: Candidate[] = [
      ...txs.filter((t) => t.source !== 'IMPORT').map((t) => {
        const a = ves ? t.amountVes : t.amountUsd;
        return { id: t.id, kind: 'TX' as const, date: t.date, amount: t.type === 'EXPENSE' ? a.neg() : a, label: t.description || (t.type === 'EXPENSE' ? 'Gasto' : 'Ingreso') };
      }),
      ...trs.map((t) => t.fromAccountId === accountId
        ? { id: t.id, kind: 'TRANSFER' as const, date: t.date, amount: t.fromAmount.neg(), label: `Transferencia a ${t.toAccount.name}` }
        : { id: t.id, kind: 'TRANSFER' as const, date: t.date, amount: t.toAmount, label: `Transferencia desde ${t.fromAccount.name}` }),
      ...pays.map((p) => {
        const a = p.accountAmount ?? p.amount;
        return p.debt.direction === 'I_OWE'
          ? { id: p.id, kind: 'DEBT' as const, date: p.date, amount: a.neg(), label: `Abono a ${p.debt.person}` }
          : { id: p.id, kind: 'DEBT' as const, date: p.date, amount: a, label: `Abono de ${p.debt.person}` };
      }),
    ];
    const used = new Set<string>();
    const exact = new Map<string, string>();
    const loose = new Map<string, string>();
    for (const l of learned) {
      const d = (l.rawData as { description?: string } | null)?.description;
      if (!d) continue;
      const k1 = `${l.type}|${descKey(d)}`, k2 = `${l.type}|${looseKey(d)}`;
      if (!exact.has(k1)) exact.set(k1, l.categoryId!);
      if (looseKey(d) && !loose.has(k2)) loose.set(k2, l.categoryId!);
    }

    const out = rows.map((r) => {
      const externalId = this.externalId(accountId, r.date, r.amount.toFixed(2), r.balance?.toFixed(2));
      const type = r.amount < 0 ? 'EXPENSE' : 'INCOME';
      const base = { ...r, amount: r.amount.toFixed(2), balance: r.balance?.toFixed(2) ?? null, type };
      if (done.has(externalId)) return { ...base, status: 'IMPORTED' as const, match: null, categoryId: null };
      const day = parseDateOnly(r.date).getTime();
      const m = cands
        .filter((c) => !used.has(c.id) && c.amount.sub(r.amount).abs().lte(0.01) && Math.abs(c.date.getTime() - day) <= MATCH_DAYS * DAY)
        .sort((a, b) => Math.abs(a.date.getTime() - day) - Math.abs(b.date.getTime() - day))[0];
      if (m) {
        used.add(m.id);
        return { ...base, status: 'MATCHED' as const, match: { kind: m.kind, id: m.id, label: m.label, date: m.date.toISOString().slice(0, 10) }, categoryId: null };
      }
      const categoryId = exact.get(`${type}|${descKey(r.description)}`) ?? loose.get(`${type}|${looseKey(r.description)}`) ?? r.suggestedCategoryId;
      return { ...base, status: 'NEW' as const, match: null, categoryId };
    });

    // ¿Falta alguna fila? Con el saldo de cada línea se comprueba que la cadena cuadre (el banco lista de la más nueva a la más vieja)
    const gaps: { after: number; before: number; missing: string }[] = [];
    const chrono = out.map((r, i) => ({ r, i })).sort((a, b) => a.r.date.localeCompare(b.r.date) || b.i - a.i);
    for (let k = 1; k < chrono.length; k++) {
      const prev = chrono[k - 1].r, cur = chrono[k].r;
      if (prev.balance === null || cur.balance === null) continue;
      const diff = new D(cur.balance).sub(prev.balance).sub(cur.amount);
      if (diff.abs().gt(0.01)) gaps.push({ after: chrono[k - 1].i, before: chrono[k].i, missing: diff.toFixed(2) });
    }
    const latest = chrono.at(-1)?.r.balance ?? null;
    return {
      bank: ex.bank, accountLast4: ex.accountLast4, currency: ex.currency,
      currencyMismatch: !!ex.currency && ex.currency !== account.currency,
      statementBalance: ex.availableBalance !== null ? ex.availableBalance.toFixed(2) : latest,
      rows: out,
      gaps,
    };
  }

  /** Guarda las filas elegidas como gastos, ingresos o transferencias. Las que ya se importaron se saltan. */
  async commit(userId: string, dto: CommitDto) {
    const account = await this.transactions.assertAccount(userId, dto.accountId);
    let created = 0, skipped = 0;
    const today = todayLocal();
    for (const r of dto.rows) {
      if (r.date > today) throw new BadRequestException(`La fila "${r.description}" tiene fecha futura`);
      const amount = new D(r.amount);
      if (amount.isZero()) continue;
      const externalId = this.externalId(dto.accountId, r.date, amount.toFixed(2), r.balance ? new D(r.balance).toFixed(2) : undefined);
      if (r.kind === 'TRANSFER') {
        if (!r.otherAccountId || r.otherAccountId === dto.accountId) throw new BadRequestException(`Elige la otra cuenta de "${r.description}"`);
        const other = await this.transactions.assertAccount(userId, r.otherAccountId);
        const mine = amount.abs().toFixed(2);
        const theirs = other.currency === account.currency ? mine : r.otherAmount;
        if (!theirs) throw new BadRequestException(`Indica cuánto fue en ${other.name} para "${r.description}"`);
        await this.transfers.create(userId, amount.lt(0)
          ? { fromAccountId: dto.accountId, toAccountId: other.id, date: r.date, fromAmount: mine, toAmount: theirs, description: r.description }
          : { fromAccountId: other.id, toAccountId: dto.accountId, date: r.date, fromAmount: theirs, toAmount: mine, description: r.description });
        created++;
        continue;
      }
      if (await this.prisma.transaction.findFirst({ where: { userId, source: 'IMPORT', externalId }, select: { id: true } })) { skipped++; continue; }
      await this.transactions.create(
        userId,
        { type: amount.lt(0) ? 'EXPENSE' : 'INCOME', accountId: dto.accountId, categoryId: r.categoryId || undefined, currency: account.currency, amount: amount.abs().toFixed(2), date: r.date, description: r.description },
        { source: 'IMPORT', externalId, rawData: { description: r.description, balance: r.balance ?? null } },
      );
      created++;
    }
    return { created, skipped };
  }

  private externalId(accountId: string, date: string, amount: string, balance?: string) {
    return `stmt:${accountId}:${date}:${amount}:${balance ?? '-'}`;
  }

  private async extract(userId: string, parts: { mime: string; data: string }[]) {
    const cats = await this.prisma.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, parent: { select: { name: true } } } });
    const today = todayLocal();
    try {
      const res = await this.client!.messages.create({
        model: this.model,
        max_tokens: 16000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: STATEMENT_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{
          role: 'user',
          content: [
            ...parts.map((p) => p.mime === 'application/pdf'
              ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } } as const)
              : ({ type: 'image', source: { type: 'base64', media_type: p.mime as 'image/png', data: p.data } } as const)),
            { type: 'text', text: buildStatementPrompt(cats.map((c) => ({ ...c, parent: c.parent?.name })), today) },
          ],
        }],
      });
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error(`Respuesta sin JSON (stop_reason=${res.stop_reason})`);
        parsed = JSON.parse(m[0]);
      }
      return sanitizeStatement(parsed, new Set(cats.map((c) => c.id)), today);
    } catch (e) {
      this.log.error(`Falló la lectura del estado de cuenta: ${(e as Error).message}`);
      const status = (e as { status?: number }).status;
      if (status === 401) throw new ServiceUnavailableException('La ANTHROPIC_API_KEY no es válida');
      if (status === 429 || status === 529) throw new ServiceUnavailableException('El servicio de lectura está saturado; intenta en un minuto');
      throw new ServiceUnavailableException('No se pudo leer el estado de cuenta. Inténtalo de nuevo');
    }
  }
}

@ApiTags('imports') @ApiBearerAuth()
@Controller('imports/statement')
class ImportsController {
  constructor(private imports: ImportsService) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { accountId: { type: 'string' }, files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_BYTES } }))
  preview(
    @CurrentUser() u: AuthUser,
    @Body('accountId') accountId: string,
    @UploadedFiles(new ParseFilePipe({ fileIsRequired: false, validators: [new MaxFileSizeValidator({ maxSize: MAX_BYTES, message: 'Cada archivo puede pesar hasta 10 MB' })] }))
    files: Express.Multer.File[],
  ) {
    if (!accountId) throw new BadRequestException('Elige la cuenta del estado de cuenta');
    return this.imports.preview(u.id, accountId, files);
  }

  @Post() commit(@CurrentUser() u: AuthUser, @Body() dto: CommitDto) { return this.imports.commit(u.id, dto); }
}

@Module({ imports: [TransactionsModule, TransfersModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
