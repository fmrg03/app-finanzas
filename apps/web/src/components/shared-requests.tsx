'use client';

import { Check, Clock, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, dayLabel, money } from '@/lib/format';
import { useApiMutation, useSharedRequests } from '@/lib/planning';
import { useAccounts, useCategories } from '@/lib/queries';
import type { SharedRequest } from '@/lib/types';

const FREQ: Record<string, string> = { DAYS_14: 'cada 14 días', DAYS_15: 'cada 15 días', MONTHLY: 'cada mes' };

/**
 * Compras compartidas que pagó un familiar: las que te mandaron para confirmar (aceptar o rechazar)
 * y las que mandaste tú y siguen esperando.
 */
export function SharedRequests() {
  const { data } = useSharedRequests();
  if (!data || (!data.incoming.length && !data.outgoing.length)) return null;
  return (
    <>
      {!!data.incoming.length && (
        <section aria-labelledby="por-confirmar" className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft/60 p-4">
          <h2 id="por-confirmar" className="flex items-center gap-2 font-bold">
            <Users size={18} className="text-accent" />
            {data.incoming.length === 1 ? 'Una compra compartida por confirmar' : `${data.incoming.length} compras compartidas por confirmar`}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.incoming.map((r) => <Incoming key={r.id} r={r} />)}
          </ul>
        </section>
      )}
      {!!data.outgoing.length && (
        <section aria-label="Esperando confirmación" className="mt-4 rounded-2xl bg-surface p-4">
          <ul className="flex flex-col divide-y divide-line">
            {data.outgoing.map((r) => <Outgoing key={r.id} r={r} />)}
          </ul>
        </section>
      )}
    </>
  );
}

function Summary({ r }: { r: SharedRequest }) {
  const what = r.description ?? r.categoryName ?? 'Compra';
  return (
    <>
      <p className="font-semibold">
        {what} <span className="tabular-nums">{money(r.amount, r.currency)}</span>
        {r.currency === 'VES' && <span className="font-normal text-muted"> ({money(r.totalUsd, 'USD')})</span>}
      </p>
      <p className="text-xs text-muted">
        {dayLabel(r.date)}{r.categoryName && r.description ? ` · ${r.categoryName}` : ''}
        {r.installments && ` · ${r.installments.provider}: inicial ${money(r.installments.downPaymentUsd, 'USD')} y ${r.installments.count} cuotas ${FREQ[r.installments.frequency] ?? ''}`}
      </p>
      <ul className="mt-2 flex flex-col gap-0.5 text-sm">
        {r.parts.map((p, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className={cn(p.me && 'font-semibold')}>
              {p.me ? 'Tú' : p.name}
              {p.role === 'PAYER' && <span className="ml-1.5 text-xs font-normal text-muted">pagó</span>}
            </span>
            <span className="tabular-nums">{money(p.amountUsd, 'USD')}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Incoming({ r }: { r: SharedRequest }) {
  const { data: accounts = [] } = useAccounts();
  const { data: cats = [] } = useCategories();
  const expenseCats = cats.filter((c) => c.type === 'EXPENSE');
  const sameCat = expenseCats.find((c) => c.name.toLowerCase() === (r.categoryName ?? '').toLowerCase());
  const [mode, setMode] = useState<'view' | 'accept' | 'reject'>('view');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const accept = useApiMutation(() =>
    api(`/shared-requests/${r.id}/accept`, { method: 'POST', json: { accountId: accountId || accounts[0]?.id, categoryId: categoryId ?? sameCat?.id ?? null } }));
  const reject = useApiMutation(() => api(`/shared-requests/${r.id}/reject`, { method: 'POST', json: reason.trim() ? { reason: reason.trim() } : {} }), ['shared-requests']);
  const err = accept.error ?? reject.error;
  const others = r.parts.filter((p) => !p.me && p.amountUsd !== '0.00');
  const active = accounts.filter((a) => !a.archivedAt);

  return (
    <li className="rounded-xl bg-surface p-3">
      <p className="mb-1 text-sm text-muted"><strong className="text-ink">{r.from?.name}</strong> registró una compra que pagaste tú{r.installments ? ' en cuotas' : ''}:</p>
      <Summary r={r} />
      {others.length > 0 && (
        <p className="mt-1 text-xs text-muted">Si la aceptas, quedan como deudas contigo: {others.map((p) => `${p.name} ${money(p.amountUsd, 'USD')}`).join(', ')}.</p>
      )}

      {mode === 'accept' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={r.installments ? '¿Con qué cuenta pagaste la inicial?' : '¿De qué cuenta salió?'}>
            <Select value={accountId || active[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)}>
              {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'})</option>)}
            </Select>
          </Field>
          <Field label="Categoría">
            <Select value={categoryId ?? sameCat?.id ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {!active.length && <p className="text-sm text-expense sm:col-span-2">Primero crea una cuenta en Cuentas.</p>}
        </div>
      )}
      {mode === 'reject' && (
        <div className="mt-3">
          <Field label="¿Por qué? (opcional, le llega a quien la registró)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Esa no la pagué yo" />
          </Field>
        </div>
      )}
      {err && <div className="mt-2"><ErrorNote>{err.message}</ErrorNote></div>}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {mode === 'view' && (
          <>
            <Button variant="ghost" className="h-9" onClick={() => setMode('reject')}><X size={16} /> Rechazar</Button>
            <Button className="h-9" onClick={() => setMode('accept')}><Check size={16} /> Aceptar</Button>
          </>
        )}
        {mode === 'accept' && (
          <>
            <Button variant="ghost" className="h-9" onClick={() => { setMode('view'); accept.reset(); }}>Volver</Button>
            <Button className="h-9" disabled={accept.isPending || !active.length} onClick={() => accept.mutate(undefined)}>
              {accept.isPending ? 'Registrando…' : 'Aceptar y registrar'}
            </Button>
          </>
        )}
        {mode === 'reject' && (
          <>
            <Button variant="ghost" className="h-9" onClick={() => { setMode('view'); reject.reset(); }}>Volver</Button>
            <Button variant="danger" className="h-9" disabled={reject.isPending} onClick={() => reject.mutate(undefined)}>Rechazar compra</Button>
          </>
        )}
      </div>
    </li>
  );
}

function Outgoing({ r }: { r: SharedRequest }) {
  const cancel = useApiMutation(() => api(`/shared-requests/${r.id}`, { method: 'DELETE' }), ['shared-requests']);
  const mine = r.parts.find((p) => p.me);
  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <Clock size={16} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate">
          Esperando que <strong>{r.to?.name}</strong> confirme {r.description ?? r.categoryName ?? 'la compra'} ({money(r.amount, r.currency)})
        </p>
        {mine && <p className="text-xs text-muted">Tu parte: {money(mine.amountUsd, 'USD')}</p>}
        {cancel.error && <p className="text-xs text-expense">{cancel.error.message}</p>}
      </div>
      <button
        onClick={() => confirm('¿Retirar esta compra? A quien pagó ya no le aparecerá para confirmar.') && cancel.mutate(undefined)}
        className="text-xs font-semibold text-muted hover:text-expense"
        disabled={cancel.isPending}
      >
        Retirar
      </button>
    </li>
  );
}
