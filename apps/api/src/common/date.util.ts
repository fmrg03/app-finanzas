import { BadRequestException } from '@nestjs/common';

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'America/Caracas';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' -> Date a medianoche UTC (lo que espera una columna @db.Date). */
export function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) throw new BadRequestException(`Fecha inválida: ${value} (usa YYYY-MM-DD)`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || toDateOnly(d) !== value) {
    throw new BadRequestException(`Fecha inválida: ${value}`);
  }
  return d;
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fecha de "hoy" en la zona horaria de la app (Caracas por defecto), como 'YYYY-MM-DD'. */
export function todayLocal(now = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(now);
}
