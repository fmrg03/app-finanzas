import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RateSource, TransactionSource } from '@prisma/client';
import { convertAmounts } from '../common/money.util';
import { parseDateOnly, toDateOnly } from '../common/date.util';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto, ListTransactionsDto, UpdateTransactionDto } from './dto/transaction.dto';

const INCLUDE = {
  account: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, color: true, icon: true, parentId: true } },
} satisfies Prisma.TransactionInclude;

export interface CreateOptions {
  source?: TransactionSource;
  externalId?: string;
  rawData?: Prisma.InputJsonValue;
}

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
        _sum: { amountUsd: true, amountVes: true },
      }),
    ]);

    // Totales del filtro completo (no solo de la página), en ambas monedas
    const tot = (t: 'INCOME' | 'EXPENSE') => sums.find((s) => s.type === t)?._sum;
    const inc = tot('INCOME');
    const exp = tot('EXPENSE');
    const z = new Prisma.Decimal(0);
    const totals = {
      incomeUsd: (inc?.amountUsd ?? z).toFixed(2),
      incomeVes: (inc?.amountVes ?? z).toFixed(2),
      expenseUsd: (exp?.amountUsd ?? z).toFixed(2),
      expenseVes: (exp?.amountVes ?? z).toFixed(2),
      netUsd: new Prisma.Decimal(inc?.amountUsd ?? 0).sub(exp?.amountUsd ?? 0).toFixed(2),
      netVes: new Prisma.Decimal(inc?.amountVes ?? 0).sub(exp?.amountVes ?? 0).toFixed(2),
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
    const snapshot = await this.computeSnapshot(userId, {
      currency: dto.currency,
      amount: dto.amount,
      date: dto.date,
      rateSource: dto.rateSource ?? category?.defaultRateSource ?? undefined,
      rate: dto.rate,
    });

    const tx = await this.prisma.transaction.create({
      data: {
        userId,
        accountId: dto.accountId,
        categoryId: dto.categoryId ?? null,
        type: dto.type,
        date: parseDateOnly(dto.date),
        description: dto.description?.trim() || null,
        tags: normalizeTags(dto.tags),
        ...snapshot,
        source: opts.source ?? 'MANUAL',
        externalId: opts.externalId,
        rawData: opts.rawData,
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
    const current = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!current) throw new NotFoundException('Movimiento no encontrado');

    const type = dto.type ?? current.type;
    const categoryId = dto.categoryId === undefined ? current.categoryId : dto.categoryId;
    if (dto.accountId) await this.assertAccount(userId, dto.accountId);
    if (dto.type || dto.categoryId !== undefined) await this.assertCategory(userId, categoryId, type);

    const moneyChanged = ['currency', 'amount', 'date', 'rateSource', 'rate'].some(
      (k) => dto[k as keyof UpdateTransactionDto] !== undefined,
    );
    let snapshot = {};
    if (moneyChanged) {
      const date = dto.date ?? toDateOnly(current.date);
      const rateSource = dto.rateSource ?? current.rateSource;
      // Si solo cambió algo distinto de la tasa y la fuente es MANUAL, se conserva la tasa manual previa
      const rate = dto.rate ?? (rateSource === 'MANUAL' && !dto.rateSource ? current.rateUsed.toString() : undefined);
      snapshot = await this.computeSnapshot(userId, {
        currency: dto.currency ?? current.originalCurrency,
        amount: dto.amount ?? current.originalAmount.toString(),
        date,
        rateSource,
        rate,
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
    const tx = await this.prisma.transaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!tx) throw new NotFoundException('Movimiento no encontrado');
    await this.prisma.transaction.delete({ where: { id } });
  }

  /** Todas las etiquetas usadas, para autocompletar. */
  async tags(userId: string) {
    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) AS count FROM "Transaction", unnest(tags) AS tag
      WHERE "userId" = ${userId} GROUP BY tag ORDER BY count DESC, tag ASC LIMIT 200`;
    return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  // ---------------------------------------------------------------------------

  private async computeSnapshot(
    userId: string,
    p: { currency: 'USD' | 'VES'; amount: string; date: string; rateSource?: RateSource; rate?: string },
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
      rateUsed,
      // Una tasa escrita a mano se registra como MANUAL aunque se haya pedido otra fuente
      rateSource: p.rate !== undefined ? ('MANUAL' as const) : rateSource,
      exchangeRateId,
    };
  }

  private async assertAccount(userId: string, accountId: string) {
    const acc = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!acc) throw new BadRequestException('La cuenta no existe');
    if (acc.archivedAt) throw new BadRequestException('La cuenta está archivada');
    return acc;
  }

  private async assertCategory(userId: string, categoryId: string | null, type: 'INCOME' | 'EXPENSE') {
    if (!categoryId) return null;
    const cat = await this.prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!cat) throw new BadRequestException('La categoría no existe');
    if (cat.type !== type) {
      throw new BadRequestException(`La categoría "${cat.name}" es de ${cat.type === 'INCOME' ? 'ingresos' : 'egresos'}`);
    }
    return cat;
  }

  private async buildWhere(userId: string, q: ListTransactionsDto): Promise<Prisma.TransactionWhereInput> {
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
  private present = <T extends { date: Date }>(tx: T) => ({ ...tx, date: toDateOnly(tx.date) });
}

function normalizeTags(tags?: string[]) {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
