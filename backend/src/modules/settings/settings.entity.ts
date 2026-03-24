import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tenant_settings')
export class TenantSettings {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ nullable: true }) companyName: string;
  @Column({ nullable: true }) companyEmail: string;
  @Column({ nullable: true }) companyPhone: string;
  @Column({ nullable: true }) companyAddress: string;
  @Column({ nullable: true }) companyCnpj: string;
  @Column({ nullable: true }) companyLogo: string;
  @Column({ nullable: true, default: '#6366F1' }) primaryColor: string;
  @Column({ nullable: true, default: '#4F46E5' }) secondaryColor: string;
  @Column({ nullable: true }) smtpHost: string;
  @Column({ nullable: true }) smtpPort: string;
  @Column({ nullable: true }) smtpUser: string;
  @Column({ nullable: true }) smtpPass: string;
  @Column({ nullable: true }) smtpFrom: string;
  @Column({ nullable: true, default: 'false' }) smtpSecure: string;
  @Column({ nullable: true, default: '72' }) slaLowHours: string;
  @Column({ nullable: true, default: '48' }) slaMediumHours: string;
  @Column({ nullable: true, default: '24' }) slaHighHours: string;
  @Column({ nullable: true, default: '4' }) slaCriticalHours: string;
  @Column({ type: 'jsonb', default: {} }) alertSettings: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true, default: null }) businessHours: Record<string, any>;
  @Column({ type: 'simple-array', nullable: true }) holidays: string[];
  @Column({ name: 'ticket_created_notify', default: 'false' }) ticketCreatedNotify: string;
  @Column({ name: 'ticket_resolved_notify', default: 'true' }) ticketResolvedNotify: string;
  @Column({ name: 'sla_warning_notify', default: 'true' }) slaWarningNotify: string;
  @Column({ name: 'escalation_email', nullable: true }) escalationEmail: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
