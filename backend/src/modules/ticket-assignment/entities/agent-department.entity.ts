import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Pivot entre agente (User) e departamento.
 * departmentName usa o mesmo valor string que Ticket.department para match direto.
 */
@Entity('agent_departments')
@Index('uq_agent_dept', ['tenantId', 'userId', 'departmentName'], { unique: true })
export class AgentDepartment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'user_id' })
  userId: string;

  /** Igual ao valor em Ticket.department — mantido para compatibilidade */
  @Column({ name: 'department_name' })
  departmentName: string;

  /** UUID do ticket_settings correspondente — identificador estável a renomeações */
  @Column({ name: 'department_id', nullable: true })
  departmentId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
