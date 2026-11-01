import { money } from './format';
import { FREQUENCY_LABEL, type Debt, type InstallmentPlan, type Person, type SharedInfo, type Transaction } from './types';

const dmy = (d: string) => d.split('-').reverse().join('/');
const pctFmt = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 });
const pct = (v: string | number) => `${pctFmt.format(Number(v))} %`;
const bs = (usd: string | number, rate?: string | number | null) => (rate && Number(rate) > 0 ? ` (${money(Number(usd) * Number(rate), 'VES')})` : '');

const who = (p: { personId: string | null; person: { name: string } | null }) => (p.personId ? (p.person?.name ?? 'Alguien') : 'Yo');

/** Lo que cada persona debe y a quién, según quién pagó. */
export function balances(shared: SharedInfo) {
  if (!shared.paidBy) {
    return shared.participants
      .filter((p) => p.personId && Number(p.amountUsd) > 0)
      .map((p) => ({ personId: p.personId!, name: p.person!.name, phone: p.person!.phone, amountUsd: p.amountUsd, owesMe: true }));
  }
  const me = shared.participants.find((p) => !p.personId);
  return me ? [{ personId: shared.paidBy.id, name: shared.paidBy.name, phone: shared.paidBy.phone, amountUsd: me.amountUsd, owesMe: false }] : [];
}

function splitLines(shared: SharedInfo) {
  return shared.participants.map((p) => `• ${who(p)}: ${pct(p.pct)} → ${money(p.amountUsd, 'USD')}`);
}

/**
 * Detalle de un movimiento compartido. Con `to` agrega una línea dirigida a esa persona.
 * `rate` es la tasa de hoy, para mostrar el equivalente en Bs de lo que se debe.
 */
export function sharedTxText(tx: Transaction, to?: { personId: string; name: string } | null, rate?: string | null) {
  const s = tx.shared!;
  const title = tx.description || tx.category?.name || 'Compra';
  const total = tx.originalCurrency === 'USD'
    ? money(tx.amountUsd, 'USD')
    : `${money(tx.amountVes, 'VES')} (${money(tx.amountUsd, 'USD')})`;
  const lines = [
    `🧾 *${title}*, ${dmy(tx.date)}`,
    `Total: ${total}`,
    s.paidBy ? `Pagó: ${s.paidBy.name}` : 'Pagué yo',
    '',
    ...splitLines(s),
  ];
  const b = to ? balances(s).find((x) => x.personId === to.personId) : null;
  if (b) {
    lines.push('', b.owesMe ? `${b.name}, tu parte es ${money(b.amountUsd, 'USD')}${bs(b.amountUsd, rate)}.` : `${b.name}, te debo ${money(b.amountUsd, 'USD')}${bs(b.amountUsd, rate)}.`);
  }
  if (rate) lines.push(`_Montos en USD fijados con la tasa del día de la compra${b ? '; Bs a la tasa BCV de hoy' : ''}._`);
  return lines.join('\n');
}

/** Detalle de una compra en cuotas, con lo que le toca a cada uno por cuota si es compartida. */
export function planText(p: InstallmentPlan, to?: { personId: string; name: string } | null, rate?: string | null) {
  const cuotas = p.installments.map((i) => `${i.n}) ${dmy(i.dueDate)}: ${money(i.amountUsd, 'USD')}${i.transactionId ? ' ✓' : ''}`);
  const lines = [
    `🛒 *${p.description}* (${p.provider}${p.store ? `, ${p.store}` : ''}), ${dmy(p.purchaseDate)}`,
    `Total: ${money(p.totalUsd, 'USD')}. Inicial ${money(p.downPaymentUsd, 'USD')} + ${p.count} ${p.count === 1 ? 'cuota' : 'cuotas'} (${FREQUENCY_LABEL[p.frequency].toLowerCase()})`,
    ...(p.shared ? [p.shared.paidBy ? `Compró: ${p.shared.paidBy.name}` : 'Compré yo'] : []),
    '',
    'Cuotas:',
    ...cuotas,
  ];
  if (p.shared) {
    lines.push('', 'Reparto:', ...splitLines(p.shared));
    const b = to ? balances(p.shared).find((x) => x.personId === to.personId) : null;
    if (b) {
      const part = p.shared.participants.find((x) => (b.owesMe ? x.personId === b.personId : !x.personId))!;
      const f = Number(part.pct) / 100;
      const perCuota = p.installments.map((i) => money(Number(i.amountUsd) * f, 'USD'));
      const same = new Set(perCuota).size === 1;
      lines.push(
        '',
        `${b.name}, ${b.owesMe ? 'tu parte' : 'mi parte'} es ${money(b.amountUsd, 'USD')}${bs(b.amountUsd, rate)}: ` +
          `${money(Number(p.downPaymentUsd) * f, 'USD')} de inicial y ${same ? `${perCuota[0]} por cuota` : `por cuota ${perCuota.join(', ')}`}.`,
      );
    }
  }
  return lines.join('\n');
}

/** Recordatorio amable de una deuda pendiente que te deben. */
export function debtReminderText(d: Debt, rate?: string | null) {
  const amount = money(d.remaining, d.currency);
  const ves = d.currency === 'USD' ? bs(d.remaining, rate) : '';
  const what = d.description ? ` de ${d.description.replace(/ \(compartido\)$/, '')}` : '';
  return `Hola ${d.person.split(' ')[0]} 👋 Te escribo por lo pendiente${what}: ${amount}${ves}${d.dueDate ? `, que vencía el ${dmy(d.dueDate)}` : ''}. ¡Gracias!`;
}

/** Resumen de todo lo pendiente con una persona. */
export function personReminderText(p: Person, debts: Debt[], rate?: string | null) {
  const mine = debts.filter((d) => d.personId === p.id && !d.settledAt && d.direction === 'OWED_TO_ME');
  const lines = [`Hola ${p.name.split(' ')[0]} 👋 Te paso lo pendiente:`, '', ...mine.map((d) => `• ${(d.description ?? 'Préstamo').replace(/ \(compartido\)$/, '')}: ${money(d.remaining, d.currency)}`)];
  const usd = Number(p.owedToMeUsd);
  const ves = Number(p.owedToMeVes);
  lines.push('', `Total: ${[usd > 0 && `${money(usd, 'USD')}${bs(usd, rate)}`, ves > 0 && money(ves, 'VES')].filter(Boolean).join(' + ')}`, '¡Gracias!');
  return lines.join('\n');
}

/**
 * Abre WhatsApp con el texto. Con número va directo al chat de esa persona;
 * sin número usa el menú de compartir del teléfono o WhatsApp Web para elegir el contacto.
 */
export async function shareWhatsApp(text: string, phone?: string | null) {
  if (!phone && typeof navigator !== 'undefined' && navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}
