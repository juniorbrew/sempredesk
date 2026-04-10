import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum ConversationChannel {
  PORTAL = 'portal',
  WHATSAPP = 'whatsapp',
}

export enum ConversationStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

export enum ConversationInitiatedBy {
  CONTACT = 'contact',
  AGENT = 'agent',
}

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'client_id', nullable: true })
  clientId: string | null;

  @Column({ name: 'contact_id' })
  contactId: string;

  @Column({ type: 'enum', enum: ConversationChannel })
  channel: ConversationChannel;

  @Column({ type: 'enum', enum: ConversationStatus, default: ConversationStatus.ACTIVE })
  status: ConversationStatus;

  /** Ticket criado automaticamente - conversa só pode ser encerrada se tiver ticket vinculado */
  @Column({ name: 'ticket_id', nullable: true })
  ticketId: string | null;

  /** Alerta de chat ativado pelo cliente no pré-chat */
  @Column({ name: 'chat_alert', default: false })
  chatAlert: boolean;

  /** Quem iniciou: contact = cliente/contato (inbound, ticket auto); agent = atendente (outbound, ticket manual) */
  @Column({ name: 'initiated_by', type: 'enum', enum: ConversationInitiatedBy, default: ConversationInitiatedBy.CONTACT })
  initiatedBy: ConversationInitiatedBy;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[] | null;

  /**
   * ID do canal WhatsApp (whatsapp_connections.id) pelo qual esta conversa chegou.
   * Presente apenas em conversas com channel = WHATSAPP.
   * Usado para garantir que respostas saiam sempre pelo mesmo número que recebeu.
   * Nullable para compatibilidade retroativa com conversas criadas antes da migração 016.
   */
  @Column({ name: 'whatsapp_channel_id', nullable: true })
  whatsappChannelId: string | null;
}
