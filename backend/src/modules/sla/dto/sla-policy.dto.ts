import { IsEnum, IsInt, IsBoolean, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SlaPriority } from '../entities/sla-policy.entity';

export class CreateSlaPolicyDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsEnum(SlaPriority)
  priority: SlaPriority;

  /** Minutos para primeira resposta do agente (padrão: 60). */
  @IsInt()
  @Min(1)
  firstResponseMinutes: number;

  /** Minutos para resolução da conversa (padrão: 480 = 8h). */
  @IsInt()
  @Min(1)
  resolutionMinutes: number;

  /** Marca como política padrão do tenant (usada quando não há política para a prioridade). */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateSlaPolicyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(SlaPriority)
  priority?: SlaPriority;

  @IsOptional()
  @IsInt()
  @Min(1)
  firstResponseMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  resolutionMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
