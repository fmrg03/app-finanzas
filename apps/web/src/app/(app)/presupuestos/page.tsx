'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MonthNav, useMonth } from '@/components/month-nav';
import { budgetTone, Progress } from '@/components/progress';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money, monthLabel } from '@/lib/format';
import { useApiMutation, useBudgets } from '@/lib/planning';
import { useCategories } from '@/lib/queries';
import type { BudgetItem } from '@/lib/types';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function PresupuestosPage() {
  const nav = useMonth();
  const q = useBudgets(ym(nav.month));
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null);
  const d = q.data;
  const total = d ? Number(d.totals.budgetUsd) : 0;
  const spent = d ? Number(d.totals.spentUsd) : 0;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Presupuestos</h1>
        <div className="flex items-center gap-2">
          <MonthNav {...nav} />
          <Button onClick={() => setEditing('new')}><Plus size={18} /> <span className="hidden sm:inline">Nuevo</span></Button>
        </div>
      </header>
      <p className="mt-1 text-muted">Topes mensuales en dólares por categoría. En Bs se desactualizarían solos con la devaluación.</p>

      {q.error && <div className="mt-4"><ErrorNote>{q.error.message}</ErrorNote></div>}
      {d && !d.items.length && (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">Todavía no tienes presupuestos</p>
          <p className="mt-1 text-sm text-muted">Ponle un tope a las categorías donde más se te va el dinero, como Supermercado o Comida fuera.</p>
          <Button className="mt-4" onClick={() => setEditing('new')}>Crear el primero</Button>
        </div>
      )}

      {d && !!d.items.length && (
        <>
          <section aria-label={`Total de ${monthLabel(nav.month)}`} className="mt-6 rounded-2xl bg-surface p-5">
            <p className="text-sm text-muted">{monthLabel(nav.month)}{nav.isCurrent ? `, día ${d.daysElapsed} de ${d.daysInMonth}` : ''}</p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums">
              {money(spent, 'USD')} <span className="text-lg font-semibold text-muted">de {money(total, 'USD')}</span>
            </p>
            <Progress className="mt-3 h-3" pct={total ? (spent / total) * 100 : 0} tone={spent > total ? 'expense' : spent > total * 0.8 ? 'warning' : 'accent'} label="Total gastado" />
            {nav.isCurrent && (
              // Marca dónde "debería" ir el gasto si fuera parejo durante el mes
              <p className="mt-2 text-xs text-muted">A esta altura del mes, un gasto parejo iría por {money((total * d.daysElapsed) / d.daysInMonth, 'USD')}.</p>
            )}
          </section>

          <ul className="mt-4 flex flex-col gap-3">
            {d.items.map((b) => (
              <li key={b.id}>
                <button onClick={() => setEditing(b)} className="w-full rounded-2xl bg-surface p-4 text-left hover:bg-white/70">
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden className="size-2.5 shrink-0 translate-y-[-1px] rounded-full" style={{ background: b.color }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{b.name}</span>
                    <span className="tabular-nums font-semibold">{money(b.spentUsd, 'USD')}</span>
                    <span className="text-sm tabular-nums text-muted">/ {money(b.amountUsd, 'USD')}</span>
                  </div>
                  <Progress className="mt-2" pct={b.pct} tone={budgetTone(b.status)} label={`${b.name}: ${b.pct} %`} />
                  <p className={cn('mt-2 text-xs', b.status === 'over' ? 'text-expense' : b.status === 'warning' ? 'text-warning' : 'text-muted')}>
                    {b.status === 'over'
                      ? `Te pasaste por ${money(-Number(b.remainingUsd), 'USD')}.`
                      : `Quedan ${money(b.remainingUsd, 'USD')} (${100 - b.pct} %).`}
                    {nav.isCurrent && b.status !== 'over' && Number(b.projectedUsd) > Number(b.amountUsd) && ` A este ritmo cerrarás en ${money(b.projectedUsd, 'USD')}.`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nuevo presupuesto' : 'Editar presupuesto'}>
        {editing && <BudgetForm budget={editing === 'new' ? undefined : editing} taken={d?.items.map((i) => i.categoryId) ?? []} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function BudgetForm({ budget, taken, onDone }: { budget?: BudgetItem; taken: string[]; onDone: () => void }) {
  const { data: categories = [] } = useCategories();
  const options = categories.filter((c) => c.type === 'EXPENSE' && (c.id === budget?.categoryId || !taken.includes(c.id)));
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: { categoryId: string; amountUsd: string }) => api('/budgets', { method: 'PUT', json: b }), ['budgets']);
  const del = useApiMutation(() => api(`/budgets/${budget!.id}`, { method: 'DELETE' }), ['budgets']);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save.mutateAsync({ categoryId: String(fd.get('categoryId')), amountUsd: String(fd.get('amountUsd')).replace(/\s/g, '').replace(',', '.') });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!budget && !options.length) return <p className="text-sm text-muted">Todas tus categorías de gasto ya tienen presupuesto.</p>;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Categoría" hint="Incluye sus subcategorías">
        <Select name="categoryId" defaultValue={budget?.categoryId ?? options[0]?.id} disabled={!!budget}>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {budget && <input type="hidden" name="categoryId" value={budget.categoryId} />}
      </Field>
      <Field label="Tope mensual (USD)">
        <Input name="amountUsd" inputMode="decimal" defaultValue={budget ? String(Number(budget.amountUsd)).replace('.', ',') : ''} placeholder="Ej. 250" required autoFocus />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        {budget && <Button type="button" variant="danger" onClick={async () => { await del.mutateAsync(undefined); onDone(); }}>Quitar</Button>}
        <Button type="submit" className="ml-auto" disabled={save.isPending}>{budget ? 'Guardar' : 'Crear presupuesto'}</Button>
      </div>
    </form>
  );
}
