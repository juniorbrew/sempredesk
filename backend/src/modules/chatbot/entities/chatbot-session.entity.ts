import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('chatbot_sessions')
export class ChatbotSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** phone number or web session token */
  @Column()
  identifier: string;

  /** 'whatsapp' | 'web' | 'portal' */
  @Column({ default: 'whatsapp' })
  channel: string;

  /** 'welcome' | 'awaiting_menu' | 'awaiting_cnpj' | 'awaiting_description' | 'transferred' | 'awaiting_rating' | 'awaiting_rating_comment' */
  @Column({ default: 'welcome' })
  step: string;

  @Column({ name: 'conversation_id', nullable: true })
  conversationId: string | null;

  @Column({ name: 'contact_id', nullable: true })
  contactId: string | null;

  /** Dados temporários do fluxo (departamento pendente, clientId detectado, tentativas) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  /**
   * ID do canal WhatsApp (whatsapp_connections.id) pelo qual esta sessão chegou.
   * Propagado desde o webhook inbound para garantir que as respostas do chatbot
   * saiam sempre pelo mesmo número que recebeu a mensagem do contato.
   * Nullable para compatibilidade retroativa e para sessões web/portal.
   */
  @Column({ name: 'whatsapp_channel_id', nullable: true })
  whatsappChannelId: string | null;

  /** ISO timestamp of last activity for expiry checks */
  @Column({ name: 'last_activity' })
  lastActivity: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
