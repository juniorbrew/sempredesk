import { IsString, IsBoolean, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateChatbotConfigDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() welcomeMessage?: string;
  @IsString() @IsOptional() menuTitle?: string;
  @IsBoolean() @IsOptional() enabled?: boolean;
  @IsBoolean() @IsOptional() channelWhatsapp?: boolean;
  @IsBoolean() @IsOptional() channelWeb?: boolean;
  @IsBoolean() @IsOptional() channelPortal?: boolean;
  @IsString() @IsOptional() transferMessage?: string;
  @IsString() @IsOptional() noAgentMessage?: string;
  @IsString() @IsOptional() invalidOptionMessage?: string;
  @IsNumber() @IsOptional() @Min(5) @Max(240) sessionTimeoutMinutes?: number;
}

export class UpsertMenuItemDto {
  @IsString() @IsOptional() id?: string;
  @IsNumber() order: number;
  @IsString() label: string;
  @IsString() action: string; // 'auto_reply' | 'transfer'
  @IsString() @IsOptional() autoReplyText?: string;
  @IsString() @IsOptional() department?: string;
  @IsBoolean() @IsOptional() enabled?: boolean;
}

export class UpdateMenuDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertMenuItemDto)
  items: UpsertMenuItemDto[];
}

export class WidgetStartDto {
  @IsString() @IsOptional() visitorName?: string;
  @IsString() @IsOptional() visitorEmail?: string;
  @IsString() @IsOptional() pageUrl?: string;
}

export class WidgetMessageDto {
  @IsString() sessionId: string;
  @IsString() text: string;
}
