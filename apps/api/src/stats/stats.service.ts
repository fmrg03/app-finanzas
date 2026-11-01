import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { OverviewDto } from './stats.dto';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;
const zero = () => new D(0);

interface Pair { usd: Dec; ves: Dec }
const pair = (): Pair => ({ usd: zero(), ves: zero() });
const add = (p: Pair, usd: Dec, ves: Dec) => { p.usd = p.usd.add(usd); p.ves = p.ves.add(ves); };
const out = (p: Pair) => ({ usd: p.usd.toFixed(2), ves: p.ves.toFixed(2) });

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const monthKey = (d: Date) => toDateOnly(d).slice(0, 7);
const firstOfMonth = (d: Date, shift = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1));
const lastOfMonth = (d: Date, shift = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift + 1, 0));

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async overview(userId: string, q: OverviewDto) {
    const from = parseDateOnly(q.from);
    const to = parseDateOnly(q.to);
    if (to < from) throw new BadRequestException('"to" debe ser igual o posterior a "from"');
    const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;
    if (days > 366) throw new BadRequestException('El período máximo es de un año');

    // Período anterior: el mes calendario previo si el rango es un mes completo; si no, la misma cantidad de días justo antes
    const isFullMonth = from.getUTCDate() === 1 && toDateOnly(to) === toDateOnly(lastOfMonth(from));
    const prevFrom = isFullMonth ? firstOfMonth(from, -1) : addDays(from, -days);
    const prevTo = isFullMonth ? lastOfMonth(from, -1) : addDays(from, -1);
    const seriesFrom = firstOfMonth(to, -(q.months - 1));

    const rangeStart = new Date(Math.min(prevFrom.getTime(), seriesFrom.getTime()));
    const rows = await this.prisma.transaction.findMany({
      where: { userId, date: { gte: rangeStart, lte: to } },
      select: { type: true, date: true, amountUsd: true, amountVes: true, categoryId: true },
    });

    const cats = await this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, color: true, parentId: true, type: true },
    });
    const byId = new Map(cats.map((c) => [c.id, c]));
    const rootOf = (id: string | null) => {
      if (!id) return null;
      const c = byId.get(id);
      return c?.parentId ? (byId.get(c.parentId) ?? c) : (c ?? null);
    };

    const cur = { income: pair(), expense: pair(), count: 0 };
    const prev = { income: pair(), expense: pair(), count: 0 };
    const byCat = new Map<string, Pair & { count: number }>();
    const months = new Map<string, { income: Pair; expense: Pair }>();
    for (let i = 0; i < q.months; i++) months.set(monthKey(firstOfMonth(seriesFrom, i)), { income: pair(), expense: pair() });
    // Gasto acumulado día a día (índice 0 = primer día del período)
    const dailyCur = Array.from({ length: days }, pair);
    const prevDays = Math.round((prevTo.getTime() - prevFrom.getTime()) / DAY) + 1;
    const dailyPrev = Array.from({ length: prevDays }, pair);

    for (const r of rows) {
      const kind = r.type === 'INCOME' ? 'income' : 'expense';
      const m = months.get(monthKey(r.date));
      if (m && r.date >= seriesFrom) add(m[kind], r.amountUsd, r.amountVes);

      if (r.date >= from && r.date <= to) {
        add(cur[kind], r.amountUsd, r.amountVes);
        cur.count++;
        if (kind === 'expense') {
          add(dailyCur[Math.round((r.date.getTime() - from.getTime()) / DAY)], r.amountUsd, r.amountVes);
          const root = rootOf(r.categoryId);
          const key = root?.id ?? 'none';
          const agg = byCat.get(key) ?? { ...pair(), count: 0 };
          add(agg, r.amountUsd, r.amountVes);
          agg.count++;
          byCat.set(key, agg);
        }
      }
      if (r.date >= prevFrom && r.date <= prevTo) {
        add(prev[kind], r.amountUsd, r.amountVes);
        prev.count++;
        if (kind === 'expense') add(dailyPrev[Math.round((r.date.getTime() - prevFrom.getTime()) / DAY)], r.amountUsd, r.amountVes);
      }
    }

    const cumulative = (arr: Pair[]) => {
      const acc = pair();
      return arr.map((p) => { add(acc, p.usd, p.ves); return out(acc); });
    };
    const net = (t: typeof cur) => ({ usd: t.income.usd.sub(t.expense.usd).toFixed(2), ves: t.income.ves.sub(t.expense.ves).toFixed(2) });

    return {
      period: { from: toDateOnly(from), to: toDateOnly(to), days },
      previousPeriod: { from: toDateOnly(prevFrom), to: toDateOnly(prevTo), days: prevDays },
      totals: { income: out(cur.income), expense: out(cur.expense), net: net(cur), count: cur.count },
      previousTotals: { income: out(prev.income), expense: out(prev.expense), net: net(prev), count: prev.count },
      expenseByCategory: [...byCat.entries()]
        .map(([id, v]) => {
          const c = id === 'none' ? null : byId.get(id);
          return { categoryId: c?.id ?? null, name: c?.name ?? 'Sin categoría', color: c?.color ?? '#94a3b8', count: v.count, ...out(v) };
        })
        .sort((a, b) => Number(b.usd) - Number(a.usd)),
      monthly: [...months.entries()].map(([month, v]) => ({
        month,
        income: out(v.income),
        expense: out(v.expense),
        net: { usd: v.income.usd.sub(v.expense.usd).toFixed(2), ves: v.income.ves.sub(v.expense.ves).toFixed(2) },
      })),
      cumulativeExpense: { current: cumulative(dailyCur), previous: cumulative(dailyPrev) },
    };
  }

  /**
   * Patrimonio en USD al cierre de cada mes y cuánto valor perdieron los bolívares guardados.
   * Los saldos en Bs se convierten con la tasa BCV de ese día (o la última anterior).
   */
  async netWorth(userId: string, months = 12) {
    const todayStr = todayLocal();
    const today = parseDateOnly(todayStr);
    const accounts = await this.prisma.account.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const [txs, transfers, rates] = await Promise.all([
      this.prisma.transaction.findMany({ where: { userId, date: { lte: today } }, select: { accountId: true, type: true, date: true, amountUsd: true, amountVes: true } }),
      this.prisma.transfer.findMany({ where: { userId, date: { lte: today } }, select: { fromAccountId: true, toAccountId: true, date: true, fromAmount: true, toAmount: true } }),
      this.prisma.exchangeRate.findMany({ where: { source: 'BCV', date: { lte: today } }, orderBy: { date: 'asc' }, select: { date: true, rate: true } }),
    ]);

    const cur = new Map(accounts.map((a) => [a.id, a.currency]));
    // Cada evento es un cambio de saldo en la moneda de su cuenta
    const events: { accountId: string; date: Date; delta: Dec }[] = [];
    for (const t of txs) {
      const v = cur.get(t.accountId) === 'USD' ? t.amountUsd : t.amountVes;
      events.push({ accountId: t.accountId, date: t.date, delta: t.type === 'INCOME' ? v : v.neg() });
    }
    for (const t of transfers) {
      events.push({ accountId: t.fromAccountId, date: t.date, delta: t.fromAmount.neg() });
      events.push({ accountId: t.toAccountId, date: t.date, delta: t.toAmount });
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    const rateAt = (d: Date): Dec | null => {
      let found: Dec | null = null;
      for (const r of rates) {
        if (r.date > d) break;
        found = r.rate;
      }
      return found ?? rates[0]?.rate ?? null;
    };

    // Cortes: fin de cada mes, y hoy para el mes en curso
    const cuts: Date[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const end = lastOfMonth(today, -i);
      cuts.push(end > today ? today : end);
    }
    const startCut = lastOfMonth(today, -months); // cierre del mes anterior al primero, para la devaluación del primer mes

    const balancesAt = (d: Date) => {
      const bal = new Map(accounts.map((a) => [a.id, new D(a.initialBalance)]));
      for (const e of events) {
        if (e.date > d) break;
        bal.set(e.accountId, bal.get(e.accountId)!.add(e.delta));
      }
      return bal;
    };
    const split = (bal: Map<string, Dec>) => {
      let usd = zero();
      let ves = zero();
      for (const a of accounts) (a.currency === 'USD' ? (usd = usd.add(bal.get(a.id)!)) : (ves = ves.add(bal.get(a.id)!)));
      return { usd, ves };
    };

    let prevCut = startCut;
    let prev = split(balancesAt(startCut));
    const series = cuts.map((cut) => {
      const now = split(balancesAt(cut));
      const r = rateAt(cut);
      const rPrev = rateAt(prevCut);
      const vesInUsd = r ? now.ves.div(r) : null;
      // Bs que tenías al empezar el mes: cuánto valían en USD al inicio y cuánto al cierre
      const devaluation = r && rPrev ? prev.ves.div(rPrev).sub(prev.ves.div(r)) : zero();
      const row = {
        month: monthKey(cut),
        date: toDateOnly(cut),
        rate: r ? r.toFixed(2) : null,
        usd: now.usd.toFixed(2),
        ves: now.ves.toFixed(2),
        vesInUsd: vesInUsd ? vesInUsd.toFixed(2) : null,
        netUsd: (vesInUsd ? now.usd.add(vesInUsd) : now.usd).toFixed(2),
        devaluationUsd: devaluation.toFixed(2),
      };
      prev = now;
      prevCut = cut;
      return row;
    });

    const latestRate = rateAt(today);
    const finalBal = balancesAt(today);
    const accountRows = accounts.map((a) => {
      const b = finalBal.get(a.id)!;
      return {
        id: a.id, name: a.name, type: a.type, currency: a.currency, archived: !!a.archivedAt,
        balance: b.toFixed(2),
        balanceUsd: a.currency === 'USD' ? b.toFixed(2) : latestRate ? b.div(latestRate).toFixed(2) : null,
      };
    });
    const totalDevaluation = series.reduce((acc, m) => acc.add(m.devaluationUsd), zero());
    return {
      today: todayStr,
      rate: latestRate ? latestRate.toFixed(2) : null,
      totalUsd: series[series.length - 1].netUsd,
      accounts: accountRows,
      months: series,
      devaluationTotalUsd: totalDevaluation.toFixed(2),
    };
  }
}
