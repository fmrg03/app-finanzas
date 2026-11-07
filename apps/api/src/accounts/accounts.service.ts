import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  /** Lista las cuentas con su saldo actual, calculado en la moneda de cada cuenta. */
  async findAll(userId: string, includeArchived = false) {
    const accounts = await this.prisma.account.findMany({
      where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const sums = await this.prisma.transaction.groupBy({
      by: ['accountId', 'type'],
      where: { userId },
      _sum: { amountUsd: true, amountVes: true },
    });
    // Las transferencias y los abonos de deudas mueven saldo sin ser ingreso ni gasto
    const [outs, ins, debtPays] = await Promise.all([
      this.prisma.transfer.groupBy({ by: ['fromAccountId'], where: { userId }, _sum: { fromAmount: true } }),
      this.prisma.transfer.groupBy({ by: ['toAccountId'], where: { userId }, _sum: { toAmount: true } }),
      this.prisma.debtPayment.findMany({
        // Si el abono generó un gasto o ingreso, ese movimiento ya mueve el saldo
        where: { accountId: { not: null }, transactionId: null, debt: { userId } },
        select: { accountId: true, amount: true, accountAmount: true, debt: { select: { direction: true } } },
      }),
    ]);
    const reserved = await this.reservedByAccount(userId);
    return accounts.map((acc) => {
      let balance = new Prisma.Decimal(acc.initialBalance);
      for (const s of sums.filter((x) => x.accountId === acc.id)) {
        const v = (acc.currency === 'USD' ? s._sum.amountUsd : s._sum.amountVes) ?? 0;
        balance = s.type === 'INCOME' ? balance.add(v) : balance.sub(v);
      }
      balance = balance.sub(outs.find((o) => o.fromAccountId === acc.id)?._sum.fromAmount ?? 0);
      balance = balance.add(ins.find((i) => i.toAccountId === acc.id)?._sum.toAmount ?? 0);
      for (const p of debtPays.filter((x) => x.accountId === acc.id)) {
        const v = p.accountAmount ?? p.amount;
        balance = p.debt.direction === 'OWED_TO_ME' ? balance.add(v) : balance.sub(v);
      }
      const res = reserved.filter((x) => x.accountId === acc.id).map((x) => ({ ...x, amount: x.inCurrency(acc.currency) }));
      return {
        ...acc,
        balance: balance.toFixed(2),
        // Apartado para pagos de varios meses: sigue en la cuenta, pero ya tiene destino
        reserved: res.reduce((a, x) => a.add(x.amount), new Prisma.Decimal(0)).toFixed(2),
        reservedFor: res.map((x) => ({ recurringId: x.recurringId, description: x.description, amount: x.amount.toFixed(2) })),
      };
    });
  }

  /** Lo apartado en cada recurrente activo con saldo, convertible a la moneda de su cuenta con la última tasa. */
  private async reservedByAccount(userId: string) {
    const recs = await this.prisma.recurring.findMany({
      where: { userId, active: true, reserve: true },
      select: { id: true, accountId: true, description: true, currency: true, rateSource: true, reserves: { select: { amount: true } } },
    });
    const withBalance = recs
      .map((r) => ({ ...r, balance: r.reserves.reduce((a, x) => a.add(x.amount), new Prisma.Decimal(0)) }))
      .filter((r) => r.balance.gt(0));
    if (!withBalance.length) return [];
    const rates = new Map<string, Prisma.Decimal>();
    for (const src of new Set(withBalance.map((r) => r.rateSource ?? 'BCV'))) {
      const row = await this.prisma.exchangeRate.findFirst({ where: { source: src }, orderBy: { date: 'desc' } });
      if (row) rates.set(src, row.rate);
    }
    return withBalance.map((r) => ({
      recurringId: r.id,
      accountId: r.accountId,
      description: r.description,
      inCurrency: (cur: string) => {
        if (cur === r.currency) return r.balance;
        const rate = rates.get(r.rateSource ?? 'BCV');
        if (!rate) return new Prisma.Decimal(0);
        return (cur === 'VES' ? r.balance.mul(rate) : r.balance.div(rate)).toDecimalPlaces(2);
      },
    }));
  }

  async findOne(userId: string, id: string) {
    const acc = await this.prisma.account.findFirst({ where: { id, userId } });
    if (!acc) throw new NotFoundException('Cuenta no encontrada');
    return acc;
  }

  create(userId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: { userId, name: dto.name.trim(), type: dto.type, currency: dto.currency, initialBalance: dto.initialBalance ?? '0' },
    });
  }

  async update(userId: string, id: string, dto: UpdateAccountDto) {
    const acc = await this.findOne(userId, id);
    if (dto.currency && dto.currency !== acc.currency) {
      const used =
        (await this.prisma.transaction.count({ where: { accountId: id } })) +
        (await this.prisma.transfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } })) +
        (await this.prisma.debtPayment.count({ where: { accountId: id } }));
      if (used) throw new BadRequestException('No puedes cambiar la moneda de una cuenta con movimientos');
    }
    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        type: dto.type,
        currency: dto.currency,
        initialBalance: dto.initialBalance,
        ...(dto.archived === undefined ? {} : { archivedAt: dto.archived ? new Date() : null }),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    const used =
      (await this.prisma.transaction.count({ where: { accountId: id } })) +
      (await this.prisma.transfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } })) +
      (await this.prisma.debtPayment.count({ where: { accountId: id } })) +
      (await this.prisma.installmentPlan.count({ where: { accountId: id } }));
    if (used) throw new ConflictException(`La cuenta tiene ${used} movimientos, transferencias o abonos; archívala en lugar de borrarla`);
    await this.prisma.account.delete({ where: { id } });
  }
}
