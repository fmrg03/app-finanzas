import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { BudgetsService } from '../budgets/budgets.service';
import { goalPlan, previousMonth } from '../goals/goal-plan';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { reserveStatus } from '../recurring/schedule';

/** Avisa cuando queda este porcentaje o menos del presupuesto. */
export const BUDGET_NEAR_REMAINING_PCT = 5;
/** Días antes de la fecha de una meta en que se avisa que se acerca (de mayor a menor). */
export const GOAL_DEADLINE_DAYS = [30, 7];
/** Desde este día del mes se recuerda el aporte mensual si va atrasado. */
export const GOAL_REMINDER_DAY = 20;
/** Días antes del vencimiento de una cuota en que se avisa. */
export const INSTALLMENT_NOTICE_DAYS = 2;
/** Días antes de un pago con apartado en que se avisa si lo apartado no alcanza. */
export const RESERVE_SHORT_DAYS = 15;
/** Gasto raro: al menos estas veces lo normal (la mediana) de su categoría y esta diferencia en USD. */
export const UNUSUAL_FACTOR = 2.5;
export const UNUSUAL_MIN_DIFF_USD = 15;
/** Cuántos gastos previos de la categoría hacen falta para saber qué es "lo normal". */
export const UNUSUAL_MIN_SAMPLES = 4;
/** Categoría disparada: lo del mes supera este múltiplo del promedio de los 3 meses anteriores. */
export const SPIKE_FACTOR = 1.5;
export const SPIKE_MIN_AVG_USD = 20;

interface Candidate {
  type: NotificationType;
  dedupeKey: string;
  title: string;
  body: string;
  link: string;
}

