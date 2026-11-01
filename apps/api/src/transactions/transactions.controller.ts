import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { todayLocal } from '../common/date.util';
import { ExportService } from './export.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateTransactionDto, ListTransactionsDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions') @ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(
    private transactions: TransactionsService,
    private exporter: ExportService,
  ) {}

  /** Descarga en Excel (.xlsx) con los mismos filtros del listado. */
  @Get('export')
  async export(@CurrentUser() u: AuthUser, @Query() q: ListTransactionsDto, @Res() res: Response) {
    const where = await this.transactions.buildWhere(u.id, q);
    const buf = await this.exporter.xlsx(u.id, where, q.from, q.to);
    const name = `finanzas_${q.from ?? 'inicio'}_${q.to ?? todayLocal()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListTransactionsDto) {
    return this.transactions.list(u.id, q);
  }

  @Get('tags')
  tags(@CurrentUser() u: AuthUser) {
    return this.transactions.tags(u.id);
  }

  @Get(':id')
  findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.transactions.findOne(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTransactionDto) {
    return this.transactions.create(u.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateTransactionDto) {
    return this.transactions.update(u.id, id, dto);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.transactions.remove(u.id, id);
  }
}
