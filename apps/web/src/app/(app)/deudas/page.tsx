'use client';

import { Check, CreditCard, MessageCircle, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Progress } from '@/components/progress';
import { SharePanel, useTodayBcv } from '@/components/share-panel';
import { TransactionForm } from '@/components/transaction-form';
import { Button, ErrorNote, Field, Input, Segmented, Select } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn, money, today } from '@/lib/format';
import { useApiMutation, useDebts, useInstallmentPlans, usePeople } from '@/lib/planning';
import { useAccounts } from '@/lib/queries';
import { balances, debtReminderText, personReminderText, planText, shareWhatsApp } from '@/lib/share';
import type { Account, Currency, Debt, DebtDirection, Installment, InstallmentPlan, Person } from '@/lib/types';

const dmy = (d: string) => d.split('-').reverse().join('/');
const toApi = (s: string) => s.replace(/\s/g, '').replace(',', '.');
type Tab = 'deudas' | 'cuotas' | 'personas';

export default function DeudasPage() {
  const [tab, setTab] = useState<Tab>('deudas');
  const [creating, setCreating] = useState(false);

  // ?tab=cuotas desde los avisos de la campanita
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'cuotas' || t === 'personas') setTab(t);
  }, []);
  function pick(t: Tab) {
    setTab(t);
    window.history.replaceState(null, '', t === 'deudas' ? '/deudas' : `/deudas?tab=${t}`);
  }

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Deudas y cuotas</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus size={18} /> {tab === 'cuotas' ? 'Compra' : tab === 'personas' ? 'Persona' : 'Nueva'}
        </Button>
      </header>
      <p className="mt-1 text-muted">Lo que debes y te deben, tus compras en cuotas y las personas con las que compartes gastos.</p>

      <div className="mt-6">
        <Segmented<Tab>
          label="Sección"
          value={tab}
          onChange={pick}
          options={[{ value: 'deudas', label: 'Deudas' }, { value: 'cuotas', label: 'Cuotas' }, { value: 'personas', label: 'Personas' }]}
        />
      </div>

      {tab === 'deudas' && <DebtsTab creating={creating} setCreating={setCreating} />}
      {tab === 'cuotas' && <PlansTab />}
      {tab === 'personas' && <PeopleTab />}

      <Dialog
        open={creating && tab !== 'deudas'}
        onOpenChange={(o) => !o && setCreating(false)}
        title={tab === 'cuotas' ? 'Nueva compra en cuotas' : 'Nueva persona'}
      >
        {creating && tab === 'cuotas' && <TransactionForm startWith="cuotas" initialType="EXPENSE" onDone={() => setCreating(false)} />}
        {creating && tab === 'personas' && <PersonForm onDone={() => setCreating(false)} />}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Deudas

function DebtsTab({ creating, setCreating }: { creating: boolean; setCreating: (v: boolean) => void }) {
  const { data = [], isPending, error } = useDebts();
  const [dir, setDir] = useState<DebtDirection>('I_OWE');
  const [editing, setEditing] = useState<Debt | null>(null);
  const list = data.filter((d) => d.direction === dir);
  const open = list.filter((d) => !d.settledAt);
  const settled = list.filter((d) => d.settledAt);
  const pending = (cur: Currency) => open.filter((d) => d.currency === cur).reduce((s, d) => s + Number(d.remaining), 0);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<DebtDirection> label="Ver" value={dir} onChange={setDir} options={[{ value: 'I_OWE', label: 'Debo' }, { value: 'OWED_TO_ME', label: 'Me deben' }]} />
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
          {dir === 'I_OWE' ? 'No tienes deudas registradas.' : 'Nadie te debe nada, por ahora.'}
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-3">{open.map((d) => <DebtCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}</ul>
      {!!settled.length && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Saldadas</h2>
          <ul className="mt-2 flex flex-col gap-3 opacity-70">{settled.map((d) => <DebtCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}</ul>
        </>
      )}

      <Dialog open={creating || editing !== null} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} title={editing ? 'Editar deuda' : 'Nueva deuda'}>
        {(creating || editing) && <DebtForm debt={editing ?? undefined} direction={dir} onDone={() => { setCreating(false); setEditing(null); }} />}
      </Dialog>
    </>
  );
}

