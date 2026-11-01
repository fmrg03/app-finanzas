import { cn, money, rate as fmtRate } from '@/lib/format';
import type { Currency, RateSource, TxType } from '@/lib/types';
import { RATE_LABEL } from '@/lib/types';

/**
 * El par de montos: la moneda principal grande y la otra debajo con la tasa aplicada.
 * La principal es la que escribió el usuario, así ve exactamente lo que pagó.
 */
export function AmountPair({
  type, usd, ves, original, rate, source, align = 'right',
}: { type?: TxType; usd: string; ves: string; original: Currency; rate?: string; source?: RateSource; align?: 'left' | 'right' }) {
  const main = original === 'USD' ? money(usd, 'USD') : money(ves, 'VES');
  const other = original === 'USD' ? money(ves, 'VES') : money(usd, 'USD');
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  return (
    <div className={cn('flex flex-col', align === 'right' ? 'items-end text-right' : 'items-start')}>
      <span className={cn('text-base font-bold tabular-nums', type === 'INCOME' && 'text-income', type === 'EXPENSE' && 'text-ink')}>
        {sign}
        {main}
      </span>
      <span className="text-xs tabular-nums text-muted">
        {other}
        {rate && source ? ` a ${fmtRate(rate)} ${RATE_LABEL[source]}` : ''}
      </span>
    </div>
  );
}
