'use client';

import { CreditCard } from 'lucide-react';
import Link from 'next/link';
import { cn, money, today } from '@/lib/format';
import { useUpcomingInstallments } from '@/lib/planning';

const dmy = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

/** Cuotas que te tocan pagar en los próximos 30 días (incluye vencidas). */
export function UpcomingInstallments() {
  const { data } = useUpcomingInstallments(30);
  if (!data?.items.length) return null;
  const t = today();
  const shown = data.items.slice(0, 4);
  return (
    <section aria-labelledby="cuotas-prox" className="mt-4 rounded-2xl bg-surface p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cuotas-prox" className="flex items-center gap-2 text-lg font-bold"><CreditCard size={18} className="text-accent" /> Cuotas por pagar</h2>
        <Link href="/deudas?tab=cuotas" className="text-sm font-semibold text-accent hover:underline">Ver todas</Link>
      </div>
      <p className="mt-1 text-sm text-muted">
        <strong className="tabular-nums text-ink">{money(data.totalUsd, 'USD')}</strong> en los próximos 30 días
      </p>
      <ul className="mt-3 divide-y divide-line text-sm">
        {shown.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2 tabular-nums">
            <span className={cn('w-12 shrink-0 font-semibold', i.dueDate < t ? 'text-expense' : 'text-muted')}>{dmy(i.dueDate)}</span>
            <span className="min-w-0 flex-1 truncate">{i.plan.description} <span className="text-muted">({i.n}/{i.plan.count}, {i.plan.provider})</span></span>
            <span className="font-semibold">{money(i.amountUsd, 'USD')}</span>
          </li>
        ))}
      </ul>
      {data.items.length > shown.length && <p className="mt-1 text-xs text-muted">y {data.items.length - shown.length} más</p>}
    </section>
  );
}
