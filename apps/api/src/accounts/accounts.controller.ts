import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, ReconcileDto, UpdateAccountDto } from './dto/account.dto';

@ApiTags('accounts') @ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private accounts: AccountsService) {}

  @Get()
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  findAll(@CurrentUser() u: AuthUser, @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean) {
    return this.accounts.findAll(u.id, includeArchived);
  }

  @Post(':id/reconcile')
  reconcile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReconcileDto) {
    return this.accounts.reconcile(u.id, id, dto);
  }

  @Get(':id/reconciliations')
  reconciliations(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.accounts.reconciliations(u.id, id);
  }

  @Delete('reconciliations/:recId') @HttpCode(204)
  removeReconciliation(@CurrentUser() u: AuthUser, @Param('recId') recId: string) {
    return this.accounts.removeReconciliation(u.id, recId);
  }

  @Get(':id/summary')
  @ApiQuery({ name: 'from', example: '2026-11-01' }) @ApiQuery({ name: 'to', example: '2026-11-30' })
  summary(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) throw new BadRequestException('Indica from y to (AAAA-MM-DD)');
    return this.accounts.summary(u.id, id, from, to);
  }

  @Get(':id')
  findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.accounts.findOne(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounts.create(u.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accounts.update(u.id, id, dto);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.accounts.remove(u.id, id);
  }
}
