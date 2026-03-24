import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@demo.com' }) @IsEmail() email: string;
  @ApiProperty({ example: 'Admin@123' }) @IsString() @MinLength(6) password: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() refreshToken: string;
}

export class CreateUserDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(8) password: string;
  @ApiProperty({ enum: ['admin','manager','technician','viewer'] })
  @IsIn(['admin','manager','technician','viewer']) role: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}
