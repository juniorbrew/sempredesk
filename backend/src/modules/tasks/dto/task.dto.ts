import {
  IsString, IsOptional, IsIn, IsUUID, IsDateString,
  IsArray, IsBoolean, IsObject, IsInt, Min, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const TASK_STATUSES   = ['pending','in_progress','completed','cancelled'] as const;
const TASK_PRIORITIES = ['low','medium','high','critical'] as const;
const TASK_ORIGINS    = ['manual','ticket','sla','sync'] as const;

export class ChecklistItemDto {
  @IsString() id: string;
  @IsString() text: string;
  @IsBoolean() done: boolean;
}

export class CreateTaskDto {
  @IsString() @MaxLength(255)
  title: string;

  @IsString() @IsOptional()
  description?: string;

  @IsIn(TASK_PRIORITIES) @IsOptional()
  priority?: string;

  @IsDateString() @IsOptional()
  dueAt?: string;

  @IsDateString() @IsOptional()
  reminderAt?: string;

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

  @IsUUID() @IsOptional()
  calendarEventId?: string;

  @IsIn(TASK_ORIGINS) @IsOptional()
  origin?: string;

  @IsArray() @IsOptional()
  checklist?: Array<{ id: string; text: string; done: boolean }>;

  @IsString() @IsOptional()
  notes?: string;

  @IsObject() @IsOptional()
  metadata?: Record<string, any>;
}

export class UpdateTaskDto {
  @IsString() @IsOptional() @MaxLength(255) title?: string;
  @IsString() @IsOptional() description?: string;
  @IsIn(TASK_STATUSES) @IsOptional() status?: string;
  @IsIn(TASK_PRIORITIES) @IsOptional() priority?: string;
  @IsDateString() @IsOptional() dueAt?: string;
  @IsDateString() @IsOptional() reminderAt?: string;
  @IsUUID() @IsOptional() assignedUserId?: string;
  @IsUUID() @IsOptional() departmentId?: string;
  @IsUUID() @IsOptional() ticketId?: string;
  @IsUUID() @IsOptional() contactId?: string;
  @IsUUID() @IsOptional() clientId?: string;
  @IsUUID() @IsOptional() calendarEventId?: string;
  @IsArray() @IsOptional() checklist?: Array<{ id: string; text: string; done: boolean }>;
  @IsString() @IsOptional() notes?: string;
  @IsObject() @IsOptional() metadata?: Record<string, any>;
}

export class FilterTaskDto {
  @IsIn(TASK_STATUSES) @IsOptional() status?: string;
  @IsIn(TASK_PRIORITIES) @IsOptional() priority?: string;
  @IsUUID() @IsOptional() assignedUserId?: string;
  @IsUUID() @IsOptional() departmentId?: string;
  @IsUUID() @IsOptional() ticketId?: string;
  @IsUUID() @IsOptional() clientId?: string;
  @IsDateString() @IsOptional() dueBefore?: string;
  @IsDateString() @IsOptional() dueAfter?: string;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  page?: number = 1;

  @Type(() => Number) @IsInt() @Min(1) @IsOptional()
  perPage?: number = 20;
}

export class AddTaskCommentDto {
  @IsString() @MaxLength(2000)
  comment: string;
}
