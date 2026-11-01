'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Progress } from '@/components/progress';
import { Button, ErrorNote, Field, Input } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { useApiMutation, useGoals } from '@/lib/planning';
import type { Goal } from '@/lib/types';

const dmy = (d: string) => d.split('-').reverse().join('/');
const toApi = (s: string) => s.replace(/\s/g, '').replace(',', '.');

export default function MetasPage() {
  const { data = [], isPending, error } = useGoals();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const active = data.filter((g) => !g.archivedAt);
  const archived = data.filter((g) => g.archivedAt);

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Metas de ahorro</h1>
        <Button onClick={() => setEditing('new')}><Plus size={18} /> Nueva</Button>
      </header>
      <p className="mt-1 text-muted">Lo que vas apartando para algo. Los montos van en dólares.</p>

      {error && <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div>}
      {!isPending && !data.length && (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">Sin metas todavía</p>
          <p className="mt-1 text-sm text-muted">Por ejemplo: fondo de emergencia de $1.500, o un viaje para diciembre.</p>
          <Button className="mt-4" onClick={() => setEditing('new')}>Crear una meta</Button>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {active.map((g) => <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} />)}
      </div>
      {!!archived.length && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Archivadas</h2>
          <div className="mt-2 grid gap-4 opacity-70 sm:grid-cols-2">{archived.map((g) => <GoalCard key={g.id} g={g} onEdit={() => setEditing(g)} />)}</div>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva meta' : 'Editar meta'}>
        {editing && <GoalForm goal={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function GoalCard({ g, onEdit }: { g: Goal; onEdit: () => void }) {
  const [amount, setAmount] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const add = useApiMutation((v: string) => api(`/goals/${g.id}/contributions`, { method: 'POST', json: { amountUsd: v } }), ['goals']);
  const removeC = useApiMutation((cid: string) => api(`/goals/${g.id}/contributions/${cid}`, { method: 'DELETE' }), ['goals']);
  const done = Number(g.remainingUsd) <= 0;

  async function contribute(sign: 1 | -1) {
    const v = Number(toApi(amount));
    if (!(v > 0)) return;
    await add.mutateAsync(String(sign * v));
    setAmount('');
  }

  return (
    <article className="flex flex-col rounded-2xl bg-surface p-5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
        <h2 className="flex-1 font-bold">{g.name}</h2>
        <button onClick={onEdit} className="text-sm font-semibold text-accent hover:underline">Editar</button>
      </div>
      <p className="mt-3 text-2xl font-extrabold tabular-nums">
        {money(g.savedUsd, 'USD')} <span className="text-base font-semibold text-muted">de {money(g.targetUsd, 'USD')}</span>
      </p>
      <Progress className="mt-2" pct={g.pct} tone={done ? 'income' : 'accent'} label={`${g.name}: ${g.pct} %`} />
      <p className={cn('mt-2 text-sm', g.overdue ? 'text-expense' : 'text-muted')}>
        {done
          ? 'Meta cumplida.'
          : g.targetDate
            ? g.overdue
              ? `La fecha (${dmy(g.targetDate)}) ya pasó y faltan ${money(g.remainingUsd, 'USD')}.`
              : `Faltan ${money(g.remainingUsd, 'USD')} para el ${dmy(g.targetDate)}: unos ${money(g.monthlyNeededUsd ?? 0, 'USD')} al mes.`
            : `Faltan ${money(g.remainingUsd, 'USD')}.`}
      </p>
      {!g.archivedAt && (
        <div className="mt-4 flex items-center gap-2">
          <label className="sr-only" htmlFor={`g-${g.id}`}>Monto en USD</label>
          <Input id={`g-${g.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="USD" className="h-9 flex-1 tabular-nums" />
          <Button className="h-9" onClick={() => contribute(1)} disabled={add.isPending}>Aportar</Button>
          <Button variant="ghost" className="h-9" onClick={() => contribute(-1)} disabled={add.isPending}>Retirar</Button>
        </div>
      )}
      {add.error && <div className="mt-2"><ErrorNote>{add.error.message}</ErrorNote></div>}
      {!!g.contributions.length && (
        <div className="mt-3">
          <button onClick={() => setShowHistory((v) => !v)} className="text-xs font-semibold text-muted hover:text-ink">
            {showHistory ? 'Ocultar historial' : `Ver historial (${g.contributions.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 divide-y divide-line text-sm">
              {g.contributions.map((c) => (
                <li key={c.id} className="flex items-center gap-2 py-1.5 tabular-nums">
                  <span className="text-muted">{dmy(c.date)}</span>
                  <span className="flex-1 truncate text-muted">{c.note}</span>
                  <span className={cn('font-semibold', Number(c.amountUsd) < 0 && 'text-expense')}>{money(c.amountUsd, 'USD')}</span>
                  <button onClick={() => removeC.mutate(c.id)} className="text-xs text-muted hover:text-expense" aria-label="Borrar aporte">Borrar</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function GoalForm({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: object) => (goal ? api(`/goals/${goal.id}`, { method: 'PATCH', json: b }) : api('/goals', { method: 'POST', json: b })), ['goals']);
  const del = useApiMutation(() => api(`/goals/${goal!.id}`, { method: 'DELETE' }), ['goals']);
  const archive = useApiMutation(() => api(`/goals/${goal!.id}`, { method: 'PATCH', json: { archived: !goal!.archivedAt } }), ['goals']);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save.mutateAsync({ name: String(fd.get('name')), targetUsd: toApi(String(fd.get('targetUsd'))), targetDate: String(fd.get('targetDate')) || null, color: String(fd.get('color')) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex gap-3">
        <Field label="Nombre" className="flex-1"><Input name="name" defaultValue={goal?.name} placeholder="Ej. Fondo de emergencia" required maxLength={80} autoFocus /></Field>
        <Field label="Color"><input type="color" name="color" defaultValue={goal?.color ?? '#1f6f78'} className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface p-1" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Objetivo (USD)"><Input name="targetUsd" inputMode="decimal" defaultValue={goal ? String(Number(goal.targetUsd)).replace('.', ',') : ''} required /></Field>
        <Field label="Para cuándo (opcional)"><Input type="date" name="targetDate" defaultValue={goal?.targetDate ?? ''} /></Field>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        {goal && (
          <>
            <Button type="button" variant="ghost" onClick={async () => { await archive.mutateAsync(undefined); onDone(); }}>{goal.archivedAt ? 'Reactivar' : 'Archivar'}</Button>
            <Button type="button" variant="danger" onClick={async () => { if (confirm('¿Eliminar la meta y su historial?')) { await del.mutateAsync(undefined); onDone(); } }}>Eliminar</Button>
          </>
        )}
        <Button type="submit" className="ml-auto" disabled={save.isPending}>{goal ? 'Guardar' : 'Crear meta'}</Button>
      </div>
    </form>
  );
}
