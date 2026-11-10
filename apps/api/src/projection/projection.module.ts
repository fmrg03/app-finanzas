import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Currency, Prisma, RateSource } from '@prisma/client';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { dayOfMonth, nextOccurrence, nextReserveDate, reservesLeft, suggestedReserve, sumAmounts } from '../recurring/schedule';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export type ProjectedKind = 'RECURRING' | 'INSTALLMENT' | 'RESERVE';

export interface ProjectedItem {
  key: string;
  date: string;
  kind: ProjectedKind;
  /** INCOME o EXPENSE para pagos; RESERVE para lo que se aparta */
  type: 'INCOME' | 'EXPENSE' | 'RESERVE';
  description: string;
  detail: string | null;
  category: { id: string; name: string; color: string } | null;
  account: { id: string; name: string } | null;
  currency: Currency;
  amount: string;
  amountUsd: string;
  amountVes: string;
  /** Ya tocaba y sigue pendiente */
  overdue: boolean;
  /** Parte del pago que sale de lo apartado */
  fundedUsd: string;
  fundedVes: string;
  recurringId: string | null;
  planId: string | null;
}

interface Raw {
  key: string;
  date: Date;
  kind: ProjectedKind;
  type: ProjectedItem['type'];
  description: string;
  detail: string | null;
  category: ProjectedItem['category'];
  account: ProjectedItem['account'];
  currency: Currency;
  amount: Dec;
  funded: Dec;
  rateSource: RateSource;
  recurringId: string | null;
  planId: string | null;
}

/** Tope de ocurrencias por recurrente, por si es semanal y el horizonte es largo. */
const MAX_OCCURRENCES = 80;
const FREQ_LABEL = { WEEKLY: 'Semanal', MONTHLY: 'Mensual', QUARTERLY: 'Trimestral', SEMIANNUAL: 'Semestral', ANNUAL: 'Anual' } as const;

