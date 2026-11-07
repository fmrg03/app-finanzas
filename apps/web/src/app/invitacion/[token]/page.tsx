'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { session } from '@/lib/session';

interface InvitationInfo {
  kind: 'INVITE' | 'RESET';
  name: string | null;
  email: string | null;
  invitedBy: string;
  expiresAt: string;
}

/** Enlace de un solo uso: crear la cuenta de un familiar o poner una contraseña nueva. */
export default function InvitacionPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationInfo>(`/auth/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password'));
    if (password !== String(fd.get('password2'))) return setError('Las contraseñas no coinciden');
    setBusy(true);
    setError(null);
    try {
      const body = info.data?.kind === 'RESET'
        ? { password }
        : { password, name: String(fd.get('name')).trim(), email: String(fd.get('email')).trim() };
      const { accessToken } = await api<{ accessToken: string }>(`/auth/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', json: body });
      // Si en este equipo había otra sesión, se olvida lo que tenía en pantalla
      qc.clear();
      session.setAccessToken(accessToken);
      router.replace('/resumen');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const reset = info.data?.kind === 'RESET';
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-extrabold tracking-tight">Finanzas</h1>
        {info.isPending && <p className="mt-6 text-muted">Revisando el enlace…</p>}
        {info.isError && (
          <div className="mt-6">
            <ErrorNote>{(info.error as Error).message}</ErrorNote>
            <p className="mt-3 text-sm text-muted">Pídele a quien administra la app que te envíe un enlace nuevo.</p>
          </div>
        )}
        {info.data && (
          <>
            <p className="mt-1 text-muted">
              {reset
                ? `Hola ${info.data.name}: elige tu nueva contraseña.`
                : `${info.data.invitedBy} te invitó a llevar tus finanzas aquí. Tus datos son solo tuyos: nadie más los ve.`}
            </p>
            <form method="post" onSubmit={onSubmit} className="mt-8 flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgb(22_35_58/0.08)]">
              {reset ? (
                <Field label="Correo"><Input value={info.data.email ?? ''} readOnly disabled /></Field>
              ) : (
                <>
                  <Field label="Tu nombre"><Input name="name" defaultValue={info.data.name ?? ''} required maxLength={60} autoComplete="given-name" autoFocus /></Field>
                  <Field label="Correo" hint="Con él vas a entrar"><Input name="email" type="email" required autoComplete="email" /></Field>
                </>
              )}
              <Field label={reset ? 'Nueva contraseña' : 'Contraseña'} hint="Mínimo 8 caracteres">
                <Input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" autoFocus={reset} />
              </Field>
              <Field label="Repítela"><Input name="password2" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></Field>
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button type="submit" disabled={busy || !ready} className="mt-2">
                {busy ? 'Un momento…' : reset ? 'Guardar contraseña' : 'Crear mi cuenta'}
              </Button>
            </form>
            <p className="mt-3 text-center text-xs text-muted">El enlace sirve una sola vez y vence el {new Date(info.data.expiresAt).toLocaleString('es-VE', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
          </>
        )}
      </div>
    </main>
  );
}
