import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

class CreatePersonDto {
  @ApiProperty({ example: 'Ana' }) @IsString() @MinLength(1) @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ nullable: true, description: 'Familiar que usa la app: lo que compartes con esta persona aparece en su cuenta' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  linkedUserId?: string | null;

  @ApiPropertyOptional({ example: '+58 412 123 4567', nullable: true, description: 'WhatsApp con código de país' })
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsString() @Matches(/^[+\d\s()-]{7,25}$/, { message: 'Teléfono inválido' })
  phone?: string | null;
}
class UpdatePersonDto extends PartialType(CreatePersonDto) {}

const D = Prisma.Decimal;

/** Nombre para mostrar de un usuario: el que eligió o la parte local del correo. */
export const displayName = (u: { name: string | null; email: string }) => u.name?.trim() || u.email.split('@')[0];

/** Solo dígitos. Un número venezolano local (0412…) se pasa a formato internacional (58412…). */
export function normalizePhone(phone?: string | null) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = '58' + d.slice(1);
  if (d.length < 8 || d.length > 15) throw new BadRequestException('El teléfono debe tener entre 8 y 15 dígitos, con código de país');
  return d;
}

@Injectable()
export class PeopleService {
  constructor(private prisma: PrismaService) {}

  /** Personas con lo que te deben y lo que les debes (pendiente), por moneda. */
  async list(userId: string) {
    const people = await this.prisma.person.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: {
        debts: { where: { settledAt: null }, include: { payments: { select: { amount: true } } } },
        linkedUser: { select: { id: true, name: true, email: true, disabledAt: true } },
      },
    });
    return people.map(({ debts, ...p }) => {
      const sums = { owedToMeUsd: new D(0), owedToMeVes: new D(0), iOweUsd: new D(0), iOweVes: new D(0) };
      for (const d of debts) {
        const rem = D.max(d.amount.sub(d.payments.reduce((a, x) => a.add(x.amount), new D(0))), 0);
        const key = `${d.direction === 'OWED_TO_ME' ? 'owedToMe' : 'iOwe'}${d.currency === 'USD' ? 'Usd' : 'Ves'}` as keyof typeof sums;
        sums[key] = sums[key].add(rem);
      }
      return {
        ...p,
        openDebts: debts.length,
        owedToMeUsd: sums.owedToMeUsd.toFixed(2), owedToMeVes: sums.owedToMeVes.toFixed(2),
        iOweUsd: sums.iOweUsd.toFixed(2), iOweVes: sums.iOweVes.toFixed(2),
      };
    });
  }

  async create(userId: string, dto: CreatePersonDto) {
    const name = dto.name.trim();
    const existing = await this.findByName(userId, name);
    if (existing) throw new ConflictException(`Ya tienes a ${existing.name} en tus personas`);
    const linkedUserId = dto.linkedUserId ? await this.assertLinkable(userId, dto.linkedUserId) : null;
    return this.prisma.person.create({ data: { userId, name, phone: normalizePhone(dto.phone), linkedUserId } });
  }

  async update(userId: string, id: string, dto: UpdatePersonDto) {
    const p = await this.own(userId, id);
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== p.name.toLowerCase()) {
      const other = await this.findByName(userId, name);
      if (other) throw new ConflictException(`Ya tienes a ${other.name} en tus personas`);
    }
    let linkedUserId: string | null | undefined;
    if (dto.linkedUserId !== undefined) linkedUserId = dto.linkedUserId ? await this.assertLinkable(userId, dto.linkedUserId, id) : null;
    return this.prisma.$transaction(async (db) => {
      const updated = await db.person.update({
        where: { id },
        data: { name, phone: dto.phone === undefined ? undefined : normalizePhone(dto.phone), linkedUserId },
      });
      // Las deudas guardan el nombre para mostrarlo: se mantiene al día
      if (name) await db.debt.updateMany({ where: { personId: id }, data: { person: name } });
      return updated;
    });
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    const used = await this.prisma.sharedParticipant.count({ where: { personId: id } }) + (await this.prisma.sharedExpense.count({ where: { paidByPersonId: id } }));
    if (used) throw new ConflictException('Esta persona participa en movimientos compartidos; no se puede borrar.');
    await this.prisma.person.delete({ where: { id } });
  }

  /** Busca por nombre sin distinguir mayúsculas; si no existe la crea. Para deudas escritas a mano. */
  async resolveByName(userId: string, name: string, db: Prisma.TransactionClient = this.prisma) {
    const clean = name.trim();
    const found = await db.person.findFirst({ where: { userId, name: { equals: clean, mode: 'insensitive' } } });
    return found ?? db.person.create({ data: { userId, name: clean } });
  }

  /**
   * La persona que representa a `target` dentro de la cuenta de `ownerId`, vinculada a su usuario.
   * Reutiliza una persona con el mismo nombre si todavía no estaba vinculada a nadie.
   */
  async ensureLinkedPerson(ownerId: string, target: { id: string; name: string | null; email: string }, db: Prisma.TransactionClient = this.prisma) {
    const linked = await db.person.findUnique({ where: { userId_linkedUserId: { userId: ownerId, linkedUserId: target.id } } });
    if (linked) return linked;
    const name = displayName(target);
    const same = await db.person.findFirst({ where: { userId: ownerId, name: { equals: name, mode: 'insensitive' } } });
    if (same && !same.linkedUserId) return db.person.update({ where: { id: same.id }, data: { linkedUserId: target.id } });
    const finalName = same ? `${name} (${target.email.split('@')[0]})` : name;
    return db.person.create({ data: { userId: ownerId, name: finalName, linkedUserId: target.id } });
  }

  private async assertLinkable(userId: string, linkedUserId: string, personId?: string) {
    if (linkedUserId === userId) throw new BadRequestException('No puedes vincular una persona contigo mismo');
    const u = await this.prisma.user.findUnique({ where: { id: linkedUserId } });
    if (!u || u.disabledAt) throw new BadRequestException('Ese familiar no existe o está desactivado');
    const other = await this.prisma.person.findFirst({ where: { userId, linkedUserId, ...(personId ? { NOT: { id: personId } } : {}) } });
    if (other) throw new ConflictException(`${other.name} ya está vinculada a ${displayName(u)}`);
    return linkedUserId;
  }

  async own(userId: string, id: string) {
    const p = await this.prisma.person.findFirst({ where: { id, userId } });
    if (!p) throw new NotFoundException('Persona no encontrada');
    return p;
  }

  private findByName(userId: string, name: string) {
    return this.prisma.person.findFirst({ where: { userId, name: { equals: name, mode: 'insensitive' } } });
  }
}

@ApiTags('people') @ApiBearerAuth()
@Controller('people')
class PeopleController {
  constructor(private people: PeopleService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.people.list(u.id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreatePersonDto) { return this.people.create(u.id, dto); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdatePersonDto) { return this.people.update(u.id, id, dto); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.people.remove(u.id, id); }
}

@Module({ controllers: [PeopleController], providers: [PeopleService], exports: [PeopleService] })
export class PeopleModule {}
