import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/decorators/public.decorator';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { TransactionsModule } from './transactions/transactions.module';
import { StatsModule } from './stats/stats.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { TransfersModule } from './transfers/transfers.module';
import { RecurringModule } from './recurring/recurring.module';
import { BudgetsModule } from './budgets/budgets.module';
import { GoalsModule } from './goals/goals.module';
import { DebtsModule } from './debts/debts.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PeopleModule } from './people/people.module';
import { SharedModule } from './shared/shared.module';
import { InstallmentsModule } from './installments/installments.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    // Límite general por IP; las rutas de auth tienen límites más estrictos
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    ScheduleModule.forRoot(),
    AuthModule,
    AccountsModule,
    CategoriesModule,
    ExchangeRatesModule,
    TransactionsModule,
    StatsModule,
    ReceiptsModule,
    TransfersModule,
    RecurringModule,
    BudgetsModule,
    GoalsModule,
    DebtsModule,
    NotificationsModule,
    PeopleModule,
    SharedModule,
    InstallmentsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
