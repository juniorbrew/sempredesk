import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { PauseReason } from './entities/pause-reason.entity';
import { AgentPauseRequest, PauseRequestStatus } from './entities/agent-pause-request.entity';
import { AgentAttendance } from '../attendance/attendance.entity';
import { User } from '../auth/user.entity';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { CreatePauseReasonDto, UpdatePauseReasonDto } from './dto/create-pause-reason.dto';
import { RequestPauseDto } from './dto/request-pause.dto';
import { ReviewPauseDto } from './dto/review-pause.dto';

/** Motivos padrão semeados em cada tenant na primeira chamada */
const DEFAULT_REASONS = [
  { name: 'Almoço',                sortOrder: 1 },
  { name: 'Intervalo',             sortOrder: 2 },
  { name: 'Reunião',               sortOrder: 3 },
  { name: 'Atendimento externo',   sortOrder: 4 },
  { name: 'Instalação de servidor',sortOrder: 5 },
  { name: 'Configuração de rede',  sortOrder: 6 },
  { name: 'Suporte interno',       sortOrder: 7 },
  { name: 'Outro',                 sortOrder: 8 },
];

@Injectable()
export class AgentPausesService implements OnModuleInit {
  private readonly logger = new Logger(AgentPausesService.name);

  /** Injetado via setter no app.module para evitar dependência circular */
  private assignmentSvc: any = null;
  setAssignmentService(svc: any) { this.assignmentSvc = svc; }

  onModuleInit() {
    // Verifica pausas expiradas a cada 30 segundos
    setInterval(() => this.autoEndExpiredPauses(), 30_000);
  }

