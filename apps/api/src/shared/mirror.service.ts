import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDateOnly } from '../common/date.util';
import { displayName, PeopleService } from '../people/people.module';
import { PrismaService } from '../prisma/prisma.service';
import { myShare } from '../transactions/transactions.service';
import { deleteMirrorsOf } from './mirror-cleanup';

const D = Prisma.Decimal;
const usd = (v: Prisma.Decimal) => `$ ${new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))}`;

/**
 * Compras compartidas entre familiares que usan la app. Quien pagó registra la compra; a cada familiar
 * vinculado le aparece una copia de solo lectura: su parte como gasto (sin tocar sus cuentas) y su deuda
 * con quien pagó. Las dos deudas quedan enlazadas y los abonos se copian de un lado al otro.
 */
@Injectable()
export class MirrorService {
  private readonly log = new Logger(MirrorService.name);

  constructor(
    private prisma: PrismaService,
    private people: PeopleService,
  ) {}

  /** Si pagó un familiar que usa la app, le toca registrarlo a él: así no queda duplicado. */
  async assertPayerNotLinked(userId: string, paidByPersonId: string | null | undefined) {
    if (!paidByPersonId) return;
    const p = await this.prisma.person.findFirst({ where: { id: paidByPersonId, userId }, include: { linkedUser: true } });
    if (p?.linkedUser && !p.linkedUser.disabledAt) {
      throw new ConflictException(
        `${p.name} usa la app: pídele que registre la compra desde su cuenta incluyéndote, y te aparecerá automáticamente.`,
      );
    }
  }

  /** Lanza 409 si el reparto es una copia que registró otro familiar. */
  async assertNotMirror(sharedId: string | null | undefined, action: string) {
    if (!sharedId) return;
    const s = await this.prisma.sharedExpense.findUnique({
      where: { id: sharedId },
      select: { mirrorOf: { select: { user: { select: { name: true, email: true } } } } },
    });
    if (s?.mirrorOf) {
      const who = displayName(s.mirrorOf.user);
      throw new ConflictException(`Esta compra la registró ${who}. Para ${action}, pídele a ${who} que lo haga desde su cuenta.`);
    }
  }

  /** Rehace las copias de un reparto (al crearlo o editarlo). */
  async sync(sourceSharedId: string) {
    await this.prisma.$transaction((db) => deleteMirrorsOf(db, sourceSharedId));
    const src = await this.prisma.sharedExpense.findUnique({
      where: { id: sourceSharedId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        participants: { include: { person: { include: { linkedUser: true } } } },
        debts: true,
        transaction: { include: { category: true } },
        plan: { include: { installments: { orderBy: { n: 'asc' } }, category: true } },
      },
    });
    // Solo se copia lo que pagaste tú, y solo a quienes tienen una parte
    if (!src || src.paidByPersonId || src.mirrorOfId) return 0;
    let n = 0;
    for (const part of src.participants) {
      const target = part.person?.linkedUser;
      if (!target || target.disabledAt || part.amountUsd.lte(0)) continue;
      const sourceDebt = src.debts.find((d) => d.personId === part.personId);
      try {
        await this.prisma.$transaction((db) => this.createMirror(db, src, part.amountUsd, target, sourceDebt ?? null));
        n++;
      } catch (e) {
        this.log.warn(`No se pudo copiar el reparto ${src.id} a ${target.email}: ${(e as Error).message}`);
      }
    }
    return n;
  }

