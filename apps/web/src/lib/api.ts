import { session } from './session';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** true: hay token nuevo; false: la cookie no sirvió; 'none': no hay cookie de sesión. */
async function tryRefresh(): Promise<boolean | 'none'> {
  const res = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return body?.code === 'NO_SESSION' ? 'none' : false;
  }
  session.setAccessToken(((await res.json()) as { accessToken: string }).accessToken);
  return true;
}

/**
 * Pide un access token nuevo usando la cookie. Una sola petición aunque fallen varias a la vez.
 * Si otra pestaña acaba de rotar la cookie, el primer intento falla: se reintenta una vez.
 */
export function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const first = await tryRefresh();
      if (first !== false) return first === true;
      await new Promise((r) => setTimeout(r, 400));
      return (await tryRefresh()) === true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

/** Al abrir la app: hay sesión si ya tenemos token o si la cookie permite obtener uno. */
export async function ensureSession() {
  return session.getAccessToken() ? true : refreshTokens();
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const { json, headers, ...rest } = init;
  const token = session.getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con la API. Revisa que esté corriendo en ' + API_URL);
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshTokens()) return api<T>(path, init, true);
    session.clear();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, 'Tu sesión expiró');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg = res.status === 429
      ? 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.'
      : Array.isArray(body?.message) ? body.message.join('. ') : body?.message;
    throw new ApiError(res.status, msg ?? `Error ${res.status}`, body ?? undefined);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function login(email: string, password: string) {
  const { accessToken } = await api<{ accessToken: string }>('/auth/login', { method: 'POST', json: { email, password } });
  session.setAccessToken(accessToken);
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  session.clear();
}

/** Descarga un archivo protegido y devuelve una URL local para mostrarlo o guardarlo. */
async function fetchProtected(path: string) {
  const go = () => fetch(`${API_URL}${path}`, { credentials: 'include', headers: { Authorization: `Bearer ${session.getAccessToken() ?? ''}` } });
  let res = await go();
  if (res.status === 401 && (await refreshTokens())) res = await go();
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'El archivo ya no existe' : `Error ${res.status}`);
  return res;
}

export async function fetchBlobUrl(path: string) {
  return URL.createObjectURL(await (await fetchProtected(path)).blob());
}

/** Descarga un archivo (por ejemplo el Excel) con el nombre que propone la API. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetchProtected(path);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
