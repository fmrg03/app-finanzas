'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CHART, InflationChart } from '@/components/charts';
import { ErrorNote, Segmented } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, money, signedPct } from '@/lib/format';

interface Cmp { month: string; usd: number | null; ves: number | null; bcv: number | null }
interface Inflation {
  basket: string[];
  categories: { id: string; name: string; color: string; inBasket: boolean; usual: boolean; lastUsd: string; vs3: number | null; vs12: number | null }[];
  series: { month: string; usd: string; ves: string; bcv: string | null; partial: boolean }[];
  lastClosed: string | null;
  vsPrev: Cmp | null; vs3: Cmp | null; vs12: Cmp | null;
}

const KEY = 'fz-basket';
const monthName = (ym: string, year = false) =>
  new Intl.DateTimeFormat('es-VE', { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

export default function InflacionPage() {
  const [months, setMonths] = useState<'6' | '12'>('12');
  // Canasta elegida a mano (null = la automática). Se recuerda en este navegador.
  const [custom, setCustom] = useState<string[] | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v) setCustom(JSON.parse(v)); } catch { /* sin almacenamiento */ }
  }, []);
  const save = (v: string[] | null) => {
    setCustom(v);
    try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  };
  const q = useQuery({
    queryKey: ['transactions', 'inflation', months, custom?.join(',') ?? ''],
    queryFn: () => api<Inflation>(`/stats/inflation?months=${months}${custom?.length ? `&categories=${custom.join(',')}` : ''}`),
    placeholderData: (p) => p,
  });
  const d = q.data;
  const cmp = months === '12' ? d?.vs12 : d?.vs3 && { ...d.vs3 };
  const last = d?.series.find((s) => s.month === d.lastClosed);
  const base = cmp && d?.series.find((s) => s.month === cmp.month);
  const toggle = (id: string) => {
    const cur = custom ?? d?.basket ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    save(next.length ? next : null);
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Inflación personal</h1>
        <Segmented label="Período" value={months} onChange={setMonths} options={[{ value: '6', label: '3 meses' }, { value: '12', label: '1 año' }]} />
      </header>
      <p className="mt-1 text-sm text-muted">Cuánto te cuesta tu vida de siempre (tu canasta de gastos) mes a mes, en dólares y en bolívares.</p>
      {q.isError && <div className="mt-4"><ErrorNote>{(q.error as Error).message}</ErrorNote></div>}
      {q.isPending && <p className="py-16 text-center text-muted">Cargando…</p>}
      {d && !d.basket.length && (
        <p className="mt-6 rounded-2xl bg-surface px-6 py-10 text-center text-muted">
          Todavía no hay suficiente historia: hacen falta varios meses con gastos en las mismas categorías.
        </p>
      )}
      {d && !!d.basket.length && last && (
        <>
          <section className="mt-5 rounded-2xl bg-surface p-5">
            <p className="text-sm text-muted">Tu canasta en {monthName(last.month)}</p>
            <p className="text-3xl font-extrabold tabular-nums">{money(last.usd, 'USD')}</p>
            <p className="text-sm text-muted tabular-nums">{money(last.ves, 'VES')}</p>
            {cmp && base && (
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <Change label="En dólares" v={cmp.usd} color={CHART.current} />
                <Change label="En bolívares" v={cmp.ves} color={CHART.expense} />
                <Change label="Dólar BCV" v={cmp.bcv} color={CHART.previous} neutral />
              </dl>
            )}
            {cmp && base && (
              <p className="mt-3 text-sm">
                Contra {monthName(cmp.month, cmp.month.slice(0, 4) !== last.month.slice(0, 4))}: {explain(cmp)}
              </p>
            )}
          </section>

          <section className="mt-4 rounded-2xl bg-surface p-5">
            <h2 className="font-bold">Cómo ha cambiado</h2>
            <p className="text-xs text-muted">Índice: el primer mes vale 100. Si la línea de dólares sube, tu vida se encareció de verdad.</p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <Legend color={CHART.current} label="Canasta en USD" />
              <Legend color={CHART.expense} label="Canasta en Bs" />
              <Legend color={CHART.previous} label="Dólar BCV" dashed />
            </div>
            <div className="mt-2"><InflationChart data={d.series} /></div>
          </section>

          <section className="mt-4 rounded-2xl bg-surface p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-bold">Qué entra en tu canasta</h2>
              {custom && <button onClick={() => save(null)} className="text-sm font-semibold text-accent hover:underline">Usar la automática</button>}
            </div>
            <p className="text-xs text-muted">{custom ? 'Elegida por ti.' : 'Automática: las categorías en que gastas casi todos los meses.'} Toca para quitar o agregar.</p>
            <ul className="mt-3 divide-y divide-line text-sm">
              {d.categories.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5">
                    <input type="checkbox" checked={c.inBasket} onChange={() => toggle(c.id)} className="size-4 accent-accent" />
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
                    <span className={cn('min-w-0 flex-1 truncate', !c.inBasket && 'text-muted')}>{c.name}</span>
                    <span className="tabular-nums">{money(c.lastUsd, 'USD')}</span>
                    <span className={cn('w-16 text-right text-xs tabular-nums', pctTone(months === '12' ? c.vs12 : c.vs3))}>
                      {(months === '12' ? c.vs12 : c.vs3) !== null ? signedPct((months === '12' ? c.vs12 : c.vs3)!) : '—'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

const pctTone = (v: number | null) => (v === null ? 'text-muted' : v > 2 ? 'text-expense' : v < -2 ? 'text-income' : 'text-muted');

function explain(c: Cmp) {
  if (c.usd === null) return 'no hay datos de ese mes.';
  const usd = c.usd > 1 ? `en dólares tu canasta subió ${signedPct(c.usd).replace('+', '')}` : c.usd < -1 ? `en dólares tu canasta bajó ${signedPct(c.usd).replace('−', '')}` : 'en dólares tu canasta cuesta casi lo mismo';
  const ves = c.ves !== null && c.bcv !== null
    ? `; en bolívares ${signedPct(c.ves)}, mientras el dólar BCV ${signedPct(c.bcv)}.`
    : '.';
  return usd + ves;
}

function Change({ label, v, color, neutral }: { label: string; v: number | null; color: string; neutral?: boolean }) {
  return (
    <div className="rounded-xl bg-canvas p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted"><span className="size-2 rounded-full" style={{ background: color }} aria-hidden />{label}</dt>
      <dd className={cn('text-lg font-bold tabular-nums', !neutral && pctTone(v))}>{v !== null ? signedPct(v) : '—'}</dd>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('w-4', dashed ? 'border-t-2 border-dashed' : 'h-0.5')} style={dashed ? { borderColor: color } : { background: color }} />
      {label}
    </span>
  );
}
