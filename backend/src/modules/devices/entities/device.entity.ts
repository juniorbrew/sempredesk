import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export enum DeviceType {
  PDV = 'pdv',
  SERVER = 'server',
  PRINTER = 'printer',
  ROUTER = 'router',
  OTHER = 'other',
}

export enum DeviceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  WARNING = 'warning',
  UNKNOWN = 'unknown',
}

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column()
  name: string;

  @Column({ name: 'device_type', type: 'enum', enum: DeviceType, default: DeviceType.PDV })
  deviceType: DeviceType;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @Column({ name: 'mac_address', nullable: true })
  macAddress: string;

  @Column({ name: 'system_version', nullable: true })
  systemVersion: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'enum', enum: DeviceStatus, default: DeviceStatus.UNKNOWN })
  status: DeviceStatus;

  @Column({ name: 'last_heartbeat', type: 'timestamptz', nullable: true })
  lastHeartbeat: Date;

  @Column({ name: 'heartbeat_token', unique: true })
  heartbeatToken: string;

  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, any>;

  @Column({ name: 'last_metrics', type: 'jsonb', nullable: true })
  lastMetrics: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('device_metrics')
@Index(['tenantId', 'deviceId', 'recordedAt'])
export class DeviceMetric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  cpu: number;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  memory: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  disk: number;

  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'NOW()' })
  recordedAt: Date;
}

@Entity('device_events')
export class DeviceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ default: 'info' })
  severity: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'ticket_id', nullable: true })
  ticketId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
