'use client';

import { CreditCard, PiggyBank, Repeat } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { pickBoth, projMonthName } from '@/components/projection-card';
import { ErrorNote, Segmented } from '@/components/ui/controls';
import { cn, dayLabel, money, rate } from '@/lib/format';
import { useProjection } from '@/lib/planning';
import { useMe } from '@/lib/queries';
import type { Currency, ProjectedItem, ProjectedMonth } from '@/lib/types';

const KIND = {
  RECURRING: { icon: Repeat, label: 'Recurrente', href: '/recurrentes' },
  INSTALLMENT: { icon: CreditCard, label: 'Cuota', href: '/deudas?tab=cuotas' },
  RESERVE: { icon: PiggyBank, label: 'Apartado', href: '/recurrentes' },
} as const;

export default function ProyeccionPage() {
  const { data: me } = useMe();
  const [cur, setCur] = useState<Currency | null>(null);
  const currency: Currency = cur ?? me?.defaultCurrency ?? 'USD';
  const q = useProjection(3);
  const [month, setMonth] = useState<string | null>(null);

  // ?mes=AAAA-MM desde el resumen
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get('mes');
    if (m) setMonth(m);
  }, []);
  const months = q.data?.months ?? [];
  const selected = months.find((m) => m.month === month) ?? months.find((m) => !m.partial) ?? months[0];
  function pick(m: string) {
    setMonth(m);
    window.history.replaceState(null, '', `/proyeccion?mes=${m}`);
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Proyección</h1>
        <Segmented label="Moneda" value={currency} onChange={setCur} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
      </header>
      <p className="mt-1 text-muted">
        Lo que ya sabes que viene en los próximos meses: recurrentes, cuotas por pagar y lo que te toca apartar. Nada de esto se registra hasta que lo confirmes.
      </p>

      {q.isError && <div className="mt-6"><ErrorNote>{(q.error as Error).message}</ErrorNote></div>}
      {q.isPending && <p className="py-16 text-center text-muted">Cargando proyección…</p>}

      {selected && (
        <>
          <div role="tablist" aria-label="Mes" className="mt-6 flex gap-1 overflow-x-auto rounded-xl bg-surface p-1">
            {months.map((m) => (
              <button
                key={m.month}
                role="tab"
                aria-selected={m.month === selected.month}
                onClick={() => pick(m.month)}
                className={cn(
                  'flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:text-ink',
                  m.month === selected.month && 'bg-accent-soft text-accent hover:text-accent',
                )}
              >
                {projMonthName(m)}
              </button>
            ))}
          </div>
          <MonthDetail m={selected} currency={currency} rates={q.data!.rates} />
        </>
      )}
    </>
  );
}

function MonthDetail({ m, currency, rates }: { m: ProjectedMonth; currency: Currency; rates: Record<string, string> }) {
  const t = m.totals;
  const free = pickBoth(t.free, currency);
  const byDate = new Map<string, ProjectedItem[]>();
  for (const i of m.items) byDate.set(i.overdue ? 'overdue' : i.date, [...(byDate.get(i.overdue ? 'overdue' : i.date) ?? []), i]);

  return (
    <>
      <section aria-label="Totales del mes" className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-4">
        <Total label="Ingresos" value={pickBoth(t.income, currency)} currency={currency} tone="text-income" />
        <Total label="Gastos" value={pickBoth(t.expense, currency)} currency={currency} hint={pickBoth(t.installments, currency) > 0 ? `${money(pickBoth(t.installments, currency), currency)} en cuotas` : undefined} />
        <Total
          label="Apartas"
          value={pickBoth(t.reserve, currency)}
          currency={currency}
          hint={pickBoth(t.funded, currency) > 0 ? `y usas ${money(pickBoth(t.funded, currency), currency)} apartados` : undefined}
        />
        <Total label="Te queda" value={free} currency={currency} tone={free < 0 ? 'text-expense' : undefined} strong />
      </section>
      <p className="mt-2 text-xs text-muted">
        Te queda = ingresos − gastos − lo que apartas + lo que pagas con lo ya apartado. No cuenta gastos variables como comida o salidas.
      </p>

      {!m.items.length ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">Nada previsto para este mes.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {[...byDate].map(([date, items]) => (
            <section key={date} aria-label={date === 'overdue' ? 'Pendientes' : dayLabel(date)}>
              <h2 className={cn('mb-1.5 text-sm font-semibold text-muted', date === 'overdue' && 'text-warning')}>
                {date === 'overdue' ? 'Ya tocaba y sigue pendiente' : dayLabel(date)}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
                {items.map((i) => <Row key={i.key} i={i} currency={currency} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-muted">
        Los montos en la otra moneda se estiman con la última tasa{rates.BCV ? ` (BCV ${rate(rates.BCV)})` : ''}.
        En compras en cuotas que hizo otra persona aparece solo tu parte, que le pagas a ella.
      </p>
    </>
  );
}

function Total({ label, value, currency, tone, hint, strong }: { label: string; value: number; currency: Currency; tone?: string; hint?: string; strong?: boolean }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('mt-0.5 tabular-nums', strong ? 'text-xl font-extrabold' : 'text-lg font-bold', tone)}>{money(value, currency)}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Row({ i, currency }: { i: ProjectedItem; currency: Currency }) {
  const k = KIND[i.kind];
  const Icon = k.icon;
  const value = currency === 'USD' ? i.amountUsd : i.amountVes;
  const funded = Number(currency === 'USD' ? i.fundedUsd : i.fundedVes);
  const original = i.currency !== currency;
  return (
    <li>
      <Link href={k.href} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas/60">
        <span
          aria-hidden
          className={cn('grid size-9 shrink-0 place-items-center rounded-full', i.type === 'RESERVE' ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted')}
          style={i.category && i.type !== 'RESERVE' ? { color: i.category.color } : undefined}
        >
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{i.type === 'RESERVE' ? `Apartar para ${i.description}` : i.description}</span>
          <span className="block truncate text-xs text-muted">
            {[i.overdue ? dayLabel(i.date) : null, i.detail, i.account?.name, i.category && i.type !== 'RESERVE' ? i.category.name : null].filter(Boolean).join(' · ')}
          </span>
          {funded > 0 && <span className="block text-xs text-accent">{money(funded, currency)} salen de lo apartado</span>}
        </span>
        <span className="flex flex-col items-end">
          <span className={cn('font-bold tabular-nums', i.type === 'INCOME' && 'text-income', i.type === 'RESERVE' && 'text-accent')}>
            {i.type === 'INCOME' ? '+' : i.type === 'EXPENSE' ? '−' : ''}{money(value, currency)}
          </span>
          {original && <span className="text-xs tabular-nums text-muted">{money(i.amount, i.currency)}</span>}
          {i.overdue && <span className="text-xs font-semibold text-warning">pendiente</span>}
        </span>
      </Link>
    </li>
  );
}
