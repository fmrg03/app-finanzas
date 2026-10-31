import { Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@ApiTags('accounts') @ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private accounts: AccountsService) {}

  @Get()
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  findAll(@CurrentUser() u: AuthUser, @Query('includeArchived', new ParseBoolPipe({ optional: true })) includeArchived?: boolean) {
    return this.accounts.findAll(u.id, includeArchived);
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
