import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('calendar_sync_logs')
export class CalendarSyncLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ length: 20 })
  provider: string;

  @Column({ length: 10 })
  direction: string; // 'inbound' | 'outbound'

  @Column({ length: 20 })
  status: string; // 'success' | 'error' | 'partial'

  @Column({ name: 'events_synced', type: 'int', default: 0 })
  eventsSynced: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
