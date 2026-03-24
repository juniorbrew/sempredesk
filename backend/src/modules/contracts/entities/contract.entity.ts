import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';

export enum ContractStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  SUSPENDED = 'suspended',
}

export enum ContractType {
  HOURS_BANK = 'hours_bank',
  MONTHLY = 'monthly',
  ON_DEMAND = 'on_demand',
  WARRANTY = 'warranty',
}

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column({ name: 'contract_type', type: 'enum', enum: ContractType, default: ContractType.MONTHLY })
  contractType: ContractType;

  @Column({ name: 'monthly_hours', type: 'int', default: 0 })
  monthlyHours: number;

  @Column({ name: 'sla_response_hours', type: 'int', default: 4 })
  slaResponseHours: number;

  @Column({ name: 'sla_resolve_hours', type: 'int', default: 24 })
  slaResolveHours: number;

  @Column({ name: 'monthly_value', type: 'decimal', precision: 10, scale: 2, default: 0 })
  monthlyValue: number;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string;

  @Column({ name: 'services_included', type: 'jsonb', default: [] })
  servicesIncluded: string[];

  @Column({ name: 'ticket_limit', type: 'int', default: 0 })
  ticketLimit: number;

  @Column({ name: 'hours_used', type: 'decimal', precision: 10, scale: 2, default: 0 })
  hoursUsed: number;

  @Column({ name: 'tickets_used', type: 'int', default: 0 })
  ticketsUsed: number;

  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.ACTIVE })
  status: ContractStatus;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
