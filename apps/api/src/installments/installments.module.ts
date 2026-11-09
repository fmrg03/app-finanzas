import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException,
  OnApplicationBootstrap, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Currency, InstallmentFrequency, Prisma, RateSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString, IsEnum, IsInt, IsNumberString, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CronJob } from 'cron';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { APP_TIMEZONE, parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { deleteMirrorsOf } from '../shared/mirror-cleanup';
import { MirrorService } from '../shared/mirror.service';
import { SharedModule, SharedService, SplitDto } from '../shared/shared.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { myShare, TransactionsService } from '../transactions/transactions.service';

export class CreatePlanDto {
  @ApiProperty({ example: 'Cashea' }) @IsString() @MinLength(1) @MaxLength(40)
  provider: string;

  @ApiPropertyOptional({ example: 'Tiendas Daka' }) @IsOptional() @IsString() @MaxLength(80)
  store?: string;

  @ApiProperty({ example: 'Nevera' }) @IsString() @MinLength(1) @MaxLength(200)
  description: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;

  @ApiProperty({ example: '2026-10-31' }) @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ enum: Currency, description: 'Moneda del precio total' }) @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ example: '600', description: 'Precio total de la compra' }) @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ enum: RateSource }) @IsOptional() @IsEnum(RateSource)
  rateSource?: RateSource;

  @ApiPropertyOptional() @IsOptional() @IsNumberString()
  rate?: string;

  @ApiPropertyOptional({ example: '40', description: 'Inicial en % del total (o usa downPaymentUsd)' })
  @IsOptional() @IsNumberString()
  downPaymentPct?: string;

  @ApiPropertyOptional({ example: '240', description: 'Inicial en USD' }) @IsOptional() @IsNumberString()
  downPaymentUsd?: string;

  @ApiProperty({ example: 3 }) @Type(() => Number) @IsInt() @Min(1) @Max(24)
  count: number;

  @ApiPropertyOptional({ enum: InstallmentFrequency, default: 'DAYS_14' }) @IsOptional() @IsEnum(InstallmentFrequency)
  frequency?: InstallmentFrequency;

  @ApiPropertyOptional({ description: 'Por defecto: compra + 14 días, + 15 días o + 1 mes según la frecuencia' })
  @IsOptional() @IsDateString({ strict: true })
  firstDueDate?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Cuenta con la que pagas la inicial (si la compra es tuya)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  accountId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Si la pagó otra persona: cuenta de la que sale tu parte de la inicial y de cada cuota' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  myAccountId?: string | null;

  @ApiPropertyOptional({ type: SplitDto, description: 'Si la compra es compartida' })
  @IsOptional() @ValidateNested() @Type(() => SplitDto)
  split?: SplitDto;
}

class UpdatePlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) provider?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) store?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() categoryId?: string | null;
}

class PayInstallmentDto {
  @ApiProperty() @IsString()
  accountId: string;

  @ApiPropertyOptional({ description: 'Por defecto hoy' }) @IsOptional() @IsDateString({ strict: true })
  date?: string;

  @ApiPropertyOptional({ description: 'Monto pagado en USD si difiere de la cuota (descuento, recargo)' })
  @IsOptional() @IsNumberString()
  amountUsd?: string;

  @ApiPropertyOptional({ enum: RateSource }) @IsOptional() @IsEnum(RateSource)
  rateSource?: RateSource;

  @ApiPropertyOptional({ description: 'Tasa usada para pagar en Bs, si fue distinta' }) @IsOptional() @IsNumberString()
  rate?: string;
}

class MyAccountDto {
  @ApiPropertyOptional({ nullable: true, description: 'Cuenta de la que sale tu parte; null para no usar ninguna' })
  @ValidateIf((_, v) => v !== null) @IsString()
  accountId!: string | null;
}

