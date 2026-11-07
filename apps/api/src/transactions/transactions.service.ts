import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { deleteMirrorsOf } from '../shared/mirror-cleanup';
import { Prisma, RateSource, TransactionSource } from '@prisma/client';
import { convertAmounts } from '../common/money.util';
import { parseDateOnly, toDateOnly } from '../common/date.util';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, ListTransactionsDto, UpdateTransactionDto } from './dto/transaction.dto';

const INCLUDE = {
  account: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, color: true, icon: true, parentId: true } },
  receipt: { select: { id: true } },
  shared: {
    select: {
      id: true, splitMode: true, totalUsd: true,
      mirrorOf: { select: { user: { select: { id: true, name: true, email: true } } } },
      paidBy: { select: { id: true, name: true, phone: true } },
      participants: { select: { personId: true, pct: true, amountUsd: true, person: { select: { id: true, name: true, phone: true } } } },
    },
  },
  installmentPlan: { select: { id: true, provider: true, description: true, count: true } },
  installment: { select: { id: true, n: true } },
} satisfies Prisma.TransactionInclude;

export const TX_INCLUDE = INCLUDE;

/** Datos para crear un movimiento desde otros módulos (compartidos, cuotas). */
export interface InternalTxInput {
  accountId: string | null;
  categoryId: string | null;
  type: 'INCOME' | 'EXPENSE';
  date: string;
  description?: string | null;
  tags?: string[];
}

export type Snapshot = Awaited<ReturnType<TransactionsService['snapshot']>>;

export interface CreateOptions {
  source?: TransactionSource;
  externalId?: string;
  rawData?: Prisma.InputJsonValue;
}

