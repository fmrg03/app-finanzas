'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { BudgetStatus, Debt, Goal, InstallmentPlan, Member, NetWorth, PendingInvitation, Person, Recurring, Transfer, UpcomingInstallments } from './types';

/** Todo lo que cambia saldos o totales: se refresca junto. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['transactions', 'accounts', 'transfers', 'recurring', 'budgets', 'net-worth', 'notifications', 'debts', 'people', 'installments', 'family']) qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Mutación genérica contra la API que al terminar refresca lo que depende de ella. */
export function useApiMutation<V = unknown, R = unknown>(fn: (v: V) => Promise<R>, keys?: string[]) {
  const qc = useQueryClient();
  const all = useInvalidateAll();
  return useMutation({
    mutationFn: fn,
    // Cualquier cambio puede crear o resolver un aviso: la campanita se refresca siempre
    onSuccess: () => (keys ? [...keys, 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })) : all()),
  });
}

export const useTransfers = (from?: string, to?: string) =>
  useQuery({
    queryKey: ['transfers', from, to],
    queryFn: () => api<Transfer[]>(`/transfers?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
    placeholderData: (p) => p,
  });

export const useRecurring = () => useQuery({ queryKey: ['recurring', 'all'], queryFn: () => api<Recurring[]>('/recurring') });
export const useRecurringDue = () => useQuery({ queryKey: ['recurring', 'due'], queryFn: () => api<Recurring[]>('/recurring/due') });

export const useBudgets = (month?: string) =>
  useQuery({ queryKey: ['budgets', month], queryFn: () => api<BudgetStatus>(`/budgets${month ? `?month=${month}` : ''}`), placeholderData: (p) => p });

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api<Goal[]>('/goals') });
export const useDebts = () => useQuery({ queryKey: ['debts'], queryFn: () => api<Debt[]>('/debts') });
export const useNetWorth = (months = 12) => useQuery({ queryKey: ['net-worth', months], queryFn: () => api<NetWorth>(`/stats/net-worth?months=${months}`) });
export const usePeople = () => useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/people') });
export const useInstallmentPlans = () => useQuery({ queryKey: ['installments', 'plans'], queryFn: () => api<InstallmentPlan[]>('/installment-plans') });
export const useUpcomingInstallments = (days = 30) =>
  useQuery({ queryKey: ['installments', 'upcoming', days], queryFn: () => api<UpcomingInstallments>(`/installment-plans/upcoming?days=${days}`) });
export const useMembers = () => useQuery({ queryKey: ['family', 'members'], queryFn: () => api<Member[]>('/family/members') });
export const usePendingInvitations = (enabled: boolean) =>
  useQuery({ queryKey: ['family', 'invitations'], queryFn: () => api<PendingInvitation[]>('/family/invitations'), enabled });
