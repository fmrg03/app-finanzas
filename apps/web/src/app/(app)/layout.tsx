'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { NotificationBell, NotificationToasts } from '@/components/notifications';
import { ensureSession, logout } from '@/lib/api';
import { cn, rate } from '@/lib/format';
import { isMoreSection, NAV_GROUPS, NAV_MOBILE } from '@/lib/nav';
import { useLatestRates } from '@/lib/queries';
import { RATE_LABEL } from '@/lib/types';

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // El access token solo vive en memoria: al abrir la app se pide uno nuevo con la cookie
    ensureSession().then((ok) => (ok ? setReady(true) : router.replace('/login')));
  }, [router]);

  if (!ready) return null;
  return (
    <div className="md:grid md:grid-cols-[15rem_1fr]">
      <Sidebar />
      <MobileHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-10">{children}</main>
      <BottomNav />
      <NotificationToasts />
    </div>
  );
}

function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-line bg-surface px-4 py-6 md:flex">
      <div className="flex items-center justify-between pl-2">
        <span className="text-xl font-extrabold tracking-tight">Finanzas</span>
        <NotificationBell />
      </div>
      <nav className="mt-6 flex flex-col">
        {NAV_GROUPS.map((g, i) => (
          <div key={i} className={cn('flex flex-col gap-0.5', i > 0 && 'mt-5')}>
            {g.label && <p className="mb-1 px-3 text-xs font-semibold text-muted/80">{g.label}</p>}
            {g.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={path.startsWith(href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-canvas hover:text-ink',
                  path.startsWith(href) && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
                )}
              >
                <Icon size={18} /> {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-4 pt-6">
        <RatesPanel />
        <button
          onClick={async () => { await logout(); router.replace('/login'); }}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-canvas hover:text-ink"
        >
          <LogOut size={18} /> Salir
        </button>
      </div>
    </aside>
  );
}

/** Tasas vigentes: el dato que más se consulta antes de cargar un gasto. */
function RatesPanel() {
  const { data } = useLatestRates();
  const shown = data?.filter((r) => r.source !== 'MANUAL') ?? [];
  if (!shown.length) return null;
  return (
    <div className="rounded-xl bg-canvas p-3">
      <p className="text-xs text-muted">Bs por dólar</p>
      <dl className="mt-2 flex flex-col gap-1.5">
        {shown.map((r) => (
          <div key={r.id} className="flex items-baseline justify-between">
            <dt className="text-sm text-muted">{RATE_LABEL[r.source]}</dt>
            <dd className="font-bold tabular-nums">{rate(r.rate)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Al {shown[0].date.slice(0, 10).split('-').reverse().join('/')}</p>
    </div>
  );
}

function MobileHeader() {
  const { data } = useLatestRates();
  const shown = data?.filter((r) => r.source !== 'MANUAL') ?? [];
  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
      <span className="font-extrabold tracking-tight">Finanzas</span>
      {!!shown.length && (
        <dl className="ml-auto flex gap-3 text-xs" aria-label="Bs por dólar">
          {shown.map((r) => (
            <div key={r.id} className="flex gap-1">
              <dt className="text-muted">{RATE_LABEL[r.source]}</dt>
              <dd className="font-bold tabular-nums">{rate(r.rate)}</dd>
            </div>
          ))}
        </dl>
      )}
      <NotificationBell className={cn('-mr-1.5', !shown.length && 'ml-auto')} />
    </header>
  );
}

function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
      {NAV_MOBILE.map(({ href, label, icon: Icon }) => {
        const active = href === '/mas' ? isMoreSection(path) : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-muted', active && 'text-accent')}
          >
            <Icon size={20} /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
