import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTagDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  color?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateTagDto {
  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  color?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class FilterTagDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  active?: boolean;
}
