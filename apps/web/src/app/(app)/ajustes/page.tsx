'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Copy, LogOut, Tags, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { FamilySection } from '@/components/family-section';
import { Button, ErrorNote, Field, Input, Segmented } from '@/components/ui/controls';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { api, logout } from '@/lib/api';
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
