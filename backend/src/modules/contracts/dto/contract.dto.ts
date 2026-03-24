import { IsString, IsEnum, IsNumber, IsOptional, IsArray, IsDateString, Min } from 'class-validator';
import { ContractType, ContractStatus } from '../entities/contract.entity';

export class CreateContractDto {
  @IsString()
  clientId: string;

  @IsEnum(ContractType)
  @IsOptional()
  contractType?: ContractType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyHours?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  slaResponseHours?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  slaResolveHours?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyValue?: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsArray()
  @IsOptional()
  servicesIncluded?: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  ticketLimit?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateContractDto {
  @IsEnum(ContractType)
  @IsOptional()
  contractType?: ContractType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyHours?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  slaResponseHours?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  slaResolveHours?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyValue?: number;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(ContractStatus)
  @IsOptional()
  status?: ContractStatus;

  @IsArray()
  @IsOptional()
  servicesIncluded?: string[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  ticketLimit?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
