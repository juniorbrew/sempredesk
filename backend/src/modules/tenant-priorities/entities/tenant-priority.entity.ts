import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SlaPolicy } from '../../sla/entities/sla-policy.entity';

@Entity('tenant_priorities')
export class TenantPriority {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 120 })
  name: string;

  /** Identificador estável por tenant (ex.: low, medium, vip). */
  @Column({ length: 64 })
  slug: string;

  @Column({ length: 20, default: '#64748B' })
  color: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'sla_policy_id', nullable: true })
  slaPolicyId: string | null;

  @ManyToOne(() => SlaPolicy, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sla_policy_id' })
  slaPolicy?: SlaPolicy | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
