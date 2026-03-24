import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  UpdateDateColumn, OneToMany,
} from 'typeorm';

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  WAITING_CLIENT = 'waiting_client',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum TicketOrigin {
  PORTAL = 'portal',
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  PHONE = 'phone',
  INTERNAL = 'internal',
}

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'ticket_number', unique: true })
  ticketNumber: string;

  /** Nullable: tickets WhatsApp podem ficar sem cliente real até validação do agente */
  @Column({ name: 'client_id', nullable: true })
  clientId: string | null;

  @Column({ name: 'contact_id', nullable: true })
  contactId: string;

  @Column({ name: 'contract_id', nullable: true })
  contractId: string;

  @Column({ name: 'assigned_to', nullable: true })
  assignedTo: string;

  @Column({ type: 'enum', enum: TicketOrigin, default: TicketOrigin.PORTAL })
  origin: TicketOrigin;

  @Column({ type: 'enum', enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority: TicketPriority;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Column({ nullable: true })
  department: string;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  subcategory: string;

  @Column()
  subject: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'resolution_summary', type: 'text', nullable: true })
  resolutionSummary: string;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string;

  @Column({ name: 'sla_response_at', type: 'timestamptz', nullable: true })
  slaResponseAt: Date;

  @Column({ name: 'sla_resolve_at', type: 'timestamptz', nullable: true })
  slaResolveAt: Date;

  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date;

  /** Preenchido quando o ticket é atribuído automaticamente pelo round-robin */
  @Column({ name: 'auto_assigned_at', type: 'timestamptz', nullable: true })
  autoAssignedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date;

  @Column({ name: 'time_spent_min', type: 'int', default: 0 })
  timeSpentMin: number;

  @Column({ default: false })
  escalated: boolean;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'conversation_id', nullable: true })
  conversationId: string | null;

  @Column({ name: 'satisfaction_score', nullable: true })
  satisfactionScore: string | null; // 'approved' | 'rejected'

  @Column({ name: 'satisfaction_at', type: 'timestamptz', nullable: true })
  satisfactionAt: Date | null;

  /** true → agente optou por não vincular o contato a um cliente real */
  @Column({ name: 'unlinked_contact', default: false })
  unlinkedContact: boolean;

  /** Preenchido quando o agente confirma/seleciona o cliente real durante o atendimento */
  @Column({ name: 'customer_selected_at', type: 'timestamptz', nullable: true })
  customerSelectedAt: Date | null;

  @OneToMany(() => TicketMessage, (m) => m.ticket, { cascade: true })
  messages: TicketMessage[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export enum MessageType {
  COMMENT = 'comment',
  INTERNAL = 'internal',
  STATUS_CHANGE = 'status_change',
  SYSTEM = 'system',
}

@Entity('ticket_messages')
export class TicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'ticket_id' })
  ticketId: string;

  @Column({ name: 'author_id', nullable: true })
  authorId: string;

  @Column({ name: 'author_type', default: 'user' })
  authorType: string;

  @Column({ name: 'author_name' })
  authorName: string;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.COMMENT })
  messageType: MessageType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  attachments: any[];

  @Column({ nullable: true })
  channel: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  ticket: Ticket;
}
