import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseDateOnly, toDateOnly } from '../common/date.util';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransferDto, ListTransfersDto, UpdateTransferDto } from './dto/transfer.dto';

const D = Prisma.Decimal;
const INCLUDE = {
  fromAccount: { select: { id: true, name: true, currency: true } },
  toAccount: { select: { id: true, name: true, currency: true } },
} satisfies Prisma.TransferInclude;

@Injectable()
export class TransfersService {
  constructor(
    private prisma: PrismaService,
    private rates: ExchangeRatesService,
  ) {}

  async list(userId: string, q: ListTransfersDto) {
    const where: Prisma.TransferWhereInput = { userId };
    if (q.from || q.to) where.date = { ...(q.from ? { gte: parseDateOnly(q.from) } : {}), ...(q.to ? { lte: parseDateOnly(q.to) } : {}) };
    if (q.accountId) where.OR = [{ fromAccountId: q.accountId }, { toAccountId: q.accountId }];
    const items = await this.prisma.transfer.findMany({ where, include: INCLUDE, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
    return items.map(present);
  }

  async findOne(userId: string, id: string) {
    const t = await this.prisma.transfer.findFirst({ where: { id, userId }, include: INCLUDE });
    if (!t) throw new NotFoundException('Transferencia no encontrada');
    return present(t);
  }

  async create(userId: string, dto: CreateTransferDto) {
    const data = await this.compute(userId, dto);
    const t = await this.prisma.transfer.create({ data: { userId, ...data }, include: INCLUDE });
    return present(t);
  }

  async update(userId: string, id: string, dto: UpdateTransferDto) {
    const cur = await this.prisma.transfer.findFirst({ where: { id, userId } });
    if (!cur) throw new NotFoundException('Transferencia no encontrada');
    // Si cambia lo que sale o la tasa y no se indica lo que entra, se recalcula
    const recompute = dto.fromAmount !== undefined || dto.rate !== undefined || dto.fromAccountId !== undefined || dto.toAccountId !== undefined;
    const merged: CreateTransferDto = {
      fromAccountId: dto.fromAccountId ?? cur.fromAccountId,
      toAccountId: dto.toAccountId ?? cur.toAccountId,
      date: dto.date ?? toDateOnly(cur.date),
      fromAmount: dto.fromAmount ?? cur.fromAmount.toString(),
      toAmount: dto.toAmount ?? (recompute ? undefined : cur.toAmount.toString()),
      rate: dto.rate ?? (recompute && !dto.toAmount && cur.rate ? cur.rate.toString() : undefined),
      description: dto.description ?? cur.description ?? undefined,
    };
    const data = await this.compute(userId, merged);
    const t = await this.prisma.transfer.update({ where: { id }, data, include: INCLUDE });
    return present(t);
  }

  async remove(userId: string, id: string) {
    const t = await this.prisma.transfer.findFirst({ where: { id, userId }, select: { id: true } });
    if (!t) throw new NotFoundException('Transferencia no encontrada');
    await this.prisma.transfer.delete({ where: { id } });
  }

  private async compute(userId: string, dto: CreateTransferDto) {
    if (dto.fromAccountId === dto.toAccountId) throw new BadRequestException('Elige dos cuentas distintas');
    const [from, to] = await Promise.all([
      this.prisma.account.findFirst({ where: { id: dto.fromAccountId, userId } }),
      this.prisma.account.findFirst({ where: { id: dto.toAccountId, userId } }),
    ]);
    if (!from || !to) throw new BadRequestException('Alguna de las cuentas no existe');
    if (from.archivedAt || to.archivedAt) throw new BadRequestException('Alguna de las cuentas está archivada');

    const fromAmount = money(dto.fromAmount, 'El monto que sale');
    let toAmount: Prisma.Decimal;
    let rate: Prisma.Decimal | null = null;

    if (from.currency === to.currency) {
      // Misma moneda: puede haber comisión, por eso lo que entra puede ser menor
      toAmount = dto.toAmount !== undefined ? money(dto.toAmount, 'El monto que entra') : fromAmount;
      if (toAmount.gt(fromAmount)) throw new BadRequestException('En una transferencia de la misma moneda no puede entrar más de lo que sale');
    } else {
      const usd = from.currency === 'USD' ? fromAmount : null;
      if (dto.toAmount !== undefined) {
        toAmount = money(dto.toAmount, 'El monto que entra');
      } else if (dto.rate !== undefined) {
        const r = money(dto.rate, 'La tasa');
        toAmount = (usd ? fromAmount.mul(r) : fromAmount.div(r)).toDecimalPlaces(2, D.ROUND_HALF_UP);
      } else {
        throw new BadRequestException('Es un cambio de moneda: indica cuánto recibiste (toAmount) o la tasa (rate)');
      }
      const ves = usd ? toAmount : fromAmount;
      const usdAmount = usd ?? toAmount;
      rate = ves.div(usdAmount).toDecimalPlaces(6, D.ROUND_HALF_UP);
    }

    let referenceRate: Prisma.Decimal | null = null;
    try {
      referenceRate = (await this.rates.resolve(dto.date, 'BCV')).rate.rate;
    } catch {
      // Sin tasa BCV de referencia no se puede comparar, pero la transferencia es válida igual
    }

    return {
      date: parseDateOnly(dto.date),
      fromAccountId: from.id,
      toAccountId: to.id,
      fromAmount,
      toAmount,
      rate,
      referenceRate: rate ? referenceRate : null,
      description: dto.description?.trim() || null,
    };
  }
}

function money(v: string, label: string) {
  const d = new D(v);
  if (d.lte(0)) throw new BadRequestException(`${label} debe ser mayor que cero`);
  if (d.decimalPlaces() > 2 && label !== 'La tasa') throw new BadRequestException(`${label} admite máximo 2 decimales`);
  return label === 'La tasa' ? d : d.toDecimalPlaces(2);
}

function present<T extends { date: Date; rate: Prisma.Decimal | null; referenceRate: Prisma.Decimal | null }>(t: T) {
  // Diferencia porcentual de la tasa obtenida contra la BCV del día (positivo = mejor que BCV al vender dólares)
  const vsReference = t.rate && t.referenceRate ? t.rate.div(t.referenceRate).sub(1).mul(100).toDecimalPlaces(2).toString() : null;
  return { ...t, date: toDateOnly(t.date), vsReference };
}
