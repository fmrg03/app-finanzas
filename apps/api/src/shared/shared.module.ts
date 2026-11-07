import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, OmitType } from '@nestjs/swagger';
import { Prisma, SplitMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsNumberString, IsOptional, IsString, ValidateIf, ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from '../transactions/dto/transaction.dto';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService, TX_INCLUDE } from '../transactions/transactions.service';
import { PeopleModule } from '../people/people.module';
import { MirrorService } from './mirror.service';
import { computeSplit } from './split';

export class SplitParticipantDto {
  @ApiPropertyOptional({ nullable: true, description: 'null = tú' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  personId: string | null;

  @ApiPropertyOptional({ example: '50', description: '% (PERCENT) o monto en la moneda de la compra (AMOUNT)' })
  @IsOptional() @IsNumberString()
  value?: string;
}

export class SplitDto {
  @ApiPropertyOptional({ nullable: true, description: 'Quién pagó; null = tú' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  paidByPersonId: string | null;

  @ApiProperty({ enum: SplitMode }) @IsEnum(SplitMode)
  mode: SplitMode;

  @ApiProperty({ type: [SplitParticipantDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => SplitParticipantDto)
  participants: SplitParticipantDto[];
}

export class CreateSharedTxDto extends OmitType(CreateTransactionDto, ['accountId', 'type'] as const) {
  @ApiPropertyOptional({ nullable: true, description: 'Obligatoria si pagaste tú; vacía si pagó otra persona' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  accountId?: string | null;

  @ApiProperty({ type: SplitDto }) @ValidateNested() @Type(() => SplitDto)
  split: SplitDto;
}

const D = Prisma.Decimal;

@Injectable()
export class SharedService {
  constructor(
    private prisma: PrismaService,
    private transactions: TransactionsService,
    private mirrors: MirrorService,
  ) {}

  /** Valida que las personas sean tuyas y devuelve sus nombres. */
  async people(userId: string, split: SplitDto) {
    const ids = [...new Set([split.paidByPersonId, ...split.participants.map((p) => p.personId)].filter((x): x is string => !!x))];
    const found = await this.prisma.person.findMany({ where: { userId, id: { in: ids } } });
    if (found.length !== ids.length) throw new BadRequestException('Alguna de las personas no existe');
    return new Map(found.map((p) => [p.id, p]));
  }

  /**
   * Crea el reparto y las deudas que genera. Las deudas van siempre en USD:
   * si pagaste tú, cada uno te debe su parte; si pagó otro, tú le debes la tuya.
   */
  async buildShared(
    db: Prisma.TransactionClient,
    userId: string,
    split: SplitDto,
    amounts: { totalUsd: Prisma.Decimal; totalOriginal: Prisma.Decimal },
    debtInfo: { description: string; dueDate: Date | null },
    existingId?: string,
  ) {
    const names = await this.people(userId, split);
    const result = computeSplit({ ...amounts, mode: split.mode, paidByPersonId: split.paidByPersonId ?? null, participants: split.participants });
    const data = { userId, paidByPersonId: split.paidByPersonId ?? null, splitMode: split.mode, totalUsd: amounts.totalUsd };
    let shared;
    if (existingId) {
      await db.sharedParticipant.deleteMany({ where: { sharedId: existingId } });
      await db.debt.deleteMany({ where: { sharedId: existingId } });
      shared = await db.sharedExpense.update({ where: { id: existingId }, data });
    } else {
      shared = await db.sharedExpense.create({ data });
    }
    await db.sharedParticipant.createMany({
      data: result.rows.map((r) => ({ sharedId: shared.id, personId: r.personId, pct: r.pct, amountUsd: r.amountUsd })),
    });

    const debts =
      split.paidByPersonId == null
        ? result.rows.filter((r) => r.personId && r.amountUsd.gt(0)).map((r) => ({ personId: r.personId!, direction: 'OWED_TO_ME' as const, amount: r.amountUsd }))
        : [{ personId: split.paidByPersonId, direction: 'I_OWE' as const, amount: result.myAmountUsd }];
    for (const d of debts) {
      await db.debt.create({
        data: {
          userId, direction: d.direction, person: names.get(d.personId)!.name, personId: d.personId, sharedId: shared.id,
          description: debtInfo.description, currency: 'USD', amount: d.amount, dueDate: debtInfo.dueDate,
        },
      });
    }
    return { shared, ...result };
  }

  async create(userId: string, dto: CreateSharedTxDto) {
    await this.mirrors.assertPayerNotLinked(userId, dto.split.paidByPersonId);
    const { category, accountId } = await this.validate(userId, dto);
    const base = await this.transactions.snapshot(userId, {
      currency: dto.currency, amount: dto.amount, date: dto.date, rateSource: dto.rateSource ?? category?.defaultRateSource ?? undefined, rate: dto.rate,
    });
    const tx = await this.prisma.$transaction(async (db) => {
      const s = await this.buildShared(db, userId, dto.split, { totalUsd: base.amountUsd, totalOriginal: base.originalAmount }, {
        description: debtLabel(dto.description, category?.name), dueDate: null,
      });
      const snapshot = { ...base, ...this.mine(base, s.myPct, s.myAmountUsd) };
      return this.transactions.insert(userId, { ...dto, accountId, categoryId: dto.categoryId ?? null, type: 'EXPENSE' }, snapshot, { sharedId: s.shared.id }, db);
    });
    // A los familiares vinculados les aparece su parte en su cuenta
    if (tx.sharedId) await this.mirrors.sync(tx.sharedId);
    return tx;
  }

  /** Rehace el reparto y el movimiento. No se permite si alguien ya abonó su parte. */
  async update(userId: string, txId: string, dto: CreateSharedTxDto) {
    const current = await this.prisma.transaction.findFirst({ where: { id: txId, userId } });
    if (!current?.sharedId) throw new NotFoundException('Movimiento compartido no encontrado');
    const sharedId = current.sharedId;
    await this.mirrors.assertNotMirror(sharedId, 'cambiarla');
    await this.mirrors.assertPayerNotLinked(userId, dto.split.paidByPersonId);
    await this.transactions.assertNoPayments(sharedId);
    const { category, accountId } = await this.validate(userId, dto);
    const base = await this.transactions.snapshot(userId, {
      currency: dto.currency, amount: dto.amount, date: dto.date, rateSource: dto.rateSource ?? category?.defaultRateSource ?? undefined, rate: dto.rate,
    });
    await this.prisma.$transaction(async (db) => {
      const s = await this.buildShared(db, userId, dto.split, { totalUsd: base.amountUsd, totalOriginal: base.originalAmount }, {
        description: debtLabel(dto.description, category?.name), dueDate: null,
      }, sharedId);
      await db.transaction.update({
        where: { id: txId },
        data: {
          accountId, categoryId: dto.categoryId ?? null, date: parseDateOnly(dto.date),
          description: dto.description?.trim() || null,
          ...(dto.tags !== undefined ? { tags: [...new Set(dto.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] } : {}),
          ...base, ...this.mine(base, s.myPct, s.myAmountUsd),
        },
      });
    });
    await this.mirrors.sync(sharedId);
    return this.transactions.findOne(userId, txId);
  }

  async get(userId: string, txId: string) {
    const tx = await this.prisma.transaction.findFirst({ where: { id: txId, userId, sharedId: { not: null } }, include: TX_INCLUDE });
    if (!tx) throw new NotFoundException('Movimiento compartido no encontrado');
    return this.transactions.present(tx);
  }

  private mine(base: { amountUsd: Prisma.Decimal; amountVes: Prisma.Decimal }, myPct: Prisma.Decimal, myAmountUsd: Prisma.Decimal) {
    const ves = base.amountUsd.isZero() ? new D(0) : base.amountVes.mul(myAmountUsd).div(base.amountUsd).toDecimalPlaces(2, D.ROUND_HALF_UP);
    return { sharePct: myPct, myAmountUsd, myAmountVes: ves };
  }

  private async validate(userId: string, dto: CreateSharedTxDto) {
    const paidByMe = dto.split.paidByPersonId == null;
    if (paidByMe && !dto.accountId) throw new BadRequestException('Si pagaste tú, indica de qué cuenta salió el dinero');
    if (paidByMe) await this.transactions.assertAccount(userId, dto.accountId!);
    const category = await this.transactions.assertCategory(userId, dto.categoryId ?? null, 'EXPENSE');
    return { category, accountId: paidByMe ? dto.accountId! : null };
  }
}

export function debtLabel(description?: string | null, category?: string | null) {
  return `${description?.trim() || category || 'Compra'} (compartido)`;
}

@ApiTags('shared') @ApiBearerAuth()
@Controller('shared-expenses')
class SharedController {
  constructor(private shared: SharedService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateSharedTxDto) { return this.shared.create(u.id, dto); }
  /** :id es el id del movimiento */
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.shared.get(u.id, id); }
  @Put(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateSharedTxDto) { return this.shared.update(u.id, id, dto); }
}

@Module({
  imports: [TransactionsModule, PeopleModule],
  controllers: [SharedController],
  providers: [SharedService, MirrorService],
  exports: [SharedService, MirrorService],
})
export class SharedModule {}
