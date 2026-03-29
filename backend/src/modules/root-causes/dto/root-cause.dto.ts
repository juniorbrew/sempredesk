import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateRootCauseDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class UpdateRootCauseDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sortOrder?: number;
}

export class FilterRootCauseDto {
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  active?: boolean;
}
