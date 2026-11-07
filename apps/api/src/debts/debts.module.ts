import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Currency, DebtDirection, Prisma } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { convertAmounts } from '../common/money.util';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { displayName, PeopleModule, PeopleService } from '../people/people.module';
import { PrismaService } from '../prisma/prisma.service';

class CreateDebtDto {
  @ApiProperty({ enum: DebtDirection, description: 'I_OWE: yo debo; OWED_TO_ME: me deben' }) @IsEnum(DebtDirection)
  direction: DebtDirection;

  @ApiPropertyOptional({ example: 'Carlos', description: 'Nombre (se crea la persona si no existe) o usa personId' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  person?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  personId?: string;

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

  @ApiPropertyOptional({ description: 'Cuenta donde entra (te pagan) o de donde sale (pagas) el abono' })
  @IsOptional() @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Tasa Bs/USD si la cuenta es de otra moneda (por defecto la BCV del día)' })
  @IsOptional() @IsNumberString()
  rate?: string;
}

const D = Prisma.Decimal;

class PaymentAccountDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  accountId?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsNumberString()
  rate?: string;
}

@Injectable()
class DebtsService {
  constructor(
    private prisma: PrismaService,
    private people: PeopleService,
    private rates: ExchangeRatesService,
  ) {}

  async list(userId: string) {
    const debts = await this.prisma.debt.findMany({
      where: { userId },
      include: {
        payments: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: { account: { select: { id: true, name: true, currency: true } } } },
        personRef: { select: { id: true, name: true, phone: true, linkedUserId: true } },
        shared: { select: { mirrorOf: { select: { user: { select: { name: true, email: true } } } } } },
      },
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
        fromShared: !!d.sharedId,
        // La deuda se ve igual en la cuenta del familiar y los abonos se copian
        synced: !!d.linkedDebtId,
        sharedBy: d.shared?.mirrorOf ? displayName(d.shared.mirrorOf.user) : null,
        shared: undefined,
        paid: paid.toFixed(2),
        remaining: remaining.toFixed(2),
        overdue: !d.settledAt && !!d.dueDate && d.dueDate < today,
      };
    });
  }

  async create(userId: string, dto: CreateDebtDto) {
    const person = await this.personFor(userId, dto);
    if (!person) throw new BadRequestException('Indica la persona');
    return this.prisma.debt.create({
      data: {
        userId, direction: dto.direction, person: person.name, personId: person.id, description: dto.description?.trim() || null,
        currency: dto.currency, amount: positive(dto.amount), dueDate: dto.dueDate ? parseDateOnly(dto.dueDate) : null,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateDebtDto) {
    const debt = await this.own(userId, id);
    if (debt.sharedId && (dto.direction || dto.currency || dto.amount || dto.person || dto.personId)) {
      throw new ConflictException('Esta deuda viene de un movimiento compartido: cambia el reparto desde el movimiento.');
    }
    const person = await this.personFor(userId, dto);
    await this.prisma.debt.update({
      where: { id },
      data: {
        direction: dto.direction, person: person?.name, personId: person?.id, description: dto.description?.trim(), currency: dto.currency,
        amount: dto.amount ? positive(dto.amount) : undefined,
        dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? parseDateOnly(dto.dueDate) : null,
      },
    });
    return this.syncSettled(id);
  }

  async remove(userId: string, id: string) {
    const debt = await this.own(userId, id);
    if (debt.sharedId) throw new ConflictException('Esta deuda viene de un movimiento compartido: se borra al borrar el movimiento.');
    await this.prisma.debt.delete({ where: { id } });
  }

  async pay(userId: string, id: string, dto: PaymentDto) {
    const debt = await this.own(userId, id);
    const paid = (await this.prisma.debtPayment.aggregate({ where: { debtId: id }, _sum: { amount: true } }))._sum.amount ?? new D(0);
    const amount = positive(dto.amount);
    if (amount.gt(debt.amount.sub(paid))) throw new BadRequestException(`El abono supera lo pendiente (${debt.amount.sub(paid).toFixed(2)})`);
    const date = dto.date ?? todayLocal();
    const accountAmount = dto.accountId ? await this.accountAmount(userId, dto.accountId, debt.currency, amount, date, dto.rate) : null;
    await this.prisma.$transaction(async (db) => {
      const payment = await db.debtPayment.create({
        data: { debtId: id, amount, date: parseDateOnly(date), note: dto.note?.trim() || null, accountId: dto.accountId ?? null, accountAmount },
      });
      // Deuda compartida con un familiar: el abono aparece también en su lado, sin cuenta (la elige él)
      if (debt.linkedDebtId) {
        await db.debtPayment.create({
          data: { debtId: debt.linkedDebtId, amount, date: payment.date, note: payment.note, mirrorOfId: payment.id },
        });
      }
    });
    if (debt.linkedDebtId) await this.syncSettled(debt.linkedDebtId);
    return this.syncSettled(id);
  }

  /** Elige o cambia la cuenta de un abono, por ejemplo uno que registró el familiar. */
  async setPaymentAccount(userId: string, id: string, paymentId: string, dto: PaymentAccountDto) {
    const debt = await this.own(userId, id);
    const p = await this.prisma.debtPayment.findFirst({ where: { id: paymentId, debtId: id } });
    if (!p) throw new NotFoundException('Abono no encontrado');
    const accountAmount = dto.accountId
      ? await this.accountAmount(userId, dto.accountId, debt.currency, p.amount, toDateOnly(p.date), dto.rate)
      : null;
    await this.prisma.debtPayment.update({ where: { id: paymentId }, data: { accountId: dto.accountId ?? null, accountAmount } });
    return this.syncSettled(id);
  }

  /** Monto en la moneda de la cuenta si es distinta de la de la deuda (tasa indicada o BCV del día). */
  private async accountAmount(userId: string, accountId: string, currency: Currency, amount: Prisma.Decimal, date: string, rate?: string) {
    const acc = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!acc) throw new BadRequestException('La cuenta no existe');
    if (acc.archivedAt) throw new BadRequestException('La cuenta está archivada');
    if (acc.currency === currency) return null;
    const r = rate ? new D(rate) : (await this.rates.resolve(date, 'BCV')).rate.rate;
    if (r.lte(0)) throw new BadRequestException('La tasa debe ser mayor que cero');
    const c = convertAmounts(currency, amount, r);
    return acc.currency === 'USD' ? c.amountUsd : c.amountVes;
  }

  async removePayment(userId: string, id: string, paymentId: string) {
    const debt = await this.own(userId, id);
    const p = await this.prisma.debtPayment.findFirst({ where: { id: paymentId, debtId: id } });
    if (!p) throw new NotFoundException('Abono no encontrado');
    // Un abono y su copia en la cuenta del familiar se borran juntos
    await this.prisma.debtPayment.delete({ where: { id: p.mirrorOfId ?? p.id } });
    if (debt.linkedDebtId) await this.syncSettled(debt.linkedDebtId).catch(() => undefined);
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

  private async personFor(userId: string, dto: { person?: string; personId?: string }) {
    if (dto.personId) return this.people.own(userId, dto.personId);
    if (dto.person?.trim()) return this.people.resolveByName(userId, dto.person);
    return null;
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
  @Patch(':id/payments/:pid')
  setPaymentAccount(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('pid') pid: string, @Body() dto: PaymentAccountDto) {
    return this.debts.setPaymentAccount(u.id, id, pid, dto);
  }
  @Delete(':id/payments/:pid')
  removePayment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('pid') pid: string) { return this.debts.removePayment(u.id, id, pid); }
}

@Module({ imports: [PeopleModule, ExchangeRatesModule], controllers: [DebtsController], providers: [DebtsService] })
export class DebtsModule {}
