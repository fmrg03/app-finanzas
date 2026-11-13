'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Plus, Scale } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money, rate } from '@/lib/format';
import { useApiMutation } from '@/lib/planning';
import { useAccounts } from '@/lib/queries';
import { ACCOUNT_LABEL, type Account, type AccountType, type Currency, type Reconciliation } from '@/lib/types';

export default function CuentasPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts = [], isPending, error } = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [reconciling, setReconciling] = useState<Account | null>(null);

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Cuentas</h1>
        <Button onClick={() => setEditing('new')}><Plus size={18} /> Nueva cuenta</Button>
      </header>
      <p className="mt-1 text-muted">Dónde está tu dinero. Cada cuenta lleva su saldo en su propia moneda.</p>

      <div className="mt-6">
        {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
        {isPending && <p className="py-12 text-center text-muted">Cargando…</p>}
        {!isPending && !accounts.length && (
          <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="font-semibold">Aún no tienes cuentas</p>
            <p className="mt-1 text-sm text-muted">Crea al menos una, por ejemplo Efectivo en dólares o tu cuenta del banco en bolívares.</p>
          </div>
        )}
        <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-col sm:flex-row sm:items-stretch">
              <button onClick={() => setEditing(a)} className={cn('flex min-w-0 flex-1 flex-col gap-1 px-4 py-4 text-left hover:bg-canvas/60 sm:pr-2', a.archivedAt && 'opacity-60')}>
                <span className="flex w-full items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-semibold">{a.name}</span>
                  <span className={cn('shrink-0 text-lg font-extrabold tabular-nums', Number(a.balance) < 0 && 'text-expense')}>{money(a.balance, a.currency)}</span>
                </span>
                <span className="flex w-full flex-wrap items-start justify-between gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>
                    {ACCOUNT_LABEL[a.type]}{a.archivedAt ? ', archivada' : ''} · {a.lastReconciliation ? `conciliada el ${shortDate(a.lastReconciliation.date)}` : 'nunca conciliada'}
                  </span>
                  {(a.costRate && Number(a.balance) > 0) || Number(a.reserved) > 0 ? (
                    <span className="ml-auto flex flex-col items-end tabular-nums">
                      {a.costRate && Number(a.balance) > 0 && (
                        <span title="Tasa promedio a la que compraste los bolívares de esta cuenta">Comprados a {rate(a.costRate)} Bs/$</span>
                      )}
                      {Number(a.reserved) > 0 && (
                        <span title={a.reservedFor.map((r) => `${r.description}: ${money(r.amount, a.currency)}`).join('\n')}>
                          {money(a.reserved, a.currency)} apartado · libre {money(Number(a.balance) - Number(a.reserved), a.currency)}
                        </span>
                      )}
                    </span>
                  ) : null}
                </span>
              </button>
              {!a.archivedAt && (
                // En el teléfono, barra abajo; en pantallas grandes, columnas a la derecha
                <span className="grid grid-cols-2 border-t border-line sm:flex sm:border-t-0">
                  <button
                    onClick={() => setReconciling(a)}
                    title="Comparar con el saldo real del banco"
                    className="flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold text-accent hover:bg-canvas/60 sm:w-20 sm:flex-col sm:gap-0.5 sm:border-l sm:border-line sm:py-0 sm:text-xs"
                  >
                    <Scale size={17} /> Conciliar
                  </button>
                  <Link
                    href={`/importar?cuenta=${a.id}`}
                    title="Importar el estado de cuenta del banco"
                    className="flex items-center justify-center gap-1.5 border-l border-line py-2.5 text-sm font-semibold text-accent hover:bg-canvas/60 sm:w-20 sm:flex-col sm:gap-0.5 sm:py-0 sm:text-xs"
                  >
                    <FileUp size={17} /> Importar
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
        <label className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent" />
          Mostrar archivadas
        </label>
      </div>

      <Dialog open={reconciling !== null} onOpenChange={(o) => !o && setReconciling(null)} title={reconciling ? `Conciliar ${reconciling.name}` : 'Conciliar'}>
        {reconciling && <ReconcileForm account={reconciling} onDone={() => setReconciling(null)} />}
      </Dialog>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nueva cuenta' : 'Editar cuenta'}>
        {editing && <AccountForm account={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function AccountForm({ account, onDone }: { account?: Account; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['accounts'] }); onDone(); };
  const mut = useMutation({
    mutationFn: (body: object) => (account ? api(`/accounts/${account.id}`, { method: 'PATCH', json: body }) : api('/accounts', { method: 'POST', json: body })),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });
  const del = useMutation({ mutationFn: () => api(`/accounts/${account!.id}`, { method: 'DELETE' }), onSuccess: done, onError: (e) => setError(e.message) });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    mut.mutate({
      name: String(fd.get('name')),
      type: fd.get('type') as AccountType,
      currency: fd.get('currency') as Currency,
      initialBalance: String(fd.get('initialBalance') || '0').replace(',', '.'),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Nombre"><Input name="name" defaultValue={account?.name} required maxLength={60} placeholder="Ej. Banesco, Efectivo $" autoFocus /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tipo">
          <Select name="type" defaultValue={account?.type ?? 'BANK'}>
            {Object.entries(ACCOUNT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Moneda" hint={account ? 'No se puede cambiar si ya tiene movimientos' : undefined}>
          <Select name="currency" defaultValue={account?.currency ?? 'USD'}>
            <option value="USD">Dólares</option>
            <option value="VES">Bolívares</option>
          </Select>
        </Field>
      </div>
      <Field label="Saldo inicial" hint="Lo que tenía la cuenta antes de empezar a registrar">
        <Input name="initialBalance" inputMode="decimal" defaultValue={account?.initialBalance ?? ''} placeholder="0,00" />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        {account && (
          <>
            <Button type="button" variant="ghost" onClick={() => mut.mutate({ archived: !account.archivedAt })}>
              {account.archivedAt ? 'Reactivar' : 'Archivar'}
            </Button>
            <Button type="button" variant="danger" onClick={() => confirm('¿Eliminar esta cuenta?') && del.mutate()}>Eliminar</Button>
          </>
        )}
        <Button type="submit" disabled={mut.isPending} className="ml-auto">{account ? 'Guardar cambios' : 'Crear cuenta'}</Button>
      </div>
    </form>
  );
}

const shortDate = (iso: string) => iso.split('-').reverse().join('/');
const num = (s: string) => Number(s.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

/** Comparas con el saldo real del banco; si no cuadra, la diferencia queda como ajuste (no es ingreso ni gasto). */
function ReconcileForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const [real, setReal] = useState('');
  const [note, setNote] = useState('');
  const history = useQuery({ queryKey: ['accounts', account.id, 'reconciliations'], queryFn: () => api<Reconciliation[]>(`/accounts/${account.id}/reconciliations`) });
  const save = useApiMutation(() => api<Reconciliation>(`/accounts/${account.id}/reconcile`, {
    method: 'POST', json: { realBalance: num(real).toFixed(2), ...(note.trim() ? { note: note.trim() } : {}) },
  }), ['accounts']);
  const undo = useApiMutation((id: string) => api(`/accounts/reconciliations/${id}`, { method: 'DELETE' }), ['accounts']);
  const c = account.currency;
  const value = num(real);
  const valid = real.trim() !== '' && Number.isFinite(value);
  const diff = valid ? Math.round((value - Number(account.balance)) * 100) / 100 : 0;
  const done = save.data;

  if (done) {
    const adj = Number(done.adjustment);
    return (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={20} className="text-income" /> {adj === 0 ? '¡Cuadra!' : 'Listo, ya cuadra'}</p>
        <p className="text-sm text-muted">
          {adj === 0
            ? `${account.name} tiene ${money(done.realBalance, c)}, igual que en tu banco. Queda anotado que cuadró hoy.`
            : `Se registró un ajuste de ${adj > 0 ? '+' : '−'}${money(Math.abs(adj), c)}. Ahora la app muestra ${money(done.realBalance, c)}, igual que tu banco. El ajuste no cuenta como ingreso ni gasto.`}
        </p>
        <Button onClick={onDone} className="self-end">Listo</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-canvas px-4 py-3">
        <p className="text-sm text-muted">Según la app</p>
        <p className="text-2xl font-extrabold tabular-nums">{money(account.balance, c)}</p>
      </div>
      <Field label={`¿Cuánto ves en ${account.name} ahora mismo?`} hint="El saldo real del banco, Binance o lo que tienes en la mano">
        <Input autoFocus inputMode="decimal" value={real} onChange={(e) => setReal(e.target.value)} placeholder={c === 'USD' ? '0,00 $' : '0,00 Bs'} className="text-lg tabular-nums" />
      </Field>
      {valid && (
        <div className={cn('rounded-xl px-4 py-3 text-sm', diff === 0 ? 'bg-income-soft' : 'bg-warning-soft')}>
          {diff === 0 ? (
            <p className="font-semibold text-income">Cuadra exacto.</p>
          ) : (
            <>
              <p>
                Diferencia: <strong className={cn('tabular-nums', diff > 0 ? 'text-income' : 'text-expense')}>{diff > 0 ? '+' : '−'}{money(Math.abs(diff), c)}</strong>
                {diff < 0 ? ' (tienes menos de lo que dice la app)' : ' (tienes más de lo que dice la app)'}
              </p>
              <p className="mt-1 text-muted">
                Si falta algún movimiento (una comisión, un gasto que no anotaste), lo mejor es registrarlo. Si no sabes de dónde viene, concilia y se registra un ajuste por la diferencia.
              </p>
            </>
          )}
        </div>
      )}
      {valid && diff !== 0 && (
        <Field label="Nota (opcional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. comisiones del mes" maxLength={120} /></Field>
      )}
      {save.error && <ErrorNote>{save.error.message}</ErrorNote>}
      <Button disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>
        {save.isPending ? 'Guardando…' : diff === 0 ? 'Marcar como conciliada' : 'Conciliar y ajustar'}
      </Button>

      {!!history.data?.length && (
        <section aria-label="Conciliaciones anteriores" className="border-t border-line pt-3">
          <h3 className="text-sm font-semibold">Anteriores</h3>
          <ul className="mt-1 divide-y divide-line text-sm">
            {history.data.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span className="w-20 shrink-0 tabular-nums text-muted">{shortDate(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {Number(r.adjustment) === 0 ? 'Cuadró' : `Ajuste ${Number(r.adjustment) > 0 ? '+' : '−'}${money(Math.abs(Number(r.adjustment)), c)}`}
                  {r.note && <span className="text-muted"> · {r.note}</span>}
                </span>
                <button onClick={() => confirm('¿Deshacer esta conciliación? Su ajuste se quita del saldo.') && undo.mutate(r.id)} className="text-xs text-muted hover:text-expense">Deshacer</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
