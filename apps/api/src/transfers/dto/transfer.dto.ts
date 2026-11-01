import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsDateString, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTransferDto {
  @ApiProperty() @IsString()
  fromAccountId: string;

  @ApiProperty() @IsString()
  toAccountId: string;

  @ApiProperty({ example: '2026-10-31' }) @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ example: '100.00', description: 'Lo que sale, en la moneda de la cuenta origen' }) @IsNumberString()
  fromAmount: string;

  @ApiPropertyOptional({
    example: '27000.00',
    description: 'Lo que entra, en la moneda de la cuenta destino. Si se omite: igual a fromAmount (misma moneda) o calculado con "rate" (cambio de divisas)',
  })
  @IsOptional() @IsNumberString()
  toAmount?: string;

  @ApiPropertyOptional({ example: '270.00', description: 'Bs por USD de la operación, si cambias de moneda y no indicas toAmount' })
  @IsOptional() @IsNumberString()
  rate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  description?: string;
}

export class UpdateTransferDto extends PartialType(CreateTransferDto) {}

export class ListTransfersDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  accountId?: string;
}
