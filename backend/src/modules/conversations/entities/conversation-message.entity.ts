import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Conversation } from './conversation.entity';

/** Snapshot mínimo da mensagem citada — anexado em runtime, não persistido neste campo. */
export interface ReplyToSnapshot {
  id: string;
  authorName: string;
  content: string;
  mediaKind: string | null;
}

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

  /** image | audio quando há ficheiro (WhatsApp ou upload do agente). */
  @Column({ name: 'media_kind', type: 'varchar', length: 16, nullable: true })
  mediaKind: string | null;

  /** Caminho relativo sob CONVERSATION_MEDIA_DIR (ex.: {tenantId}/{file}). */
  @Column({ name: 'media_storage_key', type: 'text', nullable: true })
  mediaStorageKey: string | null;

  @Column({ name: 'media_mime', type: 'varchar', length: 128, nullable: true })
  mediaMime: string | null;

  /** ID externo da mensagem no WhatsApp (Baileys key.id). Nulo para mensagens de chat/portal. */
  @Column({ name: 'external_id', nullable: true, type: 'text' })
  externalId: string | null;

  /** Status de entrega WhatsApp: 'pending' | 'sent' | 'failed'. Nulo para canal não-WhatsApp. */
  @Column({ name: 'whatsapp_status', nullable: true, type: 'text' })
  whatsappStatus: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  /** ID da mensagem respondida (reply). Nullable; SET NULL se original for deletada. */
  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId: string | null;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  /** Snapshot da mensagem citada — populado em runtime pelo service, não é coluna. */
  replyTo?: ReplyToSnapshot | null;
}
