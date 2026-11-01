import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, LoginDto, RegisterDto, UpdateMeDto } from './dto/auth.dto';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (this.config.get('ALLOW_REGISTRATION') !== 'true') {
      throw new ForbiddenException('El registro está deshabilitado');
    }
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Ese email ya está registrado');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });
    return this.issueTokens(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('Credenciales inválidas');
    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o vencido');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || user.refreshTokenHash !== sha256(refreshToken)) {
      throw new UnauthorizedException('Refresh token inválido o vencido');
    }
    return this.issueTokens(user.id, user.email); // rotación: el anterior queda inválido
  }

  /** Invalida la sesión a la que pertenece este refresh token (si es válido). */
  async logoutWithRefresh(refreshToken?: string) {
    if (!refreshToken) return;
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(refreshToken, { secret: this.config.getOrThrow('JWT_REFRESH_SECRET') });
      await this.prisma.user.updateMany({ where: { id: sub, refreshTokenHash: sha256(refreshToken) }, data: { refreshTokenHash: null } });
    } catch {
      // Token vencido o inválido: no hay sesión que cerrar
    }
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, defaultCurrency: true, defaultRateSource: true, createdAt: true },
    });
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({ where: { id: userId }, data: { defaultCurrency: dto.defaultCurrency, defaultRateSource: dto.defaultRateSource } });
    return this.me(userId);
  }

  /** Cambia la contraseña y emite tokens nuevos: las demás sesiones quedan cerradas. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('La contraseña actual no es correcta');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return this.issueTokens(user.id, user.email);
  }

  private async issueTokens(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
        expiresIn: Number(this.config.get('JWT_ACCESS_TTL_SECONDS') ?? 900),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, jti: randomUUID() },
      {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
        expiresIn: Number(this.config.get('JWT_REFRESH_TTL_SECONDS') ?? 604800),
      },
    );
    // SHA-256 y no bcrypt: bcrypt solo mira los primeros 72 bytes y un JWT empieza casi igual siempre
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: sha256(refreshToken) },
    });
    return { accessToken, refreshToken };
  }
}
