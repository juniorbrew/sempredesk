import { IsBoolean, IsEnum, IsOptional, IsString, IsInt, Min, IsUUID, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { TicketSettingType } from '../entities/ticket-setting.entity';

export class CreateTicketSettingDto {
  @IsEnum(TicketSettingType)
  type: TicketSettingType;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsString()
  @IsOptional()
  color?: string;

  /** Somente quando type = department. Opcional. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  defaultPriorityId?: string | null;
}

export class UpdateTicketSettingDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  parentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsString()
  @IsOptional()
  color?: string;

  /** Somente para registros do tipo department. Use null para limpar. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null && v !== undefined && v !== '')
  @IsUUID()
  defaultPriorityId?: string | null;
}

export class FilterTicketSettingDto {
  @IsEnum(TicketSettingType)
  @IsOptional()
  type?: TicketSettingType;

  @IsString()
  @IsOptional()
  parentId?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
