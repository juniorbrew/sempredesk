import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'user_email', nullable: true })
  userEmail?: string;

  @Column({ name: 'user_type' })
  userType: 'master_user' | 'user' | 'system';

  @Column({ name: 'entity_type' })
  entityType: string;

  @Column({ name: 'entity_id' })
  entityId: string;

  @Column({ type: 'jsonb', default: {} })
  details: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