  private async createMirror(
    db: Prisma.TransactionClient,
    src: Prisma.SharedExpenseGetPayload<{
      include: {
        user: { select: { id: true; name: true; email: true } };
        transaction: { include: { category: true } };
        plan: { include: { installments: true; category: true } };
      };
    }>,
    share: Prisma.Decimal,
    target: { id: string; name: string | null; email: string },
    sourceDebt: { id: string; description: string | null; dueDate: Date | null } | null,
  ) {
    const owner = src.user;
    const payer = await this.people.ensureLinkedPerson(target.id, owner, db);
    const pct = src.totalUsd.isZero() ? new D(0) : share.div(src.totalUsd).mul(100).toDecimalPlaces(6, D.ROUND_HALF_UP);

    const mirror = await db.sharedExpense.create({
      data: {
        userId: target.id, paidByPersonId: payer.id, splitMode: 'AMOUNT', totalUsd: src.totalUsd, mirrorOfId: src.id,
        participants: {
          create: [
            { personId: null, pct, amountUsd: share },
            { personId: payer.id, pct: new D(100).sub(pct), amountUsd: src.totalUsd.sub(share) },
          ],
        },
      },
    });
    const debt = await db.debt.create({
      data: {
        userId: target.id, direction: 'I_OWE', person: payer.name, personId: payer.id, sharedId: mirror.id,
        description: sourceDebt?.description ?? null, currency: 'USD', amount: share, dueDate: sourceDebt?.dueDate ?? null,
        linkedDebtId: sourceDebt?.id ?? null,
      },
    });
    if (sourceDebt) await db.debt.update({ where: { id: sourceDebt.id }, data: { linkedDebtId: debt.id } });

    const category = await this.sameCategory(db, target.id, src.transaction?.category ?? src.plan?.category ?? null);
    let what: string;
    let link: string;
    if (src.transaction) {
      const t = src.transaction;
      await db.transaction.create({
        data: {
          userId: target.id, accountId: null, categoryId: category, type: 'EXPENSE', date: t.date, description: t.description, tags: [],
          originalCurrency: t.originalCurrency, originalAmount: t.originalAmount, amountUsd: t.amountUsd, amountVes: t.amountVes,
          rateUsed: t.rateUsed, rateSource: t.rateSource, exchangeRateId: t.exchangeRateId,
          ...myShare(t.amountUsd, t.amountVes, pct, share), sharedId: mirror.id,
        },
      });
      what = t.description || t.category?.name || 'una compra';
      link = '/movimientos';
    } else if (src.plan) {
      const p = src.plan;
      const plan = await db.installmentPlan.create({
        data: {
          userId: target.id, provider: p.provider, store: p.store, description: p.description, categoryId: category,
          purchaseDate: p.purchaseDate, totalUsd: p.totalUsd, downPaymentUsd: p.downPaymentUsd, count: p.count, frequency: p.frequency,
          accountId: null, rateSource: p.rateSource, rateUsed: p.rateUsed, sharedId: mirror.id,
          installments: { create: p.installments.map((i) => ({ n: i.n, dueDate: i.dueDate, amountUsd: i.amountUsd })) },
        },
      });
      // La inicial cuenta el día de la compra; cada cuota se registra sola en su fecha
      if (p.downPaymentUsd.gt(0)) {
        const ves = p.downPaymentUsd.mul(p.rateUsed).toDecimalPlaces(2, D.ROUND_HALF_UP);
        await db.transaction.create({
          data: {
            userId: target.id, accountId: null, categoryId: category, type: 'EXPENSE', date: p.purchaseDate,
            description: `${p.provider}: ${p.description} (inicial)`, tags: [], source: 'INSTALLMENT', externalId: `plan:${plan.id}:down`,
            originalCurrency: 'USD', originalAmount: p.downPaymentUsd, amountUsd: p.downPaymentUsd, amountVes: ves,
            rateUsed: p.rateUsed, rateSource: p.rateSource, ...myShare(p.downPaymentUsd, ves, pct), installmentPlanId: plan.id,
          },
        });
      }
      what = `${p.description} (${p.provider})`;
      link = '/deudas?tab=cuotas';
    } else {
      return;
    }
    await db.notification.create({
      data: {
        userId: target.id, type: 'SHARED_WITH_ME', dedupeKey: `shared:${mirror.id}`, link,
        title: `${displayName(owner)} compartió una compra contigo`,
        body: `${what}: tu parte es ${usd(share)}. Quedó como deuda con ${displayName(owner)}${src.transaction ? ` del ${toDateOnly(src.transaction.date).split('-').reverse().join('/')}` : ''}.`,
      },
    });
  }

  /** La categoría del familiar con el mismo nombre y tipo, si la tiene. */
  private async sameCategory(db: Prisma.TransactionClient, userId: string, cat: { name: string; type: 'INCOME' | 'EXPENSE' } | null) {
    if (!cat) return null;
    const found = await db.category.findFirst({ where: { userId, type: cat.type, name: { equals: cat.name, mode: 'insensitive' } }, select: { id: true } });
    return found?.id ?? null;
  }
}
