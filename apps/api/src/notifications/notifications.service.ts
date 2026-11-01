import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { BudgetsService } from '../budgets/budgets.service';
import { goalPlan, previousMonth } from '../goals/goal-plan';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

/** Avisa cuando queda este porcentaje o menos del presupuesto. */
export const BUDGET_NEAR_REMAINING_PCT = 5;
/** Días antes de la fecha de una meta en que se avisa que se acerca (de mayor a menor). */
export const GOAL_DEADLINE_DAYS = [30, 7];
/** Desde este día del mes se recuerda el aporte mensual si va atrasado. */
export const GOAL_REMINDER_DAY = 20;
/** Días antes del vencimiento de una cuota en que se avisa. */
export const INSTALLMENT_NOTICE_DAYS = 2;

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
    ];
    if (!candidates.length) return 0;
    const { count } = await this.prisma.notification.createMany({
      data: candidates.map((c) => ({ ...c, userId })),
      skipDuplicates: true,
    });
    return count;
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
