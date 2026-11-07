import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Prisma, Recurring } from '@prisma/client';
import { CronJob } from 'cron';
import { APP_TIMEZONE, parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { ConfirmRecurringDto, ConfirmReserveDto, CreateRecurringDto, UpdateRecurringDto } from './recurring.dto';
import {
  canReserve, dayOfMonth, firstReserveDate, nextOccurrence, nextReserveDate, reserveAfterPayment, reserveStatus, sumAmounts as sum,
} from './schedule';

export { nextOccurrence } from './schedule';

const INCLUDE = {
  account: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, color: true } },
  reserves: { select: { amount: true } },
} satisfies Prisma.RecurringInclude;

const RESERVE_ONLY = 'El apartado mensual es para pagos trimestrales, semestrales o anuales';

const MAX_CATCH_UP = 24;

@Injectable()
export class RecurringService implements OnApplicationBootstrap {
  private readonly log = new Logger(RecurringService.name);

  constructor(
    private prisma: PrismaService,
    private transactions: TransactionsService,
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('RECURRING_ENABLED') === 'false') return;
    // Todos los días a las 6:00 hora local, y una vez al arrancar
    const job = CronJob.from({ cronTime: '0 6 * * *', timeZone: APP_TIMEZONE, onTick: () => void this.processAllSafe() });
    this.scheduler.addCronJob('recurring-process', job);
    job.start();
    void this.processAllSafe();
  }

  async list(userId: string) {
    const items = await this.prisma.recurring.findMany({ where: { userId }, include: INCLUDE, orderBy: [{ active: 'desc' }, { nextDate: 'asc' }] });
    return items.map(present);
  }

  /** Pendientes de confirmar: los que no son automáticos y ya les tocó. */
  async due(userId: string) {
    const today = parseDateOnly(todayLocal());
    const items = await this.prisma.recurring.findMany({
      where: { userId, active: true, autoCreate: false, nextDate: { lte: today } },
      include: INCLUDE,
      orderBy: { nextDate: 'asc' },
    });
    return items.map(present);
  }

  /** Apartados que ya toca confirmar. */
  async reservesDue(userId: string) {
    const today = parseDateOnly(todayLocal());
    const items = await this.prisma.recurring.findMany({
      where: { userId, active: true, reserve: true, reserveNextDate: { lte: today } },
      include: INCLUDE,
      orderBy: { reserveNextDate: 'asc' },
    });
    return items.map(present);
  }

  async create(userId: string, dto: CreateRecurringDto) {
    await this.validate(userId, dto);
    const start = parseDateOnly(dto.startDate);
    if (dto.reserve && !canReserve(dto.frequency)) throw new BadRequestException(RESERVE_ONLY);
    const reserveDay = dto.reserve ? (dto.reserveDay ?? 1) : null;
    const r = await this.prisma.recurring.create({
      data: {
        userId, type: dto.type, accountId: dto.accountId, categoryId: dto.categoryId ?? null, currency: dto.currency,
        amount: amount(dto.amount), rateSource: dto.rateSource ?? null, description: dto.description.trim(),
        tags: normTags(dto.tags), frequency: dto.frequency, startDate: start, nextDate: start,
        endDate: dto.endDate ? parseDateOnly(dto.endDate) : null, autoCreate: dto.autoCreate ?? false, active: dto.active ?? true,
        reserve: !!dto.reserve, reserveDay, reserveNextDate: reserveDay ? firstReserveDate(parseDateOnly(todayLocal()), reserveDay) : null,
      },
      include: INCLUDE,
    });
    if (r.autoCreate) await this.processOne(r);
    return this.findOne(userId, r.id);
  }

  async findOne(userId: string, id: string) {
    const r = await this.prisma.recurring.findFirst({ where: { id, userId }, include: INCLUDE });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    return present(r);
  }

  async update(userId: string, id: string, dto: UpdateRecurringDto) {
    const cur = await this.prisma.recurring.findFirst({ where: { id, userId }, include: { reserves: { select: { amount: true } } } });
    if (!cur) throw new NotFoundException('Recurrente no encontrado');
    const reserve = dto.reserve ?? cur.reserve;
    if (reserve && !canReserve(dto.frequency ?? cur.frequency)) throw new BadRequestException(RESERVE_ONLY);
    const reserveData = this.reserveChange(cur, reserve, dto.reserveDay);
    await this.validate(userId, { type: dto.type ?? cur.type, accountId: dto.accountId ?? cur.accountId, categoryId: dto.categoryId === undefined ? cur.categoryId : dto.categoryId });
    // Cambiar la fecha de inicio reprograma la próxima
    const start = dto.startDate ? parseDateOnly(dto.startDate) : undefined;
    const r = await this.prisma.recurring.update({
      where: { id },
      data: {
        type: dto.type, accountId: dto.accountId, categoryId: dto.categoryId, currency: dto.currency,
        amount: dto.amount ? amount(dto.amount) : undefined, rateSource: dto.rateSource,
        description: dto.description?.trim(), tags: dto.tags ? normTags(dto.tags) : undefined, frequency: dto.frequency,
        ...(start ? { startDate: start, nextDate: start } : {}),
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? parseDateOnly(dto.endDate) : null,
        autoCreate: dto.autoCreate, active: dto.active,
        ...reserveData,
      },
    });
    // Al quitar el apartado, lo reservado queda libre en la cuenta
    const balance = sum(cur.reserves);
    if (cur.reserve && !reserve && !balance.isZero()) {
      await this.prisma.recurringReserve.create({ data: { recurringId: id, kind: 'USED', date: parseDateOnly(todayLocal()), amount: balance.neg() } });
    }
    if (r.autoCreate && r.active) await this.processOne(r);
    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    await this.prisma.recurring.delete({ where: { id } });
  }

  /** Registra la ocurrencia pendiente (con monto o fecha ajustados) y avanza a la siguiente. */
  async confirm(userId: string, id: string, dto: ConfirmRecurringDto) {
    const r = await this.prisma.recurring.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    if (!r.active) throw new BadRequestException('Este recurrente está pausado');
    const due = toDateOnly(r.nextDate);
    const tx = await this.transactions.create(
      userId,
      {
        type: r.type, accountId: dto.accountId ?? r.accountId, categoryId: r.categoryId, date: dto.date ?? due,
        currency: r.currency, amount: dto.amount ?? r.amount.toString(), rateSource: r.rateSource ?? undefined,
        rate: dto.rate, description: r.description, tags: r.tags,
      },
      { source: 'RECURRING', externalId: `rec:${r.id}:${due}` },
    );
    await this.useReserve(r, dto.date ?? due);
    await this.advance(r);
    return tx;
  }

  /** Confirma el apartado del mes (por defecto, lo sugerido para llegar completo al pago) y pasa al siguiente. */
  async confirmReserve(userId: string, id: string, dto: ConfirmReserveDto) {
    const r = await this.prisma.recurring.findFirst({ where: { id, userId }, include: INCLUDE });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    if (!r.reserve || !r.reserveDay || !r.reserveNextDate) throw new BadRequestException('Este recurrente no tiene apartado mensual');
    const amt = dto.amount !== undefined ? amount(dto.amount) : present(r).reserveStatus!.suggested;
    if (new Prisma.Decimal(amt).lte(0)) throw new BadRequestException('Ya tienes apartado todo el pago; no hace falta apartar más');
    await this.prisma.$transaction([
      this.prisma.recurringReserve.create({
        data: { recurringId: id, kind: 'SET_ASIDE', date: dto.date ? parseDateOnly(dto.date) : r.reserveNextDate, amount: amt },
      }),
      this.prisma.recurring.update({ where: { id }, data: { reserveNextDate: nextReserveDate(r.reserveNextDate, r.reserveDay) } }),
    ]);
    return this.findOne(userId, id);
  }

  /** Salta el apartado de este mes; lo que falte se reparte entre los meses que quedan. */
  async skipReserve(userId: string, id: string) {
    const r = await this.prisma.recurring.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    if (!r.reserve || !r.reserveDay || !r.reserveNextDate) throw new BadRequestException('Este recurrente no tiene apartado mensual');
    await this.prisma.recurring.update({ where: { id }, data: { reserveNextDate: nextReserveDate(r.reserveNextDate, r.reserveDay) } });
    return this.findOne(userId, id);
  }

  /** Salta la ocurrencia pendiente sin registrar nada (por ejemplo, ese mes no se pagó). */
  async skip(userId: string, id: string) {
    const r = await this.prisma.recurring.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Recurrente no encontrado');
    await this.advance(r);
    return this.findOne(userId, id);
  }

  async processAll() {
    const today = parseDateOnly(todayLocal());
    const due = await this.prisma.recurring.findMany({ where: { active: true, autoCreate: true, nextDate: { lte: today } } });
    let created = 0;
    for (const r of due) created += await this.processOne(r);
    if (created) this.log.log(`Recurrentes: ${created} movimientos registrados`);
    return created;
  }

  private async processAllSafe() {
    try {
      await this.processAll();
    } catch (e) {
      this.log.error(`Falló el proceso de recurrentes: ${(e as Error).message}`);
    }
  }

  /** Registra todas las ocurrencias vencidas de un recurrente automático (con tope por si estuvo apagado mucho tiempo). */
  private async processOne(r: Recurring) {
    const today = parseDateOnly(todayLocal());
    let cur = r;
    let created = 0;
    for (let i = 0; i < MAX_CATCH_UP && cur.active && cur.nextDate <= today; i++) {
      const date = toDateOnly(cur.nextDate);
      try {
        await this.transactions.create(
          r.userId,
          {
            type: cur.type, accountId: cur.accountId, categoryId: cur.categoryId, date, currency: cur.currency,
            amount: cur.amount.toString(), rateSource: cur.rateSource ?? undefined, description: cur.description, tags: cur.tags,
          },
          { source: 'RECURRING', externalId: `rec:${cur.id}:${date}` },
        );
        created++;
        await this.useReserve(cur, date);
      } catch (e) {
        // P2002 = ya existía (se registró antes); cualquier otro error se reporta y se deja para el próximo intento
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
          this.log.warn(`No se pudo registrar el recurrente ${cur.id} del ${date}: ${(e as Error).message}`);
          break;
        }
      }
      cur = await this.advance(cur);
    }
    return created;
  }

  private async advance(r: Recurring) {
    const next = nextOccurrence(r, r.nextDate);
    const ended = r.endDate && next > r.endDate;
    return this.prisma.recurring.update({ where: { id: r.id }, data: { nextDate: next, ...(ended ? { active: false } : {}) } });
  }

  /** Al pagar, lo apartado se usa (el saldo vuelve a cero) y el próximo apartado queda después del pago. */
  private async useReserve(r: Recurring, paidOn: string) {
    if (!r.reserve || !r.reserveDay) return;
    const rows = await this.prisma.recurringReserve.findMany({ where: { recurringId: r.id }, select: { amount: true } });
    const balance = sum(rows);
    const fresh = await this.prisma.recurring.findUniqueOrThrow({ where: { id: r.id } });
    await this.prisma.$transaction([
      ...(balance.gt(0)
        ? [this.prisma.recurringReserve.create({ data: { recurringId: r.id, kind: 'USED', date: parseDateOnly(paidOn), amount: balance.neg() } })]
        : []),
      this.prisma.recurring.update({ where: { id: r.id }, data: { reserveNextDate: reserveAfterPayment(fresh.reserveNextDate, r.reserveDay, r.nextDate) } }),
    ]);
  }

  /** Campos del apartado al editar: al activarlo empieza este mes; al cambiar el día se mantiene el mes pendiente. */
  private reserveChange(cur: Recurring, reserve: boolean, day?: number) {
    if (!reserve) return cur.reserve ? { reserve: false, reserveDay: null, reserveNextDate: null } : {};
    if (!cur.reserve || !cur.reserveNextDate) {
      const d = day ?? cur.reserveDay ?? 1;
      return { reserve: true, reserveDay: d, reserveNextDate: firstReserveDate(parseDateOnly(todayLocal()), d) };
    }
    if (day && day !== cur.reserveDay) {
      return { reserveDay: day, reserveNextDate: dayOfMonth(cur.reserveNextDate.getUTCFullYear(), cur.reserveNextDate.getUTCMonth(), day) };
    }
    return {};
  }

  private async validate(userId: string, d: { type: string; accountId: string; categoryId?: string | null }) {
    const acc = await this.prisma.account.findFirst({ where: { id: d.accountId, userId } });
    if (!acc) throw new BadRequestException('La cuenta no existe');
    if (d.categoryId) {
      const cat = await this.prisma.category.findFirst({ where: { id: d.categoryId, userId } });
      if (!cat) throw new BadRequestException('La categoría no existe');
      if (cat.type !== d.type) throw new BadRequestException('La categoría no corresponde al tipo de movimiento');
    }
  }
}

function amount(v: string) {
  const d = new Prisma.Decimal(v);
  if (d.lte(0)) throw new BadRequestException('El monto debe ser mayor que cero');
  return d.toDecimalPlaces(2);
}
const normTags = (t?: string[]) => [...new Set((t ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean))];

function present<T extends Parameters<typeof reserveStatus>[0] & { startDate: Date; endDate: Date | null }>(r: T) {
  const { reserves: _r, ...rest } = r;
  return {
    ...rest,
    startDate: toDateOnly(r.startDate), nextDate: toDateOnly(r.nextDate), endDate: r.endDate ? toDateOnly(r.endDate) : null,
    reserveNextDate: r.reserveNextDate ? toDateOnly(r.reserveNextDate) : null,
    reserveStatus: reserveStatus(r),
  };
}
