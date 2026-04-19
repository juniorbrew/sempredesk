import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { CalendarEventParticipant } from './calendar-event-participant.entity';

@Entity('calendar_events')
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ length: 500, nullable: true })
  location: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ length: 60, default: 'America/Sao_Paulo' })
  timezone: string;

  @Column({ name: 'all_day', default: false })
  allDay: boolean;

  @Column({ length: 30, default: 'scheduled' })
  status: string;

  @Column({ name: 'event_type', length: 50, default: 'internal' })
  eventType: string;

  @Column({ length: 30, default: 'manual' })
  origin: string;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ length: 20, nullable: true })
  provider: string | null;

  @Column({ name: 'provider_event_id', length: 500, nullable: true })
  providerEventId: string | null;

  @Column({ name: 'provider_calendar_id', length: 500, nullable: true })
  providerCalendarId: string | null;

  @Column({ name: 'provider_sync_token', length: 500, nullable: true })
  providerSyncToken: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @OneToMany(() => CalendarEventParticipant, (p) => p.event, { cascade: true })
  participants: CalendarEventParticipant[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
