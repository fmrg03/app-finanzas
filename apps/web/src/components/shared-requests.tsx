'use client';

import { Check, Clock, Users, X } from 'lucide-react';
import { Fragment, useState } from 'react';
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
            {data.incoming.length === 1 ? (data.incoming[0].change ? 'Un cambio por confirmar' : 'Una compra compartida por confirmar') : `${data.incoming.length} compras o cambios por confirmar`}
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
  if (r.before) return <ChangeSummary r={r} />;
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

/** Un cambio: cómo está y cómo quedaría, parte por parte. */
function ChangeSummary({ r }: { r: SharedRequest }) {
  const b = r.before!;
  const changed = (x: string | null, y: string | null) => (x ?? '') !== (y ?? '');
  const names = [...new Set([...b.parts, ...r.parts].map((p) => `${p.role}:${p.name}`))];
  const find = (list: SharedRequest['parts'], key: string) => list.find((p) => `${p.role}:${p.name}` === key);
  return (
    <div className="text-sm">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span />
        <span className="text-right text-xs text-muted">Ahora</span>
        <span className="text-right text-xs font-semibold">Quedaría</span>
        <span className="text-muted">Concepto</span>
        <span className="text-right text-muted">{b.description ?? '—'}</span>
        <span className={cn('text-right', changed(b.description, r.description) && 'font-semibold text-accent')}>{r.description ?? '—'}</span>
        <span className="text-muted">Monto</span>
        <span className="text-right text-muted">{money(b.amount, b.currency)}</span>
        <span className={cn('text-right', (b.amount !== r.amount || b.currency !== r.currency) && 'font-semibold text-accent')}>{money(r.amount, r.currency)}</span>
        <span className="text-muted">Fecha</span>
        <span className="text-right text-muted">{dayLabel(b.date)}</span>
        <span className={cn('text-right', b.date !== r.date && 'font-semibold text-accent')}>{dayLabel(r.date)}</span>
        {b.installments && r.installments && (
          <>
            <span className="text-muted">Inicial</span>
            <span className="text-right text-muted">{money(b.installments.downPaymentUsd, 'USD')}</span>
            <span className={cn('text-right', b.installments.downPaymentUsd !== r.installments.downPaymentUsd && 'font-semibold text-accent')}>{money(r.installments.downPaymentUsd, 'USD')}</span>
            <span className="text-muted">Cuotas</span>
            <span className="text-right text-muted">{b.installments.count} {FREQ[b.installments.frequency] ?? ''}</span>
            <span className={cn('text-right', (b.installments.count !== r.installments.count || b.installments.frequency !== r.installments.frequency) && 'font-semibold text-accent')}>
              {r.installments.count} {FREQ[r.installments.frequency] ?? ''}
            </span>
          </>
        )}
        {names.map((k) => {
          const x = find(b.parts, k); const y = find(r.parts, k);
          const label = (y ?? x)!;
          return (
            <Fragment key={k}>
              <span className={cn(label.me && 'font-semibold')}>
                {label.me ? 'Tú' : label.name}{label.role === 'PAYER' && <span className="ml-1.5 text-xs font-normal text-muted">pagó</span>}
              </span>
              <span className="text-right text-muted">{x ? money(x.amountUsd, 'USD') : '—'}</span>
              <span className={cn('text-right', x?.amountUsd !== y?.amountUsd && 'font-semibold text-accent')}>{y ? money(y.amountUsd, 'USD') : '—'}</span>
            </Fragment>
          );
        })}
      </div>
    </div>
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
    api(`/shared-requests/${r.id}/accept`, {
      method: 'POST',
      json: r.change ? {} : { accountId: accountId || accounts[0]?.id, categoryId: categoryId ?? sameCat?.id ?? null },
    }));
  const reject = useApiMutation(() => api(`/shared-requests/${r.id}/reject`, { method: 'POST', json: reason.trim() ? { reason: reason.trim() } : {} }), ['shared-requests']);
  const err = accept.error ?? reject.error;
  const others = r.parts.filter((p) => !p.me && p.amountUsd !== '0.00');
  const active = accounts.filter((a) => !a.archivedAt);

  return (
    <li className="rounded-xl bg-surface p-3">
      <p className="mb-1 text-sm text-muted">
        <strong className="text-ink">{r.from?.name}</strong>{' '}
        {r.change ? `propone un cambio en ${r.before?.description ?? 'una compra que pagaste tú'}:` : `registró una compra que pagaste tú${r.installments ? ' en cuotas' : ''}:`}
      </p>
      <Summary r={r} />
      {others.length > 0 && !r.change && (
        <p className="mt-1 text-xs text-muted">Si la aceptas, quedan como deudas contigo: {others.map((p) => `${p.name} ${money(p.amountUsd, 'USD')}`).join(', ')}.</p>
      )}

      {mode === 'accept' && r.change && (
        <p className="mt-3 text-sm text-muted">Se cambia en tu cuenta (misma cuenta y categoría) y en la suya, con las deudas recalculadas.</p>
      )}
      {mode === 'accept' && !r.change && (
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
              {accept.isPending ? 'Registrando…' : r.change ? 'Aceptar cambio' : 'Aceptar y registrar'}
            </Button>
          </>
        )}
        {mode === 'reject' && (
          <>
            <Button variant="ghost" className="h-9" onClick={() => { setMode('view'); reject.reset(); }}>Volver</Button>
            <Button variant="danger" className="h-9" disabled={reject.isPending} onClick={() => reject.mutate(undefined)}>{r.change ? 'Rechazar cambio' : 'Rechazar compra'}</Button>
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
          Esperando que <strong>{r.to?.name}</strong> {r.change ? `acepte el cambio en ${r.before?.description ?? 'la compra'}` : `confirme ${r.description ?? r.categoryName ?? 'la compra'}`} ({money(r.amount, r.currency)})
        </p>
        {mine && <p className="text-xs text-muted">Tu parte: {money(mine.amountUsd, 'USD')}</p>}
        {cancel.error && <p className="text-xs text-expense">{cancel.error.message}</p>}
      </div>
      <button
        onClick={() => confirm(r.change ? '¿Retirar este cambio? La compra queda como está.' : '¿Retirar esta compra? A quien pagó ya no le aparecerá para confirmar.') && cancel.mutate(undefined)}
        className="text-xs font-semibold text-muted hover:text-expense"
        disabled={cancel.isPending}
      >
        Retirar
      </button>
    </li>
  );
}
