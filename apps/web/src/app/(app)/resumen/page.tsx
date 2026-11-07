'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CHART, LegendItem, MonthlyBars, MonthlyTable, PaceChart } from '@/components/charts';
import { DueRecurring } from '@/components/due-recurring';
import { UpcomingInstallments } from '@/components/upcoming-installments';
import { budgetTone, Progress } from '@/components/progress';
import { useBudgets } from '@/lib/planning';
import { MonthNav, useMonth } from '@/components/month-nav';
import { ErrorNote, Segmented } from '@/components/ui/controls';
import { cn, money, monthLabel, monthRange } from '@/lib/format';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAccounts, useCategories, useMe, useOverview, type MoneyPair } from '@/lib/queries';
import type { Currency } from '@/lib/types';

const pick = (p: MoneyPair, c: Currency) => Number(c === 'USD' ? p.usd : p.ves);

export default function ResumenPage() {
  const nav = useMonth();
  const { data: me } = useMe();
  const [cur, setCur] = useState<Currency | null>(null);
  const currency: Currency = cur ?? me?.defaultCurrency ?? 'USD';
  const { from, to } = monthRange(nav.month);
  const q = useOverview(from, to);
  const [showTable, setShowTable] = useState(false);

  const d = q.data;
  const prevLabel = monthLabel(new Date(nav.month.getFullYear(), nav.month.getMonth() - 1, 1)).split(' ')[0].toLowerCase();
  // Día del mes hasta el que hay "presente": hoy si es el mes en curso; todo el mes si es pasado
  const lastDay = nav.isCurrent ? new Date().getDate() : (d?.period.days ?? 31);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{monthLabel(nav.month)}</h1>
        <div className="flex items-center gap-2">
          <Segmented label="Moneda" value={currency} onChange={setCur} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
          <MonthNav {...nav} />
        </div>
      </header>

      <DueRecurring />
      {nav.isCurrent && <UpcomingInstallments />}

      {q.isError && <div className="mt-6"><ErrorNote>{(q.error as Error).message}</ErrorNote></div>}
      {q.isPending && <p className="py-16 text-center text-muted">Cargando resumen…</p>}

      {d && d.totals.count === 0 && d.previousTotals.count === 0 && <EmptyState monthName={monthLabel(nav.month).toLowerCase()} />}

      {d && (d.totals.count > 0 || d.previousTotals.count > 0) && (
        <>
          <section aria-labelledby="ritmo" className="mt-6 rounded-2xl bg-surface p-5 sm:p-6">
            <Pace d={d} currency={currency} lastDay={lastDay} isCurrent={nav.isCurrent} prevLabel={prevLabel} />
            <div className="mt-4 flex gap-4">
              <LegendItem color={CHART.current} label={monthLabel(nav.month).split(' ')[0]} />
              <LegendItem color={CHART.previous} label={prevLabel.charAt(0).toUpperCase() + prevLabel.slice(1)} dashed />
            </div>
            <div className="mt-2">
              <PaceChart data={d.cumulativeExpense} currency={currency} lastDay={lastDay} labels={[monthLabel(nav.month).split(' ')[0], prevLabel.charAt(0).toUpperCase() + prevLabel.slice(1)]} />
            </div>
          </section>

          <section aria-label="Totales del mes" className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-line">
            <Kpi label="Ingresos" value={pick(d.totals.income, currency)} prev={pick(d.previousTotals.income, currency)} currency={currency} goodWhenUp />
            <Kpi label="Gastos" value={pick(d.totals.expense, currency)} prev={pick(d.previousTotals.expense, currency)} currency={currency} />
            <Kpi label="Balance" value={pick(d.totals.net, currency)} prev={pick(d.previousTotals.net, currency)} currency={currency} goodWhenUp signed />
          </section>

          {nav.isCurrent && <BudgetsGlance />}

          <section aria-labelledby="categorias" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
            <h2 id="categorias" className="text-lg font-bold">En qué se fue</h2>
            {d.expenseByCategory.length ? (
              <CategoryBreakdown items={d.expenseByCategory} currency={currency} total={pick(d.totals.expense, currency)} />
            ) : (
              <p className="mt-3 text-sm text-muted">Sin gastos este mes.</p>
            )}
          </section>

          <section aria-labelledby="meses" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="meses" className="text-lg font-bold">Últimos 6 meses</h2>
              <button onClick={() => setShowTable((v) => !v)} className="text-sm font-semibold text-accent hover:underline">
                {showTable ? 'Ver gráfico' : 'Ver tabla'}
              </button>
            </div>
            {showTable ? (
              <div className="mt-4"><MonthlyTable data={d.monthly} currency={currency} /></div>
            ) : (
              <>
                <div className="mt-3 flex gap-4">
                  <LegendItem color={CHART.income} label="Ingresos" />
                  <LegendItem color={CHART.expense} label="Gastos" />
                </div>
                <div className="mt-2"><MonthlyBars data={d.monthly} currency={currency} /></div>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

/** El titular: cuánto llevas gastado y cómo vas contra el mes anterior al mismo día. */
function Pace({ d, currency, lastDay, isCurrent, prevLabel }: { d: NonNullable<ReturnType<typeof useOverview>['data']>; currency: Currency; lastDay: number; isCurrent: boolean; prevLabel: string }) {
  const spent = pick(d.totals.expense, currency);
  const idx = Math.min(lastDay, d.cumulativeExpense.previous.length) - 1;
  const prevAtSameDay = idx >= 0 ? pick(d.cumulativeExpense.previous[idx], currency) : 0;
  const prevTotal = pick(d.previousTotals.expense, currency);
  const ref = isCurrent ? prevAtSameDay : prevTotal;
  const diff = ref > 0 ? (spent - ref) / ref : null;

  let comparison: string;
  if (diff === null) comparison = `Sin gastos en ${prevLabel} para comparar.`;
  else if (Math.abs(diff) < 0.02) comparison = isCurrent ? `Igual que a esta altura de ${prevLabel}.` : `Casi lo mismo que en ${prevLabel}.`;
  else {
    const pct = `${Math.round(Math.abs(diff) * 100)} %`;
    comparison = diff < 0
      ? `${pct} menos que ${isCurrent ? `a esta altura de ${prevLabel}` : `en ${prevLabel}`}.`
      : `${pct} más que ${isCurrent ? `a esta altura de ${prevLabel}` : `en ${prevLabel}`}.`;
  }

  return (
    <div>
      <h2 id="ritmo" className="text-sm font-medium text-muted">{isCurrent ? 'Llevas gastado este mes' : 'Gastaste en el mes'}</h2>
      <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">{money(spent, currency)}</p>
      <p className={cn('mt-2 font-semibold', diff !== null && diff < -0.02 && 'text-income', diff !== null && diff > 0.02 && 'text-expense')}>{comparison}</p>
    </div>
  );
}

function Kpi({ label, value, prev, currency, goodWhenUp, signed }: { label: string; value: number; prev: number; currency: Currency; goodWhenUp?: boolean; signed?: boolean }) {
  const delta = prev !== 0 ? (value - prev) / Math.abs(prev) : null;
  const good = delta === null ? null : goodWhenUp ? delta > 0 : delta < 0;
  return (
    <div className="bg-surface px-3 py-4 sm:px-5">
      <p className="text-xs text-muted sm:text-sm">{label}</p>
      <p className={cn('mt-1 text-base font-extrabold tabular-nums sm:text-xl', signed && value < 0 && 'text-expense')}>{money(value, currency)}</p>
      <p className={cn('text-xs tabular-nums', good === true && 'text-income', good === false && 'text-expense', good === null && 'text-muted')}>
        {delta === null ? 'Sin mes anterior' : (
          <>
            {delta >= 0 ? '▲' : '▼'} {Math.round(Math.abs(delta) * 100)} %<span className="hidden sm:inline"> vs. mes anterior</span>
            <span className="sr-only sm:hidden"> respecto al mes anterior</span>
          </>
        )}
      </p>
    </div>
  );
}

function CategoryBreakdown({ items, currency, total }: { items: { categoryId: string | null; name: string; color: string; count: number; usd: string; ves: string }[]; currency: Currency; total: number }) {
  const top = items.slice(0, 7);
  const rest = items.slice(7);
  const rows = rest.length
    ? [...top, { categoryId: 'otras', name: `Otras (${rest.length})`, color: '#b6bfcc', count: rest.reduce((s, r) => s + r.count, 0), usd: String(rest.reduce((s, r) => s + Number(r.usd), 0)), ves: String(rest.reduce((s, r) => s + Number(r.ves), 0)) }]
    : top;
  const max = Math.max(...rows.map((r) => pick(r, currency)), 1);
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {rows.map((r) => {
        const v = pick(r, currency);
        const pct = total > 0 ? Math.round((v / total) * 100) : 0;
        return (
          <li key={r.categoryId ?? 'none'} title={`${r.name}: ${money(v, currency)}, ${r.count} movimiento${r.count === 1 ? '' : 's'}`}>
            <div className="flex items-baseline gap-2 text-sm">
              <span aria-hidden className="size-2.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: r.color }} />
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className="tabular-nums font-semibold">{money(v, currency)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">{pct} %</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-canvas">
              <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.max((v / max) * 100, 1.5)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Sin movimientos: guía los pasos que faltan para registrar el primero. */
function EmptyState({ monthName }: { monthName: string }) {
  const qc = useQueryClient();
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { data: me } = useMe();
  const seed = useMutation({ mutationFn: () => api('/categories/defaults', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }) });
  if (!accounts || !categories) return null;

  const steps = [
    {
      done: categories.length > 0,
      title: 'Crea tus categorías',
      action: <button onClick={() => seed.mutate()} disabled={seed.isPending} className="font-semibold text-accent hover:underline disabled:opacity-50">Crear categorías básicas</button>,
    },
    { done: accounts.length > 0, title: 'Crea una cuenta, por ejemplo Efectivo en dólares', action: <Link href="/cuentas" className="font-semibold text-accent hover:underline">Ir a cuentas</Link> },
    { done: false, title: 'Registra tu primer gasto o ingreso', action: <Link href="/movimientos" className="font-semibold text-accent hover:underline">Ir a movimientos</Link> },
  ];
  const setupDone = steps[0].done && steps[1].done;

  return (
    <div className="mt-6 rounded-2xl bg-surface p-6">
      <p className="text-lg font-bold">{setupDone ? `Todavía no hay movimientos en ${monthName}` : `${me?.name ? `Hola, ${me.name.split(' ')[0]}. ` : ''}Empecemos`}</p>
      <p className="mt-1 text-sm text-muted">Cuando registres gastos e ingresos, aquí verás en qué se va tu dinero y cómo vas contra el mes anterior.</p>
      <ol className="mt-5 flex flex-col gap-3">
        {steps.map((st, i) => (
          <li key={st.title} className="flex items-center gap-3 text-sm">
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', st.done ? 'bg-income-soft text-income' : 'bg-canvas text-muted')}>
              {st.done ? <Check size={14} aria-label="Hecho" /> : i + 1}
            </span>
            <span className={cn('flex-1', st.done && 'text-muted line-through')}>{st.title}</span>
            {!st.done && st.action}
          </li>
        ))}
      </ol>
      {seed.error && <div className="mt-3"><ErrorNote>{seed.error.message}</ErrorNote></div>}
    </div>
  );
}

/** Los presupuestos más comprometidos del mes, con enlace a la página completa. */
function BudgetsGlance() {
  const { data } = useBudgets();
  if (!data?.items.length) return null;
  const top = data.items.slice(0, 3);
  return (
    <section aria-labelledby="presupuestos" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 id="presupuestos" className="text-lg font-bold">Presupuestos</h2>
        <Link href="/presupuestos" className="text-sm font-semibold text-accent hover:underline">Ver todos</Link>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {top.map((b) => (
          <li key={b.id}>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">{b.name}</span>
              <span className="tabular-nums">{money(b.spentUsd, 'USD')} <span className="text-muted">/ {money(b.amountUsd, 'USD')}</span></span>
            </div>
            <Progress className="mt-1.5" pct={b.pct} tone={budgetTone(b.status)} label={`${b.name}: ${b.pct} %`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
