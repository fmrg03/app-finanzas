import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export type Currency = 'USD' | 'VES';

/**
 * Calcula ambos montos a partir de lo que escribió el usuario.
 * rate = bolívares por 1 USD. Redondeo a 2 decimales, mitad hacia arriba.
 */
export function convertAmounts(currency: Currency, amount: Dec | string | number, rate: Dec | string | number) {
  const a = new D(amount);
  const r = new D(rate);
  if (r.lte(0)) throw new Error('La tasa debe ser mayor que cero');
  const amountUsd = currency === 'USD' ? a : a.div(r);
  const amountVes = currency === 'VES' ? a : a.mul(r);
  return {
    amountUsd: amountUsd.toDecimalPlaces(2, D.ROUND_HALF_UP),
    amountVes: amountVes.toDecimalPlaces(2, D.ROUND_HALF_UP),
  };
}
