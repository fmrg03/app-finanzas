import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { FamilyService } from '../family/family.module';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, UpdateMeDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { AuthUser, CurrentUser } from './decorators/current-user.decorator';

export const REFRESH_COOKIE = 'fz_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
    private family: FamilyService,
  ) {}

  // El refresh token viaja solo en una cookie httpOnly: el JavaScript del navegador no puede leerlo
  private cookieOptions(): CookieOptions {
    const secure = this.config.get('COOKIE_SECURE') ? this.config.get('COOKIE_SECURE') === 'true' : process.env.NODE_ENV === 'production';
    return { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' };
  }

  private withCookie(res: Response, tokens: { accessToken: string; refreshToken: string }) {
    const ttl = Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 604800);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...this.cookieOptions(), maxAge: ttl * 1000 });
    return { accessToken: tokens.accessToken };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Public() @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.register(dto));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public() @HttpCode(200) @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.login(dto));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public() @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    // La cookie es lo normal; el body queda para herramientas como Swagger o curl
    const token = req.cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
    // Sin cookie no hay nada que reintentar: el navegador lo distingue de una cookie rotada por otra pestaña
    if (!token) throw new UnauthorizedException({ message: 'No hay sesión', code: 'NO_SESSION' });
    try {
      return this.withCookie(res, await this.auth.refresh(token ?? ''));
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw e;
    }
  }

  /** Página pública de un enlace de invitación o de nueva contraseña. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Public() @Get('invitations/:token')
  invitation(@Param('token') token: string) {
    return this.family.info(token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public() @HttpCode(200) @Post('invitations/:token/accept')
  async accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.family.accept(token, dto);
    return this.withCookie(res, await this.auth.issueTokens(user.id, user.email));
  }

  @Public() @HttpCode(200) @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutWithRefresh(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return { ok: true };
  }

  @ApiBearerAuth() @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiBearerAuth() @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(user.id, dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth() @HttpCode(200) @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    return this.withCookie(res, await this.auth.changePassword(user.id, dto));
  }
}
