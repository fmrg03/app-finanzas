import Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { todayLocal } from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from '../transactions/dto/transaction.dto';
import { TransactionsService } from '../transactions/transactions.service';
import { buildPrompt, EXTRACTION_SCHEMA, ReceiptExtraction, sanitize } from './extraction';

export const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;
type Mime = keyof typeof ALLOWED_TYPES;

@Injectable()
export class ReceiptsService {
  private readonly log = new Logger(ReceiptsService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly uploadDir: string;

  constructor(
    private prisma: PrismaService,
    private transactions: TransactionsService,
    config: ConfigService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey, baseURL: config.get('ANTHROPIC_BASE_URL') || undefined, timeout: 60_000, maxRetries: 2 }) : null;
    this.model = config.get('RECEIPTS_MODEL') || 'claude-haiku-5-5';
    this.uploadDir = resolve(config.get('UPLOAD_DIR') || 'uploads');
  }

  status() {
    return { enabled: !!this.client, model: this.client ? this.model : null };
  }

  /** Guarda el archivo, lo lee con Claude y devuelve una propuesta de movimiento para que el usuario confirme. */
  async upload(userId: string, file: Express.Multer.File | undefined) {
    if (!this.client) throw new ServiceUnavailableException('La lectura de facturas no está configurada: falta ANTHROPIC_API_KEY en el .env de la API');
    if (!file) throw new BadRequestException('Adjunta una imagen o PDF en el campo "file"');
    const mime = detectMime(file.buffer);
    if (!mime) throw new BadRequestException('Formato no soportado. Usa JPG, PNG, WEBP o PDF (las fotos HEIC del iPhone conviértelas a JPG)');

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.receipt.findUnique({ where: { userId_fileHash: { userId, fileHash } } });
    if (existing?.transactionId) {
      throw new ConflictException({ message: 'Esta factura ya está registrada', transactionId: existing.transactionId, receiptId: existing.id });
    }
    // Misma imagen ya leída antes y no confirmada: se reutiliza sin volver a pagar la lectura
    if (existing?.status === 'EXTRACTED' && existing.extractedJson) {
      return this.present(existing.id, existing.extractedJson as unknown as ReceiptExtraction, userId);
    }

    const dir = join(this.uploadDir, userId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${fileHash}.${ALLOWED_TYPES[mime]}`);
    await writeFile(filePath, file.buffer);

    const receipt = existing ?? (await this.prisma.receipt.create({ data: { userId, filePath, fileHash, status: 'PENDING' } }));

    try {
      const extraction = await this.extract(userId, file.buffer, mime);
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          status: 'EXTRACTED', filePath, modelUsed: this.model,
          extractedJson: extraction as unknown as Prisma.InputJsonValue,
          confidence: { high: 0.9, medium: 0.6, low: 0.3 }[extraction.confidence],
        },
      });
      return this.present(receipt.id, extraction, userId);
    } catch (e) {
      await this.prisma.receipt.update({ where: { id: receipt.id }, data: { status: 'FAILED', modelUsed: this.model } });
      if (e instanceof BadRequestException) throw e;
      this.log.error(`Falló la lectura de la factura ${receipt.id}: ${(e as Error).message}`);
      const status = (e as { status?: number }).status;
      if (status === 401) throw new ServiceUnavailableException('La ANTHROPIC_API_KEY no es válida');
      if (status === 429 || status === 529) throw new ServiceUnavailableException('El servicio de lectura está saturado; intenta en un minuto');
      throw new ServiceUnavailableException('No se pudo leer la factura. Inténtalo de nuevo o regístrala a mano');
    }
  }

  /** Crea el movimiento a partir de la propuesta (ya revisada por el usuario) y lo vincula a la factura. */
  async confirm(userId: string, receiptId: string, dto: CreateTransactionDto) {
    const receipt = await this.prisma.receipt.findFirst({ where: { id: receiptId, userId } });
    if (!receipt) throw new NotFoundException('Factura no encontrada');
    if (receipt.transactionId) throw new ConflictException({ message: 'Esta factura ya está registrada', transactionId: receipt.transactionId });

    const tx = await this.transactions.create(userId, dto, {
      source: 'RECEIPT',
      rawData: (receipt.extractedJson ?? undefined) as Prisma.InputJsonValue | undefined,
    });
    await this.prisma.receipt.update({ where: { id: receipt.id }, data: { transactionId: tx.id, status: 'CONFIRMED' } });
    return this.transactions.findOne(userId, tx.id);
  }

  async file(userId: string, id: string) {
    const r = await this.prisma.receipt.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Factura no encontrada');
    // El archivo siempre debe estar dentro de la carpeta de subidas
    const path = resolve(r.filePath);
    if (!path.startsWith(this.uploadDir)) throw new NotFoundException('Archivo no disponible');
    try {
      const buffer = await readFile(path);
      return { buffer, mime: detectMime(buffer) ?? 'application/octet-stream' };
    } catch {
      throw new NotFoundException('El archivo de la factura ya no existe en el servidor');
    }
  }

  private async extract(userId: string, buffer: Buffer, mime: Mime): Promise<ReceiptExtraction> {
    const cats = await this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, parent: { select: { name: true } } },
    });
    const today = todayLocal();
    const data = buffer.toString('base64');
    const media =
      mime === 'application/pdf'
        ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
        : ({ type: 'image', source: { type: 'base64', media_type: mime, data } } as const);

    const res = await this.client!.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{
        role: 'user',
        content: [media, { type: 'text', text: buildPrompt(cats.map((c) => ({ ...c, parent: c.parent?.name })), today) }],
      }],
    });

    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Respaldo por si el modelo envuelve el JSON en texto
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`Respuesta sin JSON (stop_reason=${res.stop_reason})`);
      parsed = JSON.parse(m[0]);
    }
    const out = sanitize(parsed, new Set(cats.map((c) => c.id)), today);
    if (!out.isReceipt) throw new BadRequestException('La imagen no parece una factura o comprobante de pago');
    return out;
  }

  /** Convierte la lectura en una propuesta lista para el formulario de movimiento. */
  private async present(receiptId: string, ex: ReceiptExtraction, userId: string) {
    let categoryRate: string | null = null;
    if (ex.suggestedCategoryId) {
      const c = await this.prisma.category.findFirst({ where: { id: ex.suggestedCategoryId, userId }, select: { type: true, defaultRateSource: true } });
      categoryRate = c?.defaultRateSource ?? null;
      if (c && c.type !== ex.type) ex = { ...ex, suggestedCategoryId: null };
    }
    const description = ex.merchant ?? ex.items[0]?.description ?? null;
    return {
      receiptId,
      extraction: ex,
      suggestion: {
        type: ex.type,
        date: ex.date ?? todayLocal(),
        currency: ex.currency ?? 'VES',
        amount: ex.total !== null ? ex.total.toFixed(2) : '',
        categoryId: ex.suggestedCategoryId,
        description,
        // Si la factura trae su propia tasa impresa, se propone usarla
        ...(ex.exchangeRate ? { rateSource: 'MANUAL' as const, rate: String(ex.exchangeRate) } : categoryRate ? { rateSource: categoryRate } : {}),
      },
    };
  }
}

/** Detecta el tipo por la firma del archivo, sin confiar en el nombre ni en el mimetype enviado. */
export function detectMime(b: Buffer): Mime | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}
