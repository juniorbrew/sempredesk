import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('calendar_integrations')
export class CalendarIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 20 })
  provider: string; // 'google' | 'outlook'

  @Column({ name: 'provider_account', length: 255, nullable: true })
  providerAccount: string | null;

  /** Access token encriptado com AES-256 (CALENDAR_TOKEN_SECRET). Nunca armazenar em texto plano. */
  @Column({ name: 'access_token_enc', type: 'text', nullable: true, select: false })
  accessTokenEnc: string | null;

  /** Refresh token encriptado. */
  @Column({ name: 'refresh_token_enc', type: 'text', nullable: true, select: false })
  refreshTokenEnc: string | null;

  @Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ name: 'provider_calendar_id', length: 500, nullable: true })
  providerCalendarId: string | null;

  @Column({ name: 'provider_calendar_name', length: 255, nullable: true })
  providerCalendarName: string | null;

  @Column({ name: 'sync_token', type: 'text', nullable: true })
  syncToken: string | null;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ name: 'sync_enabled', default: true })
  syncEnabled: boolean;

  @Column({ length: 30, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
