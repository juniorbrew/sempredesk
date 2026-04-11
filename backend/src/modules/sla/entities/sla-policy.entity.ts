import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SystemPriority } from '../../../common/constants/priority.constants';

export { SystemPriority as SlaPriority };

/** Política SLA por tenant. Cada tenant pode ter até uma política por prioridade,
 *  mais uma política marcada como padrão (is_default = true). */
@Entity('sla_policies')
export class SlaPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  priority: SystemPriority;

  /** Tempo máximo (minutos) para a primeira resposta do agente. */
  @Column({ name: 'first_response_minutes', default: 60 })
  firstResponseMinutes: number;

  /** Tempo máximo (minutos) para resolução completa da conversa. */
  @Column({ name: 'resolution_minutes', default: 480 })
  resolutionMinutes: number;

  /** Política utilizada quando nenhuma priorit específica for encontrada. */
  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
