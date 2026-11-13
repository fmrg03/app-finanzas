'use client';

import { Delete, Fingerprint, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { logout } from '@/lib/api';
import {
  biometricLabel, checkPin, getLock, hiddenTooLong, isUnlocked, markHidden, markLocked, markUnlocked, MAX_ATTEMPTS, saveLock, verifyBiometric,
  type LockConfig,
} from '@/lib/lock';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/format';

/** Muestra la pantalla de bloqueo en lugar de la app cuando corresponde. */
export function LockGate({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const [locked, setLocked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!me) return;
    const c = getLock(me.id);
    setLocked(!!c && !isUnlocked());
    const onVis = () => {
      const cfg = getLock(me.id);
      if (!cfg) return;
      if (document.visibilityState === 'hidden') markHidden();
      else if (hiddenTooLong(cfg)) { markLocked(); setLocked(true); }
    };
    // Bloquear desde Ajustes ("Bloquear ahora")
    const onLock = () => { if (getLock(me.id)) { markLocked(); setLocked(true); } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('fz-lock', onLock);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('fz-lock', onLock); };
  }, [me]);

  if (!me || locked === null) return null;
  if (locked) {
    const cfg = getLock(me.id);
    if (cfg) return <LockScreen cfg={cfg} name={me.name?.trim() || me.email.split('@')[0]} onUnlock={() => { markUnlocked(); setLocked(false); }} />;
  }
  return <>{children}</>;
}

function LockScreen({ cfg, name, onUnlock }: { cfg: LockConfig; name: string; onUnlock: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(false);
  const tried = useRef(false);

  const out = useCallback(async () => {
    saveLock({ ...cfg, attempts: 0 });
    await logout();
    router.replace('/login');
  }, [cfg, router]);

  const bio = useCallback(async () => {
    if (!cfg.credId) return;
    setError(null);
    try {
      if (await verifyBiometric(cfg.credId)) { saveLock({ ...cfg, attempts: 0 }); onUnlock(); }
    } catch (e) {
      // Cancelado o no disponible: queda el PIN
      if ((e as Error).name !== 'NotAllowedError') setError(`No se pudo usar ${biometricLabel()}. Usa tu PIN.`);
    }
  }, [cfg, onUnlock]);

  // Al abrir se ofrece la huella / Face ID directamente
  useEffect(() => {
    if (cfg.credId && !tried.current) { tried.current = true; void bio(); }
  }, [cfg.credId, bio]);

  const submit = useCallback(async (value: string) => {
    setChecking(true);
    const r = await checkPin(getLock(cfg.userId) ?? cfg, value);
    setChecking(false);
    if (r.ok) return onUnlock();
    setPin('');
    setShake(true);
    setTimeout(() => setShake(false), 400);
    if (r.left <= 0) { setError('Demasiados intentos. Entra de nuevo con tu contraseña.'); setTimeout(() => void out(), 1200); return; }
    setError(`PIN incorrecto. ${r.left === 1 ? 'Te queda 1 intento' : `Te quedan ${r.left} intentos`}.`);
  }, [cfg, onUnlock, out]);

  const press = useCallback((d: string) => {
    if (checking) return;
    setError(null);
    setPin((p) => {
      const next = (p + d).slice(0, cfg.pinLength);
      if (next.length === cfg.pinLength) void submit(next);
      return next;
    });
  }, [cfg.pinLength, checking, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-6 py-10" aria-label="App bloqueada">
      <div className="flex w-full max-w-xs flex-col items-center">
        <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent"><Lock size={26} /></span>
        <h1 className="mt-4 text-xl font-extrabold">Hola, {name}</h1>
        <p className="mt-1 text-sm text-muted">Escribe tu PIN para entrar</p>
        <div className={cn('mt-6 flex gap-3', shake && 'animate-[shake_0.4s]')} aria-label={`${pin.length} de ${cfg.pinLength} dígitos`}>
          {Array.from({ length: cfg.pinLength }, (_, i) => (
            <span key={i} className={cn('size-3.5 rounded-full border-2 border-ink/40', i < pin.length && 'border-ink bg-ink')} />
          ))}
        </div>
        <p className={cn('mt-3 h-5 text-center text-sm', error ? 'text-expense' : 'text-transparent')} role="alert">{error ?? '.'}</p>
        <div className="mt-4 grid w-full grid-cols-3 gap-3">
          {keys.map((k) => <Key key={k} onClick={() => press(k)}>{k}</Key>)}
          {cfg.credId ? (
            <Key onClick={() => void bio()} label={`Usar ${biometricLabel()}`}><Fingerprint size={26} /></Key>
          ) : <span />}
          <Key onClick={() => press('0')}>0</Key>
          <Key onClick={() => setPin((p) => p.slice(0, -1))} label="Borrar"><Delete size={24} /></Key>
        </div>
        <button onClick={() => void out()} className="mt-8 text-sm font-semibold text-muted hover:text-ink">¿Olvidaste el PIN? Entra con tu contraseña</button>
        <p className="mt-2 text-center text-xs text-muted">Tras {MAX_ATTEMPTS} intentos fallidos se cierra la sesión.</p>
      </div>
    </main>
  );
}

function Key({ children, onClick, label }: { children: ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-16 place-items-center rounded-2xl bg-surface text-2xl font-semibold tabular-nums shadow-sm active:scale-95 active:bg-accent-soft"
    >
      {children}
    </button>
  );
}

