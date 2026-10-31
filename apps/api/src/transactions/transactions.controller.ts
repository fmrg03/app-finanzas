import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateTransactionDto, ListTransactionsDto, UpdateTransactionDto } from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions') @ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private transactions: TransactionsService) {}

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
