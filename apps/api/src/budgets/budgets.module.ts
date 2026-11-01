import { Body, Controller, Delete, Get, HttpCode, Module, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { BudgetsService, BudgetStatusDto, UpsertBudgetDto } from './budgets.service';

@ApiTags('budgets') @ApiBearerAuth()
@Controller('budgets')
class BudgetsController {
  constructor(private budgets: BudgetsService) {}

  @Get()
  status(@CurrentUser() u: AuthUser, @Query() q: BudgetStatusDto) {
    return this.budgets.status(u.id, q.month);
  }

  @Put()
  upsert(@CurrentUser() u: AuthUser, @Body() dto: UpsertBudgetDto) {
    return this.budgets.upsert(u.id, dto);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.budgets.remove(u.id, id);
  }
}

@Module({ controllers: [BudgetsController], providers: [BudgetsService], exports: [BudgetsService] })
export class BudgetsModule {}
