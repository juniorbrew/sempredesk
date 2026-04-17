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

  // ── Dados cadastrais complementares (preenchidos via lookup de CNPJ ou manualmente) ──
  /** Razão social conforme Receita Federal */
  @IsOptional() @IsString() @Length(0, 300) razaoSocial?: string;
  /** Nome fantasia */
  @IsOptional() @IsString() @Length(0, 300) nomeFantasia?: string;
  /** Logradouro do endereço */
  @IsOptional() @IsString() @Length(0, 300) logradouro?: string;
  /** Número do endereço */
  @IsOptional() @IsString() @Length(0, 20)  numero?: string;
  /** Complemento do endereço */
  @IsOptional() @IsString() @Length(0, 100) complemento?: string;
  /** Bairro */
  @IsOptional() @IsString() @Length(0, 100) bairro?: string;
  /** Município */
  @IsOptional() @IsString() @Length(0, 100) cidade?: string;
  /** UF (sigla do estado, 2 chars) */
  @IsOptional() @IsString() @Length(0, 2)   uf?: string;
  /** CEP (apenas dígitos) */
  @IsOptional() @IsString() @Length(0, 10)  cep?: string;
  // ─────────────────────────────────────────────────────────────────────────

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

