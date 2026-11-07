import { Prisma, RecurrenceFrequency, Recurring } from '@prisma/client';
import { toDateOnly } from '../common/date.util';

const D = Prisma.Decimal;
const DAY = 86_400_000;

/** Meses entre un pago y el siguiente (null para semanal). */
export const MONTHS: Record<RecurrenceFrequency, number | null> = { WEEKLY: null, MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

/** Frecuencias de varios meses: las únicas que admiten apartado mensual. */
export const canReserve = (f: RecurrenceFrequency) => (MONTHS[f] ?? 0) > 1;

/** El día `day` del mes (y, m), ajustado a meses cortos: 31 → 30 o 28. `m` empieza en 0 y puede desbordar. */
export function dayOfMonth(y: number, m: number, day: number) {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

/** Siguiente fecha: +7 días, o el mismo día del mes de startDate dentro de 1, 3, 6 o 12 meses. */
export function nextOccurrence(r: Pick<Recurring, 'frequency' | 'startDate'>, from: Date): Date {
  const months = MONTHS[r.frequency];
  if (months === null) return new Date(from.getTime() + 7 * DAY);
  return dayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + months, r.startDate.getUTCDate());
}

/** Fecha del apartado del mes siguiente a `from`. */
export const nextReserveDate = (from: Date, day: number) => dayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 1, day);

/** Primer apartado al activarlo: el de este mes, aunque el día ya haya pasado (queda pendiente para confirmarlo ya). */
export const firstReserveDate = (today: Date, day: number) => dayOfMonth(today.getUTCFullYear(), today.getUTCMonth(), day);

/** Cuántos apartados quedan desde `rd` hasta el pago (incluido el de `rd`). Al menos 1. */
export function reservesLeft(rd: Date, day: number, payDate: Date) {
  let n = 0;
  for (let d = rd; d <= payDate && n < 24; d = nextReserveDate(d, day)) n++;
  return Math.max(n, 1);
}

/** Lo que conviene apartar esta vez para completar el pago a tiempo: lo que falta entre los meses que quedan, redondeado hacia arriba. */
export function suggestedReserve(amount: Prisma.Decimal.Value, balance: Prisma.Decimal.Value, left: number) {
  const missing = new D(amount).sub(balance);
  if (missing.lte(0)) return new D(0);
  return missing.div(left).toDecimalPlaces(2, D.ROUND_UP);
}

/** Si el apartado pendiente quedó en o antes de la fecha de un pago ya hecho, pasa al primero después del pago. */
export function reserveAfterPayment(rd: Date | null, day: number, paidDue: Date) {
  if (!rd) return rd;
  let d = rd;
  while (d <= paidDue) d = nextReserveDate(d, day);
  return d;
}

export const sumAmounts = (rows: { amount: Prisma.Decimal }[]) => rows.reduce((a, x) => a.add(x.amount), new Prisma.Decimal(0));

/** Estado del apartado: lo reservado, lo que conviene apartar esta vez y cuántos meses quedan hasta el pago. */
export function reserveStatus(r: Pick<Recurring, 'reserve' | 'reserveDay' | 'reserveNextDate' | 'nextDate' | 'amount'> & { reserves: { amount: Prisma.Decimal }[] }) {
  const balance = sumAmounts(r.reserves);
  if (!r.reserve || !r.reserveDay || !r.reserveNextDate) return null;
  const left = r.reserveNextDate <= r.nextDate ? reservesLeft(r.reserveNextDate, r.reserveDay, r.nextDate) : 0;
  return {
    balance: balance.toFixed(2),
    // Si el próximo apartado cae después del pago, todavía no toca apartar para este pago
    suggested: left ? suggestedReserve(r.amount, balance, left).toFixed(2) : '0.00',
    left,
    nextDate: toDateOnly(r.reserveNextDate),
  };
}

