import type { ReactNode } from 'react';

export const metadata = { title: 'Finanzas' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: 32 }}>{children}</body>
    </html>
  );
}
