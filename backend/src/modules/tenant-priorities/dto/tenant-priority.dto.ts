import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const SLUG_REGEX = /^[a-z][a-z0-9_-]{0,63}$/;

export class CreateTenantPriorityDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(64)
  @Matches(SLUG_REGEX, {
    message: 'slug deve começar com letra minúscula e usar apenas a-z, 0-9, _ e -',
  })
  slug: string;

  @IsString()
  @MaxLength(20)
  color: string;

  @IsInt()
  @Min(0)
  sortOrder: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  slaPolicyId?: string | null;
}

export class UpdateTenantPriorityDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(SLUG_REGEX, {
    message: 'slug deve começar com letra minúscula e usar apenas a-z, 0-9, _ e -',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsUUID()
  slaPolicyId?: string | null;
}

export class SetTenantPriorityActiveDto {
  @IsBoolean()
  active: boolean;
}
