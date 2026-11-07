'use client';

import { CalendarRange, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn, money } from '@/lib/format';
import { useProjection } from '@/lib/planning';
import type { Currency, MoneyBoth, ProjectedMonth } from '@/lib/types';

export const pickBoth = (p: MoneyBoth, c: Currency) => Number(c === 'USD' ? p.usd : p.ves);

/** "dic 2026" o "Resto de noviembre" para el mes en curso. */
export function projMonthName(m: ProjectedMonth, style: 'short' | 'long' = 'long') {
  const [y, mo] = m.month.split('-').map(Number);
  const d = new Date(y, mo - 1, 1);
  const name = new Intl.DateTimeFormat('es-VE', { month: style === 'short' ? 'short' : 'long' }).format(d).replace('.', '');
  if (m.partial) return style === 'short' ? 'Resto' : `Resto de ${name}`;
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  return y === new Date().getFullYear() ? cap : `${cap} ${y}`;
}

/** Lo que viene en los próximos 3 meses: recurrentes, cuotas y apartados. Cada mes lleva al detalle. */
export function ProjectionCard({ currency }: { currency: Currency }) {
  const { data } = useProjection(3);
  if (!data) return null;
  const months = data.months.filter((m) => !m.partial);
  if (!months.some((m) => m.totals.count > 0)) return null;
  return (
    <section aria-labelledby="proximos" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="proximos" className="flex items-center gap-2 text-lg font-bold"><CalendarRange size={18} className="text-accent" /> Próximos 3 meses</h2>
        <Link href="/proyeccion" className="text-sm font-semibold text-accent hover:underline">Ver detalle</Link>
      </div>
      <p className="mt-1 text-sm text-muted">Lo que ya sabes que viene: recurrentes, cuotas y apartados. Es una proyección: no se registra nada.</p>
      <ul className="mt-4 grid grid-cols-3 gap-2">
        {months.map((m) => {
          const free = pickBoth(m.totals.free, currency);
          return (
            <li key={m.month}>
              <Link href={`/proyeccion?mes=${m.month}`} className="group flex h-full flex-col rounded-xl border border-line p-2.5 hover:border-accent/50 hover:bg-canvas/50 sm:p-3">
                <span className="flex items-center justify-between text-sm font-semibold">
                  <span className="sm:hidden">{projMonthName(m, 'short').replace(/^./, (c) => c.toUpperCase())}</span>
                  <span className="hidden sm:inline">{projMonthName(m)}</span>
                  <ChevronRight size={16} className="text-muted group-hover:text-accent" />
                </span>
                <span className="mt-2 text-xs text-muted">Gastos previstos</span>
                <span className="text-base font-extrabold tabular-nums sm:text-xl">{money(pickBoth(m.totals.expense, currency), currency)}</span>
                <span className={cn('mt-1 text-xs font-semibold tabular-nums sm:hidden', free < 0 && 'text-expense')}>Te queda {money(free, currency)}</span>
                <dl className="mt-2 hidden sm:grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-xs tabular-nums">
                  <dt className="text-muted">Ingresos</dt><dd className="text-right text-income">{money(pickBoth(m.totals.income, currency), currency)}</dd>
                  {pickBoth(m.totals.reserve, currency) > 0 && <><dt className="text-muted">Apartas</dt><dd className="text-right">{money(pickBoth(m.totals.reserve, currency), currency)}</dd></>}
                  {pickBoth(m.totals.funded, currency) > 0 && <><dt className="text-muted">Sale de lo apartado</dt><dd className="text-right">{money(pickBoth(m.totals.funded, currency), currency)}</dd></>}
                  <dt className="font-semibold">Te queda</dt><dd className={cn('text-right font-semibold', free < 0 && 'text-expense')}>{money(free, currency)}</dd>
                </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
