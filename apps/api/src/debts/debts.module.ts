import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Currency, DebtDirection, Prisma } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { convertAmounts } from '../common/money.util';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { displayName, PeopleModule, PeopleService } from '../people/people.module';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsModule } from '../transactions/transactions.module';
import { TransactionsService } from '../transactions/transactions.service';

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
class SettleDto {
  @ApiProperty() @IsString()
  personId: string;

  @ApiProperty({ enum: Currency }) @IsEnum(Currency)
  currency: Currency;
}

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

  @ApiPropertyOptional({ description: 'Registrar también como gasto (si pagas) o ingreso (si te pagan) en esa fecha y cuenta' })
  @IsOptional() @IsBoolean()
  asTransaction?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Categoría del gasto o ingreso' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;
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
    private transactions: TransactionsService,
  ) {}

  /** Abonos con cuenta que no son gasto ni ingreso, para mostrarlos en Movimientos (como las transferencias). */
  async paymentsBetween(userId: string, from?: string, to?: string) {
    const list = await this.prisma.debtPayment.findMany({
      where: {
        debt: { userId }, accountId: { not: null }, transactionId: null,
        ...(from || to ? { date: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: parseDateOnly(to) } : {}) } } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: {
        account: { select: { id: true, name: true, currency: true } },
        debt: { select: { id: true, person: true, direction: true, description: true, currency: true } },
      },
    });
    return list.map((p) => ({ ...p, date: toDateOnly(p.date) }));
  }

  async list(userId: string) {
    await this.linkPending(userId).catch(() => undefined);
    const debts = await this.prisma.debt.findMany({
      where: { userId },
      include: {
        payments: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: {
            account: { select: { id: true, name: true, currency: true } },
            transaction: { select: { id: true, type: true, category: { select: { id: true, name: true } } } },
          },
        },
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
        // Deuda manual con un familiar: la ve en su cuenta (al revés) y los cambios se reflejan en las dos
        linkedManual: !!d.linkedDebtId && !d.sharedId,
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
    const debt = await this.prisma.debt.create({
      data: {
        userId, direction: dto.direction, person: person.name, personId: person.id, description: dto.description?.trim() || null,
        currency: dto.currency, amount: positive(dto.amount), dueDate: dto.dueDate ? parseDateOnly(dto.dueDate) : null,
      },
    });
    if (person.linkedUserId) await this.linkToFamily(debt.id);
    return this.prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
  }

  /**
   * Una deuda con un familiar que usa la app aparece también en su cuenta, al revés (si tú prestas, él debe).
   * Los abonos ya hechos se copian. Le llega un aviso.
   */
  private async linkToFamily(debtId: string) {
    await this.prisma.$transaction(async (db) => {
      const d = await db.debt.findUniqueOrThrow({
        where: { id: debtId },
        include: { personRef: { include: { linkedUser: true } }, user: true, payments: true },
      });
      const target = d.personRef?.linkedUser;
      if (d.linkedDebtId || d.sharedId || d.settledAt || !target || target.disabledAt || target.id === d.userId) return;
      const me = await this.people.ensureLinkedPerson(target.id, d.user, db);
      const copy = await db.debt.create({
        data: {
          userId: target.id, direction: d.direction === 'I_OWE' ? 'OWED_TO_ME' : 'I_OWE', person: me.name, personId: me.id,
          description: d.description, currency: d.currency, amount: d.amount, dueDate: d.dueDate, linkedDebtId: d.id,
        },
      });
      // Si otra petición la vinculó primero, no se duplica
      const { count } = await db.debt.updateMany({ where: { id: d.id, linkedDebtId: null }, data: { linkedDebtId: copy.id } });
      if (!count) throw new ConflictException('ya vinculada');
      for (const p of d.payments) {
        await db.debtPayment.create({ data: { debtId: copy.id, amount: p.amount, date: p.date, note: p.note, mirrorOfId: p.mirrorOfId ? undefined : p.id } });
      }
      const amt = `${d.currency === 'USD' ? '$' : 'Bs'} ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(d.amount))}`;
      const who = displayName(d.user);
      await db.notification.create({
        data: {
          userId: target.id, type: 'SHARED_WITH_ME', dedupeKey: `debt:${copy.id}`, link: '/deudas',
          title: `${who} registró una deuda contigo`,
          body: `${copy.direction === 'I_OWE' ? `Le debes ${amt} a ${who}` : `${who} te debe ${amt}`}${d.description ? `: ${d.description}` : ''}.`,
        },
      });
    }).catch((e) => {
      if (!(e instanceof ConflictException)) throw e;
    });
  }

  /** Vincula deudas abiertas con familiares que quedaron sin vincular (creadas antes, o antes de que la persona se uniera). */
  private async linkPending(userId: string) {
    const pending = await this.prisma.debt.findMany({
      where: {
        linkedDebtId: null, sharedId: null, settledAt: null, linkedFrom: null,
        OR: [{ userId, personRef: { linkedUserId: { not: null } } }, { personRef: { linkedUserId: userId } }],
      },
      select: { id: true },
    });
    for (const d of pending) await this.linkToFamily(d.id);
  }

  async update(userId: string, id: string, dto: UpdateDebtDto) {
    const debt = await this.own(userId, id);
    if (debt.sharedId && (dto.direction || dto.currency || dto.amount || dto.person || dto.personId)) {
      throw new ConflictException('Esta deuda viene de un movimiento compartido: cambia el reparto desde el movimiento.');
    }
    const person = await this.personFor(userId, dto);
    if (debt.linkedDebtId && person && person.id !== debt.personId) {
      throw new ConflictException(`Esta deuda también está en la cuenta de ${debt.person}: para cambiar la persona, bórrala y créala de nuevo.`);
    }
    const common = {
      description: dto.description?.trim(), currency: dto.currency,
      amount: dto.amount ? positive(dto.amount) : undefined,
      dueDate: dto.dueDate === undefined ? undefined : dto.dueDate ? parseDateOnly(dto.dueDate) : null,
    };
    await this.prisma.$transaction(async (db) => {
      await db.debt.update({ where: { id }, data: { ...common, direction: dto.direction, person: person?.name, personId: person?.id } });
      // Lo mismo en la cuenta del familiar, al revés
      if (debt.linkedDebtId && !debt.sharedId) {
        const dir = dto.direction ? (dto.direction === 'I_OWE' ? 'OWED_TO_ME' : 'I_OWE') : undefined;
        await db.debt.update({ where: { id: debt.linkedDebtId }, data: { ...common, direction: dir } });
      }
    });
    if (debt.linkedDebtId) await this.syncSettled(debt.linkedDebtId);
    if (person?.linkedUserId && !debt.linkedDebtId) await this.linkToFamily(id);
    return this.syncSettled(id);
  }

  async remove(userId: string, id: string) {
    const debt = await this.own(userId, id);
    if (debt.sharedId) throw new ConflictException('Esta deuda viene de un movimiento compartido: se borra al borrar el movimiento.');
    // Con la deuda se van sus abonos y los gastos o ingresos que generaron.
    // Si está también en la cuenta del familiar, se borra allá; los abonos que él registró como movimiento le quedan como movimientos.
    await this.prisma.$transaction([
      this.prisma.transaction.deleteMany({ where: { userId, debtPayment: { debtId: id } } }),
      ...(debt.linkedDebtId ? [this.prisma.debt.deleteMany({ where: { id: debt.linkedDebtId, sharedId: null } })] : []),
      this.prisma.debt.delete({ where: { id } }),
    ]);
  }

  async pay(userId: string, id: string, dto: PaymentDto) {
    const debt = await this.own(userId, id);
    const paid = (await this.prisma.debtPayment.aggregate({ where: { debtId: id }, _sum: { amount: true } }))._sum.amount ?? new D(0);
    const amount = positive(dto.amount);
    if (amount.gt(debt.amount.sub(paid))) throw new BadRequestException(`El abono supera lo pendiente (${debt.amount.sub(paid).toFixed(2)})`);
    const date = dto.date ?? todayLocal();
    if (date > todayLocal()) throw new BadRequestException('La fecha del abono no puede ser futura');

    // Como movimiento: un gasto si pagas, un ingreso si te pagan. El movimiento mueve el saldo de la cuenta.
    let tx: { input: Parameters<TransactionsService['insert']>[1]; snapshot: Awaited<ReturnType<TransactionsService['snapshot']>> } | null = null;
    if (dto.asTransaction) {
      if (debt.sharedId) {
        throw new BadRequestException('Esta deuda viene de una compra compartida: tu parte ya contó como gasto el día de la compra, así que el abono no se registra otra vez.');
      }
      if (!dto.accountId) throw new BadRequestException('Elige la cuenta para registrar el abono como movimiento');
      await this.transactions.assertAccount(userId, dto.accountId);
      const type = debt.direction === 'I_OWE' ? 'EXPENSE' : 'INCOME';
      const category = await this.transactions.assertCategory(userId, dto.categoryId ?? null, type);
      const snapshot = await this.transactions.snapshot(userId, {
        currency: debt.currency, amount: amount.toFixed(2), date,
        ...(dto.rate ? { rate: dto.rate } : { rateSource: category?.defaultRateSource ?? undefined }),
      });
      const what = debt.description?.replace(/ \(compartido\)$/, '');
      tx = {
        input: {
          accountId: dto.accountId, categoryId: dto.categoryId ?? null, type, date,
          description: `${type === 'EXPENSE' ? 'Abono a' : 'Abono de'} ${debt.person}${what ? `: ${what}` : ''}`,
        },
        snapshot,
      };
    }
    const accountAmount = dto.accountId && !tx ? await this.accountAmount(userId, dto.accountId, debt.currency, amount, date, dto.rate) : null;
    await this.prisma.$transaction(async (db) => {
      const created = tx ? await this.transactions.insert(userId, tx.input, tx.snapshot, {}, db) : null;
      const payment = await db.debtPayment.create({
        data: {
          debtId: id, amount, date: parseDateOnly(date), note: dto.note?.trim() || null, accountId: dto.accountId ?? null, accountAmount,
          transactionId: created?.id ?? null,
        },
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
    if (p.transactionId) throw new ConflictException('Este abono está registrado como movimiento: para cambiar la cuenta, bórralo y regístralo de nuevo.');
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
    // Un abono y su copia en la cuenta del familiar se borran juntos, y también el movimiento que generó
    const source = await this.prisma.debtPayment.findUniqueOrThrow({ where: { id: p.mirrorOfId ?? p.id } });
    await this.prisma.$transaction(async (db) => {
      if (source.transactionId) await db.transaction.delete({ where: { id: source.transactionId } });
      if (p.transactionId && p.transactionId !== source.transactionId) await db.transaction.delete({ where: { id: p.transactionId } });
      await db.debtPayment.delete({ where: { id: source.id } });
    });
    if (debt.linkedDebtId) await this.syncSettled(debt.linkedDebtId).catch(() => undefined);
    return this.syncSettled(id);
  }

  /** Marca como saldada cuando lo abonado cubre el total, y la reabre si deja de cubrirlo. */
  /**
   * Saldar cuentas con una persona: lo que te debe y lo que le debes (en la misma moneda) se compensan.
   * Se anotan abonos sin cuenta por el monto menor en ambos lados, de las deudas más viejas a las más nuevas;
   * en las deudas compartidas con un familiar el abono le aparece también a él.
   */
  async settleWithPerson(userId: string, dto: SettleDto) {
    const person = await this.people.own(userId, dto.personId);
    const debts = await this.prisma.debt.findMany({
      where: { userId, personId: person.id, currency: dto.currency, settledAt: null },
      include: { payments: { select: { amount: true } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const open = debts
      .map((d) => ({ d, rem: d.amount.sub(d.payments.reduce((a, x) => a.add(x.amount), new D(0))) }))
      .filter((x) => x.rem.gt(0));
    const mine = open.filter((x) => x.d.direction === 'OWED_TO_ME');
    const theirs = open.filter((x) => x.d.direction === 'I_OWE');
    const sum = (xs: typeof open) => xs.reduce((a, x) => a.add(x.rem), new D(0));
    const offset = D.min(sum(mine), sum(theirs));
    if (offset.lte(0)) throw new BadRequestException(`Con ${person.name} no hay deudas en ambos sentidos en ${dto.currency === 'USD' ? 'dólares' : 'bolívares'} para compensar`);
    const date = todayLocal();
    const note = `Compensado con ${person.name}`;
    for (const side of [mine, theirs]) {
      let left = offset;
      for (const x of side) {
        if (left.lte(0)) break;
        const amt = D.min(left, x.rem);
        await this.pay(userId, x.d.id, { amount: amt.toFixed(2), date, note });
        left = left.sub(amt);
      }
    }
    return {
      offset: offset.toFixed(2),
      owedToMe: sum(mine).sub(offset).toFixed(2),
      iOwe: sum(theirs).sub(offset).toFixed(2),
    };
  }

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

  @Get('payments') payments(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.debts.paymentsBetween(u.id, from, to);
  }
  @Get() list(@CurrentUser() u: AuthUser) { return this.debts.list(u.id); }
  @Post('settle') settle(@CurrentUser() u: AuthUser, @Body() dto: SettleDto) { return this.debts.settleWithPerson(u.id, dto); }
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

@Module({ imports: [PeopleModule, ExchangeRatesModule, TransactionsModule], controllers: [DebtsController], providers: [DebtsService] })
export class DebtsModule {}
