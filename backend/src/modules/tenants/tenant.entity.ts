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

  /**
   * Domínio próprio da empresa (ex.: "empresa.com.br").
   * Null = acesso apenas via {slug}.sempredesk.com.br.
   */
  @Column({ name: 'custom_domain', nullable: true, unique: true, length: 255 })
  customDomain: string | null;

  /**
   * Se false, desativa o acesso via {slug}.sempredesk.com.br.
   * Útil durante migração para domínio próprio.
   */
  @Column({ name: 'subdomain_active', default: true })
  subdomainActive: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
