import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateTenantOnboardDto {
  @IsString()
  @IsNotEmpty()
  @Length(3, 200)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Length(3, 100)
  @Matches(/^[a-z0-9-]+$/, { message: 'slug deve conter apenas letras minúsculas, números e hífen' })
  slug: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(11, 18)
  cnpj?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  phone?: string;

  @IsOptional()
  @IsString()
  planSlug?: 'starter' | 'professional' | 'enterprise';

  @IsString()
  @IsNotEmpty()
  @Length(3, 200)
  adminName: string;

  @IsEmail()
  @IsNotEmpty()
  adminEmail: string;

  @IsOptional()
  @IsString()
  @Length(6, 100)
  adminPassword?: string;
}

