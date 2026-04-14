import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class RequestPauseDto {
  @IsUUID()
  reasonId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  agentObservation?: string;
}
