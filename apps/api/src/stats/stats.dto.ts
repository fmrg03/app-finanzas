import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class OverviewDto {
  @ApiProperty({ example: '2026-10-01' }) @IsDateString({ strict: true })
  from: string;

  @ApiProperty({ example: '2026-10-31' }) @IsDateString({ strict: true })
  to: string;

  @ApiPropertyOptional({ default: 6, description: 'Meses hacia atrás para la serie mensual (incluye el de "to")' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24)
  months = 6;
}
