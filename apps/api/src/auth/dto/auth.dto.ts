import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Currency, RateSource } from '@prisma/client';

export class RegisterDto {
  @IsEmail() email: string;
  // bcrypt ignora más de 72 bytes
  @IsString() @MinLength(8) @MaxLength(72) password: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
}

export class AcceptInvitationDto {
  // Para una invitación: nombre y correo de la cuenta nueva. Para restablecer: solo la contraseña.
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() @MinLength(8) @MaxLength(72) password: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

export class RefreshDto {
  @IsOptional() @IsString() refreshToken?: string;
}

export class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsEnum(Currency) defaultCurrency?: Currency;
  @IsOptional() @IsEnum(RateSource) defaultRateSource?: RateSource;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) @MaxLength(72) newPassword: string;
}
