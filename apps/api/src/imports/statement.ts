/** Lectura de un estado de cuenta bancario (PDF o capturas). */
export interface StatementRow {
  date: string;
  description: string;
  /** Con signo: negativo = salió de la cuenta */
  amount: number;
  /** Saldo después del movimiento, si el banco lo muestra */
  balance: number | null;
  suggestedCategoryId: string | null;
}
export interface StatementExtraction {
  isStatement: boolean;
  bank: string | null;
  accountLast4: string | null;
  currency: 'USD' | 'VES' | null;
  availableBalance: number | null;
  rows: StatementRow[];
}

const num = { type: ['number', 'null'] };
const str = { type: ['string', 'null'] };

export const STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isStatement', 'bank', 'accountLast4', 'currency', 'availableBalance', 'rows'],
  properties: {
    isStatement: { type: 'boolean', description: 'false si no es un estado de cuenta o lista de movimientos bancarios' },
    bank: { ...str, description: 'Nombre del banco, ej. "BBVA Provincial"' },
    accountLast4: { ...str, description: 'Últimos 4 dígitos visibles del número de cuenta' },
    currency: { type: ['string', 'null'], enum: ['USD', 'VES', null], description: 'Moneda de la cuenta. Bs = VES' },
    availableBalance: { ...num, description: 'Saldo disponible o saldo actual que muestra el encabezado' },
    rows: {
      type: 'array',
      description: 'Cada movimiento de la tabla, en el mismo orden en que aparece (todas las páginas)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'description', 'amount', 'balance', 'suggestedCategoryId'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          description: { type: 'string', description: 'Descripción tal como aparece' },
          amount: { type: 'number', description: 'Monto con signo: negativo si es un cargo o débito, positivo si es un abono o crédito' },
          balance: { ...num, description: 'Saldo de esa línea, o null si no hay columna de saldo' },
          suggestedCategoryId: { ...str, description: 'id de la categoría de la lista que mejor encaja (gasto si el monto es negativo, ingreso si es positivo), o null' },
        },
      },
    },
  },
} as const;

export function buildStatementPrompt(categories: { id: string; name: string; type: string; parent?: string | null }[], today: string) {
  const list = categories.map((c) => `- ${c.id}: ${c.parent ? `${c.parent} > ` : ''}${c.name} (${c.type === 'INCOME' ? 'ingreso' : 'gasto'})`).join('\n');
  return `Este es un estado de cuenta o lista de "últimos movimientos" de un banco venezolano (puede tener varias páginas o capturas).
Extrae cada movimiento de la tabla para importarlo en una app de finanzas personales.

Reglas:
- Los números venezolanos usan punto para miles y coma para decimales ("-90.444,86" = -90444.86). Devuelve números normales.
- El monto lleva signo: los débitos/cargos son negativos y los créditos/abonos positivos, como los muestra el banco.
- Las fechas vienen como día/mes/año; devuélvelas en YYYY-MM-DD. Hoy es ${today}.
- Copia la descripción tal cual (ej. "DR OB J00029490 114BANCA", "TPBW V0020188136 01080", "COM. PAGO MOVIL").
- Si el encabezado se repite en cada página, ignóralo; incluye todas las filas de todas las páginas, una sola vez cada una.
- Pistas de categoría: "COM." o "COMISION" son comisiones bancarias; nombres de comercios (supermercados, farmacias, tiendas) son gastos de ese tipo; "TPBW", "PAGO MOVIL", "DR OB", "CR.I/OB" son transferencias o pagos móviles: deja la categoría en null si no es obvia.
- Para suggestedCategoryId usa solo un id de esta lista, o null:
${list || '(sin categorías)'}
- No inventes filas ni montos.`;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
/** Acepta números o textos en formato venezolano ("1.234,56") o normal. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Valida lo que devolvió el modelo; descarta filas inválidas o repetidas (páginas que se solapan). */
export function sanitizeStatement(raw: unknown, catIds: Set<string>, today: string): StatementExtraction {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rows: StatementRow[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(o.rows) ? (o.rows as Record<string, unknown>[]) : []) {
    const amount = toNum(r.amount);
    if (!isDate(r.date) || r.date > today || amount === null || amount === 0) continue;
    const balance = toNum(r.balance);
    const description = String(r.description ?? '').trim().slice(0, 200) || 'Movimiento';
    const key = `${r.date}|${description}|${r2(amount)}|${balance === null ? '' : r2(balance)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = typeof r.suggestedCategoryId === 'string' && catIds.has(r.suggestedCategoryId) ? r.suggestedCategoryId : null;
    rows.push({ date: r.date, description, amount: r2(amount), balance: balance === null ? null : r2(balance), suggestedCategoryId: cat });
  }
  const bal = toNum(o.availableBalance);
  return {
    isStatement: o.isStatement !== false && rows.length > 0,
    bank: typeof o.bank === 'string' ? o.bank.slice(0, 60) : null,
    accountLast4: typeof o.accountLast4 === 'string' ? o.accountLast4.replace(/\D/g, '').slice(-4) || null : null,
    currency: o.currency === 'USD' || o.currency === 'VES' ? o.currency : null,
    availableBalance: bal === null ? null : r2(bal),
    rows,
  };
}

/** Clave para recordar la categoría de una descripción: mayúsculas y espacios simples. */
export const descKey = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();
/** Clave más suelta: solo las palabras (sin números de referencia). */
export const looseKey = (s: string) => descKey(s).replace(/[^A-ZÁÉÍÓÚÑ ]+/g, ' ').replace(/\b[A-Z]\b/g, ' ').replace(/\s+/g, ' ').trim();
