import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Currency } from './types';

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

const nf = (digits: number) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const n2 = nf(2);

export function money(value: string | number, currency: Currency) {
  const n = typeof value === 'string' ? Number(value) : value;
  return currency === 'USD' ? `$\u00a0${n2.format(n)}` : `Bs\u00a0${n2.format(n)}`;
}

export const rate = (value: string | number) => n2.format(Number(value));

const n1 = nf(1);
/** Porcentaje con signo y coma decimal: "+6,8 %". */
export const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n1.format(Math.abs(v))}\u00a0%`;

/** Hoy en la zona horaria del navegador, como YYYY-MM-DD. */
export const today = () => new Intl.DateTimeFormat('en-CA').format(new Date());

export function monthRange(ref = new Date()) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const pad = (v: number) => String(v).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

const dayFmt = new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export function dayLabel(date: string) {
  if (date === today()) return 'Hoy';
  const y = new Date(Date.now() - 86_400_000);
  if (date === new Intl.DateTimeFormat('en-CA').format(y)) return 'Ayer';
  const s = dayFmt.format(new Date(`${date}T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const monthLabel = (ref: Date) => {
  const s = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric' }).format(ref);
  return s.charAt(0).toUpperCase() + s.slice(1);
};
