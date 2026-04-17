import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';

/**
 * Controla a posição do round-robin por departamento.
 * departmentName = '__global__' quando o ticket não tem departamento.
 */
@Entity('distribution_queues')
@Index('uq_dist_queue', ['tenantId', 'departmentName'], { unique: true })
export class DistributionQueue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** Nome do departamento ou '__global__' — mantido para compatibilidade */
  @Column({ name: 'department_name' })
  departmentName: string;

  /** UUID do ticket_settings correspondente — identificador estável a renomeações (null para __global__) */
  @Column({ name: 'department_id', nullable: true })
  departmentId: string | null;

  /** Último agente que recebeu um ticket neste departamento */
  @Column({ name: 'last_assigned_user_id', type: 'varchar', nullable: true })
  lastAssignedUserId: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
