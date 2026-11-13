import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators/admin.decorator';
import { PrismaService } from '../prisma/prisma.service';

/** Días sin un respaldo verificado tras los que se avisa (la PC pudo estar apagada o el respaldo fallando). */
export const BACKUP_STALE_DAYS = 3;

@Injectable()
export class BackupsService {
  constructor(private prisma: PrismaService) {}

  /** Últimas verificaciones de respaldo (las anota el contenedor de respaldos de deploy/casa). */
  async status() {
    const [recent, lastOk] = await Promise.all([
      this.prisma.backupCheck.findMany({ orderBy: { checkedAt: 'desc' }, take: 10 }),
      this.prisma.backupCheck.findFirst({ where: { ok: true }, orderBy: { checkedAt: 'desc' } }),
    ]);
    const present = (c: (typeof recent)[number]) => ({ ...c, sizeBytes: c.sizeBytes === null ? null : Number(c.sizeBytes) });
    const days = lastOk ? Math.floor((Date.now() - lastOk.checkedAt.getTime()) / 86_400_000) : null;
    return {
      /** false si nunca se ha verificado un respaldo (por ejemplo, en desarrollo) */
      configured: recent.length > 0,
      lastOk: lastOk ? present(lastOk) : null,
      daysSinceOk: days,
      stale: days === null ? recent.length > 0 : days >= BACKUP_STALE_DAYS,
      recent: recent.map(present),
    };
  }
}

@ApiTags('backups') @ApiBearerAuth()
@Controller('backups')
class BackupsController {
  constructor(private backups: BackupsService) {}

  @Get('status') @AdminOnly()
  status() { return this.backups.status(); }
}

@Module({ controllers: [BackupsController], providers: [BackupsService] })
export class BackupsModule {}
