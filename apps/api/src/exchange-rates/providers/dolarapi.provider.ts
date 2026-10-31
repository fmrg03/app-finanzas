import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FetchedRate, RateProvider } from './rate-provider';

interface DolarApiQuote {
  fuente?: string;
  nombre?: string;
  promedio?: number | null;
  fechaActualizacion?: string;
}

/** https://dolarapi.com/docs/venezuela — oficial = BCV, paralelo = promedio del mercado. */
@Injectable()
export class DolarApiProvider implements RateProvider {
  readonly name = 'dolarapi';
  private readonly log = new Logger(DolarApiProvider.name);
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get('RATES_API_URL') ?? 'https://ve.dolarapi.com/v1/dolares';
  }

  async fetchLatest(): Promise<FetchedRate[]> {
    const pairs: [FetchedRate['source'], string][] = [
      ['BCV', 'oficial'],
      ['PARALELO', 'paralelo'],
    ];
    const results = await Promise.allSettled(pairs.map(([source, path]) => this.fetchOne(source, path)));
    const rates: FetchedRate[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) rates.push(r.value);
      else if (r.status === 'rejected') this.log.warn(`No se pudo obtener ${pairs[i][0]}: ${r.reason}`);
    });
    return rates;
  }

  private async fetchOne(source: FetchedRate['source'], path: string): Promise<FetchedRate | null> {
    const res = await fetch(`${this.baseUrl}/${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as DolarApiQuote;
    const rate = Number(body.promedio);
    if (!Number.isFinite(rate) || rate <= 0) {
      this.log.warn(`Respuesta sin tasa válida para ${source}: ${JSON.stringify(body)}`);
      return null;
    }
    return { source, rate, updatedAt: body.fechaActualizacion };
  }
}
