'use client';

import { AlertTriangle, CheckCircle2, FileUp, Loader2, Scale } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CategorySelect } from '@/components/category-select';
import { Button, ErrorNote, Field, Input, Select } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { useInvalidateAll } from '@/lib/planning';
import { useAccounts, useReceiptsStatus } from '@/lib/queries';
import type { Account, TxType } from '@/lib/types';

interface Row {
  date: string;
  description: string;
  amount: string;
  balance: string | null;
  type: TxType;
  status: 'NEW' | 'MATCHED' | 'IMPORTED';
  match: { kind: string; label: string; date: string } | null;
  categoryId: string | null;
}
interface Preview {
  bank: string | null;
  accountLast4: string | null;
  currencyMismatch: boolean;
  statementBalance: string | null;
  rows: Row[];
  gaps: { after: number; before: number; missing: string }[];
}
interface Choice { on: boolean; kind: 'TX' | 'TRANSFER'; categoryId: string; otherAccountId: string; otherAmount: string }

const dmy = (d: string) => d.split('-').reverse().join('/');
const toApi = (s: string) => s.replace(/\s/g, '').replace(',', '.');

export default function ImportarPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: status } = useReceiptsStatus();
  const invalidate = useInvalidateAll();
  const active = accounts.filter((a) => !a.archivedAt);
  const [accountId, setAccountId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState<'read' | 'save' | 'reconcile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [reconciled, setReconciled] = useState(false);

  // ?cuenta=… desde Cuentas; si no, la que se llame Provincial o la primera en Bs
  useEffect(() => {
    if (accountId || !active.length) return;
    const q = new URLSearchParams(window.location.search).get('cuenta');
    const pick = active.find((a) => a.id === q) ?? active.find((a) => /provincial/i.test(a.name)) ?? active.find((a) => a.currency === 'VES') ?? active[0];
    setAccountId(pick.id);
  }, [active, accountId]);
  const account = accounts.find((a) => a.id === accountId);

  async function read() {
    setBusy('read'); setError(null); setDone(null); setReconciled(false);
    try {
      const fd = new FormData();
      fd.append('accountId', accountId);
      files.forEach((f) => fd.append('files', f, f.name));
      const p = await api<Preview>('/imports/statement/preview', { method: 'POST', body: fd });
      setPreview(p);
      setChoices(p.rows.map((r) => ({ on: r.status === 'NEW', kind: 'TX', categoryId: r.categoryId ?? '', otherAccountId: '', otherAmount: '' })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const selected = choices.filter((c) => c.on).length;
  async function save() {
    if (!preview) return;
    setBusy('save'); setError(null);
    try {
      const rows = preview.rows.flatMap((r, i) => {
        const c = choices[i];
        if (!c.on || r.status === 'IMPORTED') return [];
        return [{
          date: r.date, description: r.description, amount: r.amount, ...(r.balance ? { balance: r.balance } : {}), kind: c.kind,
          ...(c.kind === 'TX' && c.categoryId ? { categoryId: c.categoryId } : {}),
          ...(c.kind === 'TRANSFER' ? { otherAccountId: c.otherAccountId, ...(c.otherAmount ? { otherAmount: toApi(c.otherAmount) } : {}) } : {}),
        }];
      });
      const res = await api<{ created: number; skipped: number }>('/imports/statement', { method: 'POST', json: { accountId, rows } });
      setDone(res);
      invalidate();
      // Se marcan como importadas sin volver a leer el archivo
      setPreview({ ...preview, rows: preview.rows.map((r, i) => (choices[i].on && r.status !== 'IMPORTED' ? { ...r, status: 'IMPORTED' } : r)) });
      setChoices(choices.map((c) => ({ ...c, on: false })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reconcile() {
    if (!preview?.statementBalance) return;
    setBusy('reconcile'); setError(null);
    try {
      await api(`/accounts/${accountId}/reconcile`, { method: 'POST', json: { realBalance: preview.statementBalance, note: `Saldo del estado de cuenta${preview.bank ? ` de ${preview.bank}` : ''}` } });
      setReconciled(true);
      invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Importar estado de cuenta</h1>
      <p className="mt-1 text-sm text-muted">
        Sube el PDF o las capturas de &quot;Últimos movimientos&quot; del banco. Revisas cada movimiento antes de guardarlo; los que ya anotaste se reconocen solos.
      </p>
      {status && !status.enabled && (
        <div className="mt-4"><ErrorNote>La lectura de archivos no está configurada: falta ANTHROPIC_API_KEY en el .env de la API.</ErrorNote></div>
      )}

      <div className="mt-5 flex flex-col gap-4 rounded-2xl bg-surface p-4 sm:flex-row sm:items-end">
        <Field label="Cuenta" className="sm:w-60">
          <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
            {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency === 'USD' ? '$' : 'Bs'})</option>)}
          </Select>
        </Field>
        <Field label="Archivo (PDF o capturas)" className="min-w-0 flex-1">
          <span className="flex h-11 min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3 text-sm">
            <span className="shrink-0 rounded-lg bg-accent-soft px-2.5 py-1 font-semibold text-accent">Elegir</span>
            <span className={cn('truncate', !files.length && 'text-muted')}>
              {files.length === 1 ? files[0].name : files.length ? `${files.length} archivos` : 'Ningún archivo'}
            </span>
            <input
              type="file"
              multiple
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setPreview(null); }}
              className="sr-only"
            />
          </span>
        </Field>
        <Button onClick={() => void read()} disabled={!accountId || !files.length || busy !== null}>
          {busy === 'read' ? <><Loader2 size={16} className="animate-spin" /> Leyendo…</> : <><FileUp size={16} /> Leer movimientos</>}
        </Button>
      </div>
      {busy === 'read' && <p className="mt-2 text-sm text-muted">Puede tardar unos 20 segundos si son varias páginas.</p>}
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

      {preview && account && (
        <Review
          preview={preview} account={account} accounts={active} choices={choices} setChoices={setChoices}
        />
      )}

      {preview && account && (
        <div className="sticky bottom-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 shadow-lg md:bottom-4">
          {done ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-income">
              <CheckCircle2 size={18} /> {done.created} {done.created === 1 ? 'movimiento importado' : 'movimientos importados'}{done.skipped ? ` (${done.skipped} ya estaban)` : ''}.{' '}
              <Link href="/movimientos" className="text-accent underline">Ver movimientos</Link>
            </p>
          ) : (
            <p className="text-sm text-muted">{selected} de {preview.rows.length} seleccionados</p>
          )}
          <Button onClick={() => void save()} disabled={!selected || busy !== null}>
            {busy === 'save' ? 'Importando…' : `Importar ${selected || ''}`.trim()}
          </Button>
        </div>
      )}

      {done && preview?.statementBalance && account && (
        <div className="mt-4 rounded-2xl bg-surface p-4 text-sm">
          {reconciled ? (
            <p className="flex items-center gap-2 font-semibold text-income"><CheckCircle2 size={18} /> {account.name} quedó conciliada con {money(preview.statementBalance, account.currency)}.</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                El banco dice <b>{money(preview.statementBalance, account.currency)}</b> y la app <b>{money(account.balance, account.currency)}</b>.
                {Math.abs(Number(account.balance) - Number(preview.statementBalance)) < 0.01 ? ' Cuadra.' : ' Si ya importaste todo, concilia para que cuadre.'}
              </p>
              <Button variant="ghost" onClick={() => void reconcile()} disabled={busy !== null}><Scale size={16} /> Conciliar con el banco</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Review({
  preview, account, accounts, choices, setChoices,
}: { preview: Preview; account: Account; accounts: Account[]; choices: Choice[]; setChoices: (c: Choice[]) => void }) {
  const set = (i: number, patch: Partial<Choice>) => setChoices(choices.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const gapBefore = useMemo(() => new Map(preview.gaps.map((g) => [g.before, g])), [preview.gaps]);
  const others = accounts.filter((a) => a.id !== account.id);
  const counts = { NEW: 0, MATCHED: 0, IMPORTED: 0 };
  preview.rows.forEach((r) => counts[r.status]++);
  return (
    <section className="mt-5">
      <p className="text-sm text-muted">
        {preview.bank ?? 'Banco'}{preview.accountLast4 ? ` ····${preview.accountLast4}` : ''}: {preview.rows.length} movimientos.{' '}
        {counts.NEW} nuevos, {counts.MATCHED} ya anotados{counts.IMPORTED ? `, ${counts.IMPORTED} ya importados` : ''}.
      </p>
      {preview.currencyMismatch && (
        <div className="mt-3"><ErrorNote>El estado de cuenta parece de otra moneda que {account.name}. Revisa que elegiste la cuenta correcta.</ErrorNote></div>
      )}
      {!!preview.gaps.length && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Los saldos no cuadran en {preview.gaps.length === 1 ? 'un punto' : `${preview.gaps.length} puntos`}: falta algún movimiento que no salió en el archivo (está marcado abajo).
        </p>
      )}
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {preview.rows.map((r, i) => {
          const c = choices[i];
          const out = Number(r.amount) < 0;
          const other = accounts.find((a) => a.id === c.otherAccountId);
          const gap = gapBefore.get(i);
          return (
            <li key={i} className={cn('px-4 py-3', r.status === 'IMPORTED' && 'opacity-50')}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Importar ${r.description}`}
                  checked={c.on}
                  disabled={r.status === 'IMPORTED'}
                  onChange={(e) => set(i, { on: e.target.checked })}
                  className="mt-1 size-4 accent-accent"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="min-w-0 truncate font-semibold">{r.description}</span>
                    <span className={cn('font-bold tabular-nums', out ? 'text-expense' : 'text-income')}>{out ? '−' : '+'}{money(Math.abs(Number(r.amount)), account.currency)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {dmy(r.date)}{r.balance ? ` · saldo ${money(r.balance, account.currency)}` : ''}
                    {r.status === 'MATCHED' && r.match && <span className="font-semibold text-accent"> · Ya anotado: {r.match.label} ({dmy(r.match.date)})</span>}
                    {r.status === 'IMPORTED' && <span className="font-semibold"> · Ya importado</span>}
                  </p>
                  {c.on && r.status !== 'IMPORTED' && (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select aria-label="Tipo" value={c.kind} onChange={(e) => set(i, { kind: e.target.value as Choice['kind'] })} className="h-9 sm:w-52">
                        <option value="TX">{out ? 'Gasto' : 'Ingreso'}</option>
                        <option value="TRANSFER">{out ? 'Transferencia a otra cuenta' : 'Cambio o transferencia desde otra cuenta'}</option>
                      </Select>
                      {c.kind === 'TX' ? (
                        <CategorySelect type={r.type} value={c.categoryId} onChange={(id) => set(i, { categoryId: id })} className="h-9 min-w-0 flex-1" />
                      ) : (
                        <div className="flex min-w-0 flex-1 gap-2">
                          <Select aria-label={out ? 'Cuenta destino' : 'Cuenta origen'} value={c.otherAccountId} onChange={(e) => set(i, { otherAccountId: e.target.value })} className="h-9 min-w-0 flex-1">
                            <option value="">{out ? '¿A qué cuenta?' : '¿Desde qué cuenta?'}</option>
                            {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </Select>
                          {other && other.currency !== account.currency && (
                            <Input
                              aria-label={`Monto en ${other.name}`}
                              inputMode="decimal"
                              placeholder={other.currency === 'USD' ? 'USD' : 'Bs'}
                              value={c.otherAmount}
                              onChange={(e) => set(i, { otherAmount: e.target.value })}
                              className="h-9 w-28"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {c.kind === 'TRANSFER' && c.on && other && other.currency !== account.currency && Number(toApi(c.otherAmount)) > 0 && (
                    <p className="mt-1 text-xs text-muted">
                      Tasa: {(Math.abs(Number(r.amount)) / Number(toApi(c.otherAmount))).toLocaleString('es-VE', { maximumFractionDigits: 2 })} Bs/$
                    </p>
                  )}
                </div>
              </div>
              {gap && (
                <p className="mt-2 rounded-lg bg-warning-soft px-3 py-1.5 text-xs text-warning">
                  Antes de este movimiento falta algo por {money(Math.abs(Number(gap.missing)), account.currency)} {Number(gap.missing) > 0 ? 'que entró' : 'que salió'} y no aparece en el archivo.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
