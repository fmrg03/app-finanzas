import { Module } from '@nestjs/common';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { ExportService } from './export.service';

@Module({
  imports: [ExchangeRatesModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, ExportService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
