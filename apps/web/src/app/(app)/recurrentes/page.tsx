'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { DueRecurring } from '@/components/due-recurring';
import { Button, ErrorNote, Field, Input, Segmented, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, dayLabel, money, today } from '@/lib/format';
import { useApiMutation, useRecurring } from '@/lib/planning';
import { useAccounts, useCategories } from '@/lib/queries';
import { canReserve, FREQ_MONTHS, RECURRING_FREQ, type Currency, type Frequency, type RateSource, type Recurring, type TxType } from '@/lib/types';


export default function RecurrentesPage() {
  const { data = [], isPending, error } = useRecurring();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const active = data.filter((r) => r.active);
  const paused = data.filter((r) => !r.active);
  // Gasto fijo mensual aproximado: semanales × 4,33; trimestrales ÷ 3; anuales ÷ 12
  const monthly = (cur: Currency) =>
    active.filter((r) => r.type === 'EXPENSE' && r.currency === cur).reduce((s, r) => s + Number(r.amount) / FREQ_MONTHS[r.frequency], 0);

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Recurrentes</h1>
        <Button onClick={() => setEditing('new')}><Plus size={18} /> Nuevo</Button>
      </header>
      <p className="mt-1 text-muted">
        Sueldo, servicios y suscripciones. Los automáticos se registran solos; los demás te los pedimos para confirmar el monto.
        Para lo que se paga cada varios meses (como un seguro trimestral) puedes apartar un poco cada mes.
      </p>

      <DueRecurring />

      {error && <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div>}
      {!isPending && !data.length && (
        <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">Sin recurrentes todavía</p>
          <p className="mt-1 text-sm text-muted">Agrega lo que pagas o cobras siempre: internet, Netflix, el sueldo.</p>
        </div>
      )}

      {!!active.length && (
        <>
          <p className="mt-6 text-sm text-muted">
            Gastos fijos al mes (lo trimestral o anual, repartido): <strong className="text-ink tabular-nums">{money(monthly('USD'), 'USD')}</strong>
            {monthly('VES') > 0 && <> y <strong className="text-ink tabular-nums">{money(monthly('VES'), 'VES')}</strong></>}
          </p>
          <List items={active} onEdit={setEditing} />
        </>
      )}
      {!!paused.length && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Pausados o terminados</h2>
          <List items={paused} onEdit={setEditing} />
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Nuevo recurrente' : 'Editar recurrente'}>
        {editing && <RecurringForm r={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function List({ items, onEdit }: { items: Recurring[]; onEdit: (r: Recurring) => void }) {
  return (
    <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl bg-surface">
      {items.map((r) => (
        <li key={r.id}>
          <button onClick={() => onEdit(r)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60', !r.active && 'opacity-60')}>
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.category?.color ?? '#b6bfcc' }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{r.description}</span>
              <span className="block truncate text-xs text-muted">
                {RECURRING_FREQ[r.frequency]}, {r.account.name}. {r.active ? `Próximo: ${dayLabel(r.nextDate).toLowerCase()}` : 'Pausado'}
              </span>
              {r.active && r.reserveStatus && <ReserveBar r={r} />}
            </span>
            <span className="flex flex-col items-end">
              <span className={cn('font-bold tabular-nums', r.type === 'INCOME' && 'text-income')}>{r.type === 'INCOME' ? '+' : '−'}{money(r.amount, r.currency)}</span>
              <span className="text-xs text-muted">{r.autoCreate ? 'Automático' : 'Con confirmación'}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Cuánto llevas apartado para el próximo pago. */
function ReserveBar({ r }: { r: Recurring }) {
  const st = r.reserveStatus!;
  const pct = Math.min((Number(st.balance) / Number(r.amount)) * 100, 100);
  return (
    <span className="mt-1.5 block">
      <span className="flex justify-between gap-2 text-xs">
        <span className="text-muted">Apartado <strong className="tabular-nums text-ink">{money(st.balance, r.currency)}</strong> de {money(r.amount, r.currency)}</span>
        {Number(st.suggested) > 0 && <span className="text-muted tabular-nums">{money(st.suggested, r.currency)} el {Number(st.nextDate.slice(8))}</span>}
      </span>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-canvas">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function RecurringForm({ r, onDone }: { r?: Recurring; onDone: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const [type, setType] = useState<TxType>(r?.type ?? 'EXPENSE');
  const [currency, setCurrency] = useState<Currency>(r?.currency ?? 'USD');
  const [frequency, setFrequency] = useState<Frequency>(r?.frequency ?? 'MONTHLY');
  const [autoCreate, setAutoCreate] = useState(r?.autoCreate ?? false);
  const [reserve, setReserve] = useState(r?.reserve ?? false);
  const [reserveDay, setReserveDay] = useState(String(r?.reserveDay ?? 1));
  const [amountText, setAmountText] = useState(r ? String(Number(r.amount)).replace('.', ',') : '');
  const reservable = type === 'EXPENSE' && canReserve(frequency);
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: object) => (r ? api(`/recurring/${r.id}`, { method: 'PATCH', json: b }) : api('/recurring', { method: 'POST', json: b })));
  const del = useApiMutation(() => api(`/recurring/${r!.id}`, { method: 'DELETE' }));
  const toggle = useApiMutation(() => api(`/recurring/${r!.id}`, { method: 'PATCH', json: { active: !r!.active } }));
  const cats = categories.filter((c) => c.type === type).flatMap((c) => [c, ...(c.children ?? [])]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const startDate = String(fd.get('startDate'));
    const body = {
      type, currency, frequency, autoCreate,
      reserve: reservable && reserve,
      ...(reservable && reserve ? { reserveDay: Math.min(Math.max(Number(reserveDay) || 1, 1), 28) } : {}),
      description: String(fd.get('description')),
      amount: String(fd.get('amount')).replace(/\s/g, '').replace(',', '.'),
      accountId: String(fd.get('accountId')),
      categoryId: String(fd.get('categoryId')) || null,
      rateSource: (String(fd.get('rateSource')) || null) as RateSource | null,
      endDate: String(fd.get('endDate')) || null,
      // Al editar, solo se reprograma si cambió la fecha
      ...(!r || startDate !== r.startDate ? { startDate } : {}),
    };
    try {
      await save.mutateAsync(body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Segmented<TxType> label="Tipo" value={type} onChange={setType} options={[{ value: 'EXPENSE', label: 'Gasto', tone: 'text-expense' }, { value: 'INCOME', label: 'Ingreso', tone: 'text-income' }]} />
      <Field label="Descripción"><Input name="description" defaultValue={r?.description} placeholder="Ej. Internet fibra" required maxLength={300} autoFocus={!r} /></Field>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Monto"><Input name="amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0,00" required /></Field>
        <Segmented<Currency> label="Moneda" value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Cuenta">
          <Select name="accountId" defaultValue={r?.accountId ?? accounts[0]?.id} key={accounts.length}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Categoría">
          <Select name="categoryId" defaultValue={r?.categoryId ?? ''} key={`${type}-${cats.length}`}>
            <option value="">Sin categoría</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `  ${c.name}` : c.name}</option>)}
          </Select>
        </Field>
        <Field label="Frecuencia">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
            {(['MONTHLY', 'WEEKLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as Frequency[]).map((f) => <option key={f} value={f}>{RECURRING_FREQ[f]}</option>)}
          </Select>
        </Field>
        <Field label={r ? 'Próxima fecha' : 'Primera fecha'} hint={frequency === 'WEEKLY' ? undefined : frequency === 'MONTHLY' ? 'Se repite ese día de cada mes' : `Se repite ese día ${RECURRING_FREQ[frequency].toLowerCase()}`}>
          <Input type="date" name="startDate" defaultValue={r?.nextDate ?? today()} required />
        </Field>
        <Field label="Tasa">
          <Select name="rateSource" defaultValue={r?.rateSource ?? ''}>
            <option value="">La de la categoría o la tuya</option>
            <option value="BCV">BCV</option>
            <option value="PARALELO">Paralelo</option>
          </Select>
        </Field>
        <Field label="Termina (opcional)"><Input type="date" name="endDate" defaultValue={r?.endDate ?? ''} /></Field>
      </div>
      <label className="flex items-start gap-3 rounded-xl bg-canvas p-3 text-sm">
        <input type="checkbox" checked={autoCreate} onChange={(e) => setAutoCreate(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
        <span>
          <span className="font-semibold">Registrar automáticamente</span>
          <span className="block text-muted">Para montos fijos como Netflix. Si el monto cambia cada vez (luz, internet en Bs), déjalo sin marcar y te lo pediremos para confirmar.</span>
        </span>
      </label>
      {reservable && (
        <div className="rounded-xl bg-canvas p-3 text-sm">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
            <span>
              <span className="font-semibold">Apartar cada mes para este pago</span>
              <span className="block text-muted">
                {perMonth(amountText, frequency) > 0
                  ? `Unos ${money(perMonth(amountText, frequency), currency)} al mes. `
                  : ''}
                El dinero se queda en la cuenta, pero aparece como apartado. Cada mes te pedimos confirmarlo.
              </span>
            </span>
          </label>
          {reserve && (
            <div className="mt-3 flex items-center gap-2 pl-7">
              <label htmlFor="reserveDay" className="text-muted">Confirmar el día</label>
              <Input id="reserveDay" type="number" min={1} max={28} value={reserveDay} onChange={(e) => setReserveDay(e.target.value)} className="h-9 w-20 text-center tabular-nums" />
              <span className="text-muted">de cada mes</span>
            </div>
          )}
          {r?.reserveStatus && <p className="mt-2 pl-7 text-xs text-muted">Llevas {money(r.reserveStatus.balance, r.currency)} apartados.{reserve ? '' : ' Si lo quitas, quedan libres en la cuenta.'}</p>}
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2">
        {r && (
          <>
            <Button type="button" variant="ghost" onClick={async () => { await toggle.mutateAsync(undefined); onDone(); }}>{r.active ? 'Pausar' : 'Reactivar'}</Button>
            <Button type="button" variant="danger" onClick={async () => { if (confirm('¿Eliminar este recurrente? Los movimientos ya registrados se conservan.')) { await del.mutateAsync(undefined); onDone(); } }}>Eliminar</Button>
          </>
        )}
        <Button type="submit" className="ml-auto" disabled={save.isPending}>{r ? 'Guardar' : 'Crear recurrente'}</Button>
      </div>
    </form>
  );
}

const perMonth = (amount: string, f: Frequency) => {
  const n = Number(amount.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.ceil((n / FREQ_MONTHS[f]) * 100) / 100 : 0;
};
