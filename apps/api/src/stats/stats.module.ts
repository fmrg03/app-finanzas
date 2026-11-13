import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({ imports: [BudgetsModule], controllers: [StatsController], providers: [StatsService] })
export class StatsModule {}
