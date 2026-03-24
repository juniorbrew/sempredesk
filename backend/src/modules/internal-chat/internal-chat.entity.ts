import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('internal_chat_messages')
export class InternalChatMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'sender_id' }) senderId: string;
  @Column({ name: 'sender_name' }) senderName: string;
  @Column({ name: 'recipient_id', nullable: true }) recipientId: string | null;
  @Column({ type: 'text' }) content: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
