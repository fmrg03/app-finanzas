import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UseGuards, applyDecorators } from '@nestjs/common';
import { AuthUser } from './current-user.decorator';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (user?.role !== 'ADMIN') throw new ForbiddenException('Solo quien administra la app puede hacer esto');
    return true;
  }
}

/** Solo para el administrador de la familia (se evalúa después del guard JWT global). */
export const AdminOnly = () => applyDecorators(UseGuards(AdminGuard));
