import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { OverviewDto } from './stats.dto';
import { StatsService } from './stats.service';

@ApiTags('stats') @ApiBearerAuth()
@Controller('stats')
export class StatsController {
  constructor(private stats: StatsService) {}

  /** Todo lo que necesita el dashboard en una sola llamada. */
  @Get('overview')
  overview(@CurrentUser() u: AuthUser, @Query() q: OverviewDto) {
    return this.stats.overview(u.id, q);
  }

  /** Inflación personal: lo que cuesta tu canasta de gastos mes a mes, en USD y Bs, contra el BCV. */
  @Get('inflation')
  @ApiQuery({ name: 'months', required: false, example: 12 })
  @ApiQuery({ name: 'categories', required: false, description: 'ids de categorías principales separados por coma (por defecto, las de siempre)' })
  inflation(
    @CurrentUser() u: AuthUser,
    @Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number,
    @Query('categories') categories?: string,
  ) {
    return this.stats.inflation(u.id, Math.min(Math.max(months, 3), 24), categories?.split(',').filter(Boolean));
  }

  /** Resumen de un mes (por defecto el anterior), para ver o mandar por WhatsApp. */
  @Get('month-summary')
  @ApiQuery({ name: 'month', required: false, example: '2026-10' })
  monthSummary(@CurrentUser() u: AuthUser, @Query('month') month?: string) {
    return this.stats.monthSummary(u.id, month);
  }

  /** Patrimonio mensual en USD y pérdida por devaluación de los bolívares. */
  @Get('net-worth')
  @ApiQuery({ name: 'months', required: false, example: 12 })
  netWorth(@CurrentUser() u: AuthUser, @Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number) {
    return this.stats.netWorth(u.id, Math.min(Math.max(months, 1), 36));
  }
}
