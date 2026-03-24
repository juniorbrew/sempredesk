import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('routing_rules')
export class RoutingRule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column() name: string;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'int', default: 0 }) priority: number;
  // Conditions: match by department, category, priority, origin
  @Column({ name: 'cond_department', nullable: true }) condDepartment: string;
  @Column({ name: 'cond_category', nullable: true }) condCategory: string;
  @Column({ name: 'cond_priority', nullable: true }) condPriority: string;
  @Column({ name: 'cond_origin', nullable: true }) condOrigin: string;
  // Actions
  @Column({ name: 'action_assign_to', nullable: true }) actionAssignTo: string; // userId
  @Column({ name: 'action_set_priority', nullable: true }) actionSetPriority: string;
  @Column({ name: 'action_notify_email', nullable: true }) actionNotifyEmail: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
