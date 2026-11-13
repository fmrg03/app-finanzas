'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Copy, FileSpreadsheet, Fingerprint, Lock, LogOut, Tags, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { FamilySection } from '@/components/family-section';
import { Button, ErrorNote, Field, Input, Segmented } from '@/components/ui/controls';
import { biometricAvailable, biometricLabel, checkPin, clearLock, createLock, getLock, markUnlocked, registerBiometric, saveLock, type LockConfig } from '@/lib/lock';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { api, downloadFile, logout } from '@/lib/api';
import { useMe, useReceiptsStatus, type Me } from '@/lib/queries';
import { session } from '@/lib/session';
import type { Currency, RateSource } from '@/lib/types';

export default function AjustesPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const receipts = useReceiptsStatus();
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Ajustes</h1>
      {me && <p className="mt-1 text-muted">{me.email}</p>}

      {me && <Preferences me={me} />}

      <QuickEntry />
      {me && <AppLock me={me} />}
      <ExportAll />
      {me && <FamilySection isAdmin={me.role === 'ADMIN'} />}

      <Link href="/categorias" className="mt-4 flex items-center gap-3 rounded-2xl bg-surface px-5 py-4 hover:bg-canvas/60">
        <Tags size={20} className="text-accent" />
        <span className="flex-1">
          <span className="block font-semibold">Categorías</span>
          <span className="text-sm text-muted">Crear, agrupar y elegir la tasa de cada una</span>
        </span>
        <ChevronRight size={18} className="text-muted" />
      </Link>

      <section aria-labelledby="facturas" className="mt-4 rounded-2xl bg-surface p-5">
        <h2 id="facturas" className="font-bold">Lectura de facturas</h2>
        {receipts.data?.enabled ? (
          <p className="mt-1 text-sm text-muted">Activa. Al crear un movimiento puedes tomar una foto de la factura y se llena solo (modelo {receipts.data.model}).</p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Desactivada. Para activarla, agrega <code className="rounded bg-canvas px-1">ANTHROPIC_API_KEY</code> al archivo <code className="rounded bg-canvas px-1">.env</code> de la API y reiníciala.
          </p>
        )}
      </section>

      <PasswordForm />

      <button
        onClick={async () => { await logout(); router.replace('/login'); }}
        className="mt-6 flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink"
      >
        <LogOut size={18} /> Cerrar sesión
      </button>
    </>
  );
}

function Preferences({ me }: { me: Me }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (b: Partial<Pick<Me, 'defaultCurrency' | 'defaultRateSource'>> & { name?: string; phone?: string | null }) => api<Me>('/auth/me', { method: 'PATCH', json: b }),
    onSuccess: (data) => { qc.setQueryData(['me'], data); qc.invalidateQueries({ queryKey: ['family'] }); qc.invalidateQueries({ queryKey: ['people'] }); },
  });
  const [name, setName] = useState(me.name ?? '');
  const shownPhone = me.phone ? `+${me.phone}` : '';
  const [phone, setPhone] = useState(shownPhone);
  return (
    <section aria-labelledby="pref" className="mt-6 rounded-2xl bg-surface p-5">
      <h2 id="pref" className="font-bold">Preferencias</h2>
      <div className="mt-4 flex flex-col gap-5">
        <form
          className="flex flex-wrap items-end justify-between gap-3"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) mut.mutate({ name: name.trim() }); }}
        >
          <Field label="Tu nombre" hint="Así te ven tus familiares cuando comparten una compra" className="min-w-0 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ej. Froilán" />
          </Field>
          <Button type="submit" variant="ghost" disabled={!name.trim() || name.trim() === (me.name ?? '') || mut.isPending}>Guardar</Button>
        </form>
        <form
          className="flex flex-wrap items-end justify-between gap-3"
          onSubmit={(e) => { e.preventDefault(); mut.mutate({ phone: phone.trim() || null }, { onSuccess: (d) => setPhone(d.phone ? `+${d.phone}` : '') }); }}
        >
          <Field label="Tu WhatsApp" hint="Con código de país. Tus familiares lo reciben en sus Personas para mandarte recordatorios." className="min-w-0 flex-1">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+58 412 123 4567" maxLength={25} />
          </Field>
          <Button type="submit" variant="ghost" disabled={phone.trim() === shownPhone || mut.isPending}>Guardar</Button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Moneda principal</p>
            <p className="text-sm text-muted">La que aparece primero al cargar un movimiento y en el resumen.</p>
          </div>
          <Segmented<Currency> label="Moneda principal" value={me.defaultCurrency} onChange={(v) => mut.mutate({ defaultCurrency: v })} options={[{ value: 'USD', label: 'USD' }, { value: 'VES', label: 'Bs' }]} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Tasa predeterminada</p>
            <p className="text-sm text-muted">Se usa cuando la categoría no tiene una propia.</p>
          </div>
          <Segmented<RateSource> label="Tasa predeterminada" value={me.defaultRateSource} onChange={(v) => mut.mutate({ defaultRateSource: v })} options={[{ value: 'BCV', label: 'BCV' }, { value: 'PARALELO', label: 'Paralelo' }]} />
        </div>
        <Appearance />
        {mut.error && <ErrorNote>{mut.error.message}</ErrorNote>}
      </div>
    </section>
  );
}

