'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type NotificationType = 'BUDGET_NEAR' | 'BUDGET_EXCEEDED' | 'RECURRING_DUE' | 'DEBT_OVERDUE' | 'GOAL_REACHED'
  | 'GOAL_DEADLINE_NEAR'
  | 'GOAL_BEHIND'
  | 'GOAL_MISSED';
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** La API revisa las condiciones en cada consulta: se consulta al abrir, cada minuto y al volver a la pestaña. */
export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; items: AppNotification[] }>('/notifications'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') => (id === 'all' ? api('/notifications/read-all', { method: 'POST' }) : api(`/notifications/${id}/read`, { method: 'POST' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
export function timeAgo(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return 'ahora';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Intl.DateTimeFormat('es-VE', { day: 'numeric', month: 'short' }).format(new Date(iso));
}
