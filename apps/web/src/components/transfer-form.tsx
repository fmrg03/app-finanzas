'use client';

import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input, Segmented, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, money, rate as fmtRate, signedPct, today } from '@/lib/format';
import { useApiMutation } from '@/lib/planning';
import { useAccounts, useRateForDate } from '@/lib/queries';
import type { Transfer, TxType } from '@/lib/types';

const num = (s: string) => Number(s.trim().replace(/\s/g, '').replace(',', '.'));
const toApi = (s: string) => s.trim().replace(/\s/g, '').replace(',', '.');
const toInput = (s: string) => String(Number(s)).replace('.', ',');

/**
 * Mover dinero entre cuentas propias. Si las monedas son distintas es un cambio de divisas:
 * se registra cuánto salió y cuánto entró, y se compara la tasa obtenida con la BCV del día.
 */
export function TransferForm({ transfer, onDone, onBack }: { transfer?: Transfer; onDone: () => void; onBack?: (t: TxType) => void }) {
  const { data: accounts = [] } = useAccounts();
  const [fromId, setFromId] = useState(transfer?.fromAccountId ?? accounts[0]?.id ?? '');
  const [toId, setToId] = useState(transfer?.toAccountId ?? accounts.find((a) => a.id !== (transfer?.fromAccountId ?? accounts[0]?.id))?.id ?? '');
  const [date, setDate] = useState(transfer?.date ?? today());
  const [out, setOut] = useState(transfer ? toInput(transfer.fromAmount) : '');
  const [inn, setInn] = useState(transfer && transfer.fromAmount !== transfer.toAmount ? toInput(transfer.toAmount) : '');
  const [description, setDescription] = useState(transfer?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  // Si las cuentas llegan después de abrir el formulario, se eligen las dos primeras
  useEffect(() => {
    if (!fromId && accounts.length) setFromId(accounts[0].id);
    if (!toId && accounts.length > 1) setToId(accounts[1].id);
  }, [accounts, fromId, toId]);

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const isFx = !!from && !!to && from.currency !== to.currency;
  const bcv = useRateForDate(date, 'BCV');

  // Tasa obtenida en la operación y su diferencia con la BCV
  const fx = useMemo(() => {
    if (!isFx || !(num(out) > 0) || !(num(inn) > 0)) return null;
    const r = from!.currency === 'USD' ? num(inn) / num(out) : num(out) / num(inn);
    const ref = Number(bcv.data?.rate);
    return { rate: r, vs: ref > 0 ? (r / ref - 1) * 100 : null };
  }, [isFx, out, inn, from, bcv.data]);

  const save = useApiMutation((body: object) =>
    transfer ? api(`/transfers/${transfer.id}`, { method: 'PATCH', json: body }) : api('/transfers', { method: 'POST', json: body }),
  );
  const del = useApiMutation(() => api(`/transfers/${transfer!.id}`, { method: 'DELETE' }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!from || !to) return setError('Elige las dos cuentas');
    if (from.id === to.id) return setError('Elige dos cuentas distintas');
    if (!(num(out) > 0)) return setError('Escribe cuánto sale');
    if (isFx && !(num(inn) > 0)) return setError(`Escribe cuánto recibiste en ${to.currency === 'USD' ? 'dólares' : 'bolívares'}`);
    try {
      await save.mutateAsync({
        fromAccountId: from.id, toAccountId: to.id, date, fromAmount: toApi(out),
        ...(inn ? { toAmount: toApi(inn) } : transfer ? { toAmount: toApi(out) } : {}),
        description,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (accounts.length < 2) return <p className="text-sm text-muted">Necesitas al menos dos cuentas para transferir entre ellas.</p>;

  const cur = (c?: string) => (c === 'VES' ? 'Bs' : 'USD');
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {onBack && (
        <Segmented<TxType | 'TRANSFER'>
          label="Tipo de movimiento"
          value="TRANSFER"
          onChange={(v) => v !== 'TRANSFER' && onBack(v)}
          options={[
            { value: 'EXPENSE', label: 'Gasto' },
            { value: 'INCOME', label: 'Ingreso' },
            { value: 'TRANSFER', label: 'Transferencia', tone: 'text-accent' },
          ]}
        />
      )}

      <div className="rounded-xl border border-line p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Sale de">
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({cur(a.currency)})</option>)}
            </Select>
          </Field>
          <Field label={`Monto (${cur(from?.currency)})`}>
            <Input inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} placeholder="0,00" autoFocus={!transfer} />
          </Field>
        </div>
        <div className="my-2 flex justify-center text-muted" aria-hidden><ArrowDown size={18} /></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Entra a">
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              {accounts.filter((a) => a.id !== fromId).map((a) => <option key={a.id} value={a.id}>{a.name} ({cur(a.currency)})</option>)}
            </Select>
          </Field>
          <Field label={isFx ? `Recibes (${cur(to?.currency)})` : 'Recibes'} hint={isFx ? undefined : 'Solo si hubo comisión'}>
            <Input inputMode="decimal" value={inn} onChange={(e) => setInn(e.target.value)} placeholder={isFx ? '0,00' : out || '0,00'} />
          </Field>
        </div>
        {isFx && (
          <p className="mt-3 text-sm tabular-nums text-muted">
            {fx ? (
              <>
                Tasa obtenida <strong className="text-ink">{fmtRate(fx.rate)}</strong>{' '}
                {fx.vs !== null && (
                  <span className={cn('ml-1 font-semibold', from?.currency === 'USD' ? (fx.vs >= 0 ? 'text-income' : 'text-expense') : fx.vs <= 0 ? 'text-income' : 'text-expense')}>
                    ({signedPct(fx.vs)} vs. BCV {fmtRate(bcv.data!.rate)})
                  </span>
                )}
              </>
            ) : (
              'Es un cambio de moneda: escribe cuánto recibiste para ver la tasa.'
            )}
          </p>
        )}
        {!isFx && num(inn) > 0 && num(out) > num(inn) && (
          <p className="mt-3 text-sm text-muted">Comisión: {money(num(out) - num(inn), from!.currency)}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fecha"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Descripción"><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. Retiro para la semana" maxLength={300} /></Field>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-2">
        {transfer && (
          <Button type="button" variant="danger" disabled={del.isPending} onClick={async () => { if (confirm('¿Eliminar esta transferencia?')) { await del.mutateAsync(undefined); onDone(); } }}>
            Eliminar
          </Button>
        )}
        <Button type="submit" disabled={save.isPending} className="ml-auto">{save.isPending ? 'Guardando…' : transfer ? 'Guardar cambios' : 'Guardar transferencia'}</Button>
      </div>
    </form>
  );
}
