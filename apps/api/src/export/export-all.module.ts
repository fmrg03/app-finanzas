import { Controller, Get, Injectable, Module, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { Response } from 'express';
import { AccountsModule } from '../accounts/accounts.module';
import { AccountsService } from '../accounts/accounts.service';
import { AuthUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService, styleHeader } from '../transactions/export.service';
import { TransactionsModule } from '../transactions/transactions.module';

const MONEY = '#,##0.00';
const DATE = 'dd/mm/yyyy';
const ACCOUNT = { CASH: 'Efectivo', BANK: 'Banco', CARD: 'Tarjeta', WALLET: 'Billetera digital' } as const;
const FREQ = { WEEKLY: 'Semanal', MONTHLY: 'Mensual', QUARTERLY: 'Trimestral', SEMIANNUAL: 'Semestral', YEARLY: 'Anual' } as Record<string, string>;
const INST_FREQ = { DAYS_14: 'Cada 14 días', DAYS_15: 'Cada 15 días', MONTHLY: 'Mensual' } as const;
const cur = (c: string) => (c === 'USD' ? 'USD' : 'Bs');
// Excel guarda fechas sin zona: mediodía UTC para que nunca caiga en el día anterior
const day = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 12 * 3_600_000) : null);
const n = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));

type Col = { header: string; key: string; width: number; money?: boolean; date?: boolean };

@Injectable()
export class ExportAllService {
  constructor(private prisma: PrismaService, private movements: ExportService, private accounts: AccountsService) {}

