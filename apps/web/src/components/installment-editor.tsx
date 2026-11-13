'use client';

import { useState } from 'react';
import { Field, Input, Segmented, Select } from '@/components/ui/controls';
import { money } from '@/lib/format';
import { useInstallmentPlans } from '@/lib/planning';
import { FREQUENCY_LABEL, type InstallmentFrequency } from '@/lib/types';

export interface InstallmentState {
  provider: string;
  store: string;
  downMode: 'PERCENT' | 'USD';
  down: string;
  count: string;
  frequency: InstallmentFrequency;
  /** Vacío: se calcula según la frecuencia */
  firstDue: string;
}

export const emptyInstallments = (): InstallmentState => ({
  provider: 'Cashea', store: '', downMode: 'PERCENT', down: '40', count: '3', frequency: 'DAYS_14', firstDue: '',
});

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const dm = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Mismas reglas que la API: cada 14 o 15 días, o el mismo día cada mes. */
export function previewDates(purchase: string, s: InstallmentState) {
  const count = Math.max(0, Math.min(24, Math.floor(num(s.count) || 0)));
  if (!purchase || !count) return [];
  const p = new Date(`${purchase}T00:00:00Z`);
  const step = s.frequency === 'DAYS_15' ? 15 : 14;
  const monthly = (base: Date, i: number) => {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + i;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(base.getUTCDate(), last)));
  };
  const first = s.firstDue ? new Date(`${s.firstDue}T00:00:00Z`) : s.frequency === 'MONTHLY' ? monthly(p, 1) : new Date(p.getTime() + step * 86_400_000);
  return Array.from({ length: count }, (_, i) => iso(s.frequency === 'MONTHLY' ? monthly(first, i) : new Date(first.getTime() + i * step * 86_400_000)));
}

export function installmentPreview(totalUsd: number | null, purchase: string, s: InstallmentState) {
  if (!totalUsd || totalUsd <= 0) return null;
  const downUsd = Math.round((s.downMode === 'PERCENT' ? (totalUsd * (num(s.down) || 0)) / 100 : num(s.down) || 0) * 100) / 100;
  const dates = previewDates(purchase, s);
  if (!dates.length || downUsd < 0 || downUsd >= totalUsd) return { downUsd, dates, amounts: [] as number[], invalid: true };
  const rem = Math.round((totalUsd - downUsd) * 100);
  const base = Math.floor(rem / dates.length);
  const amounts = dates.map((_, i) => (i === dates.length - 1 ? rem - base * (dates.length - 1) : base) / 100);
  return { downUsd, dates, amounts, invalid: false };
}

export function InstallmentEditor({
  value, onChange, totalUsd, purchaseDate, myPct, paidByOther,
}: { value: InstallmentState; onChange: (s: InstallmentState) => void; totalUsd: number | null; purchaseDate: string; myPct: number | null; paidByOther?: boolean }) {
  const set = <K extends keyof InstallmentState>(k: K, v: InstallmentState[K]) => onChange({ ...value, [k]: v });
  const pv = installmentPreview(totalUsd, purchaseDate, value);
  const f = myPct === null ? 1 : myPct / 100;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ProviderField value={value.provider} onChange={(v) => set('provider', v)} />
        <Field label="Tienda (opcional)">
          <Input value={value.store} onChange={(e) => set('store', e.target.value)} maxLength={80} placeholder="Ej. Daka" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Inicial</span>
          <div className="flex gap-2">
            <Input
              aria-label="Inicial"
              inputMode="decimal"
              value={value.down}
              onChange={(e) => set('down', e.target.value)}
              className="flex-1 tabular-nums"
            />
            <Segmented<'PERCENT' | 'USD'>
              label="Inicial en"
              value={value.downMode}
              onChange={(m) => onChange({ ...value, downMode: m, down: m === 'USD' && pv ? String(pv.downUsd).replace('.', ',') : m === 'PERCENT' ? '40' : value.down })}
              options={[{ value: 'PERCENT', label: '%' }, { value: 'USD', label: 'USD' }]}
            />
          </div>
        </div>
        <Field label="Cuotas">
          <Select value={value.count} onChange={(e) => set('count', e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? 'cuota' : 'cuotas'}</option>)}
          </Select>
        </Field>
        <Field label="Frecuencia">
          <Select value={value.frequency} onChange={(e) => set('frequency', e.target.value as InstallmentFrequency)}>
            {(Object.keys(FREQUENCY_LABEL) as InstallmentFrequency[]).map((k) => <option key={k} value={k}>{FREQUENCY_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Primera cuota" hint={value.firstDue ? undefined : 'Según la frecuencia; cámbiala si tu plataforma dice otra'}>
          <Input type="date" value={value.firstDue || pv?.dates[0] || ''} min={purchaseDate} onChange={(e) => set('firstDue', e.target.value)} />
        </Field>
      </div>

      {pv && (
        <div className="rounded-lg bg-canvas px-3 py-2 text-sm">
          {pv.invalid ? (
            <p className="text-expense">La inicial tiene que ser menor que el total.</p>
          ) : (
            <>
              <p>
                {paidByOther ? 'Inicial' : 'Inicial hoy'}: <strong className="tabular-nums">{money(pv.downUsd, 'USD')}</strong>
                {myPct !== null && <span className="text-muted"> (tu parte {money(pv.downUsd * f, 'USD')})</span>}
              </p>
              <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
                {pv.dates.map((d, i) => (
                  <li key={d} className="whitespace-nowrap tabular-nums">
                    {dm(d)}: <span className="text-ink">{money(pv.amounts[i], 'USD')}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-xs text-muted">
                {paidByOther
                  ? 'Tu parte de cada cuota se registra cuando quien pagó la marca pagada (o al vencer), desde la cuenta que elijas abajo.'
                  : `Cada cuota cuenta como gasto el día que la pagues${myPct !== null ? ' (solo tu parte)' : ''}.`}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Plataformas conocidas; se suman las que ya usaste. */
const PROVIDERS = ['Cashea', 'Krece', 'Lysto'];
const OTHER = '__otra';

/** Plataforma de cuotas: una lista con las conocidas y las que ya usaste, o "Otra…" para escribirla. */
function ProviderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: plans = [] } = useInstallmentPlans();
  const used = [...new Set(plans.map((p) => p.provider.trim()).filter(Boolean))];
  const options = [...PROVIDERS, ...used.filter((u) => !PROVIDERS.some((p) => p.toLowerCase() === u.toLowerCase()))];
  const known = options.some((o) => o.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(!known && value !== '');
  if (typing) {
    return (
      <Field label="Plataforma" hint={<button type="button" onClick={() => { setTyping(false); onChange(options[0]); }} className="font-semibold text-accent hover:underline">Elegir de la lista</button>}>
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="Nombre de la plataforma" maxLength={40} />
      </Field>
    );
  }
  return (
    <Field label="Plataforma">
      <Select value={known ? options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) : ''} onChange={(e) => (e.target.value === OTHER ? (setTyping(true), onChange('')) : onChange(e.target.value))}>
        {!known && <option value="">Elige una</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
        <option value={OTHER}>Otra…</option>
      </Select>
    </Field>
  );
}
