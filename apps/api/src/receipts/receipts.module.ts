import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

@Module({ imports: [TransactionsModule], controllers: [ReceiptsController], providers: [ReceiptsService] })
export class ReceiptsModule {}
