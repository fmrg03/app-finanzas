'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DevaluationBars, NetWorthChart } from '@/components/charts';
import { ErrorNote, Segmented } from '@/components/ui/controls';
import { cn, money, rate } from '@/lib/format';
import { useNetWorth } from '@/lib/planning';
import { ACCOUNT_LABEL } from '@/lib/types';

export default function PatrimonioPage() {
  const [months, setMonths] = useState<'6' | '12' | '24'>('12');
  const q = useNetWorth(Number(months));
  const d = q.data;
  const first = d?.months[0];
  const change = d && first ? Number(d.totalUsd) - Number(first.netUsd) : 0;
  const devalTotal = d ? Number(d.devaluationTotalUsd) : 0;
  const total = d ? Number(d.totalUsd) : 0;

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Patrimonio</h1>
        <Segmented label="Período" value={months} onChange={setMonths} options={[{ value: '6', label: '6 meses' }, { value: '12', label: '1 año' }, { value: '24', label: '2 años' }]} />
      </header>
      <p className="mt-1 text-muted">Todo lo que tienes, en dólares. Los bolívares se convierten con la tasa BCV de cada fecha.</p>

      {q.error && <div className="mt-4"><ErrorNote>{q.error.message}</ErrorNote></div>}
      {q.isPending && <p className="py-16 text-center text-muted">Calculando…</p>}

      {d && (
        <>
          <section aria-labelledby="total" className="mt-6 rounded-2xl bg-surface p-5 sm:p-6">
            <h2 id="total" className="text-sm font-medium text-muted">Hoy tienes</h2>
            <p className={cn('mt-1 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl', total < 0 && 'text-expense')}>{money(total, 'USD')}</p>
            {first && (
              <p className={cn('mt-2 font-semibold', change >= 0 ? 'text-income' : 'text-expense')}>
                {change >= 0 ? '+' : '−'}{money(Math.abs(change), 'USD')} desde el cierre de {first.month === d.months[d.months.length - 1].month ? 'este mes' : monthName(first.month)}
              </p>
            )}
            {Number(d.pendingInstallmentsUsd) > 0 && (
              <p className="mt-2 text-sm text-muted">
                Tienes <Link href="/deudas?tab=cuotas" className="font-semibold text-ink hover:underline">{money(d.pendingInstallmentsUsd, 'USD')} en cuotas por pagar</Link>, que todavía no salen de tus cuentas.
              </p>
            )}
            <div className="mt-4"><NetWorthChart data={d.months} /></div>
          </section>

          <section aria-labelledby="deval" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
            <h2 id="deval" className="text-lg font-bold">Lo que te costó tener bolívares</h2>
            <p className="mt-1 text-sm text-muted">
              Cuánto valor en dólares perdieron, mes a mes, los Bs que tenías guardados porque la tasa subió. Es una aproximación con el saldo al inicio de cada mes.
            </p>
            <p className="mt-3 text-2xl font-extrabold tabular-nums">
              <span className={devalTotal > 0 ? 'text-expense' : 'text-income'}>{money(Math.abs(devalTotal), 'USD')}</span>{' '}
              <span className="text-base font-semibold text-muted">{devalTotal > 0 ? 'perdidos' : 'a favor'} en el período</span>
            </p>
            <div className="mt-3"><DevaluationBars data={d.months} /></div>
            {devalTotal > 1 && <p className="mt-2 text-xs text-muted">Para reducirlo: cambia a dólares lo que no vayas a gastar pronto en bolívares.</p>}
          </section>

          <section aria-labelledby="cuentas" className="mt-4 overflow-hidden rounded-2xl bg-surface">
            <h2 id="cuentas" className="px-5 pt-5 text-lg font-bold">Por cuenta</h2>
            {d.rate && <p className="px-5 text-sm text-muted">Bs convertidos a la BCV de hoy: {rate(d.rate)}</p>}
            <table className="mt-3 w-full text-sm tabular-nums">
              <thead className="border-y border-line text-left text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Cuenta</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                  <th className="px-5 py-2 text-right font-medium">En USD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.accounts.filter((a) => !a.archived || Number(a.balance) !== 0).map((a) => (
                  <tr key={a.id}>
                    <td className="px-5 py-2.5">
                      <span className="block font-semibold">{a.name}</span>
                      <span className="text-xs text-muted">{ACCOUNT_LABEL[a.type]}</span>
                    </td>
                    <td className={cn('px-3 py-2.5 text-right', Number(a.balance) < 0 && 'text-expense')}>{money(a.balance, a.currency)}</td>
                    <td className={cn('px-5 py-2.5 text-right font-semibold', Number(a.balanceUsd) < 0 && 'text-expense')}>{a.balanceUsd !== null ? money(a.balanceUsd, 'USD') : 'Sin tasa'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}

function monthName(ym: string) {
  return new Intl.DateTimeFormat('es-VE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));
}
