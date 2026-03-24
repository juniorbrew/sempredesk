import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type PauseType = 'lunch' | 'bathroom' | 'technical' | 'personal';
export type AgentAvailability = 'online' | 'paused' | 'offline';

@Entity('agent_attendance')
export class AgentAttendance {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'tenant_id' }) tenantId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'user_name', nullable: true }) userName: string;
  @Column({ name: 'user_email', nullable: true }) userEmail: string;
  @Column({ name: 'user_role', nullable: true }) userRole: string;
  @Column({ type: 'timestamp', name: 'clock_in' }) clockIn: Date;
  @Column({ type: 'timestamp', name: 'clock_out', nullable: true }) clockOut: Date;
  @Column({ nullable: true }) notes: string;
  @Column({ name: 'ip_address', nullable: true }) ipAddress: string;

  // Pausas
  @Column({ name: 'pause_type', nullable: true }) pauseType: PauseType;
  @Column({ type: 'timestamp', name: 'pause_start', nullable: true }) pauseStart: Date;
  @Column({ type: 'timestamp', name: 'pause_end', nullable: true }) pauseEnd: Date;
  @Column({ name: 'pause_allowed_by', nullable: true }) pauseAllowedBy: string;
  @Column({ name: 'pause_allowed_by_name', nullable: true }) pauseAllowedByName: string;
  @Column({ name: 'total_pause_minutes', default: 0 }) totalPauseMinutes: number;

  // Status atual
  @Column({ name: 'availability', default: 'online' }) availability: AgentAvailability;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
