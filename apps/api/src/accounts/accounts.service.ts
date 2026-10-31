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
    return accounts.map((acc) => {
      let balance = new Prisma.Decimal(acc.initialBalance);
      for (const s of sums.filter((x) => x.accountId === acc.id)) {
        const v = (acc.currency === 'USD' ? s._sum.amountUsd : s._sum.amountVes) ?? 0;
        balance = s.type === 'INCOME' ? balance.add(v) : balance.sub(v);
      }
      return { ...acc, balance: balance.toFixed(2) };
    });
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
      const used = await this.prisma.transaction.count({ where: { accountId: id } });
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
    const used = await this.prisma.transaction.count({ where: { accountId: id } });
    if (used) throw new ConflictException(`La cuenta tiene ${used} movimientos; archívala en lugar de borrarla`);
    await this.prisma.account.delete({ where: { id } });
  }
}
