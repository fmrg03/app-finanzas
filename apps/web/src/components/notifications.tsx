'use client';

import * as Popover from '@radix-ui/react-popover';
import { Bell, CalendarClock, CalendarX, CircleAlert, Gauge, HandCoins, Repeat, TrendingDown, Trophy, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/format';
import { timeAgo, useMarkRead, useNotifications, type AppNotification, type NotificationType } from '@/lib/notifications';

const META: Record<NotificationType, { icon: typeof Bell; tone: string }> = {
  BUDGET_EXCEEDED: { icon: CircleAlert, tone: 'bg-expense-soft text-expense' },
  BUDGET_NEAR: { icon: Gauge, tone: 'bg-warning-soft text-warning' },
  RECURRING_DUE: { icon: Repeat, tone: 'bg-accent-soft text-accent' },
  DEBT_OVERDUE: { icon: HandCoins, tone: 'bg-expense-soft text-expense' },
  GOAL_REACHED: { icon: Trophy, tone: 'bg-income-soft text-income' },
  GOAL_DEADLINE_NEAR: { icon: CalendarClock, tone: 'bg-warning-soft text-warning' },
  GOAL_BEHIND: { icon: TrendingDown, tone: 'bg-warning-soft text-warning' },
  GOAL_MISSED: { icon: CalendarX, tone: 'bg-expense-soft text-expense' },
};

function TypeIcon({ type, size = 16 }: { type: NotificationType; size?: number }) {
  const { icon: Icon, tone } = META[type];
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', tone)} aria-hidden>
      <Icon size={size} />
    </span>
  );
}

/** Campanita con el número de avisos sin leer y el panel con el historial. */
export function NotificationBell({ className }: { className?: string }) {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;

  function go(n: AppNotification) {
    if (!n.readAt) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn('relative grid size-9 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink', className)}
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : 'Notificaciones'}
      >
        <Bell size={19} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-expense px-1 text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(32rem,75dvh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-bold">Notificaciones</p>
            {unread > 0 && (
              <button onClick={() => markRead.mutate('all')} className="text-sm font-semibold text-accent hover:underline">
                Marcar todas como leídas
              </button>
            )}
          </div>
          {!data?.items.length ? (
            <p className="px-6 py-10 text-center text-sm text-muted">
              Sin avisos por ahora. Te avisaremos cuando te acerques al tope de un presupuesto, te pases de él, o tengas algo por confirmar.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => go(n)} className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-canvas/60', !n.readAt && 'bg-accent-soft/40')}>
                    <TypeIcon type={n.type} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', n.readAt ? 'font-medium' : 'font-bold')}>{n.title}</span>
                      <span className="mt-0.5 block text-sm text-muted">{n.body}</span>
                      <span className="mt-1 block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" aria-label="Sin leer" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Aviso emergente cuando aparece una notificación nueva mientras usas la app
 * (por ejemplo, justo después de guardar el gasto que te hace pasar del presupuesto).
 */
export function NotificationToasts() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!data) return;
    // En la primera carga no se muestra nada: lo pendiente ya está en la campanita
    if (!seen.current) {
      seen.current = new Set(data.items.map((n) => n.id));
      return;
    }
    const fresh = data.items.filter((n) => !n.readAt && !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    if (fresh.length) setQueue((q) => [...fresh.reverse(), ...q].slice(0, 3));
  }, [data]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 8000);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3 md:inset-x-auto md:right-6 md:top-6">
      {current && (
        <div role="status" className="pointer-events-auto flex w-full max-w-sm gap-3 rounded-2xl border border-line bg-surface p-4 shadow-xl">
          <TypeIcon type={current.type} />
          <button
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              markRead.mutate(current.id);
              setQueue((q) => q.slice(1));
              if (current.link) router.push(current.link);
            }}
          >
            <span className="block text-sm font-bold">{current.title}</span>
            <span className="mt-0.5 block text-sm text-muted">{current.body}</span>
          </button>
          <button onClick={() => setQueue((q) => q.slice(1))} className="self-start rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
