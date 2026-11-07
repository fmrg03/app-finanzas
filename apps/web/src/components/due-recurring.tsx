'use client';

import { PiggyBank, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorNote, Input } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { dayLabel, money } from '@/lib/format';
import { useApiMutation, useRecurringDue, useReservesDue } from '@/lib/planning';
import type { Recurring } from '@/lib/types';

/** Pagos recurrentes que ya tocan y esperan confirmación (con el monto real de esta vez). */
export function DueRecurring() {
  return (
    <>
      <DuePayments />
      <DueReserves />
    </>
  );
}

function DuePayments() {
  const { data = [] } = useRecurringDue();
  if (!data.length) return null;
  return (
    <section aria-labelledby="pendientes" className="mt-6 rounded-2xl border border-warning/30 bg-warning-soft p-4">
      <h2 id="pendientes" className="flex items-center gap-2 font-bold">
        <Repeat size={18} className="text-warning" /> {data.length === 1 ? 'Un recurrente por confirmar' : `${data.length} recurrentes por confirmar`}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {data.map((r) => <DueItem key={r.id} r={r} />)}
      </ul>
    </section>
  );
}

function DueItem({ r }: { r: Recurring }) {
  const [amount, setAmount] = useState(String(Number(r.amount)).replace('.', ','));
  const confirm = useApiMutation(() => api(`/recurring/${r.id}/confirm`, { method: 'POST', json: { amount: amount.replace(/\s/g, '').replace(',', '.') } }));
  const skip = useApiMutation(() => api(`/recurring/${r.id}/skip`, { method: 'POST' }));
  const err = confirm.error ?? skip.error;
  return (
    <li className="rounded-xl bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="truncate font-semibold">{r.description}</p>
          <p className="text-xs text-muted">{dayLabel(r.nextDate)}, {r.account.name}. De costumbre: {money(r.amount, r.currency)}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`amt-${r.id}`}>Monto de esta vez</label>
          <Input id={`amt-${r.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 min-w-0 flex-1 text-right tabular-nums sm:w-28 sm:flex-none" />
          <span className="text-sm text-muted">{r.currency === 'USD' ? 'USD' : 'Bs'}</span>
          <Button className="h-9" onClick={() => confirm.mutate(undefined)} disabled={confirm.isPending || skip.isPending}>Registrar</Button>
          <Button variant="ghost" className="h-9 px-3" onClick={() => skip.mutate(undefined)} disabled={confirm.isPending || skip.isPending}>Saltar</Button>
        </div>
      </div>
      {err && <div className="mt-2"><ErrorNote>{err.message}</ErrorNote></div>}
    </li>
  );
}

/** Apartados del mes por confirmar: el dinero no se mueve, queda reservado para el pago de varios meses. */
function DueReserves() {
  const { data = [] } = useReservesDue();
  const items = data.filter((r) => Number(r.reserveStatus?.suggested ?? 0) > 0);
  if (!items.length) return null;
  return (
    <section aria-labelledby="apartar" className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft/60 p-4">
      <h2 id="apartar" className="flex items-center gap-2 font-bold">
        <PiggyBank size={18} className="text-accent" /> {items.length === 1 ? 'Un apartado por confirmar' : `${items.length} apartados por confirmar`}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((r) => <ReserveItem key={r.id} r={r} />)}
      </ul>
    </section>
  );
}

function ReserveItem({ r }: { r: Recurring }) {
  const st = r.reserveStatus!;
  const [amount, setAmount] = useState(String(Number(st.suggested)).replace('.', ','));
  const confirm = useApiMutation(() => api(`/recurring/${r.id}/reserve`, { method: 'POST', json: { amount: amount.replace(/\s/g, '').replace(',', '.') } }));
  const skip = useApiMutation(() => api(`/recurring/${r.id}/reserve/skip`, { method: 'POST' }));
  const err = confirm.error ?? skip.error;
  const busy = confirm.isPending || skip.isPending;
  return (
    <li className="rounded-xl bg-surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 sm:flex-1">
          <p className="truncate font-semibold">Apartar para {r.description}</p>
          <p className="text-xs text-muted">
            Llevas {money(st.balance, r.currency)} de {money(r.amount, r.currency)}. Se paga el {dayLabel(r.nextDate).toLowerCase()} desde {r.account.name}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`res-${r.id}`}>Monto a apartar</label>
          <Input id={`res-${r.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 min-w-0 flex-1 text-right tabular-nums sm:w-28 sm:flex-none" />
          <span className="text-sm text-muted">{r.currency === 'USD' ? 'USD' : 'Bs'}</span>
          <Button className="h-9" onClick={() => confirm.mutate(undefined)} disabled={busy}>Apartar</Button>
          <Button variant="ghost" className="h-9 px-3" onClick={() => skip.mutate(undefined)} disabled={busy}>Saltar</Button>
        </div>
      </div>
      {err && <div className="mt-2"><ErrorNote>{err.message}</ErrorNote></div>}
    </li>
  );
}
