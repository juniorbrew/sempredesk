import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('calendar_webhook_subscriptions')
export class CalendarWebhookSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId: string;

  @Column({ length: 20 })
  provider: string;

  @Column({ name: 'provider_subscription_id', length: 500, nullable: true })
  providerSubscriptionId: string | null;

  @Column({ name: 'resource_uri', length: 500, nullable: true })
  resourceUri: string | null;

  @Column({ name: 'expiration_at', type: 'timestamptz', nullable: true })
  expirationAt: Date | null;

  @Column({ length: 20, default: 'active' })
  status: string;

  @Column({ name: 'last_notified_at', type: 'timestamptz', nullable: true })
  lastNotifiedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
