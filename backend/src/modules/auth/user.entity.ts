import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';

/** Roles do sistema. Perfis personalizados usam slugs livres. */
export type UserRole = 'super_admin'|'admin'|'manager'|'technician'|'viewer'|'client_contact'|string;
export type UserStatus = 'active'|'inactive'|'suspended';

/** Status de presença em tempo real — complementa Redis com persistência em DB */
export type UserPresenceStatus = 'online'|'away'|'busy'|'offline';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id', nullable: true }) tenantId: string;
  @Column({ name: 'network_id', nullable: true }) networkId: string | null;
  @Column({ length: 200 }) name: string;
  @Column({ unique: true, length: 200 }) email: string;
  @Column({ length: 255 }) password: string;
  @Column({ type: 'varchar', length: 50, default: 'technician' }) role: UserRole;
  @Column({ length: 30, default: 'active' }) status: UserStatus;
  @Column({ nullable: true, length: 20 }) phone: string;
  @Column({ nullable: true }) avatar: string;
  @Column({ name: 'last_login', nullable: true }) lastLogin: Date;
  @Column({ type: 'jsonb', default: {} }) settings: Record<string, any>;

  /**
   * Presença em tempo real (complementa Redis; persistida para detecção por cron).
   * Null = sem histórico (compatível com registros anteriores ao campo).
   */
  @Column({ name: 'presence_status', type: 'varchar', length: 20, default: 'offline', nullable: true })
  presenceStatus: UserPresenceStatus | null;

  /** Último heartbeat HTTP do agente; atualizado por POST /agents/me/heartbeat */
  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  // ── Disponibilidade para distribuição automática ──────────────────────────
  /** Quando true, o agente só entra no round-robin dentro da janela start..end */
  @Column({ name: 'distribution_availability_enabled', type: 'boolean', default: false })
  distributionAvailabilityEnabled: boolean;

  /** Horário inicial da janela de distribuição (HH:MM). Null = sem restrição. */
  @Column({ name: 'distribution_start_time', type: 'varchar', length: 5, nullable: true })
  distributionStartTime: string | null;

  /** Horário final da janela de distribuição (HH:MM). Null = sem restrição. */
  @Column({ name: 'distribution_end_time', type: 'varchar', length: 5, nullable: true })
  distributionEndTime: string | null;
  // ─────────────────────────────────────────────────────────────────────────

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;

  @BeforeInsert() @BeforeUpdate()
  async hashPw() {
    if (this.password && !this.password.startsWith('$2b$'))
      this.password = await bcrypt.hash(this.password, 12);
  }

  async validatePassword(pw: string) { return bcrypt.compare(pw, this.password); }

  toJSON() { const { password: _, ...rest } = this as any; return rest; }
}
