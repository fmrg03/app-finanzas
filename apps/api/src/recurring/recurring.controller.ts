import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConfirmRecurringDto, CreateRecurringDto, UpdateRecurringDto } from './recurring.dto';
import { RecurringService } from './recurring.service';

@ApiTags('recurring') @ApiBearerAuth()
@Controller('recurring')
export class RecurringController {
  constructor(private recurring: RecurringService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.recurring.list(u.id);
  }

  @Get('due')
  due(@CurrentUser() u: AuthUser) {
    return this.recurring.due(u.id);
  }

  @Get(':id')
  findOne(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.recurring.findOne(u.id, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(u.id, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateRecurringDto) {
    return this.recurring.update(u.id, id, dto);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConfirmRecurringDto) {
    return this.recurring.confirm(u.id, id, dto);
  }

  @Post(':id/skip') @HttpCode(200)
  skip(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.recurring.skip(u.id, id);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.recurring.remove(u.id, id);
  }
}
