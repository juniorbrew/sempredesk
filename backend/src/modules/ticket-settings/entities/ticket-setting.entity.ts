import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TenantPriority } from '../../tenant-priorities/entities/tenant-priority.entity';

export enum TicketSettingType {
  DEPARTMENT = 'department',
  CATEGORY = 'category',
  SUBCATEGORY = 'subcategory',
}

@Entity('ticket_settings')
export class TicketSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'enum', enum: TicketSettingType })
  type: TicketSettingType;

  @Column({ length: 120 })
  name: string;

  @Column({ name: 'parent_id', nullable: true })
  parentId: string;

  @Column({ default: true })
  active: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ length: 20, nullable: true })
  color: string;

  /** Apenas para type = department. Prioridade cadastrável do tenant (Fase 2). */
  @Column({ name: 'default_priority_id', nullable: true })
  defaultPriorityId: string | null;

  @ManyToOne(() => TenantPriority, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'default_priority_id' })
  defaultPriority?: TenantPriority | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
