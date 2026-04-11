import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum WhatsappProvider {
  BAILEYS = 'baileys',
  META = 'meta',
}

export enum WhatsappConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
}

@Entity('whatsapp_connections')
export class WhatsappConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Sem UNIQUE — permite múltiplos números por tenant.
   * O índice único é composto: (tenant_id, meta_phone_number_id).
   * @see migration 016_whatsapp_multi_channel.sql
   */
  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** Rótulo amigável exibido na interface: "Suporte", "Comercial", "Vendas", etc. */
  @Column({ length: 100, default: 'Principal' })
  label: string;

  /**
   * Indica o canal padrão do tenant.
   * Usado como fallback quando uma conversa/resposta não tem channelId explícito.
   * Apenas 1 registro por tenant deve ter is_default = true.
   */
  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ type: 'enum', enum: WhatsappProvider, default: WhatsappProvider.BAILEYS })
  provider: WhatsappProvider;

  @Column({ type: 'enum', enum: WhatsappConnectionStatus, default: WhatsappConnectionStatus.DISCONNECTED })
  status: WhatsappConnectionStatus;

  @Column({ name: 'phone_number', nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'meta_phone_number_id', nullable: true })
  metaPhoneNumberId: string | null;

  @Column({ name: 'meta_waba_id', nullable: true })
  metaWabaId: string | null;

  @Column({ name: 'meta_token', nullable: true, type: 'text' })
  metaToken: string | null;

  @Column({ name: 'meta_verify_token', nullable: true })
  metaVerifyToken: string | null;

  @Column({ name: 'meta_webhook_url', nullable: true })
  metaWebhookUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
