import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { ChatbotConfig } from './chatbot-config.entity';

@Entity('chatbot_menu_items')
export class ChatbotMenuItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'chatbot_id' })
  chatbotId: string;

  @Column({ type: 'int' })
  order: number;

  @Column()
  label: string;

  /** 'auto_reply' | 'transfer' */
  @Column({ default: 'transfer' })
  action: string;

  @Column({ name: 'auto_reply_text', type: 'text', nullable: true })
  autoReplyText: string | null;

  /** department name to route to when action='transfer' */
  @Column({ nullable: true })
  department: string | null;

  @Column({ default: true })
  enabled: boolean;

  @ManyToOne(() => ChatbotConfig, c => c.menuItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatbot_id' })
  chatbot: ChatbotConfig;
}
