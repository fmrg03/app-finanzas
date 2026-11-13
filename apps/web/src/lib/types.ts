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
  /** Cuentas en Bs: tasa promedio (Bs por USD) a la que compraste los bolívares que tiene */
  costRate: string | null;
  /** Última vez que comparaste con el saldo real */
  lastReconciliation: { date: string; realBalance: string; adjustment: string } | null;
  /** Apartado para pagos de varios meses: sigue en la cuenta, pero ya tiene destino */
  reserved: string;
  reservedFor: { recurringId: string; description: string; amount: string }[];
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
  /** Gasto o ingreso creado al abonar una deuda */
  debtPayment: { id: string; debtId: string; debt: { person: string; direction: DebtDirection } } | null;
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
  /** El WhatsApp viene de la cuenta del familiar (no se lo pusiste a mano) */
  phoneFromAccount?: boolean;
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
  /** Compra que pagó otra persona: cuenta de la que sale tu parte */
  myAccountId?: string | null;
  myAccount?: { id: string; name: string; currency: Currency } | null;
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
  totals: {
    incomeUsd: string; incomeVes: string; expenseUsd: string; expenseVes: string; netUsd: string; netVes: string;
    /** Ganancia por cambio del período (null si hay filtros de tipo, categoría o búsqueda) */
    fxGainUsd: string | null; fxGainVes: string | null;
  };
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

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';
export const RECURRING_FREQ: Record<Frequency, string> = {
  WEEKLY: 'Cada semana', MONTHLY: 'Cada mes', QUARTERLY: 'Cada 3 meses', SEMIANNUAL: 'Cada 6 meses', ANNUAL: 'Cada año',
};
/** Meses entre pagos; solo los de varios meses admiten apartado. */
export const FREQ_MONTHS: Record<Frequency, number> = { WEEKLY: 12 / 52, MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };
export const canReserve = (f: Frequency) => FREQ_MONTHS[f] > 1;
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
  reserve: boolean;
  reserveDay: number | null;
  reserveNextDate: string | null;
  /** Lo apartado hasta ahora, lo que conviene apartar esta vez y cuántos apartados quedan antes del pago */
  reserveStatus: { balance: string; suggested: string; left: number; nextDate: string } | null;
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
    transactionId: string | null;
    transaction: { id: string; type: TxType; category: { id: string; name: string } | null } | null;
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
  /** Deuda manual con un familiar: la ve en su cuenta y los cambios se reflejan */
  linkedManual?: boolean;
  /** Nombre del familiar que registró la compra, si es una copia */
  sharedBy: string | null;
}

/** Abono con cuenta que no es gasto ni ingreso: se muestra en Movimientos como las transferencias */
export interface DebtPaymentItem {
  id: string;
  date: string;
  amount: string;
  accountAmount: string | null;
  account: { id: string; name: string; currency: Currency };
  debt: { id: string; person: string; direction: DebtDirection; description: string | null; currency: Currency };
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

export type MoneyBoth = { usd: string; ves: string };
export interface ProjectedItem {
  key: string;
  date: string;
  kind: 'RECURRING' | 'INSTALLMENT' | 'RESERVE';
  type: 'INCOME' | 'EXPENSE' | 'RESERVE';
  description: string;
  detail: string | null;
  category: { id: string; name: string; color: string } | null;
  account: { id: string; name: string } | null;
  currency: Currency;
  amount: string;
  amountUsd: string;
  amountVes: string;
  overdue: boolean;
  fundedUsd: string;
  fundedVes: string;
  recurringId: string | null;
  planId: string | null;
}
export interface ProjectedMonth {
  month: string;
  partial: boolean;
  items: ProjectedItem[];
  totals: { income: MoneyBoth; expense: MoneyBoth; reserve: MoneyBoth; funded: MoneyBoth; installments: MoneyBoth; free: MoneyBoth; count: number };
}
export interface Projection { today: string; rates: Record<string, string>; months: ProjectedMonth[] }

export interface AccountSummary {
  accountId: string;
  currency: Currency;
  from: string;
  to: string;
  opening: string;
  income: string;
  expense: string;
  transfersIn: string;
  transfersOut: string;
  paymentsIn: string;
  paymentsOut: string;
  /** Ajustes de conciliación del período */
  adjustments: string;
  closing: string;
  current: string;
}

/** Compra compartida que pagó un familiar, esperando que la acepte o la rechace. */
export interface SharedRequest {
  id: string;
  kind: 'PURCHASE' | 'INSTALLMENTS';
  /** Es un cambio propuesto a una compra ya registrada */
  change: boolean;
  /** Si es un cambio: cómo está ahora */
  before: { description: string | null; date: string; currency: Currency; amount: string; totalUsd: string; parts: SharedRequest['parts']; installments?: SharedRequest['installments'] } | null;
  /** true: te la mandaron a ti (pagaste tú) */
  incoming: boolean;
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  createdAt: string;
  description: string | null;
  categoryName: string | null;
  date: string;
  currency: Currency;
  amount: string;
  totalUsd: string;
  installments: { provider: string; store: string | null; count: number; frequency: string; downPaymentUsd: string } | null;
  parts: { role: 'CREATOR' | 'PAYER' | 'OTHER'; name: string; amountUsd: string; pct: string; me: boolean }[];
}

export interface Reconciliation {
  id: string;
  accountId: string;
  date: string;
  realBalance: string;
  appBalance: string;
  adjustment: string;
  note: string | null;
  createdAt: string;
}
