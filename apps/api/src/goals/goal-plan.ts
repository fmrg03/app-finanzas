import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;
const DAY = 86_400_000;
const MONTH_DAYS = 30.44;

export interface GoalLike {
  targetUsd: Prisma.Decimal;
  targetDate: Date | null;
  monthlyUsd: Prisma.Decimal | null;
  contributions: { date: Date; amountUsd: Prisma.Decimal }[];
}

const monthStart = (d: Date, shift = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1));
const sum = (cs: GoalLike['contributions']) => cs.reduce((a, c) => a.add(c.amountUsd), new D(0));

/** Lo que haría falta apartar por mes, desde `from`, para llegar al objetivo en la fecha. */
function neededPerMonth(remaining: Prisma.Decimal, targetDate: Date | null, from: Date) {
  if (!targetDate || remaining.lte(0)) return null;
  const monthsLeft = (targetDate.getTime() - from.getTime()) / (MONTH_DAYS * DAY);
  if (monthsLeft <= 0) return null;
  return monthsLeft < 1 ? remaining : remaining.div(monthsLeft);
}

/**
 * Estado de una meta hoy: cuánto lleva, cuánto falta, el aporte mensual a cumplir
 * (el que la persona se propuso o, si no, el necesario para llegar a la fecha) y lo aportado este mes.
 */
export function goalPlan(g: GoalLike, today: Date) {
  const saved = sum(g.contributions);
  const remaining = D.max(g.targetUsd.sub(saved), 0);
  const monthlyNeeded = neededPerMonth(remaining, g.targetDate, today);
  const plan = g.monthlyUsd ?? monthlyNeeded;
  const thisMonth = sum(g.contributions.filter((c) => c.date >= monthStart(today)));
  const daysLeft = g.targetDate ? Math.round((g.targetDate.getTime() - today.getTime()) / DAY) : null;
  return { saved, remaining, monthlyNeeded, plan, thisMonth, daysLeft };
}

/** Cómo le fue a la meta el mes anterior: lo aportado contra el plan que tenía al empezar ese mes. */
export function previousMonth(g: GoalLike, today: Date) {
  const start = monthStart(today, -1);
  const end = monthStart(today);
  const savedBefore = sum(g.contributions.filter((c) => c.date < start));
  const contributed = sum(g.contributions.filter((c) => c.date >= start && c.date < end));
  const plan = g.monthlyUsd ?? neededPerMonth(D.max(g.targetUsd.sub(savedBefore), 0), g.targetDate, start);
  return { start, contributed, plan, reachedBefore: savedBefore.gte(g.targetUsd) };
}
