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
  // Cambio de divisas: se escribe la tasa y se calcula lo que recibes (o, si llegó otro monto, se escribe a mano)
  const [rateIn, setRateIn] = useState(transfer?.rate ? toInput(String(Math.round(Number(transfer.rate) * 10000) / 10000)) : '');
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si las cuentas llegan después de abrir el formulario, se eligen las dos primeras.
  // "Entra a" nunca puede quedar igual a "Sale de": su lista no la muestra y el formulario
  // creería que la plata sale y entra en la misma cuenta.
  useEffect(() => {
    if (!fromId && accounts.length) setFromId(accounts[0].id);
    const other = accounts.find((a) => a.id !== (fromId || accounts[0]?.id));
    if ((!toId || toId === fromId) && other) setToId(other.id);
  }, [accounts, fromId, toId]);

  function pickFrom(id: string) {
    setFromId(id);
    if (id === toId) setToId(accounts.find((a) => a.id !== id)?.id ?? '');
  }

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const isFx = !!from && !!to && from.currency !== to.currency;
  const bcv = useRateForDate(date, 'BCV');

  // Lo que recibes según la tasa: de USD a Bs se multiplica, de Bs a USD se divide
  const computed = useMemo(() => {
    if (!isFx || manual || !(num(out) > 0) || !(num(rateIn) > 0)) return null;
    const v = from!.currency === 'USD' ? num(out) * num(rateIn) : num(out) / num(rateIn);
    return Math.round(v * 100) / 100;
  }, [isFx, manual, out, rateIn, from]);
  const received = isFx && !manual ? (computed !== null ? String(computed) : '') : toApi(inn);

  // Tasa de la operación y su diferencia con la BCV del día
  const fx = useMemo(() => {
    if (!isFx) return null;
    const r = manual
      ? num(out) > 0 && num(inn) > 0 ? (from!.currency === 'USD' ? num(inn) / num(out) : num(out) / num(inn)) : 0
      : num(rateIn);
    if (!(r > 0)) return null;
    const ref = Number(bcv.data?.rate);
    return { rate: r, vs: ref > 0 ? (r / ref - 1) * 100 : null };
  }, [isFx, manual, out, inn, rateIn, from, bcv.data]);

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
    if (isFx && !manual && !(num(rateIn) > 0)) return setError('Escribe la tasa de cambio (Bs por dólar)');
    if (isFx && !(Number(received) > 0)) return setError(`Escribe cuánto recibiste en ${to.currency === 'USD' ? 'dólares' : 'bolívares'}`);
    try {
      await save.mutateAsync({
        fromAccountId: from.id, toAccountId: to.id, date, fromAmount: toApi(out),
        ...(isFx ? { toAmount: received } : inn ? { toAmount: toApi(inn) } : transfer ? { toAmount: toApi(out) } : {}),
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
            <Select value={fromId} onChange={(e) => pickFrom(e.target.value)}>
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
          {isFx && !manual ? (
            <Field label="Tasa (Bs por USD)">
              <Input inputMode="decimal" value={rateIn} onChange={(e) => setRateIn(e.target.value)} placeholder={bcv.data ? toInput(bcv.data.rate) : '0,00'} />
            </Field>
          ) : (
            <Field label={isFx ? `Recibes (${cur(to?.currency)})` : 'Recibes'} hint={isFx ? undefined : 'Solo si hubo comisión'}>
              <Input inputMode="decimal" value={inn} onChange={(e) => setInn(e.target.value)} placeholder={isFx ? '0,00' : out || '0,00'} />
            </Field>
          )}
        </div>
        {isFx && (
          <div className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm tabular-nums">
            {!manual && (
              <p>
                Recibes{' '}
                <strong className="text-base text-ink">{computed !== null ? money(computed, to!.currency) : `— ${cur(to?.currency)}`}</strong>
              </p>
            )}
            {fx ? (
              <p className="text-muted">
                {manual ? 'Tasa obtenida ' : 'Tasa '}<span className="text-ink">{fmtRate(fx.rate)}</span>
                {fx.vs !== null && (
                  <span className={cn('ml-1 font-semibold', from?.currency === 'USD' ? (fx.vs >= 0 ? 'text-income' : 'text-expense') : fx.vs <= 0 ? 'text-income' : 'text-expense')}>
                    ({signedPct(fx.vs)} vs. BCV {fmtRate(bcv.data!.rate)})
                  </span>
                )}
              </p>
            ) : (
              <p className="text-muted">
                Es un cambio de moneda: escribe la tasa que te dieron.
                {bcv.data && !manual && (
                  <button type="button" onClick={() => setRateIn(toInput(bcv.data!.rate))} className="ml-1 font-semibold text-accent hover:underline">
                    Usar BCV ({fmtRate(bcv.data.rate)})
                  </button>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                // Al pasar a monto manual se arranca con lo calculado; al volver, con la tasa obtenida
                if (!manual) setInn(computed !== null ? toInput(String(computed)) : '');
                else if (fx) setRateIn(toInput(String(Math.round(fx.rate * 10000) / 10000)));
                setManual((m) => !m);
              }}
              className="mt-1 text-xs font-semibold text-accent hover:underline"
            >
              {manual ? 'Calcular con la tasa' : '¿Te llegó otro monto? Escríbelo a mano'}
            </button>
          </div>
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
