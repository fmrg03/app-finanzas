'use client';

import { Camera, FileText, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input, Segmented, Select } from '@/components/ui/controls';
import { cn, money, rate as fmtRate, today } from '@/lib/format';
import { ApiError, fetchBlobUrl } from '@/lib/api';
import { prepareReceipt } from '@/lib/image';
import { useAccounts, useCategories, useDeleteTransaction, useMe, useRateForDate, useReadReceipt, useReceiptsStatus, useSaveTransaction, type TxInput } from '@/lib/queries';
import type { Currency, RateSource, ReceiptRead, Transaction, TxType } from '@/lib/types';
import { RATE_LABEL } from '@/lib/types';

interface FormState {
  type: TxType;
  currency: Currency;
  amount: string;
  accountId: string;
  categoryId: string;
  date: string;
  rateSource: RateSource;
  manualRate: string;
  description: string;
  tags: string;
}

function fromTx(tx: Transaction): FormState {
  return {
    type: tx.type,
    currency: tx.originalCurrency,
    amount: tx.originalAmount,
    accountId: tx.accountId,
    categoryId: tx.categoryId ?? '',
    date: tx.date,
    rateSource: tx.rateSource,
    manualRate: tx.rateSource === 'MANUAL' ? tx.rateUsed : '',
    description: tx.description ?? '',
    tags: tx.tags.join(', '),
  };
}

const parseTags = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
// Acepta coma o punto como separador decimal ("12,50" o "12.50")
const normAmount = (s: string) => s.trim().replace(/\s/g, '').replace(',', '.');

