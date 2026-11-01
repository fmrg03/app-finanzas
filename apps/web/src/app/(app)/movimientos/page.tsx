'use client';

import { ArrowRight, CreditCard, Download, Plus, Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AmountPair } from '@/components/amount';
import { DueRecurring } from '@/components/due-recurring';
import { MonthNav, useMonth } from '@/components/month-nav';
import { TransactionForm } from '@/components/transaction-form';
import { TransferForm } from '@/components/transfer-form';
import { Button, ErrorNote, Input, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { downloadFile } from '@/lib/api';
import { cn, dayLabel, money, monthLabel, monthRange, rate, signedPct } from '@/lib/format';
import { useTransfers } from '@/lib/planning';
import { txParams, useAccounts, useCategories, useTransactions } from '@/lib/queries';
import type { Transaction, Transfer, TxType } from '@/lib/types';

type Editing = { kind: 'tx'; tx?: Transaction; type?: TxType } | { kind: 'transfer'; transfer?: Transfer } | null;
type Row = { kind: 'tx'; date: string; tx: Transaction } | { kind: 'transfer'; date: string; t: Transfer };

export default function MovimientosPage() {
  const nav = useMonth();
  const { month } = nav;
  const [type, setType] = useState<TxType | 'TRANSFER' | ''>('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  // Acceso directo desde el ícono de la app instalada: /movimientos?nuevo=1
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('nuevo')) {
      setEditing({ kind: 'tx' });
      window.history.replaceState(null, '', '/movimientos');
    }
  }, []);

  const { from, to } = monthRange(month);
  const filters = { from, to, type: type === 'TRANSFER' || !type ? undefined : type, accountId, categoryId, q: q.trim() || undefined };
  const txQ = useTransactions(filters);
  const trQ = useTransfers(from, to);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const items = useMemo(() => txQ.data?.pages.flatMap((p) => p.items) ?? [], [txQ.data]);
  const first = txQ.data?.pages[0];

  // Las transferencias se intercalan con los movimientos, salvo que el filtro las excluya
  const transfers = useMemo(() => {
    if (type === 'INCOME' || type === 'EXPENSE' || categoryId) return [];
    const term = q.trim().toLowerCase();
    return (trQ.data ?? []).filter(
      (t) => (!accountId || t.fromAccountId === accountId || t.toAccountId === accountId) && (!term || (t.description ?? '').toLowerCase().includes(term)),
    );
  }, [trQ.data, type, categoryId, accountId, q]);

  const groups = useMemo(() => {
    const rows: Row[] = [
      ...(type === 'TRANSFER' ? [] : items.map((tx) => ({ kind: 'tx' as const, date: tx.date, tx }))),
      ...transfers.map((t) => ({ kind: 'transfer' as const, date: t.date, t })),
    ];
    const map = new Map<string, Row[]>();
    for (const r of rows.sort((a, b) => b.date.localeCompare(a.date))) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return [...map.entries()];
  }, [items, transfers, type]);

  const t = first?.totals;

  async function exportXlsx() {
    setExportErr(null);
    try {
      await downloadFile(`/transactions/export?${txParams(filters)}`, `finanzas_${from}_${to}.xlsx`);
    } catch (e) {
      setExportErr((e as Error).message);
    }
  }

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{monthLabel(month)}</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="h-9 px-3" onClick={exportXlsx} title="Descargar en Excel">
            <Download size={16} /> <span className="hidden sm:inline">Excel</span>
          </Button>
          <MonthNav {...nav} />
        </div>
      </header>
      {exportErr && <div className="mt-3"><ErrorNote>{exportErr}</ErrorNote></div>}

      {t && (
        <section aria-label="Totales del mes" className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-line">
          <Total label="Ingresos" usd={t.incomeUsd} ves={t.incomeVes} tone="text-income" />
          <Total label="Gastos" usd={t.expenseUsd} ves={t.expenseVes} tone="text-expense" />
          <Total label="Balance" usd={t.netUsd} ves={t.netVes} tone={Number(t.netUsd) < 0 ? 'text-expense' : 'text-ink'} />
        </section>
      )}

      <DueRecurring />

      <section aria-label="Filtros" className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="relative col-span-2 sm:col-span-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar en descripciones" className="pl-9" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as TxType | 'TRANSFER' | '')} aria-label="Tipo">
          <option value="">Todo</option>
          <option value="EXPENSE">Gastos</option>
          <option value="INCOME">Ingresos</option>
          <option value="TRANSFER">Transferencias</option>
        </Select>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoría" className="col-span-2 sm:col-span-1">
          <option value="">Todas las categorías</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </section>

      <div className="mt-6">
        {txQ.isError && <ErrorNote>{(txQ.error as Error).message}</ErrorNote>}
        {txQ.isPending && <p className="py-12 text-center text-muted">Cargando movimientos…</p>}
        {txQ.data && !groups.length && (
          <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
            <p className="font-semibold">Sin movimientos en {monthLabel(month).toLowerCase()}</p>
            <p className="mt-1 text-sm text-muted">Registra un gasto, ingreso o transferencia con el botón Nuevo movimiento.</p>
          </div>
        )}
        <div className="flex flex-col gap-6">
          {groups.map(([date, rows]) => (
            <section key={date}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{dayLabel(date)}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
                {rows.map((r) =>
                  r.kind === 'tx' ? (
                    <li key={r.tx.id}>
                      <button onClick={() => setEditing({ kind: 'tx', tx: r.tx })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.tx.category?.color ?? '#b6bfcc' }} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <span className="truncate">{r.tx.description || r.tx.category?.name || 'Sin descripción'}</span>
                            {r.tx.sharePct !== null && <Users size={14} className="shrink-0 text-accent" aria-label="Compartido" />}
                            {r.tx.installmentPlanId && <CreditCard size={14} className="shrink-0 text-accent" aria-label="En cuotas" />}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {[
                              r.tx.description ? r.tx.category?.name : null,
                              r.tx.account?.name ?? (r.tx.shared?.paidBy ? `Pagó ${r.tx.shared.paidBy.name}` : 'No salió de tus cuentas'),
                            ].filter(Boolean).join(', ')}
                          </span>
                        </span>
                        <span className="flex flex-col items-end">
                          <AmountPair type={r.tx.type} usd={r.tx.amountUsd} ves={r.tx.amountVes} original={r.tx.originalCurrency} rate={r.tx.rateUsed} source={r.tx.rateSource} />
                          {r.tx.sharePct !== null && (
                            <span className="text-xs font-semibold tabular-nums text-accent">tu parte {money(r.tx.myAmountUsd, 'USD')}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={r.t.id}>
                      <TransferRow t={r.t} onClick={() => setEditing({ kind: 'transfer', transfer: r.t })} />
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
        {txQ.hasNextPage && type !== 'TRANSFER' && (
          <div className="mt-4 text-center">
            <Button variant="ghost" onClick={() => txQ.fetchNextPage()} disabled={txQ.isFetchingNextPage}>
              {txQ.isFetchingNextPage ? 'Cargando…' : `Cargar más (${items.length} de ${first?.total})`}
            </Button>
          </div>
        )}
      </div>

      <button
        onClick={() => setEditing({ kind: 'tx' })}
        className="fixed bottom-20 right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-ink pl-4 pr-5 font-semibold text-white shadow-lg hover:bg-ink/90 md:bottom-8 md:right-8"
      >
        <Plus size={20} /> Nuevo movimiento
      </button>

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={
          editing?.kind === 'transfer'
            ? editing.transfer ? 'Editar transferencia' : 'Nueva transferencia'
            : editing?.tx ? 'Editar movimiento' : 'Nuevo movimiento'
        }
      >
        {editing?.kind === 'tx' && (
          <TransactionForm
            key={editing.type ?? 'tx'}
            tx={editing.tx}
            initialType={editing.type}
            onDone={() => setEditing(null)}
            onTransfer={editing.tx ? undefined : () => setEditing({ kind: 'transfer' })}
          />
        )}
        {editing?.kind === 'transfer' && (
          <TransferForm
            transfer={editing.transfer}
            onDone={() => setEditing(null)}
            onBack={editing.transfer ? undefined : (type) => setEditing({ kind: 'tx', type })}
          />
        )}
      </Dialog>
    </>
  );
}

function TransferRow({ t, onClick }: { t: Transfer; onClick: () => void }) {
  const fx = t.rate !== null;
  const vs = t.vsReference !== null ? Number(t.vsReference) : null;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60">
      <span aria-hidden className="grid size-2.5 shrink-0 place-items-center rounded-full border-2 border-accent" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate font-semibold">
          {t.fromAccount.name} <ArrowRight size={14} className="shrink-0 text-muted" /> {t.toAccount.name}
        </span>
        <span className="block truncate text-xs text-muted">{t.description || (fx ? 'Cambio de divisas' : 'Transferencia')}</span>
      </span>
      <span className="flex flex-col items-end text-right">
        <span className="text-base font-bold tabular-nums">{money(t.fromAmount, t.fromAccount.currency)}</span>
        <span className="text-xs tabular-nums text-muted">
          {fx ? (
            <>
              {money(t.toAmount, t.toAccount.currency)} a {rate(t.rate!)}
              {vs !== null && Math.abs(vs) >= 0.05 && (
                <span className={cn('ml-1', (t.fromAccount.currency === 'USD') === vs > 0 ? 'text-income' : 'text-expense')}>
                  {signedPct(vs)}
                </span>
              )}
            </>
          ) : Number(t.toAmount) < Number(t.fromAmount) ? (
            `llegan ${money(t.toAmount, t.toAccount.currency)}`
          ) : (
            'transferencia'
          )}
        </span>
      </span>
    </button>
  );
}

function Total({ label, usd, ves, tone }: { label: string; usd: string; ves: string; tone: string }) {
  return (
    <div className="bg-surface px-3 py-4 sm:px-5">
      <p className="text-xs text-muted sm:text-sm">{label}</p>
      <p className={cn('mt-1 text-base font-extrabold tabular-nums sm:text-xl', tone)}>{money(usd, 'USD')}</p>
      <p className="text-xs tabular-nums text-muted">{money(ves, 'VES')}</p>
    </div>
  );
}
