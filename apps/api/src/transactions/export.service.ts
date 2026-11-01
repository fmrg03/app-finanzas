import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { parseDateOnly } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';

const TYPE = { INCOME: 'Ingreso', EXPENSE: 'Gasto' } as const;
const SOURCE = { BCV: 'BCV', PARALELO: 'Paralelo', MANUAL: 'Manual' } as const;
const MONEY = '#,##0.00';

@Injectable()
export class ExportService {
  constructor(private prisma: PrismaService) {}

  /** Libro de Excel con dos hojas: movimientos y transferencias del período. */
  async xlsx(userId: string, where: Prisma.TransactionWhereInput, from?: string, to?: string) {
    const [txs, transfers] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: { account: true, category: { include: { parent: true } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        take: 20_000,
      }),
      this.prisma.transfer.findMany({
        where: {
          userId,
          ...(from || to ? { date: { ...(from ? { gte: parseDateOnly(from) } : {}), ...(to ? { lte: parseDateOnly(to) } : {}) } } : {}),
        },
        include: { fromAccount: true, toAccount: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Finanzas';
    wb.created = new Date();

    const ws = wb.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Fecha', key: 'date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Tipo', key: 'type', width: 9 },
      { header: 'Descripción', key: 'description', width: 34 },
      { header: 'Categoría', key: 'category', width: 18 },
      { header: 'Subcategoría', key: 'subcategory', width: 16 },
      { header: 'Cuenta', key: 'account', width: 18 },
      { header: 'Moneda', key: 'currency', width: 8 },
      { header: 'Monto original', key: 'original', width: 15, style: { numFmt: MONEY } },
      { header: 'USD', key: 'usd', width: 13, style: { numFmt: MONEY } },
      { header: 'Bs', key: 'ves', width: 16, style: { numFmt: MONEY } },
      { header: 'Tasa (Bs/USD)', key: 'rate', width: 13, style: { numFmt: '#,##0.0000' } },
      { header: 'Fuente tasa', key: 'rateSource', width: 11 },
      { header: 'Etiquetas', key: 'tags', width: 20 },
    ];
    for (const t of txs) {
      const sign = t.type === 'EXPENSE' ? -1 : 1;
      const isSub = !!t.category?.parent;
      ws.addRow({
        // Excel guarda fechas sin zona: se usa mediodía UTC para que nunca caiga en el día anterior
        date: new Date(t.date.getTime() + 12 * 3_600_000),
        type: TYPE[t.type],
        description: t.description ?? '',
        category: isSub ? t.category!.parent!.name : (t.category?.name ?? 'Sin categoría'),
        subcategory: isSub ? t.category!.name : '',
        account: t.account.name,
        currency: t.originalCurrency === 'USD' ? 'USD' : 'Bs',
        original: sign * Number(t.originalAmount),
        usd: sign * Number(t.amountUsd),
        ves: sign * Number(t.amountVes),
        rate: Number(t.rateUsed),
        rateSource: SOURCE[t.rateSource],
        tags: t.tags.join(', '),
      });
    }
    styleHeader(ws);
    if (txs.length) {
      const last = txs.length + 1;
      const total = ws.addRow({ description: 'Total (ingresos − gastos)', usd: { formula: `SUM(I2:I${last})` }, ves: { formula: `SUM(J2:J${last})` } });
      total.font = { bold: true };
      ws.autoFilter = { from: 'A1', to: `M${last}` };
    }

    const wt = wb.addWorksheet('Transferencias', { views: [{ state: 'frozen', ySplit: 1 }] });
    wt.columns = [
      { header: 'Fecha', key: 'date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Desde', key: 'from', width: 18 },
      { header: 'Sale', key: 'fromAmount', width: 14, style: { numFmt: MONEY } },
      { header: 'Moneda', key: 'fromCur', width: 8 },
      { header: 'Hacia', key: 'to', width: 18 },
      { header: 'Entra', key: 'toAmount', width: 14, style: { numFmt: MONEY } },
      { header: 'Moneda', key: 'toCur', width: 8 },
      { header: 'Tasa obtenida', key: 'rate', width: 13, style: { numFmt: '#,##0.00' } },
      { header: 'Tasa BCV', key: 'ref', width: 11, style: { numFmt: '#,##0.00' } },
      { header: 'Descripción', key: 'description', width: 30 },
    ];
    for (const t of transfers) {
      wt.addRow({
        date: new Date(t.date.getTime() + 12 * 3_600_000),
        from: t.fromAccount.name, fromAmount: Number(t.fromAmount), fromCur: t.fromAccount.currency === 'USD' ? 'USD' : 'Bs',
        to: t.toAccount.name, toAmount: Number(t.toAmount), toCur: t.toAccount.currency === 'USD' ? 'USD' : 'Bs',
        rate: t.rate ? Number(t.rate) : null, ref: t.referenceRate ? Number(t.referenceRate) : null, description: t.description ?? '',
      });
    }
    styleHeader(wt);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16233A' } };
  h.alignment = { vertical: 'middle' };
}
