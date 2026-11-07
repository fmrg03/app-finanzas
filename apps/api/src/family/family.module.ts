import {
  BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, GoneException, HttpCode, Injectable, Module,
  NotFoundException, Param, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes } from 'crypto';
import { AdminOnly } from '../auth/decorators/admin.decorator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { AcceptInvitationDto } from '../auth/dto/auth.dto';
import { CategoriesModule } from '../categories/categories.module';
import { CategoriesService } from '../categories/categories.service';
import { displayName, PeopleModule, PeopleService } from '../people/people.module';
import { PrismaService } from '../prisma/prisma.service';

class CreateInvitationDto {
  @ApiPropertyOptional({ example: 'Ana', description: 'Nombre sugerido; la persona lo puede cambiar' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60)
  name?: string;
}

class UpdateMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  disabled?: boolean;

  @ApiPropertyOptional({ enum: ['ADMIN', 'MEMBER'] }) @IsOptional() @IsEnum({ ADMIN: 'ADMIN', MEMBER: 'MEMBER' })
  role?: 'ADMIN' | 'MEMBER';
}

/** Un enlace de invitación o de nueva contraseña vale 48 horas y una sola vez. */
export const INVITATION_TTL_HOURS = 48;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class FamilyService {
  constructor(
    private prisma: PrismaService,
    private categories: CategoriesService,
    private people: PeopleService,
  ) {}

  async members(me: AuthUser) {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, name: true, role: true, disabledAt: true, createdAt: true },
    });
    return users.map((u) => ({ ...u, displayName: displayName(u), me: u.id === me.id }));
  }

  async updateMember(me: AuthUser, id: string, dto: UpdateMemberDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Familiar no encontrado');
    if (id === me.id && (dto.disabled || dto.role === 'MEMBER')) {
      throw new BadRequestException('No puedes desactivarte ni quitarte el rol de administrador a ti mismo');
    }
    await this.prisma.user.update({
      where: { id },
      data: {
        role: dto.role,
        ...(dto.disabled === undefined ? {} : { disabledAt: dto.disabled ? new Date() : null }),
        // Desactivar cierra su sesión
        ...(dto.disabled ? { refreshTokenHash: null } : {}),
      },
    });
    return (await this.members(me)).find((u) => u.id === id);
  }

  /** Crea un enlace de invitación. El token solo se devuelve aquí: se guarda su hash. */
  async invite(me: AuthUser, dto: CreateInvitationDto) {
    return this.newToken({ kind: 'INVITE', name: dto.name?.trim() || null, createdById: me.id });
  }

  /** Enlace para que un familiar ponga una contraseña nueva. Invalida los anteriores. */
  async resetLink(me: AuthUser, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Familiar no encontrado');
    if (user.disabledAt) throw new BadRequestException('Activa la cuenta antes de restablecer su contraseña');
    await this.prisma.invitation.deleteMany({ where: { kind: 'RESET', userId, usedAt: null } });
    return this.newToken({ kind: 'RESET', name: displayName(user), userId, createdById: me.id });
  }

  async pending() {
    const list = await this.prisma.invitation.findMany({
      where: { kind: 'INVITE', usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, expiresAt: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
    });
    return list.map(({ createdBy, ...i }) => ({ ...i, createdBy: displayName(createdBy) }));
  }

  async revoke(id: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { id } });
    if (!inv || inv.usedAt) throw new NotFoundException('Invitación no encontrada');
    await this.prisma.invitation.delete({ where: { id } });
  }

  /** Lo que muestra la página pública del enlace. */
  async info(token: string) {
    const inv = await this.valid(token);
    return {
      kind: inv.kind,
      name: inv.kind === 'RESET' ? displayName(inv.user!) : inv.name,
      email: inv.kind === 'RESET' ? inv.user!.email : null,
      invitedBy: displayName(inv.createdBy),
      expiresAt: inv.expiresAt,
    };
  }

  /**
   * Usa el enlace: crea la cuenta del familiar (con categorías básicas y vinculado con quien lo invitó)
   * o cambia la contraseña. Devuelve el usuario para iniciar su sesión.
   */
  async accept(token: string, dto: AcceptInvitationDto) {
    const inv = await this.valid(token);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    if (inv.kind === 'RESET') {
      const user = await this.prisma.$transaction(async (db) => {
        await this.markUsed(db, inv.id);
        return db.user.update({ where: { id: inv.userId! }, data: { passwordHash, refreshTokenHash: null } });
      });
      return user;
    }

    if (!dto.email) throw new BadRequestException('Indica tu correo');
    if (!dto.name?.trim()) throw new BadRequestException('Indica tu nombre');
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Ese correo ya tiene una cuenta');

    const user = await this.prisma.$transaction(async (db) => {
      await this.markUsed(db, inv.id);
      const created = await db.user.create({ data: { email, passwordHash, name: dto.name!.trim(), role: 'MEMBER' } });
      // Quedan vinculados en Personas, para compartir compras sin configurar nada
      await this.people.ensureLinkedPerson(inv.createdById, created, db);
      await this.people.ensureLinkedPerson(created.id, inv.createdBy, db);
      await db.notification.create({
        data: {
          userId: inv.createdById, type: 'FAMILY_JOINED', dedupeKey: `family:${created.id}`,
          title: `${displayName(created)} se unió a Finanzas`,
          body: 'Ya pueden compartir compras: lo que pagues por esta persona le aparecerá en su cuenta.',
          link: '/deudas?tab=personas',
        },
      });
      return created;
    });
    await this.categories.seedDefaults(user.id).catch(() => undefined);
    return user;
  }

  private async valid(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { createdBy: { select: { id: true, name: true, email: true } }, user: { select: { id: true, name: true, email: true, disabledAt: true } } },
    });
    if (!inv) throw new NotFoundException('Este enlace no existe. Pide uno nuevo.');
    if (inv.usedAt) throw new GoneException('Este enlace ya se usó. Pide uno nuevo si lo necesitas.');
    if (inv.expiresAt < new Date()) throw new GoneException('Este enlace venció. Pide uno nuevo.');
    if (inv.kind === 'RESET' && (!inv.user || inv.user.disabledAt)) throw new ForbiddenException('Esta cuenta está desactivada');
    return inv;
  }

  /** Marca el enlace como usado solo si nadie lo usó antes (dos pestañas a la vez). */
  private async markUsed(db: Pick<PrismaService, 'invitation'>, id: string) {
    const r = await db.invitation.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    if (!r.count) throw new GoneException('Este enlace ya se usó');
  }

  private async newToken(data: { kind: 'INVITE' | 'RESET'; name: string | null; userId?: string; createdById: string }) {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_HOURS * 3_600_000);
    const inv = await this.prisma.invitation.create({ data: { ...data, tokenHash: sha256(token), expiresAt } });
    return { id: inv.id, kind: inv.kind, token, path: `/invitacion/${token}`, expiresAt };
  }
}

@ApiTags('family') @ApiBearerAuth()
@Controller('family')
class FamilyController {
  constructor(private family: FamilyService) {}

  @Get('members') members(@CurrentUser() u: AuthUser) { return this.family.members(u); }

  @AdminOnly() @Patch('members/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateMemberDto) { return this.family.updateMember(u, id, dto); }

  @AdminOnly() @Post('members/:id/reset-link')
  reset(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.family.resetLink(u, id); }

  @AdminOnly() @Get('invitations') pending() { return this.family.pending(); }

  @AdminOnly() @Post('invitations')
  invite(@CurrentUser() u: AuthUser, @Body() dto: CreateInvitationDto) { return this.family.invite(u, dto); }

  @AdminOnly() @Delete('invitations/:id') @HttpCode(204)
  revoke(@Param('id') id: string) { return this.family.revoke(id); }
}

@Module({
  imports: [CategoriesModule, PeopleModule],
  controllers: [FamilyController],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