const D = Prisma.Decimal;
const MONEY_FIELDS = ['currency', 'amount', 'date', 'rateSource', 'rate'] as const;

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private rates: ExchangeRatesService,
  ) {}

  async list(userId: string, q: ListTransactionsDto) {
    const where = await this.buildWhere(userId, q);
    const [items, total, sums] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({
        by: ['type'],
        where,
        orderBy: { type: 'asc' },
        _sum: { myAmountUsd: true, myAmountVes: true },
      }),
    ]);

    // Totales del filtro completo (no solo de la página), en ambas monedas
    // En compartidos solo cuenta tu parte
    const tot = (t: 'INCOME' | 'EXPENSE') => sums.find((s) => s.type === t)?._sum;
    const inc = tot('INCOME');
    const exp = tot('EXPENSE');
    const z = new Prisma.Decimal(0);
    const totals = {
      incomeUsd: (inc?.myAmountUsd ?? z).toFixed(2),
      incomeVes: (inc?.myAmountVes ?? z).toFixed(2),
      expenseUsd: (exp?.myAmountUsd ?? z).toFixed(2),
      expenseVes: (exp?.myAmountVes ?? z).toFixed(2),
      netUsd: new Prisma.Decimal(inc?.myAmountUsd ?? 0).sub(exp?.myAmountUsd ?? 0).toFixed(2),
      netVes: new Prisma.Decimal(inc?.myAmountVes ?? 0).sub(exp?.myAmountVes ?? 0).toFixed(2),
    };

    return { items: items.map(this.present), total, page: q.page, pageSize: q.pageSize, totals };
  }

  async findOne(userId: string, id: string) {
    const tx = await this.prisma.transaction.findFirst({ where: { id, userId }, include: INCLUDE });
    if (!tx) throw new NotFoundException('Movimiento no encontrado');
    return this.present(tx);
  }

  async create(userId: string, dto: CreateTransactionDto, opts: CreateOptions = {}) {
    await this.assertAccount(userId, dto.accountId);
    const category = await this.assertCategory(userId, dto.categoryId ?? null, dto.type);
    const snapshot = await this.snapshot(userId, {
      currency: dto.currency,
      amount: dto.amount,
      date: dto.date,
      rateSource: dto.rateSource ?? category?.defaultRateSource ?? undefined,
      rate: dto.rate,
    });
    return this.insert(userId, { ...dto, categoryId: dto.categoryId ?? null }, snapshot, opts);
  }

  /** Guarda un movimiento con un snapshot ya calculado. Lo usan también compartidos y cuotas. */
  async insert(
    userId: string,
    input: InternalTxInput,
    snapshot: Snapshot,
    opts: CreateOptions & { sharedId?: string; installmentPlanId?: string } = {},
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const tx = await db.transaction.create({
      data: {
        userId,
        accountId: input.accountId,
        categoryId: input.categoryId,
        type: input.type,
        date: parseDateOnly(input.date),
        description: input.description?.trim() || null,
        tags: normalizeTags(input.tags),
        ...snapshot,
        source: opts.source ?? 'MANUAL',
        externalId: opts.externalId,
        rawData: opts.rawData,
        sharedId: opts.sharedId,
        installmentPlanId: opts.installmentPlanId,
      },
      include: INCLUDE,
    });
    return this.present(tx);
  }

  /**
   * Edita un movimiento. El snapshot de montos/tasa SOLO se recalcula si cambias
   * monto, moneda, fecha, fuente de tasa o tasa; si no, queda congelado.
   */
  async update(userId: string, id: string, dto: UpdateTransactionDto) {
    const current = await this.prisma.transaction.findFirst({ where: { id, userId }, include: { installment: { select: { id: true } } } });
    if (!current) throw new NotFoundException('Movimiento no encontrado');

    const moneyChanged = MONEY_FIELDS.some((k) => dto[k] !== undefined);
    const structural = moneyChanged || dto.accountId !== undefined || (dto.type !== undefined && dto.type !== current.type);
    if (structural && current.sharedId) {
      await this.assertNotMirror(current.sharedId, 'cambiar montos o fecha');
      throw new ConflictException('Es un movimiento compartido: cambia montos, cuenta o fecha desde su reparto.');
    }
    if (structural && current.installmentPlanId && !current.installment) {
      throw new ConflictException('Es la inicial de una compra en cuotas: para cambiar el monto, elimina la compra y regístrala de nuevo.');
    }
    if (structural && current.installment && !current.accountId) {
      throw new ConflictException('Esta cuota la registra sola la compra en cuotas (la pagó otra persona).');
    }
    if (dto.type !== undefined && dto.type !== current.type && current.installmentPlanId) {
      throw new ConflictException('Un pago de cuotas siempre es un gasto.');
    }

    const type = dto.type ?? current.type;
    const categoryId = dto.categoryId === undefined ? current.categoryId : dto.categoryId;
    if (dto.accountId) await this.assertAccount(userId, dto.accountId);
    if (dto.type || dto.categoryId !== undefined) await this.assertCategory(userId, categoryId, type);

    let snapshot = {};
    if (moneyChanged) {
      const date = dto.date ?? toDateOnly(current.date);
      const rateSource = dto.rateSource ?? current.rateSource;
      // Si solo cambió algo distinto de la tasa y la fuente es MANUAL, se conserva la tasa manual previa
      const rate = dto.rate ?? (rateSource === 'MANUAL' && !dto.rateSource ? current.rateUsed.toString() : undefined);
      snapshot = await this.snapshot(userId, {
        currency: dto.currency ?? current.originalCurrency,
        amount: dto.amount ?? current.originalAmount.toString(),
        date,
        rateSource,
        rate,
        sharePct: current.sharePct,
      });
    }

    const tx = await this.prisma.transaction.update({
      where: { id },
      data: {
        accountId: dto.accountId,
        categoryId,
        type,
        ...(dto.date ? { date: parseDateOnly(dto.date) } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        ...(dto.tags !== undefined ? { tags: normalizeTags(dto.tags) } : {}),
        ...snapshot,
      },
      include: INCLUDE,
    });
    return this.present(tx);
  }

  async remove(userId: string, id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId },
      select: { id: true, accountId: true, sharedId: true, installmentPlanId: true, installment: { select: { id: true } } },
    });
    if (!tx) throw new NotFoundException('Movimiento no encontrado');
    if (tx.installmentPlanId && !tx.installment) {
      throw new ConflictException('Es la inicial de una compra en cuotas: elimina la compra completa desde Deudas → Cuotas.');
    }
    if (tx.installment && !tx.accountId) {
      throw new ConflictException('Esta cuota la registra sola la compra en cuotas (la pagó otra persona).');
    }
    if (tx.sharedId) {
      await this.assertNotMirror(tx.sharedId, 'borrarla');
      // Borrar un compartido borra también las deudas que generó y las copias de los familiares, salvo que ya tengan abonos
      await this.assertNoPayments(tx.sharedId);
      const sharedId = tx.sharedId;
      await this.prisma.$transaction(async (db) => {
        await deleteMirrorsOf(db, sharedId);
        await db.transaction.delete({ where: { id } });
        await db.sharedExpense.delete({ where: { id: sharedId } });
      });
      return;
    }
    await this.prisma.transaction.delete({ where: { id } });
  }

  /** Una copia de un reparto que registró otro familiar no se cambia ni se borra desde aquí. */
  async assertNotMirror(sharedId: string, action: string) {
    const s = await this.prisma.sharedExpense.findUnique({
      where: { id: sharedId },
      select: { mirrorOf: { select: { user: { select: { name: true, email: true } } } } },
    });
    if (s?.mirrorOf) {
      const who = s.mirrorOf.user.name?.trim() || s.mirrorOf.user.email.split('@')[0];
      throw new ConflictException(`Esta compra la registró ${who}. Para ${action}, pídele a ${who} que lo haga desde su cuenta.`);
    }
  }

  /** Un reparto con abonos ya registrados no se puede rehacer ni borrar sin perder esos abonos. */
  async assertNoPayments(sharedId: string) {
    const paid = await this.prisma.debtPayment.findFirst({ where: { debt: { sharedId } }, select: { debt: { select: { person: true } } } });
    if (paid) {
      throw new ConflictException(`${paid.debt.person} ya registró abonos de esta compra. Borra esos abonos en Deudas antes de cambiar o eliminar el reparto.`);
    }
  }

  /** Todas las etiquetas usadas, para autocompletar. */
  async tags(userId: string) {
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) AS count FROM "Transaction", unnest(tags) AS tag
      WHERE "userId" = ${userId} GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 200`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  // ---------------------------------------------------------------------------

  /**
   * Calcula montos en ambas monedas con la tasa que corresponda.
   * sharePct: tu porcentaje si es compartido; myAmountUsd lo fija exacto (el reparto ya redondeado).
   */
  async snapshot(
    userId: string,
    p: {
      currency: 'USD' | 'VES'; amount: string; date: string; rateSource?: RateSource; rate?: string;
      sharePct?: Prisma.Decimal | null; myAmountUsd?: Prisma.Decimal;
    },
  ) {
    const amount = new Prisma.Decimal(p.amount);
    if (amount.lte(0)) throw new BadRequestException('El monto debe ser mayor que cero (el tipo indica si es ingreso o egreso)');
    if (amount.decimalPlaces() > 2) throw new BadRequestException('El monto admite máximo 2 decimales');

    let rateSource = p.rateSource;
    if (!rateSource) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { defaultRateSource: true } });
      rateSource = user.defaultRateSource;
    }

    let rateUsed: Prisma.Decimal;
    let exchangeRateId: string | null = null;
    if (p.rate !== undefined) {
      // Tasa explícita: se respeta tal cual (sirve para tasa del comercio, efectivo, etc.)
      rateUsed = new Prisma.Decimal(p.rate);
      if (rateUsed.lte(0)) throw new BadRequestException('La tasa debe ser mayor que cero');
    } else if (rateSource === 'MANUAL') {
      throw new BadRequestException('Con rateSource = MANUAL debes indicar la tasa en el campo "rate"');
    } else {
      const resolved = await this.rates.resolve(p.date, rateSource);
      rateUsed = resolved.rate.rate;
      exchangeRateId = resolved.rate.id;
    }

    const { amountUsd, amountVes } = convertAmounts(p.currency, amount, rateUsed);
    return {
      originalCurrency: p.currency,
      originalAmount: amount,
      amountUsd,
      amountVes,
      ...myShare(amountUsd, amountVes, p.sharePct ?? null, p.myAmountUsd),
      rateUsed,
      // Una tasa escrita a mano se registra como MANUAL aunque se haya pedido otra fuente
      rateSource: p.rate !== undefined ? ('MANUAL' as const) : rateSource,
      exchangeRateId,
    };
  }

  async assertAccount(userId: string, accountId: string) {
    const acc = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!acc) throw new BadRequestException('La cuenta no existe');
    if (acc.archivedAt) throw new BadRequestException('La cuenta está archivada');
    return acc;
  }

  async assertCategory(userId: string, categoryId: string | null, type: 'INCOME' | 'EXPENSE') {
    if (!categoryId) return null;
    const cat = await this.prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!cat) throw new BadRequestException('La categoría no existe');
    if (cat.type !== type) {
      throw new BadRequestException(`La categoría "${cat.name}" es de ${cat.type === 'INCOME' ? 'ingresos' : 'egresos'}`);
    }
    return cat;
  }

  async buildWhere(userId: string, q: ListTransactionsDto): Promise<Prisma.TransactionWhereInput> {
    const where: Prisma.TransactionWhereInput = { userId };
    if (q.from || q.to) {
      where.date = {
        ...(q.from ? { gte: parseDateOnly(q.from) } : {}),
        ...(q.to ? { lte: parseDateOnly(q.to) } : {}),
      };
    }
    if (q.type) where.type = q.type;
    if (q.source) where.source = q.source;
    if (q.accountId?.length) where.accountId = { in: q.accountId };
    if (q.tag) where.tags = { has: q.tag.trim().toLowerCase() };
    if (q.q) where.description = { contains: q.q, mode: 'insensitive' };

    if (q.uncategorized === 'none') {
      where.categoryId = null;
    } else if (q.categoryId?.length) {
      // Filtrar por una categoría padre incluye sus subcategorías
      const children = await this.prisma.category.findMany({
        where: { userId, parentId: { in: q.categoryId } },
        select: { id: true },
      });
      where.categoryId = { in: [...q.categoryId, ...children.map((c) => c.id)] };
    }
    return where;
  }

  /** Formato de salida: fecha como YYYY-MM-DD y decimales como string (sin perder precisión). */
  present = <T extends { date: Date }>(tx: T) => ({ ...tx, date: toDateOnly(tx.date) });
}

/** Tu parte de un movimiento. Sin porcentaje es el monto completo. */
export function myShare(amountUsd: Prisma.Decimal, amountVes: Prisma.Decimal, sharePct: Prisma.Decimal | null, exactUsd?: Prisma.Decimal) {
  if (sharePct === null) return { sharePct: null, myAmountUsd: amountUsd, myAmountVes: amountVes };
  const usd = exactUsd ?? amountUsd.mul(sharePct).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
  const ves = amountUsd.isZero() ? new D(0) : amountVes.mul(usd).div(amountUsd).toDecimalPlaces(2, D.ROUND_HALF_UP);
  return { sharePct, myAmountUsd: usd, myAmountVes: ves };
}

function normalizeTags(tags?: string[]) {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
