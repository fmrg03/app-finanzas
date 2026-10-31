import { Module } from '@nestjs/common';
import { ExchangeRatesController } from './exchange-rates.controller';
import { ExchangeRatesService } from './exchange-rates.service';
import { DolarApiProvider } from './providers/dolarapi.provider';
import { RATE_PROVIDER } from './providers/rate-provider';

@Module({
  controllers: [ExchangeRatesController],
  providers: [ExchangeRatesService, { provide: RATE_PROVIDER, useClass: DolarApiProvider }],
  exports: [ExchangeRatesService],
})
export class ExchangeRatesModule {}
