import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RateSource } from '@prisma/client';
import { IsDateString, IsEnum, IsNumberString, IsOptional } from 'class-validator';

export class UpsertExchangeRateDto {
  @ApiProperty({ example: '2026-10-30' }) @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ enum: RateSource }) @IsEnum(RateSource)
  source: RateSource;

  @ApiProperty({ example: '215.4500', description: 'Bolívares por 1 USD' }) @IsNumberString()
  rate: string;
}

export class ListExchangeRatesDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ enum: RateSource }) @IsOptional() @IsEnum(RateSource)
  source?: RateSource;
}

export class RateForDateDto {
  @ApiProperty({ example: '2026-10-30' }) @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ enum: RateSource }) @IsEnum(RateSource)
  source: RateSource;
}
