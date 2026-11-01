import { BadRequestException } from '@nestjs/common';
import { Prisma, SplitMode } from '@prisma/client';

type Dec = Prisma.Decimal;
const D = Prisma.Decimal;

export interface SplitParticipantInput {
  /** null: tú */
  personId: string | null;
  /** % en PERCENT; monto en la moneda de la compra en AMOUNT; se ignora en EQUAL */
  value?: string;
}

export interface SplitRow {
  personId: string | null;
  pct: Dec;
  amountUsd: Dec;
}

/**
 * Reparte el total (en USD, ya fijado con la tasa del día) entre los participantes.
 * Cada parte se redondea a centavos y la diferencia la absorbe quien pagó (o el primero si no participa).
 */
export function computeSplit(p: {
  totalUsd: Dec;
  totalOriginal: Dec;
  mode: SplitMode;
  paidByPersonId: string | null;
  participants: SplitParticipantInput[];
}): { rows: SplitRow[]; myAmountUsd: Dec; myPct: Dec } {
  const list = p.participants;
  if (!list.length) throw new BadRequestException('Agrega al menos una persona al reparto');
  const keys = list.map((x) => x.personId ?? 'me');
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Hay una persona repetida en el reparto');

  let pcts: Dec[];
  if (p.mode === 'EQUAL') {
    pcts = list.map(() => new D(100).div(list.length));
  } else {
    const values = list.map((x) => {
      if (x.value === undefined || x.value === '') throw new BadRequestException('Indica cuánto le toca a cada persona');
      const v = new D(x.value);
      if (v.isNaN() || v.lt(0)) throw new BadRequestException('Las partes no pueden ser negativas');
      return v;
    });
    const sum = values.reduce((a, v) => a.add(v), new D(0));
    if (p.mode === 'PERCENT') {
      if (sum.sub(100).abs().gt(0.01)) throw new BadRequestException(`Los porcentajes suman ${sum.toFixed(2)} %; deben sumar 100 %`);
      pcts = values;
    } else {
      if (sum.sub(p.totalOriginal).abs().gt(0.01)) {
        throw new BadRequestException(`Las partes suman ${sum.toFixed(2)} y la compra es de ${p.totalOriginal.toFixed(2)}`);
      }
      pcts = values.map((v) => v.div(p.totalOriginal).mul(100));
    }
  }

  const rows: SplitRow[] = list.map((x, i) => ({
    personId: x.personId,
    pct: pcts[i].toDecimalPlaces(6, D.ROUND_HALF_UP),
    amountUsd: p.totalUsd.mul(pcts[i]).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP),
  }));
  const diff = p.totalUsd.sub(rows.reduce((a, r) => a.add(r.amountUsd), new D(0)));
  if (!diff.isZero()) {
    const absorber = rows.find((r) => r.personId === p.paidByPersonId && r.amountUsd.gt(0)) ?? rows.find((r) => r.amountUsd.gt(0)) ?? rows[0];
    absorber.amountUsd = absorber.amountUsd.add(diff);
  }

  const me = rows.find((r) => r.personId === null);
  const others = rows.filter((r) => r.personId !== null && r.personId !== p.paidByPersonId && r.amountUsd.gt(0));
  if (p.paidByPersonId === null && !others.length) {
    throw new BadRequestException('Si pagaste tú, al menos otra persona tiene que tener una parte');
  }
  if (p.paidByPersonId !== null && (!me || me.amountUsd.lte(0))) {
    throw new BadRequestException('Si pagó otra persona, tienes que tener una parte en el reparto');
  }
  const myAmountUsd = me?.amountUsd ?? new D(0);
  const myPct = p.totalUsd.isZero() ? new D(0) : myAmountUsd.div(p.totalUsd).mul(100).toDecimalPlaces(6, D.ROUND_HALF_UP);
  return { rows, myAmountUsd, myPct };
}
