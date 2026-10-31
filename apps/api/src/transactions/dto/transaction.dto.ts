import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, RateSource, TransactionSource, TransactionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateTransactionDto {
  @ApiProperty() @IsString()
  accountId: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;

  @ApiProperty({ enum: TransactionType }) @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ example: '2026-10-30' }) @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ enum: Currency, description: 'Moneda en la que escribes el monto' }) @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ example: '25.50', description: 'Monto positivo en la moneda indicada' }) @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ enum: RateSource, description: 'Si se omite: la de la categoría, o la predeterminada del usuario' })
  @IsOptional() @IsEnum(RateSource)
  rateSource?: RateSource;

  @ApiPropertyOptional({ example: '215.45', description: 'Tasa VES/USD explícita. Obligatoria si rateSource = MANUAL' })
  @IsOptional() @IsNumberString()
  rate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  tags?: string[];
}

export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}

const toArray = ({ value }: { value: unknown }) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]);

export class ListTransactionsDto extends PaginationDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: TransactionType }) @IsOptional() @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(toArray) @IsString({ each: true })
  accountId?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Incluye también sus subcategorías' })
  @IsOptional() @Transform(toArray) @IsString({ each: true })
  categoryId?: string[];

  @ApiPropertyOptional({ description: '"none" para movimientos sin categoría' })
  @IsOptional() @IsString()
  uncategorized?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  tag?: string;

  @ApiPropertyOptional({ enum: TransactionSource }) @IsOptional() @IsEnum(TransactionSource)
  source?: TransactionSource;

  @ApiPropertyOptional({ description: 'Busca en la descripción' }) @IsOptional() @IsString() @MaxLength(100)
  q?: string;
}

