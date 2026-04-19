import {
  IsString, IsOptional, IsBoolean, IsDateString,
  IsIn, IsUUID, IsArray, ValidateNested, IsEmail,
  MaxLength, IsObject, IsInt, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const EVENT_STATUSES = ['scheduled','confirmed','cancelled','completed','rescheduled'] as const;
const EVENT_TYPES    = ['internal','client_return','sla_reminder','meeting','sync_google','sync_outlook'] as const;
const EVENT_ORIGINS  = ['manual','ticket','sla','sync_google','sync_outlook'] as const;

export class AddParticipantDto {
  @IsUUID() @IsOptional() userId?: string;
  @IsUUID() @IsOptional() contactId?: string;
  @IsEmail() @IsOptional() externalEmail?: string;
  @IsString() @IsOptional() @MaxLength(255) externalName?: string;
  @IsIn(['organizer','attendee','optional']) @IsOptional() role?: string;
}

export class CreateCalendarEventDto {
  @IsString() @MaxLength(255)
  title: string;

  @IsString() @IsOptional()
  description?: string;

  @IsString() @IsOptional() @MaxLength(500)
  location?: string;

  @IsString() @IsOptional()
  notes?: string;

  @IsDateString()
  startsAt: string;

  @IsDateString()
  endsAt: string;

  @IsString() @IsOptional() @MaxLength(60)
  timezone?: string;

  @IsBoolean() @IsOptional()
  allDay?: boolean;

  @IsIn(EVENT_STATUSES) @IsOptional()
  status?: string;

  @IsIn(EVENT_TYPES) @IsOptional()
  eventType?: string;

  @IsIn(EVENT_ORIGINS) @IsOptional()
  origin?: string;

  @IsUUID() @IsOptional()
  assignedUserId?: string;

  @IsUUID() @IsOptional()
  departmentId?: string;

  @IsUUID() @IsOptional()
  ticketId?: string;

  @IsUUID() @IsOptional()
  contactId?: string;

  @IsUUID() @IsOptional()
  clientId?: string;

  @IsObject() @IsOptional()
  metadata?: Record<string, any>;

  @IsArray() @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AddParticipantDto)
  participants?: AddParticipantDto[];
}

export class UpdateCalendarEventDto {
  @IsString() @IsOptional() @MaxLength(255) title?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() @MaxLength(500) location?: string;
  @IsString() @IsOptional() notes?: string;
  @IsDateString() @IsOptional() startsAt?: string;
  @IsDateString() @IsOptional() endsAt?: string;
  @IsString() @IsOptional() @MaxLength(60) timezone?: string;
  @IsBoolean() @IsOptional() allDay?: boolean;
  @IsIn(EVENT_STATUSES) @IsOptional() status?: string;
  @IsIn(EVENT_TYPES) @IsOptional() eventType?: string;
  @IsUUID() @IsOptional() assignedUserId?: string;
  @IsUUID() @IsOptional() departmentId?: string;
  @IsUUID() @IsOptional() ticketId?: string;
  @IsUUID() @IsOptional() contactId?: string;
  @IsUUID() @IsOptional() clientId?: string;
  @IsObject() @IsOptional() metadata?: Record<string, any>;
}

export class FilterCalendarEventDto {
  @IsDateString() @IsOptional() from?: string;
  @IsDateString() @IsOptional() to?: string;
  @IsIn(EVENT_STATUSES) @IsOptional() status?: string;
  @IsIn(EVENT_TYPES) @IsOptional() eventType?: string;
  @IsUUID() @IsOptional() assignedUserId?: string;
  @IsUUID() @IsOptional() departmentId?: string;
  @IsUUID() @IsOptional() ticketId?: string;
  @IsUUID() @IsOptional() clientId?: string;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  page?: number = 1;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  perPage?: number = 20;
}
