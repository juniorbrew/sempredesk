import { IsString, IsOptional, IsBoolean, IsEnum, IsNumber, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationChannel } from '../entities/conversation.entity';

export class StartConversationDto {
  @IsString()
  clientId: string;

  @IsString()
  name: string;

  @IsString()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsBoolean()
  @IsOptional()
  chatAlert?: boolean;

  @IsString()
  @IsOptional()
  tenantId?: string;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  departmentId?: string;
}

export class StartAgentConversationDto {
  @IsString()
  clientId: string;

  @IsString()
  contactId: string;

  @IsEnum(ConversationChannel)
  channel: ConversationChannel;
}

export class CreateTicketForConversationDto {
  @IsString()
  @IsOptional()
  subject?: string;
}

export class LinkTicketDto {
  @IsString()
  ticketId: string;
}

export class AddConversationMessageDto {
  @IsString()
  @IsOptional()
  content?: string;
}

/** Dados opcionais de encerramento formal (solução, causa raiz, etc.) — salvos como interação separada da conversa */
export class CloseConversationDto {
  @IsOptional()
  keepTicketOpen?: boolean;

  @IsString()
  @IsOptional()
  solution?: string;

  @IsString()
  @IsOptional()
  rootCause?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  timeSpentMin?: number;

  @IsString()
  @IsOptional()
  internalNote?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  complexity?: number;
}

export class UpdateConversationTagsDto {
  @IsArray()
  @IsOptional()
  tags?: string[];
}
