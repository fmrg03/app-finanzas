import { cn } from '@/lib/format';

/** Barra de avance. Por encima de 100 % se llena completa y se marca en rojo. */
export function Progress({ pct, tone = 'accent', className, label }: { pct: number; tone?: 'accent' | 'warning' | 'expense' | 'income'; className?: string; label?: string }) {
  const color = { accent: 'bg-accent', warning: 'bg-warning', expense: 'bg-expense', income: 'bg-income' }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-2 overflow-hidden rounded-full bg-canvas', className)}
    >
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(Math.max(pct, pct > 0 ? 2 : 0), 100)}%` }} />
    </div>
  );
}

export const budgetTone = (status: 'ok' | 'warning' | 'over') => (status === 'over' ? 'expense' : status === 'warning' ? 'warning' : 'accent') as 'expense' | 'warning' | 'accent';
