import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ChatbotMenuItem } from './chatbot-menu-item.entity';

@Entity('chatbot_configs')
export class ChatbotConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ default: 'Assistente Virtual' })
  name: string;

  @Column({ name: 'welcome_message', type: 'text', default: 'Olá! Seja bem-vindo. Como posso te ajudar hoje?' })
  welcomeMessage: string;

  @Column({ name: 'menu_title', default: 'Escolha uma das opções abaixo:' })
  menuTitle: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'channel_whatsapp', default: true })
  channelWhatsapp: boolean;

  @Column({ name: 'channel_web', default: false })
  channelWeb: boolean;

  @Column({ name: 'channel_portal', default: false })
  channelPortal: boolean;

  @Column({ name: 'transfer_message', type: 'text', default: 'Aguarde um momento, estou te conectando com um atendente...' })
  transferMessage: string;

  @Column({ name: 'no_agent_message', type: 'text', default: 'No momento todos os atendentes estão ocupados. Sua mensagem foi registrada e entraremos em contato em breve.' })
  noAgentMessage: string;

  @Column({ name: 'invalid_option_message', type: 'text', default: 'Opção inválida. Por favor, escolha uma das opções do menu:' })
  invalidOptionMessage: string;

  @Column({ name: 'session_timeout_minutes', default: 30 })
  sessionTimeoutMinutes: number;

  /** Solicitar CNPJ ao cliente antes de transferir para atendente */
  @Column({ name: 'collect_cnpj', default: true })
  collectCnpj: boolean;

  @Column({ name: 'cnpj_request_message', type: 'text', default: 'Para identificar sua empresa, informe o CNPJ (somente números) ou responda *pular*:' })
  cnpjRequestMessage: string;

  @Column({ name: 'cnpj_not_found_message', type: 'text', default: 'Empresa não encontrada. Não se preocupe, nosso atendente irá identificá-la.' })
  cnpjNotFoundMessage: string;

  @Column({ name: 'description_request_message', type: 'text', default: 'Antes de transferirmos o atendimento, descreva sua demanda no campo abaixo para agilizar o suporte.' })
  descriptionRequestMessage: string;

  @Column({ name: 'description_timeout_minutes', default: 3 })
  descriptionTimeoutMinutes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => ChatbotMenuItem, item => item.chatbot, { cascade: true, eager: true })
  menuItems: ChatbotMenuItem[];
}
