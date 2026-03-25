import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, IsNull } from 'typeorm';
import { AgentAttendance, PauseType } from './attendance.entity';

const PAUSE_LABELS: Record<PauseType, string> = {
  lunch:     'Almoço / Refeição',
  bathroom:  'Banheiro / Fisiológica',
  technical: 'Pausa Técnica',
  personal:  'Pausa Pessoal',
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AgentAttendance)
    private readonly repo: Repository<AgentAttendance>,
  ) {}

  async clockIn(tenantId: string, userId: string, userName: string, userEmail: string, userRole: string, ipAddress?: string) {
    const open = await this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
    if (open) return { alreadyOpen: true, record: open };
    const record = this.repo.create({
      tenantId, userId, userName, userEmail, userRole,
      clockIn: new Date(), ipAddress, availability: 'online',
    });
    return this.repo.save(record);
  }

  async clockOut(tenantId: string, userId: string, notes?: string) {
    const open = await this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
    if (!open) return null; // saída silenciosa se não tinha ponto aberto
    // encerrar pausa pendente se houver
    if (open.pauseStart && !open.pauseEnd) {
      const mins = Math.floor((Date.now() - open.pauseStart.getTime()) / 60000);
      open.pauseEnd = new Date();
      open.totalPauseMinutes = (open.totalPauseMinutes || 0) + mins;
    }
    open.clockOut = new Date();
    open.availability = 'offline';
    if (notes) open.notes = notes;
    return this.repo.save(open);
  }

  async getOpenRecord(tenantId: string, userId: string) {
    return this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
  }

  async startPause(tenantId: string, userId: string, pauseType: PauseType, requestedBy: any) {
    const open = await this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
    if (!open) throw new NotFoundException('Nenhum ponto aberto encontrado');
    if (open.pauseStart && !open.pauseEnd) throw new ForbiddenException('Já existe uma pausa em andamento');

    // Pausa técnica requer autorização de admin ou manager
    if (pauseType === 'technical') {
      const requesterRole = requestedBy.role;
      const isSelf = requestedBy.id === userId;
      const canAuthorize = ['admin', 'super_admin', 'manager'].includes(requesterRole);
      if (isSelf && !canAuthorize) {
        throw new ForbiddenException('Pausa técnica requer autorização de um administrador ou gerente');
      }
    }

    open.pauseType = pauseType;
    open.pauseStart = new Date();
    open.pauseEnd = null;
    open.availability = 'paused';
    if (['admin', 'super_admin', 'manager'].includes(requestedBy.role)) {
      open.pauseAllowedBy = requestedBy.id;
      open.pauseAllowedByName = requestedBy.name;
    }
    return this.repo.save(open);
  }

  async endPause(tenantId: string, userId: string) {
    const open = await this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
    if (!open) throw new NotFoundException('Nenhum ponto aberto encontrado');
    if (!open.pauseStart || open.pauseEnd) throw new ForbiddenException('Nenhuma pausa em andamento');

    const mins = Math.floor((Date.now() - open.pauseStart.getTime()) / 60000);
    open.pauseEnd = new Date();
    open.totalPauseMinutes = (open.totalPauseMinutes || 0) + mins;
    open.availability = 'online';
    return this.repo.save(open);
  }

  async authorizeTechnicalPause(tenantId: string, targetUserId: string, authorizer: any) {
    const canAuthorize = ['admin', 'super_admin', 'manager'].includes(authorizer.role);
    if (!canAuthorize) throw new ForbiddenException('Sem permissão para autorizar pausas técnicas');
    return this.startPause(tenantId, targetUserId, 'technical', authorizer);
  }

  async isAvailable(tenantId: string, userId: string): Promise<boolean> {
    const open = await this.repo.findOne({ where: { tenantId, userId, clockOut: IsNull() } });
    if (!open) return false;
    return open.availability === 'online';
  }

  async getRecords(tenantId: string, params: any) {
    const { userId, startDate, endDate, page = 1, perPage = 30 } = params;
    const where: any = { tenantId };
    if (userId) where.userId = userId;
    if (startDate && endDate) where.clockIn = Between(new Date(startDate), new Date(endDate));
    const [data, total] = await this.repo.findAndCount({
      where, order: { clockIn: 'DESC' },
      skip: (page - 1) * perPage, take: Number(perPage),
    });
    return { data, total, totalPages: Math.ceil(total / perPage) };
  }

  async getTodaySummary(tenantId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const records = await this.repo.find({
      where: { tenantId, clockIn: Between(today, tomorrow) },
      order: { clockIn: 'DESC' },
    });
    return {
      records,
      online:  records.filter(r => !r.clockOut && r.availability === 'online').length,
      paused:  records.filter(r => !r.clockOut && r.availability === 'paused').length,
      offline: records.filter(r => r.clockOut).length,
      total:   records.length,
    };
  }

  /**
   * Returns queue management stats:
   * - agents: all agents clocked in today with their availability and active ticket count
   * - queue: unassigned active chat tickets (whatsapp/portal) waiting for attribution
   */
  async getQueueStats(tenantId: string) {
    // All agents currently clocked in (no clock-out)
    const agentRecords = await this.repo.find({
      where: { tenantId, clockOut: IsNull() },
      order: { clockIn: 'ASC' },
    });

    const agentIds = agentRecords.map(r => r.userId);

    // Active ticket count per agent
    let ticketRows: { assigned_to: string; count: string }[] = [];
    if (agentIds.length > 0) {
      ticketRows = await this.repo.manager.query(
        `SELECT assigned_to, COUNT(*)::int AS count
         FROM tickets
         WHERE tenant_id = $1
           AND assigned_to = ANY($2::text[])
           AND status IN ('open','in_progress','waiting_client')
         GROUP BY assigned_to`,
        [tenantId, agentIds],
      );
    }

    // Active conversation count per agent (open chat conversations with a ticket linked to this agent)
    let convRows: { assigned_to: string; count: string }[] = [];
    if (agentIds.length > 0) {
      convRows = await this.repo.manager.query(
        `SELECT t.assigned_to, COUNT(*)::int AS count
         FROM conversations c
         JOIN tickets t ON t.id::text = c.ticket_id::text AND t.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1
           AND c.status = 'active'
           AND t.assigned_to = ANY($2::text[])
         GROUP BY t.assigned_to`,
        [tenantId, agentIds],
      );
    }

    // Tickets finalizados hoje por agente
    let finishedRows: { assigned_to: string; count: string }[] = [];
    if (agentIds.length > 0) {
      finishedRows = await this.repo.manager.query(
        `SELECT assigned_to, COUNT(*)::int AS count
         FROM tickets
         WHERE tenant_id = $1
           AND assigned_to = ANY($2::text[])
           AND status = 'resolved'
           AND updated_at >= CURRENT_DATE
         GROUP BY assigned_to`,
        [tenantId, agentIds],
      );
    }

    // Lista de conversas ativas por agente (para hover no painel do supervisor)
    let convListRows: any[] = [];
    if (agentIds.length > 0) {
      convListRows = await this.repo.manager.query(
        `SELECT c.id, c.channel, c.status,
                COALESCE(ct.name, ct.phone, ct.email, '') AS contact_name,
                t.assigned_to, t.ticket_number, t.id AS ticket_id,
                c.last_message_at
         FROM conversations c
         JOIN tickets t ON t.id::text = c.ticket_id::text AND t.tenant_id = c.tenant_id
         LEFT JOIN contacts ct ON ct.id::text = c.contact_id::text AND ct.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1
           AND c.status = 'active'
           AND t.assigned_to = ANY($2::text[])
         ORDER BY c.last_message_at DESC NULLS LAST`,
        [tenantId, agentIds],
      );
    }

    const ticketCountMap: Record<string, number> = {};
    const convCountMap:   Record<string, number> = {};
    const finishedMap:    Record<string, number> = {};
    const convListMap:    Record<string, any[]>  = {};
    agentIds.forEach(id => {
      ticketCountMap[id] = 0;
      convCountMap[id]   = 0;
      finishedMap[id]    = 0;
      convListMap[id]    = [];
    });
    ticketRows.forEach(r   => { ticketCountMap[r.assigned_to] = Number(r.count); });
    convRows.forEach(r     => { convCountMap[r.assigned_to]   = Number(r.count); });
    finishedRows.forEach(r => { finishedMap[r.assigned_to]    = Number(r.count); });
    convListRows.forEach(r => {
      convListMap[r.assigned_to]?.push({
        convId:        r.id,
        ticketId:      r.ticket_id,
        ticketNumber:  r.ticket_number,
        contactName:   r.contact_name || '—',
        channel:       r.channel,
        lastMessageAt: r.last_message_at,
      });
    });

    // Unassigned chat tickets in queue (whatsapp + portal, open/in_progress, no assigned agent)
    const queueRows: any[] = await this.repo.manager.query(
      `SELECT t.id, t.ticket_number, t.subject, t.priority, t.origin,
              t.created_at, t.conversation_id, t.contact_id, t.client_id,
              COALESCE(cli.trade_name, cli.company_name, '') AS client_name,
              COALESCE(ct.name, ct.email, '') AS contact_name
       FROM tickets t
       LEFT JOIN clients cli ON cli.id::text = t.client_id AND cli.tenant_id = t.tenant_id
       LEFT JOIN contacts ct  ON ct.id::text  = t.contact_id AND ct.tenant_id = t.tenant_id
       WHERE t.tenant_id = $1
         AND (t.assigned_to IS NULL OR t.assigned_to = '')
         AND t.status IN ('open','in_progress')
         AND t.origin IN ('whatsapp','portal')
       ORDER BY t.created_at ASC
       LIMIT 100`,
      [tenantId],
    );

    const agents = agentRecords.map(r => ({
      userId:              r.userId,
      userName:            r.userName || r.userEmail,
      userEmail:           r.userEmail,
      availability:        r.availability,
      pauseType:           r.pauseType || null,
      pauseSince:          r.pauseStart || null,
      clockIn:             r.clockIn,
      activeTickets:       ticketCountMap[r.userId] ?? 0,
      activeConversations: convCountMap[r.userId]   ?? 0,
      finishedToday:       finishedMap[r.userId]    ?? 0,
      activeConvList:      convListMap[r.userId]    ?? [],
    }));

    const queue = queueRows.map(r => ({
      ticketId:       r.id,
      ticketNumber:   r.ticket_number,
      subject:        r.subject,
      priority:       r.priority,
      origin:         r.origin,
      createdAt:      r.created_at,
      conversationId: r.conversation_id,
      clientName:     r.client_name || '—',
      contactName:    r.contact_name || '—',
      waitingMinutes: Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000),
    }));

    return {
      agents,
      queue,
      summary: {
        online:      agents.filter(a => a.availability === 'online').length,
        paused:      agents.filter(a => a.availability === 'paused').length,
        total:       agents.length,
        queueLength: queue.length,
      },
    };
  }
}
