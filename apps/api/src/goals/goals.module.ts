import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsDateString, IsHexColor, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { parseDateOnly, toDateOnly, todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

class CreateGoalDto {
  @ApiProperty({ example: 'Fondo de emergencia' }) @IsString() @MinLength(1) @MaxLength(80)
  name: string;

  @ApiProperty({ example: '1500.00' }) @IsNumberString()
  targetUsd: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-20' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  targetDate?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsHexColor()
  color?: string;
}
class UpdateGoalDto extends PartialType(CreateGoalDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  archived?: boolean;
}
class ContributionDto {
  @ApiProperty({ example: '50.00', description: 'Positivo para aportar, negativo para retirar' }) @IsNumberString()
  amountUsd: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}

const D = Prisma.Decimal;

@Injectable()
class GoalsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const goals = await this.prisma.savingsGoal.findMany({
      where: { userId },
      include: { contributions: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] } },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const today = parseDateOnly(todayLocal());
    return goals.map((g) => {
      const saved = g.contributions.reduce((a, c) => a.add(c.amountUsd), new D(0));
      const remaining = D.max(g.targetUsd.sub(saved), 0);
      // Meses que faltan (fracción incluida) para saber cuánto apartar por mes
      const monthsLeft = g.targetDate ? Math.max((g.targetDate.getTime() - today.getTime()) / (30.44 * 86_400_000), 0) : null;
      const monthlyNeeded = monthsLeft !== null && remaining.gt(0) ? (monthsLeft < 1 ? remaining : remaining.div(monthsLeft)) : null;
      return {
        ...g,
        targetDate: g.targetDate ? toDateOnly(g.targetDate) : null,
        contributions: g.contributions.map((c) => ({ ...c, date: toDateOnly(c.date) })),
        savedUsd: saved.toFixed(2),
        remainingUsd: remaining.toFixed(2),
        pct: Math.min(Math.round(saved.div(g.targetUsd).mul(100).toNumber()), 100),
        monthlyNeededUsd: monthlyNeeded ? monthlyNeeded.toFixed(2) : null,
        overdue: !!g.targetDate && g.targetDate < today && remaining.gt(0),
      };
    });
  }

  async create(userId: string, dto: CreateGoalDto) {
    return this.prisma.savingsGoal.create({
      data: { userId, name: dto.name.trim(), targetUsd: positive(dto.targetUsd), targetDate: dto.targetDate ? parseDateOnly(dto.targetDate) : null, color: dto.color },
    });
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    await this.own(userId, id);
    return this.prisma.savingsGoal.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        targetUsd: dto.targetUsd ? positive(dto.targetUsd) : undefined,
        targetDate: dto.targetDate === undefined ? undefined : dto.targetDate ? parseDateOnly(dto.targetDate) : null,
        color: dto.color,
        ...(dto.archived === undefined ? {} : { archivedAt: dto.archived ? new Date() : null }),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.savingsGoal.delete({ where: { id } });
  }

  async contribute(userId: string, id: string, dto: ContributionDto) {
    await this.own(userId, id);
    const amount = new D(dto.amountUsd);
    if (amount.isZero()) throw new BadRequestException('El monto no puede ser cero');
    return this.prisma.goalContribution.create({
      data: { goalId: id, amountUsd: amount.toDecimalPlaces(2), date: parseDateOnly(dto.date ?? todayLocal()), note: dto.note?.trim() || null },
    });
  }

  async removeContribution(userId: string, id: string, contributionId: string) {
    await this.own(userId, id);
    const { count } = await this.prisma.goalContribution.deleteMany({ where: { id: contributionId, goalId: id } });
    if (!count) throw new NotFoundException('Aporte no encontrado');
  }

  private async own(userId: string, id: string) {
    const g = await this.prisma.savingsGoal.findFirst({ where: { id, userId } });
    if (!g) throw new NotFoundException('Meta no encontrada');
    return g;
  }
}

function positive(v: string) {
  const d = new D(v);
  if (d.lte(0)) throw new BadRequestException('El objetivo debe ser mayor que cero');
  return d.toDecimalPlaces(2);
}

@ApiTags('goals') @ApiBearerAuth()
@Controller('goals')
class GoalsController {
  constructor(private goals: GoalsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.goals.list(u.id); }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateGoalDto) { return this.goals.create(u.id, dto); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateGoalDto) { return this.goals.update(u.id, id, dto); }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.goals.remove(u.id, id); }
  @Post(':id/contributions') contribute(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ContributionDto) { return this.goals.contribute(u.id, id, dto); }
  @Delete(':id/contributions/:cid') @HttpCode(204)
  removeContribution(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('cid') cid: string) { return this.goals.removeContribution(u.id, id, cid); }
}

@Module({ controllers: [GoalsController], providers: [GoalsService] })
export class GoalsModule {}
