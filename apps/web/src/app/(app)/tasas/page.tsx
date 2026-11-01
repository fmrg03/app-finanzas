'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { MonthNav, useMonth } from '@/components/month-nav';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, monthLabel, monthRange, rate, today } from '@/lib/format';
import { useLatestRates } from '@/lib/queries';
import { RATE_LABEL, type ExchangeRate, type RateSource } from '@/lib/types';

const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

export default function TasasPage() {
  const qc = useQueryClient();
  const nav = useMonth();
  const { from, to } = monthRange(nav.month);
  const latest = useLatestRates();
  const history = useQuery({
    queryKey: ['rates', 'list', from, to],
    queryFn: () => api<ExchangeRate[]>(`/exchange-rates?from=${from}&to=${to}`),
    placeholderData: (p) => p,
  });
  const sync = useMutation({
    mutationFn: () => api('/exchange-rates/sync', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });

  // Una fila por día con las tres fuentes
  const rows = useMemo(() => {
    const map = new Map<string, Partial<Record<RateSource, string>>>();
    for (const r of history.data ?? []) {
      const d = r.date.slice(0, 10);
      map.set(d, { ...map.get(d), [r.source]: r.rate });
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [history.data]);
  const hasManual = rows.some(([, v]) => v.MANUAL);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Tasas de cambio</h1>
        <Button variant="ghost" onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw size={16} className={cn(sync.isPending && 'animate-spin')} /> Actualizar ahora
        </Button>
      </header>
      <p className="mt-1 text-muted">Bolívares por dólar. Se actualizan solas a las 9:00 y a la 13:00.</p>
      {sync.error && <div className="mt-3"><ErrorNote>{sync.error.message}</ErrorNote></div>}

      <section aria-label="Tasas vigentes" className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
        {(['BCV', 'PARALELO', 'MANUAL'] as RateSource[]).map((src) => {
          const r = latest.data?.find((x) => x.source === src);
          return (
            <div key={src} className={cn('bg-surface px-5 py-4', src === 'MANUAL' && 'hidden sm:block')}>
              <p className="text-sm text-muted">{RATE_LABEL[src]}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums">{r ? rate(r.rate) : 'Sin datos'}</p>
              {r && <p className="text-xs text-muted">Del {dmy(r.date)}</p>}
            </div>
          );
        })}
      </section>

      <ManualRateForm />

      <section aria-labelledby="historial" className="mt-6">
        <div className="flex items-center justify-between">
          <h2 id="historial" className="text-lg font-bold">{monthLabel(nav.month)}</h2>
          <MonthNav {...nav} />
        </div>
        {history.error && <ErrorNote>{history.error.message}</ErrorNote>}
        {history.data && !rows.length && <p className="mt-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">No hay tasas guardadas en este mes.</p>}
        {!!rows.length && (
          <div className="mt-3 overflow-hidden rounded-2xl bg-surface">
            <table className="w-full text-sm tabular-nums">
              <thead className="border-b border-line text-left text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Día</th>
                  <th className="px-4 py-2.5 text-right font-medium">BCV</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paralelo</th>
                  {hasManual && <th className="px-4 py-2.5 text-right font-medium">Manual</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(([d, v]) => (
                  <tr key={d}>
                    <td className="px-4 py-2.5">{dmy(d)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{v.BCV ? rate(v.BCV) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{v.PARALELO ? rate(v.PARALELO) : '—'}</td>
                    {hasManual && <td className="px-4 py-2.5 text-right">{v.MANUAL ? rate(v.MANUAL) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ManualRateForm() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (b: { date: string; source: RateSource; rate: string }) => api('/exchange-rates', { method: 'PUT', json: b }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rates'] }); setMsg('Tasa guardada.'); },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    mut.mutate({ date: String(fd.get('date')), source: fd.get('source') as RateSource, rate: String(fd.get('rate')).replace(/\s/g, '').replace(',', '.') });
  }

  if (!open) {
    return (
      <p className="mt-4 text-sm text-muted">
        ¿Falta un día o la API trajo un valor equivocado?{' '}
        <button onClick={() => setOpen(true)} className="font-semibold text-accent hover:underline">Cargar o corregir una tasa</button>
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-2xl bg-surface p-5">
      <h2 className="font-bold">Cargar o corregir una tasa</h2>
      <p className="mt-1 text-sm text-muted">Los movimientos ya guardados conservan la tasa con la que se registraron.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Día"><Input type="date" name="date" defaultValue={today()} max={today()} required /></Field>
        <Field label="Fuente">
          <Select name="source" defaultValue="BCV">
            <option value="BCV">BCV</option>
            <option value="PARALELO">Paralelo</option>
            <option value="MANUAL">Manual</option>
          </Select>
        </Field>
        <Field label="Bs por dólar"><Input name="rate" inputMode="decimal" placeholder="Ej. 215,45" required /></Field>
      </div>
      {mut.error && <div className="mt-3"><ErrorNote>{mut.error.message}</ErrorNote></div>}
      <div className="mt-4 flex items-center gap-3">
        {msg && <span className="text-sm text-income">{msg}</span>}
        <Button type="button" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>Cerrar</Button>
        <Button type="submit" disabled={mut.isPending}>Guardar tasa</Button>
      </div>
    </form>
  );
}
