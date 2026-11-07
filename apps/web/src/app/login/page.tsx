'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorNote, Field, Input } from '@/components/ui/controls';
import { ensureSession, login } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Hasta que React toma el control, el botón no envía nada
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    // Al llegar aquí (por ejemplo tras cerrar sesión) se olvida lo que mostraba la sesión anterior:
    // en un equipo que usan varios familiares, nadie ve los datos de otro
    qc.clear();
    // Con la cookie de sesión vigente (por ejemplo al abrir la app instalada) se entra directo
    ensureSession().then((ok) => (ok ? router.replace('/resumen') : setReady(true)));
  }, [router, qc]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await login(String(fd.get('email')), String(fd.get('password')));
      router.replace('/resumen');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-extrabold tracking-tight">Finanzas</h1>
        <p className="mt-1 text-muted">Tus ingresos y gastos, en dólares y bolívares.</p>
        <form method="post" onSubmit={onSubmit} className="mt-8 flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgb(22_35_58/0.08)]">
          <Field label="Correo">
            <Input name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label="Contraseña">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy || !ready} className="mt-2">
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </div>
    </main>
  );
}
