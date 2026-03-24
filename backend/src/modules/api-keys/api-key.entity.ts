import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column() name: string;
  @Column({ unique: true }) key: string;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'simple-array', default: 'read' }) permissions: string[];
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true }) expiresAt: Date;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
