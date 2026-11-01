import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsNumberString, IsOptional, IsString, Matches } from 'class-validator';
import { todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

export class UpsertBudgetDto {
  @ApiProperty({ description: 'Categoría principal de gastos' }) @IsString()
  categoryId: string;

  @ApiProperty({ example: '250.00', description: 'Tope mensual en USD' }) @IsNumberString()
  amountUsd: string;
}

export class BudgetStatusDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Mes a evaluar; por defecto el actual' })
  @IsOptional() @Matches(/^\d{4}-\d{2}$/, { message: 'month debe tener formato YYYY-MM' })
  month?: string;
}

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  /** Crea o cambia el tope de una categoría. */
  async upsert(userId: string, dto: UpsertBudgetDto) {
    const cat = await this.prisma.category.findFirst({ where: { id: dto.categoryId, userId } });
    if (!cat) throw new BadRequestException('La categoría no existe');
    if (cat.type !== 'EXPENSE') throw new BadRequestException('Los presupuestos son solo para categorías de gasto');
    if (cat.parentId) throw new BadRequestException('Usa la categoría principal; el presupuesto incluye sus subcategorías');
    const amountUsd = new Prisma.Decimal(dto.amountUsd);
    if (amountUsd.lte(0)) throw new BadRequestException('El tope debe ser mayor que cero');
    return this.prisma.budget.upsert({
      where: { categoryId: cat.id },
      create: { userId, categoryId: cat.id, amountUsd: amountUsd.toDecimalPlaces(2) },
      update: { amountUsd: amountUsd.toDecimalPlaces(2) },
    });
  }

  async remove(userId: string, id: string) {
    const b = await this.prisma.budget.findFirst({ where: { id, userId } });
    if (!b) throw new NotFoundException('Presupuesto no encontrado');
    await this.prisma.budget.delete({ where: { id } });
  }

  /** Avance de cada presupuesto en el mes: gastado, porcentaje y proyección a fin de mes. */
  async status(userId: string, month?: string) {
    const today = todayLocal();
    const ym = month ?? today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0));
    const days = to.getUTCDate();
    const isCurrent = ym === today.slice(0, 7);
    const elapsed = isCurrent ? Number(today.slice(8, 10)) : days;

    const budgets = await this.prisma.budget.findMany({
      where: { userId },
      include: { category: { select: { id: true, name: true, color: true, children: { select: { id: true } } } } },
    });
    if (!budgets.length) return { month: ym, daysInMonth: days, daysElapsed: elapsed, items: [], totals: { budgetUsd: '0.00', spentUsd: '0.00' } };

    const ids = budgets.flatMap((b) => [b.categoryId, ...b.category.children.map((c) => c.id)]);
    const sums = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', categoryId: { in: ids }, date: { gte: from, lte: to } },
      _sum: { myAmountUsd: true },
    });
    const spentOf = (id: string) => sums.find((s) => s.categoryId === id)?._sum.myAmountUsd ?? new Prisma.Decimal(0);

    let tb = new Prisma.Decimal(0);
    let ts = new Prisma.Decimal(0);
    const items = budgets
      .map((b) => {
        const spent = [b.categoryId, ...b.category.children.map((c) => c.id)].reduce((acc, id) => acc.add(spentOf(id)), new Prisma.Decimal(0));
        tb = tb.add(b.amountUsd);
        ts = ts.add(spent);
        const pct = spent.div(b.amountUsd).mul(100).toNumber();
        // Proyección lineal: si sigues gastando al mismo ritmo, cuánto llegarás a gastar
        const projected = isCurrent && elapsed > 0 ? spent.div(elapsed).mul(days) : spent;
        return {
          id: b.id,
          categoryId: b.categoryId,
          name: b.category.name,
          color: b.category.color,
          amountUsd: b.amountUsd.toFixed(2),
          spentUsd: spent.toFixed(2),
          remainingUsd: b.amountUsd.sub(spent).toFixed(2),
          pct: Math.round(pct),
          projectedUsd: projected.toFixed(2),
          status: pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok',
        };
      })
      .sort((a, b) => b.pct - a.pct);
    return { month: ym, daysInMonth: days, daysElapsed: elapsed, items, totals: { budgetUsd: tb.toFixed(2), spentUsd: ts.toFixed(2) } };
  }
}

