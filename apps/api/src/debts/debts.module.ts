import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Currency, DebtDirection, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

class CreateDebtDto {
  @ApiProperty({ enum: DebtDirection, description: 'I_OWE: yo debo; OWED_TO_ME: me deben' }) @IsEnum(DebtDirection)
  direction: DebtDirection;

  @ApiProperty({ example: 'Carlos' }) @IsString() @MinLength(1) @MaxLength(80)
  person: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @ApiProperty({ enum: Currency }) @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ example: '120.00' }) @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  dueDate?: string | null;
}
class UpdateDebtDto extends PartialType(CreateDebtDto) {}
class PaymentDto {
  @ApiProperty({ example: '40.00' }) @IsNumberString()
  amount: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

const D = Prisma.Decimal;

@Injectable()
class DebtsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const debts = await this.prisma.debt.findMany({
      where: { userId },
      include: { payments: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] } },
      orderBy: [{ settledAt: { sort: 'asc', nulls: 'first' } }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const today = parseDateOnly(todayLocal());
    return debts.map((d) => {
      const paid = d.payments.reduce((a, p) => a.add(p.amount), new D(0));
      const remaining = D.max(d.amount.sub(paid), 0);
      return {
        ...d,
        dueDate: d.dueDate ? toDateOnly(d.dueDate) : null,
        payments: d.payments.map((p) => ({ ...p, date: toDateOnly(p.date) })),
        paid: paid.toFixed(2),
        remaining: remaining.toFixed(2),
        overdue: !d.settledAt && !!d.dueDate && d.dueDate < today,
      };
    });
  }

  async create(userId: string, dto: CreateDebtDto) {
    return this.prisma.debt.create({
      data: {
        userId, direction: dto.direction, person: dto.person.trim(), description: dto.description?.trim() || null,
        currency: dto.currency, amount: positive(dto.amount), dueDate: dto.dueDate ? parseDateOnly(dto.dueDate) : null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateDebtDto) {
    await this.own(userId, id);
    await this.prisma.debt.update({
      where: { id },
      data: {
        direction: dto.direction, person: dto.person?.trim(), description: dto.description?.trim(), currency: dto.currency,
        amount: dto.amount ? positive(dto.amount) : undefined,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? parseDateOnly(dto.dueDate) : null,
      },
    });
    return this.syncSettled(id);
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.debt.delete({ where: { id } });
  }

  async pay(userId: string, id: string, dto: PaymentDto) {
    const debt = await this.own(userId, id);
    const paid = (await this.prisma.debtPayment.aggregate({ where: { debtId: id }, _sum: { amount: true } }))._sum.amount ?? new D(0);
    const amount = positive(dto.amount);
    if (amount.gt(debt.amount.sub(paid))) throw new BadRequestException(`El abono supera lo pendiente (${debt.amount.sub(paid).toFixed(2)})`);
    await this.prisma.debtPayment.create({ data: { debtId: id, amount, date: parseDateOnly(dto.date ?? todayLocal()), note: dto.note?.trim() || null } });
    return this.syncSettled(id);
  }

  async removePayment(userId: string, id: string, paymentId: string) {
    await this.own(userId, id);
    const { count } = await this.prisma.debtPayment.deleteMany({ where: { id: paymentId, debtId: id } });
    if (!count) throw new NotFoundException('Abono no encontrado');
    return this.syncSettled(id);
  }

  /** Marca como saldada cuando lo abonado cubre el total, y la reabre si deja de cubrirlo. */
  private async syncSettled(id: string) {
    const debt = await this.prisma.debt.findUniqueOrThrow({ where: { id } });
    const paid = (await this.prisma.debtPayment.aggregate({ where: { debtId: id }, _sum: { amount: true } }))._sum.amount ?? new D(0);
    const settled = paid.gte(debt.amount);
    if (settled !== !!debt.settledAt) {
      return this.prisma.debt.update({ where: { id }, data: { settledAt: settled ? new Date() : null } });
    }
    return debt;
  }

  private async own(userId: string, id: string) {
    const d = await this.prisma.debt.findFirst({ where: { id, userId } });
    if (!d) throw new NotFoundException('Deuda no encontrada');
    return d;
  }
}

function positive(v: string) {
  const d = new D(v);
  if (d.lte(0)) throw new BadRequestException('El monto debe ser mayor que cero');
  return d.toDecimalPlaces(2);
}

@ApiTags('debts') @ApiBearerAuth()
@Controller('debts')
class DebtsController {
  constructor(private debts: DebtsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.debts.list(u.id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateDebtDto) { return this.debts.create(u.id, dto); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateDebtDto) { return this.debts.update(u.id, id, dto); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.debts.remove(u.id, id); }
  @Post(':id/payments') pay(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PaymentDto) { return this.debts.pay(u.id, id, dto); }
  @Delete(':id/payments/:pid')
  removePayment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('pid') pid: string) { return this.debts.removePayment(u.id, id, pid); }
}

@Module({ controllers: [DebtsController], providers: [DebtsService] })
export class DebtsModule {}
