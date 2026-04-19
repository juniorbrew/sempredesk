import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { CalendarEvent } from './calendar-event.entity';

@Entity('calendar_event_participants')
export class CalendarEventParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'external_email', length: 255, nullable: true })
  externalEmail: string | null;

  @Column({ name: 'external_name', length: 255, nullable: true })
  externalName: string | null;

  @Column({ length: 30, default: 'attendee' })
  role: string;

  @Column({ name: 'response_status', length: 30, default: 'pending' })
  responseStatus: string;

  @ManyToOne(() => CalendarEvent, (e) => e.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event: CalendarEvent;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
