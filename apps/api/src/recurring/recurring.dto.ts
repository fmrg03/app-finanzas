import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Currency, RateSource, RecurrenceFrequency, TransactionType } from '@prisma/client';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateIf,
} from 'class-validator';

export class CreateRecurringDto {
  @ApiProperty({ enum: TransactionType }) @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty() @IsString()
  accountId: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  categoryId?: string | null;

  @ApiProperty({ enum: Currency }) @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ example: '23.50' }) @IsNumberString()
  amount: string;

  @ApiPropertyOptional({ enum: RateSource, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsEnum(RateSource)
  rateSource?: RateSource | null;

  @ApiProperty({ example: 'Internet fibra' }) @IsString() @MinLength(1) @MaxLength(300)
  description: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  tags?: string[];

  @ApiProperty({ enum: RecurrenceFrequency }) @IsEnum(RecurrenceFrequency)
  frequency: RecurrenceFrequency;

  @ApiProperty({ example: '2026-11-01', description: 'Primera fecha en que toca' }) @IsDateString({ strict: true })
  startDate: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  endDate?: string | null;

  @ApiPropertyOptional({ default: false, description: 'true: se registra solo; false: queda pendiente para confirmar' })
  @IsOptional() @IsBoolean()
  autoCreate?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  active?: boolean;
}

export class UpdateRecurringDto extends PartialType(CreateRecurringDto) {}

export class ConfirmRecurringDto {
  @ApiPropertyOptional({ description: 'Monto real de esta vez, si cambió' }) @IsOptional() @IsNumberString()
  amount?: string;

  @ApiPropertyOptional({ description: 'Fecha real del pago; por defecto la que tocaba' }) @IsOptional() @IsDateString({ strict: true })
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Tasa explícita, si fue distinta' }) @IsOptional() @IsNumberString()
  rate?: string;
}
