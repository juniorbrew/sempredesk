import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_licenses')
export class TenantLicense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'plan_slug', length: 50 })
  planSlug: string;

  @Column({ length: 30, default: 'active' })
  status: 'active' | 'trial' | 'suspended' | 'cancelled' | 'expired';

  @Column({ name: 'billing_cycle', length: 30, default: 'monthly' })
  billingCycle: 'monthly' | 'yearly';

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'extra_limits', type: 'jsonb', default: {} })
  extraLimits: Record<string, any>;

  @Column({ name: 'meta', type: 'jsonb', default: {} })
  meta: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