const nf = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (v: Prisma.Decimal | number | string) => `$ ${nf.format(Number(v))}`;
const money = (v: Prisma.Decimal | number | string, cur: 'USD' | 'VES') => (cur === 'USD' ? usd(v) : `Bs ${nf.format(Number(v))}`);
const dmy = (d: Date) => toDateOnly(d).split('-').reverse().join('/');
const monthName = (d: Date) => new Intl.DateTimeFormat('es-VE', { month: 'long', timeZone: 'UTC' }).format(d);

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private budgets: BudgetsService,
  ) {}

  async list(userId: string, limit = 30) {
    await this.evaluateSafe(userId);
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { unread, items };
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (!count && !(await this.prisma.notification.findFirst({ where: { id, userId }, select: { id: true } }))) {
      throw new NotFoundException('Notificación no encontrada');
    }
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: count };
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.notification.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Notificación no encontrada');
  }

  /** Nunca deja que un fallo al calcular avisos rompa la operación que lo disparó. */
  async evaluateSafe(userId: string) {
    try {
      return await this.evaluate(userId);
    } catch (e) {
      this.log.warn(`No se pudieron evaluar las notificaciones: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * Revisa las condiciones actuales y crea los avisos que falten.
   * Es idempotente: cada aviso tiene una clave única, así que llamarlo seguido no duplica nada.
   */
  async evaluate(userId: string) {
    const candidates = [
      ...(await this.budgetCandidates(userId)),
      ...(await this.recurringCandidates(userId)),
      ...(await this.debtCandidates(userId)),
      ...(await this.goalCandidates(userId)),
      ...(await this.installmentCandidates(userId)),
      ...(await this.myPartCandidates(userId)),
      ...(await this.reserveCandidates(userId)),
      ...(await this.unusualCandidates(userId)),
    ];
    if (!candidates.length) return 0;
    const { count } = await this.prisma.notification.createMany({
      data: candidates.map((c) => ({ ...c, userId })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Gastos raros, solo sobre lo anotado en los últimos días:
   * - un gasto muy por encima de lo normal en su categoría (¿un cero de más?),
   * - dos gastos iguales en la misma cuenta y día (¿anotado dos veces?),
   * - una categoría sin presupuesto que este mes ya va muy por encima de su promedio.
   */
  private async unusualCandidates(userId: string): Promise<Candidate[]> {
    const todayStr = todayLocal();
    const today = parseDateOnly(todayStr);
    const day = 86_400_000;
    const since = new Date(Date.now() - 3 * day);
    const recent = await this.prisma.transaction.findMany({
      where: { userId, type: 'EXPENSE', createdAt: { gte: since }, date: { gte: new Date(today.getTime() - 7 * day) }, installmentPlanId: null, source: { in: ['MANUAL', 'RECEIPT', 'IMPORT', 'API'] } },
      include: { category: { select: { name: true } }, account: { select: { name: true } } },
    });
    const out: Candidate[] = [];
    const what = (t: (typeof recent)[number]) => (t.description ? ` (${t.description})` : '');
    const orig = (t: { originalAmount: Prisma.Decimal; originalCurrency: 'USD' | 'VES' }) => money(t.originalAmount, t.originalCurrency);

    // 1. Muy por encima de lo normal en su categoría
    const withCat = recent.filter((t) => t.categoryId && t.myAmountUsd.gte(UNUSUAL_MIN_DIFF_USD));
    if (withCat.length) {
      const oldest = Math.min(...withCat.map((t) => t.date.getTime()));
      const history = await this.prisma.transaction.findMany({
        where: {
          userId, type: 'EXPENSE', categoryId: { in: [...new Set(withCat.map((t) => t.categoryId!))] },
          date: { gte: new Date(oldest - 180 * day) }, installmentPlanId: null, source: { in: ['MANUAL', 'RECEIPT', 'IMPORT', 'API'] },
        },
        select: { id: true, categoryId: true, date: true, myAmountUsd: true },
      });
      for (const t of withCat) {
        const prev = history
          .filter((h) => h.categoryId === t.categoryId && h.id !== t.id && h.date <= t.date && h.date.getTime() >= t.date.getTime() - 180 * day)
          .map((h) => Number(h.myAmountUsd))
          .sort((a, b) => a - b);
        if (prev.length < UNUSUAL_MIN_SAMPLES) continue;
        const mid = prev.length >> 1;
        const median = prev.length % 2 ? prev[mid] : (prev[mid - 1] + prev[mid]) / 2;
        const amt = Number(t.myAmountUsd);
        if (amt < median * UNUSUAL_FACTOR || amt - median < UNUSUAL_MIN_DIFF_USD) continue;
        out.push({
          type: 'UNUSUAL_EXPENSE',
          dedupeKey: `unusual:${t.id}`,
          title: `Gasto fuera de lo normal en ${t.category!.name}`,
          body: `Anotaste ${orig(t)}${t.originalCurrency === 'VES' ? ` (${usd(amt)})` : ''} el ${dmy(t.date)}${what(t)}. Lo normal ahí es unos ${usd(median)}. Si es correcto, ignora este aviso; si no, revisa el monto.`,
          link: '/movimientos',
        });
      }
    }

    // 2. ¿Anotado dos veces? (mismo monto, cuenta, categoría y día)
    if (recent.length) {
      const twins = await this.prisma.transaction.findMany({
        where: {
          userId, type: 'EXPENSE', accountId: { not: null },
          OR: recent.filter((t) => t.accountId).map((t) => ({ accountId: t.accountId, categoryId: t.categoryId, date: t.date, originalCurrency: t.originalCurrency, originalAmount: t.originalAmount })),
        },
        select: { id: true, accountId: true, categoryId: true, date: true, originalCurrency: true, originalAmount: true },
      });
      const seen = new Set<string>();
      for (const t of recent) {
        if (!t.accountId) continue;
        const same = twins.filter((x) => x.accountId === t.accountId && x.categoryId === t.categoryId && x.date.getTime() === t.date.getTime() && x.originalCurrency === t.originalCurrency && x.originalAmount.eq(t.originalAmount));
        if (same.length < 2) continue;
        const key = `dup:${same.map((x) => x.id).sort().join(':')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          type: 'POSSIBLE_DUPLICATE',
          dedupeKey: key.length > 180 ? `dup:${t.accountId}:${toDateOnly(t.date)}:${t.originalAmount}:${same.length}` : key,
          title: '¿Lo anotaste dos veces?',
          body: `Hay ${same.length} gastos de ${orig(t)} en ${t.account!.name} el ${dmy(t.date)}${what(t)}. Si fue uno solo, borra el repetido en Movimientos.`,
          link: '/movimientos',
        });
      }
    }

    // 3. Categoría (principal, con sus subcategorías) que este mes va muy por encima de su promedio
    const [y, m] = todayStr.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const histStart = new Date(Date.UTC(y, m - 4, 1));
    const [cats, budgets, txs] = await Promise.all([
      this.prisma.category.findMany({ where: { userId, type: 'EXPENSE' }, select: { id: true, name: true, parentId: true } }),
      this.prisma.budget.findMany({ where: { userId }, select: { categoryId: true } }),
      this.prisma.transaction.findMany({
        where: { userId, type: 'EXPENSE', categoryId: { not: null }, date: { gte: histStart, lte: today } },
        select: { categoryId: true, date: true, myAmountUsd: true },
      }),
    ]);
    const top = new Map(cats.map((c) => [c.id, c.parentId ?? c.id]));
    const names = new Map(cats.map((c) => [c.id, c.name]));
    const budgeted = new Set(budgets.map((b) => top.get(b.categoryId) ?? b.categoryId));
    const sums = new Map<string, { now: number; months: number[] }>();
    for (const t of txs) {
      const c = top.get(t.categoryId!);
      if (!c || budgeted.has(c)) continue;
      const e = sums.get(c) ?? { now: 0, months: [0, 0, 0] };
      if (t.date >= monthStart) e.now += Number(t.myAmountUsd);
      else e.months[(y * 12 + m - 1) - (t.date.getUTCFullYear() * 12 + t.date.getUTCMonth()) - 1] += Number(t.myAmountUsd);
      sums.set(c, e);
    }
    const month = todayStr.slice(0, 7);
    for (const [c, e] of sums) {
      if (e.months.filter((v) => v > 0).length < 2) continue;
      const avg = e.months.reduce((a, b) => a + b, 0) / 3;
      if (avg < SPIKE_MIN_AVG_USD || e.now < avg * SPIKE_FACTOR) continue;
      out.push({
        type: 'CATEGORY_SPIKE',
        dedupeKey: `spike:${c}:${month}`,
        title: `${names.get(c)} va muy por encima de lo normal`,
        body: `Llevas ${usd(e.now)} este mes en ${names.get(c)}; en los últimos 3 meses fueron unos ${usd(avg)} al mes (${Math.round((e.now / avg) * 100)}\u00a0%). Si quieres ponerle un tope, crea un presupuesto.`,
        link: '/presupuestos',
      });
    }
    return out;
  }

  private async budgetCandidates(userId: string): Promise<Candidate[]> {
    const status = await this.budgets.status(userId);
    const out: Candidate[] = [];
    for (const b of status.items) {
      const amount = Number(b.amountUsd);
      const spent = Number(b.spentUsd);
      const pct = amount > 0 ? (spent / amount) * 100 : 0;
      // El tope va en la clave: si cambias el presupuesto en el mes, se vuelve a avisar sobre el nuevo monto
      const key = `budget:${b.id}:${status.month}:${b.amountUsd}`;
      if (pct >= 100) {
        out.push({
          type: 'BUDGET_EXCEEDED',
          dedupeKey: `${key}:exceeded`,
          title: `Te pasaste del presupuesto de ${b.name}`,
          body: `Llevas ${usd(spent)} de ${usd(amount)} este mes (${Math.round(pct)}\u00a0%): ${usd(spent - amount)} por encima.`,
          link: '/presupuestos',
        });
      } else if (pct >= 100 - BUDGET_NEAR_REMAINING_PCT) {
        out.push({
          type: 'BUDGET_NEAR',
          dedupeKey: `${key}:near`,
          title: `Casi llegas al tope de ${b.name}`,
          body: `Te quedan ${usd(amount - spent)} de ${usd(amount)} para este mes (${Math.max(Math.round(100 - pct), 0)}\u00a0%).`,
          link: '/presupuestos',
        });
      }
    }
    return out;
  }

  private async recurringCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const due = await this.prisma.recurring.findMany({
      where: { userId, active: true, autoCreate: false, nextDate: { lte: today } },
      select: { id: true, description: true, amount: true, currency: true, nextDate: true },
    });
    return due.map((r) => ({
      type: 'RECURRING_DUE' as const,
      dedupeKey: `recurring:${r.id}:${toDateOnly(r.nextDate)}`,
      title: `Confirma: ${r.description}`,
      body: `Tocaba el ${dmy(r.nextDate)}. De costumbre son ${money(r.amount, r.currency)}; registra el monto de esta vez.`,
      link: '/recurrentes',
    }));
  }

  private async debtCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const debts = await this.prisma.debt.findMany({
      where: { userId, settledAt: null, dueDate: { lt: today } },
      include: { payments: { select: { amount: true } } },
    });
    return debts.map((d) => {
      const remaining = d.payments.reduce((a, p) => a.sub(p.amount), new Prisma.Decimal(d.amount));
      const mine = d.direction === 'I_OWE';
      return {
        type: 'DEBT_OVERDUE' as const,
        dedupeKey: `debt:${d.id}:${toDateOnly(d.dueDate!)}`,
        title: mine ? `Venció tu deuda con ${d.person}` : `${d.person} no te ha pagado`,
        body: `${mine ? 'Debes' : 'Te debe'} ${money(remaining, d.currency)} desde el ${dmy(d.dueDate!)}.`,
        link: '/deudas',
      };
    });
  }

  /** Cuotas que te tocan pagar a ti: aviso unos días antes y otro si se vencen. */
  /** Compras en cuotas que hizo otra persona: se pregunta si ya pagaste tu parte de cada cuota (no se asume). */
  private async myPartCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const limit = new Date(today.getTime() + INSTALLMENT_NOTICE_DAYS * 86_400_000);
    const items = await this.prisma.installment.findMany({
      where: { transactionId: null, dueDate: { lte: limit }, plan: { userId, shared: { paidByPersonId: { not: null } } } },
      include: { plan: { select: { provider: true, description: true, count: true, sharedId: true, shared: { select: { totalUsd: true, paidBy: { select: { name: true } }, participants: { where: { personId: null }, select: { amountUsd: true } } } } } } },
    });
    return items.map((i) => {
      const s = i.plan.shared!;
      const pct = s.totalUsd.isZero() ? 0 : Number(s.participants[0]?.amountUsd ?? 0) / Number(s.totalUsd);
      const part = money(Number(i.amountUsd) * pct, 'USD');
      const who = s.paidBy?.name ?? 'quien pagó';
      const what = `${i.plan.provider}: ${i.plan.description}`;
      const overdue = i.dueDate < today;
      return {
        type: overdue ? 'INSTALLMENT_OVERDUE' as const : 'INSTALLMENT_DUE' as const,
        dedupeKey: `mypart:${i.id}:${overdue ? 'overdue' : 'due'}`,
        title: overdue ? `¿Pagaste tu parte de la cuota ${i.n} de ${what}?` : `Se viene tu parte de la cuota ${i.n} de ${what}`,
        body: overdue
          ? `Venció el ${dmy(i.dueDate)}: tu parte es ${part}. Si ya se la pagaste a ${who}, confírmalo en Deudas > Cuotas para registrarla.`
          : `Vence el ${dmy(i.dueDate)}: tu parte es ${part}, para ${who}.`,
        link: '/deudas?tab=cuotas',
      };
    });
  }

  private async installmentCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const limit = new Date(today.getTime() + INSTALLMENT_NOTICE_DAYS * 86_400_000);
    const items = await this.prisma.installment.findMany({
      where: { transactionId: null, dueDate: { lte: limit }, plan: { userId, OR: [{ sharedId: null }, { shared: { paidByPersonId: null } }] } },
      include: { plan: { select: { provider: true, description: true, count: true } } },
    });
    return items.map((i) => {
      const days = Math.round((i.dueDate.getTime() - today.getTime()) / 86_400_000);
      const what = `${i.plan.provider}: ${i.plan.description}`;
      if (days < 0) {
        return {
          type: 'INSTALLMENT_OVERDUE' as const,
          dedupeKey: `inst:${i.id}:overdue`,
          title: `Cuota vencida de ${what}`,
          body: `La cuota ${i.n} de ${i.plan.count} por ${usd(i.amountUsd)} venció el ${dmy(i.dueDate)}. Si ya la pagaste, regístrala en Deudas → Cuotas.`,
          link: '/deudas?tab=cuotas',
        };
      }
      const when = days === 0 ? 'vence hoy' : days === 1 ? 'vence mañana' : `vence el ${dmy(i.dueDate)}`;
      return {
        type: 'INSTALLMENT_DUE' as const,
        dedupeKey: `inst:${i.id}:due`,
        title: `Se acerca una cuota de ${what}`,
        body: `La cuota ${i.n} de ${i.plan.count} por ${usd(i.amountUsd)} ${when}.`,
        link: '/deudas?tab=cuotas',
      };
    });
  }

  /** Apartados por confirmar, y aviso si se acerca el pago y lo apartado no alcanza. */
  private async reserveCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const recs = await this.prisma.recurring.findMany({
      where: { userId, active: true, reserve: true },
      include: { reserves: { select: { amount: true } } },
    });
    const out: Candidate[] = [];
    for (const r of recs) {
      const st = reserveStatus(r);
      if (!st) continue;
      if (r.reserveNextDate! <= today && Number(st.suggested) > 0) {
        out.push({
          type: 'RESERVE_DUE',
          dedupeKey: `reserve:${r.id}:${st.nextDate}`,
          title: `Aparta para ${r.description}`,
          body: `Toca apartar ${money(st.suggested, r.currency)} este mes. Llevas ${money(st.balance, r.currency)} de ${money(r.amount, r.currency)}; se paga el ${dmy(r.nextDate)}.`,
          link: '/recurrentes',
        });
      }
      const days = Math.round((r.nextDate.getTime() - today.getTime()) / 86_400_000);
      const missing = Number(r.amount) - Number(st.balance);
      if (days >= 0 && days <= RESERVE_SHORT_DAYS && missing > 0.005) {
        out.push({
          type: 'RESERVE_SHORT',
          dedupeKey: `reserve-short:${r.id}:${toDateOnly(r.nextDate)}`,
          title: `Te falta apartar para ${r.description}`,
          body: `Se paga el ${dmy(r.nextDate)} y llevas ${money(st.balance, r.currency)} de ${money(r.amount, r.currency)}: faltan ${money(missing, r.currency)}.`,
          link: '/recurrentes',
        });
      }
    }
    return out;
  }

  private async goalCandidates(userId: string): Promise<Candidate[]> {
    const today = parseDateOnly(todayLocal());
    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId, archivedAt: null },
      include: { contributions: { select: { date: true, amountUsd: true } } },
    });
    const out: Candidate[] = [];
    const ym = toDateOnly(today).slice(0, 7);
    for (const g of goals) {
      const p = goalPlan(g, today);
      const link = '/metas';
      if (p.remaining.lte(0)) {
        out.push({ type: 'GOAL_REACHED', dedupeKey: `goal:${g.id}:${g.targetUsd.toFixed(2)}`, title: `¡Cumpliste la meta ${g.name}!`, body: `Ya juntaste los ${usd(g.targetUsd)} que te propusiste.`, link });
        continue;
      }

      // Fecha: vencida sin cumplir, o cada vez más cerca
      if (g.targetDate && p.daysLeft !== null) {
        const dateKey = `goal:${g.id}:${toDateOnly(g.targetDate)}:${g.targetUsd.toFixed(2)}`;
        if (p.daysLeft < 0) {
          out.push({
            type: 'GOAL_MISSED',
            dedupeKey: `${dateKey}:missed`,
            title: `No llegaste a la meta ${g.name}`,
            body: `La fecha era el ${dmy(g.targetDate)} y te faltaron ${usd(p.remaining)} de ${usd(g.targetUsd)}. Puedes mover la fecha o ajustar el objetivo.`,
            link,
          });
        } else {
          // Solo el umbral más cercano que ya se cruzó (si faltan 5 días, el de 7, no el de 30)
          const threshold = [...GOAL_DEADLINE_DAYS].sort((a, b) => a - b).find((d) => p.daysLeft! <= d);
          if (threshold !== undefined) {
            const when = p.daysLeft === 0 ? 'Hoy es la fecha' : p.daysLeft === 1 ? 'Mañana es la fecha' : `Faltan ${p.daysLeft} días`;
            out.push({
              type: 'GOAL_DEADLINE_NEAR',
              dedupeKey: `${dateKey}:near${threshold}`,
              title: `Se acerca la fecha de ${g.name}`,
              body: `${when} (${dmy(g.targetDate)}) y te faltan ${usd(p.remaining)} de ${usd(g.targetUsd)}.`,
              link,
            });
          }
        }
      }

      // Aporte del mes en curso: recordatorio a partir del día 20 si va atrasado
      const day = today.getUTCDate();
      const createdBeforeReminder = g.createdAt < new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), GOAL_REMINDER_DAY));
      if (p.plan && p.plan.gt(0) && day >= GOAL_REMINDER_DAY && createdBeforeReminder && p.thisMonth.lt(p.plan) && (p.daysLeft === null || p.daysLeft >= 0)) {
        out.push({
          type: 'GOAL_BEHIND',
          dedupeKey: `goal:${g.id}:${ym}:reminder`,
          title: `Vas atrasado con ${g.name} este mes`,
          body: `Llevas ${usd(p.thisMonth)} de los ${usd(p.plan)} ${g.monthlyUsd ? 'que te propusiste' : 'que necesitas'} aportar en ${monthName(today)}. Te faltan ${usd(p.plan.sub(p.thisMonth))}.`,
          link,
        });
      }

      // Mes anterior: si la meta ya existía todo el mes, su fecha no ha pasado y no se cumplió el aporte
      const prev = previousMonth(g, today);
      if (prev.plan && prev.plan.gt(0) && !prev.reachedBefore && (p.daysLeft === null || p.daysLeft >= 0) && g.createdAt < prev.start && (!g.targetDate || g.targetDate > prev.start) && prev.contributed.lt(prev.plan.toDecimalPlaces(2))) {
        out.push({
          type: 'GOAL_BEHIND',
          dedupeKey: `goal:${g.id}:${toDateOnly(prev.start).slice(0, 7)}:missed-month`,
          title: `No cumpliste el aporte de ${monthName(prev.start)} para ${g.name}`,
          body: `Aportaste ${usd(prev.contributed)} de ${usd(prev.plan)}.${
            g.monthlyUsd ? '' : p.monthlyNeeded ? ` Para llegar a tiempo ahora necesitas unos ${usd(p.monthlyNeeded)} al mes.` : ''
          }`,
          link,
        });
      }
    }
    return out;
  }
}
