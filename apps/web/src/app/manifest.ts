import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Finanzas',
    short_name: 'Finanzas',
    description: 'Ingresos y gastos en dólares y bolívares',
    lang: 'es-VE',
    start_url: '/resumen',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f3f5f8',
    theme_color: '#16233a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Mantener presionado el ícono de la app ofrece este atajo
    shortcuts: [{ name: 'Nuevo movimiento', short_name: 'Nuevo', url: '/movimientos?nuevo=1', icons: [{ src: '/icon-192.png', sizes: '192x192' }] }],
  };
}
