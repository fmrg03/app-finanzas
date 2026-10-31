import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AccountType, Currency } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
