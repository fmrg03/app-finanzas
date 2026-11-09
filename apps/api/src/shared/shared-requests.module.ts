import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, SharedRequest, SharedRequestKind, User } from '@prisma/client';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreatePlanDto, InstallmentsModule, InstallmentsService } from '../installments/installments.module';
import { displayName, PeopleModule, PeopleService } from '../people/people.module';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateSharedTxDto, SharedModule, SharedService, SplitDto } from './shared.module';
import { computeSplit } from './split';

class AcceptDto {
  @ApiPropertyOptional({ nullable: true, description: 'Cuenta de la que salió el dinero (o la inicial, si es en cuotas)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  accountId?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;
}

class RejectDto {
  @ApiPropertyOptional({ description: 'Por qué la rechazas (le llega a quien la registró)' })
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

/** Quién es quién en el reparto, sin depender de las personas de cada cuenta. */
type Role = 'CREATOR' | 'PAYER' | 'OTHER';
interface PreviewPart { role: Role; name: string; amountUsd: string; pct: string }
interface Preview {
  description: string | null;
  categoryName: string | null;
  date: string;
  currency: 'USD' | 'VES';
  amount: string;
  totalUsd: string;
  installments: { provider: string; store: string | null; count: number; frequency: string; downPaymentUsd: string } | null;
  parts: PreviewPart[];
}

const fmt = (v: Prisma.Decimal.Value, cur: 'USD' | 'VES') =>
  `${cur === 'USD' ? '$' : 'Bs'} ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

@Injectable()
export class SharedRequestsService {
  constructor(
    private prisma: PrismaService,
    private shared: SharedService,
    private installments: InstallmentsService,
    private people: PeopleService,
    private transactions: TransactionsService,
  ) {}

  /**
   * Registras una compra que pagó un familiar que usa la app: no se guarda todavía.
   * A él le llega para aceptarla (y elegir de qué cuenta salió) o rechazarla.
   */
  async create(userId: string, kind: SharedRequestKind, dto: CreateSharedTxDto | CreatePlanDto) {
    const split = dto.split;
    if (!split?.paidByPersonId) throw new BadRequestException('Esto es para compras que pagó un familiar: indica quién pagó');
    const names = await this.shared.people(userId, split);
    const payerPerson = names.get(split.paidByPersonId)!;
    const payer = payerPerson.linkedUserId ? await this.prisma.user.findUnique({ where: { id: payerPerson.linkedUserId } }) : null;
    if (!payer || payer.disabledAt) throw new BadRequestException(`${payerPerson.name} no usa la app: registra la compra directamente`);
    if (!split.participants.some((p) => p.personId === null)) throw new BadRequestException('Si pagó otra persona, agrega tu parte');

    const category = await this.transactions.assertCategory(userId, dto.categoryId ?? null, 'EXPENSE');
    const total = await this.transactions.snapshot(userId, {
      currency: dto.currency, amount: dto.amount, date: dto.date, rateSource: dto.rateSource ?? category?.defaultRateSource ?? undefined, rate: dto.rate,
    });
    // Mismo cálculo que hará la cuenta de quien pagó (valida porcentajes y montos)
    const result = computeSplit({ totalUsd: total.amountUsd, totalOriginal: total.originalAmount, mode: split.mode, paidByPersonId: split.paidByPersonId, participants: split.participants });

    let installments: Preview['installments'] = null;
    if (kind === 'INSTALLMENTS') {
      const p = dto as CreatePlanDto;
      const down = p.downPaymentUsd !== undefined ? new Prisma.Decimal(p.downPaymentUsd) : p.downPaymentPct !== undefined ? total.amountUsd.mul(p.downPaymentPct).div(100) : null;
      if (!down) throw new BadRequestException('Indica la inicial (en % o en USD)');
      installments = { provider: p.provider, store: p.store ?? null, count: p.count, frequency: p.frequency ?? 'DAYS_14', downPaymentUsd: down.toFixed(2) };
    }
    const creator = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const preview: Preview = {
      description: dto.description?.trim() || null,
      categoryName: category?.name ?? null,
      date: dto.date, currency: dto.currency, amount: total.originalAmount.toFixed(2), totalUsd: total.amountUsd.toFixed(2),
      installments,
      parts: result.rows.map((r) => ({
        role: r.personId === null ? 'CREATOR' : r.personId === split.paidByPersonId ? 'PAYER' : 'OTHER',
        name: r.personId === null ? displayName(creator) : names.get(r.personId)!.name,
        amountUsd: r.amountUsd.toFixed(2), pct: r.pct.toFixed(2),
      })),
    };

    const { accountId: _a, ...payload } = dto as CreateSharedTxDto & CreatePlanDto;
    const req = await this.prisma.sharedRequest.create({
      data: { fromUserId: userId, toUserId: payer.id, kind, payload: payload as unknown as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue },
    });
    const what = preview.description ?? preview.categoryName ?? 'Una compra';
    const mine = result.myAmountUsd;
    await this.prisma.notification.create({
      data: {
        userId: payer.id, type: 'SHARED_REQUEST', dedupeKey: `sreq:${req.id}`, link: '/resumen',
        title: `${displayName(creator)} registró una compra que pagaste tú`,
        body: `${what}, ${fmt(preview.amount, preview.currency)}${installments ? ` en cuotas (${installments.provider})` : ''}: su parte es ${fmt(mine, 'USD')}. Acéptala para que quede en tu cuenta y en la suya, o recházala.`,
      },
    });
    return this.present({ ...req, fromUser: creator, toUser: payer }, userId);
  }

  /** Las que te mandaron para confirmar y las que mandaste tú y siguen esperando. */
  async list(userId: string) {
    const rows = await this.prisma.sharedRequest.findMany({
      where: { OR: [{ toUserId: userId }, { fromUserId: userId }] },
      include: { fromUser: true, toUser: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      incoming: rows.filter((r) => r.toUserId === userId).map((r) => this.present(r, userId)),
      outgoing: rows.filter((r) => r.fromUserId === userId).map((r) => this.present(r, userId)),
    };
  }

  /** La acepta quien pagó: se registra en su cuenta como compra suya y, por la copia de siempre, en la de quien la mandó. */
  async accept(userId: string, id: string, dto: AcceptDto) {
    const req = await this.prisma.sharedRequest.findFirst({ where: { id, toUserId: userId }, include: { fromUser: true, toUser: true } });
    if (!req) throw new NotFoundException('Esta compra ya no está pendiente');
    const { count } = await this.prisma.sharedRequest.updateMany({ where: { id, claimedAt: null }, data: { claimedAt: new Date() } });
    if (!count) throw new ConflictException('Esta compra ya se está registrando');
    const payload = req.payload as unknown as CreateSharedTxDto & CreatePlanDto;
    const preview = req.preview as unknown as Preview;
    let sharedId: string | null;
    try {
      const split = await this.translate(req.fromUser, userId, payload.split);
      const categoryId = dto.categoryId !== undefined ? dto.categoryId : await this.sameCategory(userId, preview.categoryName);
      const { tags: _t, ...rest } = payload as CreateSharedTxDto & CreatePlanDto & { tags?: string[] };
      const body = { ...rest, split, categoryId, accountId: dto.accountId ?? null };
      if (req.kind === 'INSTALLMENTS') {
        const plan = await this.installments.create(userId, body as CreatePlanDto);
        sharedId = (plan as { sharedId?: string | null }).sharedId ?? null;
      } else {
        const tx = await this.shared.create(userId, body as CreateSharedTxDto);
        sharedId = tx.sharedId ?? null;
      }
    } catch (e) {
      await this.prisma.sharedRequest.updateMany({ where: { id }, data: { claimedAt: null } });
      throw e;
    }

    await this.prisma.$transaction(async (db) => {
      await db.sharedRequest.delete({ where: { id } });
      await db.notification.updateMany({ where: { userId, dedupeKey: `sreq:${id}`, readAt: null }, data: { readAt: new Date() } });
      // A quien la mandó ya le llegó "compartió una compra contigo": se cambia por "la aceptó"
      const mirror = sharedId ? await db.sharedExpense.findFirst({ where: { mirrorOfId: sharedId, userId: req.fromUserId } }) : null;
      const what = preview.description ?? preview.categoryName ?? 'La compra';
      const title = `${displayName(req.toUser)} aceptó la compra que registraste`;
      const body = `${what}, ${fmt(preview.amount, preview.currency)}. Ya está en tus movimientos, con tu deuda con ${displayName(req.toUser)}.`;
      const updated = mirror
        ? await db.notification.updateMany({ where: { userId: req.fromUserId, dedupeKey: `shared:${mirror.id}` }, data: { type: 'SHARED_REQUEST_ACCEPTED', title, body } })
        : { count: 0 };
      if (!updated.count) {
        await db.notification.create({ data: { userId: req.fromUserId, type: 'SHARED_REQUEST_ACCEPTED', dedupeKey: `sreq-ok:${id}`, link: '/movimientos', title, body } });
      }
    });
    return { ok: true, sharedId };
  }

  /** La rechaza quien supuestamente pagó: no se registra nada y a quien la mandó le llega el aviso. */
  async reject(userId: string, id: string, dto: RejectDto) {
    const req = await this.prisma.sharedRequest.findFirst({ where: { id, toUserId: userId, claimedAt: null }, include: { toUser: true } });
    if (!req) throw new NotFoundException('Esta compra ya no está pendiente');
    const preview = req.preview as unknown as Preview;
    const what = preview.description ?? preview.categoryName ?? 'La compra';
    const reason = dto.reason?.trim();
    await this.prisma.$transaction([
      this.prisma.sharedRequest.delete({ where: { id } }),
      this.prisma.notification.updateMany({ where: { userId, dedupeKey: `sreq:${id}`, readAt: null }, data: { readAt: new Date() } }),
      this.prisma.notification.create({
        data: {
          userId: req.fromUserId, type: 'SHARED_REQUEST_REJECTED', dedupeKey: `sreq-no:${id}`, link: '/movimientos',
          title: `${displayName(req.toUser)} rechazó la compra compartida`,
          body: `${what}, ${fmt(preview.amount, preview.currency)} del ${preview.date.split('-').reverse().join('/')}. No se registró nada${reason ? `. Te dijo: «${reason}»` : ''}.`,
        },
      }),
    ]);
    return { ok: true };
  }

  /** Quien la mandó la retira antes de que la respondan. */
  async cancel(userId: string, id: string) {
    const req = await this.prisma.sharedRequest.findFirst({ where: { id, fromUserId: userId, claimedAt: null } });
    if (!req) throw new NotFoundException('Esta compra ya no está pendiente');
    await this.prisma.$transaction([
      this.prisma.sharedRequest.delete({ where: { id } }),
      this.prisma.notification.deleteMany({ where: { userId: req.toUserId, dedupeKey: `sreq:${id}` } }),
    ]);
    return { ok: true };
  }

  /**
   * El reparto visto desde la cuenta de quien pagó: él pasa a ser "yo", quien la mandó pasa a ser
   * su persona vinculada, y los demás se buscan en sus personas (o se crean con el mismo nombre).
   */
  private async translate(creator: User, payerId: string, split: SplitDto): Promise<SplitDto> {
    const map = async (pid: string | null): Promise<string | null> => {
      if (pid === null) return (await this.people.ensureLinkedPerson(payerId, creator)).id;
      if (pid === split.paidByPersonId) return null;
      const p = await this.prisma.person.findFirst({ where: { id: pid, userId: creator.id }, include: { linkedUser: true } });
      if (!p) throw new BadRequestException('Alguna de las personas de la compra ya no existe');
      if (p.linkedUser && p.linkedUserId !== payerId) return (await this.people.ensureLinkedPerson(payerId, p.linkedUser)).id;
      const same = await this.prisma.person.findFirst({ where: { userId: payerId, linkedUserId: null, name: { equals: p.name, mode: 'insensitive' } } });
      return same?.id ?? (await this.prisma.person.create({ data: { userId: payerId, name: p.name, phone: p.phone } })).id;
    };
    const participants = [];
    for (const x of split.participants) participants.push({ personId: await map(x.personId), ...(x.value !== undefined ? { value: x.value } : {}) });
    return { paidByPersonId: null, mode: split.mode, participants };
  }

  private async sameCategory(userId: string, name: string | null) {
    if (!name) return null;
    const c = await this.prisma.category.findFirst({ where: { userId, type: 'EXPENSE', name: { equals: name, mode: 'insensitive' } } });
    return c?.id ?? null;
  }

  private present(r: SharedRequest & { fromUser?: User; toUser?: User }, userId: string) {
    const preview = r.preview as unknown as Preview;
    const incoming = r.toUserId === userId;
    return {
      id: r.id,
      kind: r.kind,
      incoming,
      from: r.fromUser ? { id: r.fromUser.id, name: displayName(r.fromUser) } : null,
      to: r.toUser ? { id: r.toUser.id, name: displayName(r.toUser) } : null,
      createdAt: r.createdAt,
      ...preview,
      // Cada parte vista desde quien la mira: "me" marca la tuya
      parts: preview.parts.map((p) => ({ ...p, me: incoming ? p.role === 'PAYER' : p.role === 'CREATOR' })),
    };
  }
}

@ApiTags('shared') @ApiBearerAuth()
@Controller('shared-requests')
class SharedRequestsController {
  constructor(private svc: SharedRequestsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }

  @Post('purchase')
  purchase(@CurrentUser() u: AuthUser, @Body() dto: CreateSharedTxDto) { return this.svc.create(u.id, 'PURCHASE', dto); }

  @Post('installments')
  installments(@CurrentUser() u: AuthUser, @Body() dto: CreatePlanDto) { return this.svc.create(u.id, 'INSTALLMENTS', dto); }

  @Post(':id/accept') @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: AcceptDto) { return this.svc.accept(u.id, id, dto); }

  @Post(':id/reject') @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) { return this.svc.reject(u.id, id, dto); }

  @Delete(':id')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancel(u.id, id); }
}

@Module({
  imports: [SharedModule, InstallmentsModule, PeopleModule, TransactionsModule],
  controllers: [SharedRequestsController],
  providers: [SharedRequestsService],
})
export class SharedRequestsModule {}
