import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Motivos de pausa configuráveis por tenant.
 * Podem ser customizados por empresa; motivos padrão são semeados no banco.
 */
@Entity('pause_reasons')
@Index('uq_pause_reason_tenant_name', ['tenantId', 'name'], { unique: true })
export class PauseReason {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ nullable: true, length: 255 })
  description: string;

  /** true = precisa de aprovação de supervisor/admin antes de ativar */
  @Column({ name: 'requires_approval', default: true })
  requiresApproval: boolean;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  /** Duração máxima em minutos. null = livre (sem limite). */
  @Column({ name: 'max_duration_minutes', nullable: true, type: 'integer', default: null })
  maxDurationMinutes: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
