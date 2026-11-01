import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({ imports: [ExchangeRatesModule], controllers: [TransfersController], providers: [TransfersService] })
export class TransfersModule {}
