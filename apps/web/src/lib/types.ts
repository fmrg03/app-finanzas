export type Currency = 'USD' | 'VES';
export type RateSource = 'BCV' | 'PARALELO' | 'MANUAL';
export type TxType = 'INCOME' | 'EXPENSE';
export type AccountType = 'CASH' | 'BANK' | 'CARD' | 'WALLET';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  initialBalance: string;
  balance: string;
  archivedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  type: TxType;
  color: string;
  icon: string | null;
  parentId: string | null;
  defaultRateSource: RateSource | null;
  children?: Category[];
}

export interface Transaction {
  id: string;
  type: TxType;
  date: string;
  description: string | null;
  tags: string[];
  originalCurrency: Currency;
  originalAmount: string;
  amountUsd: string;
  amountVes: string;
  rateUsed: string;
  rateSource: RateSource;
  /** null solo en compartidos que pagó otra persona */
  accountId: string | null;
  categoryId: string | null;
  account: { id: string; name: string; currency: Currency } | null;
  category: { id: string; name: string; color: string; icon: string | null; parentId: string | null } | null;
  receipt: { id: string } | null;
  source: 'MANUAL' | 'IMPORT' | 'API' | 'RECEIPT' | 'RECURRING' | 'INSTALLMENT';
  /** Lo que cuenta como tuyo (igual al monto salvo en compartidos) */
  myAmountUsd: string;
  myAmountVes: string;
  sharePct: string | null;
  sharedId: string | null;
  shared: SharedInfo | null;
  installmentPlanId: string | null;
  installmentPlan: { id: string; provider: string; description: string; count: number } | null;
  installment: { id: string; n: number } | null;
}

export type SplitMode = 'EQUAL' | 'PERCENT' | 'AMOUNT';
export interface PersonRef { id: string; name: string; phone: string | null }
export interface SharedInfo {
  id: string;
  splitMode: SplitMode;
  totalUsd: string;
  /** Copia de una compra que registró un familiar (solo lectura) */
  mirrorOf?: { user: { id: string; name: string | null; email: string } } | null;
  paidBy: PersonRef | null;
  participants: { personId: string | null; pct: string; amountUsd: string; person: PersonRef | null }[];
}
export interface SplitInput {
  paidByPersonId: string | null;
  mode: SplitMode;
  participants: { personId: string | null; value?: string }[];
}

export interface Person extends PersonRef {
  linkedUserId: string | null;
  linkedUser: { id: string; name: string | null; email: string; disabledAt: string | null } | null;
  openDebts: number;
  owedToMeUsd: string;
  owedToMeVes: string;
  iOweUsd: string;
  iOweVes: string;
}

export type InstallmentFrequency = 'DAYS_14' | 'DAYS_15' | 'MONTHLY';
export const FREQUENCY_LABEL: Record<InstallmentFrequency, string> = { DAYS_14: 'Cada 14 días', DAYS_15: 'Cada 15 días', MONTHLY: 'Mensual' };
export interface Installment {
  id: string;
  n: number;
  dueDate: string;
  amountUsd: string;
  transactionId: string | null;
  overdue: boolean;
  transaction: { id: string; date: string; amountUsd: string; amountVes: string; originalCurrency: Currency; account: { id: string; name: string } | null } | null;
}
export interface InstallmentPlan {
  id: string;
  provider: string;
  store: string | null;
  description: string;
  categoryId: string | null;
  category: { id: string; name: string; color: string } | null;
  account: { id: string; name: string; currency: Currency } | null;
  purchaseDate: string;
  totalUsd: string;
  downPaymentUsd: string;
  count: number;
  frequency: InstallmentFrequency;
  rateUsed: string;
  shared: (SharedInfo & { paidByPersonId: string | null }) | null;
  installments: Installment[];
  paidByMe: boolean;
  myPct: string | null;
  paidCount: number;
  paidUsd: string;
  remainingUsd: string;
  nextDue: { id: string; n: number; dueDate: string; amountUsd: string; overdue: boolean } | null;
}
export interface UpcomingInstallments {
  totalUsd: string;
  items: { id: string; n: number; dueDate: string; amountUsd: string; plan: { id: string; provider: string; description: string; count: number } }[];
}

export interface TxList {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  totals: { incomeUsd: string; incomeVes: string; expenseUsd: string; expenseVes: string; netUsd: string; netVes: string };
}

export interface ExchangeRate {
  id: string;
  date: string;
  source: RateSource;
  rate: string;
}

export interface RateForDate {
  requestedDate: string;
  rateDate: string;
  source: RateSource;
  rate: string;
  fallback: boolean;
}

