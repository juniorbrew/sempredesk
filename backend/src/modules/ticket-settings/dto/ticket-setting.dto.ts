import { IsBoolean, IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
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
