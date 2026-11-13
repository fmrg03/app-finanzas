import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { BudgetsService } from '../budgets/budgets.service';
import { FxService } from '../fx/fx.module';
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
  constructor(private prisma: PrismaService, private fx: FxService, private budgets: BudgetsService) {}

  /**
   * Inflación personal: cuánto cuesta cada mes tu "canasta" (las categorías de gasto de siempre), en USD y en Bs,
   * comparado con hace 1, 3 y 12 meses, y contra lo que subió el dólar BCV.
   * Si no eliges categorías, la canasta son las categorías principales con gasto en al menos 3 de cada 4 meses cerrados.
   */
  async inflation(userId: string, months = 12, categoryIds?: string[]) {
    const today = parseDateOnly(todayLocal());
    const curStart = firstOfMonth(today);
    // Un mes extra para poder comparar el último mes cerrado con el de hace `months` meses
    const start = firstOfMonth(today, -months - 1);
    const [cats, rows, rates] = await Promise.all([
      this.prisma.category.findMany({ where: { userId, type: 'EXPENSE' }, select: { id: true, name: true, color: true, parentId: true } }),
      this.prisma.transaction.findMany({
        where: { userId, type: 'EXPENSE', date: { gte: start, lte: today } },
        select: { date: true, categoryId: true, myAmountUsd: true, myAmountVes: true },
      }),
      this.prisma.exchangeRate.findMany({ where: { source: 'BCV', date: { lte: today } }, orderBy: { date: 'asc' }, select: { date: true, rate: true } }),
    ]);
    const top = new Map(cats.map((c) => [c.id, c.parentId ?? c.id]));
    const keys = Array.from({ length: months + 2 }, (_, i) => monthKey(firstOfMonth(start, i)));
    const closed = keys.slice(0, -1);
    // Gasto por categoría principal y mes
    const by = new Map<string, Map<string, Pair>>();
    for (const r of rows) {
      const c = r.categoryId ? top.get(r.categoryId) : undefined;
      if (!c) continue;
      const m = by.get(c) ?? new Map<string, Pair>();
      const k = monthKey(r.date);
      const p = m.get(k) ?? pair();
      add(p, r.myAmountUsd, r.myAmountVes);
      m.set(k, p);
      by.set(c, m);
    }
    const roots = cats.filter((c) => !c.parentId);
    const usual = roots.filter((c) => {
      const m = by.get(c.id);
      return !!m && closed.length > 0 && closed.filter((k) => m.get(k)?.usd.gt(0)).length >= Math.max(2, Math.ceil(closed.length * 0.75));
    });
    const valid = new Set(roots.map((c) => c.id));
    const basket = categoryIds?.length ? categoryIds.filter((id) => valid.has(id)) : usual.map((c) => c.id);
    const inBasket = new Set(basket);

    // BCV al cierre de cada mes (o hoy en el mes en curso)
    const bcvAt = (d: Date) => {
      let r: Dec | null = null;
      for (const x of rates) { if (x.date <= d) r = x.rate; else break; }
      return r;
    };
    const series = keys.map((k) => {
      const t = pair();
      for (const id of basket) { const p = by.get(id)?.get(k); if (p) add(t, p.usd, p.ves); }
      const end = k === monthKey(today) ? today : lastOfMonth(parseDateOnly(`${k}-01`));
      return { month: k, partial: k === monthKey(curStart), ...out(t), bcv: bcvAt(end)?.toFixed(2) ?? null };
    });
    const last = series[series.length - 2];
    const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
    const ago = (n: number) => series[series.length - 2 - n];
    const vs = (n: number) => {
      const o = ago(n);
      if (!last || !o) return null;
      return {
        month: o.month,
        usd: pct(Number(last.usd), Number(o.usd)),
        ves: pct(Number(last.ves), Number(o.ves)),
        bcv: last.bcv && o.bcv ? pct(Number(last.bcv), Number(o.bcv)) : null,
      };
    };
    // Promedio de 3 meses para que un mes raro no domine la comparación
    const avg3 = (endIdx: number, f: 'usd' | 'ves') => {
      const xs = series.slice(Math.max(0, endIdx - 2), endIdx + 1).map((x) => Number(x[f]));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    };
    const li = series.length - 2;
    return {
      months,
      basket,
      categories: roots
        .filter((c) => by.has(c.id))
        .map((c) => {
          const m = by.get(c.id)!;
          const cur = m.get(last?.month ?? '')?.usd.toNumber() ?? 0;
          const yearAgo = m.get(ago(12)?.month ?? '')?.usd.toNumber() ?? 0;
          const threeAgo = m.get(ago(3)?.month ?? '')?.usd.toNumber() ?? 0;
          return {
            id: c.id, name: c.name, color: c.color, inBasket: inBasket.has(c.id), usual: usual.some((u) => u.id === c.id),
            lastUsd: cur.toFixed(2), vs3: pct(cur, threeAgo), vs12: pct(cur, yearAgo),
          };
        })
        .sort((a, b) => Number(b.lastUsd) - Number(a.lastUsd)),
      series,
      lastClosed: last?.month ?? null,
      vsPrev: vs(1), vs3: vs(3), vs12: vs(12),
      trend3: li >= 5 ? { usd: pct(avg3(li, 'usd'), avg3(li - 3, 'usd')), ves: pct(avg3(li, 'ves'), avg3(li - 3, 'ves')) } : null,
    };
  }

  /**
   * Resumen de un mes cerrado (por defecto el anterior): lo que entró, salió y quedó, contra el mes previo,
   * las categorías que más pesaron, los presupuestos y los gastos más grandes.
   */
  async monthSummary(userId: string, month?: string) {
    const today = todayLocal();
    const ym = month ?? toDateOnly(firstOfMonth(parseDateOnly(today), -1)).slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new BadRequestException('El mes va como AAAA-MM');
    if (ym > today.slice(0, 7)) throw new BadRequestException('Ese mes todavía no llega');
    const from = parseDateOnly(`${ym}-01`);
    const to = lastOfMonth(from);
    const pFrom = firstOfMonth(from, -1);
    const [cur, prev, budgets, biggest] = await Promise.all([
      this.overview(userId, { from: toDateOnly(from), to: toDateOnly(to), months: 6 }),
      this.overview(userId, { from: toDateOnly(pFrom), to: toDateOnly(lastOfMonth(pFrom)), months: 1 }),
      this.budgets.status(userId, ym),
      this.prisma.transaction.findMany({
        where: { userId, type: 'EXPENSE', date: { gte: from, lte: to } },
        orderBy: { myAmountUsd: 'desc' }, take: 3,
        select: { id: true, date: true, description: true, myAmountUsd: true, originalAmount: true, originalCurrency: true, category: { select: { name: true } } },
      }),
    ]);
    const prevCat = new Map(prev.expenseByCategory.map((c) => [c.categoryId, c.usd]));
    const inc = Number(cur.totals.income.usd);
    return {
      month: ym,
      isComplete: toDateOnly(to) < today,
      totals: cur.totals,
      previousTotals: prev.totals,
      savingsRate: inc > 0 ? Math.round((Number(cur.totals.net.usd) / inc) * 100) : null,
      categories: cur.expenseByCategory.slice(0, 5).map((c) => ({ ...c, previousUsd: prevCat.get(c.categoryId) ?? '0.00' })),
      budgets: budgets.items.map((b) => ({ name: b.name, amountUsd: b.amountUsd, spentUsd: b.spentUsd })),
      biggest: biggest.map((t) => ({
        id: t.id, date: toDateOnly(t.date), description: t.description, category: t.category?.name ?? null,
        usd: t.myAmountUsd.toFixed(2), originalAmount: t.originalAmount.toFixed(2), originalCurrency: t.originalCurrency,
      })),
      monthly: cur.monthly,
    };
  }

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
      select: { type: true, date: true, myAmountUsd: true, myAmountVes: true, categoryId: true },
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
      if (m && r.date >= seriesFrom) add(m[kind], r.myAmountUsd, r.myAmountVes);

      if (r.date >= from && r.date <= to) {
        add(cur[kind], r.myAmountUsd, r.myAmountVes);
        cur.count++;
        if (kind === 'expense') {
          add(dailyCur[Math.round((r.date.getTime() - from.getTime()) / DAY)], r.myAmountUsd, r.myAmountVes);
          const root = rootOf(r.categoryId);
          const key = root?.id ?? 'none';
          const agg = byCat.get(key) ?? { ...pair(), count: 0 };
          add(agg, r.myAmountUsd, r.myAmountVes);
          agg.count++;
          byCat.set(key, agg);
        }
      }
      if (r.date >= prevFrom && r.date <= prevTo) {
        add(prev[kind], r.myAmountUsd, r.myAmountVes);
        prev.count++;
        if (kind === 'expense') add(dailyPrev[Math.round((r.date.getTime() - prevFrom.getTime()) / DAY)], r.myAmountUsd, r.myAmountVes);
      }
    }

    const cumulative = (arr: Pair[]) => {
      const acc = pair();
      return arr.map((p) => { add(acc, p.usd, p.ves); return out(acc); });
    };
    // Ganancia por cambio: lo que te rindieron los bolívares comprados a mejor tasa que la registrada en los gastos
    const fxCur = await this.fx.period(userId, toDateOnly(from), toDateOnly(to));
    const fxPrev = await this.fx.period(userId, toDateOnly(prevFrom), toDateOnly(prevTo));
    const net = (t: typeof cur, g: typeof fxCur) => ({
      usd: t.income.usd.sub(t.expense.usd).add(g.gainUsd).toFixed(2),
      ves: t.income.ves.sub(t.expense.ves).add(g.gainVes).toFixed(2),
    });
    const fxOut = (g: typeof fxCur) => ({
      usd: g.gainUsd.toFixed(2), ves: g.gainVes.toFixed(2), spentUsd: g.spentUsd.toFixed(2), spentCostUsd: g.spentCostUsd.toFixed(2),
    });

    return {
      period: { from: toDateOnly(from), to: toDateOnly(to), days },
      previousPeriod: { from: toDateOnly(prevFrom), to: toDateOnly(prevTo), days: prevDays },
      totals: { income: out(cur.income), expense: out(cur.expense), fxGain: fxOut(fxCur), net: net(cur, fxCur), count: cur.count },
      previousTotals: { income: out(prev.income), expense: out(prev.expense), fxGain: fxOut(fxPrev), net: net(prev, fxPrev), count: prev.count },
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
    const [txs, transfers, rates, debtPayments, pendingInst] = await Promise.all([
      this.prisma.transaction.findMany({ where: { userId, accountId: { not: null }, date: { lte: today } }, select: { accountId: true, type: true, date: true, amountUsd: true, amountVes: true } }),
      this.prisma.transfer.findMany({ where: { userId, date: { lte: today } }, select: { fromAccountId: true, toAccountId: true, date: true, fromAmount: true, toAmount: true } }),
      this.prisma.exchangeRate.findMany({ where: { source: 'BCV', date: { lte: today } }, orderBy: { date: 'asc' }, select: { date: true, rate: true } }),
      this.prisma.debtPayment.findMany({
        where: { accountId: { not: null }, transactionId: null, debt: { userId }, date: { lte: today } },
        select: { accountId: true, date: true, amount: true, accountAmount: true, debt: { select: { direction: true } } },
      }),
      // Cuotas que te tocan pagar a ti (compras tuyas, compartidas o no)
      this.prisma.installment.aggregate({
        where: { transactionId: null, plan: { userId, OR: [{ sharedId: null }, { shared: { paidByPersonId: null } }] } },
        _sum: { amountUsd: true },
      }),
    ]);

    const cur = new Map(accounts.map((a) => [a.id, a.currency]));
    // Cada evento es un cambio de saldo en la moneda de su cuenta
    const events: { accountId: string; date: Date; delta: Dec }[] = [];
    for (const t of txs) {
      const v = cur.get(t.accountId!) === 'USD' ? t.amountUsd : t.amountVes;
      events.push({ accountId: t.accountId!, date: t.date, delta: t.type === 'INCOME' ? v : v.neg() });
    }
    // Abonos de deudas que entraron o salieron de una cuenta
    for (const p of debtPayments) {
      const v = p.accountAmount ?? p.amount;
      events.push({ accountId: p.accountId!, date: p.date, delta: p.debt.direction === 'OWED_TO_ME' ? v : v.neg() });
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
      pendingInstallmentsUsd: (pendingInst._sum.amountUsd ?? zero()).toFixed(2),
    };
  }
}
