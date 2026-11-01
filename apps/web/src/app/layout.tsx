import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource-variable/manrope';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finanzas',
  description: 'Ingresos y gastos en dólares y bolívares',
  applicationName: 'Finanzas',
  // Al agregarla a la pantalla de inicio del iPhone abre como app, sin la barra del navegador
  appleWebApp: { capable: true, title: 'Finanzas', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }, { url: '/icon-192.png', type: 'image/png', sizes: '192x192' }],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#16233a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