@Injectable()
export class ProjectionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lo que viene: recurrentes, cuotas por pagar y apartados, mes por mes.
   * No registra nada: es una vista. Los montos en la otra moneda se estiman con la última tasa.
   * El primer mes es lo que queda del actual (incluye lo vencido sin registrar).
   */
  async project(userId: string, months = 3) {
    const todayStr = todayLocal();
    const today = parseDateOnly(todayStr);
    const end = dayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + months + 1, 0); // último día del último mes
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { defaultRateSource: true } });

    const raws: Raw[] = [...(await this.recurringItems(userId, end, user.defaultRateSource)), ...(await this.installmentItems(userId, end))];

    const rates = await this.latestRates();
    const conv = (amount: Dec, cur: Currency, src: RateSource) => {
      const rate = rates.get(src) ?? rates.get('BCV');
      if (cur === 'USD') return { usd: amount, ves: rate ? amount.mul(rate) : new D(0) };
      return { usd: rate ? amount.div(rate) : new D(0), ves: amount };
    };

    const buckets = Array.from({ length: months + 1 }, (_, i) => {
      const first = dayOfMonth(today.getUTCFullYear(), today.getUTCMonth() + i, 1);
      return { month: toDateOnly(first).slice(0, 7), partial: i === 0, items: [] as ProjectedItem[] };
    });
    const current = buckets[0].month;

    for (const r of raws.sort((a, b) => a.date.getTime() - b.date.getTime() || a.description.localeCompare(b.description))) {
      const overdue = r.date < today;
      const ym = overdue ? current : toDateOnly(r.date).slice(0, 7);
      const bucket = buckets.find((b) => b.month === ym);
      if (!bucket) continue;
      const v = conv(r.amount, r.currency, r.rateSource);
      const f = conv(r.funded, r.currency, r.rateSource);
      bucket.items.push({
        key: r.key, date: toDateOnly(r.date), kind: r.kind, type: r.type, description: r.description, detail: r.detail,
        category: r.category, account: r.account, currency: r.currency, amount: r.amount.toFixed(2),
        amountUsd: v.usd.toFixed(2), amountVes: v.ves.toFixed(2), overdue,
        fundedUsd: f.usd.toFixed(2), fundedVes: f.ves.toFixed(2), recurringId: r.recurringId, planId: r.planId,
      });
    }

    return {
      today: todayStr,
      rates: Object.fromEntries([...rates].map(([k, v]) => [k, v.toString()])),
      months: buckets.map((b) => ({ ...b, totals: totals(b.items) })),
    };
  }

  private async recurringItems(userId: string, end: Date, defaultSource: RateSource): Promise<Raw[]> {
    const recs = await this.prisma.recurring.findMany({
      where: { userId, active: true },
      include: {
        account: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
        reserves: { select: { amount: true } },
      },
    });
    const out: Raw[] = [];
    for (const r of recs) {
      const base = {
        description: r.description, category: r.category, account: r.account, currency: r.currency,
        rateSource: r.rateSource ?? defaultSource, recurringId: r.id, planId: null,
      };
      // Fechas de pago dentro del horizonte, más la siguiente (sirve para repartir los apartados)
      const pays: Date[] = [];
      for (let d = r.nextDate, i = 0; i < MAX_OCCURRENCES && (!r.endDate || d <= r.endDate); d = nextOccurrence(r, d), i++) {
        pays.push(d);
        if (d > end) break;
      }
      const funded = new Map<number, Dec>();

      if (r.reserve && r.reserveDay && r.reserveNextDate && r.type === 'EXPENSE') {
        // Se simula mes a mes: cada apartado reparte lo que falta entre los meses que quedan; al pagar, lo apartado se usa
        let balance = sumAmounts(r.reserves);
        let rd = r.reserveNextDate;
        let p = 0;
        for (let guard = 0; guard < 200 && p < pays.length; guard++) {
          const pay = pays[p];
          if (rd <= pay) {
            if (rd > end) break;
            const amt = suggestedReserve(r.amount, balance, reservesLeft(rd, r.reserveDay, pay));
            if (amt.gt(0)) {
              out.push({
                ...base, key: `res:${r.id}:${toDateOnly(rd)}`, date: rd, kind: 'RESERVE', type: 'RESERVE', amount: amt, funded: new D(0),
                detail: `Apartado para el pago del ${toDateOnly(pay).split('-').reverse().join('/')}`,
              });
              balance = balance.add(amt);
            }
            rd = nextReserveDate(rd, r.reserveDay);
          } else {
            if (pay > end) break;
            funded.set(p, D.min(balance, r.amount));
            balance = new D(0);
            p++;
          }
        }
      }

      pays.forEach((d, i) => {
        if (d > end) return;
        out.push({
          ...base, key: `rec:${r.id}:${toDateOnly(d)}`, date: d, kind: 'RECURRING', type: r.type, amount: r.amount,
          funded: funded.get(i) ?? new D(0), detail: FREQ_LABEL[r.frequency],
        });
      });
    }
    return out;
  }

  /**
   * Cuotas por pagar. Si la compra la hiciste tú, sale la cuota completa de tu bolsillo (lo de los demás te lo deben).
   * Si la hizo otra persona, solo tu parte, que le pagas a ella (desde la cuenta elegida para tu parte).
   */
  private async installmentItems(userId: string, end: Date): Promise<Raw[]> {
    const items = await this.prisma.installment.findMany({
      where: { transactionId: null, dueDate: { lte: end }, plan: { userId } },
      include: {
        plan: {
          select: {
            id: true, provider: true, description: true, count: true, rateSource: true,
            category: { select: { id: true, name: true, color: true } }, account: { select: { id: true, name: true } },
            myAccount: { select: { id: true, name: true } },
            shared: { select: { paidByPersonId: true, totalUsd: true, paidBy: { select: { name: true } }, participants: { where: { personId: null }, select: { amountUsd: true } } } },
          },
        },
      },
    });
    const out: Raw[] = [];
    for (const i of items) {
      const s = i.plan.shared;
      const byOther = !!s?.paidByPersonId;
      const pct = byOther && !s!.totalUsd.isZero() ? (s!.participants[0]?.amountUsd ?? new D(0)).div(s!.totalUsd) : new D(1);
      const amount = byOther ? i.amountUsd.mul(pct).toDecimalPlaces(2) : i.amountUsd;
      if (amount.lte(0)) continue;
      out.push({
        key: `inst:${i.id}`, date: i.dueDate, kind: 'INSTALLMENT', type: 'EXPENSE',
        description: i.plan.description,
        detail: `Cuota ${i.n} de ${i.plan.count}, ${i.plan.provider}${byOther ? `; tu parte, para ${s!.paidBy?.name ?? 'quien pagó'}` : ''}`,
        category: i.plan.category, account: byOther ? i.plan.myAccount : i.plan.account, currency: 'USD', amount, funded: new D(0),
        rateSource: i.plan.rateSource, recurringId: null, planId: i.plan.id,
      });
    }
    return out;
  }

  private async latestRates() {
    const map = new Map<RateSource, Dec>();
    for (const source of ['BCV', 'PARALELO', 'MANUAL'] as RateSource[]) {
      const row = await this.prisma.exchangeRate.findFirst({ where: { source }, orderBy: { date: 'desc' } });
      if (row) map.set(source, row.rate);
    }
    return map;
  }
}

/** Totales del mes en las dos monedas. Libre = ingresos - gastos - apartados + lo que se paga con lo apartado. */
export function totals(items: ProjectedItem[]) {
  const t = { income: [0, 0], expense: [0, 0], reserve: [0, 0], funded: [0, 0], installments: [0, 0] };
  for (const i of items) {
    const pair = [Number(i.amountUsd), Number(i.amountVes)];
    const key = i.type === 'INCOME' ? 'income' : i.type === 'RESERVE' ? 'reserve' : 'expense';
    t[key][0] += pair[0]; t[key][1] += pair[1];
    t.funded[0] += Number(i.fundedUsd); t.funded[1] += Number(i.fundedVes);
    if (i.kind === 'INSTALLMENT') { t.installments[0] += pair[0]; t.installments[1] += pair[1]; }
  }
  const fmt = ([usd, ves]: number[]) => ({ usd: usd.toFixed(2), ves: ves.toFixed(2) });
  return {
    income: fmt(t.income), expense: fmt(t.expense), reserve: fmt(t.reserve), funded: fmt(t.funded), installments: fmt(t.installments),
    free: fmt([0, 1].map((k) => t.income[k] - t.expense[k] - t.reserve[k] + t.funded[k])),
    count: items.length,
  };
}

@ApiTags('projection') @ApiBearerAuth()
@Controller('projection')
class ProjectionController {
  constructor(private svc: ProjectionService) {}

  @Get()
  project(@CurrentUser() u: AuthUser, @Query('months') months?: string) {
    return this.svc.project(u.id, Math.min(Math.max(Number(months) || 3, 1), 12));
  }
}

@Module({ controllers: [ProjectionController], providers: [ProjectionService] })
export class ProjectionModule {}
