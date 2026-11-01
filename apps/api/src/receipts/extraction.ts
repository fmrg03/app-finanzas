/** Lo que el modelo devuelve al leer una factura. Todo campo puede ser null si no se ve en la imagen. */
export interface ReceiptExtraction {
  isReceipt: boolean;
  merchant: string | null;
  taxId: string | null;
  date: string | null;
  currency: 'USD' | 'VES' | null;
  total: number | null;
  subtotal: number | null;
  tax: number | null;
  exchangeRate: number | null;
  totalUsdReference: number | null;
  items: { description: string; quantity: number | null; amount: number | null }[];
  suggestedCategoryId: string | null;
  type: 'EXPENSE' | 'INCOME';
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

const num = { type: ['number', 'null'] };
const str = { type: ['string', 'null'] };

// JSON Schema para salidas estructuradas: todos los campos requeridos (con null permitido) y sin propiedades extra
export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReceipt', 'merchant', 'taxId', 'date', 'currency', 'total', 'subtotal', 'tax', 'exchangeRate', 'totalUsdReference', 'items', 'suggestedCategoryId', 'type', 'confidence', 'notes'],
  properties: {
    isReceipt: { type: 'boolean', description: 'false si la imagen no es una factura, recibo, ticket o comprobante de pago' },
    merchant: { ...str, description: 'Nombre comercial o razón social del emisor' },
    taxId: { ...str, description: 'RIF u otro identificador fiscal del emisor, tal como aparece' },
    date: { ...str, description: 'Fecha de emisión en formato YYYY-MM-DD' },
    currency: { type: ['string', 'null'], enum: ['USD', 'VES', null], description: 'Moneda del total a pagar. Bs, Bs.S, Bs.D y VES son VES; $, USD y "ref" en dólares son USD' },
    total: { ...num, description: 'Total pagado en la moneda indicada en currency, como número sin separadores de miles' },
    subtotal: num,
    tax: { ...num, description: 'IVA u otros impuestos, en la misma moneda que total' },
    exchangeRate: { ...num, description: 'Tasa Bs por USD si la factura la imprime (ej. "Tasa BCV 215,45"); si no, null' },
    totalUsdReference: { ...num, description: 'Total de referencia en USD si la factura en Bs lo imprime; si no, null' },
    items: {
      type: 'array',
      description: 'Líneas de la factura (máximo 30)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'amount'],
        properties: { description: { type: 'string' }, quantity: num, amount: num },
      },
    },
    suggestedCategoryId: { ...str, description: 'id de la categoría de la lista que mejor encaja, o null' },
    type: { type: 'string', enum: ['EXPENSE', 'INCOME'], description: 'EXPENSE salvo que sea claramente un pago recibido por el usuario' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Qué tan legible y segura es la lectura del total y la fecha' },
    notes: { ...str, description: 'Advertencias breves en español (ilegible, recortada, total dudoso), o null' },
  },
} as const;

export function buildPrompt(categories: { id: string; name: string; type: string; parent?: string | null }[], today: string) {
  const list = categories.map((c) => `- ${c.id}: ${c.parent ? `${c.parent} > ` : ''}${c.name} (${c.type === 'INCOME' ? 'ingreso' : 'gasto'})`).join('\n');
  return `Lee esta factura o comprobante venezolano y extrae los datos para registrar el movimiento en una app de finanzas personales.

Reglas:
- Los números venezolanos usan punto para miles y coma para decimales ("1.234,56" = 1234.56). Devuelve números normales.
- El total es lo que se pagó al final (con IVA e IGTF si aplica), no el subtotal.
- Si la factura muestra montos en Bs y también un equivalente en USD, currency = VES, total = monto en Bs, y totalUsdReference = el monto en USD.
- Si ves la tasa de cambio impresa, ponla en exchangeRate (Bs por 1 USD).
- La fecha va en YYYY-MM-DD. Las facturas venezolanas usan día/mes/año. Hoy es ${today}; una fecha futura es casi seguro un error de lectura.
- Para suggestedCategoryId usa solo un id de esta lista, o null si ninguna encaja:
${list || '(sin categorías)'}
- No inventes datos: si algo no se ve, usa null y explícalo en notes.`;
}

/** Normaliza y valida lo que devolvió el modelo; nunca confiar ciegamente en él. */
export function sanitize(raw: unknown, validCategoryIds: Set<string>, today: string): ReceiptExtraction {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    // Un string con coma se interpreta en formato venezolano ("1.234,56"); si no, como número normal
    const x = typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : Number(v);
    return v === null || v === undefined || !Number.isFinite(x) || x < 0 ? null : Math.round(x * 100) / 100;
  };
  const s = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  let date = s(o.date, 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > today)) date = null;
  const cat = s(o.suggestedCategoryId, 40);
  const items = Array.isArray(o.items) ? o.items.slice(0, 30) : [];
  return {
    isReceipt: o.isReceipt !== false,
    merchant: s(o.merchant, 120),
    taxId: s(o.taxId, 30),
    date,
    currency: o.currency === 'USD' || o.currency === 'VES' ? o.currency : null,
    total: n(o.total),
    subtotal: n(o.subtotal),
    tax: n(o.tax),
    exchangeRate: n(o.exchangeRate) || null,
    totalUsdReference: n(o.totalUsdReference),
    items: items.map((i) => {
      const it = (i ?? {}) as Record<string, unknown>;
      return { description: s(it.description, 120) ?? '', quantity: n(it.quantity), amount: n(it.amount) };
    }).filter((i) => i.description),
    suggestedCategoryId: cat && validCategoryIds.has(cat) ? cat : null,
    type: o.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
    confidence: o.confidence === 'high' || o.confidence === 'low' ? o.confidence : 'medium',
    notes: s(o.notes, 300),
  };
}
