'use client';

import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Segmented, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { useApiMutation, usePeople } from '@/lib/planning';
import type { Currency, Person, SharedInfo, SplitInput, SplitMode } from '@/lib/types';

export interface SplitState {
  /** null: pagué yo */
  paidBy: string | null;
  mode: SplitMode;
  rows: { personId: string | null; value: string }[];
}

export const emptySplit = (): SplitState => ({ paidBy: null, mode: 'EQUAL', rows: [{ personId: null, value: '' }] });

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const toApi = (s: string) => s.replace(/\s/g, '').replace(',', '.');
const pf = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 });

/** Estado del editor a partir de un reparto guardado. */
export function splitFromShared(s: SharedInfo, totalOriginal: number, totalUsd: number): SplitState {
  return {
    paidBy: s.paidBy?.id ?? null,
    mode: s.splitMode,
    rows: s.participants.map((p) => ({
      personId: p.personId,
      value:
        s.splitMode === 'PERCENT' ? pf.format(Number(p.pct)).replace(/\./g, '')
          : s.splitMode === 'AMOUNT' ? String(Math.round((Number(p.amountUsd) / totalUsd) * totalOriginal * 100) / 100).replace('.', ',')
            : '',
    })),
  };
}

export function splitToApi(s: SplitState): SplitInput {
  return {
    paidByPersonId: s.paidBy,
    mode: s.mode,
    participants: s.rows.map((r) => ({ personId: r.personId, ...(s.mode === 'EQUAL' ? {} : { value: toApi(r.value) || '0' }) })),
  };
}

/** Partes en la moneda de la compra, como las calculará la API (sin el ajuste de centavos). */
export function previewParts(s: SplitState, total: number) {
  const n = s.rows.length || 1;
  return s.rows.map((r) => (s.mode === 'EQUAL' ? total / n : s.mode === 'PERCENT' ? (total * (num(r.value) || 0)) / 100 : num(r.value) || 0));
}

