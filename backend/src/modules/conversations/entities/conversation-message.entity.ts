import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Conversation } from './conversation.entity';

@Entity('conversation_messages')
export class ConversationMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'conversation_id' })
  conversationId: string;

  @Column({ name: 'author_id', nullable: true })
  authorId: string;

  @Column({ name: 'author_type', default: 'user' })
  authorType: string;

  @Column({ name: 'author_name' })
  authorName: string;

  @Column({ name: 'content', type: 'text' })
  content: string;

  /** ID externo da mensagem no WhatsApp (Baileys key.id). Nulo para mensagens de chat/portal. */
  @Column({ name: 'external_id', nullable: true, type: 'text' })
  externalId: string | null;

  /** Status de entrega WhatsApp: 'pending' | 'sent' | 'failed'. Nulo para canal não-WhatsApp. */
  @Column({ name: 'whatsapp_status', nullable: true, type: 'text' })
  whatsappStatus: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;
}
