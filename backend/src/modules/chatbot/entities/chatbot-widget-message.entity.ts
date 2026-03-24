import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Stores messages for web widget sessions (polling-based) */
@Entity('chatbot_widget_messages')
export class ChatbotWidgetMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'session_id' })
  sessionId: string;

  /** 'bot' | 'user' | 'agent' */
  @Column()
  role: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