  /** Todo lo tuyo en un solo Excel, una hoja por tema. */
  async xlsx(userId: string) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Finanzas';
    wb.created = new Date();
    const sheet = (name: string, cols: Col[], rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : c.date ? { numFmt: DATE } : {} }));
      rows.forEach((r) => ws.addRow(r));
      styleHeader(ws);
      if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };
      return ws;
    };

    const [accounts, user, categories, budgets, recurring, goals, debts, plans, people, rates, recs] = await Promise.all([
      this.accounts.findAll(userId, true),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }),
      this.prisma.category.findMany({ where: { userId }, include: { parent: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
      this.prisma.budget.findMany({ where: { userId }, include: { category: true } }),
      this.prisma.recurring.findMany({ where: { userId }, include: { account: true, category: true }, orderBy: { nextDate: 'asc' } }),
      this.prisma.savingsGoal.findMany({ where: { userId }, include: { contributions: { orderBy: { date: 'asc' } } } }),
      this.prisma.debt.findMany({ where: { userId }, include: { payments: { include: { account: true }, orderBy: { date: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.installmentPlan.findMany({ where: { userId }, include: { installments: { orderBy: { n: 'asc' } }, account: true }, orderBy: { purchaseDate: 'asc' } }),
      this.prisma.person.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      this.prisma.exchangeRate.findMany({ orderBy: [{ date: 'desc' }, { source: 'asc' }], take: 2000 }),
      this.prisma.reconciliation.findMany({ where: { account: { userId } }, include: { account: true }, orderBy: { date: 'asc' } }),
    ]);

    // Portada
    const info = wb.addWorksheet('Resumen');
    info.columns = [{ width: 28 }, { width: 40 }];
    info.addRow(['Finanzas: respaldo completo']).font = { bold: true, size: 14 };
    info.addRow(['Usuario', user.name ? `${user.name} (${user.email})` : user.email]);
    info.addRow(['Generado', todayLocal().split('-').reverse().join('/')]);
    info.addRow([]);
    info.addRow(['Cuenta', 'Saldo']).font = { bold: true };
    for (const a of accounts.filter((x) => !x.archivedAt)) {
      const r = info.addRow([a.name, Number(a.balance)]);
      r.getCell(2).numFmt = a.currency === 'USD' ? '"$" #,##0.00' : '"Bs" #,##0.00';
    }
    info.addRow([]);
    info.addRow(['Hojas: Movimientos, Transferencias, Cuentas, Categorías, Presupuestos, Recurrentes, Metas, Deudas, Abonos, Cuotas, Personas, Conciliaciones y Tasas.']);

    await this.movements.addMovements(wb, userId, { userId });

    sheet('Cuentas', [
      { header: 'Nombre', key: 'name', width: 20 }, { header: 'Tipo', key: 'type', width: 16 }, { header: 'Moneda', key: 'cur', width: 8 },
      { header: 'Saldo inicial', key: 'initial', width: 14, money: true }, { header: 'Saldo actual', key: 'balance', width: 14, money: true },
      { header: 'Apartado', key: 'reserved', width: 12, money: true }, { header: 'Creada', key: 'created', width: 12, date: true },
      { header: 'Archivada', key: 'archived', width: 12, date: true },
    ], accounts.map((a) => ({
      name: a.name, type: ACCOUNT[a.type], cur: cur(a.currency), initial: Number(a.initialBalance), balance: Number(a.balance),
      reserved: Number(a.reserved ?? 0), created: day(a.createdAt), archived: day(a.archivedAt ? new Date(a.archivedAt) : null),
    })));

    sheet('Categorías', [
      { header: 'Tipo', key: 'type', width: 9 }, { header: 'Categoría', key: 'cat', width: 20 }, { header: 'Subcategoría', key: 'sub', width: 20 },
      { header: 'Tasa por defecto', key: 'rate', width: 15 },
    ], categories.map((c) => ({
      type: c.type === 'INCOME' ? 'Ingreso' : 'Gasto', cat: c.parent?.name ?? c.name, sub: c.parent ? c.name : '', rate: c.defaultRateSource ?? '',
    })));

    sheet('Presupuestos', [
      { header: 'Categoría', key: 'cat', width: 22 }, { header: 'Tope mensual USD', key: 'amount', width: 16, money: true },
    ], budgets.map((b) => ({ cat: b.category.name, amount: n(b.amountUsd) })));

    sheet('Recurrentes', [
      { header: 'Descripción', key: 'desc', width: 28 }, { header: 'Tipo', key: 'type', width: 9 }, { header: 'Cuenta', key: 'acc', width: 18 },
      { header: 'Categoría', key: 'cat', width: 18 }, { header: 'Moneda', key: 'cur', width: 8 }, { header: 'Monto', key: 'amount', width: 13, money: true },
      { header: 'Frecuencia', key: 'freq', width: 12 }, { header: 'Próxima', key: 'next', width: 12, date: true },
      { header: 'Termina', key: 'end', width: 12, date: true }, { header: 'Automático', key: 'auto', width: 11 },
      { header: 'Apartado mensual', key: 'reserve', width: 16 }, { header: 'Activo', key: 'active', width: 8 },
    ], recurring.map((r) => ({
      desc: r.description, type: r.type === 'INCOME' ? 'Ingreso' : 'Gasto', acc: r.account.name, cat: r.category?.name ?? '', cur: cur(r.currency),
      amount: n(r.amount), freq: FREQ[r.frequency] ?? r.frequency, next: day(r.nextDate), end: day(r.endDate),
      auto: r.autoCreate ? 'Sí' : 'No', reserve: r.reserve ? 'Sí' : 'No', active: r.active ? 'Sí' : 'No',
    })));

    sheet('Metas', [
      { header: 'Meta', key: 'name', width: 22 }, { header: 'Objetivo USD', key: 'target', width: 14, money: true },
      { header: 'Ahorrado USD', key: 'saved', width: 14, money: true }, { header: 'Fecha meta', key: 'date', width: 12, date: true },
      { header: 'Aporte', key: 'cDate', width: 12, date: true }, { header: 'Monto aporte USD', key: 'cAmount', width: 16, money: true },
      { header: 'Nota', key: 'note', width: 24 },
    ], goals.flatMap((g): Record<string, unknown>[] => {
      const saved = g.contributions.reduce((a, c) => a + Number(c.amountUsd), 0);
      const head = { name: g.name, target: n(g.targetUsd), saved, date: day(g.targetDate) };
      return g.contributions.length
        ? g.contributions.map((c, i) => ({ ...(i === 0 ? head : { name: g.name }), cDate: day(c.date), cAmount: n(c.amountUsd), note: c.note ?? '' }))
        : [head];
    }));

    const debtRows = debts.map((d) => {
      const paid = d.payments.reduce((a, p) => a + Number(p.amount), 0);
      return {
        dir: d.direction === 'I_OWE' ? 'Debo' : 'Me deben', person: d.person, desc: d.description ?? '', cur: cur(d.currency), amount: n(d.amount),
        paid, rest: Math.max(Number(d.amount) - paid, 0), due: day(d.dueDate), state: d.settledAt ? 'Saldada' : 'Pendiente',
        origin: d.sharedId ? 'Compra compartida' : d.linkedDebtId ? 'Con familiar' : '',
      };
    });
    sheet('Deudas', [
      { header: 'Sentido', key: 'dir', width: 10 }, { header: 'Persona', key: 'person', width: 16 }, { header: 'Descripción', key: 'desc', width: 28 },
      { header: 'Moneda', key: 'cur', width: 8 }, { header: 'Monto', key: 'amount', width: 13, money: true }, { header: 'Abonado', key: 'paid', width: 13, money: true },
      { header: 'Pendiente', key: 'rest', width: 13, money: true }, { header: 'Vence', key: 'due', width: 12, date: true },
      { header: 'Estado', key: 'state', width: 10 }, { header: 'Origen', key: 'origin', width: 18 },
    ], debtRows);

    sheet('Abonos', [
      { header: 'Fecha', key: 'date', width: 12, date: true }, { header: 'Persona', key: 'person', width: 16 }, { header: 'Deuda', key: 'debt', width: 28 },
      { header: 'Sentido', key: 'dir', width: 10 }, { header: 'Moneda', key: 'cur', width: 8 }, { header: 'Monto', key: 'amount', width: 13, money: true },
      { header: 'Cuenta', key: 'acc', width: 16 }, { header: 'En la cuenta', key: 'accAmount', width: 14, money: true }, { header: 'Nota', key: 'note', width: 24 },
    ], debts.flatMap((d) => d.payments.map((p) => ({
      date: day(p.date), person: d.person, debt: d.description ?? '', dir: d.direction === 'I_OWE' ? 'Pagué' : 'Me pagaron', cur: cur(d.currency),
      amount: n(p.amount), acc: p.account?.name ?? '', accAmount: n(p.accountAmount), note: p.note ?? '',
    }))));

    sheet('Cuotas', [
      { header: 'Compra', key: 'desc', width: 26 }, { header: 'Proveedor', key: 'prov', width: 14 }, { header: 'Fecha compra', key: 'pdate', width: 12, date: true },
      { header: 'Total USD', key: 'total', width: 12, money: true }, { header: 'Inicial USD', key: 'down', width: 12, money: true },
      { header: 'Frecuencia', key: 'freq', width: 13 }, { header: 'Cuota', key: 'n', width: 8 }, { header: 'Vence', key: 'due', width: 12, date: true },
      { header: 'Monto USD', key: 'amount', width: 12, money: true }, { header: 'Estado', key: 'state', width: 10 },
    ], plans.flatMap((p) => p.installments.map((i) => ({
      desc: p.description, prov: p.provider, pdate: day(p.purchaseDate), total: n(p.totalUsd), down: n(p.downPaymentUsd), freq: INST_FREQ[p.frequency],
      n: `${i.n}/${p.count}`, due: day(i.dueDate), amount: n(i.amountUsd), state: i.transactionId ? 'Pagada' : 'Pendiente',
    }))));

    sheet('Personas', [
      { header: 'Nombre', key: 'name', width: 20 }, { header: 'WhatsApp', key: 'phone', width: 18 }, { header: 'Usa la app', key: 'linked', width: 11 },
    ], people.map((p) => ({ name: p.name, phone: p.phone ? `+${p.phone}` : '', linked: p.linkedUserId ? 'Sí' : 'No' })));

    sheet('Conciliaciones', [
      { header: 'Fecha', key: 'date', width: 12, date: true }, { header: 'Cuenta', key: 'acc', width: 18 },
      { header: 'Saldo real', key: 'real', width: 14, money: true }, { header: 'Saldo en la app', key: 'app', width: 15, money: true },
      { header: 'Ajuste', key: 'adj', width: 12, money: true }, { header: 'Nota', key: 'note', width: 26 },
    ], recs.map((r) => ({ date: day(r.date), acc: r.account.name, real: n(r.realBalance), app: n(r.appBalance), adj: n(r.adjustment), note: r.note ?? '' })));

    // Tasas: una fila por día con BCV y paralelo lado a lado
    const byDate = new Map<string, { date: Date; BCV?: number; PARALELO?: number }>();
    for (const r of rates) {
      if (r.source === 'MANUAL') continue;
      const k = r.date.toISOString().slice(0, 10);
      const e = byDate.get(k) ?? { date: r.date };
      e[r.source] = Number(r.rate);
      byDate.set(k, e);
    }
    sheet('Tasas', [
      { header: 'Fecha', key: 'date', width: 12, date: true }, { header: 'BCV', key: 'bcv', width: 12, money: true }, { header: 'Paralelo', key: 'par', width: 12, money: true },
    ], [...byDate.values()].map((e) => ({ date: day(e.date), bcv: e.BCV ?? null, par: e.PARALELO ?? null })));

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

@ApiTags('export') @ApiBearerAuth()
@Controller('export')
class ExportAllController {
  constructor(private exporter: ExportAllService) {}

  /** Todo en un Excel: movimientos, cuentas, deudas, cuotas, metas, tasas… */
  @Get('all')
  async all(@CurrentUser() u: AuthUser, @Res() res: Response) {
    const buf = await this.exporter.xlsx(u.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="finanzas_completo_${todayLocal()}.xlsx"`);
    res.send(buf);
  }
}

@Module({ imports: [TransactionsModule, AccountsModule], controllers: [ExportAllController], providers: [ExportAllService] })
export class ExportAllModule {}
