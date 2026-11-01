// El access token vive solo en memoria (dura 15 minutos). El refresh token está en una
// cookie httpOnly que el navegador envía sola a /api/auth y que el JavaScript no puede leer.
let accessToken: string | null = null;

// Restos de la versión anterior, que guardaba los tokens en localStorage
try {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('fz.access');
    localStorage.removeItem('fz.refresh');
  }
} catch {}

export const session = {
  getAccessToken: () => accessToken,
  setAccessToken: (t: string | null) => {
    accessToken = t;
  },
  clear: () => {
    accessToken = null;
  },
};