function PasswordForm() {
  const [msg, setMsg] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (b: { currentPassword: string; newPassword: string }) =>
      api<{ accessToken: string }>('/auth/change-password', { method: 'POST', json: b }),
    onSuccess: (t) => { session.setAccessToken(t.accessToken); setMsg('Contraseña cambiada. Las otras sesiones se cerraron.'); },
  });
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (fd.get('newPassword') !== fd.get('confirm')) return setMsg('Las contraseñas nuevas no coinciden.');
    mut.mutate({ currentPassword: String(fd.get('currentPassword')), newPassword: String(fd.get('newPassword')) }, { onSuccess: () => form.reset() });
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-2xl bg-surface p-5">
      <h2 className="font-bold">Cambiar contraseña</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Actual"><Input type="password" name="currentPassword" autoComplete="current-password" required /></Field>
        <Field label="Nueva" hint="Mínimo 8 caracteres"><Input type="password" name="newPassword" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
        <Field label="Repite la nueva"><Input type="password" name="confirm" autoComplete="new-password" required /></Field>
      </div>
      {mut.error && <div className="mt-3"><ErrorNote>{mut.error.message}</ErrorNote></div>}
      <div className="mt-4 flex items-center gap-3">
        {msg && <span className="text-sm text-muted">{msg}</span>}
        <Button type="submit" className="ml-auto" disabled={mut.isPending}>Cambiar contraseña</Button>
      </div>
    </form>
  );
}

/** Claro, oscuro o como el dispositivo. Se recuerda en cada teléfono o PC. */
function Appearance() {
  const { choice, set } = useTheme();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">Apariencia</p>
        <p className="text-sm text-muted">Con «Sistema» sigue al modo claro u oscuro de tu teléfono o PC.</p>
      </div>
      <Segmented<ThemeChoice> label="Apariencia" value={choice} onChange={set} options={[{ value: 'system', label: 'Sistema' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }]} />
    </div>
  );
}

