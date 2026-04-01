import { Type } from 'class-transformer';
import { IsString, IsEnum, IsOptional, IsArray, IsNumber, Min, Max, MaxLength, MinLength } from 'class-validator';
import { TicketStatus, TicketPriority, TicketOrigin, MessageType } from '../entities/ticket.entity';

export class CreateTicketDto {
  @IsString()
  clientId: string;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsString()
  @IsOptional()
  conversationId?: string;

  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsEnum(TicketOrigin)
  @IsOptional()
  origin?: TicketOrigin;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  department?: string;

  /** ID do departamento em ticket_settings (resolvido para nome quando fornecido) */
  @IsString()
  @IsOptional()
  departmentId?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  subcategory?: string;

  @IsString()
  @MinLength(3, { message: 'Assunto deve ter no mínimo 3 caracteres' })
  subject: string;

  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Descrição deve ter no mínimo 3 caracteres' })
  @MaxLength(600, { message: 'Descrição deve ter no máximo 600 caracteres' })
  description?: string;

  @IsArray()
  @IsOptional()
  tags?: string[];
}

export class UpdateTicketDto {
  @IsEnum(TicketStatus)
  @IsOptional()
  status?: TicketStatus;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  subcategory?: string;

  @IsString()
  @IsOptional()
  resolutionSummary?: string;

  @IsString()
  @IsOptional()
  cancelReason?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  timeSpentMin?: number;

  @IsArray()
  @IsOptional()
  tags?: string[];
}

export class UpdateTicketContentDto {
  @IsString()
  @MinLength(3, { message: 'Assunto deve ter no mínimo 3 caracteres' })
  subject: string;

  @IsString()
  @IsOptional()
  @MinLength(3, { message: 'Descrição deve ter no mínimo 3 caracteres' })
  @MaxLength(600, { message: 'Descrição deve ter no máximo 600 caracteres' })
  description?: string;
}

export class ResolveTicketDto {
  @IsString()
  @IsOptional()
  resolutionSummary?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  timeSpentMin?: number;

  @IsString()
  @IsOptional()
  rootCause?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  complexity?: number;
}

export class CancelTicketDto {
  @IsString()
  @IsOptional()
  cancelReason?: string;
}

export class AddMessageDto {
  @IsString()
  content: string;

  @IsEnum(MessageType)
  @IsOptional()
  messageType?: MessageType;

  @IsArray()
  @IsOptional()
  attachments?: any[];

  @IsString()
  @IsOptional()
  channel?: string;

}

export class FilterTicketsDto {
  /** Status único ou múltiplos separados por vírgula: open,waiting_client,in_progress */
  @IsString()
  @IsOptional()
  status?: string;

  @IsEnum(TicketOrigin)
  @IsOptional()
  origin?: TicketOrigin;

  @IsEnum(TicketPriority)
  @IsOptional()
  priority?: TicketPriority;

  @IsString()
  @IsOptional()
  assignedTo?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  subcategory?: string;

  @IsString()
  @IsOptional()
  search?: string;

  /** Se true, retorna apenas tickets ativos (open, in_progress, waiting_client) - útil para atendimento */
  @IsOptional()
  active?: boolean;

  /** Se true, inclui última mensagem do agente em cada ticket (para widget portal) */
  @IsOptional()
  includeLastMessage?: boolean;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  perPage?: number;
}
