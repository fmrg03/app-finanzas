import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const Z = () => new D(0);

/**
 * Ganancia por cambio.
 *
 * Cada cuenta en Bs lleva un "pozo": cuántos bolívares tiene y cuántos dólares le costaron.
 * Un cambio de USD a Bs, un ingreso en Bs o un abono recibido suman al pozo con su costo; un gasto,
 * una transferencia o un abono pagado sacan bolívares al costo promedio.
 * Si un gasto quedó registrado en USD a una tasa (la BCV, normalmente) y esos bolívares costaron menos,
 * la diferencia es lo que te rindió el cambio. Igual al vender bolívares por dólares.
 */
export interface FxEvent {
  date: string;
  accountId: string;
  kind: 'EXPENSE' | 'SELL' | 'DEBT';
  bs: Dec;
  /** Lo que vale según lo registrado (el gasto en USD, o los dólares recibidos al vender) */
  valueUsd: Dec;
  /** Lo que costaron esos bolívares */
  costUsd: Dec;
  gainUsd: Dec;
}

interface Pool { bs: Dec; cost: Dec }

@Injectable()
export class FxService {
  constructor(private prisma: PrismaService) {}

  /** Recorre toda la historia de las cuentas en Bs del usuario. */
  async replay(userId: string) {
    const accounts = await this.prisma.account.findMany({ where: { userId, currency: 'VES' } });
    const pools = new Map<string, Pool>(accounts.map((a) => [a.id, { bs: Z(), cost: Z() }]));
    const events: FxEvent[] = [];
    if (!accounts.length) return { pools, events, avgRate: () => null as Dec | null };
    const ids = accounts.map((a) => a.id);

    const [txs, transfers, pays, bcv] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, accountId: { in: ids } },
        select: { id: true, type: true, date: true, createdAt: true, accountId: true, amountUsd: true, amountVes: true },
      }),
      this.prisma.transfer.findMany({
        where: { userId, OR: [{ fromAccountId: { in: ids } }, { toAccountId: { in: ids } }] },
        include: { fromAccount: { select: { currency: true } }, toAccount: { select: { currency: true } } },
      }),
      this.prisma.debtPayment.findMany({
        where: { accountId: { in: ids }, transactionId: null, debt: { userId } },
        select: { date: true, createdAt: true, accountId: true, amount: true, accountAmount: true, debt: { select: { direction: true, currency: true } } },
      }),
      this.prisma.exchangeRate.findMany({ where: { source: 'BCV' }, orderBy: { date: 'asc' }, select: { date: true, rate: true } }),
    ]);
    // BCV del día o el último anterior (o el primero que haya)
    const bcvOn = (d: Date) => {
      let r: Dec | null = null;
      for (const x of bcv) { if (x.date <= d) r = x.rate; else break; }
      return r ?? bcv[0]?.rate ?? null;
    };

    // pri: en un mismo día, primero lo que entra a las cuentas en Bs y luego lo que sale
    type Step = { date: Date; pri: number; at: Date; run: () => void };
    const steps: Step[] = [];
    const take = (pool: Pool, bs: Dec, fallbackUsd: Dec) => {
      // Sale al costo promedio lo que hay en el pozo; si no alcanza, el resto al valor registrado
      const covered = D.min(bs, D.max(pool.bs, 0));
      const avg = pool.bs.gt(0) ? pool.cost.div(pool.bs) : Z();
      const rest = bs.sub(covered);
      const cost = covered.mul(avg).add(bs.isZero() ? Z() : rest.mul(fallbackUsd.div(bs)));
      pool.bs = pool.bs.sub(bs);
      pool.cost = pool.cost.sub(cost);
      // En rojo (tarjeta o sobregiro) el pozo solo recuerda cuántos Bs faltan
      if (pool.bs.lte(0)) pool.cost = Z();
      return cost;
    };
    // Lo que entra primero tapa el hueco si la cuenta estaba en rojo; el resto entra con su costo
    const put = (pool: Pool, bs: Dec, cost: Dec) => {
      if (bs.lte(0)) return;
      const hole = pool.bs.lt(0) ? D.min(pool.bs.neg(), bs) : Z();
      const rest = bs.sub(hole);
      pool.bs = pool.bs.add(bs);
      pool.cost = pool.cost.add(rest.isZero() ? 0 : cost.mul(rest).div(bs));
    };

    for (const a of accounts) {
      if (new D(a.initialBalance).isZero()) continue;
      steps.push({
        date: new Date(Date.UTC(a.createdAt.getUTCFullYear(), a.createdAt.getUTCMonth(), a.createdAt.getUTCDate())), pri: -1, at: new Date(0),
        run: () => {
          const r = bcvOn(a.createdAt);
          const ib = new D(a.initialBalance);
          if (ib.gt(0)) put(pools.get(a.id)!, ib, r ? ib.div(r) : Z());
          else pools.get(a.id)!.bs = ib;
        },
      });
    }
    for (const t of txs) {
      const pool = () => pools.get(t.accountId!)!;
      steps.push({
        date: t.date, pri: t.type === 'INCOME' ? 0 : 2, at: t.createdAt,
        run: () => {
          if (t.type === 'INCOME') { put(pool(), t.amountVes, t.amountUsd); return; }
          const cost = take(pool(), t.amountVes, t.amountUsd);
          events.push({ date: toDateOnly(t.date), accountId: t.accountId!, kind: 'EXPENSE', bs: t.amountVes, valueUsd: t.amountUsd, costUsd: cost, gainUsd: t.amountUsd.sub(cost) });
        },
      });
    }
    for (const t of transfers) {
      steps.push({
        date: t.date, pri: t.fromAccount.currency === 'VES' ? 1 : 0, at: t.createdAt,
        run: () => {
          const fromVes = t.fromAccount.currency === 'VES';
          const toVes = t.toAccount.currency === 'VES';
          let cost: Dec = t.fromAmount; // de USD: lo que salió en dólares
          if (fromVes) {
            const r = bcvOn(t.date);
            cost = take(pools.get(t.fromAccountId)!, t.fromAmount, r ? t.fromAmount.div(r) : Z());
            // Vendiste bolívares por dólares
            if (!toVes) {
              events.push({ date: toDateOnly(t.date), accountId: t.fromAccountId, kind: 'SELL', bs: t.fromAmount, valueUsd: t.toAmount, costUsd: cost, gainUsd: t.toAmount.sub(cost) });
            }
          }
          if (toVes) put(pools.get(t.toAccountId)!, t.toAmount, cost);
        },
      });
    }
    for (const p of pays) {
      steps.push({
        date: p.date, pri: p.debt.direction === 'OWED_TO_ME' ? 0 : 2, at: p.createdAt,
        run: () => {
          const pool = pools.get(p.accountId!)!;
          const bs = p.accountAmount ?? p.amount;
          // Valor en USD del abono: exacto si la deuda es en dólares; si es en Bs, a BCV del día
          const r = bcvOn(p.date);
          const usd = p.debt.currency === 'USD' ? p.amount : r ? bs.div(r) : Z();
          if (p.debt.direction === 'OWED_TO_ME') { put(pool, bs, usd); return; }
          const cost = take(pool, bs, usd);
          // Pagar una deuda en dólares con bolívares más baratos también rinde
          if (p.debt.currency === 'USD') {
            events.push({ date: toDateOnly(p.date), accountId: p.accountId!, kind: 'DEBT', bs, valueUsd: usd, costUsd: cost, gainUsd: usd.sub(cost) });
          }
        },
      });
    }
    // Si cambias y gastas el mismo día, el gasto sale de lo que cambiaste aunque lo hayas anotado antes
    steps.sort((a, b) => a.date.getTime() - b.date.getTime() || a.pri - b.pri || a.at.getTime() - b.at.getTime());
    for (const s of steps) s.run();

    /** Tasa promedio (Bs por USD) a la que compraste los bolívares que quedan en la cuenta. */
    const avgRate = (accountId: string) => {
      const p = pools.get(accountId);
      return p && p.bs.gt(0) && p.cost.gt(0) ? p.bs.div(p.cost) : null;
    };
    return { pools, events, avgRate };
  }

  /** Ganancia por cambio de un período, en total y por cuenta. */
  async period(userId: string, from: string, to: string, accountIds?: string[]) {
    const { events } = await this.replay(userId);
    const f = parseDateOnly(from).getTime();
    const t = parseDateOnly(to).getTime();
    const inRange = events.filter((e) => {
      const d = parseDateOnly(e.date).getTime();
      return d >= f && d <= t && (!accountIds?.length || accountIds.includes(e.accountId));
    });
    const sum = (k: 'valueUsd' | 'costUsd' | 'gainUsd', kinds?: FxEvent['kind'][]) =>
      inRange.filter((e) => !kinds || kinds.includes(e.kind)).reduce((a, e) => a.add(e[k]), Z());
    // En Bs: cada ganancia a la tasa de su propio gasto (la registrada)
    const gainVes = inRange.reduce((a, e) => (e.valueUsd.isZero() ? a : a.add(e.gainUsd.mul(e.bs).div(e.valueUsd))), Z());
    return {
      gainUsd: sum('gainUsd').toDecimalPlaces(2),
      gainVes: gainVes.toDecimalPlaces(2),
      /** Lo gastado en Bs a la tasa registrada, y lo que te costó de verdad */
      spentUsd: sum('valueUsd', ['EXPENSE']).toDecimalPlaces(2),
      spentCostUsd: sum('costUsd', ['EXPENSE']).toDecimalPlaces(2),
      count: inRange.length,
    };
  }

  /** Tasa promedio de compra de cada cuenta en Bs con saldo. */
  async avgRates(userId: string) {
    const { pools, avgRate } = await this.replay(userId);
    return new Map([...pools.keys()].map((id) => [id, avgRate(id)?.toDecimalPlaces(2) ?? null]));
  }
}

@Global()
@Module({ providers: [FxService], exports: [FxService] })
export class FxModule {}
