import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { toDateOnly } from '../common/date.util';
import { ListExchangeRatesDto, RateForDateDto, UpsertExchangeRateDto } from './dto/exchange-rate.dto';
import { ExchangeRatesService } from './exchange-rates.service';

@ApiTags('exchange-rates') @ApiBearerAuth()
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private rates: ExchangeRatesService) {}

  @Get()
  list(@Query() q: ListExchangeRatesDto) {
    return this.rates.list(q);
  }

  @Get('latest')
  latest() {
    return this.rates.latest();
  }

  /** La tasa que usaría una transacción en esa fecha (para previsualizar en el formulario). */
  @Get('for-date')
  async forDate(@Query() q: RateForDateDto) {
    const { rate, fallback } = await this.rates.resolve(q.date, q.source);
    return { requestedDate: q.date, rateDate: toDateOnly(rate.date), source: rate.source, rate: rate.rate, fallback };
  }

  /** Crea o corrige la tasa de un día (cualquier fuente). No altera transacciones ya guardadas. */
  @Put()
  upsert(@Body() dto: UpsertExchangeRateDto) {
    return this.rates.upsert(dto);
  }

  @Post('sync') @HttpCode(200)
  sync() {
    return this.rates.sync();
  }
}
