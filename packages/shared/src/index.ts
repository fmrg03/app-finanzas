export const CURRENCIES = ['USD', 'VES'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const RATE_SOURCES = ['BCV', 'PARALELO', 'MANUAL'] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
