'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Progress } from '@/components/progress';
import { Button, ErrorNote, Field, Input, Segmented } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { useApiMutation, useDebts } from '@/lib/planning';
import type { Currency, Debt, DebtDirection } from '@/lib/types';

const dmy = (d: string) => d.split('-').reverse().join('/');
const toApi = (s: string) => s.replace(/\s/g, '').replace(',', '.');

export default function DeudasPage() {
  const { data = [], isPending, error } = useDebts();
  const [tab, setTab] = useState<DebtDirection>('I_OWE');
  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const list = data.filter((d) => d.direction === tab);
  const open = list.filter((d) => !d.settledAt);
  const settled = list.filter((d) => d.settledAt);
  const pending = (cur: Currency) => open.filter((d) => d.currency === cur).reduce((s, d) => s + Number(d.remaining), 0);

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Deudas</h1>
        <Button onClick={() => setEditing('new')}><Plus size={18} /> Nueva</Button>
      </header>
      <p className="mt-1 text-muted">Lo que debes y lo que te deben, con sus abonos.</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Segmented<DebtDirection> label="Ver" value={tab} onChange={setTab} options={[{ value: 'I_OWE', label: 'Debo' }, { value: 'OWED_TO_ME', label: 'Me deben' }]} />
        {!!open.length && (
          <p className="text-sm text-muted">
            Pendiente:{' '}
            {[pending('USD') > 0 && money(pending('USD'), 'USD'), pending('VES') > 0 && money(pending('VES'), 'VES')].filter(Boolean).join(' y ')}
          </p>
        )}
      </div>

      {error && <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div>}
      {!isPending && !list.length && (
        <p className="mt-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
          {tab === 'I_OWE' ? 'No tienes deudas registradas.' : 'Nadie te debe nada, por ahora.'}
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-3">{open.map((d) => <DebtCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}</ul>
      {!!settled.length && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Saldadas</h2>
          <ul className="mt-2 flex flex-col gap-3 opacity-70">{settled.map((d) => <DebtCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}</ul>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva deuda' : 'Editar deuda'}>
        {editing && <DebtForm debt={editing === 'new' ? undefined : editing} direction={tab} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function DebtCard({ d, onEdit }: { d: Debt; onEdit: () => void }) {
  const [amount, setAmount] = useState('');
  const pay = useApiMutation((v: string) => api(`/debts/${d.id}/payments`, { method: 'POST', json: { amount: v } }), ['debts']);
  const unpay = useApiMutation((pid: string) => api(`/debts/${d.id}/payments/${pid}`, { method: 'DELETE' }), ['debts']);
  const pct = (Number(d.paid) / Number(d.amount)) * 100;
  return (
    <li className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-bold">{d.person}</span>
        <span className="font-bold tabular-nums">{money(d.remaining, d.currency)}</span>
        <span className="text-sm tabular-nums text-muted">/ {money(d.amount, d.currency)}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {d.description}
        {d.dueDate && <span className={cn(d.overdue && 'font-semibold text-expense')}>{d.description ? '. ' : ''}{d.overdue ? 'Venció' : 'Vence'} el {dmy(d.dueDate)}</span>}
      </p>
      <Progress className="mt-2" pct={pct} tone={d.settledAt ? 'income' : 'accent'} label={`Abonado ${Math.round(pct)} %`} />
      {!d.settledAt && (
        <div className="mt-3 flex items-center gap-2">
          <label className="sr-only" htmlFor={`d-${d.id}`}>Monto del abono</label>
          <Input id={`d-${d.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={d.currency === 'USD' ? 'USD' : 'Bs'} className="h-9 flex-1 tabular-nums" />
          <Button className="h-9" disabled={pay.isPending || !(Number(toApi(amount)) > 0)} onClick={async () => { await pay.mutateAsync(toApi(amount)); setAmount(''); }}>
            {d.direction === 'I_OWE' ? 'Abonar' : 'Registrar pago'}
          </Button>
          <Button variant="ghost" className="h-9" onClick={onEdit}>Editar</Button>
        </div>
      )}
      {d.settledAt && <button onClick={onEdit} className="mt-2 text-sm font-semibold text-accent hover:underline">Editar</button>}
      {pay.error && <div className="mt-2"><ErrorNote>{pay.error.message}</ErrorNote></div>}
      {!!d.payments.length && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {d.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5 tabular-nums">
              <span className="text-muted">{dmy(p.date)}</span>
              <span className="flex-1 truncate text-muted">{p.note}</span>
              <span className="font-semibold">{money(p.amount, d.currency)}</span>
              <button onClick={() => unpay.mutate(p.id)} className="text-xs text-muted hover:text-expense">Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function DebtForm({ debt, direction, onDone }: { debt?: Debt; direction: DebtDirection; onDone: () => void }) {
  const [dir, setDir] = useState<DebtDirection>(debt?.direction ?? direction);
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'USD');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: object) => (debt ? api(`/debts/${debt.id}`, { method: 'PATCH', json: b }) : api('/debts', { method: 'POST', json: b })), ['debts']);
  const del = useApiMutation(() => api(`/debts/${debt!.id}`, { method: 'DELETE' }), ['debts']);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save.mutateAsync({
        direction: dir, currency, person: String(fd.get('person')), description: String(fd.get('description')),
        amount: toApi(String(fd.get('amount'))), dueDate: String(fd.get('dueDate')) || null,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Segmented<DebtDirection> label="Tipo" value={dir} onChange={setDir} options={[{ value: 'I_OWE', label: 'Yo debo' }, { value: 'OWED_TO_ME', label: 'Me deben' }]} />
      <Field label={dir === 'I_OWE' ? 'A quién' : 'Quién'}><Input name="person" defaultValue={debt?.person} required maxLength={80} autoFocus /></Field>
      <Field label="Concepto (opcional)"><Input name="description" defaultValue={debt?.description ?? ''} placeholder="Ej. Préstamo para el carro" maxLength={300} /></Field>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Monto total"><Input name="amount" inputMode="decimal" defaultValue={debt ? String(Number(debt.amount)).replace('.', ',') : ''} required /></Field>
        <Segmented<Currency> label="Moneda" value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
      </div>
      <Field label="Vence (opcional)"><Input type="date" name="dueDate" defaultValue={debt?.dueDate ?? ''} /></Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        {debt && <Button type="button" variant="danger" onClick={async () => { if (confirm('¿Eliminar la deuda y sus abonos?')) { await del.mutateAsync(undefined); onDone(); } }}>Eliminar</Button>}
        <Button type="submit" className="ml-auto" disabled={save.isPending}>{debt ? 'Guardar' : 'Crear'}</Button>
      </div>
    </form>
  );
}
