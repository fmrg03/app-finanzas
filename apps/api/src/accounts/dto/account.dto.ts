import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AccountType, Currency } from '@prisma/client';
import { IsBoolean, IsDateString, IsEnum, IsNumberString, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60)
  name: string;

  @ApiProperty({ enum: AccountType }) @IsEnum(AccountType)
  type: AccountType;

  @ApiProperty({ enum: Currency }) @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({ example: '0.00', description: 'Saldo inicial en la moneda de la cuenta' })
  @IsOptional() @IsNumberString()
  initialBalance?: string;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @ApiPropertyOptional({ description: 'true archiva la cuenta, false la reactiva' })
  @IsOptional() @IsBoolean()
  archived?: boolean;
}

export class ReconcileDto {
  @ApiProperty({ example: '1250.40', description: 'Saldo real que ves en el banco, en la moneda de la cuenta (puede ser negativo)' })
  @Matches(/^-?\d+(\.\d{1,2})?$/, { message: 'Saldo inválido' })
  realBalance!: string;

  @ApiPropertyOptional({ description: 'Día del saldo; por defecto hoy' }) @IsOptional() @IsDateString({ strict: true })
  date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  note?: string;
}
