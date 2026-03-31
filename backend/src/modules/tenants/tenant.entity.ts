// ── ENTITY ─────────────────────────────────────────────────────
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 200 }) name: string;
  @Column({ unique: true, length: 100 }) slug: string;
  @Column({ nullable: true, length: 18 }) cnpj: string;
  @Column({ length: 30, default: 'starter' }) plan: string;
  @Column({ length: 30, default: 'trial' }) status: string;
  @Column({ nullable: true, length: 200 }) email: string;
  @Column({ nullable: true, length: 20 }) phone: string;
  @Column({ type: 'jsonb', default: {} }) settings: Record<string, any>;
  @Column({ type: 'jsonb', default: {} }) limits: Record<string, any>;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