/** Devuelve un mensaje si el reparto no cuadra, o null si está bien. */
export function splitProblem(s: SplitState, total: number, people: Person[] = []): string | null {
  const payer = s.paidBy ? people.find((p) => p.id === s.paidBy) : null;
  if (payer?.linkedUserId) return `${payer.name} usa la app: pídele que registre la compra desde su cuenta incluyéndote, y te aparecerá automáticamente.`;
  const parts = previewParts(s, total);
  if (s.paidBy === null && !s.rows.some((r, i) => r.personId && parts[i] > 0)) return 'Agrega al menos a una persona con la que compartes';
  if (s.paidBy !== null && !s.rows.some((r, i) => !r.personId && parts[i] > 0)) return 'Si pagó otra persona, agrega tu parte';
  if (s.mode === 'PERCENT') {
    const sum = s.rows.reduce((a, r) => a + (num(r.value) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) return `Los porcentajes suman ${pf.format(sum)} %; deben sumar 100 %`;
  }
  if (s.mode === 'AMOUNT' && total > 0) {
    const sum = s.rows.reduce((a, r) => a + (num(r.value) || 0), 0);
    if (Math.abs(sum - total) > 0.01) return `Las partes suman ${pf.format(sum)} y el total es ${pf.format(total)}`;
  }
  return null;
}

export function SplitEditor({
  value, onChange, total, currency, rate,
}: { value: SplitState; onChange: (s: SplitState) => void; total: number; currency: Currency; rate: number | null }) {
  const { data: people = [] } = usePeople();
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? '…') : 'Yo');
  const set = (patch: Partial<SplitState>) => onChange({ ...value, ...patch });
  const parts = previewParts(value, total);
  const problem = total > 0 || value.paidBy ? splitProblem(value, total, people) : null;
  const linked = (id: string | null) => !!id && !!people.find((p) => p.id === id)?.linkedUserId;
  const inUsd = (v: number) => (currency === 'USD' ? v : rate ? v / rate : null);
  const fmt = (v: number) => money(v, currency);

  function setPaidBy(id: string | null) {
    // Quien pagó entra al reparto si no estaba
    const rows = id && !value.rows.some((r) => r.personId === id) ? [...value.rows, { personId: id, value: '' }] : value.rows;
    onChange({ ...value, paidBy: id, rows });
  }
  function addPerson(id: string) {
    if (value.rows.some((r) => r.personId === id)) return;
    set({ rows: [...value.rows, { personId: id, value: '' }] });
  }
  function removeRow(i: number) {
    const row = value.rows[i];
    set({ rows: value.rows.filter((_, j) => j !== i), ...(row.personId && row.personId === value.paidBy ? { paidBy: null } : {}) });
  }
  function setMode(mode: SplitMode) {
    // Al pasar a % o montos se precargan partes iguales para editar desde ahí
    const n = value.rows.length || 1;
    const rows = value.rows.map((r) => ({
      ...r,
      value: mode === 'PERCENT' ? pf.format(100 / n).replace(/\./g, '') : mode === 'AMOUNT' && total > 0 ? (Math.round((total / n) * 100) / 100).toString().replace('.', ',') : '',
    }));
    onChange({ ...value, mode, rows });
  }

  const owe = value.rows
    .map((r, i) => ({ ...r, part: parts[i] }))
    .filter((r) => (value.paidBy === null ? r.personId && r.part > 0 : !r.personId && r.part > 0));
  const mine = parts[value.rows.findIndex((r) => !r.personId)] ?? 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">¿Quién pagó?</span>
          <PersonSelect value={value.paidBy} onChange={setPaidBy} people={people} includeMe meLabel="Yo" />
        </label>
        <Segmented<SplitMode>
          label="Cómo se reparte"
          value={value.mode}
          onChange={setMode}
          options={[{ value: 'EQUAL', label: 'Iguales' }, { value: 'PERCENT', label: '%' }, { value: 'AMOUNT', label: 'Montos' }]}
        />
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {value.rows.map((r, i) => (
          <li key={r.personId ?? 'me'} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {nameOf(r.personId)}
              {r.personId === value.paidBy || (!r.personId && value.paidBy === null) ? <span className="ml-1.5 text-xs font-normal text-muted">pagó</span> : null}
              {linked(r.personId) && r.personId !== value.paidBy && <span className="ml-1.5 text-xs font-normal text-accent">lo verá en su cuenta</span>}
            </span>
            {value.mode !== 'EQUAL' && (
              <div className="relative w-24">
                <Input
                  aria-label={`Parte de ${nameOf(r.personId)}`}
                  inputMode="decimal"
                  value={r.value}
                  onChange={(e) => set({ rows: value.rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                  className="h-9 pr-7 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{value.mode === 'PERCENT' ? '%' : currency === 'USD' ? '$' : 'Bs'}</span>
              </div>
            )}
            <span className="w-24 text-right text-sm tabular-nums text-muted">{total > 0 ? fmt(parts[i]) : '—'}</span>
            <button type="button" onClick={() => removeRow(i)} aria-label={`Quitar a ${nameOf(r.personId)}`} className="grid size-8 place-items-center rounded-md text-muted hover:bg-canvas hover:text-expense">
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>

      <PersonSelect
        value=""
        onChange={(id) => (id === null ? !value.rows.some((r) => !r.personId) && set({ rows: [...value.rows, { personId: null, value: '' }] }) : addPerson(id))}
        people={people.filter((p) => !value.rows.some((r) => r.personId === p.id))}
        includeMe={!value.rows.some((r) => !r.personId)}
        meLabel="Yo"
        placeholder="+ Agregar persona"
      />

      {problem ? (
        <p className="text-sm text-expense">{problem}</p>
      ) : total > 0 ? (
        <div className="rounded-lg bg-canvas px-3 py-2 text-sm">
          <p>
            Tu gasto: <strong className="tabular-nums">{fmt(mine)}</strong>
            {currency === 'VES' && inUsd(mine) !== null && <span className="text-muted"> ({money(inUsd(mine)!, 'USD')})</span>}
          </p>
          {value.paidBy === null ? (
            owe.map((o) => (
              <p key={o.personId} className="text-muted">
                {nameOf(o.personId)} te debe <span className="tabular-nums text-ink">{inUsd(o.part) !== null ? money(inUsd(o.part)!, 'USD') : fmt(o.part)}</span>
              </p>
            ))
          ) : (
            <p className="text-muted">
              Le debes a {nameOf(value.paidBy)} <span className="tabular-nums text-ink">{inUsd(mine) !== null ? money(inUsd(mine)!, 'USD') : fmt(mine)}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-muted">Las deudas quedan en USD con la tasa del día, así no pierden valor.</p>
        </div>
      ) : null}
    </div>
  );
}

/** Selector de persona con opción de crear una nueva sin salir del formulario. */
export function PersonSelect({
  value, onChange, people, includeMe, meLabel = 'Yo', placeholder,
}: { value: string | null; onChange: (id: string | null) => void; people: Person[]; includeMe?: boolean; meLabel?: string; placeholder?: string }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const create = useApiMutation((b: { name: string; phone?: string }) => api<Person>('/people', { method: 'POST', json: b }), ['people']);

  if (creating) {
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas p-2">
        <div className="flex gap-2">
          <Input autoFocus placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1" maxLength={80} />
          <Input placeholder="WhatsApp (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="h-9 w-40" />
        </div>
        {create.error && <p className="text-xs text-expense">{create.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-8" onClick={() => { setCreating(false); create.reset(); }}>Cancelar</Button>
          <Button
            type="button"
            className="h-8"
            disabled={!name.trim() || create.isPending}
            onClick={async () => {
              const p = await create.mutateAsync({ name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) });
              setCreating(false); setName(''); setPhone('');
              onChange(p.id);
            }}
          >
            <UserPlus size={14} /> Agregar
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Select
      value={value === null ? 'me' : value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__new') setCreating(true);
        else if (v) onChange(v === 'me' ? null : v);
      }}
      className={cn(placeholder && 'text-muted')}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {includeMe && <option value="me">{meLabel}</option>}
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="__new">+ Nueva persona…</option>
    </Select>
  );
}
