import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PauseReason } from './pause-reason.entity';

export type PauseRequestStatus =
  | 'pending'    // aguardando aprovação do supervisor
  | 'approved'   // aprovada — transição interna imediata para 'active'
  | 'rejected'   // rejeitada pelo supervisor
  | 'active'     // pausa em andamento (agente fora da distribuição)
  | 'finished'   // encerrada normalmente
  | 'cancelled'; // cancelada pelo próprio agente antes de ser revisada

@Entity('agent_pause_requests')
@Index('idx_pause_req_tenant_agent', ['tenantId', 'agentId'])
@Index('idx_pause_req_status', ['tenantId', 'status'])
export class AgentPauseRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  // ── Agente ───────────────────────────────────────────────────────────────────

  @Column({ name: 'agent_id' })
  agentId: string;

  @Column({ name: 'agent_name', nullable: true })
  agentName: string;

  // ── Motivo ───────────────────────────────────────────────────────────────────

  @Column({ name: 'reason_id' })
  reasonId: string;

  @ManyToOne(() => PauseReason, { eager: false, nullable: true })
  @JoinColumn({ name: 'reason_id' })
  reason: PauseReason;

  @Column({ name: 'reason_name' })
  reasonName: string;

  // ── Observações ──────────────────────────────────────────────────────────────

  @Column({ name: 'agent_observation', nullable: true, type: 'text' })
  agentObservation: string;

  @Column({ name: 'reviewer_observation', nullable: true, type: 'text' })
  reviewerObservation: string;

  // ── Status e workflow ────────────────────────────────────────────────────────

  @Column({ name: 'status', default: 'pending' })
  status: PauseRequestStatus;

  // ── Timestamps do workflow ───────────────────────────────────────────────────

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date;

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewer_name', nullable: true })
  reviewerName: string;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date;

  @Column({ name: 'duration_seconds', nullable: true })
  durationSeconds: number;

  // ── Auditoria de estado ──────────────────────────────────────────────────────

  /**
   * presence_status do agente antes da pausa (online/away/busy/offline).
   * Usado para restaurar o status correto ao encerrar a pausa.
   */
  @Column({ name: 'previous_presence_status', nullable: true })
  previousPresenceStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