export function TransactionForm({ tx, onDone, onTransfer, initialType }: { tx?: Transaction; onDone: () => void; onTransfer?: () => void; initialType?: TxType }) {
  const { data: me } = useMe();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const save = useSaveTransaction();
  const del = useDeleteTransaction();

  const initial = useMemo<FormState>(
    () =>
      tx
        ? fromTx(tx)
        : {
            type: initialType ?? 'EXPENSE', currency: me?.defaultCurrency ?? 'USD', amount: '', accountId: accounts[0]?.id ?? '',
            categoryId: '', date: today(), rateSource: me?.defaultRateSource ?? 'BCV', manualRate: '', description: '', tags: '',
          },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tx, me?.defaultCurrency, me?.defaultRateSource, accounts[0]?.id],
  );
  const [s, setS] = useState<FormState>(initial);
  const [rateTouched, setRateTouched] = useState(!!tx);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptRead | null>(null);
  // Si los datos base llegan tarde se aplican, salvo que ya se haya leído una factura
  useEffect(() => { if (!receipt) setS(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyReceipt(r: ReceiptRead) {
    const g = r.suggestion;
    setReceipt(r);
    setRateTouched(!!g.rateSource);
    setS((p) => ({
      ...p,
      // Si la cuenta elegida no es de la moneda de la factura, se propone la primera que sí lo sea
      accountId: accounts.find((a) => a.id === p.accountId)?.currency === g.currency ? p.accountId : (accounts.find((a) => a.currency === g.currency)?.id ?? p.accountId),
      type: g.type,
      date: g.date,
      currency: g.currency,
      amount: g.amount.replace('.', ','),
      categoryId: g.categoryId ?? '',
      description: g.description ?? p.description,
      rateSource: g.rateSource ?? allCats.find((c) => c.id === g.categoryId)?.defaultRateSource ?? me?.defaultRateSource ?? p.rateSource,
      manualRate: g.rate ? g.rate.replace('.', ',') : '',
    }));
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((p) => ({ ...p, [k]: v }));

  const typeCats = categories.filter((c) => c.type === s.type);
  const allCats = categories.flatMap((c) => [c, ...(c.children ?? [])]);

  function pickCategory(id: string) {
    set('categoryId', id);
    // La tasa sigue a la categoría mientras el usuario no la haya elegido a mano
    if (!rateTouched) {
      const cat = allCats.find((c) => c.id === id);
      set('rateSource', cat?.defaultRateSource ?? me?.defaultRateSource ?? 'BCV');
    }
  }

  function pickType(t: TxType) {
    setS((p) => ({ ...p, type: t, categoryId: allCats.find((c) => c.id === p.categoryId)?.type === t ? p.categoryId : '' }));
  }

  // Vista previa de la conversión (el cálculo definitivo lo hace la API)
  const rateQ = useRateForDate(s.date, s.rateSource);
  const amountNum = Number(normAmount(s.amount));
  const effRate = s.rateSource === 'MANUAL' ? Number(normAmount(s.manualRate)) : Number(rateQ.data?.rate);
  const preview =
    amountNum > 0 && effRate > 0
      ? s.currency === 'USD' ? money(amountNum * effRate, 'VES') : money(amountNum / effRate, 'USD')
      : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amount = normAmount(s.amount);
    if (!(Number(amount) > 0)) return setError('Escribe un monto mayor que cero');
    if (!s.accountId) return setError('Elige una cuenta');
    if (s.rateSource === 'MANUAL' && !(Number(normAmount(s.manualRate)) > 0)) return setError('Escribe la tasa manual');

    const full: TxInput = {
      type: s.type, accountId: s.accountId, categoryId: s.categoryId || null, date: s.date, currency: s.currency, amount,
      rateSource: s.rateSource, ...(s.rateSource === 'MANUAL' ? { rate: normAmount(s.manualRate) } : {}),
      description: s.description, tags: parseTags(s.tags),
    };

    let data: TxInput = full;
    if (tx) {
      // Solo lo que cambió: así un cambio de descripción no recalcula montos ni tasa
      const init = fromTx(tx);
      const d: Partial<TxInput> = {};
      if (s.type !== init.type) d.type = s.type;
      if (s.accountId !== init.accountId) d.accountId = s.accountId;
      if (s.categoryId !== init.categoryId) d.categoryId = s.categoryId || null;
      if (s.description !== init.description) d.description = s.description;
      if (s.tags !== init.tags) d.tags = parseTags(s.tags);
      const moneyChanged =
        s.currency !== init.currency || Number(amount) !== Number(init.amount) || s.date !== init.date ||
        s.rateSource !== init.rateSource || (s.rateSource === 'MANUAL' && Number(normAmount(s.manualRate)) !== Number(init.manualRate));
      if (moneyChanged) Object.assign(d, { currency: s.currency, amount, date: s.date, rateSource: s.rateSource, ...(full.rate ? { rate: full.rate } : {}) });
      if (!Object.keys(d).length) return onDone();
      data = d as TxInput;
    }

    try {
      await save.mutateAsync({ id: tx?.id, data, receiptId: receipt?.receiptId });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onDelete() {
    if (!tx || !confirm('¿Eliminar este movimiento? No se puede deshacer.')) return;
    try {
      await del.mutateAsync(tx.id);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!accounts.length) {
    return <p className="text-sm text-muted">Primero crea una cuenta (efectivo, banco…) en la sección Cuentas.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {!tx && <ReceiptReader onRead={applyReceipt} read={receipt} />}
      {tx?.receipt && <ReceiptLink receiptId={tx.receipt.id} />}
      <Segmented<TxType | 'TRANSFER'>
        label="Tipo de movimiento"
        value={s.type}
        onChange={(v) => (v === 'TRANSFER' ? onTransfer?.() : pickType(v))}
        options={[
          { value: 'EXPENSE', label: 'Gasto', tone: 'text-expense' },
          { value: 'INCOME', label: 'Ingreso', tone: 'text-income' },
          ...(onTransfer ? [{ value: 'TRANSFER' as const, label: 'Transferencia' }] : []),
        ]}
      />

      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="amount">Monto</label>
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={!tx}
            placeholder="0,00"
            value={s.amount}
            onChange={(e) => set('amount', e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-3xl font-extrabold tabular-nums outline-none placeholder:text-line"
          />
          <Segmented label="Moneda" value={s.currency} onChange={(v) => set('currency', v)} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
        </div>
        <RateLine preview={preview} source={s.rateSource} rateQ={rateQ} manual={s.rateSource === 'MANUAL'} manualRate={effRate} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Categoría">
          <Select value={s.categoryId} onChange={(e) => pickCategory(e.target.value)}>
            <option value="">Sin categoría</option>
            {typeCats.map((c) =>
              c.children?.length ? (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name} (general)</option>
                  {c.children.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                </optgroup>
              ) : (
                <option key={c.id} value={c.id}>{c.name}</option>
              ),
            )}
          </Select>
        </Field>
        <Field label="Cuenta">
          <Select value={s.accountId} onChange={(e) => set('accountId', e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? 'USD' : 'Bs'})</option>)}
          </Select>
        </Field>
        <Field label="Fecha">
          <Input type="date" value={s.date} max={today()} onChange={(e) => set('date', e.target.value)} required />
        </Field>
        <Field label="Tasa">
          <Select value={s.rateSource} onChange={(e) => { setRateTouched(true); set('rateSource', e.target.value as RateSource); }}>
            {(['BCV', 'PARALELO', 'MANUAL'] as RateSource[]).map((r) => <option key={r} value={r}>{RATE_LABEL[r]}</option>)}
          </Select>
        </Field>
        {s.rateSource === 'MANUAL' && (
          <Field label="Tasa manual (Bs por dólar)" className="sm:col-span-2">
            <Input inputMode="decimal" value={s.manualRate} onChange={(e) => set('manualRate', e.target.value)} placeholder="Ej. 215,45" />
          </Field>
        )}
        <Field label="Descripción" className="sm:col-span-2">
          <Input value={s.description} onChange={(e) => set('description', e.target.value)} placeholder="Ej. Compra del mes en el automercado" maxLength={300} />
        </Field>
        <Field label="Etiquetas" hint="Separadas por comas" className="sm:col-span-2">
          <Input value={s.tags} onChange={(e) => set('tags', e.target.value)} placeholder="Ej. casa, mensual" />
        </Field>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-2">
        {tx && <Button type="button" variant="danger" onClick={onDelete} disabled={del.isPending}>Eliminar</Button>}
        <Button type="submit" disabled={save.isPending} className="ml-auto">
          {save.isPending ? 'Guardando…' : tx ? 'Guardar cambios' : 'Guardar movimiento'}
        </Button>
      </div>
    </form>
  );
}

function RateLine({
  preview, source, rateQ, manual, manualRate,
}: { preview: string | null; source: RateSource; rateQ: ReturnType<typeof useRateForDate>; manual: boolean; manualRate: number }) {
  if (!manual && rateQ.isError) {
    return <p className="mt-2 text-sm text-expense">{(rateQ.error as Error).message}</p>;
  }
  const r = manual ? (manualRate > 0 ? fmtRate(manualRate) : null) : rateQ.data ? fmtRate(rateQ.data.rate) : null;
  return (
    <p className={cn('mt-2 text-sm tabular-nums text-muted', !preview && 'opacity-70')}>
      {preview ? <>Equivale a <strong className="font-bold text-ink">{preview}</strong></> : 'Escribe el monto para ver la conversión'}
      {r && <>, tasa {RATE_LABEL[source]} {r}</>}
      {!manual && rateQ.data?.fallback && (
        <span className="block text-xs">Sin tasa ese día; se usa la del {rateQ.data.rateDate.split('-').reverse().join('/')}.</span>
      )}
    </p>
  );
}

function ReceiptReader({ onRead, read }: { onRead: (r: ReceiptRead) => void; read: ReceiptRead | null }) {
  const status = useReceiptsStatus();
  const mut = useReadReceipt();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!status.data?.enabled) return null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    if (file.type.startsWith('image/')) setPreview(URL.createObjectURL(file));
    try {
      onRead(await mut.mutateAsync(await prepareReceipt(file)));
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.status === 409 ? 'Esta factura ya está registrada en tus movimientos.' : ae.message);
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  const ex = read?.extraction;
  return (
    <div className="rounded-xl bg-accent-soft p-3">
      <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Factura" className="size-12 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-surface text-accent">
            {mut.isPending ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
          </span>
        )}
        <div className="min-w-0 flex-1 text-sm">
          {mut.isPending ? (
            <p className="font-semibold">Leyendo la factura…</p>
          ) : ex ? (
            <>
              <p className="truncate font-semibold">{ex.merchant ?? 'Factura leída'}</p>
              <p className="text-xs text-muted">Revisa los datos antes de guardar.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">¿Tienes la factura?</p>
              <p className="text-xs text-muted">Toma una foto y llenamos el movimiento por ti.</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={mut.isPending}
          className="h-9 shrink-0 rounded-lg bg-surface px-3 text-sm font-semibold text-accent hover:bg-white/70 disabled:opacity-50"
        >
          {ex ? 'Otra' : 'Leer factura'}
        </button>
      </div>
      {ex && (ex.confidence === 'low' || ex.notes) && (
        <p className="mt-2 text-xs text-expense">{ex.confidence === 'low' ? 'La lectura no es muy segura. ' : ''}{ex.notes ?? ''}</p>
      )}
      {ex && ex.totalUsdReference !== null && (
        <p className="mt-2 text-xs text-muted">La factura indica una referencia de {money(ex.totalUsdReference, 'USD')}{ex.exchangeRate ? ` a tasa ${fmtRate(ex.exchangeRate)}` : ''}.</p>
      )}
      {err && <p className="mt-2 text-xs text-expense">{err}</p>}
    </div>
  );
}

function ReceiptLink({ receiptId }: { receiptId: string }) {
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setErr(null);
    // La ventana se abre antes del await para que el navegador no la bloquee
    const w = window.open('', '_blank');
    try {
      const url = await fetchBlobUrl(`/receipts/${receiptId}/file`);
      if (w) w.location.href = url;
      else window.location.href = url;
    } catch (e) {
      w?.close();
      setErr((e as Error).message);
    }
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" onClick={open} className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
        <FileText size={16} /> Ver factura
      </button>
      {err && <span className="text-xs text-expense">{err}</span>}
    </div>
  );
}
