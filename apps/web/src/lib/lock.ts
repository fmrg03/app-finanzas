'use client';

/**
 * Bloqueo de la app en este dispositivo: PIN y, si el equipo lo permite, huella o Face ID (WebAuthn).
 *
 * Es un bloqueo de privacidad para cuando otra persona agarra el teléfono o la computadora:
 * todo vive en este navegador (el PIN se guarda solo como hash PBKDF2 con sal) y no reemplaza
 * la contraseña de la cuenta. Tras 5 intentos fallidos se cierra la sesión.
 */
export interface LockConfig {
  userId: string;
  salt: string;
  hash: string;
  pinLength: number;
  /** Credencial de huella / Face ID registrada en este equipo (base64url) */
  credId: string | null;
  /** Minutos en segundo plano tras los que se vuelve a bloquear */
  timeoutMin: number;
  attempts: number;
}

export const MAX_ATTEMPTS = 5;
const KEY = 'fz-lock';
const UNLOCKED = 'fz-unlocked';
const HIDDEN_AT = 'fz-hidden-at';
const ITERATIONS = 150_000;

const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function getLock(userId: string): LockConfig | null {
  const c = safe(() => JSON.parse(localStorage.getItem(KEY) ?? 'null') as LockConfig | null, null);
  return c && c.userId === userId ? c : null;
}
export function saveLock(c: LockConfig) { safe(() => localStorage.setItem(KEY, JSON.stringify(c)), undefined); }
export function clearLock() { safe(() => localStorage.removeItem(KEY), undefined); }

/** Desbloqueada en esta pestaña (sessionStorage se borra al cerrar la app o la pestaña). */
export const isUnlocked = () => safe(() => sessionStorage.getItem(UNLOCKED) === '1', false);
export function markUnlocked() { safe(() => { sessionStorage.setItem(UNLOCKED, '1'); sessionStorage.removeItem(HIDDEN_AT); }, undefined); }
export function markLocked() { safe(() => sessionStorage.removeItem(UNLOCKED), undefined); }
export function markHidden() { safe(() => sessionStorage.setItem(HIDDEN_AT, String(Date.now())), undefined); }
/** ¿Estuvo en segundo plano más tiempo del permitido? */
export function hiddenTooLong(c: LockConfig) {
  const at = Number(safe(() => sessionStorage.getItem(HIDDEN_AT), null) ?? 0);
  return !!at && Date.now() - at >= c.timeoutMin * 60_000;
}

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pbkdf2(pin: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

export async function createLock(userId: string, pin: string, timeoutMin: number, credId: string | null): Promise<LockConfig> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { userId, salt: b64(salt), hash: await pbkdf2(pin, salt), pinLength: pin.length, credId, timeoutMin, attempts: 0 };
}

/** Compara el PIN; lleva la cuenta de intentos fallidos. */
export async function checkPin(c: LockConfig, pin: string) {
  const ok = (await pbkdf2(pin, unb64(c.salt))) === c.hash;
  const next = { ...c, attempts: ok ? 0 : c.attempts + 1 };
  saveLock(next);
  return { ok, left: MAX_ATTEMPTS - next.attempts };
}

/** ¿Este equipo tiene huella, Face ID o Windows Hello disponible para la web? */
export async function biometricAvailable() {
  if (typeof window === 'undefined' || !window.isSecureContext || !window.PublicKeyCredential) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
}

export async function registerBiometric(user: { email: string; name?: string | null }) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Finanzas' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: user.email, displayName: user.name?.trim() || user.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No se pudo registrar la huella o Face ID');
  return b64(cred.rawId);
}

/** Pide la huella o Face ID. true si el sistema verificó a la persona. */
export async function verifyBiometric(credId: string) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
  return !!res;
}

export const biometricLabel = () => {
  if (typeof navigator === 'undefined') return 'huella o Face ID';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'Face ID o Touch ID';
  if (/Mac/.test(ua)) return 'Touch ID';
  if (/Windows/.test(ua)) return 'Windows Hello';
  if (/Android/.test(ua)) return 'huella';
  return 'huella o Face ID';
};
