import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Ticket, TicketMessage } from './ticket.entity';

/**
 * Anexo de resposta pública do ticket (arquivo em storage), não confundir com mídia de conversa/WhatsApp.
 * ETAPA 1: tabela + entidade; persistência via serviço virá nas etapas seguintes.
 */
@Entity('ticket_reply_attachments')
export class TicketReplyAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'ticket_id' })
  ticketId: string;

  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'ticket_message_id', type: 'uuid' })
  ticketMessageId: string;

  @ManyToOne(() => TicketMessage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_message_id' })
  ticketMessage: TicketMessage;

  /** Caminho lógico no storage (ex.: prefixo tenant + ticket + ficheiro). */
  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'mime', type: 'varchar', length: 256, nullable: true })
  mime: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: string | null;

  @Column({ name: 'original_filename', type: 'text', nullable: true })
  originalFilename: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