const D = Prisma.Decimal;
const PLAN_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  account: { select: { id: true, name: true, currency: true } },
  myAccount: { select: { id: true, name: true, currency: true } },
  shared: {
    select: {
      id: true, splitMode: true, totalUsd: true, paidByPersonId: true,
      mirrorOf: { select: { user: { select: { id: true, name: true, email: true } } } },
      paidBy: { select: { id: true, name: true, phone: true } },
      participants: { select: { personId: true, pct: true, amountUsd: true, person: { select: { id: true, name: true, phone: true } } } },
      debts: { select: { id: true, personId: true, direction: true, amount: true, settledAt: true, payments: { select: { amount: true } } } },
    },
  },
  installments: {
    orderBy: { n: 'asc' },
    include: { transaction: { select: { id: true, date: true, amountUsd: true, amountVes: true, originalCurrency: true, account: { select: { id: true, name: true } } } } },
  },
} satisfies Prisma.InstallmentPlanInclude;

/** Fechas de las cuotas: cada 14 o 15 días, o el mismo día cada mes (ajustado a meses cortos). */
export function dueDates(first: Date, count: number, frequency: InstallmentFrequency) {
  return Array.from({ length: count }, (_, i) => {
    if (frequency === 'MONTHLY') {
      const y = first.getUTCFullYear();
      const m = first.getUTCMonth() + i;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return new Date(Date.UTC(y, m, Math.min(first.getUTCDate(), last)));
    }
    return new Date(first.getTime() + i * (frequency === 'DAYS_15' ? 15 : 14) * 86_400_000);
  });
}

/** Cuotas iguales a centavos; la última absorbe la diferencia. */
export function splitInstallments(remaining: Prisma.Decimal, count: number) {
  const base = remaining.div(count).toDecimalPlaces(2, D.ROUND_DOWN);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? remaining.sub(base.mul(count - 1)) : base));
}

@Injectable()
export class InstallmentsService implements OnApplicationBootstrap {
  private readonly log = new Logger(InstallmentsService.name);

