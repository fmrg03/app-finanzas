'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, MessageCircle, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, ErrorNote } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, money, signedPct } from '@/lib/format';
import { shareWhatsApp } from '@/lib/share';

type Pair = { usd: string; ves: string };
interface Summary {
  month: string;
  isComplete: boolean;
  totals: { income: Pair; expense: Pair; net: Pair; fxGain: Pair; count: number };
  previousTotals: { income: Pair; expense: Pair; net: Pair; fxGain: Pair; count: number };
  savingsRate: number | null;
  categories: { categoryId: string | null; name: string; color: string; usd: string; previousUsd: string }[];
  budgets: { name: string; amountUsd: string; spentUsd: string }[];
  biggest: { id: string; date: string; description: string | null; category: string | null; usd: string; originalAmount: string; originalCurrency: 'USD' | 'VES' }[];
}

const monthName = (ym: string, year = true) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Intl.DateTimeFormat('es-VE', { month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const usd = (v: string | number) => money(v, 'USD');
const change = (cur: string, prev: string) => (Number(prev) > 0 ? ((Number(cur) - Number(prev)) / Number(prev)) * 100 : null);

/** El resumen en texto, con el formato de WhatsApp (*negritas*). */
function summaryText(s: Summary) {
  const t = s.totals, p = s.previousTotals;
  const net = Number(t.net.usd);
  const lines = [
    `*Resumen de ${monthName(s.month).toLowerCase()}*`,
    '',
    `Entró: ${usd(t.income.usd)}`,
    `Salió: ${usd(t.expense.usd)}`,
    `${net >= 0 ? 'Quedó' : 'Faltó'}: *${usd(Math.abs(net))}*${s.savingsRate !== null && net > 0 ? ` (ahorraste el ${s.savingsRate} %)` : ''}`,
  ];
  if (Number(t.fxGain.usd) > 0) lines.push(`Ganancia por cambio: ${usd(t.fxGain.usd)}`);
  const ch = change(t.expense.usd, p.expense.usd);
  if (ch !== null) lines.push(`Gastos vs el mes anterior: ${signedPct(ch)}`);
  if (s.categories.length) {
    lines.push('', '*En qué se fue*');
    s.categories.forEach((c) => lines.push(`• ${c.name}: ${usd(c.usd)}`));
  }
  const over = s.budgets.filter((b) => Number(b.spentUsd) > Number(b.amountUsd));
  if (s.budgets.length) {
    lines.push('', over.length ? `*Presupuestos*: ${s.budgets.length - over.length} de ${s.budgets.length} cumplidos` : `*Presupuestos*: cumpliste los ${s.budgets.length}`);
    over.forEach((b) => lines.push(`• ${b.name}: ${usd(b.spentUsd)} de ${usd(b.amountUsd)}`));
  }
  return lines.join('\n');
}

export default function ResumenMesPage() {
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => setMonth(new URLSearchParams(window.location.search).get('m') ?? ''), []);
  const q = useQuery({
    queryKey: ['transactions', 'month-summary', month],
    queryFn: () => api<Summary>(`/stats/month-summary${month ? `?month=${month}` : ''}`),
    enabled: month !== null,
  });
  const [copied, setCopied] = useState(false);
  const s = q.data;

  return (
    <>
      <Link href="/resumen" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft size={16} /> Resumen</Link>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{s ? `Así te fue en ${monthName(s.month).toLowerCase()}` : 'Resumen del mes'}</h1>
      {q.isError && <div className="mt-4"><ErrorNote>{(q.error as Error).message}</ErrorNote></div>}
      {q.isPending && month !== null && <p className="py-16 text-center text-muted">Cargando…</p>}
      {s && s.totals.count === 0 && <p className="mt-6 rounded-2xl bg-surface px-6 py-10 text-center text-muted">No hay movimientos en {monthName(s.month).toLowerCase()}.</p>}
      {s && s.totals.count > 0 && (
        <>
          {!s.isComplete && <p className="mt-1 text-sm text-muted">El mes todavía no termina: son las cifras hasta hoy.</p>}
          <section className="mt-5 rounded-2xl bg-surface p-5">
            <p className="text-sm text-muted">{Number(s.totals.net.usd) >= 0 ? 'Te quedó' : 'Gastaste de más'}</p>
            <p className={cn('text-4xl font-extrabold tabular-nums', Number(s.totals.net.usd) >= 0 ? 'text-income' : 'text-expense')}>{usd(Math.abs(Number(s.totals.net.usd)))}</p>
            {s.savingsRate !== null && Number(s.totals.net.usd) > 0 && <p className="mt-1 text-sm">Ahorraste el <b>{s.savingsRate}&nbsp;%</b> de lo que entró.</p>}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Entró" value={s.totals.income.usd} prev={s.previousTotals.income.usd} goodUp />
              <Stat label="Salió" value={s.totals.expense.usd} prev={s.previousTotals.expense.usd} />
            </dl>
            {Number(s.totals.fxGain.usd) > 0 && <p className="mt-3 text-sm text-muted">Incluye {usd(s.totals.fxGain.usd)} de ganancia por cambio.</p>}
          </section>

          {!!s.categories.length && (
            <section className="mt-4 rounded-2xl bg-surface p-5">
              <h2 className="font-bold">En qué se fue</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {s.categories.map((c) => {
                  const ch = change(c.usd, c.previousUsd);
                  const pct = (Number(c.usd) / Number(s.totals.expense.usd)) * 100;
                  return (
                    <li key={c.categoryId ?? 'none'}>
                      <p className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-semibold">{c.name}</span>
                        <span className="tabular-nums">
                          {usd(c.usd)}
                          {ch !== null && Math.abs(ch) >= 10 && <span className={cn('ml-2 text-xs', ch > 0 ? 'text-expense' : 'text-income')}>{signedPct(ch)}</span>}
                        </span>
                      </p>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-canvas"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.color }} /></div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!!s.budgets.length && (
            <section className="mt-4 rounded-2xl bg-surface p-5">
              <h2 className="font-bold">Presupuestos</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {s.budgets.map((b) => {
                  const over = Number(b.spentUsd) > Number(b.amountUsd);
                  return (
                    <li key={b.name} className="flex justify-between py-2">
                      <span>{b.name}</span>
                      <span className={cn('tabular-nums', over ? 'font-semibold text-expense' : 'text-income')}>{usd(b.spentUsd)} de {usd(b.amountUsd)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!!s.biggest.length && (
            <section className="mt-4 rounded-2xl bg-surface p-5">
              <h2 className="font-bold">Los gastos más grandes</h2>
              <ul className="mt-2 divide-y divide-line text-sm">
                {s.biggest.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{t.description || t.category || 'Gasto'} <span className="text-muted">· {t.date.split('-').reverse().slice(0, 2).join('/')}</span></span>
                    <span className="shrink-0 tabular-nums">{money(t.originalAmount, t.originalCurrency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => void shareWhatsApp(summaryText(s))}><MessageCircle size={16} /> Enviar por WhatsApp</Button>
            <Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(summaryText(s)); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              <Copy size={16} /> {copied ? 'Copiado' : 'Copiar texto'}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, prev, goodUp }: { label: string; value: string; prev: string; goodUp?: boolean }) {
  const ch = change(value, prev);
  const good = ch !== null && (goodUp ? ch >= 0 : ch <= 0);
  return (
    <div className="rounded-xl bg-canvas p-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{usd(value)}</dd>
      {ch !== null && (
        <dd className={cn('flex items-center gap-1 text-xs', good ? 'text-income' : 'text-expense')}>
          {ch >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {signedPct(ch)} vs el mes anterior
        </dd>
      )}
    </div>
  );
}
