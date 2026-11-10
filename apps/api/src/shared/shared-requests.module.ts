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
import { deleteMirrorsOf } from './mirror-cleanup';
import { computeSplit } from './split';

class AcceptDto {
  @ApiPropertyOptional({ nullable: true, description: 'Cuenta de la que salió el dinero (o la inicial, si es en cuotas)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  accountId?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;
}

class ChangeDraftDto {
  @IsString() txId!: string;
}

class ProposeChangeDto extends CreateSharedTxDto {
  @IsString() txId!: string;
}

class PlanDraftDto {
  @IsString() planId!: string;
}

class ProposePlanChangeDto extends CreatePlanDto {
  @IsString() planId!: string;
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
  /** Si es un cambio: cómo está ahora la compra */
  before?: Pick<Preview, 'description' | 'date' | 'currency' | 'amount' | 'totalUsd' | 'parts'> & { installments?: Preview['installments'] } | null;
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
  async create(userId: string, kind: SharedRequestKind, dto: CreateSharedTxDto | CreatePlanDto, change?: { targetSharedId: string; payerId: string }) {
    const split = dto.split;
    if (!split?.paidByPersonId) throw new BadRequestException('Esto es para compras que pagó un familiar: indica quién pagó');
    const names = await this.shared.people(userId, split);
    const payerPerson = names.get(split.paidByPersonId)!;
    const payer = payerPerson.linkedUserId ? await this.prisma.user.findUnique({ where: { id: payerPerson.linkedUserId } }) : null;
    if (!payer || payer.disabledAt) throw new BadRequestException(`${payerPerson.name} no usa la app: registra la compra directamente`);
    if (!split.participants.some((p) => p.personId === null)) throw new BadRequestException('Si pagó otra persona, agrega tu parte');
    if (change && payer.id !== change.payerId) throw new BadRequestException('En un cambio no se puede cambiar quién pagó: pídele que la borre y regístrala de nuevo');

    const myAccountId = (dto as CreatePlanDto).myAccountId;
    if (kind === 'INSTALLMENTS' && myAccountId) await this.transactions.assertAccount(userId, myAccountId);
    const category = await this.transactions.assertCategory(userId, dto.categoryId ?? null, 'EXPENSE');
    const total = await this.transactions.snapshot(userId, {
      currency: dto.currency, amount: dto.amount, date: dto.date, rate: dto.rate,
      rateSource: dto.rate ? undefined : (dto.rateSource ?? (kind === 'INSTALLMENTS' ? 'BCV' : category?.defaultRateSource ?? undefined)),
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

    if (change) {
      preview.before = kind === 'INSTALLMENTS' ? await this.currentPlan(change.targetSharedId, userId) : await this.current(change.targetSharedId, userId);
      // Un cambio nuevo reemplaza al anterior que no habían respondido
      const old = await this.prisma.sharedRequest.findMany({ where: { fromUserId: userId, targetSharedId: change.targetSharedId, claimedAt: null } });
      for (const o of old) await this.cancel(userId, o.id);
    }
    const { accountId: _a, txId: _tx, planId: _p, ...payload } = dto as CreateSharedTxDto & CreatePlanDto & { txId?: string; planId?: string };
    const req = await this.prisma.sharedRequest.create({
      data: {
        fromUserId: userId, toUserId: payer.id, kind, targetSharedId: change?.targetSharedId ?? null,
        payload: payload as unknown as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue,
      },
    });
    const what = preview.description ?? preview.categoryName ?? 'Una compra';
    const mine = result.myAmountUsd;
    await this.prisma.notification.create({
      data: change
        ? {
            userId: payer.id, type: 'SHARED_REQUEST', dedupeKey: `sreq:${req.id}`, link: '/resumen',
            title: `${displayName(creator)} propone un cambio en ${preview.before?.description ?? what}`,
            body: `Quedaría ${fmt(preview.amount, preview.currency)} del ${preview.date.split('-').reverse().join('/')}, su parte ${fmt(mine, 'USD')}. Acéptalo para cambiarla en las dos cuentas, o recházalo y queda como estaba.`,
          }
        : {
            userId: payer.id, type: 'SHARED_REQUEST', dedupeKey: `sreq:${req.id}`, link: '/resumen',
            title: `${displayName(creator)} registró una compra que pagaste tú`,
            body: `${what}, ${fmt(preview.amount, preview.currency)}${installments ? ` en cuotas (${installments.provider})` : ''}: su parte es ${fmt(mine, 'USD')}. Acéptala para que quede en tu cuenta y en la suya, o recházala.`,
          },
    });
    return this.present({ ...req, fromUser: creator, toUser: payer }, userId);
  }

  /**
   * Tu copia de una compra que pagó un familiar, como para editarla: el reparto completo
   * con tus personas (quien pagó, tú y los demás). Es el punto de partida para proponer un cambio.
   */
  async draft(userId: string, txId: string) {
    const { target, payer } = await this.targetOf(userId, txId);
    const tx = target.transaction!;
    const payerPerson = await this.people.ensureLinkedPerson(userId, payer);
    const participants = [];
    for (const p of target.participants) {
      let personId: string | null;
      if (p.personId === null) personId = payerPerson.id;
      else if (p.person?.linkedUserId === userId) personId = null;
      else if (p.person?.linkedUser) personId = (await this.people.ensureLinkedPerson(userId, p.person.linkedUser)).id;
      else {
        const same = await this.prisma.person.findFirst({ where: { userId, linkedUserId: null, name: { equals: p.person!.name, mode: 'insensitive' } } });
        personId = same?.id ?? (await this.prisma.person.create({ data: { userId, name: p.person!.name, phone: p.person!.phone } })).id;
      }
      const value = target.splitMode === 'PERCENT' ? p.pct.toFixed(2)
        : target.splitMode === 'AMOUNT' ? (target.totalUsd.isZero() ? '0' : p.amountUsd.div(target.totalUsd).mul(tx.originalAmount).toFixed(2))
          : undefined;
      participants.push({ personId, ...(value !== undefined ? { value } : {}) });
    }
    return {
      txId, date: tx.date.toISOString().slice(0, 10), currency: tx.originalCurrency, amount: tx.originalAmount.toFixed(2),
      description: tx.description, rateSource: tx.rateSource,
      split: { paidByPersonId: payerPerson.id, mode: target.splitMode, participants },
    };
  }

  /** Propones un cambio a una compra que pagó un familiar: le llega para aceptarlo; si lo rechaza, queda como estaba. */
  async proposeChange(userId: string, dto: ProposeChangeDto) {
    const { target, payer } = await this.targetOf(userId, dto.txId);
    await this.transactions.assertNoPayments(target.id);
    // La categoría es tuya y se cambia en tu copia; no viaja en la propuesta
    const mine = await this.prisma.transaction.findFirst({ where: { id: dto.txId, userId }, select: { categoryId: true } });
    return this.create(userId, 'PURCHASE', { ...dto, categoryId: mine?.categoryId ?? null }, { targetSharedId: target.id, payerId: payer.id });
  }

  /** Tu copia de una compra en cuotas que pagó un familiar, como para editarla (punto de partida del cambio). */
  async planDraft(userId: string, planId: string) {
    const { target, plan, payer } = await this.planTargetOf(userId, planId);
    const mine = await this.prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } });
    const split = await this.splitFor(userId, payer, target, target.totalUsd);
    return {
      planId, provider: plan.provider, store: plan.store, description: plan.description,
      date: plan.purchaseDate.toISOString().slice(0, 10), currency: 'USD', amount: plan.totalUsd.toFixed(2),
      downPaymentUsd: plan.downPaymentUsd.toFixed(2), count: plan.count, frequency: plan.frequency,
      firstDueDate: plan.installments[0]?.dueDate.toISOString().slice(0, 10) ?? null,
      myAccountId: mine.myAccountId, split,
    };
  }

  /** Propones un cambio a una compra en cuotas que pagó un familiar; al aceptarlo, la compra se rehace. */
  async proposePlanChange(userId: string, dto: ProposePlanChangeDto) {
    const { target, plan, payer } = await this.planTargetOf(userId, dto.planId);
    await this.assertPlanEditable(plan.id, target.id);
    const mine = await this.prisma.installmentPlan.findUniqueOrThrow({ where: { id: dto.planId }, select: { categoryId: true } });
    return this.create(userId, 'INSTALLMENTS', { ...dto, categoryId: mine.categoryId }, { targetSharedId: target.id, payerId: payer.id });
  }

  private async planTargetOf(userId: string, planId: string) {
    const mine = await this.prisma.installmentPlan.findFirst({ where: { id: planId, userId }, include: { shared: { select: { mirrorOfId: true } } } });
    if (!mine?.shared?.mirrorOfId) throw new NotFoundException('Esta compra no es una copia de la de un familiar');
    const target = await this.prisma.sharedExpense.findUniqueOrThrow({
      where: { id: mine.shared.mirrorOfId },
      include: { participants: { include: { person: { include: { linkedUser: true } } } }, plan: { include: { installments: { orderBy: { n: 'asc' } } } }, user: true },
    });
    if (!target.plan) throw new BadRequestException('Esta compra no es en cuotas');
    return { target, plan: target.plan, payer: target.user };
  }

  /**
   * Una compra en cuotas se puede rehacer si no hay cuotas pagadas ni abonos hechos a mano
   * (los abonos automáticos de la parte de cada uno se rehacen con ella).
   */
  private async assertPlanEditable(planId: string, sharedId: string) {
    const paid = await this.prisma.installment.count({ where: { planId, transactionId: { not: null } } });
    if (paid) throw new ConflictException('Ya hay cuotas pagadas: la compra ya no se puede cambiar así. Pídele a quien pagó que lo arregle con abonos o que la registre de nuevo.');
    const manual = await this.prisma.debtPayment.findFirst({
      where: {
        debt: { OR: [{ sharedId }, { shared: { mirrorOfId: sharedId } }] },
        transaction: { is: null },
        mirrorOf: { is: null },
      },
    });
    const manualMirror = await this.prisma.debtPayment.findFirst({
      where: { debt: { OR: [{ sharedId }, { shared: { mirrorOfId: sharedId } }] }, mirrorOf: { is: { transactionId: null } } },
    });
    if (manual || manualMirror) throw new ConflictException('Ya hay abonos registrados en esta compra: no se puede cambiar así.');
  }

  /** El reparto de quien pagó, con las personas de quien lo va a editar. */
  private async splitFor(
    userId: string, payer: User,
    target: Prisma.SharedExpenseGetPayload<{ include: { participants: { include: { person: { include: { linkedUser: true } } } } } }>,
    totalOriginal: Prisma.Decimal,
  ) {
    const payerPerson = await this.people.ensureLinkedPerson(userId, payer);
    const participants = [];
    for (const p of target.participants) {
      let personId: string | null;
      if (p.personId === null) personId = payerPerson.id;
      else if (p.person?.linkedUserId === userId) personId = null;
      else if (p.person?.linkedUser) personId = (await this.people.ensureLinkedPerson(userId, p.person.linkedUser)).id;
      else {
        const same = await this.prisma.person.findFirst({ where: { userId, linkedUserId: null, name: { equals: p.person!.name, mode: 'insensitive' } } });
        personId = same?.id ?? (await this.prisma.person.create({ data: { userId, name: p.person!.name, phone: p.person!.phone } })).id;
      }
      const value = target.splitMode === 'PERCENT' ? p.pct.toFixed(2)
        : target.splitMode === 'AMOUNT' ? (target.totalUsd.isZero() ? '0' : p.amountUsd.div(target.totalUsd).mul(totalOriginal).toFixed(2))
          : undefined;
      participants.push({ personId, ...(value !== undefined ? { value } : {}) });
    }
    return { paidByPersonId: payerPerson.id, mode: target.splitMode, participants };
  }

  /** Cómo está ahora una compra en cuotas. */
  private async currentPlan(sharedId: string, creatorId: string): Promise<NonNullable<Preview['before']>> {
    const s = await this.prisma.sharedExpense.findUniqueOrThrow({
      where: { id: sharedId },
      include: { participants: { include: { person: true } }, plan: true, user: true },
    });
    const creator = await this.prisma.user.findUniqueOrThrow({ where: { id: creatorId } });
    const p = s.plan!;
    return {
      description: p.description, date: p.purchaseDate.toISOString().slice(0, 10), currency: 'USD',
      amount: p.totalUsd.toFixed(2), totalUsd: p.totalUsd.toFixed(2),
      installments: { provider: p.provider, store: p.store, count: p.count, frequency: p.frequency, downPaymentUsd: p.downPaymentUsd.toFixed(2) },
      parts: s.participants.map((x) => ({
        role: x.personId === null ? 'PAYER' : x.person?.linkedUserId === creatorId ? 'CREATOR' : 'OTHER',
        name: x.personId === null ? displayName(s.user) : x.person?.linkedUserId === creatorId ? displayName(creator) : x.person!.name,
        amountUsd: x.amountUsd.toFixed(2), pct: x.pct.toFixed(2),
      })),
    };
  }

  /**
   * Acepta el cambio de una compra en cuotas: se borra y se vuelve a crear con los datos nuevos, en la misma
   * cuenta y categoría; cada familiar conserva la cuenta de la que sale su parte.
   */
  private async rebuildPlan(payerId: string, targetSharedId: string, body: CreatePlanDto, creatorId: string, creatorAccount?: string | null) {
    const plan = await this.prisma.installmentPlan.findFirst({ where: { sharedId: targetSharedId, userId: payerId } });
    if (!plan) throw new NotFoundException('La compra ya no existe');
    await this.assertPlanEditable(plan.id, targetSharedId);
    const keep = await this.prisma.installmentPlan.findMany({
      where: { shared: { mirrorOfId: targetSharedId } }, select: { userId: true, myAccountId: true },
    });
    const accounts = new Map(keep.map((k) => [k.userId, k.myAccountId]));
    if (creatorAccount !== undefined) accounts.set(creatorId, creatorAccount);
    await this.prisma.$transaction(async (db) => {
      await deleteMirrorsOf(db, targetSharedId);
      await db.installmentPlan.delete({ where: { id: plan.id } });
      await db.sharedExpense.delete({ where: { id: targetSharedId } });
    });
    const created = await this.installments.create(payerId, { ...body, accountId: plan.accountId, categoryId: plan.categoryId });
    const sharedId = (created as { sharedId?: string | null }).sharedId ?? null;
    if (sharedId) {
      for (const [uid, acc] of accounts) {
        if (!acc) continue;
        const m = await this.prisma.installmentPlan.findFirst({ where: { userId: uid, shared: { mirrorOfId: sharedId } } });
        if (m) await this.installments.setMyAccount(uid, m.id, { accountId: acc }).catch(() => undefined);
      }
    }
    return sharedId;
  }

  /** El reparto original (de quien pagó) detrás de tu copia de una compra. */
  private async targetOf(userId: string, txId: string) {
    const mine = await this.prisma.transaction.findFirst({
      where: { id: txId, userId },
      include: { shared: { select: { mirrorOfId: true } }, installment: { select: { id: true } } },
    });
    if (!mine?.shared?.mirrorOfId) throw new NotFoundException('Esta compra no es una copia de la de un familiar');
    if (mine.installmentPlanId) throw new BadRequestException('Las compras en cuotas no se pueden cambiar así: pídele que la borre y la registre de nuevo');
    const target = await this.prisma.sharedExpense.findUniqueOrThrow({
      where: { id: mine.shared.mirrorOfId },
      include: { participants: { include: { person: { include: { linkedUser: true } } } }, transaction: true, user: true },
    });
    if (!target.transaction) throw new BadRequestException('Las compras en cuotas no se pueden cambiar así: pídele que la borre y la registre de nuevo');
    return { target, payer: target.user };
  }

  /** Cómo está ahora una compra, con los mismos roles que una propuesta. */
  private async current(sharedId: string, creatorId: string): Promise<NonNullable<Preview['before']>> {
    const s = await this.prisma.sharedExpense.findUniqueOrThrow({
      where: { id: sharedId },
      include: { participants: { include: { person: true } }, transaction: true, user: true },
    });
    const creator = await this.prisma.user.findUniqueOrThrow({ where: { id: creatorId } });
    const t = s.transaction!;
    return {
      description: t.description, date: t.date.toISOString().slice(0, 10), currency: t.originalCurrency,
      amount: t.originalAmount.toFixed(2), totalUsd: s.totalUsd.toFixed(2),
      parts: s.participants.map((p) => ({
        role: p.personId === null ? 'PAYER' : p.person?.linkedUserId === creatorId ? 'CREATOR' : 'OTHER',
        name: p.personId === null ? displayName(s.user) : p.person?.linkedUserId === creatorId ? displayName(creator) : p.person!.name,
        amountUsd: p.amountUsd.toFixed(2), pct: p.pct.toFixed(2),
      })),
    };
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
      const { tags: _t, myAccountId: _m, ...rest } = payload as CreateSharedTxDto & CreatePlanDto & { tags?: string[] };
      const body = { ...rest, split, categoryId, accountId: dto.accountId ?? null };
      if (req.targetSharedId && req.kind === 'INSTALLMENTS') {
        sharedId = await this.rebuildPlan(userId, req.targetSharedId, body as CreatePlanDto, req.fromUserId, payload.myAccountId);
      } else if (req.targetSharedId) {
        // Cambio: se rehace su compra con los datos nuevos, en su cuenta y categoría de siempre
        const current = await this.prisma.transaction.findFirst({ where: { sharedId: req.targetSharedId, userId } });
        if (!current) throw new NotFoundException('La compra ya no existe');
        await this.shared.update(userId, current.id, { ...body, categoryId: current.categoryId, accountId: current.accountId } as CreateSharedTxDto);
        sharedId = req.targetSharedId;
      } else if (req.kind === 'INSTALLMENTS') {
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

    // En cuotas: la parte de quien la mandó sale de la cuenta que eligió al registrarla
    if (req.kind === 'INSTALLMENTS' && !req.targetSharedId && payload.myAccountId && sharedId) {
      const mine = await this.prisma.installmentPlan.findFirst({ where: { userId: req.fromUserId, shared: { mirrorOfId: sharedId } } });
      if (mine) await this.installments.setMyAccount(req.fromUserId, mine.id, { accountId: payload.myAccountId }).catch(() => undefined);
    }

    await this.prisma.$transaction(async (db) => {
      // Si se rehízo la compra, la solicitud ya se fue con ella
      await db.sharedRequest.deleteMany({ where: { id } });
      await db.notification.updateMany({ where: { userId, dedupeKey: `sreq:${id}`, readAt: null }, data: { readAt: new Date() } });
      // A quien la mandó ya le llegó "compartió una compra contigo": se cambia por "la aceptó"
      const mirror = sharedId ? await db.sharedExpense.findFirst({ where: { mirrorOfId: sharedId, userId: req.fromUserId } }) : null;
      const what = preview.description ?? preview.categoryName ?? 'La compra';
      const title = req.targetSharedId
        ? `${displayName(req.toUser)} aceptó el cambio en ${preview.before?.description ?? what}`
        : `${displayName(req.toUser)} aceptó la compra que registraste`;
      const body = req.targetSharedId
        ? `Ahora es ${what}, ${fmt(preview.amount, preview.currency)} del ${preview.date.split('-').reverse().join('/')}. Ya cambió en las dos cuentas.`
        : `${what}, ${fmt(preview.amount, preview.currency)}. Ya está en tus movimientos, con tu deuda con ${displayName(req.toUser)}.`;
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
          ...(req.targetSharedId
            ? {
                title: `${displayName(req.toUser)} rechazó el cambio en ${preview.before?.description ?? what}`,
                body: `La compra quedó como estaba${preview.before ? `: ${fmt(preview.before.amount, preview.before.currency)} del ${preview.before.date.split('-').reverse().join('/')}` : ''}${reason ? `. Te dijo: «${reason}»` : ''}.`,
              }
            : {
                title: `${displayName(req.toUser)} rechazó la compra compartida`,
                body: `${what}, ${fmt(preview.amount, preview.currency)} del ${preview.date.split('-').reverse().join('/')}. No se registró nada${reason ? `. Te dijo: «${reason}»` : ''}.`,
              }),
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
      change: !!r.targetSharedId,
      incoming,
      from: r.fromUser ? { id: r.fromUser.id, name: displayName(r.fromUser) } : null,
      to: r.toUser ? { id: r.toUser.id, name: displayName(r.toUser) } : null,
      createdAt: r.createdAt,
      ...preview,
      // Cada parte vista desde quien la mira: "me" marca la tuya
      parts: preview.parts.map((p) => ({ ...p, me: incoming ? p.role === 'PAYER' : p.role === 'CREATOR' })),
      before: preview.before
        ? { ...preview.before, parts: preview.before.parts.map((p) => ({ ...p, me: incoming ? p.role === 'PAYER' : p.role === 'CREATOR' })) }
        : null,
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

  @Post('change-draft') @HttpCode(200)
  draft(@CurrentUser() u: AuthUser, @Body() dto: ChangeDraftDto) { return this.svc.draft(u.id, dto.txId); }

  @Post('change')
  change(@CurrentUser() u: AuthUser, @Body() dto: ProposeChangeDto) { return this.svc.proposeChange(u.id, dto); }

  @Post('change-plan-draft') @HttpCode(200)
  planDraft(@CurrentUser() u: AuthUser, @Body() dto: PlanDraftDto) { return this.svc.planDraft(u.id, dto.planId); }

  @Post('change-plan')
  changePlan(@CurrentUser() u: AuthUser, @Body() dto: ProposePlanChangeDto) { return this.svc.proposePlanChange(u.id, dto); }

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
