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

  @Column({ name: 'tenant_id', unique: true })
  tenantId: string;

  @Column({ type: 'enum', enum: WhatsappProvider, default: WhatsappProvider.BAILEYS })
  provider: WhatsappProvider;

  @Column({ type: 'enum', enum: WhatsappConnectionStatus, default: WhatsappConnectionStatus.DISCONNECTED })
  status: WhatsappConnectionStatus;

  @Column({ name: 'phone_number', nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'meta_phone_number_id', nullable: true })
  metaPhoneNumberId: string | null;

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