  constructor(
    private prisma: PrismaService,
    private transactions: TransactionsService,
    private shared: SharedService,
    private mirrors: MirrorService,
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('RECURRING_ENABLED') === 'false') return;
    // Cuotas de compras que hizo otra persona: tu parte se registra sola el día de cada cuota
    const job = CronJob.from({ cronTime: '5 0,6 * * *', timeZone: APP_TIMEZONE, onTick: () => void this.processDueSafe() });
    this.scheduler.addCronJob('installments-process', job);
    job.start();
    void this.processDueSafe();
  }

  async list(userId: string) {
    await this.processDueSafe(userId);
    const plans = await this.prisma.installmentPlan.findMany({ where: { userId }, include: PLAN_INCLUDE, orderBy: { purchaseDate: 'desc' } });
    const today = parseDateOnly(todayLocal());
    return plans.map((p) => this.present(p, today));
  }

  async findOne(userId: string, id: string) {
    const p = await this.prisma.installmentPlan.findFirst({ where: { id, userId }, include: PLAN_INCLUDE });
    if (!p) throw new NotFoundException('Compra en cuotas no encontrada');
    return this.present(p, parseDateOnly(todayLocal()));
  }

  /** Cuotas que te tocan pagar a ti en los próximos días (y las vencidas). */
  async upcoming(userId: string, days = 30) {
    const limit = new Date(parseDateOnly(todayLocal()).getTime() + days * 86_400_000);
    const items = await this.prisma.installment.findMany({
      where: { transactionId: null, dueDate: { lte: limit }, plan: { userId, OR: [{ sharedId: null }, { shared: { paidByPersonId: null } }] } },
      include: { plan: { select: { id: true, provider: true, description: true, count: true } } },
      orderBy: { dueDate: 'asc' },
    });
    return {
      totalUsd: items.reduce((a, i) => a.add(i.amountUsd), new D(0)).toFixed(2),
      items: items.map((i) => ({ id: i.id, n: i.n, dueDate: toDateOnly(i.dueDate), amountUsd: i.amountUsd.toFixed(2), plan: i.plan })),
    };
  }

  async create(userId: string, dto: CreatePlanDto) {
    await this.mirrors.assertPayerNotLinked(userId, dto.split?.paidByPersonId);
    const paidByMe = dto.split?.paidByPersonId == null;
    if (paidByMe && !dto.accountId) throw new BadRequestException('Indica con qué cuenta pagaste la inicial');
    if (paidByMe) await this.transactions.assertAccount(userId, dto.accountId!);
    if (!paidByMe && dto.myAccountId) await this.transactions.assertAccount(userId, dto.myAccountId);
    const category = await this.transactions.assertCategory(userId, dto.categoryId ?? null, 'EXPENSE');
    const frequency = dto.frequency ?? 'DAYS_14';

    // Precio total fijado en USD con la tasa del día de la compra
    const total = await this.transactions.snapshot(userId, {
      // Cashea y similares cobran a BCV: es la tasa por defecto de las compras en cuotas
      currency: dto.currency, amount: dto.amount, date: dto.date, rateSource: dto.rate ? undefined : (dto.rateSource ?? 'BCV'), rate: dto.rate,
    });
    const totalUsd = total.amountUsd;
    let down: Prisma.Decimal;
    if (dto.downPaymentUsd !== undefined) down = new D(dto.downPaymentUsd);
    else if (dto.downPaymentPct !== undefined) down = totalUsd.mul(dto.downPaymentPct).div(100);
    else throw new BadRequestException('Indica la inicial (en % o en USD)');
    down = down.toDecimalPlaces(2, D.ROUND_HALF_UP);
    if (down.lt(0) || down.gte(totalUsd)) throw new BadRequestException('La inicial debe ser menor que el total');

    const purchase = parseDateOnly(dto.date);
    const first = dto.firstDueDate
      ? parseDateOnly(dto.firstDueDate)
      : frequency === 'MONTHLY' ? dueDates(purchase, 2, 'MONTHLY')[1] : new Date(purchase.getTime() + (frequency === 'DAYS_15' ? 15 : 14) * 86_400_000);
    if (first <= purchase) throw new BadRequestException('La primera cuota debe ser después de la compra');
    const dates = dueDates(first, dto.count, frequency);
    const amounts = splitInstallments(totalUsd.sub(down), dto.count);
    const label = `${dto.provider.trim()}: ${dto.description.trim()}`;

    const created = await this.prisma.$transaction(async (db) => {
      let sharedId: string | undefined;
      let sharePct: Prisma.Decimal | null = null;
      if (dto.split) {
        const s = await this.shared.buildShared(db, userId, dto.split, { totalUsd, totalOriginal: total.originalAmount }, {
          description: `${label} (compartido)`, dueDate: dates[dates.length - 1],
        });
        sharedId = s.shared.id;
        sharePct = s.myPct;
      }
      const plan = await db.installmentPlan.create({
        data: {
          userId, provider: dto.provider.trim(), store: dto.store?.trim() || null, description: dto.description.trim(),
          categoryId: dto.categoryId ?? null, purchaseDate: purchase, totalUsd, downPaymentUsd: down, count: dto.count, frequency,
          accountId: paidByMe ? dto.accountId! : null, myAccountId: !paidByMe ? (dto.myAccountId ?? null) : null,
          rateSource: total.rateSource, rateUsed: total.rateUsed, sharedId,
          installments: { create: dates.map((d, i) => ({ n: i + 1, dueDate: d, amountUsd: amounts[i] })) },
        },
      });
      // La inicial cuenta como gasto el día de la compra, con la misma tasa
      if (down.gt(0)) {
        const amountVes = down.mul(total.rateUsed).toDecimalPlaces(2, D.ROUND_HALF_UP);
        await this.transactions.insert(
          userId,
          { accountId: paidByMe ? dto.accountId! : null, categoryId: dto.categoryId ?? null, type: 'EXPENSE', date: dto.date, description: `${label} (inicial)` },
          {
            originalCurrency: 'USD', originalAmount: down, amountUsd: down, amountVes, rateUsed: total.rateUsed,
            rateSource: total.rateSource, exchangeRateId: total.exchangeRateId, ...myShare(down, amountVes, sharePct),
          },
          { source: 'INSTALLMENT', externalId: `plan:${plan.id}:down`, installmentPlanId: plan.id },
          db,
        );
      }
      return { planId: plan.id, sharedId };
    });
    // A los familiares vinculados les aparece la compra con su parte; sus cuotas vencidas se registran ya
    if (!paidByMe) await this.applyMyAccount(created.planId);
    if (created.sharedId && (await this.mirrors.sync(created.sharedId))) await this.processDueSafe();
    else await this.processDueSafe(userId);
    return this.findOne(userId, created.planId);
  }

  async update(userId: string, id: string, dto: UpdatePlanDto) {
    const plan = await this.own(userId, id);
    if (dto.categoryId) await this.transactions.assertCategory(userId, dto.categoryId, 'EXPENSE');
    await this.prisma.$transaction([
      this.prisma.installmentPlan.update({
        where: { id },
        data: { provider: dto.provider?.trim(), store: dto.store === undefined ? undefined : dto.store.trim() || null, description: dto.description?.trim(), categoryId: dto.categoryId },
      }),
      // La categoría se aplica también a la inicial y a las cuotas ya pagadas, para que los presupuestos cuadren
      ...(dto.categoryId !== undefined ? [this.prisma.transaction.updateMany({ where: { installmentPlanId: plan.id }, data: { categoryId: dto.categoryId } })] : []),
    ]);
    return this.findOne(userId, id);
  }

  /** Borra la compra, su inicial, sus cuotas pagadas y las deudas del reparto. */
  async remove(userId: string, id: string) {
    const plan = await this.own(userId, id);
    if (plan.sharedId) {
      await this.mirrors.assertNotMirror(plan.sharedId, 'borrarla');
      await this.transactions.assertNoPayments(plan.sharedId);
    }
    await this.prisma.$transaction(async (db) => {
      if (plan.sharedId) await deleteMirrorsOf(db, plan.sharedId);
      await db.installmentPlan.delete({ where: { id } });
      if (plan.sharedId) await db.sharedExpense.delete({ where: { id: plan.sharedId } });
    });
  }

  async pay(userId: string, installmentId: string, dto: PayInstallmentDto) {
    const inst = await this.prisma.installment.findFirst({
      where: { id: installmentId, plan: { userId } },
      include: { plan: { include: { shared: { select: { paidByPersonId: true } } } } },
    });
    if (!inst) throw new NotFoundException('Cuota no encontrada');
    if (inst.plan.shared?.paidByPersonId) throw new ConflictException('Esta compra la hizo otra persona: sus cuotas se registran solas');
    if (inst.transactionId) throw new ConflictException(`La cuota ${inst.n} ya está pagada`);
    await this.transactions.assertAccount(userId, dto.accountId);
    const amount = dto.amountUsd !== undefined ? new D(dto.amountUsd) : inst.amountUsd;
    const sharePct = inst.plan.sharedId ? await this.myPct(inst.plan.sharedId) : null;
    const date = dto.date ?? todayLocal();
    const snapshot = await this.transactions.snapshot(userId, {
      currency: 'USD', amount: amount.toFixed(2), date, rateSource: dto.rateSource ?? (inst.plan.rateSource === 'MANUAL' ? undefined : inst.plan.rateSource), rate: dto.rate, sharePct,
    });
    const tx = await this.prisma.$transaction(async (db) => {
      const created = await this.transactions.insert(
        userId,
        { accountId: dto.accountId, categoryId: inst.plan.categoryId, type: 'EXPENSE', date, description: `${inst.plan.provider}: ${inst.plan.description} (cuota ${inst.n}/${inst.plan.count})` },
        snapshot,
        { source: 'INSTALLMENT', externalId: `inst:${inst.id}:${Date.now()}`, installmentPlanId: inst.planId },
        db,
      );
      await db.installment.update({ where: { id: inst.id }, data: { transactionId: created.id } });
      return created;
    });
    // Compra compartida: a los demás (familiares) se les registra su parte de esta cuota el mismo día
    if (inst.plan.sharedId) await this.registerOthers(inst.plan.sharedId, inst.n, date);
    return { installmentId: inst.id, transaction: await this.transactions.findOne(userId, tx.id) };
  }

  /** Elige la cuenta de la que sale tu parte en una compra que pagó otra persona; lo ya registrado sin cuenta pasa a ella. */
  async setMyAccount(userId: string, id: string, dto: MyAccountDto) {
    const plan = await this.prisma.installmentPlan.findFirst({ where: { id, userId }, include: { shared: { select: { paidByPersonId: true } } } });
    if (!plan) throw new NotFoundException('Compra en cuotas no encontrada');
    if (!plan.shared?.paidByPersonId) throw new BadRequestException('Esta compra la pagas tú: la cuenta de cada cuota se elige al pagarla');
    if (dto.accountId) await this.transactions.assertAccount(userId, dto.accountId);
    await this.prisma.installmentPlan.update({ where: { id }, data: { myAccountId: dto.accountId } });
    await this.applyMyAccount(id);
    return this.findOne(userId, id);
  }

  /** Deshace el pago: borra el movimiento y la cuota vuelve a quedar pendiente. */
  async unpay(userId: string, installmentId: string) {
    const inst = await this.prisma.installment.findFirst({ where: { id: installmentId, plan: { userId } }, include: { plan: { include: { shared: true } } } });
    if (!inst) throw new NotFoundException('Cuota no encontrada');
    if (inst.plan.shared?.paidByPersonId) throw new ConflictException('Esta compra la hizo otra persona: sus cuotas se registran solas');
    if (!inst.transactionId) throw new ConflictException(`La cuota ${inst.n} no está pagada`);
    await this.prisma.transaction.delete({ where: { id: inst.transactionId } });
    if (inst.plan.sharedId) await this.unregisterOthers(inst.plan.sharedId, inst.n);
  }

  /**
   * Compras que hizo otra persona: tu parte de cada cuota se registra cuando ella la marca pagada,
   * o al vencer si no la marcó. Sale de la cuenta que elegiste y baja tu deuda con ella.
   */
  async processDue(userId?: string) {
    const today = parseDateOnly(todayLocal());
    const due = await this.prisma.installment.findMany({
      where: { transactionId: null, dueDate: { lte: today }, plan: { ...(userId ? { userId } : {}), shared: { paidByPersonId: { not: null } } } },
      include: { plan: true },
      orderBy: { dueDate: 'asc' },
    });
    let created = 0;
    for (const inst of due) if (await this.registerPart(inst, toDateOnly(inst.dueDate))) created++;
    return created;
  }

  /** Tu parte de una cuota de una compra que pagó otra persona, con la tasa del día en que se paga (BCV en Cashea). */
  private async registerPart(inst: Prisma.InstallmentGetPayload<{ include: { plan: true } }>, date: string) {
    const sharePct = await this.myPct(inst.plan.sharedId!);
    const snapshot = await this.transactions.snapshot(inst.plan.userId, {
      currency: 'USD', amount: inst.amountUsd.toFixed(2), date,
      ...(inst.plan.rateSource === 'MANUAL' ? { rate: inst.plan.rateUsed.toString() } : { rateSource: inst.plan.rateSource }),
      sharePct,
    });
    const done = await this.prisma.$transaction(async (db) => {
      // Si otro proceso ya la registró, no se duplica
      const fresh = await db.installment.findUnique({ where: { id: inst.id }, select: { transactionId: true } });
      if (fresh?.transactionId) return false;
      const tx = await this.transactions.insert(
        inst.plan.userId,
        { accountId: null, categoryId: inst.plan.categoryId, type: 'EXPENSE', date, description: `${inst.plan.provider}: ${inst.plan.description} (cuota ${inst.n}/${inst.plan.count})` },
        snapshot,
        { source: 'INSTALLMENT', externalId: `inst:${inst.id}`, installmentPlanId: inst.planId },
        db,
      );
      await db.installment.update({ where: { id: inst.id }, data: { transactionId: tx.id } });
      return true;
    });
    if (done) await this.applyMyAccount(inst.planId);
    return done;
  }

  /** Al pagar una cuota de una compra compartida, registra la parte de cada familiar que la tiene en su cuenta. */
  private async registerOthers(sharedId: string, n: number, date: string) {
    const items = await this.prisma.installment.findMany({
      where: { n, transactionId: null, plan: { shared: { mirrorOfId: sharedId } } },
      include: { plan: true },
    });
    for (const i of items) await this.registerPart(i, date).catch((e) => this.log.error(`Parte de cuota ${i.id}: ${(e as Error).message}`));
  }

  /** Si se deshace el pago de una cuota que aún no vencía, se deshace también la parte de los familiares. */
  private async unregisterOthers(sharedId: string, n: number) {
    const today = parseDateOnly(todayLocal());
    const items = await this.prisma.installment.findMany({
      where: { n, transactionId: { not: null }, dueDate: { gt: today }, plan: { shared: { mirrorOfId: sharedId } } },
      include: { plan: true },
    });
    for (const i of items) {
      await this.prisma.$transaction(async (db) => {
        const pays = await db.debtPayment.findMany({ where: { transactionId: i.transactionId! }, include: { debt: true } });
        await db.debtPayment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
        await db.transaction.delete({ where: { id: i.transactionId! } });
        for (const p of pays) await this.settle(db, p.debt.id, p.debt.linkedDebtId);
      });
    }
  }

  /**
   * Lo registrado de tu parte sin cuenta (la inicial, cuotas) pasa a la cuenta elegida: el gasto queda por tu parte
   * (es lo que sale de tu bolsillo) y cuenta como abono a tu deuda con quien pagó, que lo ve en su lado.
   */
  async applyMyAccount(planId: string) {
    const plan = await this.prisma.installmentPlan.findUnique({ where: { id: planId } });
    if (!plan?.myAccountId || !plan.sharedId) return;
    const txs = await this.prisma.transaction.findMany({
      where: { userId: plan.userId, installmentPlanId: plan.id, accountId: null }, orderBy: { date: 'asc' },
    });
    if (!txs.length) return;
    const debt = await this.prisma.debt.findFirst({ where: { userId: plan.userId, sharedId: plan.sharedId, direction: 'I_OWE' } });
    await this.prisma.$transaction(async (db) => {
      for (const t of txs) {
        await db.transaction.update({
          where: { id: t.id },
          data: {
            accountId: plan.myAccountId, originalCurrency: 'USD', originalAmount: t.myAmountUsd, amountUsd: t.myAmountUsd, amountVes: t.myAmountVes,
            sharePct: null,
          },
        });
        if (!debt) continue;
        const paid = (await db.debtPayment.aggregate({ where: { debtId: debt.id }, _sum: { amount: true } }))._sum.amount ?? new D(0);
        const amount = D.min(t.myAmountUsd, debt.amount.sub(paid));
        if (amount.lte(0)) continue;
        // El movimiento ya mueve la cuenta; el abono solo baja la deuda
        const p = await db.debtPayment.create({ data: { debtId: debt.id, amount, date: t.date, accountId: plan.myAccountId, transactionId: t.id } });
        if (debt.linkedDebtId) await db.debtPayment.create({ data: { debtId: debt.linkedDebtId, amount, date: t.date, mirrorOfId: p.id } });
      }
      if (debt) await this.settle(db, debt.id, debt.linkedDebtId);
    });
  }

  /** Marca saldada (o no) una deuda y su copia según lo abonado. */
  private async settle(db: Prisma.TransactionClient, ...ids: (string | null)[]) {
    for (const id of ids) {
      if (!id) continue;
      const d = await db.debt.findUnique({ where: { id }, include: { payments: { select: { amount: true, date: true }, orderBy: { date: 'desc' } } } });
      if (!d) continue;
      const paid = d.payments.reduce((a, p) => a.add(p.amount), new D(0));
      await db.debt.update({ where: { id }, data: { settledAt: paid.gte(d.amount) ? (d.settledAt ?? d.payments[0]?.date ?? new Date()) : null } });
    }
  }

  async processDueSafe(userId?: string) {
    try {
      const n = await this.processDue(userId);
      if (n) this.log.log(`Cuotas de compras de otros registradas: ${n}`);
    } catch (e) {
      this.log.warn(`No se pudieron registrar cuotas: ${(e as Error).message}`);
    }
  }

  private async myPct(sharedId: string) {
    const me = await this.prisma.sharedParticipant.findFirst({ where: { sharedId, personId: null } });
    const shared = await this.prisma.sharedExpense.findUniqueOrThrow({ where: { id: sharedId } });
    if (!me || shared.totalUsd.isZero()) return new D(0);
    return me.amountUsd.div(shared.totalUsd).mul(100).toDecimalPlaces(6, D.ROUND_HALF_UP);
  }

  private async own(userId: string, id: string) {
    const p = await this.prisma.installmentPlan.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException('Compra en cuotas no encontrada');
    return p;
  }

  private present(p: Prisma.InstallmentPlanGetPayload<{ include: typeof PLAN_INCLUDE }>, today: Date) {
    const paidByMe = !p.shared?.paidByPersonId;
    const paid = p.installments.filter((i) => i.transactionId);
    const pending = p.installments.filter((i) => !i.transactionId);
    const remaining = pending.reduce((a, i) => a.add(i.amountUsd), new D(0));
    const me = p.shared?.participants.find((x) => x.personId === null);
    const next = pending[0];
    return {
      ...p,
      purchaseDate: toDateOnly(p.purchaseDate),
      paidByMe,
      myPct: p.shared ? (me && !p.shared.totalUsd.isZero() ? me.amountUsd.div(p.shared.totalUsd).mul(100).toFixed(2) : '0.00') : null,
      paidCount: paid.length,
      paidUsd: p.downPaymentUsd.add(paid.reduce((a, i) => a.add(i.amountUsd), new D(0))).toFixed(2),
      remainingUsd: remaining.toFixed(2),
      nextDue: next ? { id: next.id, n: next.n, dueDate: toDateOnly(next.dueDate), amountUsd: next.amountUsd.toFixed(2), overdue: next.dueDate < today } : null,
      installments: p.installments.map((i) => ({
        ...i,
        dueDate: toDateOnly(i.dueDate),
        overdue: !i.transactionId && i.dueDate < today,
        transaction: i.transaction ? { ...i.transaction, date: toDateOnly(i.transaction.date) } : null,
      })),
    };
  }
}

