import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import {
  Ticket, TicketMessage, TicketStatus, TicketPriority, TicketOrigin, MessageType,
} from './entities/ticket.entity';
import { TicketSatisfactionService } from './ticket-satisfaction.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  UpdateTicketContentDto,
  AddMessageDto,
  FilterTicketsDto,
  ResolveTicketDto,
  CancelTicketDto,
} from './dto/ticket.dto';
import { ContractsService } from '../contracts/contracts.service';
import { TicketSettingsService } from '../ticket-settings/ticket-settings.service';
import { AlertsService } from '../alerts/alerts.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RoutingRulesService } from '../routing-rules/routing-rules.service';

const PRIORITY_SLA_MULTIPLIER: Record<TicketPriority, number> = {
  [TicketPriority.LOW]: 2,
  [TicketPriority.MEDIUM]: 1,
  [TicketPriority.HIGH]: 0.5,
  [TicketPriority.CRITICAL]: 0.25,
};

const STATUS_LABELS_PT: Record<string, string> = {
  open: 'Em aberto',
  in_progress: 'Em andamento',
  waiting_client: 'Aguardando cliente',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketMessage)
    private readonly messageRepo: Repository<TicketMessage>,
    private readonly contractsService: ContractsService,
    private readonly ticketSettingsService: TicketSettingsService,
    private readonly alertsService: AlertsService,
    private readonly realtimeEmitter: RealtimeEmitterService,
  ) {}
  private attendanceSvc: any = null;
  setAttendanceService(svc: any) { this.attendanceSvc = svc; }
  private emailSvc: EmailService | null = null;
  setEmailService(svc: EmailService) { this.emailSvc = svc; }
  private webhooksSvc: WebhooksService | null = null;
  setWebhooksService(svc: WebhooksService) { this.webhooksSvc = svc; }
  private routingSvc: RoutingRulesService | null = null;
  setRoutingService(svc: RoutingRulesService) { this.routingSvc = svc; }
  private assignmentSvc: any = null;
  setAssignmentService(svc: any) { this.assignmentSvc = svc; }

  /** Fecha a conversa vinculada quando o ticket é resolvido/encerrado — registrado pelo AppModule */
  private closeConversationFn: ((tenantId: string, conversationId: string, userId: string, userName: string) => Promise<void>) | null = null;
  setCloseConversationHandler(fn: (tenantId: string, conversationId: string, userId: string, userName: string) => Promise<void>) {
    this.closeConversationFn = fn;
  }

  private async getUserName(tenantId: string, userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    try {
      const rows = await this.ticketRepo.manager.query(
        `SELECT name FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, userId],
      );
      return rows[0]?.name || null;
    } catch {
      return null;
    }
  }

  private getTicketSatisfactionService(): TicketSatisfactionService {
    return new TicketSatisfactionService(this.ticketRepo, null as any);
  }

  private normalizeText(value?: string | null): string | null {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().replace(/\s+/g, ' ');
    return normalized.length ? normalized : null;
  }

  private async generateTicketNumber(tenantId: string): Promise<string> {
    const count = await this.ticketRepo.count({ where: { tenantId } });
    return `#${String(count + 1).padStart(6, '0')}`;
  }

  private async getTicketOrFail(tenantId: string, id: string): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  /** Returns a map of agentId → active ticket count for the given agent IDs */
  async countActiveByAgents(tenantId: string, agentIds: string[]): Promise<Record<string, number>> {
    if (!agentIds.length) return {};
    const rows: { assigned_to: string; count: string }[] = await this.ticketRepo.manager.query(
      `SELECT assigned_to, COUNT(*)::int AS count
       FROM tickets
       WHERE tenant_id = $1
         AND assigned_to = ANY($2::text[])
         AND status IN ('open','in_progress','waiting_client')
       GROUP BY assigned_to`,
      [tenantId, agentIds],
    );
    const map: Record<string, number> = {};
    agentIds.forEach(id => { map[id] = 0; });
    rows.forEach(r => { map[r.assigned_to] = Number(r.count); });
    return map;
  }

  /**
   * Atribui o ticket ao agente online com menos tickets ativos.
   *
   * Proteções contra race condition:
   * - pg_advisory_xact_lock: bloqueia atribuições simultâneas do mesmo tenant
   *   (garante que a contagem de carga seja lida APÓS atribuições anteriores serem gravadas)
   * - UPDATE com WHERE assigned_to IS NULL: guard final contra dupla-atribuição
   *
   * Tiebreaker: quando dois agentes têm mesma carga, usa ordem alfabética por userId
   * (resultado estável e previsível — distribui circularmente na prática).
   */
  async assignToLeastLoadedAgent(tenantId: string, ticketId: string, onlineAgentIds: string[]): Promise<string | null> {
    if (!onlineAgentIds.length) return null;

    return this.ticketRepo.manager.transaction(async (em) => {
      // Lock exclusivo por tenant durante toda a transação.
      // pg_advisory_xact_lock bloqueia (não falha) até que a transação anterior libere —
      // garantindo serialização da atribuição entre mensagens simultâneas.
      await em.query(
        `SELECT pg_advisory_xact_lock(abs(hashtext($1)))`,
        [`whatsapp_assign:${tenantId}`],
      );

      // Conta tickets ativos por agente DENTRO da transação (após o lock)
      const rows: { assigned_to: string; count: string }[] = await em.query(
        `SELECT assigned_to, COUNT(*)::int AS count
         FROM tickets
         WHERE tenant_id = $1
           AND assigned_to = ANY($2::text[])
           AND status IN ('open','in_progress','waiting_client')
         GROUP BY assigned_to`,
        [tenantId, onlineAgentIds],
      );
      const counts: Record<string, number> = {};
      onlineAgentIds.forEach(id => { counts[id] = 0; });
      rows.forEach(r => { counts[r.assigned_to] = Number(r.count); });

      // Ordena por carga crescente; tiebreaker: ordem alfabética por userId (estável e justo)
      const sorted = [...onlineAgentIds].sort((a, b) => {
        const loadDiff = (counts[a] ?? 0) - (counts[b] ?? 0);
        return loadDiff !== 0 ? loadDiff : a.localeCompare(b);
      });
      const agentId = sorted[0];

      // Guard: só atualiza se o ticket ainda não foi atribuído (evita dupla-atribuição)
      const result = await em.query<{ id: string }[]>(
        `UPDATE tickets
            SET assigned_to = $1, status = $2, updated_at = NOW()
          WHERE id = $3 AND tenant_id = $4 AND assigned_to IS NULL
          RETURNING id`,
        [agentId, TicketStatus.IN_PROGRESS, ticketId, tenantId],
      );

      if (!result.length) {
        this.logger.debug(`[assignLeastLoaded] ticket=${ticketId} já atribuído, pulando`);
        return null;
      }

      this.logger.log(
        `[assignLeastLoaded] ticket=${ticketId} → agent=${agentId} (carga=${counts[agentId]})`,
      );
      return agentId;
    });
  }

  private async assertClientBelongsToTenant(tenantId: string, clientId?: string | null) {
    if (!clientId) return;

    const rows = await this.ticketRepo.manager.query(
      'SELECT id FROM clients WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, clientId],
    );

    if (!rows.length) {
      throw new BadRequestException('Cliente inválido para este tenant');
    }
  }

  private async assertContactBelongsToTenant(
    tenantId: string,
    clientId?: string | null,
    contactId?: string | null,
  ) {
    if (!contactId) return;
    if (!clientId) {
      const rows = await this.ticketRepo.manager.query(
        'SELECT id FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1',
        [tenantId, contactId],
      );
      if (!rows.length) throw new BadRequestException('Contato inválido para este tenant');
      return;
    }

    const rows = await this.ticketRepo.manager.query(
      `SELECT c.id, c.client_id as contact_client_id, cl.network_id as contact_network_id,
              target.network_id as target_network_id
       FROM contacts c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN clients target ON target.id = $3 AND target.tenant_id = $1
       WHERE c.tenant_id = $1 AND c.id = $2`,
      [tenantId, contactId, clientId],
    );

    if (!rows.length) throw new BadRequestException('Contato inválido para este tenant');

    const r = rows[0];
    if (r.contact_client_id === clientId) return;

    if (r.contact_network_id && r.target_network_id && r.contact_network_id === r.target_network_id) {
      return;
    }

    throw new BadRequestException('Contato inválido para este cliente. O contato deve pertencer ao cliente ou a outra empresa da mesma rede.');
  }

  private async assertUserBelongsToTenant(tenantId: string, userId?: string | null) {
    if (!userId) return;

    const tables = ['users', '"user"'];

    for (const table of tables) {
      try {
        const rows = await this.ticketRepo.manager.query(
          `SELECT id FROM ${table} WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, userId],
        );

        if (rows.length) return;
      } catch {}
    }

    throw new BadRequestException('Usuário responsável inválido para este tenant');
  }

  private async assertContractBelongsToTenant(tenantId: string, contractId?: string | null) {
    if (!contractId) return;
    await this.contractsService.findOne(tenantId, contractId);
  }

  private async getTicketSettingByName(
    tenantId: string,
    type: 'department' | 'category' | 'subcategory',
    name?: string | null,
  ) {
    const normalized = this.normalizeText(name);
    if (!normalized) return null;

    const rows = await this.ticketRepo.manager.query(
      `
      SELECT id, parent_id, name, type
      FROM ticket_settings
      WHERE tenant_id = $1
        AND type = $2
        AND active = true
        AND LOWER(TRIM(name)) = LOWER(TRIM($3))
      LIMIT 1
      `,
      [tenantId, type, normalized],
    );

    return rows[0] || null;
  }

  private async resolveTicketClassification(
    tenantId: string,
    department?: string | null,
    category?: string | null,
    subcategory?: string | null,
  ) {
    const normalizedDepartment = this.normalizeText(department);
    const normalizedCategory = this.normalizeText(category);
    const normalizedSubcategory = this.normalizeText(subcategory);

    const departmentRow = await this.getTicketSettingByName(tenantId, 'department', normalizedDepartment);
    const categoryRow = await this.getTicketSettingByName(tenantId, 'category', normalizedCategory);
    const subcategoryRow = await this.getTicketSettingByName(tenantId, 'subcategory', normalizedSubcategory);

    // Valores não cadastrados em ticket_settings são permitidos (ex.: tickets de automação)
    if (normalizedDepartment && !departmentRow) {
      return {
        department: normalizedDepartment,
        category: normalizedCategory || null,
        subcategory: normalizedSubcategory || null,
      };
    }
    if (normalizedCategory && !categoryRow) {
      return {
        department: departmentRow?.name || normalizedDepartment || null,
        category: normalizedCategory,
        subcategory: normalizedSubcategory || null,
      };
    }
    if (normalizedSubcategory && !subcategoryRow) {
      return {
        department: departmentRow?.name || normalizedDepartment || null,
        category: categoryRow?.name || normalizedCategory || null,
        subcategory: normalizedSubcategory,
      };
    }

    if (normalizedCategory && !normalizedDepartment) {
      throw new BadRequestException('Categoria exige departamento');
    }

    if (normalizedSubcategory && !normalizedCategory) {
      throw new BadRequestException('Subcategoria exige categoria');
    }

    if (departmentRow && categoryRow && categoryRow.parent_id !== departmentRow.id) {
      throw new BadRequestException('Categoria não pertence ao departamento informado');
    }

    if (categoryRow && subcategoryRow && subcategoryRow.parent_id !== categoryRow.id) {
      throw new BadRequestException('Subcategoria não pertence à categoria informada');
    }

    return {
      department: departmentRow?.name || normalizedDepartment || null,
      category: categoryRow?.name || normalizedCategory || null,
      subcategory: subcategoryRow?.name || normalizedSubcategory || null,
    };
  }

  private async registerSystemMessage(
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    content: string,
    messageType: MessageType = MessageType.STATUS_CHANGE,
  ) {
    await this.messageRepo.save(this.messageRepo.create({
      tenantId,
      ticketId,
      authorId,
      authorType: 'user',
      authorName,
      messageType,
      content,
    }));
  }

  async createAutoDeviceOfflineTicket(tenantId: string, device: { id: string; name: string; clientId: string; ipAddress?: string | null }) {
    const existing = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.status NOT IN (:...done)', {
        done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED],
      })
      .andWhere("(t.metadata->>'deviceId') = :deviceId", { deviceId: device.id })
      .getOne();

    if (existing) return existing;

    const ticketNumber = await this.generateTicketNumber(tenantId);
    const now = new Date();

    const subject = `PDV offline: ${device.name}`;
    const description = [
      `Detecção automática: equipamento ficou offline (sem heartbeat há > 5min).`,
      `Device: ${device.name} (${device.id})`,
      device.ipAddress ? `IP: ${device.ipAddress}` : null,
    ].filter(Boolean).join('\n');

    const ticket = this.ticketRepo.create({
      tenantId,
      ticketNumber,
      clientId: device.clientId,
      origin: TicketOrigin.INTERNAL,
      priority: TicketPriority.HIGH,
      status: TicketStatus.OPEN,
      subject,
      description,
      category: 'infraestrutura',
      slaResponseAt: null,
      slaResolveAt: null,
      metadata: { deviceId: device.id, deviceName: device.name, source: 'monitoring', type: 'device_offline' },
      createdAt: now as any,
      updatedAt: now as any,
    } as any);

    const saved = await this.ticketRepo.save(ticket as any);

    await this.messageRepo.save(this.messageRepo.create({
      tenantId,
      ticketId: saved.id,
      authorId: null,
      authorType: 'system',
      authorName: 'Monitoring Engine',
      messageType: MessageType.SYSTEM,
      content: 'Ticket criado automaticamente devido a dispositivo offline.',
    }));

    return saved;
  }

  async create(tenantId: string, userId: string, userName: string, dto: CreateTicketDto, authorType: 'user' | 'contact' = 'user'): Promise<Ticket> {
    await this.assertClientBelongsToTenant(tenantId, dto.clientId);
    await this.assertContactBelongsToTenant(tenantId, dto.clientId, dto.contactId);
    await this.assertUserBelongsToTenant(tenantId, dto.assignedTo);
    await this.assertContractBelongsToTenant(tenantId, dto.contractId);

    let departmentName = dto.department;
    if (dto.departmentId && !departmentName) {
      try {
        const dept = await this.ticketSettingsService.findOne(tenantId, dto.departmentId);
        departmentName = dept.name;
      } catch {}
    }

    const classification = await this.resolveTicketClassification(
      tenantId,
      departmentName,
      dto.category,
      dto.subcategory,
    );

    const ticketNumber = await this.generateTicketNumber(tenantId);

    let slaResponseHours = 4;
    let slaResolveHours = 24;

    if (dto.contractId) {
      try {
        const contract = await this.contractsService.findOne(tenantId, dto.contractId);
        slaResponseHours = contract.slaResponseHours;
        slaResolveHours = contract.slaResolveHours;
      } catch {}
    } else if (dto.clientId) {
      const contract = await this.contractsService.findActiveContractForClient(tenantId, dto.clientId);
      if (contract) {
        slaResponseHours = contract.slaResponseHours;
        slaResolveHours = contract.slaResolveHours;
        dto.contractId = contract.id;
      }
    }

    const multiplier = PRIORITY_SLA_MULTIPLIER[dto.priority || TicketPriority.MEDIUM];
    const now = new Date();
    const slaResponseAt = new Date(now.getTime() + slaResponseHours * multiplier * 3600 * 1000);
    const slaResolveAt = new Date(now.getTime() + slaResolveHours * multiplier * 3600 * 1000);

    const ticket = this.ticketRepo.create({
      ...dto,
      conversationId: dto.conversationId || undefined,
      department: classification.department || undefined,
      category: classification.category || undefined,
      subcategory: classification.subcategory || undefined,
      tenantId,
      ticketNumber,
      status: dto.assignedTo ? TicketStatus.IN_PROGRESS : TicketStatus.OPEN,
      slaResponseAt,
      slaResolveAt,
    } as any);

    const saved = await this.ticketRepo.save(ticket);
    const ticketSaved = Array.isArray(saved) ? saved[0] : saved;

    // Apply routing rules: auto-assign, set priority, notify email
    if (this.routingSvc) {
      try {
        const routing = await this.routingSvc.applyRules(tenantId, ticketSaved);
        const routingUpdates: any = {};
        if (routing.assignTo) routingUpdates.assignedTo = routing.assignTo;
        if (routing.priority) routingUpdates.priority = routing.priority;
        if (Object.keys(routingUpdates).length > 0) {
          Object.assign(ticketSaved, routingUpdates);
          await this.ticketRepo.save(ticketSaved);
        }
        if (routing.notifyEmail && this.emailSvc) {
          await this.emailSvc.sendEscalationAlert(tenantId, routing.notifyEmail, ticketSaved);
        }
      } catch {}
    }

    // Auto-atribuição por round-robin se ainda sem agente após routing rules
    if (!ticketSaved.assignedTo && this.assignmentSvc) {
      try {
        const autoAgentId = await this.assignmentSvc.assignTicket(tenantId, ticketSaved.id);
        if (autoAgentId) {
          ticketSaved.assignedTo = autoAgentId;
          ticketSaved.autoAssignedAt = new Date();
          ticketSaved.status = TicketStatus.IN_PROGRESS;
        }
      } catch (err) {
        // não-crítico: ticket fica em aberto sem agente
        console.warn(`[tickets] auto-assignment falhou ticket=${ticketSaved.id}`, err);
      }
    }

    // Registrar no histórico: atribuição, classificação (dept/cat/subcat) — para tickets criados no atendimento
    if (ticketSaved.assignedTo) {
      const techName = await this.getUserName(tenantId, ticketSaved.assignedTo);
      await this.registerSystemMessage(
        tenantId,
        ticketSaved.id,
        userId,
        userName,
        `Chamado atribuído ao técnico: ${techName ?? ticketSaved.assignedTo}`,
        MessageType.SYSTEM,
      );
    }
    const parts: string[] = [];
    if (ticketSaved.department) parts.push(ticketSaved.department);
    if (ticketSaved.category) parts.push(ticketSaved.category);
    if (ticketSaved.subcategory) parts.push(ticketSaved.subcategory);
    if (parts.length > 0) {
      await this.registerSystemMessage(
        tenantId,
        ticketSaved.id,
        userId,
        userName,
        `Classificação: ${parts.join(' › ')}`,
        MessageType.SYSTEM,
      );
    }

    // For chat/whatsapp tickets the description is already visible in the ticket header;
    // the full conversation transcript is stored in conversation_messages — no need to duplicate as a comment.
    if (!dto.conversationId && dto.description) {
      await this.messageRepo.save(this.messageRepo.create({
        tenantId,
        ticketId: ticketSaved.id,
        authorId: userId,
        authorType,
        authorName: userName,
        messageType: MessageType.COMMENT,
        content: dto.description,
      }));
    }

    // Send ticket created email notification
    if (this.emailSvc && ticketSaved.contactId) {
      try {
        const contactRows = await this.ticketRepo.manager.query(
          'SELECT email FROM contacts WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [ticketSaved.contactId, tenantId],
        );
        const settingsRows = await this.ticketRepo.manager.query(
          'SELECT ticket_created_notify FROM tenant_settings WHERE tenant_id = $1 LIMIT 1',
          [tenantId],
        );
        if (contactRows[0]?.email && settingsRows[0]?.ticket_created_notify === 'true') {
          await this.emailSvc.sendTicketCreated(tenantId, contactRows[0].email, ticketSaved);
        }
      } catch {}
    }

    // Fire webhook for ticket.created
    if (this.webhooksSvc) {
      try {
        await this.webhooksSvc.fire(tenantId, 'ticket.created', {
          id: ticketSaved.id,
          ticketNumber: ticketSaved.ticketNumber,
          subject: ticketSaved.subject,
          status: ticketSaved.status,
          priority: ticketSaved.priority,
        });
      } catch {}
    }

    return ticketSaved;
  }

  async findAll(tenantId: string, filters: FilterTicketsDto) {
    const {
      page = 1,
      perPage = 20,
      status,
      priority,
      assignedTo,
      clientId,
      contactId,
      department,
      category,
      subcategory,
      search,
      origin,
      active,
      includeLastMessage,
    } = filters;

    const sortMap: Record<string, string> = {
      ticketNumber: 't.ticket_number',
      subject: 't.subject',
      createdAt: 't.created_at',
      updatedAt: 't.updated_at',
      status: 't.status',
      priority: 't.priority',
    };
    const [rawField, rawDir] = ((filters as any).sort || 'createdAt:desc').split(':');
    const sortCol = sortMap[rawField] ?? 't.created_at';
    const sortDir: 'ASC' | 'DESC' = rawDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.ticketRepo.createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy(sortCol, sortDir)
      .skip((page - 1) * perPage)
      .take(perPage);

    const isActive = active === true || String(active ?? '').toLowerCase() === 'true';
    if (isActive && !status) {
      qb.andWhere('t.status IN (:...activeStatuses)', {
        activeStatuses: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT],
      });
    } else if (status) {
      const statusList = status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statusList.length > 1) {
        qb.andWhere('t.status IN (:...statusList)', { statusList });
      } else {
        qb.andWhere('t.status = :status', { status: statusList[0] });
      }
    }
    if (origin) {
      qb.andWhere('t.origin = :origin', { origin });
    } else {
      // Inbox de atendimento mostra apenas canais de contato do cliente.
      qb.andWhere('t.origin IN (:...inboxOrigins)', { inboxOrigins: ['whatsapp', 'portal'] });
    }
    if (priority) qb.andWhere('t.priority = :priority', { priority });
    if (assignedTo) qb.andWhere('t.assigned_to = :assignedTo', { assignedTo });
    if (clientId && contactId) {
      // Contato normal: apenas tickets da empresa selecionada vinculados ao usuário (ou contatos com mesmo email)
      qb.andWhere(
        `t.client_id = :clientId AND t.contact_id IN (
          SELECT id::text FROM contacts WHERE tenant_id = :tenantId AND email = (
            SELECT email FROM contacts WHERE id = :contactId::uuid AND tenant_id = :tenantId LIMIT 1
          )
        )`,
        { clientId, contactId, tenantId },
      );
    } else if (clientId) {
      qb.andWhere('t.client_id = :clientId', { clientId });
    } else if (contactId) {
      // Match all contact records sharing the same email
      qb.andWhere(
        `t.contact_id IN (
          SELECT id::text FROM contacts WHERE tenant_id = :tenantId AND email = (
            SELECT email FROM contacts WHERE id = :contactId::uuid AND tenant_id = :tenantId LIMIT 1
          )
        )`,
        { contactId, tenantId },
      );
    }
    if (department) qb.andWhere('t.department = :department', { department: this.normalizeText(department) });
    if (category) qb.andWhere('t.category = :category', { category: this.normalizeText(category) });
    if (subcategory) qb.andWhere('t.subcategory = :subcategory', { subcategory: this.normalizeText(subcategory) });
    if (search) {
      qb.andWhere(
        `(t.subject ILIKE :s OR t.ticket_number ILIKE :s OR t.description ILIKE :s
          OR EXISTS (
            SELECT 1 FROM clients cli
            WHERE cli.id::text = t.client_id
              AND cli.tenant_id = t.tenant_id
              AND (cli.company_name ILIKE :s OR cli.trade_name ILIKE :s)
          ))`,
        { s: `%${search}%` },
      );
    }

    const [data, total] = await qb.getManyAndCount();

    if (includeLastMessage && data.length > 0) {
      const ids = data.map((t) => t.id);
      const lastMsgRows = await this.ticketRepo.manager.query(
        `SELECT DISTINCT ON (ticket_id) ticket_id, content, created_at
         FROM ticket_messages
         WHERE tenant_id = $1 AND ticket_id = ANY($2::text[])
           AND author_type = 'user' AND "messageType" != 'internal'
         ORDER BY ticket_id, created_at DESC`,
        [tenantId, ids],
      );
      const lastByTicket = new Map<string, { content: string; createdAt: Date }>(
        lastMsgRows.map((r: { ticket_id: string; content: string; created_at: Date }) => [r.ticket_id, { content: r.content, createdAt: r.created_at }]),
      );
      const enriched = data.map((t) => {
        const last = lastByTicket.get(t.id);
        return {
          ...t,
          lastAgentMessage: last ? { content: last.content.slice(0, 120), createdAt: last.createdAt } : null,
        };
      });
      return { data: enriched, total, page, perPage, totalPages: Math.ceil(total / perPage) };
    }

    return { data, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  }

  /**
   * Retorna tickets em formato de conversa para o inbox (portal/whatsapp sem conversation).
   * Inclui lastMessageAt e lastMessagePreview da última mensagem em ticket_messages.
   */
  async getConversationsAsInbox(
    tenantId: string,
    opts: { origin?: 'portal' | 'whatsapp'; status?: string; perPage?: number },
  ) {
    const { origin, status = 'active', perPage = 50 } = opts;
    const qb = this.ticketRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.conversation_id IS NULL')
      .orderBy('t.updated_at', 'DESC')
      .take(Math.min(perPage, 100));

    if (origin) {
      qb.andWhere('t.origin = :origin', { origin });
    } else {
      // Sem filtro explícito: exibe apenas canais de atendimento ao cliente (whatsapp/portal).
      // Tickets criados internamente (email, phone, internal) NÃO aparecem no inbox de atendimento.
      qb.andWhere('t.origin IN (:...inboxOrigins)', { inboxOrigins: ['whatsapp', 'portal'] });
    }
    if (status === 'active') {
      qb.andWhere('t.status IN (:...sts)', {
        sts: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT],
      });
    } else if (status === 'closed') {
      qb.andWhere('t.status IN (:...sts)', { sts: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED] });
    }

    const tickets = await qb.getMany();
    if (tickets.length === 0) return [];

    const ids = tickets.map((t) => t.id);
    const lastRows = await this.ticketRepo.manager.query(
      `SELECT DISTINCT ON (ticket_id) ticket_id, content, created_at
       FROM ticket_messages WHERE tenant_id = $1 AND ticket_id = ANY($2)
       AND "messageType" != 'internal' ORDER BY ticket_id, created_at DESC`,
      [tenantId, ids],
    );
    const lastByTicket = new Map<string, { content: string; createdAt: Date }>(
      lastRows.map((r: { ticket_id: string; content: string; created_at: Date }) => [
        r.ticket_id,
        { content: (r.content || '').slice(0, 120), createdAt: r.created_at },
      ]),
    );

    const contactIds = [...new Set(tickets.map((t) => t.contactId).filter(Boolean))] as string[];
    let contactNames: Map<string, string> = new Map();
    if (contactIds.length > 0) {
      const rows = await this.ticketRepo.manager.query(
        `SELECT id, name FROM contacts WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, contactIds],
      );
      contactNames = new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
    }

    return tickets.map((t) => {
      const last = lastByTicket.get(t.id);
      const contactName = t.contactId ? contactNames.get(t.contactId) || null : null;
      return {
        id: `ticket:${t.id}`,
        type: 'ticket',
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
        clientId: t.clientId,
        contactId: t.contactId,
        contactName,
        channel: t.origin,
        status: t.status === TicketStatus.RESOLVED || t.status === TicketStatus.CLOSED || t.status === TicketStatus.CANCELLED ? 'closed' : 'active',
        subject: t.subject,
        lastMessageAt: last?.createdAt || t.updatedAt,
        lastMessagePreview: last?.content || t.subject,
        createdAt: t.createdAt,
      };
    });
  }

  /** Conta tickets ativos para inbox (sem conversation) — usado no badge. */
  async getActiveInboxTicketCount(tenantId: string): Promise<number> {
    return this.ticketRepo.count({
      where: {
        tenantId,
        conversationId: IsNull(),
        status: In([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT]),
      },
    });
  }

  async findOne(tenantId: string, id: string): Promise<any> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    // Inclui dados do responsável para evitar chamada extra ao endpoint /team
    if ((ticket as any).assignedTo) {
      try {
        const rows = await this.ticketRepo.manager.query(
          `SELECT id, name, email FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, (ticket as any).assignedTo],
        );
        if (rows[0]) (ticket as any).assignedUser = rows[0];
      } catch {}
    }
    return ticket;
  }

  async linkToConversation(tenantId: string, ticketId: string, conversationId: string): Promise<void> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);
    ticket.conversationId = conversationId;
    await this.ticketRepo.save(ticket);
  }

  /** Normaliza número do ticket para formato #000001. Aceita "1", "000001", "#000001". */
  private normalizeTicketNumber(number: string): string {
    const digits = number.replace(/\D/g, '');
    return digits ? `#${digits.padStart(6, '0')}` : '';
  }

  async findByNumber(tenantId: string, number: string): Promise<Ticket> {
    const normalized = this.normalizeTicketNumber(number);
    if (!normalized) throw new NotFoundException('Informe o número do ticket');
    let ticket = await this.ticketRepo.findOne({ where: { ticketNumber: normalized, tenantId } });
    if (!ticket) ticket = await this.ticketRepo.findOne({ where: { ticketNumber: number, tenantId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  /**
   * Busca ticket por número (apenas dígitos ou #000001), validando se pertence ao cliente (para portal).
   * Aceita "1", "000001", "#000001".
   */
  async findByNumberForClient(tenantId: string, number: string, clientId?: string): Promise<Ticket> {
    const normalized = this.normalizeTicketNumber(number);
    if (!normalized) throw new NotFoundException('Informe o número do ticket');
    let ticket = await this.ticketRepo.findOne({ where: { ticketNumber: normalized, tenantId } });
    if (!ticket) {
      const digits = number.replace(/\D/g, '');
      const alt = digits.padStart(6, '0');
      ticket = await this.ticketRepo.findOne({ where: { ticketNumber: alt, tenantId } });
    }
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    if (clientId && ticket.clientId !== clientId) {
      throw new NotFoundException('Ticket não encontrado ou não pertence a este cliente');
    }
    return ticket;
  }

  async update(tenantId: string, id: string, userId: string, userName: string, dto: UpdateTicketDto): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    const oldStatus = ticket.status;
    const oldDepartment = ticket.department ?? null;

    await this.assertUserBelongsToTenant(tenantId, dto.assignedTo);

    const userChangedClassification =
      dto.department !== undefined || dto.category !== undefined || dto.subcategory !== undefined;

    const updates: any = { ...dto };

    if (userChangedClassification) {
      const classification = await this.resolveTicketClassification(
        tenantId,
        dto.department ?? ticket.department,
        dto.category ?? ticket.category,
        dto.subcategory ?? ticket.subcategory,
      );
      updates.department = classification.department || undefined;
      updates.category = classification.category || undefined;
      updates.subcategory = classification.subcategory || undefined;
    }

    if (dto.assignedTo && ticket.status === TicketStatus.OPEN) {
      updates.status = TicketStatus.IN_PROGRESS;
    }

    if (dto.status === TicketStatus.RESOLVED && !ticket.resolvedAt) {
      updates.resolvedAt = new Date();
    }

    if (dto.status === TicketStatus.CLOSED && !ticket.closedAt) {
      updates.closedAt = new Date();
    }

    if (dto.status === TicketStatus.CANCELLED && !dto.cancelReason && !ticket.cancelReason) {
      updates.cancelReason = 'Cancelado sem motivo informado';
    }

    Object.assign(ticket, updates);

    const saved = await this.ticketRepo.save(ticket);

    if (oldStatus !== saved.status) {
      const fromLabel = STATUS_LABELS_PT[oldStatus] ?? oldStatus;
      const toLabel = STATUS_LABELS_PT[saved.status] ?? saved.status;
      await this.registerSystemMessage(
        tenantId,
        id,
        userId,
        userName,
        `Status alterado de "${fromLabel}" para "${toLabel}"`,
      );
    }

    if (dto.assignedTo) {
      const techName = await this.getUserName(tenantId, dto.assignedTo);
      await this.registerSystemMessage(
        tenantId,
        id,
        userId,
        userName,
        `Chamado atribuído ao técnico: ${techName ?? dto.assignedTo}`,
        MessageType.SYSTEM,
      );
    }

    // Fire webhook on status change
    if (oldStatus !== saved.status && this.webhooksSvc) {
      try {
        await this.webhooksSvc.fire(tenantId, 'ticket.updated', {
          id: saved.id,
          ticketNumber: saved.ticketNumber,
          subject: saved.subject,
          status: saved.status,
          previousStatus: oldStatus,
        });
      } catch {}
    }

    // Reatribui automaticamente quando o departamento muda (round-robin do novo depto)
    const newDepartment = saved.department ?? null;
    if (
      userChangedClassification &&
      newDepartment !== oldDepartment &&
      !dto.assignedTo &&          // atribuição manual tem precedência
      this.assignmentSvc
    ) {
      this.assignmentSvc.reassignOnDepartmentChange(tenantId, saved.id).catch(() => {});
    }

    return saved;
  }

  async updateContent(tenantId: string, id: string, userId: string, userName: string, dto: UpdateTicketContentDto): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    const oldSubject = ticket.subject ?? '';
    const oldDescription = ticket.description ?? '';

    ticket.subject = dto.subject.trim();
    ticket.description = dto.description?.trim() || '';

    const saved = await this.ticketRepo.save(ticket);

    if (oldSubject !== saved.subject) {
      await this.registerSystemMessage(
        tenantId,
        id,
        userId,
        userName,
        `Assunto do ticket alterado de "${oldSubject}" para "${saved.subject}"`,
      );
    }

    if (oldDescription !== saved.description) {
      await this.registerSystemMessage(
        tenantId,
        id,
        userId,
        userName,
        'Descrição do ticket atualizada',
      );
    }

    return saved;
  }

  async assign(tenantId: string, id: string, techId: string, assignedByUserId?: string, assignedByUserName?: string): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    await this.assertUserBelongsToTenant(tenantId, techId);
    if (this.attendanceSvc) {
      const available = await this.attendanceSvc.isAvailable(tenantId, techId);
      if (available === false) throw new BadRequestException("Agente em pausa — não é possível atribuir tickets no momento");
    }
    ticket.assignedTo = techId;
    if (ticket.status === TicketStatus.OPEN) ticket.status = TicketStatus.IN_PROGRESS;
    const saved = await this.ticketRepo.save(ticket);
    const techName = await this.getUserName(tenantId, techId);
    await this.registerSystemMessage(
      tenantId, id,
      assignedByUserId || techId,
      assignedByUserName || techName || 'Sistema',
      `Chamado atribuído ao técnico: ${techName ?? techId}`,
      MessageType.SYSTEM,
    );

    // Notifica supervisor e demais agentes em tempo real sobre a transferência
    this.realtimeEmitter.emitToTenant(tenantId, 'queue:updated', {
      ticketId: id,
      assignedTo: techId,
      assignedToName: techName ?? techId,
    });

    return saved;
  }

  /**
   * Marca o ticket como validado automaticamente via CNPJ fornecido pelo contato no chatbot.
   * Atualiza client_id do ticket e da conversa, e define customer_selected_at.
   */
  async markCustomerSelectedByCnpj(tenantId: string, ticketId: string, clientId: string): Promise<void> {
    await this.ticketRepo.manager.transaction(async (trx) => {
      // Atualiza o ticket com o cliente identificado e marca como validado
      await trx.query(
        `UPDATE tickets
         SET client_id = $1, customer_selected_at = NOW(), unlinked_contact = false
         WHERE id = $2 AND tenant_id = $3 AND customer_selected_at IS NULL`,
        [clientId, ticketId, tenantId],
      );

      // Atualiza a conversa vinculada ao ticket
      await trx.query(
        `UPDATE conversations SET client_id = $1
         WHERE ticket_id = $2 AND tenant_id = $3`,
        [clientId, ticketId, tenantId],
      );
    });
  }

  async resolve(
    tenantId: string,
    id: string,
    userId: string,
    userName: string,
    dto: ResolveTicketDto,
  ): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);

    if (ticket.status === TicketStatus.CANCELLED) {
      throw new BadRequestException('Chamado cancelado não pode ser resolvido');
    }

    if (dto.timeSpentMin !== undefined) {
      ticket.timeSpentMin = dto.timeSpentMin;
    }

    if (dto.resolutionSummary !== undefined) {
      ticket.resolutionSummary = dto.resolutionSummary;
    }

    ticket.status = TicketStatus.RESOLVED;
    ticket.resolvedAt = new Date();

    const saved = await this.ticketRepo.save(ticket);

    if (saved.contractId && saved.timeSpentMin > 0) {
      await this.contractsService.consumeHours(tenantId, saved.contractId, saved.timeSpentMin);
    }

    await this.registerSystemMessage(
      tenantId,
      id,
      userId,
      userName,
      `Chamado resolvido${saved.resolutionSummary ? `: ${saved.resolutionSummary}` : ''}`,
    );

    // Send ticket resolved email notification
    if (this.emailSvc && saved.contactId) {
      try {
        const contactRows = await this.ticketRepo.manager.query(
          'SELECT email FROM contacts WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [saved.contactId, tenantId],
        );
        const settingsRows = await this.ticketRepo.manager.query(
          'SELECT ticket_resolved_notify FROM tenant_settings WHERE tenant_id = $1 LIMIT 1',
          [tenantId],
        );
        if (contactRows[0]?.email && settingsRows[0]?.ticket_resolved_notify !== 'false') {
          await this.emailSvc.sendTicketResolved(tenantId, contactRows[0].email, saved);
        }
      } catch {}
    }

    // Fire webhook for ticket.resolved
    if (this.webhooksSvc) {
      try {
        await this.webhooksSvc.fire(tenantId, 'ticket.resolved', {
          id: saved.id,
          ticketNumber: saved.ticketNumber,
          subject: saved.subject,
          resolutionSummary: saved.resolutionSummary,
        });
      } catch {}
    }

    // Fecha conversa vinculada automaticamente (best-effort)
    if (saved.conversationId && this.closeConversationFn) {
      this.closeConversationFn(tenantId, saved.conversationId, userId, userName).catch(() => {});
    }

    return saved;
  }

  async close(tenantId: string, id: string, userId: string, userName: string): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);

    if (ticket.status === TicketStatus.CANCELLED) {
      throw new BadRequestException('Chamado cancelado não pode ser fechado');
    }

    if (!ticket.resolvedAt) {
      ticket.resolvedAt = new Date();
    }

    ticket.status = TicketStatus.CLOSED;
    ticket.closedAt = new Date();

    const saved = await this.ticketRepo.save(ticket);

    await this.registerSystemMessage(
      tenantId,
      id,
      userId,
      userName,
      'Chamado finalizado/fechado',
    );

    // Fecha conversa vinculada automaticamente (best-effort)
    if (saved.conversationId && this.closeConversationFn) {
      this.closeConversationFn(tenantId, saved.conversationId, userId, userName).catch(() => {});
    }

    return saved;
  }

  async cancel(
    tenantId: string,
    id: string,
    userId: string,
    userName: string,
    dto: CancelTicketDto,
  ): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Chamado já fechado não pode ser cancelado');
    }

    ticket.status = TicketStatus.CANCELLED;
    ticket.cancelReason = dto.cancelReason || 'Cancelado sem motivo informado';

    if (!ticket.closedAt) {
      ticket.closedAt = new Date();
    }

    const saved = await this.ticketRepo.save(ticket);

    await this.registerSystemMessage(
      tenantId,
      id,
      userId,
      userName,
      `Chamado cancelado: ${saved.cancelReason}`,
    );

    return saved;
  }

  async addMessage(
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    authorType: string,
    dto: AddMessageDto,
  ): Promise<TicketMessage> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);

    if (!ticket.firstResponseAt && authorType !== 'contact') {
      ticket.firstResponseAt = new Date();
      await this.ticketRepo.save(ticket);
    }

    if (authorType === 'contact' && ticket.status === TicketStatus.WAITING_CLIENT) {
      ticket.status = TicketStatus.IN_PROGRESS;
      await this.ticketRepo.save(ticket);
    }

    const entity = this.messageRepo.create({
      tenantId,
      ticketId,
      authorId,
      authorType,
      authorName,
      messageType: dto.messageType || MessageType.COMMENT,
      content: dto.content,
      attachments: dto.attachments,
      channel: dto.channel ?? undefined,
    });
    const saved = await this.messageRepo.save(entity);
    const msg = Array.isArray(saved) ? saved[0] : saved;
    this.realtimeEmitter.emitNewMessage(ticketId, {
      id: msg.id,
      ticketId: msg.ticketId,
      authorId: msg.authorId,
      authorType: msg.authorType,
      authorName: msg.authorName,
      messageType: msg.messageType,
      content: msg.content,
      attachments: msg.attachments,
      channel: msg.channel,
      createdAt: msg.createdAt,
    });
    return msg;
  }

  async getMessages(tenantId: string, ticketId: string, includeInternal = true): Promise<TicketMessage[]> {
    await this.getTicketOrFail(tenantId, ticketId);

    const qb = this.messageRepo.createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.ticket_id = :ticketId', { ticketId })
      .orderBy('m.created_at', 'ASC');

    if (!includeInternal) {
      qb.andWhere('m.messageType != :internal', { internal: MessageType.INTERNAL });
    }

    return qb.getMany();
  }

  async getMessagesPage(
    tenantId: string,
    ticketId: string,
    opts: { limit?: number; before?: string; includeInternal?: boolean },
  ): Promise<{ messages: TicketMessage[]; hasMore: boolean }> {
    await this.getTicketOrFail(tenantId, ticketId);
    const limit = Math.min(opts.limit ?? 50, 200);
    const includeInternal = opts.includeInternal ?? true;

    const qb = this.messageRepo.createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.ticket_id = :ticketId', { ticketId })
      .orderBy('m.created_at', 'DESC')
      .take(limit + 1);

    if (!includeInternal) {
      qb.andWhere('m.messageType != :internal', { internal: MessageType.INTERNAL });
    }

    if (opts.before) {
      const cursor = await this.messageRepo.findOne({
        where: { id: opts.before } as any,
      });
      if (cursor) {
        qb.andWhere('m.created_at < :cursorDate', { cursorDate: cursor.createdAt });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    rows.reverse();
    return { messages: rows, hasMore };
  }

  async submitSatisfaction(tenantId: string, ticketId: string, score: 'approved' | 'rejected'): Promise<Ticket> {
    const ticket = await this.getTicketSatisfactionService().applyPortalSatisfaction(ticketId, score === 'approved');
    const message =
      ticket.satisfactionScore === 'approved'
        ? 'Cliente confirmou a solução. Chamado encerrado automaticamente.'
        : 'Cliente indicou que o problema não foi resolvido. Chamado reaberto.';
    await this.registerSystemMessage(
      tenantId, ticketId, '', 'Sistema',
      message,
    );
    return ticket;
  }

  async escalate(tenantId: string, id: string): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    ticket.priority = TicketPriority.CRITICAL;
    ticket.escalated = true;
    return this.ticketRepo.save(ticket);
  }

  async getStats(tenantId: string) {
    const qb = this.ticketRepo.createQueryBuilder('t').where('t.tenant_id = :tenantId', { tenantId });

    const [open, inProgress, waitingClient, resolved, closed, cancelled] = await Promise.all([
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.OPEN }).getCount(),
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.IN_PROGRESS }).getCount(),
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.WAITING_CLIENT }).getCount(),
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.RESOLVED }).getCount(),
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.CLOSED }).getCount(),
      qb.clone().andWhere('t.status = :s', { s: TicketStatus.CANCELLED }).getCount(),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const resolvedToday = await qb.clone()
      .andWhere('t.status IN (:...st)', { st: [TicketStatus.RESOLVED, TicketStatus.CLOSED] })
      .andWhere('t.resolved_at >= :today', { today })
      .getCount();

    return { open, inProgress, waitingClient, resolved, closed, cancelled, resolvedToday };
  }

  /**
   * Job de SLA: alerta de 80% do prazo de resolução.
   * Roda a cada 5 minutos e não altera status, apenas registra
   * uma mensagem de sistema no ticket.
   */
  @Cron('*/5 * * * *')
  async checkSlaWarnings() {
    const now = new Date();

    const tickets = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.sla_resolve_at IS NOT NULL')
      .andWhere('t.created_at IS NOT NULL')
      .andWhere('t.status NOT IN (:...done)', {
        done: [
          TicketStatus.RESOLVED,
          TicketStatus.CLOSED,
          TicketStatus.CANCELLED,
        ],
      })
      .getMany();

    for (const t of tickets) {
      const totalMs = t.slaResolveAt.getTime() - t.createdAt.getTime();
      if (totalMs <= 0) continue;

      const elapsedMs = now.getTime() - t.createdAt.getTime();
      const ratio = elapsedMs / totalMs;

      // Janela de aviso: entre 80% e 100% do prazo total.
      if (ratio >= 0.8 && ratio < 1) {
        await this.registerSystemMessage(
          t.tenantId,
          t.id,
          '',
          'SLA Engine',
          'SLA: ticket atingiu 80% do prazo de resolução.',
          MessageType.SYSTEM,
        );
        try {
          await this.alertsService.notifySlaWarning(t);
        } catch {}
      }
    }
  }

  @Cron('*/5 * * * *')
  async checkSlaBreaches() {
    const now = new Date();

    const tenants = await this.ticketRepo.manager.query(
      'SELECT DISTINCT tenant_id FROM tickets WHERE tenant_id IS NOT NULL',
    );

    for (const row of tenants) {
      const tenantId = row.tenant_id;

      const breached = await this.ticketRepo
        .createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.status NOT IN (:...done)', {
          done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED],
        })
        .andWhere('t.sla_resolve_at < :now', { now })
        .andWhere('t.escalated = false')
        .getMany();

      if (breached.length) {
        for (const t of breached) {
          t.escalated = true;
          t.priority = TicketPriority.CRITICAL;

          await this.ticketRepo.save(t);

          await this.registerSystemMessage(
            t.tenantId,
            t.id,
            '',
            'SLA Engine',
            'SLA: prazo de resolução violado. Ticket escalonado automaticamente para prioridade crítica.',
            MessageType.SYSTEM,
          );
          try {
            await this.alertsService.notifySlaBreach(t);
          } catch {}
        }
      }
    }
  }

  @Cron('0 */30 * * * *')
  async checkSlaEscalation(): Promise<void> {
    try {
      const threshold = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const atRisk = await this.ticketRepo.createQueryBuilder('t')
        .where('t.sla_resolve_at IS NOT NULL')
        .andWhere('t.sla_resolve_at <= :threshold', { threshold })
        .andWhere('t.escalated = false')
        .andWhere('t.status NOT IN (:...statuses)', { statuses: ['resolved', 'closed', 'cancelled'] })
        .getMany();
      for (const ticket of atRisk) {
        await this.ticketRepo.update(ticket.id, { escalated: true });
        if (this.webhooksSvc) {
          await this.webhooksSvc.fire(ticket.tenantId, 'sla.warning', { id: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject, slaResolveAt: ticket.slaResolveAt });
        }
        if (this.emailSvc) {
          try {
            const settings = await this.ticketRepo.manager.query('SELECT escalation_email FROM tenant_settings WHERE tenant_id = $1 LIMIT 1', [ticket.tenantId]);
            if (settings[0]?.escalation_email) {
              await this.emailSvc.sendEscalationAlert(ticket.tenantId, settings[0].escalation_email, ticket);
            }
          } catch {}
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('SLA escalation check failed:', e.message);
    }
  }

  @Cron('0 * * * *')
  async autoCloseResolvedTickets() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const tenants = await this.ticketRepo.manager.query(
      'SELECT DISTINCT tenant_id FROM tickets WHERE tenant_id IS NOT NULL',
    );

    for (const row of tenants) {
      const tenantId = row.tenant_id;

      await this.ticketRepo
        .createQueryBuilder()
        .update(Ticket)
        .set({ status: TicketStatus.CLOSED, closedAt: new Date() })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :status', { status: TicketStatus.RESOLVED })
        .andWhere('resolved_at < :cutoff', { cutoff })
        .execute();
    }
  }
}
