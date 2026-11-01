import { Controller, DefaultValuePipe, Delete, Get, HttpCode, Module, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { BudgetsModule } from '../budgets/budgets.module';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications') @ApiBearerAuth()
@Controller('notifications')
class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  /** Revisa las condiciones al momento y devuelve las últimas notificaciones con el total sin leer. */
  @Get()
  @ApiQuery({ name: 'limit', required: false, example: 30 })
  list(@CurrentUser() u: AuthUser, @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number) {
    return this.notifications.list(u.id, Math.min(Math.max(limit, 1), 100));
  }

  @Post('read-all') @HttpCode(200)
  readAll(@CurrentUser() u: AuthUser) {
    return this.notifications.markAllRead(u.id);
  }

  @Post(':id/read') @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(u.id, id);
  }

  @Delete(':id') @HttpCode(204)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.notifications.remove(u.id, id);
  }
}

@Module({ imports: [BudgetsModule], controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