/** Accesos directos para anotar un gasto en dos toques. */
function QuickEntry() {
  const [copied, setCopied] = useState<string | null>(null);
  const link = (tipo: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/nuevo?tipo=${tipo}`;
  const copy = async (tipo: string) => {
    await navigator.clipboard?.writeText(link(tipo)).catch(() => undefined);
    setCopied(tipo);
  };
  return (
    <section aria-labelledby="rapido" className="mt-4 rounded-2xl bg-surface p-5">
      <h2 id="rapido" className="flex items-center gap-2 font-bold"><Zap size={18} className="text-accent" /> Registro rápido</h2>
      <p className="mt-1 text-sm text-muted">
        Abre directo «Nuevo gasto» con la cuenta y la categoría que más usas ya elegidas: escribes el monto y listo.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/nuevo?tipo=gasto" className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-surface hover:bg-ink/90">Nuevo gasto</Link>
        <Link href="/nuevo?tipo=ingreso" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold hover:bg-ink/5">Nuevo ingreso</Link>
        <button onClick={() => copy('gasto')} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-ink/5">
          <Copy size={15} /> {copied === 'gasto' ? 'Enlace copiado' : 'Copiar enlace'}
        </button>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-accent">Dejarlo como acceso directo en el teléfono</summary>
        <div className="mt-2 flex flex-col gap-2 text-muted">
          <p><strong className="text-ink">Android:</strong> mantén presionado el ícono de Finanzas y elige «Nuevo gasto» o «Nuevo ingreso». Puedes arrastrarlo a la pantalla de inicio.</p>
          <p>
            <strong className="text-ink">iPhone:</strong> copia el enlace, abre la app <em>Atajos</em> → <em>+</em> → <em>Abrir URL</em>, pega el enlace,
            ponle de nombre «Gasto» y en <em>Compartir</em> → <em>Agregar a pantalla de inicio</em>. También puedes pedírselo a Siri por su nombre.
          </p>
        </div>
      </details>
    </section>
  );
}

/** Todo en un Excel: para tener tu propia copia o revisarlo en la computadora. */
function ExportAll() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      await downloadFile('/export/all', 'finanzas_completo.xlsx');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="exportar" className="mt-4 rounded-2xl bg-surface p-5">
      <h2 id="exportar" className="flex items-center gap-2 font-bold"><FileSpreadsheet size={18} className="text-accent" /> Exportar todo a Excel</h2>
      <p className="mt-1 text-sm text-muted">
        Un solo archivo con una hoja por tema: movimientos, transferencias, cuentas con su saldo, deudas y abonos, cuotas, metas, presupuestos, recurrentes, personas, conciliaciones y tasas.
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      <Button className="mt-3" variant="ghost" onClick={() => void go()} disabled={busy}>
        <FileSpreadsheet size={16} /> {busy ? 'Preparando…' : 'Descargar Excel'}
      </Button>
    </section>
  );
}

const TIMEOUTS = [{ v: 1, l: '1 minuto' }, { v: 5, l: '5 minutos' }, { v: 15, l: '15 minutos' }, { v: 60, l: '1 hora' }];

/** Bloqueo con PIN y huella / Face ID, solo en este dispositivo. */
function AppLock({ me }: { me: Me }) {
  const [cfg, setCfg] = useState<LockConfig | null>(null);
  const [bioOk, setBioOk] = useState(false);
  const [mode, setMode] = useState<'view' | 'setup' | 'off'>('view');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [timeout, setTimeoutMin] = useState(5);
  const [useBio, setUseBio] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secure, setSecure] = useState(true);
  const bio = biometricLabel();
  useEffect(() => {
    setSecure(window.isSecureContext && !!crypto.subtle);
    setCfg(getLock(me.id));
    void biometricAvailable().then(setBioOk);
  }, [me.id]);
  const update = (c: LockConfig | null) => { if (c) saveLock(c); else clearLock(); setCfg(c); };

  async function activate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(pin)) return setError('El PIN debe tener de 4 a 6 números');
    if (pin !== pin2) return setError('Los PIN no coinciden');
    setBusy(true);
    try {
      let credId: string | null = null;
      if (bioOk && useBio) {
        try { credId = await registerBiometric(me); } catch { setError(`No se activó ${bio}; queda solo el PIN. Puedes intentarlo después.`); }
      }
      update(await createLock(me.id, pin, timeout, credId));
      markUnlocked();
      setMode('view'); setPin(''); setPin2('');
    } finally {
      setBusy(false);
    }
  }
  async function deactivate(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    const r = await checkPin(cfg, pin);
    if (!r.ok) { setCfg(getLock(me.id)); return setError(`PIN incorrecto (te quedan ${r.left} intentos)`); }
    update(null); setMode('view'); setPin(''); setError(null);
  }
  async function addBio() {
    if (!cfg) return;
    setError(null);
    try { update({ ...cfg, credId: await registerBiometric(me) }); } catch { setError(`No se pudo activar ${bio}`); }
  }

  return (
    <section aria-labelledby="bloqueo" className="mt-4 rounded-2xl bg-surface p-5">
      <h2 id="bloqueo" className="flex items-center gap-2 font-bold"><Lock size={18} className="text-accent" /> Bloqueo de la app</h2>
      <p className="mt-1 text-sm text-muted">
        Pide un PIN{bioOk ? ` o ${bio}` : ''} al abrir la app y cuando vuelves después de un rato. Se configura en cada teléfono o computadora por separado.
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}

      {cfg && mode === 'view' && (
        <div className="mt-3 flex flex-col gap-3 text-sm">
          <p className="font-semibold text-income">Activo en este dispositivo{cfg.credId ? ` · con ${bio}` : ''}</p>
          <Field label="Volver a bloquear tras">
            <select
              value={cfg.timeoutMin}
              onChange={(e) => update({ ...cfg, timeoutMin: Number(e.target.value) })}
              className="h-11 rounded-xl border border-line bg-surface px-3"
            >
              {TIMEOUTS.map((t) => <option key={t.v} value={t.v}>{t.l} en segundo plano</option>)}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => window.dispatchEvent(new Event('fz-lock'))}><Lock size={16} /> Bloquear ahora</Button>
            {bioOk && !cfg.credId && <Button variant="ghost" onClick={() => void addBio()}><Fingerprint size={16} /> Usar {bio}</Button>}
            {cfg.credId && <Button variant="ghost" onClick={() => update({ ...cfg, credId: null })}>Quitar {bio}</Button>}
            <Button variant="danger" onClick={() => { setMode('off'); setError(null); }}>Desactivar</Button>
          </div>
        </div>
      )}

      {cfg && mode === 'off' && (
        <form onSubmit={deactivate} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Tu PIN actual" className="w-40">
            <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <Button type="submit" variant="danger">Desactivar bloqueo</Button>
          <Button type="button" variant="ghost" onClick={() => { setMode('view'); setPin(''); setError(null); }}>Cancelar</Button>
        </form>
      )}

      {!cfg && !secure && (
        <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
          Para usar el bloqueo abre la app con https (por ejemplo la dirección .ts.net de Tailscale); con http el navegador no permite guardar el PIN de forma segura.
        </p>
      )}
      {!cfg && secure && mode !== 'setup' && <Button className="mt-3" variant="ghost" onClick={() => setMode('setup')}><Lock size={16} /> Activar bloqueo</Button>}

      {!cfg && mode === 'setup' && (
        <form onSubmit={activate} className="mt-3 flex flex-col gap-3">
          <div className="flex gap-2">
            <Field label="PIN (4 a 6 números)" className="flex-1">
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
            <Field label="Repítelo" className="flex-1">
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} />
            </Field>
          </div>
          <Field label="Volver a bloquear tras">
            <select value={timeout} onChange={(e) => setTimeoutMin(Number(e.target.value))} className="h-11 rounded-xl border border-line bg-surface px-3">
              {TIMEOUTS.map((t) => <option key={t.v} value={t.v}>{t.l} en segundo plano</option>)}
            </select>
          </Field>
          {bioOk && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useBio} onChange={(e) => setUseBio(e.target.checked)} className="size-4 accent-accent" />
              Usar también {bio}
            </label>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Activando…' : 'Activar'}</Button>
            <Button type="button" variant="ghost" onClick={() => { setMode('view'); setPin(''); setPin2(''); setError(null); }}>Cancelar</Button>
          </div>
        </form>
      )}
    </section>
  );
}
