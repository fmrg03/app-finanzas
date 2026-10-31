import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RateSource, TransactionType } from '@prisma/client';
import { IsEnum, IsHexColor, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60)
  name: string;

  @ApiProperty({ enum: TransactionType }) @IsEnum(TransactionType)
  type: TransactionType;

  @ApiPropertyOptional({ example: '#16a34a' }) @IsOptional() @IsHexColor()
  color?: string;

  @ApiPropertyOptional({ description: 'Nombre del ícono (lucide), ej. shopping-cart' })
  @IsOptional() @IsString() @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Categoría padre (un solo nivel)' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ enum: RateSource, nullable: true, description: 'Tasa preseleccionada; null usa la del usuario' })
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEnum(RateSource)
  defaultRateSource?: RateSource | null;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