@ApiTags('installments') @ApiBearerAuth()
@Controller()
class InstallmentsController {
  constructor(private svc: InstallmentsService) {}

  @Get('installment-plans') list(@CurrentUser() u: AuthUser) { return this.svc.list(u.id); }
  @Get('installment-plans/upcoming') upcoming(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.svc.upcoming(u.id, Math.min(Math.max(Number(days) || 30, 1), 120));
  }
  @Get('installment-plans/:id') findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.findOne(u.id, id); }
  @Post('installment-plans') create(@CurrentUser() u: AuthUser, @Body() dto: CreatePlanDto) { return this.svc.create(u.id, dto); }
  @Patch('installment-plans/:id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdatePlanDto) { return this.svc.update(u.id, id, dto); }
  @Delete('installment-plans/:id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.remove(u.id, id); }
  @Post('installments/:id/pay') pay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PayInstallmentDto) { return this.svc.pay(u.id, id, dto); }
  @Patch('installment-plans/:id/my-account') myAccount(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: MyAccountDto) {
    return this.svc.setMyAccount(u.id, id, dto);
  }
  @Delete('installments/:id/pay') @HttpCode(204) unpay(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.unpay(u.id, id); }
}

@Module({
  imports: [TransactionsModule, SharedModule],
  controllers: [InstallmentsController],
  providers: [InstallmentsService],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
