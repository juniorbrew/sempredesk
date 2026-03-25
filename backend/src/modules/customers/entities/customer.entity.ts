import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ nullable: true, length: 6 }) code: string;
  @Column({ name: 'network_id', nullable: true }) networkId: string;
  @Column({ name: 'company_name', length: 200 }) companyName: string;
  @Column({ name: 'trade_name', nullable: true, length: 200 }) tradeName: string;
  @Column({ nullable: true, length: 18 }) cnpj: string;
  @Column({ nullable: true, length: 50 }) ie: string;
  @Column({ nullable: true, length: 300 }) address: string;
  @Column({ nullable: true, length: 20 }) number: string;
  @Column({ nullable: true, length: 100 }) complement: string;
  @Column({ nullable: true, length: 100 }) neighborhood: string;
  @Column({ nullable: true, length: 100 }) city: string;
  @Column({ nullable: true, length: 2 }) state: string;
  @Column({ name: 'zip_code', nullable: true, length: 10 }) zipCode: string;
  @Column({ nullable: true, type: 'text' }) reference: string;
  @Column({ nullable: true, length: 20 }) phone: string;
  @Column({ nullable: true, length: 20 }) whatsapp: string;
  @Column({ nullable: true, length: 200 }) email: string;
  @Column({ nullable: true, length: 200 }) website: string;
  @Column({ length: 30, default: 'active' }) status: string;
  @Column({ name: 'support_plan', nullable: true, length: 50 }) supportPlan: string;
  @Column({ name: 'client_since', nullable: true, length: 7 }) clientSince: string;
  @Column({ nullable: true, type: 'text' }) notes: string;
  @Column({ type: 'jsonb', default: {} }) metadata: Record<string, any>;
  @OneToMany(() => Contact, (c) => c.client) contacts: Contact[];
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

@Entity('contacts')
export class Contact {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'client_id', nullable: true }) clientId: string | null;
  @ManyToOne(() => Client, (c) => c.contacts, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'client_id' }) client: Client | null;
  @Column({ length: 200 }) name: string;
  @Column({ nullable: true, length: 100 }) role: string;
  @Column({ nullable: true, length: 100 }) department: string;
  @Column({ nullable: true, length: 20 }) phone: string;
  @Column({ nullable: true, length: 200 }) email: string;
  @Column({ nullable: true, length: 20 }) whatsapp: string;
  @Column({ name: 'preferred_channel', length: 30, default: 'email' }) preferredChannel: string;
  @Column({ name: 'can_open_tickets', default: true }) canOpenTickets: boolean;
  @Column({ length: 30, default: 'active' }) status: string;
  @Column({ name: 'portal_password', nullable: true, length: 255 }) portalPassword: string;
  @Column({ nullable: true, type: 'text' }) notes: string;
  @Column({ name: 'is_primary', default: false }) isPrimary: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
