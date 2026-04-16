import { IsString, IsOptional, IsBoolean, IsNumber, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreatePauseReasonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  /** Duração máxima em minutos. null/omitido = livre (sem limite). Máximo: 480 min (8h). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  maxDurationMinutes?: number | null;
}

export class UpdatePauseReasonDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  maxDurationMinutes?: number | null;
}
