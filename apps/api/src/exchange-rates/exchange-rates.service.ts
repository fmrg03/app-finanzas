import { Inject, Injectable, Logger, OnApplicationBootstrap, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ExchangeRate, Prisma, RateSource } from '@prisma/client';
import { CronJob } from 'cron';
import { APP_TIMEZONE, parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { ListExchangeRatesDto, UpsertExchangeRateDto } from './dto/exchange-rate.dto';
import { RATE_PROVIDER, RateProvider } from './providers/rate-provider';

export interface ResolvedRate {
  rate: ExchangeRate;
  /** true si no había tasa para ese día exacto y se usó la última anterior (fines de semana, feriados) */
  fallback: boolean;
}

@Injectable()
export class ExchangeRatesService implements OnApplicationBootstrap {
  private readonly log = new Logger(ExchangeRatesService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private scheduler: SchedulerRegistry,
    @Inject(RATE_PROVIDER) private provider: RateProvider,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get('RATES_SYNC_ENABLED') === 'false') return;

    // Por defecto 9:00 y 13:00 hora de Caracas. Se evita la tarde porque el BCV
    // publica ahí la tasa del día hábil siguiente y quedaría guardada con la fecha de hoy.
    const expr = this.config.get('RATES_CRON') ?? '0 9,13 * * *';
    const job = CronJob.from({ cronTime: expr, timeZone: APP_TIMEZONE, onTick: () => void this.syncSafe() });
    this.scheduler.addCronJob('exchange-rates-sync', job);
    job.start();
    this.log.log(`Sincronización de tasas programada: "${expr}" (${APP_TIMEZONE})`);

    // Al arrancar, si falta la tasa de hoy, la trae (útil en local, donde la API no corre 24/7)
    const today = parseDateOnly(todayLocal());
    const have = await this.prisma.exchangeRate.count({ where: { date: today, source: { in: ['BCV', 'PARALELO'] } } });
    if (have < 2) void this.syncSafe();
    else this.log.log(`Tasas de hoy (${todayLocal()}) ya guardadas; no hace falta sincronizar`);
  }

  /** Consulta el proveedor y guarda (o actualiza) la tasa de hoy por cada fuente. */
  async sync() {
    const date = parseDateOnly(todayLocal());
    const fetched = await this.provider.fetchLatest();
    const saved: ExchangeRate[] = [];
    for (const f of fetched) {
      saved.push(
        await this.prisma.exchangeRate.upsert({
          where: { date_source: { date, source: f.source } },
          create: { date, source: f.source, rate: f.rate },
          update: { rate: f.rate, fetchedAt: new Date() },
        }),
      );
    }
    this.log.log(`Tasas sincronizadas (${this.provider.name}): ${saved.map((r) => `${r.source}=${r.rate}`).join(', ') || 'ninguna'}`);
    return { provider: this.provider.name, date: toDateOnly(date), saved };
  }

  private async syncSafe() {
    try {
      await this.sync();
    } catch (e) {
      this.log.error(`Falló la sincronización de tasas: ${(e as Error).message}`);
    }
  }

  list(q: ListExchangeRatesDto) {
    const date: Prisma.DateTimeFilter = {};
    if (q.from) date.gte = parseDateOnly(q.from);
    if (q.to) date.lte = parseDateOnly(q.to);
    return this.prisma.exchangeRate.findMany({
      where: { ...(q.source ? { source: q.source } : {}), ...(q.from || q.to ? { date } : {}) },
      orderBy: [{ date: 'desc' }, { source: 'asc' }],
      take: 400,
    });
  }

  /** Última tasa conocida por fuente. */
  async latest() {
    const sources: RateSource[] = ['BCV', 'PARALELO', 'MANUAL'];
    const rows = await Promise.all(
      sources.map((source) => this.prisma.exchangeRate.findFirst({ where: { source }, orderBy: { date: 'desc' } })),
    );
    return rows.filter((r): r is ExchangeRate => r !== null);
  }

  upsert(dto: UpsertExchangeRateDto) {
    const date = parseDateOnly(dto.date);
    if (new Prisma.Decimal(dto.rate).lte(0)) throw new UnprocessableEntityException('La tasa debe ser mayor que cero');
    return this.prisma.exchangeRate.upsert({
      where: { date_source: { date, source: dto.source } },
      create: { date, source: dto.source, rate: dto.rate },
      update: { rate: dto.rate, fetchedAt: new Date() },
    });
  }

  /**
   * Tasa aplicable a una fecha: la del día exacto o, si no existe, la más reciente anterior.
   * Si la fecha es hoy y aún no hay tasa, intenta sincronizar antes de rendirse.
   */
  async resolve(dateStr: string, source: RateSource): Promise<ResolvedRate> {
    const date = parseDateOnly(dateStr);
    const find = async () => {
      const exact = await this.prisma.exchangeRate.findUnique({ where: { date_source: { date, source } } });
      if (exact) return { rate: exact, fallback: false };
      const prev = await this.prisma.exchangeRate.findFirst({ where: { source, date: { lt: date } }, orderBy: { date: 'desc' } });
      return prev ? { rate: prev, fallback: true } : null;
    };

    let found = await find();
    if ((!found || found.fallback) && source !== 'MANUAL' && dateStr === todayLocal()) {
      await this.syncSafe();
      found = (await find()) ?? found;
    }
    if (!found) {
      throw new UnprocessableEntityException(
        `No hay tasa ${source} para ${dateStr} ni anterior. Indica la tasa manualmente (campo "rate").`,
      );
    }
    return found;
  }
}
