import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AgentDepartment } from './entities/agent-department.entity';
import { DistributionQueue } from './entities/distribution-queue.entity';
import { Ticket, TicketStatus } from '../tickets/entities/ticket.entity';
import { User, UserPresenceStatus } from '../auth/user.entity';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import type { PresenceStatus } from '../realtime/presence.types';

/** Chave de departamento quando o ticket não possui departamento */
const GLOBAL_DEPT_KEY = '__global__';

/** Alias público para uso no controller */
export type AgentPresenceStatus = UserPresenceStatus;

// ─── Tipos internos ──────────────────────────────────────────────────────────

interface QueueRow {
  id: string;
  last_assigned_user_id: string | null;
}

interface UserIdRow {
  id: string;
}

interface UserIdDeptRow {
  user_id: string;
}


interface StalePresenceRow {
  id: string;
  tenant_id: string;
  presence_status: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class TicketAssignmentService {
  private readonly logger = new Logger(TicketAssignmentService.name);

  /** Injetado via setter em app.module para evitar dependência circular */
  private pausesSvc: any = null;
  setPausesService(svc: any) { this.pausesSvc = svc; }

  constructor(
    @InjectRepository(AgentDepartment)
    private readonly agentDeptRepo: Repository<AgentDepartment>,
    @InjectRepository(DistributionQueue)
    private readonly queueRepo: Repository<DistributionQueue>,
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly presenceService: RealtimePresenceService,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  // ─── Atribuição automática ────────────────────────────────────────────────

  /**
   * Atribui automaticamente um ticket ao próximo agente disponível via round-robin.
   * Só age se o ticket ainda não possuir agente.
   * Retorna o agentId atribuído ou null se nenhum disponível.
   */
  async assignTicket(tenantId: string, ticketId: string): Promise<string | null> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenantId } });
    if (!ticket) {
      this.logger.warn(`[assign] ticket=${ticketId} não encontrado`);
      return null;
    }
    if (ticket.assignedTo) {
      this.logger.debug(`[assign] ticket=${ticket.ticketNumber} já atribuído → ${ticket.assignedTo}`);
      return ticket.assignedTo;
    }

    const dept = ticket.department ?? null;
    const agentId = await this.getNextAgent(tenantId, dept, ticket.departmentId ?? undefined);

    if (!agentId) {
      this.logger.warn(
        `[assign] ticket=${ticket.ticketNumber} dept="${dept ?? 'sem depto'}" → nenhum agente disponível`,
      );
      return null;
    }

    await this.ticketRepo.update(
      { id: ticketId, tenantId },
      {
        assignedTo: agentId,
        autoAssignedAt: new Date(),
        status: TicketStatus.IN_PROGRESS,
      } as Partial<Ticket>,
    );

    this.logger.log(
      `[assign] ✓ ticket=${ticket.ticketNumber} dept="${dept ?? 'global'}" → agent=${agentId}`,
    );

    // Notifica via realtime (não-crítico)
    try {
      this.emitter.emitToTenant(tenantId, 'ticket:assigned', {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        department: dept,
        assignedTo: agentId,   // campo normalizado — frontend usa assignedTo
        agentId,               // mantido para retrocompatibilidade
        assignedBy: null,      // null indica atribuição automática (round-robin)
        assignedByName: null,
        prevAssignedTo: null,
      });
    } catch {
      // silencioso
    }

    return agentId;
  }

  // ─── Round-Robin puro ────────────────────────────────────────────────────

  /**
   * Retorna o próximo agente disponível para o departamento via round-robin puro.
   *
   * Ordem de seleção:
   * 1. Agentes elegíveis para o departamento (ou todos, se sem departamento)
   * 2. Filtra pelos que estão online: Redis (WebSocket) ∪ DB (heartbeat HTTP)
   * 3. Ordena alfabeticamente por userId (lista estável, sem tiebreaker por carga)
   * 4. Avança o ponteiro circular → rodízio independente de tickets ativos
   *
   * SELECT FOR UPDATE garante atomicidade em alta concorrência.
   */
  async getNextAgent(tenantId: string, departmentName: string | null, departmentId?: string): Promise<string | null> {
    const deptKey = departmentName ?? GLOBAL_DEPT_KEY;

    return this.dataSource.transaction(async (em) => {
      // 1. Garante linha de queue (upsert atômico)
      await em.query(
        `INSERT INTO distribution_queues
           (id, tenant_id, department_name, last_assigned_user_id, updated_at)
         VALUES (gen_random_uuid(), $1, $2, NULL, NOW())
         ON CONFLICT (tenant_id, department_name) DO NOTHING`,
        [tenantId, deptKey],
      );

      // 2. Bloqueia linha para evitar dupla-atribuição simultânea
      const queueRows = await em.query<QueueRow[]>(
        `SELECT id, last_assigned_user_id
           FROM distribution_queues
          WHERE tenant_id = $1 AND department_name = $2
          FOR UPDATE`,
        [tenantId, deptKey],
      );
      const queue = queueRows[0] ?? null;

      // 3. IDs de agentes elegíveis para o departamento
      // Prefere correspondência por department_id (estável a renomeações) quando disponível,
      // com fallback para department_name em linhas que ainda não foram backfilladas.
      let eligibleIds: string[];
      if (departmentId) {
        const deptRows = await em.query<UserIdDeptRow[]>(
          `SELECT user_id FROM agent_departments
            WHERE tenant_id = $1
              AND (department_id = $2 OR (department_id IS NULL AND department_name = $3))`,
          [tenantId, departmentId, departmentName ?? ''],
        );
        eligibleIds = deptRows.map((r) => r.user_id);
      } else if (departmentName) {
        const deptRows = await em.query<UserIdDeptRow[]>(
          `SELECT user_id FROM agent_departments
            WHERE tenant_id = $1 AND department_name = $2`,
          [tenantId, departmentName],
        );
        eligibleIds = deptRows.map((r) => r.user_id);
      } else {
        // Sem departamento → todos técnicos/admin/manager ativos
        const allRows = await em.query<UserIdRow[]>(
          `SELECT id FROM users
            WHERE tenant_id = $1
              AND role IN ('technician','admin','manager')
              AND status = 'active'`,
          [tenantId],
        );
        eligibleIds = allRows.map((r) => r.id);
      }

      if (!eligibleIds.length) {
        this.logger.debug(`[getNextAgent] dept="${deptKey}": nenhum agente cadastrado`);
        return null;
      }

      // 4a. Presença via Redis (WebSocket — fonte primária)
      // Apenas agentes com status 'online' recebem tickets; away/busy são ignorados
      const { statusMap } = await this.presenceService.getOnlineIdsAndStatus(tenantId);
      const redisOnlineSet = new Set(
        Object.entries(statusMap)
          .filter(([, s]) => s === 'online')
          .map(([id]) => id),
      );

      // 4b. Presença via DB (heartbeat HTTP — fallback com tolerância de 5 min)
      // Idem: apenas 'online' (away/busy excluídos)
      const dbRows = await em.query<UserIdRow[]>(
        `SELECT id FROM users
          WHERE tenant_id = $1
            AND presence_status = 'online'
            AND last_seen_at > NOW() - INTERVAL '5 minutes'`,
        [tenantId],
      );
      const dbOnlineSet = new Set(dbRows.map((r) => r.id));

      // União das duas fontes
      let onlineEligible = eligibleIds.filter(
        (id) => redisOnlineSet.has(id) || dbOnlineSet.has(id),
      );

      if (!onlineEligible.length) {
        this.logger.debug(
          `[getNextAgent] dept="${deptKey}": nenhum online (elegíveis=${eligibleIds.length})`,
        );
        return null;
      }

      // 4c. Filtra por janela de disponibilidade para distribuição
      //     Agentes com distribution_availability_enabled=false são ignorados (comportamento original).
      //     Agentes com a regra ativa e sem horário configurado também são incluídos (segurança).
      if (onlineEligible.length > 0) {
        const now = new Date();
        const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        // IN com parâmetros individuais — mais compatível com TypeORM/node-postgres que ANY($1) com array
        const placeholders = onlineEligible.map((_, i) => `$${i + 1}`).join(', ');
        const availRows = await em.query<Array<{
          id: string;
          distribution_availability_enabled: boolean;
          distribution_start_time: string | null;
          distribution_end_time: string | null;
        }>>(
          `SELECT id, distribution_availability_enabled, distribution_start_time, distribution_end_time
             FROM users WHERE id IN (${placeholders})`,
          onlineEligible,
        );

        const availMap = new Map(availRows.map((r) => [r.id, r]));

        const beforeFilter = onlineEligible.length;
        onlineEligible = onlineEligible.filter((id) => {
          const a = availMap.get(id);
          // Regra desativada ou agente sem config → inclui normalmente (preserva comportamento atual)
          if (!a?.distribution_availability_enabled) return true;
          const start = a.distribution_start_time;
          const end = a.distribution_end_time;
          if (!start || !end) return true;
          // Janela normal ex: 08:00–18:00
          if (start <= end) return nowTime >= start && nowTime <= end;
          // Janela invertida ex: 22:00–06:00 (atravessa meia-noite)
          return nowTime >= start || nowTime <= end;
        });

        this.logger.log(
          `[getNextAgent:avail] hora=${nowTime} antes=${beforeFilter} depois=${onlineEligible.length} agentes`,
        );
      }

      if (!onlineEligible.length) {
        this.logger.debug(
          `[getNextAgent] dept="${deptKey}": nenhum disponível após filtro de janela horária`,
        );
        return null;
      }

      // 5. Ordem estável para rodízio: puramente alfabética por userId
      //    (rodízio independente da carga — o ponteiro circular avança sempre)
      const sorted = [...onlineEligible].sort((a, b) => a.localeCompare(b));

      // 6. Avança ponteiro circular sobre a lista ordenada
      //    — preserva progressão mesmo quando lastId saiu do pool (offline, removido, etc.)
      const lastId = queue?.last_assigned_user_id ?? null;
      let nextId: string;
      if (!lastId) {
        // Primeira atribuição neste departamento/tenant
        nextId = sorted[0];
      } else if (sorted.includes(lastId)) {
        // Caminho normal: avança para o próximo na sequência
        const idx = sorted.indexOf(lastId);
        nextId = sorted[(idx + 1) % sorted.length];
      } else {
        // lastId saiu do pool (agente offline, removido do depto, etc.)
        // Avança para o primeiro elegível que vem APÓS lastId na ordem estável,
        // evitando reiniciar sempre do zero e quebrando a equidade do rodízio.
        const nextAfterLast = sorted.find(id => id.localeCompare(lastId) > 0);
        nextId = nextAfterLast ?? sorted[0]; // wrap: lastId era o último alfabeticamente
      }

      // 7. Persiste novo ponteiro
      await em.query(
        `UPDATE distribution_queues
            SET last_assigned_user_id = $1, updated_at = NOW()
          WHERE tenant_id = $2 AND department_name = $3`,
        [nextId, tenantId, deptKey],
      );

      this.logger.debug(
        `[getNextAgent] dept="${deptKey}" sorted=[${sorted.join(',')}] last=${lastId ?? 'none'} → next=${nextId}`,
      );

      return nextId;
    });
  }

  // ─── Rebalanceamento: agente ONLINE ──────────────────────────────────────

  /**
   * Chamado quando um agente entra online (WebSocket join-tenant ou PATCH /me/status).
   * Busca tickets OPEN sem agente nos departamentos do agente e os distribui.
   */
  async rebalanceOnAgentOnline(tenantId: string, userId: string): Promise<void> {
    this.logger.log(`[rebalance:online] userId=${userId}`);

    const depts = await this.agentDeptRepo.find({ where: { tenantId, userId } });
    const deptIds = depts.map((d) => d.departmentId).filter((id): id is string => !!id);
    const deptNames = depts.map((d) => d.departmentName);

    let qb = this.ticketRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.assigned_to IS NULL')
      .andWhere('t.status = :status', { status: TicketStatus.OPEN });

    if (deptIds.length > 0) {
      qb = qb.andWhere(
        '(t.department_id IN (:...deptIds) OR (t.department_id IS NULL AND t.department IN (:...deptNames)) OR t.department IS NULL)',
        { deptIds, deptNames },
      );
    } else if (deptNames.length > 0) {
      qb = qb.andWhere(
        '(t.department IN (:...deptNames) OR t.department IS NULL)',
        { deptNames },
      );
    }

    const unassigned = await qb.orderBy('t.created_at', 'ASC').limit(30).getMany();

    this.logger.log(`[rebalance:online] ${unassigned.length} ticket(s) a distribuir`);

    for (const ticket of unassigned) {
      await this.assignTicket(tenantId, ticket.id).catch((err: unknown) =>
        this.logger.error(`[rebalance:online] falha ticket=${ticket.id}`, err),
      );
    }
  }

  // ─── Redistribuição: agente OFFLINE ──────────────────────────────────────

  /**
   * Chamado quando um agente fica offline.
   * Mantém os tickets já atribuídos ao agente — ele continua como responsável
   * e verá os tickets ao voltar. Apenas novos tickets não serão direcionados
   * a agentes offline (getNextAgent filtra por presença).
   */
  async redistributeOnAgentOffline(tenantId: string, userId: string): Promise<void> {
    this.logger.log(`[redistribute:offline] userId=${userId} — atribuições mantidas (agente pode retomar ao voltar online)`);
  }

  // ─── Transferência de departamento ──────────────────────────────────────

  /**
   * Chamado quando o departamento de um ticket muda.
   * Remove agente atual e reatribui para o novo departamento.
   */
  async reassignOnDepartmentChange(tenantId: string, ticketId: string): Promise<void> {
    this.logger.log(`[reassign:dept] ticketId=${ticketId}`);
    await this.ticketRepo.update(
      { id: ticketId, tenantId },
      {
        assignedTo: null as unknown as string,
        autoAssignedAt: null as unknown as Date,
      },
    );
    await this.assignTicket(tenantId, ticketId);
  }

  // ─── Presença via HTTP ───────────────────────────────────────────────────

  /**
   * PATCH /agents/me/status — atualiza status de presença manualmente.
   * Persiste no DB, sincroniza Redis e dispara rebalance/redistribute.
   */
  async updatePresenceStatus(
    tenantId: string,
    userId: string,
    status: AgentPresenceStatus,
  ): Promise<{ previous: AgentPresenceStatus; current: AgentPresenceStatus }> {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException(`Agente ${userId} não encontrado`);
    }

    // Bloqueia burla via HTTP: agente em pausa ativa não pode retornar para online/away/busy manual
    if (this.pausesSvc && status !== 'offline') {
      const activePause = await this.pausesSvc.getMyPauseState(tenantId, userId).catch(() => null);
      if (activePause?.status === 'active') {
        // Retorna o estado atual sem aplicar a mudança
        return { previous: user.presenceStatus ?? 'offline', current: user.presenceStatus ?? 'offline' };
      }
    }

    const previous: AgentPresenceStatus = user.presenceStatus ?? 'offline';

    await this.userRepo.update(
      { id: userId, tenantId },
      {
        presenceStatus: status,
        ...(status !== 'offline' ? { lastSeenAt: new Date() } : {}),
      },
    );

    // Sincroniza Redis (best-effort)
    if (status === 'offline') {
      await this.presenceService.setOffline(tenantId, userId).catch(() => {});
    } else {
      // Apenas atualiza se o agente já tiver entrada Redis (WebSocket ativo)
      await this.presenceService
        .setStatusAsync(tenantId, userId, status as PresenceStatus)
        .catch(() => {});
    }

    this.logger.log(`[presence:status] userId=${userId} ${previous} → ${status}`);

    // Dispara rebalance/redistribute assincronamente.
    // away e busy são tratados como indisponíveis: seus tickets voltam para a fila.
    // Ao retornar para 'online' a partir de qualquer status indisponível, recebe tickets novos.
    const UNAVAILABLE = ['offline', 'away', 'busy'];
    const wasUnavailable = UNAVAILABLE.includes(previous ?? 'offline');
    const isNowUnavailable = UNAVAILABLE.includes(status);

    if (wasUnavailable && !isNowUnavailable) {
      // ficou disponível → rebalancear (receber tickets não atribuídos)
      this.rebalanceOnAgentOnline(tenantId, userId).catch(() => {});
    } else if (!wasUnavailable && isNowUnavailable) {
      // ficou indisponível → devolver tickets à fila
      this.redistributeOnAgentOffline(tenantId, userId).catch(() => {});
    }

    return { previous, current: status };
  }

  /**
   * POST /agents/me/heartbeat — confirma que o agente está ativo.
   * Atualiza last_seen_at; se estava offline, volta para online.
   */
  async heartbeatFromHttp(
    tenantId: string,
    userId: string,
  ): Promise<{ status: AgentPresenceStatus; lastSeenAt: Date }> {
    const user = await this.userRepo.findOne({ where: { id: userId, tenantId } });
    const wasOffline = !user || user.presenceStatus === 'offline' || user.presenceStatus === null;
    const currentStatus: AgentPresenceStatus = wasOffline
      ? 'online'
      : (user.presenceStatus ?? 'online');
    const now = new Date();

    await this.userRepo.update(
      { id: userId, tenantId },
      { lastSeenAt: now, presenceStatus: currentStatus },
    );

    if (wasOffline) {
      this.logger.log(`[presence:heartbeat] userId=${userId} voltou online via HTTP`);
      this.rebalanceOnAgentOnline(tenantId, userId).catch(() => {});
    }

    return { status: currentStatus, lastSeenAt: now };
  }

  /**
   * Detecta agentes cujo last_seen_at excedeu 5 min e os marca offline.
   * Chamado pelo scheduler a cada 2 minutos.
   */
  async markOfflineByDbTimeout(): Promise<void> {
    const cutoff = new Date(Date.now() - 5 * 60_000);

    const stale = await this.dataSource.query<StalePresenceRow[]>(
      `SELECT id, tenant_id, presence_status
         FROM users
        WHERE presence_status IS NOT NULL
          AND presence_status != 'offline'
          AND last_seen_at IS NOT NULL
          AND last_seen_at < $1`,
      [cutoff],
    );

    if (!stale.length) return;

    this.logger.log(`[presence:timeout] ${stale.length} agente(s) com heartbeat expirado`);

    for (const row of stale) {
      this.logger.warn(
        `[presence:timeout] userId=${row.id} tenant=${row.tenant_id} ${row.presence_status} → offline`,
      );
      await this.userRepo.update({ id: row.id }, { presenceStatus: 'offline' });
      await this.presenceService.setOffline(row.tenant_id, row.id).catch(() => {});
      await this.redistributeOnAgentOffline(row.tenant_id, row.id).catch((err: unknown) =>
        this.logger.error(`[presence:timeout] redistribuição falhou userId=${row.id}`, err),
      );
    }
  }

  // ─── Gestão de departamentos ─────────────────────────────────────────────

  async getAgentDepartments(tenantId: string, userId: string): Promise<AgentDepartment[]> {
    return this.agentDeptRepo.find({ where: { tenantId, userId } });
  }

  async setAgentDepartments(
    tenantId: string,
    userId: string,
    departmentNames: string[],
  ): Promise<AgentDepartment[]> {
    await this.agentDeptRepo.delete({ tenantId, userId });
    if (!departmentNames.length) return [];

    const idRows = await this.dataSource.query<Array<{ name: string; id: string }>>(
      `SELECT name, id FROM ticket_settings WHERE tenant_id = $1 AND type = 'department'`,
      [tenantId],
    );
    const nameToId = new Map(idRows.map((r) => [r.name.toLowerCase().trim(), r.id]));

    const entities = departmentNames.map((name) =>
      this.agentDeptRepo.create({
        tenantId,
        userId,
        departmentName: name,
        departmentId: nameToId.get(name.toLowerCase().trim()) ?? null,
      }),
    );
    const saved = await this.agentDeptRepo.save(entities);
    this.logger.log(`[setDepts] userId=${userId} deptos=[${departmentNames.join(', ')}]`);
    return saved;
  }

  /**
   * Retorna agentes de um departamento com status de presença combinado (Redis + DB).
   */
  async getDepartmentAgents(
    tenantId: string,
    departmentName: string,
  ): Promise<Array<{ userId: string; status: AgentPresenceStatus }>> {
    const rows = await this.agentDeptRepo.find({ where: { tenantId, departmentName } });
    if (!rows.length) return [];

    const { statusMap } = await this.presenceService.getOnlineIdsAndStatus(tenantId);

    // Para agentes não no Redis, busca presença do DB
    const missingIds = rows.map((r) => r.userId).filter((id) => !(id in statusMap));
    const dbStatuses = new Map<string, AgentPresenceStatus>();
    if (missingIds.length) {
      const dbUsers = await this.userRepo.find({
        where: { id: In(missingIds), tenantId },
        select: ['id', 'presenceStatus'],
      });
      for (const u of dbUsers) {
        dbStatuses.set(u.id, u.presenceStatus ?? 'offline');
      }
    }

    return rows.map((r) => ({
      userId: r.userId,
      status: (statusMap[r.userId] ?? dbStatuses.get(r.userId) ?? 'offline') as AgentPresenceStatus,
    }));
  }
}
