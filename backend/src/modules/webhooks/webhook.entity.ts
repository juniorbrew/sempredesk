import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('webhooks')
export class Webhook {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column() name: string;
  @Column() url: string;
  @Column({ nullable: true }) secret: string;
  @Column({ default: true }) active: boolean;
  @Column({ type: 'simple-array', default: 'ticket.created,ticket.updated,ticket.resolved' }) events: string[];
  @Column({ name: 'last_fired_at', type: 'timestamptz', nullable: true }) lastFiredAt: Date;
  @Column({ name: 'last_status', nullable: true }) lastStatus: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
