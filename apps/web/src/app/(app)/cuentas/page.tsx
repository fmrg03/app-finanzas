'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { useAccounts } from '@/lib/queries';
import { ACCOUNT_LABEL, type Account, type AccountType, type Currency } from '@/lib/types';

export default function CuentasPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts = [], isPending, error } = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

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
            <li key={a.id}>
              <button onClick={() => setEditing(a)} className={cn('flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-canvas/60', a.archivedAt && 'opacity-60')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="text-xs text-muted">{ACCOUNT_LABEL[a.type]}{a.archivedAt ? ', archivada' : ''}</span>
                </span>
                <span className={cn('text-lg font-extrabold tabular-nums', Number(a.balance) < 0 && 'text-expense')}>{money(a.balance, a.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-4 inline-flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-accent" />
          Mostrar archivadas
        </label>
      </div>

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