  /** Encerra automaticamente pausas que ultrapassaram maxDurationMinutes */
  private async autoEndExpiredPauses(): Promise<void> {
    try {
      const expired = await this.dataSource.query<any[]>(`
        SELECT id, tenant_id, agent_id
          FROM agent_pause_requests
         WHERE status = 'active'
           AND max_duration_minutes IS NOT NULL
           AND started_at IS NOT NULL
           AND started_at + (max_duration_minutes * INTERVAL '1 minute') <= NOW()
      `);
      for (const row of expired) {
        try {
          const pause = await this.pauseRepo.findOne({ where: { id: row.id } });
          if (pause) await this.doEndPause(pause, 'system-auto', row.tenant_id);
        } catch (e: any) {
          this.logger.warn(`[pause:auto-end] falha em ${row.id}: ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[pause:auto-end] query falhou: ${e?.message}`);
    }
  }

  constructor(
    @InjectRepository(PauseReason)
    private readonly reasonRepo: Repository<PauseReason>,
    @InjectRepository(AgentPauseRequest)
    private readonly pauseRepo: Repository<AgentPauseRequest>,
    @InjectRepository(AgentAttendance)
    private readonly attendanceRepo: Repository<AgentAttendance>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly emitter: RealtimeEmitterService,
    private readonly presence: RealtimePresenceService,
  ) {}

  // ─── Motivos de pausa ────────────────────────────────────────────────────────

  async listReasons(tenantId: string): Promise<PauseReason[]> {
    const existing = await this.reasonRepo.find({
      where: { tenantId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    if (existing.length > 0) return existing;

    // Semeia motivos padrão na primeira chamada do tenant
    return this.seedDefaultReasons(tenantId);
  }

  async listAllReasons(tenantId: string): Promise<PauseReason[]> {
    return this.reasonRepo.find({
      where: { tenantId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createReason(tenantId: string, dto: CreatePauseReasonDto): Promise<PauseReason> {
    const reason = this.reasonRepo.create({
      tenantId,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? null,
      requiresApproval: dto.requiresApproval ?? true,
      active: dto.active ?? true,
      sortOrder: dto.sortOrder ?? 0,
      maxDurationMinutes: dto.maxDurationMinutes ?? null,
    });
    return this.reasonRepo.save(reason);
  }

  async updateReason(tenantId: string, id: string, dto: UpdatePauseReasonDto): Promise<PauseReason> {
    const reason = await this.reasonRepo.findOne({ where: { id, tenantId } });
    if (!reason) throw new NotFoundException('Motivo de pausa não encontrado');
    if (dto.name !== undefined) reason.name = dto.name.trim();
    if (dto.description !== undefined) reason.description = dto.description?.trim() ?? null;
    if (dto.requiresApproval !== undefined) reason.requiresApproval = dto.requiresApproval;
    if (dto.active !== undefined) reason.active = dto.active;
    if (dto.sortOrder !== undefined) reason.sortOrder = dto.sortOrder;
    if ('maxDurationMinutes' in dto) reason.maxDurationMinutes = dto.maxDurationMinutes ?? null;
    return this.reasonRepo.save(reason);
  }

  private async seedDefaultReasons(tenantId: string): Promise<PauseReason[]> {
    const entities = DEFAULT_REASONS.map((r) =>
      this.reasonRepo.create({ tenantId, ...r, requiresApproval: true, active: true }),
    );
    try {
      return await this.reasonRepo.save(entities);
    } catch {
      // Corrida de concorrência — retorna o que já existe
      return this.reasonRepo.find({
        where: { tenantId, active: true },
        order: { sortOrder: 'ASC' },
      });
    }
  }

  // ─── Solicitação de pausa (agente) ────────────────────────────────────────────

  /**
   * Agente solicita pausa. Retorna a solicitação com status:
   * - 'pending'  → motivo exige aprovação (vai para o supervisor)
   * - 'active'   → motivo não exige aprovação (pausa ativada imediatamente)
   */
  async requestPause(
    tenantId: string,
    agentId: string,
    agentName: string,
    dto: RequestPauseDto,
  ): Promise<AgentPauseRequest> {
    // Valida motivo fora da transação (leitura pura, sem impacto em concorrência)
    const reason = await this.reasonRepo.findOne({
      where: { id: dto.reasonId, tenantId, active: true },
    });
    if (!reason) throw new NotFoundException('Motivo de pausa não encontrado ou inativo');

    // Usa transação com lock para garantir que apenas uma solicitação seja criada por agente
    const saved = await this.dataSource.transaction(async (em) => {
      // Serializa concorrência: bloqueia a linha de presença do agente enquanto verifica
      await em.query(
        `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [agentId, tenantId],
      );

      // Verifica se já existe solicitação pendente ou pausa ativa (dentro do lock)
      const existing = await em.query<any[]>(
        `SELECT id, status FROM agent_pause_requests
          WHERE tenant_id = $1 AND agent_id = $2 AND status IN ('pending', 'active')
          LIMIT 1`,
        [tenantId, agentId],
      );
      if (existing.length > 0) {
        const s = existing[0].status;
        if (s === 'active') throw new BadRequestException('Já existe uma pausa ativa para este agente');
        throw new BadRequestException('Já existe uma solicitação de pausa pendente para este agente');
      }

      // Captura o status de presença atual para restaurar ao encerrar
      const userRows = await em.query<any[]>(
        `SELECT presence_status FROM users WHERE id = $1 AND tenant_id = $2`,
        [agentId, tenantId],
      );
      const previousPresenceStatus = userRows[0]?.presence_status ?? 'online';

      const result = await em.query<any[]>(
        `INSERT INTO agent_pause_requests
          (tenant_id, agent_id, agent_name, reason_id, reason_name, agent_observation,
           status, requested_at, previous_presence_status, max_duration_minutes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW(),$7,$8,NOW())
         RETURNING *`,
        [tenantId, agentId, agentName, reason.id, reason.name,
         dto.agentObservation ?? null, previousPresenceStatus,
         reason.maxDurationMinutes ?? null],
      );
      return result[0];
    });

    this.logger.log(`[pause:request] agente=${agentId} motivo="${reason.name}" tenant=${tenantId}`);

    // Notifica supervisores em tempo real
    this.emitter.emitToTenant(tenantId, 'pause:requested', {
      pauseRequestId: saved.id,
      agentId,
      agentName,
      reasonName: reason.name,
      agentObservation: dto.agentObservation ?? null,
      requestedAt: saved.requested_at,
    });

    // Se o motivo não exige aprovação, ativa imediatamente
    if (!reason.requiresApproval) {
      return this.activatePause(tenantId, saved.id, agentId, agentName, null, null);
    }

    return this.pauseRepo.findOne({ where: { id: saved.id } });
  }

  // ─── Aprovação (supervisor/admin) ─────────────────────────────────────────────

  async approvePause(
    tenantId: string,
    pauseRequestId: string,
    reviewerId: string,
    reviewerName: string,
    dto: ReviewPauseDto,
  ): Promise<AgentPauseRequest> {
    return this.dataSource.transaction(async (em) => {
      // Bloqueia a linha para evitar aprovação dupla em concorrência
      const rows = await em.query<any[]>(
        `SELECT * FROM agent_pause_requests
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [pauseRequestId, tenantId],
      );
      const req = rows[0];
      if (!req) throw new NotFoundException('Solicitação de pausa não encontrada');
      if (req.status !== 'pending') {
        throw new BadRequestException(`Solicitação não está pendente (status atual: ${req.status})`);
      }

      // Verifica se já existe pausa ativa para o agente
      const activeRows = await em.query<any[]>(
        `SELECT id FROM agent_pause_requests
          WHERE tenant_id = $1 AND agent_id = $2 AND status = 'active'`,
        [tenantId, req.agent_id],
      );
      if (activeRows.length > 0) {
        throw new BadRequestException('O agente já possui uma pausa ativa');
      }

      const now = new Date();

      // Atualiza solicitação → active
      await em.query(
        `UPDATE agent_pause_requests
            SET status = 'active',
                reviewed_at = $1,
                reviewed_by = $2,
                reviewer_name = $3,
                reviewer_observation = $4,
                started_at = $1
          WHERE id = $5`,
        [now, reviewerId, reviewerName, dto.reviewerObservation ?? null, pauseRequestId],
      );

      // Marca agente como busy na presença (exclui do round-robin)
      await em.query(
        `UPDATE users
            SET presence_status = 'busy', last_seen_at = $1
          WHERE id = $2 AND tenant_id = $3`,
        [now, req.agent_id, tenantId],
      );

      // Marca attendance como paused (exclui da atribuição manual)
      // Usa 'technical' como pauseType para compatibilidade com o campo legado
      await em.query(
        `UPDATE agent_attendance
            SET availability = 'paused',
                pause_type = 'technical',
                pause_start = $1,
                pause_end = NULL,
                pause_allowed_by = $2,
                pause_allowed_by_name = $3
          WHERE tenant_id = $4 AND user_id = $5 AND clock_out IS NULL`,
        [now, reviewerId, reviewerName, tenantId, req.agent_id],
      );

      this.logger.log(
        `[pause:approved] requestId=${pauseRequestId} agente=${req.agent_id} by=${reviewerId} tenant=${tenantId}`,
      );

      // Retorna apenas o id — o findOne acontece após o commit para evitar leitura stale
      return pauseRequestId;
    }).then(async (committedId) => {
      // Lê o estado já commitado
      const updated = await this.pauseRepo.findOne({ where: { id: committedId } });
      // Sincroniza Redis após a transação
      await this.presence.setBusy(tenantId, updated.agentId).catch(() => {});

      // Notifica tenant em tempo real
      this.emitter.emitToTenant(tenantId, 'pause:approved', {
        pauseRequestId: updated.id,
        agentId: updated.agentId,
        agentName: updated.agentName,
        reasonName: updated.reasonName,
        reviewerName,
        reviewerObservation: dto.reviewerObservation ?? null,
        startedAt: updated.startedAt,
      });

      // Notifica especificamente o agente (mesmo evento, frontend filtra por agentId)
      this.emitter.emitToTenant(tenantId, 'pause:status-changed', {
        pauseRequestId: updated.id,
        agentId: updated.agentId,
        status: 'active',
        reviewerName,
        reviewerObservation: dto.reviewerObservation ?? null,
      });

      // Dispara redistribute: agente saiu da distribuição
      if (this.assignmentSvc) {
        this.assignmentSvc.redistributeOnAgentOffline(tenantId, updated.agentId).catch(() => {});
      }

      return updated;
    });
  }

  // ─── Rejeição (supervisor/admin) ─────────────────────────────────────────────

  async rejectPause(
    tenantId: string,
    pauseRequestId: string,
    reviewerId: string,
    reviewerName: string,
    dto: ReviewPauseDto,
  ): Promise<AgentPauseRequest> {
    const req = await this.pauseRepo.findOne({ where: { id: pauseRequestId, tenantId } });
    if (!req) throw new NotFoundException('Solicitação de pausa não encontrada');
    if (req.status !== 'pending') {
      throw new BadRequestException(`Solicitação não está pendente (status atual: ${req.status})`);
    }

    const now = new Date();
    req.status = 'rejected';
    req.reviewedAt = now;
    req.reviewedBy = reviewerId;
    req.reviewerName = reviewerName;
    req.reviewerObservation = dto.reviewerObservation ?? null;
    const saved = await this.pauseRepo.save(req);

    this.logger.log(
      `[pause:rejected] requestId=${pauseRequestId} agente=${req.agentId} by=${reviewerId}`,
    );

    // Notifica o agente da rejeição
    this.emitter.emitToTenant(tenantId, 'pause:rejected', {
      pauseRequestId: saved.id,
      agentId: saved.agentId,
      agentName: saved.agentName,
      reviewerName,
      reviewerObservation: dto.reviewerObservation ?? null,
    });

    this.emitter.emitToTenant(tenantId, 'pause:status-changed', {
      pauseRequestId: saved.id,
      agentId: saved.agentId,
      status: 'rejected',
      reviewerName,
      reviewerObservation: dto.reviewerObservation ?? null,
    });

    return saved;
  }

  // ─── Encerramento da pausa (agente ou supervisor) ─────────────────────────────

  async endPause(
    tenantId: string,
    requestingUserId: string,
    requestingUserRole: string,
  ): Promise<AgentPauseRequest> {
    // Supervisor/admin pode encerrar pausa de qualquer agente via query param;
    // agente só pode encerrar a própria pausa.
    const activePause = await this.pauseRepo.findOne({
      where: { tenantId, agentId: requestingUserId, status: 'active' },
    });
    if (!activePause) {
      throw new NotFoundException('Nenhuma pausa ativa encontrada para este agente');
    }
    return this.doEndPause(activePause, requestingUserId, tenantId);
  }

  async endPauseForAgent(
    tenantId: string,
    agentId: string,
    requestingUserId: string,
  ): Promise<AgentPauseRequest> {
    const activePause = await this.pauseRepo.findOne({
      where: { tenantId, agentId, status: 'active' },
    });
    if (!activePause) {
      throw new NotFoundException('Nenhuma pausa ativa encontrada para este agente');
    }
    return this.doEndPause(activePause, requestingUserId, tenantId);
  }

  private async doEndPause(
    activePause: AgentPauseRequest,
    endedBy: string,
    tenantId: string,
  ): Promise<AgentPauseRequest> {
    const now = new Date();
    const durationSeconds = activePause.startedAt
      ? Math.floor((now.getTime() - activePause.startedAt.getTime()) / 1000)
      : 0;

    activePause.status = 'finished';
    activePause.endedAt = now;
    activePause.durationSeconds = durationSeconds;
    const saved = await this.pauseRepo.save(activePause);

    // Sempre restaura para online ao sair de pausa (decisão de negócio)
    const finalStatus = 'online';

    await this.userRepo.update(
      { id: activePause.agentId, tenantId },
      { presenceStatus: finalStatus as any, lastSeenAt: now },
    );

    // Restaura attendance
    const mins = Math.floor(durationSeconds / 60);
    await this.attendanceRepo.createQueryBuilder()
      .update()
      .set({
        availability: 'online' as any,
        pauseEnd: now,
        totalPauseMinutes: () => `total_pause_minutes + ${mins}`,
      })
      .where('tenant_id = :tenantId AND user_id = :userId AND clock_out IS NULL', {
        tenantId,
        userId: activePause.agentId,
      })
      .execute();

    // Sincroniza Redis
    await this.presence.setOnline(tenantId, activePause.agentId).catch(() => {});

    this.logger.log(
      `[pause:ended] requestId=${saved.id} agente=${activePause.agentId} ` +
      `duração=${durationSeconds}s endedBy=${endedBy}`,
    );

    // Notifica tenant
    this.emitter.emitToTenant(tenantId, 'pause:ended', {
      pauseRequestId: saved.id,
      agentId: activePause.agentId,
      agentName: activePause.agentName,
      reasonName: activePause.reasonName,
      durationSeconds,
      endedAt: now,
    });

    this.emitter.emitToTenant(tenantId, 'pause:status-changed', {
      pauseRequestId: saved.id,
      agentId: activePause.agentId,
      status: 'finished',
    });

    // Rebalanceia: agente voltou para a distribuição
    if (this.assignmentSvc) {
      this.assignmentSvc.rebalanceOnAgentOnline(tenantId, activePause.agentId).catch(() => {});
    }

    return saved;
  }

  // ─── Cancelamento pelo agente ──────────────────────────────────────────────

  async cancelRequest(tenantId: string, agentId: string): Promise<AgentPauseRequest> {
    const req = await this.pauseRepo.findOne({
      where: { tenantId, agentId, status: 'pending' },
    });
    if (!req) throw new NotFoundException('Nenhuma solicitação pendente encontrada');

    req.status = 'cancelled';
    const saved = await this.pauseRepo.save(req);

    this.emitter.emitToTenant(tenantId, 'pause:cancelled', {
      pauseRequestId: saved.id,
      agentId,
    });

    return saved;
  }

  // ─── Consultas ───────────────────────────────────────────────────────────────

  /** Retorna a pausa ativa ou solicitação pendente do agente */
  async getMyPauseState(tenantId: string, agentId: string): Promise<AgentPauseRequest | null> {
    return this.pauseRepo.findOne({
      where: { tenantId, agentId, status: In(['pending', 'active']) },
      relations: ['reason'],
    });
  }

  /** Retorna todas as solicitações pendentes para o supervisor */
  async getPendingRequests(tenantId: string): Promise<AgentPauseRequest[]> {
    return this.pauseRepo.find({
      where: { tenantId, status: 'pending' },
      order: { requestedAt: 'ASC' },
    });
  }

  /** Histórico de pausas com filtros */
  async getHistory(
    tenantId: string,
    params: { agentId?: string; page?: number; perPage?: number },
  ) {
    const { agentId, page = 1, perPage = 30 } = params;
    const qb = this.pauseRepo
      .createQueryBuilder('r')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.status NOT IN (:...skip)', { skip: ['pending'] });

    if (agentId) qb.andWhere('r.agent_id = :agentId', { agentId });

    qb.orderBy('r.requested_at', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, totalPages: Math.ceil(total / perPage) };
  }

  // ─── Ativação direta (uso interno para motivos sem aprovação) ────────────────

  private async activatePause(
    tenantId: string,
    pauseRequestId: string,
    reviewerId: string,
    reviewerName: string,
    _reviewerObs: string | null,
    _startedAt: Date | null,
  ): Promise<AgentPauseRequest> {
    // Envolve as 3 operações em transação para garantir atomicidade
    await this.dataSource.transaction(async (em) => {
      const rows = await em.query<any[]>(
        `SELECT * FROM agent_pause_requests WHERE id = $1 FOR UPDATE`,
        [pauseRequestId],
      );
      const req = rows[0];
      if (!req) throw new NotFoundException('Solicitação não encontrada');

      const now = new Date();

      await em.query(
        `UPDATE agent_pause_requests
            SET status = 'active', reviewed_at = $1, reviewed_by = $2,
                reviewer_name = $3, started_at = $1
          WHERE id = $4`,
        [now, reviewerId, reviewerName, pauseRequestId],
      );

      await em.query(
        `UPDATE users SET presence_status = 'busy', last_seen_at = $1
          WHERE id = $2 AND tenant_id = $3`,
        [now, req.agent_id, tenantId],
      );

      await em.query(
        `UPDATE agent_attendance
            SET availability = 'paused', pause_type = 'technical',
                pause_start = $1, pause_end = NULL
          WHERE tenant_id = $2 AND user_id = $3 AND clock_out IS NULL`,
        [now, tenantId, req.agent_id],
      );
    });

    // Lê o estado já commitado — fora da transação para evitar leitura stale
    const saved = await this.pauseRepo.findOne({ where: { id: pauseRequestId } });

    // Sincroniza Redis fora da transação (best-effort)
    await this.presence.setBusy(tenantId, saved.agentId).catch(() => {});

    this.emitter.emitToTenant(tenantId, 'pause:approved', {
      pauseRequestId: saved.id,
      agentId: saved.agentId,
      agentName: saved.agentName,
      reasonName: saved.reasonName,
      startedAt: saved.startedAt,
    });

    this.emitter.emitToTenant(tenantId, 'pause:status-changed', {
      pauseRequestId: saved.id,
      agentId: saved.agentId,
      status: 'active',
    });

    if (this.assignmentSvc) {
      this.assignmentSvc.redistributeOnAgentOffline(tenantId, saved.agentId).catch(() => {});
    }

    return saved;
  }
}
