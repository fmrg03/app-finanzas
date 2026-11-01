'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn, money } from '@/lib/format';
import type { MoneyPair, Overview } from '@/lib/queries';
import type { Currency } from '@/lib/types';

// Colores validados para daltonismo (protan ΔE 9.6) contra el fondo blanco
export const CHART = {
  income: '#0a7d63',
  expense: '#c2412d',
  current: '#1f6f78',
  previous: '#9aa5b5',
  grid: '#e7ebf0',
  axis: '#5b6880',
};

const pick = (p: MoneyPair, c: Currency) => Number(c === 'USD' ? p.usd : p.ves);

const compact = (c: Currency) => {
  const nf = new Intl.NumberFormat('es-VE', { notation: 'compact', maximumFractionDigits: 1 });
  return (v: number) => (c === 'USD' ? `$${nf.format(v)}` : nf.format(v));
};

export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-semibold">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 tabular-nums">
          <span aria-hidden className={cn('h-0.5 w-3', r.dashed && 'border-t-2 border-dashed bg-transparent')} style={r.dashed ? { borderColor: r.color } : { background: r.color, height: 8, borderRadius: 2 }} />
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto pl-4 font-semibold">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Gasto acumulado del período contra el período anterior, día a día. */
export function PaceChart({ data, currency, lastDay, labels }: { data: Overview['cumulativeExpense']; currency: Currency; lastDay: number; labels: [string, string] }) {
  const len = Math.max(data.current.length, data.previous.length);
  const rows = Array.from({ length: len }, (_, i) => ({
    day: i + 1,
    current: i < data.current.length && i < lastDay ? pick(data.current[i], currency) : null,
    previous: i < data.previous.length ? pick(data.previous[i], currency) : null,
  }));
  const fmt = compact(currency);
  return (
    <div className="h-56 w-full sm:h-64" role="img" aria-label={`Gasto acumulado por día, ${labels[0]} contra ${labels[1]}`}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={52} />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={`Día ${label}`}
                  rows={[...payload].filter((p) => p.value != null).sort((a) => (a.dataKey === 'current' ? -1 : 1)).map((p) => ({
                    label: p.dataKey === 'current' ? labels[0] : labels[1],
                    value: money(Number(p.value), currency),
                    color: p.dataKey === 'current' ? CHART.current : CHART.previous,
                    dashed: p.dataKey === 'previous',
                  }))}
                />
              ) : null
            }
          />
          <Line dataKey="previous" stroke={CHART.previous} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} connectNulls />
          <Line dataKey="current" stroke={CHART.current} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const monthShort = (ym: string) => {
  const s = new Intl.DateTimeFormat('es-VE', { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`)).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const monthLong = (ym: string) => {
  const s = new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Ingresos y gastos por mes, barras agrupadas. */
export function MonthlyBars({ data, currency }: { data: Overview['monthly']; currency: Currency }) {
  const rows = data.map((m) => ({ month: m.month, label: monthShort(m.month), income: pick(m.income, currency), expense: pick(m.expense, currency), net: pick(m.net, currency) }));
  const fmt = compact(currency);
  return (
    <div className="h-56 w-full sm:h-64" role="img" aria-label="Ingresos y gastos por mes">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={52} />
          <Tooltip
            cursor={{ fill: 'rgb(22 35 58 / 0.04)' }}
            content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload;
              return r ? (
                <TooltipBox
                  title={monthLong(r.month)}
                  rows={[
                    { label: 'Ingresos', value: money(r.income, currency), color: CHART.income },
                    { label: 'Gastos', value: money(r.expense, currency), color: CHART.expense },
                    { label: 'Balance', value: money(r.net, currency), color: 'transparent' },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="income" fill={CHART.income} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="expense" fill={CHART.expense} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MonthlyTable({ data, currency }: { data: Overview['monthly']; currency: Currency }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead className="text-left text-muted">
        <tr><th className="py-1.5 font-medium">Mes</th><th className="py-1.5 text-right font-medium">Ingresos</th><th className="py-1.5 text-right font-medium">Gastos</th><th className="py-1.5 text-right font-medium">Balance</th></tr>
      </thead>
      <tbody className="divide-y divide-line">
        {[...data].reverse().map((m) => (
          <tr key={m.month}>
            <td className="py-1.5">{monthLong(m.month)}</td>
            <td className="py-1.5 text-right">{money(pick(m.income, currency), currency)}</td>
            <td className="py-1.5 text-right">{money(pick(m.expense, currency), currency)}</td>
            <td className={cn('py-1.5 text-right font-semibold', pick(m.net, currency) < 0 && 'text-expense')}>{money(pick(m.net, currency), currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="inline-block w-4" style={dashed ? { borderTop: `2px dashed ${color}` } : { height: 8, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

/** Patrimonio en USD al cierre de cada mes. */
export function NetWorthChart({ data }: { data: { month: string; netUsd: string; usd: string; vesInUsd: string | null }[] }) {
  const rows = data.map((m) => ({ month: m.month, label: monthShort(m.month), net: Number(m.netUsd), usd: Number(m.usd), ves: m.vesInUsd ? Number(m.vesInUsd) : 0 }));
  const fmt = compact('USD');
  return (
    <div className="h-56 w-full sm:h-64" role="img" aria-label="Patrimonio en dólares al cierre de cada mes">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.current} stopOpacity={0.18} />
              <stop offset="100%" stopColor={CHART.current} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={56} />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload;
              return r ? (
                <TooltipBox
                  title={monthLong(r.month)}
                  rows={[
                    { label: 'Total', value: money(r.net, 'USD'), color: CHART.current },
                    { label: 'En dólares', value: money(r.usd, 'USD'), color: 'transparent' },
                    { label: 'En Bs (convertido)', value: money(r.ves, 'USD'), color: 'transparent' },
                  ]}
                />
              ) : null;
            }}
          />
          <Area dataKey="net" stroke={CHART.current} strokeWidth={2.5} fill="url(#nwFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Valor que perdieron (o ganaron) cada mes los bolívares que tenías, en USD. */
export function DevaluationBars({ data }: { data: { month: string; devaluationUsd: string }[] }) {
  const rows = data.map((m) => ({ month: m.month, label: monthShort(m.month), loss: Number(m.devaluationUsd) }));
  const fmt = compact('USD');
  return (
    <div className="h-44 w-full" role="img" aria-label="Pérdida por devaluación de los bolívares, por mes">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={56} />
          <ReferenceLine y={0} stroke={CHART.axis} strokeOpacity={0.4} />
          <Tooltip
            cursor={{ fill: 'rgb(22 35 58 / 0.04)' }}
            content={({ active, payload }) => {
              const r = active && payload?.[0]?.payload;
              return r ? (
                <TooltipBox title={monthLong(r.month)} rows={[{ label: r.loss >= 0 ? 'Perdiste' : 'Ganaste', value: money(Math.abs(r.loss), 'USD'), color: r.loss >= 0 ? CHART.expense : CHART.income }]} />
              ) : null;
            }}
          />
          <Bar dataKey="loss" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.month} fill={r.loss >= 0 ? CHART.expense : CHART.income} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
