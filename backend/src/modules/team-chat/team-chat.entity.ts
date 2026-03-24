import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('team_chat_messages')
export class TeamChatMessage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'author_id' }) authorId: string;
  @Column({ name: 'author_name' }) authorName: string;
  @Column({ type: 'text' }) content: string;
  @Column({ name: 'channel', default: 'general' }) channel: string;
  @Column({ name: 'reply_to', nullable: true }) replyTo: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
