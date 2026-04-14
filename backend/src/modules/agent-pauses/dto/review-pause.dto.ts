import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPauseDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewerObservation?: string;
}