export const RATE_LABEL: Record<RateSource, string> = { BCV: 'BCV', PARALELO: 'Paralelo', MANUAL: 'Manual' };
export const ACCOUNT_LABEL: Record<AccountType, string> = { CASH: 'Efectivo', BANK: 'Banco', CARD: 'Tarjeta', WALLET: 'Billetera digital' };

export interface ReceiptExtraction {
  merchant: string | null;
  taxId: string | null;
  date: string | null;
  currency: Currency | null;
  total: number | null;
  exchangeRate: number | null;
  totalUsdReference: number | null;
  items: { description: string; quantity: number | null; amount: number | null }[];
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

export interface ReceiptRead {
  receiptId: string;
  extraction: ReceiptExtraction;
  suggestion: {
    type: TxType;
    date: string;
    currency: Currency;
    amount: string;
    categoryId: string | null;
    description: string | null;
    rateSource?: RateSource;
    rate?: string;
  };
}

type AccountRef = { id: string; name: string; currency: Currency };

export interface Transfer {
  id: string;
  date: string;
  fromAccountId: string;
  toAccountId: string;
  fromAccount: AccountRef;
  toAccount: AccountRef;
  fromAmount: string;
  toAmount: string;
  rate: string | null;
  referenceRate: string | null;
  vsReference: string | null;
  description: string | null;
}

export type Frequency = 'WEEKLY' | 'MONTHLY';
export interface Recurring {
  id: string;
  type: TxType;
  accountId: string;
  categoryId: string | null;
  account: AccountRef;
  category: { id: string; name: string; color: string } | null;
  currency: Currency;
  amount: string;
  rateSource: RateSource | null;
  description: string;
  tags: string[];
  frequency: Frequency;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  autoCreate: boolean;
  active: boolean;
}

export interface BudgetItem {
  id: string;
  categoryId: string;
  name: string;
  color: string;
  amountUsd: string;
  spentUsd: string;
  remainingUsd: string;
  pct: number;
  projectedUsd: string;
  status: 'ok' | 'warning' | 'over';
}
export interface BudgetStatus {
  month: string;
  daysInMonth: number;
  daysElapsed: number;
  items: BudgetItem[];
  totals: { budgetUsd: string; spentUsd: string };
}

export interface Goal {
  id: string;
  name: string;
  targetUsd: string;
  targetDate: string | null;
  color: string;
  archivedAt: string | null;
  contributions: { id: string; date: string; amountUsd: string; note: string | null }[];
  savedUsd: string;
  remainingUsd: string;
  pct: number;
  monthlyNeededUsd: string | null;
  /** Aporte mensual propuesto por el usuario (opcional). */
  monthlyUsd: string | null;
  /** Lo que toca aportar este mes: el propuesto o, si no hay, el necesario. */
  planUsd: string | null;
  thisMonthUsd: string;
  daysLeft: number | null;
  overdue: boolean;
}

export type DebtDirection = 'I_OWE' | 'OWED_TO_ME';
export interface Debt {
  id: string;
  direction: DebtDirection;
  person: string;
  description: string | null;
  currency: Currency;
  amount: string;
  dueDate: string | null;
  settledAt: string | null;
  payments: {
    id: string; date: string; amount: string; note: string | null; accountAmount: string | null; mirrorOfId: string | null;
    account: { id: string; name: string; currency: Currency } | null;
  }[];
  paid: string;
  remaining: string;
  overdue: boolean;
  personId: string | null;
  personRef: PersonRef | null;
  sharedId: string | null;
  fromShared: boolean;
  /** Enlazada con la misma deuda en la cuenta de un familiar: los abonos se copian */
  synced: boolean;
  /** Nombre del familiar que registró la compra, si es una copia */
  sharedBy: string | null;
}

export interface Member {
  id: string;
  email: string;
  name: string | null;
  displayName: string;
  role: 'ADMIN' | 'MEMBER';
  disabledAt: string | null;
  createdAt: string;
  me: boolean;
}
export interface InvitationLink { id: string; kind: 'INVITE' | 'RESET'; token: string; path: string; expiresAt: string }
export interface PendingInvitation { id: string; name: string | null; expiresAt: string; createdAt: string; createdBy: string }

export interface NetWorth {
  today: string;
  rate: string | null;
  totalUsd: string;
  devaluationTotalUsd: string;
  pendingInstallmentsUsd: string;
  accounts: { id: string; name: string; type: AccountType; currency: Currency; archived: boolean; balance: string; balanceUsd: string | null }[];
  months: { month: string; date: string; rate: string | null; usd: string; ves: string; vesInUsd: string | null; netUsd: string; devaluationUsd: string }[];
}
