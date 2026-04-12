import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, EntityManager } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Cron } from '@nestjs/schedule';
import {
  Ticket, TicketMessage, TicketStatus, TicketPriority, TicketOrigin, MessageType,
} from './entities/ticket.entity';
import { TicketReplyAttachment } from './entities/ticket-reply-attachment.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';
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
import { SlaService } from '../sla/sla.service';
import { SlaPriority } from '../sla/entities/sla-policy.entity';
import { DEFAULT_SYSTEM_PRIORITY, SYSTEM_PRIORITY_VALUES } from '../../common/constants/priority.constants';

/** Normaliza prioridade do ticket para seleção de política SLA (mesmo conjunto: low | medium | high | critical). */
function toSlaPriority(priority?: TicketPriority | null): SlaPriority {
  return (priority || DEFAULT_SYSTEM_PRIORITY) as SlaPriority;
}

const STATUS_LABELS_PT: Record<string, string> = {
  open: 'Em aberto',
  in_progress: 'Em andamento',
  waiting_client: 'Aguardando cliente',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

/** Anexo de resposta pública do ticket: não incluir áudio/vídeo como ficheiro de ticket. */
const TICKET_ATTACHMENT_MIME_EXACT = new Set([
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function isAllowedTicketAttachmentMime(mimeRaw: string): boolean {
  const mime = (mimeRaw || '').toLowerCase().split(';')[0].trim();
  if (!mime) return false;
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return false;
  if (TICKET_ATTACHMENT_MIME_EXACT.has(mime)) return true;
  if (mime === 'text/plain') return true;
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif') return true;
  return false;
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  private readonly ticketAttachmentRoot =
    process.env.TICKET_REPLY_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'ticket-reply-media');

  /** POST /tickets/:id/attachments — pasta dedicada (TICKET_ATTACHMENTS_DIR). */
  private readonly ticketAttachmentsItem4Root =
    process.env.TICKET_ATTACHMENTS_DIR || path.join(process.cwd(), 'uploads', 'ticket-attachments');

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TicketMessage)
    private readonly messageRepo: Repository<TicketMessage>,
    @InjectRepository(TicketReplyAttachment)
    private readonly ticketReplyAttachmentRepo: Repository<TicketReplyAttachment>,
    @InjectRepository(TenantPriority)
    private readonly tenantPriorityRepo: Repository<TenantPriority>,
    private readonly contractsService: ContractsService,
    private readonly ticketSettingsService: TicketSettingsService,
    private readonly alertsService: AlertsService,
    private readonly realtimeEmitter: RealtimeEmitterService,
    private readonly slaService: SlaService,
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

  /**
   * Recalcula os deadlines do ticket a partir da política vigente para a prioridade atual.
   * A base temporal é sempre a criação do ticket, para manter o SLA consistente com o cadastro.
   */
  private async applyConfiguredSlaToTicket(ticket: Ticket): Promise<void> {
    const policy = await this.slaService.resolvePolicyForTicket(
      ticket.tenantId,
      ticket.priorityId ?? null,
      toSlaPriority(ticket.priority),
    );

    if (!policy) {
      ticket.slaResponseAt = null as any;
      ticket.slaResolveAt = null as any;
      return;
    }

    const deadlines = this.slaService.calcDeadlines(policy, ticket.createdAt || new Date());
    ticket.slaResponseAt = deadlines.firstResponseDeadline;
    ticket.slaResolveAt = deadlines.resolutionDeadline;
  }

  /**
   * Com ticket vinculado, a conversa mantém apenas o contexto de prioridade
   * para exibição operacional. O SLA oficial permanece exclusivo do ticket.
   */
  private async syncConversationSlaWithTicket(ticket: Ticket): Promise<void> {
    if (!ticket.conversationId) return;

    let convPriorityId = ticket.priorityId ?? null;
    if (!convPriorityId && ticket.priority) {
      const tp = await this.tenantPriorityRepo.findOne({
        where: { tenantId: ticket.tenantId, slug: String(ticket.priority) },
      });
      convPriorityId = tp?.id ?? null;
    }

    await this.ticketRepo.manager.query(
      `UPDATE conversations SET priority_id = $1 WHERE id = $2 AND tenant_id = $3`,
      [convPriorityId, ticket.conversationId, ticket.tenantId],
    );
  }

  private async assertTenantPriorityBelongs(tenantId: string, priorityId: string): Promise<void> {
    const tp = await this.tenantPriorityRepo.findOne({ where: { id: priorityId, tenantId } });
    if (!tp) {
      throw new BadRequestException('Prioridade não encontrada ou não pertence ao tenant');
    }
  }

  private async resolveTenantPriorityIdBySlug(tenantId: string, slug: string): Promise<string | null> {
    const tp = await this.tenantPriorityRepo.findOne({
      where: { tenantId, slug: String(slug) },
    });
    return tp?.id ?? null;
  }

  /**
   * Integrações que ainda enviam só o enum legado (ex.: inbound e-mail) podem resolver `priority_id` antes do create.
   */
  async resolvePriorityIdFromLegacyEnum(tenantId: string, priority: TicketPriority): Promise<string | null> {
    return this.resolveTenantPriorityIdBySlug(tenantId, String(priority));
  }

  /** Preenche priority_id a partir do enum quando ainda vazio (fluxos automáticos / pós-routing). */
  private async ensureTicketPriorityIdFromEnum(ticket: Ticket): Promise<void> {
    if (ticket.priorityId || !ticket.priority) return;
    const pid = await this.resolveTenantPriorityIdBySlug(ticket.tenantId, String(ticket.priority));
    if (!pid) return;
    ticket.priorityId = pid;
    await this.applyConfiguredSlaToTicket(ticket);
    await this.ticketRepo.save(ticket);
  }

  /** Payload JSON: prioridade cadastrável resumida (evita expor entidade completa / relações). */
  private ticketWithPriorityPayload(ticket: Ticket): Record<string, unknown> {
    const tp = ticket.tenantPriority;
    const row: Record<string, unknown> = { ...ticket };
    row.priorityInfo = tp
      ? { id: tp.id, name: tp.name, color: tp.color, slug: tp.slug, active: tp.active }
      : null;
    delete row.tenantPriority;
    return row;
  }

  /**
   * Próximo ticket_number (#000001) único globalmente (UNIQUE em ticket_number + migração 001).
   * Deve ser chamado dentro de uma transação, após pg_advisory_xact_lock (feito aqui).
   */
  private async allocateNextTicketNumberInTx(em: EntityManager): Promise<string> {
    await em.query(
      `SELECT pg_advisory_xact_lock(abs(hashtext('sempredesk:global_ticket_number'::text)))`,
    );
    const rows = await em.query<Array<{ m: number | null }>>(
      `SELECT MAX(SUBSTRING(ticket_number FROM 2 FOR 6)::integer) AS m
       FROM tickets
       WHERE ticket_number ~ '^#[0-9]{6}$'`,
    );
    const maxNum = rows[0]?.m != null ? Number(rows[0].m) : 0;
    const next = (Number.isFinite(maxNum) ? maxNum : 0) + 1;
    if (next > 999999) {
      throw new BadRequestException('Limite de numeração de tickets (#999999) atingido.');
    }
    return `#${String(next).padStart(6, '0')}`;
  }

  private async getTicketOrFail(tenantId: string, id: string): Promise<Ticket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id, tenantId },
      relations: ['tenantPriority'],
    });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  private async getTicketOrFailWithManager(em: EntityManager, tenantId: string, id: string): Promise<Ticket> {
    const ticket = await em.findOne(Ticket, { where: { id, tenantId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  private async registerSystemMessageWithManager(
    em: EntityManager,
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    content: string,
    messageType: MessageType = MessageType.STATUS_CHANGE,
  ): Promise<void> {
    const messageRepo = em.getRepository(TicketMessage);
    await messageRepo.save(
      messageRepo.create({
        tenantId,
        ticketId,
        authorId,
        authorType: 'user',
        authorName,
        messageType,
        content,
      }),
    );
  }

  /**
   * Validação antes de resolver ticket ao encerrar atendimento (WhatsApp sem empresa).
   * Executar antes da transação de encerramento da conversa.
   */
  async assertTicketReadyForFormalResolutionFromConversation(tenantId: string, ticketId: string): Promise<void> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);
    await this.ensureCustomerLinkedBeforeClosing(tenantId, ticket);
  }

  /**
   * Horas de contrato + email + webhook após resolução persistida na transação de encerramento da conversa.
   * Não invoca closeConversationFn (a conversa já está a ser fechada pelo caller).
   */
  async runPostResolveSideEffectsAfterConversationCloseTransaction(tenantId: string, ticketId: string): Promise<void> {
    const saved = await this.getTicketOrFail(tenantId, ticketId);
    if (saved.contractId && saved.timeSpentMin != null && saved.timeSpentMin > 0) {
      await this.contractsService.consumeHours(tenantId, saved.contractId, saved.timeSpentMin);
    }
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
      } catch { /* best-effort */ }
    }
    if (this.webhooksSvc) {
      try {
        await this.webhooksSvc.fire(tenantId, 'ticket.resolved', {
          id: saved.id,
          ticketNumber: saved.ticketNumber,
          subject: saved.subject,
          resolutionSummary: saved.resolutionSummary,
        });
      } catch { /* best-effort */ }
    }
  }

  /**
   * Insere mensagem no ticket dentro de uma transação (sem realtime).
   * Usado ao transcrever conversa no encerramento atómico.
   */
  async addMessageTransactional(
    em: EntityManager,
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    authorType: string,
    dto: AddMessageDto & { skipInAppBell?: boolean },
  ): Promise<TicketMessage> {
    const ticketRepo = em.getRepository(Ticket);
    const messageRepo = em.getRepository(TicketMessage);
    const ticket = await this.getTicketOrFailWithManager(em, tenantId, ticketId);

    if (!ticket.firstResponseAt && authorType !== 'contact') {
      ticket.firstResponseAt = new Date();
      await ticketRepo.save(ticket);
    }
    if (authorType === 'contact' && ticket.status === TicketStatus.WAITING_CLIENT) {
      ticket.status = TicketStatus.IN_PROGRESS;
      await ticketRepo.save(ticket);
    }

    const entity = messageRepo.create({
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
    const saved = await messageRepo.save(entity);
    return Array.isArray(saved) ? saved[0] : saved;
  }

  /**
   * Marca ticket resolvido e regista mensagem de sistema — só DB, dentro da transação de encerramento da conversa.
   */
  async applyResolveTicketInConversationCloseTransaction(
    em: EntityManager,
    tenantId: string,
    ticketId: string,
    userId: string,
    userName: string,
    dto: Pick<ResolveTicketDto, 'resolutionSummary' | 'timeSpentMin'>,
  ): Promise<Ticket> {
    const ticketRepo = em.getRepository(Ticket);
    const ticket = await this.getTicketOrFailWithManager(em, tenantId, ticketId);
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
    const saved = await ticketRepo.save(ticket);
    await this.registerSystemMessageWithManager(
      em,
      tenantId,
      ticketId,
      userId,
      userName,
      `Chamado resolvido${saved.resolutionSummary ? `: ${saved.resolutionSummary}` : ''}`,
    );
    return saved;
  }

  private isRealClientRecord(client?: { company_name?: string | null; trade_name?: string | null; metadata?: Record<string, any> | null } | null): boolean {
    if (!client) return false;
    const autoCreated = client.metadata?.autoCreated === true || client.metadata?.autoCreated === 'true';
    const looksWhatsappTemp =
      /\(WhatsApp\)$/i.test(client.company_name ?? '') ||
      /\(WhatsApp\)$/i.test(client.trade_name ?? '');
    return !autoCreated && !looksWhatsappTemp;
  }

  private async ensureCustomerLinkedBeforeClosing(tenantId: string, ticket: Ticket): Promise<void> {
    if (ticket.origin !== TicketOrigin.WHATSAPP || !ticket.contactId) return;
    if (ticket.customerSelectedAt) return;

    if (ticket.unlinkedContact) {
      throw new BadRequestException('Defina a empresa do contato antes de encerrar o atendimento.');
    }

    if (!ticket.clientId) {
      throw new BadRequestException('Defina a empresa do contato antes de encerrar o atendimento.');
    }

    const rows = await this.ticketRepo.manager.query<Array<{
      ticket_company_name: string | null;
      ticket_trade_name: string | null;
      ticket_metadata: Record<string, any> | null;
      contact_company_name: string | null;
      contact_trade_name: string | null;
      contact_metadata: Record<string, any> | null;
    }>>(
      `SELECT
         tc.company_name AS ticket_company_name,
         tc.trade_name   AS ticket_trade_name,
         tc.metadata     AS ticket_metadata,
         cc.company_name AS contact_company_name,
         cc.trade_name   AS contact_trade_name,
         cc.metadata     AS contact_metadata
       FROM contacts c
       LEFT JOIN clients tc
         ON tc.id::text = $2
        AND tc.tenant_id::text = $1
       LEFT JOIN clients cc
         ON cc.id::text = c.client_id::text
        AND cc.tenant_id::text = $1
       WHERE c.id::text = $3
         AND c.tenant_id::text = $1
       LIMIT 1`,
      [tenantId, ticket.clientId, ticket.contactId],
    );

    const row = rows[0];
    const ticketClientIsReal = this.isRealClientRecord(row ? {
      company_name: row.ticket_company_name,
      trade_name: row.ticket_trade_name,
      metadata: row.ticket_metadata,
    } : null);
    const contactClientIsReal = this.isRealClientRecord(row ? {
      company_name: row.contact_company_name,
      trade_name: row.contact_trade_name,
      metadata: row.contact_metadata,
    } : null);

    if (ticketClientIsReal && contactClientIsReal) return;

    throw new BadRequestException('Defina a empresa do contato antes de encerrar o atendimento.');
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
              target.network_id as target_network_id,
              EXISTS(
                SELECT 1
                  FROM contact_customers cc
                 WHERE cc.tenant_id = $1::text
                   AND cc.contact_id = $2::text
                   AND cc.client_id = $3::text
              ) AS linked_to_target
       FROM contacts c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN clients target ON target.id = $3::uuid AND target.tenant_id::text = $1
       WHERE c.tenant_id::text = $1 AND c.id = $2::uuid`,
      [tenantId, contactId, clientId],
    );

    if (!rows.length) throw new BadRequestException('Contato inválido para este tenant');

    const r = rows[0];
    if (r.contact_client_id === clientId) return;
    if (r.linked_to_target) return;

    // Contato ainda não vinculado a nenhum cliente (ingresso por WhatsApp/LID antes de
    // ser associado). Pertence ao tenant → pode ser usado em tickets de qualquer cliente
    // deste tenant. O vínculo definitivo é feito durante o ingresso da mensagem WhatsApp.
    if (!r.contact_client_id) return;

    if (r.contact_network_id && r.target_network_id && r.contact_network_id === r.target_network_id) {
      return;
    }

    // Safety net: aceita contato que já tem conversa vinculada a este cliente neste tenant.
    // Cobre casos em que o contato foi associado ao cliente pela conversa (WhatsApp/chatbot)
    // mas o vínculo direto na tabela contacts ainda não foi persistido de forma explícita.
    const convRows = await this.ticketRepo.manager.query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND contact_id = $2 AND client_id = $3 LIMIT 1`,
      [tenantId, contactId, clientId],
    );
    if (convRows.length) return;

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

  private async alignPriorityEnumFromPriorityId(
    tenantId: string,
    priorityId: string | null,
    fallback: TicketPriority,
  ): Promise<TicketPriority> {
    if (!priorityId) return fallback;
    const tenantPriority = await this.tenantPriorityRepo.findOne({
      where: { id: priorityId, tenantId },
    });
    if (tenantPriority && SYSTEM_PRIORITY_VALUES.includes(tenantPriority.slug as any)) {
      return tenantPriority.slug as TicketPriority;
    }
    return fallback;
  }

  private async resolveInheritedPriorityIdForClassification(
    tenantId: string,
    classification: { department?: string | null; category?: string | null; subcategory?: string | null },
  ): Promise<string | null> {
    return this.ticketSettingsService.resolveDefaultPriorityIdForClassification(tenantId, {
      department: classification.department ?? null,
      category: classification.category ?? null,
      subcategory: classification.subcategory ?? null,
    });
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

    const offlinePriorityId =
      (await this.resolveTenantPriorityIdBySlug(tenantId, String(TicketPriority.HIGH))) ?? null;
    const now = new Date();
    let slaResponseAt: Date | null = null;
    let slaResolveAt: Date | null = null;
    try {
      const policy = await this.slaService.resolvePolicyForTicket(
        tenantId,
        offlinePriorityId,
        toSlaPriority(TicketPriority.HIGH),
      );
      if (policy) {
        const deadlines = this.slaService.calcDeadlines(policy, now);
        slaResponseAt = deadlines.firstResponseDeadline;
        slaResolveAt = deadlines.resolutionDeadline;
      }
    } catch {
      /* SLA opcional */
    }

    return this.ticketRepo.manager.transaction(async (em) => {
      const ticketNumber = await this.allocateNextTicketNumberInTx(em);

      const subject = `PDV offline: ${device.name}`;
      const description = [
        `Detecção automática: equipamento ficou offline (sem heartbeat há > 5min).`,
        `Device: ${device.name} (${device.id})`,
        device.ipAddress ? `IP: ${device.ipAddress}` : null,
      ].filter(Boolean).join('\n');

      const ticket = em.create(Ticket, {
        tenantId,
        ticketNumber,
        clientId: device.clientId,
        origin: TicketOrigin.INTERNAL,
        priority: TicketPriority.HIGH,
        priorityId: offlinePriorityId,
        status: TicketStatus.OPEN,
        subject,
        description,
        category: 'infraestrutura',
        slaResponseAt,
        slaResolveAt,
        metadata: { deviceId: device.id, deviceName: device.name, source: 'monitoring', type: 'device_offline' },
        createdAt: now as any,
        updatedAt: now as any,
      } as any);

      const saved = await em.save(Ticket, ticket);

      await em.save(
        TicketMessage,
        em.create(TicketMessage, {
          tenantId,
          ticketId: saved.id,
          authorId: null,
          authorType: 'system',
          authorName: 'Monitoring Engine',
          messageType: MessageType.SYSTEM,
          content: 'Ticket criado automaticamente devido a dispositivo offline.',
        }),
      );

      return saved;
    });
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

    // Vincula contrato ativo ao ticket (sem herdar SLA do contrato — fonte de verdade é sla_policies)
    if (!dto.contractId && dto.clientId) {
      const contract = await this.contractsService.findActiveContractForClient(tenantId, dto.clientId);
      if (contract) dto.contractId = contract.id;
    }

    let effectivePriority: TicketPriority = dto.priority ?? DEFAULT_SYSTEM_PRIORITY;
    let effectivePriorityId: string | null = dto.priorityId ?? null;
    if (dto.priorityId) {
      await this.assertTenantPriorityBelongs(tenantId, dto.priorityId);
      effectivePriority = await this.alignPriorityEnumFromPriorityId(
        tenantId,
        dto.priorityId,
        effectivePriority,
      );
    } else if (dto.priority === undefined) {
      effectivePriorityId = await this.resolveInheritedPriorityIdForClassification(
        tenantId,
        classification,
      );
      effectivePriority = await this.alignPriorityEnumFromPriorityId(
        tenantId,
        effectivePriorityId,
        effectivePriority,
      );
    }

    if (!effectivePriorityId) {
      effectivePriorityId =
        (await this.resolveTenantPriorityIdBySlug(tenantId, String(effectivePriority))) ?? null;
    }

    const slaPriority = toSlaPriority(effectivePriority);
    const now = new Date();
    let slaResponseAt: Date | undefined;
    let slaResolveAt: Date | undefined;
    try {
      const policy = await this.slaService.resolvePolicyForTicket(
        tenantId,
        effectivePriorityId,
        slaPriority,
      );
      if (policy) {
        const deadlines = this.slaService.calcDeadlines(policy, now);
        slaResponseAt = deadlines.firstResponseDeadline;
        slaResolveAt  = deadlines.resolutionDeadline;
      }
    } catch (err: any) {
      this.logger.warn(`[SLA] tickets.create: falha ao buscar política — tenant=${tenantId}: ${err?.message}`);
    }

    // tickets.description é NOT NULL no PostgreSQL; o atendimento pode enviar descrição vazia
    const descriptionText =
      (dto.description && String(dto.description).trim()) ||
      (dto.conversationId
        ? 'Ticket criado a partir da conversa no atendimento.'
        : 'Sem descrição.');

    const ticketSaved = await this.ticketRepo.manager.transaction(async (em) => {
      const ticketNumber = await this.allocateNextTicketNumberInTx(em);
      const ticket = em.create(Ticket, {
        ...dto,
        priority: effectivePriority,
        priorityId: effectivePriorityId,
        description: descriptionText,
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
      const saved = await em.save(Ticket, ticket);
      return Array.isArray(saved) ? saved[0] : saved;
    });

    // Apply routing rules: auto-assign, set priority, notify email
    if (this.routingSvc) {
      try {
        const routing = await this.routingSvc.applyRules(tenantId, ticketSaved);
        const routingUpdates: any = {};
        if (routing.assignTo) routingUpdates.assignedTo = routing.assignTo;
        if (routing.priority) {
          routingUpdates.priority = routing.priority;
          routingUpdates.priorityId =
            (await this.resolveTenantPriorityIdBySlug(tenantId, routing.priority)) ?? null;
        }
        if (Object.keys(routingUpdates).length > 0) {
          const beforeP = ticketSaved.priority;
          const beforePid = ticketSaved.priorityId ?? null;
          Object.assign(ticketSaved, routingUpdates);
          const priorityOrIdChanged =
            ticketSaved.priority !== beforeP ||
            (ticketSaved.priorityId ?? null) !== beforePid;
          if (priorityOrIdChanged) {
            await this.applyConfiguredSlaToTicket(ticketSaved);
          }
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

    /** Criado pelo painel (agente) sem responsável: atribui ao criador — evita sumir da lista quando não há ticket.view_all. */
    if (authorType === 'user' && !ticketSaved.assignedTo) {
      ticketSaved.assignedTo = userId;
      ticketSaved.status = TicketStatus.IN_PROGRESS;
      await this.ticketRepo.save(ticketSaved);
    }

    await this.ensureTicketPriorityIdFromEnum(ticketSaved);

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
          priorityId: ticketSaved.priorityId ?? null,
        });
      } catch {}
    }

    await this.syncConversationSlaWithTicket(ticketSaved);
    return this.findOne(tenantId, ticketSaved.id);
  }

  async findAll(tenantId: string, filters: FilterTicketsDto) {
    const {
      page = 1,
      perPage = 20,
      status,
      priority,
      priorityId: filterPriorityId,
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

    /** `orderBy('t.created_at')` quebra no getManyAndCount+join: TypeORM espera propertyPath (`createdAt`), não nome SQL. */
    const sortMap: Record<string, string> = {
      ticketNumber: 't.ticketNumber',
      subject: 't.subject',
      createdAt: 't.createdAt',
      updatedAt: 't.updatedAt',
      status: 't.status',
      priority: 't.priority',
    };
    const [rawField, rawDir] = ((filters as any).sort || 'createdAt:desc').split(':');
    const sortCol = sortMap[rawField] ?? 't.createdAt';
    const sortDir: 'ASC' | 'DESC' = rawDir?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.ticketRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.tenantPriority', 'tp')
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
    }
    // Sem `origin`: listagem geral inclui internal/email/phone — tickets criados no painel usam origin internal.
    if (filterPriorityId) {
      qb.andWhere('t.priority_id = :filterPriorityId', { filterPriorityId });
    } else if (priority) {
      qb.andWhere('t.priority = :priority', { priority });
    }
    const agentId = (filters as any).agentId as string | undefined;
    if (agentId) {
      // Visão do agente: tickets atribuídos a ele OU sem responsável (fila aberta para qualquer agente pegar)
      qb.andWhere('(t.assigned_to = :agentId OR t.assigned_to IS NULL)', { agentId });
    } else if (assignedTo) {
      qb.andWhere('t.assigned_to = :assignedTo', { assignedTo });
    }
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

    const withPriority = data.map((t) => this.ticketWithPriorityPayload(t));

    // Enriquece com contactName para tickets criados via WhatsApp (sem clientId)
    if (withPriority.length > 0) {
      const contactIds = [...new Set(
        withPriority.filter((t) => (t as any).contactId).map((t) => (t as any).contactId as string),
      )];
      if (contactIds.length > 0) {
        try {
          const contacts: Array<{ id: string; name: string }> = await this.ticketRepo.manager.query(
            `SELECT id::text, name FROM contacts WHERE tenant_id = $1 AND id::text = ANY($2::text[])`,
            [tenantId, contactIds],
          );
          const contactMap = new Map(contacts.map((c) => [c.id, c.name]));
          withPriority.forEach((t) => {
            const cid = (t as any).contactId as string | undefined;
            if (cid) (t as any).contactName = contactMap.get(cid) ?? null;
          });
        } catch {}
      }
    }

    if (includeLastMessage && withPriority.length > 0) {
      const ids = withPriority.map((t) => t.id as string);
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
      const enriched = withPriority.map((row) => {
        const last = lastByTicket.get(row.id as string);
        return {
          ...row,
          lastAgentMessage: last ? { content: last.content.slice(0, 120), createdAt: last.createdAt } : null,
        };
      });
      return { data: enriched, total, page, perPage, totalPages: Math.ceil(total / perPage) };
    }

    return { data: withPriority, total, page, perPage, totalPages: Math.ceil(total / perPage) };
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
      .orderBy('t.updatedAt', 'DESC')
      .take(Math.min(perPage, 100));

    if (origin === 'portal') return [];
    if (origin) qb.andWhere('t.origin = :origin', { origin });
    else qb.andWhere('t.origin = :origin', { origin: TicketOrigin.WHATSAPP });
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
        origin: TicketOrigin.WHATSAPP,
        conversationId: IsNull(),
        status: In([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT]),
      },
    });
  }

  /**
   * Chamados em aberto atribuídos ao agente (isolado por tenant).
   * Estados abertos: open, in_progress, waiting_client.
   */
  async countOpenTicketsAssignedToAgent(tenantId: string, agentUserId: string): Promise<number> {
    return this.ticketRepo.count({
      where: {
        tenantId,
        assignedTo: agentUserId,
        status: In([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT]),
      },
    });
  }

  async findOne(tenantId: string, id: string): Promise<any> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    const out = this.ticketWithPriorityPayload(ticket) as any;
    // Inclui dados do responsável para evitar chamada extra ao endpoint /team
    if (out.assignedTo) {
      try {
        const rows = await this.ticketRepo.manager.query(
          `SELECT id, name, email FROM users WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, out.assignedTo],
        );
        if (rows[0]) out.assignedUser = rows[0];
      } catch {}
    }
    // Inclui contactName para tickets criados via WhatsApp (sem clientId)
    if (out.contactId) {
      try {
        const rows = await this.ticketRepo.manager.query(
          `SELECT name FROM contacts WHERE tenant_id = $1 AND id::text = $2 LIMIT 1`,
          [tenantId, String(out.contactId)],
        );
        if (rows[0]) out.contactName = rows[0].name;
      } catch {}
    }
    return out;
  }

  async linkToConversation(tenantId: string, ticketId: string, conversationId: string): Promise<void> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);
    ticket.conversationId = conversationId;
    await this.ticketRepo.save(ticket);
    await this.syncConversationSlaWithTicket(ticket);
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
    const oldPriority = ticket.priority;
    const oldPriorityId = ticket.priorityId ?? null;
    const oldDepartment = ticket.department ?? null;
    const previousClassification = {
      department: ticket.department ?? null,
      category: ticket.category ?? null,
      subcategory: ticket.subcategory ?? null,
    };

    await this.assertUserBelongsToTenant(tenantId, dto.assignedTo);

    const userChangedClassification =
      dto.department !== undefined || dto.category !== undefined || dto.subcategory !== undefined;

    const updates: any = { ...dto };
    if (dto.priorityId !== undefined) {
      if (dto.priorityId === null || dto.priorityId === '') {
        updates.priorityId = null;
      } else {
        await this.assertTenantPriorityBelongs(tenantId, dto.priorityId);
      }
    }

    let nextClassification = previousClassification;
    if (userChangedClassification) {
      nextClassification = await this.resolveTicketClassification(
        tenantId,
        dto.department ?? ticket.department,
        dto.category ?? ticket.category,
        dto.subcategory ?? ticket.subcategory,
      );
      updates.department = nextClassification.department || undefined;
      updates.category = nextClassification.category || undefined;
      updates.subcategory = nextClassification.subcategory || undefined;
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

    if (dto.priority !== undefined && dto.priorityId === undefined) {
      ticket.priorityId =
        (await this.resolveTenantPriorityIdBySlug(tenantId, dto.priority!)) ?? null;
    }

    if (dto.priorityId !== undefined) {
      ticket.priority = await this.alignPriorityEnumFromPriorityId(
        tenantId,
        ticket.priorityId ?? null,
        ticket.priority,
      );
    } else if (dto.priority === undefined && userChangedClassification) {
      const previousDefaultPriorityId = await this.resolveInheritedPriorityIdForClassification(
        tenantId,
        previousClassification,
      );
      const shouldRefreshInheritedPriority =
        oldPriorityId === null || oldPriorityId === previousDefaultPriorityId;

      if (shouldRefreshInheritedPriority) {
        ticket.priorityId = await this.resolveInheritedPriorityIdForClassification(
          tenantId,
          nextClassification,
        );
        ticket.priority = await this.alignPriorityEnumFromPriorityId(
          tenantId,
          ticket.priorityId ?? null,
          ticket.priority,
        );
      }
    }

    if (!ticket.priorityId && ticket.priority) {
      ticket.priorityId =
        (await this.resolveTenantPriorityIdBySlug(tenantId, String(ticket.priority))) ?? null;
    }

    if (ticket.priorityId) {
      ticket.priority = await this.alignPriorityEnumFromPriorityId(
        tenantId,
        ticket.priorityId,
        ticket.priority,
      );
    }

    const priorityOrIdChanged =
      ticket.priority !== oldPriority ||
      (ticket.priorityId ?? null) !== oldPriorityId;
    if (priorityOrIdChanged) {
      await this.applyConfiguredSlaToTicket(ticket);
    }

    const saved = await this.ticketRepo.save(ticket);
    await this.syncConversationSlaWithTicket(saved);

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
          priority: saved.priority,
          priorityId: saved.priorityId ?? null,
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

    return this.findOne(tenantId, id);
  }

  async updateContent(tenantId: string, id: string, userId: string, userName: string, dto: UpdateTicketContentDto): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    const oldSubject = ticket.subject ?? '';
    const oldDescription = ticket.description ?? '';

    ticket.subject = dto.subject.trim();
    if (dto.description !== undefined) {
      ticket.description = dto.description.trim();
    }

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

    return this.findOne(tenantId, id);
  }

  async assign(tenantId: string, id: string, techId: string, assignedByUserId?: string, assignedByUserName?: string): Promise<Ticket> {
    const ticket = await this.getTicketOrFail(tenantId, id);
    await this.assertUserBelongsToTenant(tenantId, techId);
    if (this.attendanceSvc) {
      const available = await this.attendanceSvc.isAvailable(tenantId, techId);
      if (available === false) throw new BadRequestException("Agente em pausa — não é possível atribuir tickets no momento");
    }
    const prevAssignedTo: string | null = (ticket as any).assignedTo ?? null;
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

    // Notifica todos os agentes do tenant: atualização geral da fila
    this.realtimeEmitter.emitToTenant(tenantId, 'queue:updated', {
      ticketId: id,
      assignedTo: techId,
      assignedToName: techName ?? techId,
    });

    // Notificação detalhada de transferência — o frontend usa para toasts e refresh de inbox
    this.realtimeEmitter.emitToTenant(tenantId, 'ticket:assigned', {
      ticketId: id,
      ticketNumber: (saved as any).ticketNumber ?? null,
      subject: (saved as any).subject ?? null,
      assignedTo: techId,
      assignedToName: techName ?? techId,
      prevAssignedTo,
      assignedBy: assignedByUserId ?? techId,
      assignedByName: assignedByUserName ?? techName ?? 'Sistema',
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
    await this.ensureCustomerLinkedBeforeClosing(tenantId, ticket);

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
    await this.ensureCustomerLinkedBeforeClosing(tenantId, ticket);

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
    dto: AddMessageDto & { skipInAppBell?: boolean },
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
    if (!dto.skipInAppBell) {
      const text = (msg.content || '').trim();
      this.realtimeEmitter.emitTenantTicketMessageNotify(tenantId, {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        content: text.length > 80 ? `${text.slice(0, 77)}…` : text || '(sem texto)',
      });
    }
    return msg;
  }

  /** Ficheiro já em disco sob root; devolve tamanho em bytes. */
  private async attachmentFileOnDiskSizeBytes(root: string, tenantId: string, storageKey: string): Promise<number> {
    const sk = (storageKey || '').trim();
    if (!sk || sk.includes('..') || path.isAbsolute(sk)) {
      throw new BadRequestException('Chave de storage inválida');
    }
    if (!sk.startsWith(`${tenantId}/`)) {
      throw new BadRequestException('Chave de storage inválida');
    }
    const full = path.join(root, ...sk.split('/'));
    const rootResolved = path.resolve(root);
    const fileResolved = path.resolve(full);
    if (!fileResolved.startsWith(rootResolved + path.sep) && fileResolved !== rootResolved) {
      throw new BadRequestException('Chave de storage inválida');
    }
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) {
      throw new BadRequestException('Ficheiro ausente');
    }
    return stat.size;
  }

  /** Evita ficheiro órfão em disco quando o MIME não passa na whitelist (multer já gravou o ficheiro). */
  isPublicReplyAttachmentMimeAllowed(mimeRaw: string): boolean {
    return isAllowedTicketAttachmentMime((mimeRaw || '').trim());
  }

  /**
   * Stream do ficheiro de anexo da resposta pública (domínio ticket).
   * Valida tenant, ticket e mensagem; não usa conversa nem CONVERSATION_MEDIA_DIR.
   */
  async getReplyAttachmentMediaStream(
    tenantId: string,
    ticketId: string,
    attachmentId: string,
    opts?: { isPortal?: boolean },
  ): Promise<{ stream: fs.ReadStream; mime: string; originalFilename: string | null }> {
    const att = await this.ticketReplyAttachmentRepo.findOne({
      where: { id: attachmentId, tenantId },
      relations: ['ticketMessage'],
    });
    if (!att?.ticketMessage) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const msg = att.ticketMessage;
    if (msg.tenantId !== tenantId || msg.ticketId !== ticketId) {
      throw new NotFoundException('Anexo não encontrado');
    }
    if (opts?.isPortal && msg.messageType === MessageType.INTERNAL) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const storageKey = (att.storageKey || '').trim();
    if (!storageKey || storageKey.includes('..') || path.isAbsolute(storageKey)) {
      throw new NotFoundException('Anexo não encontrado');
    }
    if (!storageKey.startsWith(`${tenantId}/`)) {
      throw new NotFoundException('Anexo não encontrado');
    }

    // Anexos podem estar em dois diretórios dependendo do endpoint de upload usado:
    //   TICKET_REPLY_MEDIA_DIR  → POST /tickets/:id/messages/attachment (resposta pública)
    //   TICKET_ATTACHMENTS_DIR  → POST /tickets/:id/attachments (item4 / gestão de ticket)
    // Ambos registam o mesmo kind='ticket_reply_file' e o frontend usa este endpoint para os dois.
    // Tentamos o diretório primário primeiro; se não encontrar, tentamos o secundário.
    const roots = [this.ticketAttachmentRoot, this.ticketAttachmentsItem4Root];
    let resolvedFilePath: string | null = null;
    for (const root of roots) {
      const candidate = path.join(root, ...storageKey.split('/'));
      const rootResolved = path.resolve(root);
      const fileResolved = path.resolve(candidate);
      if (!fileResolved.startsWith(rootResolved + path.sep) && fileResolved !== rootResolved) {
        continue; // path traversal — ignorar
      }
      const exists = await fs.promises.access(candidate).then(() => true).catch(() => false);
      if (exists) {
        resolvedFilePath = candidate;
        break;
      }
    }
    if (!resolvedFilePath) {
      throw new NotFoundException('Ficheiro ausente');
    }
    const mime = (att.mime || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    return {
      stream: fs.createReadStream(resolvedFilePath),
      mime,
      originalFilename: att.originalFilename,
    };
  }

  /** ticket_id do anexo (ACL portal antes de servir o ficheiro). */
  async getTicketReplyAttachmentTicketId(tenantId: string, attachmentId: string): Promise<string> {
    const att = await this.ticketReplyAttachmentRepo.findOne({
      where: { id: attachmentId, tenantId },
      select: ['id', 'ticketId'],
    });
    if (!att) throw new NotFoundException('Anexo não encontrado');
    return att.ticketId;
  }

  /**
   * Stream do anexo gravado em TICKET_ATTACHMENTS_DIR (POST /tickets/:id/attachments).
   */
  async getItem4AttachmentMediaStream(
    tenantId: string,
    attachmentId: string,
    opts?: { isPortal?: boolean },
  ): Promise<{ stream: fs.ReadStream; mime: string; originalFilename: string | null }> {
    const att = await this.ticketReplyAttachmentRepo.findOne({
      where: { id: attachmentId, tenantId },
      relations: ['ticketMessage'],
    });
    if (!att?.ticketMessage) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const msg = att.ticketMessage;
    if (msg.tenantId !== tenantId || msg.ticketId !== att.ticketId) {
      throw new NotFoundException('Anexo não encontrado');
    }
    if (opts?.isPortal && msg.messageType === MessageType.INTERNAL) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const storageKey = (att.storageKey || '').trim();
    if (!storageKey || storageKey.includes('..') || path.isAbsolute(storageKey)) {
      throw new NotFoundException('Anexo não encontrado');
    }
    if (!storageKey.startsWith(`${tenantId}/`)) {
      throw new NotFoundException('Anexo não encontrado');
    }
    const filePath = path.join(this.ticketAttachmentsItem4Root, ...storageKey.split('/'));
    const rootResolved = path.resolve(this.ticketAttachmentsItem4Root);
    const fileResolved = path.resolve(filePath);
    if (!fileResolved.startsWith(rootResolved + path.sep) && fileResolved !== rootResolved) {
      throw new NotFoundException('Anexo não encontrado');
    }
    await fs.promises.access(filePath).catch(() => {
      throw new NotFoundException('Ficheiro ausente');
    });
    const mime = (att.mime || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    return {
      stream: fs.createReadStream(filePath),
      mime,
      originalFilename: att.originalFilename,
    };
  }

  /**
   * Resposta pública com um anexo (multipart). Não usa conversationId.
   * Áudio e vídeo são rejeitados; imagem/PDF/Office/zip/texto permitidos conforme whitelist.
   */
  async addPublicReplyWithAttachment(
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    authorType: string,
    opts: {
      content?: string;
      storageKey: string;
      originalFilename?: string;
      mime: string;
      channel?: string;
      skipInAppBell?: boolean;
    },
  ): Promise<{ message: TicketMessage; attachment: TicketReplyAttachment }> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);
    const mime = (opts.mime || '').trim();
    if (!isAllowedTicketAttachmentMime(mime)) {
      throw new BadRequestException(
        'Tipo de ficheiro não permitido para anexo de ticket (áudio/vídeo não são aceites; use imagem, PDF, Office ou ZIP).',
      );
    }
    const storageKey = (opts.storageKey || '').trim();
    if (!storageKey) {
      throw new BadRequestException('Ficheiro vazio.');
    }
    const sizeBytes = await this.attachmentFileOnDiskSizeBytes(this.ticketAttachmentRoot, tenantId, storageKey);
    if (sizeBytes <= 0) {
      throw new BadRequestException('Ficheiro vazio.');
    }

    const label = path.basename(opts.originalFilename || 'anexo').slice(0, 200);
    const text = (opts.content ?? '').trim();
    const displayContent = text || `📎 ${label}`;

    if (!ticket.firstResponseAt && authorType !== 'contact') {
      ticket.firstResponseAt = new Date();
      await this.ticketRepo.save(ticket);
    }
    if (authorType === 'contact' && ticket.status === TicketStatus.WAITING_CLIENT) {
      ticket.status = TicketStatus.IN_PROGRESS;
      await this.ticketRepo.save(ticket);
    }

    const result = await this.messageRepo.manager.transaction(async (em) => {
      const msg = em.create(TicketMessage, {
        tenantId,
        ticketId,
        authorId,
        authorType,
        authorName,
        messageType: MessageType.COMMENT,
        content: displayContent,
        attachments: [],
        channel: opts.channel ?? undefined,
      });
      const savedMsg = await em.save(TicketMessage, msg);
      const att = em.create(TicketReplyAttachment, {
        tenantId,
        ticketId,
        ticketMessageId: savedMsg.id,
        storageKey,
        mime: mime || null,
        sizeBytes: String(sizeBytes),
        originalFilename: opts.originalFilename || label || null,
      });
      const savedAtt = await em.save(TicketReplyAttachment, att);
      savedMsg.attachments = [
        {
          id: savedAtt.id,
          kind: 'ticket_reply_file',
          mime: savedAtt.mime,
          filename: savedAtt.originalFilename,
        },
      ];
      await em.save(TicketMessage, savedMsg);
      return { message: savedMsg, attachment: savedAtt };
    });

    const { message: msg, attachment: savedAtt } = result;
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
    if (!opts.skipInAppBell) {
      const preview = displayContent.length > 80 ? `${displayContent.slice(0, 77)}…` : displayContent;
      this.realtimeEmitter.emitTenantTicketMessageNotify(tenantId, {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        content: preview || '(anexo)',
      });
    }
    return { message: msg, attachment: savedAtt };
  }

  /**
   * Anexo via POST /tickets/:id/attachments — ficheiro em TICKET_ATTACHMENTS_DIR; magic bytes validados no controller.
   */
  async addTicketAttachmentItem4(
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    authorType: string,
    opts: {
      content?: string;
      storageKey: string;
      originalFilename?: string;
      mime: string;
      channel?: string;
      skipInAppBell?: boolean;
    },
  ): Promise<{ message: TicketMessage; attachment: TicketReplyAttachment }> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);
    const mime = (opts.mime || '').trim();
    const storageKey = (opts.storageKey || '').trim();
    if (!storageKey) {
      throw new BadRequestException('Ficheiro vazio.');
    }
    const sizeBytes = await this.attachmentFileOnDiskSizeBytes(this.ticketAttachmentsItem4Root, tenantId, storageKey);
    if (sizeBytes <= 0) {
      throw new BadRequestException('Ficheiro vazio.');
    }

    const label = path.basename(opts.originalFilename || 'anexo').slice(0, 200);
    const text = (opts.content ?? '').trim();
    const displayContent = text || `📎 ${label}`;

    if (!ticket.firstResponseAt && authorType !== 'contact') {
      ticket.firstResponseAt = new Date();
      await this.ticketRepo.save(ticket);
    }
    if (authorType === 'contact' && ticket.status === TicketStatus.WAITING_CLIENT) {
      ticket.status = TicketStatus.IN_PROGRESS;
      await this.ticketRepo.save(ticket);
    }

    const result = await this.messageRepo.manager.transaction(async (em) => {
      const msg = em.create(TicketMessage, {
        tenantId,
        ticketId,
        authorId,
        authorType,
        authorName,
        messageType: MessageType.COMMENT,
        content: displayContent,
        attachments: [],
        channel: opts.channel ?? undefined,
      });
      const savedMsg = await em.save(TicketMessage, msg);
      const att = em.create(TicketReplyAttachment, {
        tenantId,
        ticketId,
        ticketMessageId: savedMsg.id,
        storageKey,
        mime: mime || null,
        sizeBytes: String(sizeBytes),
        originalFilename: opts.originalFilename || label || null,
      });
      const savedAtt = await em.save(TicketReplyAttachment, att);
      savedMsg.attachments = [
        {
          id: savedAtt.id,
          kind: 'ticket_reply_file',
          mime: savedAtt.mime,
          filename: savedAtt.originalFilename,
        },
      ];
      await em.save(TicketMessage, savedMsg);
      return { message: savedMsg, attachment: savedAtt };
    });

    const { message: msg, attachment: savedAtt } = result;
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
    if (!opts.skipInAppBell) {
      const preview = displayContent.length > 80 ? `${displayContent.slice(0, 77)}…` : displayContent;
      this.realtimeEmitter.emitTenantTicketMessageNotify(tenantId, {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        content: preview || '(anexo)',
      });
    }
    return { message: msg, attachment: savedAtt };
  }

  async getMessages(tenantId: string, ticketId: string, includeInternal = true): Promise<TicketMessage[]> {
    await this.getTicketOrFail(tenantId, ticketId);

    const qb = this.messageRepo.createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.ticket_id = :ticketId', { ticketId })
      .orderBy('m.createdAt', 'ASC');

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
      .orderBy('m.createdAt', 'DESC')
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
    ticket.priorityId =
      (await this.resolveTenantPriorityIdBySlug(tenantId, TicketPriority.CRITICAL)) ?? null;
    ticket.escalated = true;
    await this.applyConfiguredSlaToTicket(ticket);
    const saved = await this.ticketRepo.save(ticket);
    await this.syncConversationSlaWithTicket(saved);
    return saved;
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
          t.priorityId =
            (await this.resolveTenantPriorityIdBySlug(tenantId, TicketPriority.CRITICAL)) ?? null;
          await this.applyConfiguredSlaToTicket(t);

          await this.ticketRepo.save(t);
          await this.syncConversationSlaWithTicket(t);

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