function DebtCard({ d, onEdit }: { d: Debt; onEdit: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const rate = useTodayBcv();
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const pay = useApiMutation((b: { amount: string; accountId?: string }) => api(`/debts/${d.id}/payments`, { method: 'POST', json: b }));
  const unpay = useApiMutation((pid: string) => api(`/debts/${d.id}/payments/${pid}`, { method: 'DELETE' }));
  const pct = (Number(d.paid) / Number(d.amount)) * 100;
  const theyOwe = d.direction === 'OWED_TO_ME';

  return (
    <li className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-bold">
          <span className="truncate">{d.person}</span>
          {d.fromShared && <Users size={14} className="shrink-0 text-accent" aria-label="De un movimiento compartido" />}
        </span>
        <span className="font-bold tabular-nums">{money(d.remaining, d.currency)}</span>
        <span className="text-sm tabular-nums text-muted">/ {money(d.amount, d.currency)}</span>
      </div>
      <p className="mt-0.5 text-sm text-muted">
        {d.description}
        {d.dueDate && <span className={cn(d.overdue && 'font-semibold text-expense')}>{d.description ? '. ' : ''}{d.overdue ? 'Venció' : 'Vence'} el {dmy(d.dueDate)}</span>}
      </p>
      <Progress className="mt-2" pct={pct} tone={d.settledAt ? 'income' : 'accent'} label={`Abonado ${Math.round(pct)} %`} />
      {!d.settledAt && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`d-${d.id}`}>Monto del abono</label>
          <Input id={`d-${d.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={d.currency === 'USD' ? 'USD' : 'Bs'} className="h-9 w-28 flex-1 tabular-nums" />
          <Select aria-label={theyOwe ? 'Cuenta donde entra' : 'Cuenta de donde sale'} value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-40 flex-1">
            <option value="">{theyOwe ? 'No entra a una cuenta' : 'No sale de una cuenta'}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{theyOwe ? 'Entra a ' : 'Sale de '}{a.name}</option>)}
          </Select>
          <Button
            className="h-9"
            disabled={pay.isPending || !(Number(toApi(amount)) > 0)}
            onClick={async () => { await pay.mutateAsync({ amount: toApi(amount), ...(accountId ? { accountId } : {}) }); setAmount(''); }}
          >
            {theyOwe ? 'Registrar pago' : 'Abonar'}
          </Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button onClick={onEdit} className="text-sm font-semibold text-accent hover:underline">Editar</button>
        {theyOwe && !d.settledAt && (
          <button
            onClick={() => shareWhatsApp(debtReminderText(d, rate), d.personRef?.phone)}
            className="inline-flex items-center gap-1 text-sm font-semibold text-income hover:underline"
          >
            <MessageCircle size={14} /> Recordar por WhatsApp
          </button>
        )}
      </div>
      {pay.error && <div className="mt-2"><ErrorNote>{pay.error.message}</ErrorNote></div>}
      {!!d.payments.length && (
        <ul className="mt-3 divide-y divide-line text-sm">
          {d.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-1.5 tabular-nums">
              <span className="text-muted">{dmy(p.date)}</span>
              <span className="flex-1 truncate text-muted">
                {p.account ? `${theyOwe ? 'a' : 'de'} ${p.account.name}${p.accountAmount ? ` (${money(p.accountAmount, p.account.currency)})` : ''}` : ''}
                {p.note ? ` ${p.note}` : ''}
              </span>
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
  const { data: people = [] } = usePeople();
  const [dir, setDir] = useState<DebtDirection>(debt?.direction ?? direction);
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'USD');
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: object) => (debt ? api(`/debts/${debt.id}`, { method: 'PATCH', json: b }) : api('/debts', { method: 'POST', json: b })));
  const del = useApiMutation(() => api(`/debts/${debt!.id}`, { method: 'DELETE' }));
  const fixed = !!debt?.fromShared;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const common = { description: String(fd.get('description')), dueDate: String(fd.get('dueDate')) || null };
    try {
      await save.mutateAsync(
        fixed ? common : { ...common, direction: dir, currency, person: String(fd.get('person')), amount: toApi(String(fd.get('amount'))) },
      );
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {fixed && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">Viene de un movimiento compartido: el monto y la persona se cambian desde ese movimiento.</p>}
      {!fixed && <Segmented<DebtDirection> label="Tipo" value={dir} onChange={setDir} options={[{ value: 'I_OWE', label: 'Yo debo' }, { value: 'OWED_TO_ME', label: 'Me deben' }]} />}
      <Field label={dir === 'I_OWE' ? 'A quién' : 'Quién'}>
        <Input name="person" defaultValue={debt?.person} required maxLength={80} autoFocus={!fixed} disabled={fixed} list="people-names" />
      </Field>
      <datalist id="people-names">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <Field label="Concepto (opcional)"><Input name="description" defaultValue={debt?.description ?? ''} placeholder="Ej. Préstamo para el carro" maxLength={300} /></Field>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Monto total"><Input name="amount" inputMode="decimal" defaultValue={debt ? String(Number(debt.amount)).replace('.', ',') : ''} required disabled={fixed} /></Field>
        {!fixed && <Segmented<Currency> label="Moneda" value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />}
      </div>
      <Field label="Vence (opcional)"><Input type="date" name="dueDate" defaultValue={debt?.dueDate ?? ''} /></Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        {debt && !fixed && <Button type="button" variant="danger" onClick={async () => { if (confirm('¿Eliminar la deuda y sus abonos?')) { await del.mutateAsync(undefined); onDone(); } }}>Eliminar</Button>}
        <Button type="submit" className="ml-auto" disabled={save.isPending}>{debt ? 'Guardar' : 'Crear'}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Cuotas

function PlansTab() {
  const { data = [], isPending, error } = useInstallmentPlans();
  const active = data.filter((p) => Number(p.remainingUsd) > 0);
  const finished = data.filter((p) => Number(p.remainingUsd) <= 0);
  const mineLeft = active.filter((p) => p.paidByMe).reduce((s, p) => s + Number(p.remainingUsd), 0);

  return (
    <>
      {mineLeft > 0 && (
        <p className="mt-4 text-sm text-muted">Te faltan por pagar <strong className="tabular-nums text-ink">{money(mineLeft, 'USD')}</strong> en cuotas.</p>
      )}
      {error && <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div>}
      {!isPending && !data.length && (
        <div className="mt-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
          <CreditCard className="mx-auto text-muted" />
          <p className="mt-2 font-semibold">Sin compras en cuotas</p>
          <p className="mt-1 text-sm text-muted">Registra una compra de Cashea con el botón de arriba, o al crear un gasto marca «En cuotas».</p>
        </div>
      )}
      <ul className="mt-4 flex flex-col gap-3">{active.map((p) => <PlanCard key={p.id} p={p} />)}</ul>
      {!!finished.length && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-muted">Pagadas</h2>
          <ul className="mt-2 flex flex-col gap-3 opacity-70">{finished.map((p) => <PlanCard key={p.id} p={p} />)}</ul>
        </>
      )}
    </>
  );
}

const pctLabel = (v: string | null) => `${Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 })} %`;

function PlanCard({ p }: { p: InstallmentPlan }) {
  const [paying, setPaying] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const del = useApiMutation(() => api(`/installment-plans/${p.id}`, { method: 'DELETE' }));
  const unpay = useApiMutation((id: string) => api(`/installments/${id}/pay`, { method: 'DELETE' }));
  const pct = (Number(p.paidUsd) / Number(p.totalUsd)) * 100;
  const f = p.myPct !== null ? Number(p.myPct) / 100 : 1;

  return (
    <li className="rounded-2xl bg-surface p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-bold">
            <span className="truncate">{p.description}</span>
            {p.shared && <Users size={14} className="shrink-0 text-accent" aria-label="Compartida" />}
          </p>
          <p className="text-sm text-muted">
            {p.provider}{p.store ? `, ${p.store}` : ''}. Compra del {dmy(p.purchaseDate)}
            {p.shared && (p.shared.paidBy ? `. Compró ${p.shared.paidBy.name}; tu parte ${pctLabel(p.myPct)}` : `. Compartida; tu parte ${pctLabel(p.myPct)}`)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold tabular-nums">{money(p.remainingUsd, 'USD')}</p>
          <p className="text-xs tabular-nums text-muted">de {money(p.totalUsd, 'USD')}</p>
        </div>
      </div>
      <Progress className="mt-2" pct={pct} tone={Number(p.remainingUsd) <= 0 ? 'income' : 'accent'} label={`Pagado ${Math.round(pct)} %`} />
      <p className="mt-1 text-xs text-muted">
        Inicial {money(p.downPaymentUsd, 'USD')} y {p.paidCount} de {p.count} cuotas pagadas.
        {!p.paidByMe && ' Tu parte de cada cuota se registra sola en su fecha.'}
      </p>

      <ul className="mt-3 divide-y divide-line text-sm">
        {p.installments.map((i) => (
          <li key={i.id} className="py-2">
            <div className="flex items-center gap-2 tabular-nums">
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold', i.transactionId ? 'bg-income-soft text-income' : i.overdue ? 'bg-expense-soft text-expense' : 'bg-canvas text-muted')}>
                {i.transactionId ? <Check size={14} /> : i.n}
              </span>
              <span className={cn('min-w-0 flex-1', i.overdue && 'font-semibold text-expense')}>
                {dmy(i.dueDate)}
                {i.transaction && (
                  <span className="ml-1 text-xs font-normal text-muted">
                    {i.transaction.account ? `pagada el ${dmy(i.transaction.date)} con ${i.transaction.account.name}` : 'registrada'}
                  </span>
                )}
                {i.overdue && <span className="ml-1 text-xs">vencida</span>}
              </span>
              <span className="font-semibold">{money(i.transaction?.amountUsd ?? i.amountUsd, 'USD')}</span>
              {p.shared && <span className="hidden w-24 text-right text-xs text-muted sm:inline">tuyo {money(Number(i.amountUsd) * f, 'USD')}</span>}
              {p.paidByMe && (i.transactionId ? (
                <button onClick={() => confirm(`¿Deshacer el pago de la cuota ${i.n}?`) && unpay.mutate(i.id)} className="w-16 text-right text-xs text-muted hover:text-expense">Deshacer</button>
              ) : (
                <button onClick={() => setPaying(paying === i.id ? null : i.id)} className="w-16 text-right text-xs font-semibold text-accent hover:underline">Pagar</button>
              ))}
            </div>
            {paying === i.id && <PayForm i={i} onDone={() => setPaying(null)} />}
          </li>
        ))}
      </ul>
      {unpay.error && <div className="mt-2"><ErrorNote>{unpay.error.message}</ErrorNote></div>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {p.shared && (
          <button onClick={() => setShowShare((v) => !v)} className="inline-flex items-center gap-1 text-sm font-semibold text-income hover:underline">
            <MessageCircle size={14} /> Compartir detalle
          </button>
        )}
        <button
          onClick={async () => {
            if (confirm('¿Eliminar la compra? Se borran la inicial, las cuotas pagadas y las deudas del reparto.')) await del.mutateAsync(undefined);
          }}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-expense"
        >
          <Trash2 size={14} /> Eliminar compra
        </button>
      </div>
      {del.error && <div className="mt-2"><ErrorNote>{del.error.message}</ErrorNote></div>}
      {showShare && p.shared && (
        <SharePanel
          className="mt-3"
          targets={balances(p.shared).map((b) => ({ personId: b.personId, name: b.name, phone: b.phone, detail: b.owesMe ? `te debe ${money(b.amountUsd, 'USD')}` : `le debes ${money(b.amountUsd, 'USD')}` }))}
          build={(to, rate) => planText(p, to, rate)}
        />
      )}
    </li>
  );
}

function PayForm({ i, onDone }: { i: Installment; onDone: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(String(Number(i.amountUsd)).replace('.', ','));
  const [date, setDate] = useState(today());
  const [rate, setRate] = useState('');
  const pay = useApiMutation((b: object) => api(`/installments/${i.id}/pay`, { method: 'POST', json: b }));
  const acc: Account | undefined = accounts.find((a) => a.id === (accountId || accounts[0]?.id));

  return (
    <div className="mt-2 grid gap-2 rounded-lg bg-canvas p-3 sm:grid-cols-2">
      <Field label="Cuenta">
        <Select value={accountId || accounts[0]?.id || ''} onChange={(e) => setAccountId(e.target.value)} className="h-9">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? 'USD' : 'Bs'})</option>)}
        </Select>
      </Field>
      <Field label="Monto (USD)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 tabular-nums" /></Field>
      <Field label="Fecha"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-9" /></Field>
      {acc?.currency === 'VES' && (
        <Field label="Tasa (opcional)" hint="Vacía: la BCV del día">
          <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Ej. 215,45" className="h-9 tabular-nums" />
        </Field>
      )}
      {pay.error && <div className="sm:col-span-2"><ErrorNote>{pay.error.message}</ErrorNote></div>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button variant="ghost" className="h-9" onClick={onDone}>Cancelar</Button>
        <Button
          className="h-9"
          disabled={pay.isPending || !acc || !(Number(toApi(amount)) > 0)}
          onClick={async () => {
            await pay.mutateAsync({ accountId: acc!.id, amountUsd: toApi(amount), date, ...(rate.trim() ? { rate: toApi(rate) } : {}) });
            onDone();
          }}
        >
          Pagar cuota {i.n}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Personas

function PeopleTab() {
  const { data = [], isPending, error } = usePeople();
  const { data: debts = [] } = useDebts();
  const rate = useTodayBcv();
  const [editing, setEditing] = useState<Person | null>(null);
  const del = useApiMutation((id: string) => api(`/people/${id}`, { method: 'DELETE' }));

  return (
    <>
      {error && <div className="mt-4"><ErrorNote>{error.message}</ErrorNote></div>}
      {del.error && <div className="mt-4"><ErrorNote>{del.error.message}</ErrorNote></div>}
      {!isPending && !data.length && (
        <p className="mt-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
          Agrega a las personas con las que compartes gastos. Con su WhatsApp, el detalle les llega directo.
        </p>
      )}
      {!!data.length && (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl bg-surface">
          {data.map((p) => {
            const owes = Number(p.owedToMeUsd) > 0 || Number(p.owedToMeVes) > 0;
            const iOwe = Number(p.iOweUsd) > 0 || Number(p.iOweVes) > 0;
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-xs text-muted">{p.phone ? `+${p.phone}` : 'Sin WhatsApp'}</p>
                </div>
                <div className="text-right text-sm tabular-nums">
                  {owes && <p className="text-income">te debe {[Number(p.owedToMeUsd) > 0 && money(p.owedToMeUsd, 'USD'), Number(p.owedToMeVes) > 0 && money(p.owedToMeVes, 'VES')].filter(Boolean).join(' + ')}</p>}
                  {iOwe && <p className="text-expense">le debes {[Number(p.iOweUsd) > 0 && money(p.iOweUsd, 'USD'), Number(p.iOweVes) > 0 && money(p.iOweVes, 'VES')].filter(Boolean).join(' + ')}</p>}
                  {!owes && !iOwe && <p className="text-muted">al día</p>}
                </div>
                <div className="flex items-center gap-1">
                  {owes && (
                    <button onClick={() => shareWhatsApp(personReminderText(p, debts, rate), p.phone)} aria-label={`Recordar a ${p.name} por WhatsApp`} className="grid size-9 place-items-center rounded-lg text-income hover:bg-income-soft">
                      <MessageCircle size={18} />
                    </button>
                  )}
                  <button onClick={() => setEditing(p)} aria-label={`Editar a ${p.name}`} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"><Pencil size={16} /></button>
                  <button onClick={() => confirm(`¿Borrar a ${p.name}?`) && del.mutate(p.id)} aria-label={`Borrar a ${p.name}`} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-expense-soft hover:text-expense"><Trash2 size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title="Editar persona">
        {editing && <PersonForm person={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

function PersonForm({ person, onDone }: { person?: Person; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((b: object) => (person ? api(`/people/${person.id}`, { method: 'PATCH', json: b }) : api('/people', { method: 'POST', json: b })));
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await save.mutateAsync({ name: String(fd.get('name')).trim(), phone: String(fd.get('phone')).trim() || null });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Nombre"><Input name="name" defaultValue={person?.name} required maxLength={80} autoFocus /></Field>
      <Field label="WhatsApp (opcional)" hint="Con código de país, o un número venezolano como 0412 123 4567">
        <Input name="phone" inputMode="tel" defaultValue={person?.phone ? `+${person.phone}` : ''} placeholder="+58 412 123 4567" />
      </Field>
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" className="self-end" disabled={save.isPending}>{person ? 'Guardar' : 'Agregar'}</Button>
    </form>
  );
}
