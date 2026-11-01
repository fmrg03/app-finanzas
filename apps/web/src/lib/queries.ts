'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Account, Category, Currency, ExchangeRate, RateForDate, RateSource, ReceiptRead, TxList, TxType } from './types';

export const useAccounts = (includeArchived = false) =>
  useQuery({ queryKey: ['accounts', includeArchived], queryFn: () => api<Account[]>(`/accounts?includeArchived=${includeArchived}`) });

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });

export const useLatestRates = () =>
  useQuery({ queryKey: ['rates', 'latest'], queryFn: () => api<ExchangeRate[]>('/exchange-rates/latest'), staleTime: 5 * 60_000 });

export const useRateForDate = (date: string, source: RateSource) =>
  useQuery({
    queryKey: ['rates', 'for-date', date, source],
    queryFn: () => api<RateForDate>(`/exchange-rates/for-date?date=${date}&source=${source}`),
    enabled: !!date && source !== 'MANUAL',
    retry: false,
  });

export interface TxFilters {
  from?: string;
  to?: string;
  type?: TxType;
  accountId?: string;
  categoryId?: string;
  q?: string;
  page?: number;
}

export const txParams = (f: TxFilters) => {
  const params = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v !== undefined && v !== '' && params.set(k, String(v)));
  return params;
};

/** Movimientos por páginas de 100, con "Cargar más". */
export const useTransactions = (f: TxFilters) =>
  useInfiniteQuery({
    queryKey: ['transactions', 'list', f],
    queryFn: ({ pageParam }) => {
      const params = txParams(f);
      params.set('page', String(pageParam));
      params.set('pageSize', '100');
      return api<TxList>(`/transactions?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  });

export interface TxInput {
  type: TxType;
  accountId: string;
  categoryId: string | null;
  date: string;
  currency: Currency;
  amount: string;
  rateSource?: RateSource;
  rate?: string;
  description?: string;
  tags?: string[];
}

/** Invalida todo lo que depende de los movimientos (lista, saldos de cuentas). */
function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['transactions', 'accounts', 'budgets', 'net-worth', 'recurring', 'notifications']) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useSaveTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, data, receiptId }: { id?: string; data: TxInput; receiptId?: string }) =>
      id
        ? api(`/transactions/${id}`, { method: 'PATCH', json: data })
        : receiptId
          ? api(`/receipts/${receiptId}/confirm`, { method: 'POST', json: data })
          : api('/transactions', { method: 'POST', json: data }),
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({ mutationFn: (id: string) => api(`/transactions/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
}

export interface Me {
  id: string;
  email: string;
  defaultCurrency: Currency;
  defaultRateSource: RateSource;
}
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: Infinity });

export interface MoneyPair { usd: string; ves: string }
export interface Overview {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string; days: number };
  totals: { income: MoneyPair; expense: MoneyPair; net: MoneyPair; count: number };
  previousTotals: { income: MoneyPair; expense: MoneyPair; net: MoneyPair; count: number };
  expenseByCategory: ({ categoryId: string | null; name: string; color: string; count: number } & MoneyPair)[];
  monthly: { month: string; income: MoneyPair; expense: MoneyPair; net: MoneyPair }[];
  cumulativeExpense: { current: MoneyPair[]; previous: MoneyPair[] };
}
export const useOverview = (from: string, to: string, months = 6) =>
  useQuery({
    queryKey: ['transactions', 'overview', from, to, months],
    queryFn: () => api<Overview>(`/stats/overview?from=${from}&to=${to}&months=${months}`),
    placeholderData: (p) => p,
  });

export const useReceiptsStatus = () =>
  useQuery({ queryKey: ['receipts', 'status'], queryFn: () => api<{ enabled: boolean; model: string | null }>('/receipts/status'), staleTime: Infinity });

export function useReadReceipt() {
  return useMutation({
    mutationFn: (file: Blob) => {
      const fd = new FormData();
      fd.append('file', file, file instanceof File ? file.name : 'factura.jpg');
      return api<ReceiptRead>('/receipts', { method: 'POST', body: fd });
    },
  });
}
