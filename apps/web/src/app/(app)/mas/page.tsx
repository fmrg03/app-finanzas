'use client';

import { ChevronRight, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import { NAV_GROUPS, NAV_MOBILE } from '@/lib/nav';

const inBar = new Set(NAV_MOBILE.map((n) => n.href));

export default function MasPage() {
  const router = useRouter();
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Más</h1>
      {NAV_GROUPS.map((g, i) => {
        const items = g.items.filter((it) => !inBar.has(it.href));
        if (!items.length) return null;
        return (
          <section key={i} className="mt-5">
            {g.label && <h2 className="mb-2 text-sm font-semibold text-muted">{g.label}</h2>}
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
              {items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="flex items-center gap-3 px-4 py-3.5 font-semibold hover:bg-canvas/60">
                    <Icon size={20} className="text-accent" /> <span className="flex-1">{label}</span> <ChevronRight size={18} className="text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <button onClick={async () => { await logout(); router.replace('/login'); }} className="mt-6 flex items-center gap-2 text-sm font-semibold text-muted hover:text-ink">
        <LogOut size={18} /> Cerrar sesión
      </button>
    </>
  );
}
