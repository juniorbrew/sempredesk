import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull } from 'typeorm';
import { Conversation, ConversationChannel, ConversationStatus, ConversationInitiatedBy } from './entities/conversation.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CustomersService } from '../customers/customers.service';
import { TicketMessage, TicketOrigin } from '../tickets/entities/ticket.entity';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);
  private conversationMessageMediaSchemaReady = false;
  private conversationMessageMediaSchemaPromise: Promise<void> | null = null;

  private readonly mediaRoot =
    process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');

  private logConversationResolution(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  /** Setter para ChatbotService — injetado via AppModule.onModuleInit (evita circular dep) */
  private chatbotService: {
    resetSession(tenantId: string, identifier: string, channel?: string): Promise<void>;
    initiateRating(
      tenantId: string,
      identifier: string,
      ticketId: string,
      channel: string,
      outboundSend: (text: string) => Promise<void>,
    ): Promise<void>;
  } | null = null;
  setChatbotService(svc: {
    resetSession(tenantId: string, identifier: string, channel?: string): Promise<void>;
    initiateRating(
      tenantId: string,
      identifier: string,
      ticketId: string,
      channel: string,
      outboundSend: (text: string) => Promise<void>,
    ): Promise<void>;
  }) {
    this.chatbotService = svc;
  }

  /** Dispatcher de envio outbound (WhatsApp/Baileys) — registrado pelo WhatsappModule.onModuleInit */
  private outboundSender:
    | ((
        tenantId: string,
        toWhatsapp: string,
        payload:
          | string
          | { kind: 'image' | 'audio' | 'video'; filePath: string; caption?: string; mime?: string },
      ) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>)
    | null = null;
  setOutboundSender(
    fn: (
      tenantId: string,
      toWhatsapp: string,
      payload: string | { kind: 'image' | 'audio' | 'video'; filePath: string; caption?: string; mime?: string },
    ) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>,
  ) {
    this.outboundSender = fn;
  }

  /** Dispatcher de read receipts (Baileys) — registrado pelo WhatsappModule.onModuleInit */
  private markReadFn: ((tenantId: string, remoteJid: string, messageIds: string[]) => Promise<void>) | null = null;
  setMarkReadHandler(fn: (tenantId: string, remoteJid: string, messageIds: string[]) => Promise<void>) {
    this.markReadFn = fn;
  }

  /**
   * Envia confirmação de leitura para as mensagens do contato nesta conversa.
   * Chamado quando o agente abre a conversa no dashboard.
   */
  async markConversationRead(tenantId: string, conversationId: string): Promise<void> {
    if (!this.markReadFn) return;
    try {
      await this.ensureConversationMessageMediaSchemaReady();
      const conv = await this.convRepo.findOne({ where: { tenantId, id: conversationId } });
      if (!conv || conv.channel !== 'whatsapp' || !conv.contactId) return;

      // Resolve JID do contato
      const contact = await this.customersService.findContactById(tenantId, conv.contactId);
      if (!contact) return;
      let remoteJid: string;
      const lid = (contact as any).metadata?.whatsappLid;
      if (lid) {
        const lidDigits = String(lid).replace(/\D/g, '');
        remoteJid = `${lidDigits}@lid`;
      } else if (contact.whatsapp) {
        const digits = contact.whatsapp.replace(/\D/g, '');
        remoteJid = `${digits}@s.whatsapp.net`;
      } else {
        return;
      }

      // Busca mensagens recentes do contato que possuem externalId
      const msgs = await this.msgRepo.find({
        where: { tenantId, conversationId, authorType: 'contact' },
        order: { createdAt: 'DESC' },
        take: 30,
      });
      const ids = msgs.map((m) => m.externalId).filter(Boolean) as string[];
      if (!ids.length) return;

      await this.markReadFn(tenantId, remoteJid, ids);
    } catch (e: any) {
      // Não bloqueia — read receipt é best-effort
      console.warn('[ConversationsService] markConversationRead falhou:', e?.message);
    }
  }

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly msgRepo: Repository<ConversationMessage>,
    private readonly dataSource: DataSource,
    private readonly ticketsService: TicketsService,
    private readonly customersService: CustomersService,
    private readonly realtimeEmitter: RealtimeEmitterService,
  ) {
    if (!fs.existsSync(this.mediaRoot)) {
      fs.mkdirSync(this.mediaRoot, { recursive: true });
    }
  }

  private async ensureConversationMessageMediaSchema(): Promise<void> {
    await this.dataSource.query(`
      ALTER TABLE conversation_messages
        ADD COLUMN IF NOT EXISTS media_kind varchar(16),
        ADD COLUMN IF NOT EXISTS media_storage_key text,
        ADD COLUMN IF NOT EXISTS media_mime varchar(128),
        ADD COLUMN IF NOT EXISTS external_id text,
        ADD COLUMN IF NOT EXISTS whatsapp_status text
    `);
  }

  private async ensureConversationMessageMediaSchemaReady(): Promise<void> {
    if (this.conversationMessageMediaSchemaReady) return;
    if (!this.conversationMessageMediaSchemaPromise) {
      this.conversationMessageMediaSchemaPromise = (async () => {
        const requiredColumns = [
          'media_kind',
          'media_storage_key',
          'media_mime',
          'external_id',
          'whatsapp_status',
        ];
        const rows = await this.dataSource.query(
          `SELECT column_name
             FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'conversation_messages'
              AND column_name = ANY($1::text[])`,
          [requiredColumns],
        );
        const existing = new Set((rows ?? []).map((row: { column_name?: string }) => row.column_name));
        const hasAllColumns = requiredColumns.every((columnName) => existing.has(columnName));
        if (!hasAllColumns) {
          await this.ensureConversationMessageMediaSchema();
        }
        this.conversationMessageMediaSchemaReady = true;
      })().finally(() => {
        this.conversationMessageMediaSchemaPromise = null;
      });
    }
    await this.conversationMessageMediaSchemaPromise;
  }

  /** Stream de ficheiro de mensagem (imagem/áudio) — valida tenant e metadados. */
  async getMessageMediaStream(
    tenantId: string,
    messageId: string,
    opts?: { portalContactId?: string },
  ): Promise<{ stream: fs.ReadStream; mime: string }> {
    await this.ensureConversationMessageMediaSchemaReady();
    const msg = await this.msgRepo.findOne({ where: { id: messageId, tenantId } });
    if (!msg?.mediaStorageKey || !msg.mediaMime) {
      throw new NotFoundException('Mídia não encontrada');
    }
    if (opts?.portalContactId) {
      const conv = await this.convRepo.findOne({ where: { id: msg.conversationId, tenantId } });
      if (!conv || conv.contactId !== opts.portalContactId) {
        throw new NotFoundException('Mídia não encontrada');
      }
    }
    const filePath = path.join(this.mediaRoot, msg.mediaStorageKey);
    await fs.promises.access(filePath).catch(() => {
      throw new NotFoundException('Ficheiro ausente');
    });
    return { stream: fs.createReadStream(filePath), mime: msg.mediaMime };
  }

  /**
   * Builds or creates a conversation for a contact without creating tickets automatically.
   */
  async getOrCreateForContact(
    tenantId: string,
    clientId: string | null,
    contactId: string,
    channel: ConversationChannel,
    opts?: { chatAlert?: boolean; firstMessage?: string; contactName?: string; department?: string; autoCreateTicket?: boolean },
  ): Promise<{ conversation: Conversation; ticket: any; ticketCreated: boolean }> {
    const active = await this.convRepo.findOne({
      where: {
        tenantId,
        clientId: clientId ?? IsNull(),
        contactId,
        channel,
        status: ConversationStatus.ACTIVE,
      },
    });
    this.logConversationResolution({
      scope: 'conversation-resolution',
      tenantId,
      contactId,
      clientId,
      channel,
      existingConversationId: active?.id ?? null,
      action: active ? 'reuse' : 'create',
      stage: 'lookup-getOrCreateForContact',
    });
    if (active?.ticketId) {
      const ticket = await this.ticketsService.findOne(tenantId, active.ticketId);
      this.logConversationResolution({
        scope: 'conversation-resolution',
        tenantId,
        contactId,
        clientId,
        channel,
        existingConversationId: active.id,
        action: 'reuse',
        stage: 'return-active-ticket-getOrCreateForContact',
      });
      return { conversation: active, ticket, ticketCreated: false };
    }
    if (active && !active.ticketId) {
      if (opts?.autoCreateTicket && active.initiatedBy !== ConversationInitiatedBy.AGENT) {
        const ticket = await this.createTicketForConversation(
          tenantId,
          active,
          opts?.firstMessage,
          opts?.contactName,
          undefined,
          undefined,
          undefined,
          opts?.firstMessage,
          undefined,
          opts?.department,
        );
        active.ticketId = ticket.id;
        await this.convRepo.save(active);
        this.logConversationResolution({
          scope: 'conversation-resolution',
          tenantId,
          contactId,
          clientId,
          channel,
          existingConversationId: active.id,
          action: 'reuse',
          stage: 'return-active-auto-ticket-getOrCreateForContact',
        });
        return { conversation: active, ticket, ticketCreated: true };
      }
      this.logConversationResolution({
        scope: 'conversation-resolution',
        tenantId,
        contactId,
        clientId,
        channel,
        existingConversationId: active.id,
        action: 'reuse',
        stage: 'return-active-no-ticket-getOrCreateForContact',
      });
      return { conversation: active, ticket: null, ticketCreated: false };
    }
    const result = await this.startConversation(tenantId, clientId, contactId, channel, opts as any);
    if (opts?.autoCreateTicket) {
      const ticket = await this.createTicketForConversation(
        tenantId,
        result.conversation,
        opts?.firstMessage,
        opts?.contactName,
        undefined,
        undefined,
        undefined,
        opts?.firstMessage,
        undefined,
        opts?.department,
      );
      result.conversation.ticketId = ticket.id;
      await this.convRepo.save(result.conversation);
      this.logConversationResolution({
        scope: 'conversation-resolution',
        tenantId,
        contactId,
        clientId,
        channel,
        existingConversationId: null,
        action: 'create',
        stage: 'return-created-auto-ticket-getOrCreateForContact',
      });
      return { conversation: result.conversation, ticket, ticketCreated: true };
    }
    this.logConversationResolution({
      scope: 'conversation-resolution',
      tenantId,
      contactId,
      clientId,
      channel,
      existingConversationId: null,
      action: 'create',
      stage: 'return-created-no-ticket-getOrCreateForContact',
    });
    return { ...result, ticketCreated: false };
  }

  /**
   * Portal: Iniciar atendimento. Cria apenas a conversa.
   */
  async startPortalConversation(
    tenantId: string,
    dto: {
      clientId: string;
      name: string;
      email: string;
      phone?: string;
      contactId?: string;
      chatAlert?: boolean;
      subject?: string;
      description?: string;
      departmentId?: string;
    },
  ) {
    let contactId = dto.contactId;
    let contactName = dto.name;

    if (!contactId) {
      const contact = await this.customersService.findOrCreateContactForChat(tenantId, dto.clientId, {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
      });
      const c = Array.isArray(contact) ? contact[0] : contact;
      if (!c) throw new BadRequestException('Não foi possível criar o contato');
      contactId = c.id;
      contactName = c.name;
    } else {
      const c = await this.customersService.findContactById(tenantId, contactId);
      if (!c) throw new BadRequestException('Contato não encontrado');
      // contactId vem do JWT autenticado — usa o clientId do contato se disponível
      // (resolve conflito quando portal seleciona empresa diferente da vinculada ao contato)
      contactName = c.name;
      if ((c as any).clientId && !(dto as any).overrideClientId) {
        dto.clientId = String((c as any).clientId);
      }
    }

    const result = await this.startConversation(tenantId, dto.clientId, contactId, ConversationChannel.PORTAL, {
      chatAlert: dto.chatAlert,
      contactName,
      subject: dto.subject,
      description: dto.description,
      departmentId: dto.departmentId,
    });

    const estimatedResponse = result.ticket ? this.calcEstimatedResponse(result.ticket?.slaResponseAt) : null;

    return {
      conversation: result.conversation,
      ticket: result.ticket,
      ticketNumber: result.ticket?.ticketNumber ?? null,
      estimatedResponse,
    };
  }

  private calcEstimatedResponse(slaResponseAt?: Date | null): string {
    if (!slaResponseAt) return '4h';
    const diffMs = new Date(slaResponseAt).getTime() - Date.now();
    const minutes = Math.max(1, Math.round(diffMs / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }

  /**
   * Inbound: inicia apenas a conversa.
   */
  async startConversation(
    tenantId: string,
    clientId: string | null,
    contactId: string,
    channel: ConversationChannel,
    opts?: {
      chatAlert?: boolean;
      contactName?: string;
      firstMessage?: string;
      subject?: string;
      description?: string;
      departmentId?: string;
      department?: string;
    },
  ): Promise<{ conversation: Conversation; ticket: any | null }> {
    const conv = this.convRepo.create({
      tenantId,
      clientId,
      contactId,
      channel,
      status: ConversationStatus.ACTIVE,
      chatAlert: opts?.chatAlert ?? false,
      initiatedBy: ConversationInitiatedBy.CONTACT,
    });
    const savedConv = await this.convRepo.save(conv);
    return { conversation: savedConv, ticket: null };
  }

  private async resetChatbotSessionForWhatsappContact(tenantId: string, contact: any): Promise<void> {
    if (!this.chatbotService) return;
    const identifiers = Array.from(new Set([
      contact?.whatsapp ? String(contact.whatsapp) : null,
      (contact as any)?.metadata?.whatsappLid ? String((contact as any).metadata.whatsappLid) : null,
    ].filter(Boolean) as string[]));

    for (const identifier of identifiers) {
      await this.chatbotService.resetSession(tenantId, identifier, 'whatsapp').catch(() => {});
    }
  }

  /**
   * Outbound: agente inicia conversa. Cria Conversation SEM ticket.
   * Só permite envio após criar ou vincular ticket.
   */
  async startAgentConversation(
    tenantId: string,
    clientId: string | null,
    contactId: string,
    channel: ConversationChannel,
  ): Promise<Conversation> {
    const contact = await this.customersService.findContactById(tenantId, contactId);
    if (!contact) throw new BadRequestException('Contato não encontrado');
    // Permite contatos vinculados ao cliente informado OU contatos sem cliente (serão vinculados depois)
    if (clientId) {
      const canAccessClient = await this.customersService.canContactAccessClient(tenantId, contact.id, clientId);
      if (!canAccessClient && contact.clientId && String(contact.clientId) !== String(clientId)) {
        throw new BadRequestException('Contato pertence a outro cliente');
      }
    }
    if (channel === ConversationChannel.WHATSAPP && !contact.whatsapp) {
      throw new BadRequestException('Contato não possui WhatsApp cadastrado');
    }
    // Usa o clientId do contato se já vinculado; caso contrário usa o informado
    let resolvedClientId = clientId ?? null;
    if (!resolvedClientId) {
      const supportIdentifier =
        channel === ConversationChannel.WHATSAPP
          ? ((contact as any)?.metadata?.whatsappLid || contact.whatsapp || null)
          : null;
      const resolution = supportIdentifier
        ? await this.customersService.resolveClientForSupportIdentifier(tenantId, supportIdentifier)
        : await this.customersService.resolveClientForSupportContact(tenantId, contact.id);
      if (resolution.mode === 'single') {
        resolvedClientId = resolution.clientId;
      } else if (resolution.mode === 'multiple') {
        throw new BadRequestException('Contato vinculado a mais de uma empresa. Selecione a empresa antes de iniciar o atendimento.');
      }
    }
    const existing = await this.convRepo.findOne({
      where: { tenantId, clientId: resolvedClientId, contactId, channel, status: ConversationStatus.ACTIVE },
    });
    this.logConversationResolution({
      scope: 'conversation-resolution',
      tenantId,
      contactId,
      clientId: resolvedClientId,
      channel,
      existingConversationId: existing?.id ?? null,
      action: existing ? 'reuse' : 'create',
      stage: 'lookup-startAgentConversation',
    });
    if (channel === ConversationChannel.WHATSAPP) {
      await this.resetChatbotSessionForWhatsappContact(tenantId, contact);
    }
    if (existing) {
      this.logConversationResolution({
        scope: 'conversation-resolution',
        tenantId,
        contactId,
        clientId: resolvedClientId,
        channel,
        existingConversationId: existing.id,
        action: 'reuse',
        stage: 'return-existing-startAgentConversation',
      });
      return existing;
    }
    const conv = this.convRepo.create({
      tenantId,
      clientId: resolvedClientId,
      contactId,
      channel,
      status: ConversationStatus.ACTIVE,
      initiatedBy: ConversationInitiatedBy.AGENT,
    });
    const savedConversation = await this.convRepo.save(conv);
    this.logConversationResolution({
      scope: 'conversation-resolution',
      tenantId,
      contactId,
      clientId: resolvedClientId,
      channel,
      existingConversationId: null,
      action: 'create',
      stage: 'return-created-startAgentConversation',
    });
    return savedConversation;
  }

  /**
   * Cria ticket e vincula à conversa (agente clica "Criar Ticket").
   * Permite para conversas iniciadas pelo agente (outbound) ou pelo contato (portal sem ticket).
   */
  async createTicketForConversationById(
    tenantId: string,
    conversationId: string,
    authorId: string,
    authorName: string,
    opts?: { subject?: string },
  ): Promise<{ conversation: Conversation; ticket: any }> {
    const conv = await this.findOne(tenantId, conversationId);
    if (conv.ticketId) throw new BadRequestException('Conversa já possui ticket vinculado');
    const contact = await this.customersService.findContactById(tenantId, conv.contactId);
    const contactName = contact?.name || 'Cliente';
    const subject = opts?.subject || `Atendimento ${conv.channel === ConversationChannel.WHATSAPP ? 'WhatsApp' : 'Chat'} - ${contactName}`;
    const ticket = await this.createTicketForConversation(tenantId, conv, undefined, contactName, subject, authorId, authorName);
    conv.ticketId = ticket.id;
    await this.convRepo.save(conv);
    return { conversation: conv, ticket };
  }

  /**
   * Vincula ticket existente à conversa (agente clica "Vincular").
   */
  async linkTicket(tenantId: string, conversationId: string, ticketId: string): Promise<Conversation> {
    const conv = await this.findOne(tenantId, conversationId);
    if (conv.ticketId) throw new BadRequestException('Conversa já possui ticket vinculado');
    const ticket = await this.ticketsService.findOne(tenantId, ticketId);
    if (ticket.clientId !== conv.clientId) throw new BadRequestException('Ticket deve ser do mesmo cliente que a conversa');
    await this.ticketsService.linkToConversation(tenantId, ticketId, conversationId);
    conv.ticketId = ticketId;
    await this.convRepo.save(conv);
    return conv;
  }

  async updateTags(tenantId: string, conversationId: string, tags: string[]): Promise<Conversation> {
    const conv = await this.findOne(tenantId, conversationId);
    conv.tags = Array.from(new Set((tags || []).map((tag) => String(tag).trim()).filter(Boolean)));
    return this.convRepo.save(conv);
  }

  private async createTicketForConversation(
    tenantId: string,
    conv: Conversation,
    firstMessage?: string,
    contactName?: string,
    subjectOverride?: string,
    authorId?: string,
    authorName?: string,
    descriptionOverride?: string,
    departmentId?: string,
    department?: string,
  ): Promise<any> {
    const subject = subjectOverride ?? (firstMessage
      ? (firstMessage.slice(0, 80) || 'Chat iniciado')
      : `Chat - ${contactName || 'Cliente'}`);
    const description = descriptionOverride || firstMessage || 'Conversa iniciada via chat.';
    const origin = conv.channel === ConversationChannel.WHATSAPP ? TicketOrigin.WHATSAPP : TicketOrigin.PORTAL;
    const userId = authorId || conv.contactId;
    const userName = authorName || contactName || 'Cliente';

    const ticket = await this.ticketsService.create(
      tenantId,
      userId,
      userName,
      {
        clientId: conv.clientId,
        contactId: conv.contactId,
        origin,
        subject,
        description,
        conversationId: conv.id,
        departmentId: departmentId || undefined,
        department: department || undefined,
      } as any,
      'contact',
    );
    return ticket;
  }

  async findByClient(tenantId: string, clientId: string, channel?: ConversationChannel) {
    const qb = this.convRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.client_id = :clientId', { clientId })
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC');
    if (channel) qb.andWhere('c.channel = :channel', { channel });
    return qb.getMany();
  }

  async findActiveHumanWhatsappConversation(
    tenantId: string,
    contactId: string,
  ): Promise<Conversation | null> {
    return this.convRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.contact_id = :contactId', { contactId })
      .andWhere('c.channel = :channel', { channel: ConversationChannel.WHATSAPP })
      .andWhere('c.status = :status', { status: ConversationStatus.ACTIVE })
      .andWhere('(c.initiated_by = :agent OR c.ticket_id IS NOT NULL)', {
        agent: ConversationInitiatedBy.AGENT,
      })
      .orderBy('CASE WHEN c.client_id IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('CASE WHEN c.ticket_id IS NULL THEN 1 ELSE 0 END', 'ASC')
      .addOrderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .getOne();
  }

  async findOne(tenantId: string, id: string): Promise<Conversation> {
    const conv = await this.convRepo.findOne({ where: { id, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    return conv;
  }

  async getActiveCount(tenantId: string): Promise<{ conversations: number; tickets: number; total: number }> {
    const [conversations, tickets] = await Promise.all([
      this.convRepo.count({ where: { tenantId, status: ConversationStatus.ACTIVE } }),
      this.ticketsService.getActiveInboxTicketCount(tenantId),
    ]);
    return { conversations, tickets, total: conversations + tickets };
  }

  async findActive(
    tenantId: string,
    opts?: {
      channel?: ConversationChannel;
      hasTicket?: 'yes' | 'no' | 'all';
      status?: 'active' | 'closed' | 'all';
      agentId?: string;
    },
  ) {
    const { channel, hasTicket = 'all', status = 'active', agentId } = opts || {};
    const qb = this.convRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC');

    if (status === 'active') qb.andWhere('c.status = :status', { status: ConversationStatus.ACTIVE });
    else if (status === 'closed') qb.andWhere('c.status = :status', { status: ConversationStatus.CLOSED });
    if (channel) qb.andWhere('c.channel = :channel', { channel });
    if (hasTicket === 'yes') qb.andWhere('c.ticket_id IS NOT NULL');
    if (hasTicket === 'no') qb.andWhere('c.ticket_id IS NULL');

    // Filtro por agente: sem ticket (fila livre) OU ticket sem responsável (qualquer agente pode pegar)
    // OU ticket já atribuído a este agente.
    // Tickets com conversation_id têm origin whatsapp/portal — devem ser visíveis na fila aberta
    // enquanto não tiverem um agente designado, independentemente de quem está a ver o inbox.
    if (agentId) {
      qb.andWhere(
        `(c.ticket_id IS NULL OR EXISTS (
          SELECT 1 FROM tickets t_ag
          WHERE t_ag.id::text = c.ticket_id::text
            AND (t_ag.assigned_to IS NULL OR t_ag.assigned_to = :agentId)
        ))`,
        { agentId },
      );
    }

    // Include contact name, ticket number, assigned agent and client company name
    qb.leftJoin('contacts', 'ct', 'ct.id::text = c.contact_id::text')
      .addSelect('ct.name', 'contactName')
      .leftJoin('tickets', 'tk', 'tk.id::text = c.ticket_id::text')
      .addSelect('tk.ticket_number', 'ticketNumber')
      .addSelect('tk.assigned_to', 'assignedTo')
      .leftJoin('clients', 'cu', 'cu.id::text = c.client_id::text')
      .addSelect('COALESCE(cu.trade_name, cu.company_name)', 'clientName')
      .leftJoin('users', 'ag', 'ag.id::text = tk.assigned_to::text')
      .addSelect('ag.name', 'assignedToName');

    const raws = await qb.getRawAndEntities();
    return raws.entities.map((entity, i) => ({
      ...entity,
      contactName:    raws.raw[i]?.contactName    ?? null,
      ticketNumber:   raws.raw[i]?.ticketNumber   ?? null,
      clientName:     raws.raw[i]?.clientName     ?? null,
      assignedTo:     raws.raw[i]?.assignedTo     ?? null,
      assignedToName: raws.raw[i]?.assignedToName ?? null,
    }));
  }

  /**
   * Retorna mensagens da conversa (chat em tempo real do portal).
   */
  async getMessages(tenantId: string, conversationId: string): Promise<ConversationMessage[]> {
    await this.ensureConversationMessageMediaSchemaReady();
    const conv = await this.findOne(tenantId, conversationId);
    return this.msgRepo.find({
      where: { conversationId: conv.id, tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Retorna mensagens paginadas (cursor-based). Usado pelo dashboard para carga incremental.
   * @param opts.limit  quantas mensagens retornar (padrão 50)
   * @param opts.before ID de mensagem — retorna apenas mensagens mais antigas que esta
   */
  async getMessagesPage(
    tenantId: string,
    conversationId: string,
    opts: { limit: number; before?: string },
  ): Promise<{ messages: ConversationMessage[]; hasMore: boolean }> {
    await this.ensureConversationMessageMediaSchemaReady();
    const conv = await this.findOne(tenantId, conversationId);
    const limit = Math.min(opts.limit, 200);

    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :convId', { convId: conv.id })
      .andWhere('m.tenant_id = :tenantId', { tenantId })
      .orderBy('m.created_at', 'DESC')
      .take(limit + 1); // busca um a mais para saber se há próxima página

    if (opts.before) {
      const ref = await this.msgRepo.findOne({ where: { id: opts.before, tenantId } });
      if (ref) {
        qb.andWhere('m.created_at < :refDate', { refDate: ref.createdAt });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse(); // ordena ASC para exibição
    return { messages, hasMore };
  }

  /**
   * Adiciona mensagem à conversa (cliente ou agente). Usado no chat do portal.
   */
  async addMessage(
    tenantId: string,
    conversationId: string,
    authorId: string,
    authorName: string,
    authorType: 'contact' | 'user',
    content: string,
    opts?: {
      skipOutbound?: boolean;
      initialWhatsappStatus?: string;
      initialExternalId?: string | null;
      mediaKind?: 'image' | 'audio' | 'video' | null;
      mediaStorageKey?: string | null;
      mediaMime?: string | null;
      /** Texto real do usuário para usar como caption no WhatsApp (sem emoji de placeholder). */
      mediaCaption?: string | null;
    },
  ): Promise<ConversationMessage> {
    await this.ensureConversationMessageMediaSchemaReady();
    const conv = await this.findOne(tenantId, conversationId);
    if (conv.status === ConversationStatus.CLOSED) {
      throw new BadRequestException('Conversa já encerrada.');
    }

    const extId = opts?.initialExternalId?.trim();
    if (extId) {
      const existing = await this.msgRepo.findOne({
        where: { tenantId, externalId: extId },
      });
      if (existing) {
        if (existing.conversationId !== conversationId) {
          this.logger.warn(
            `Idempotência WA: external_id=${extId} já existe (conv=${existing.conversationId}, reenvio apontou ${conversationId}).`,
          );
        }
        return existing;
      }
    }

    const msg = this.msgRepo.create({
      tenantId,
      conversationId: conv.id,
      authorId,
      authorName,
      authorType,
      content,
      mediaKind: opts?.mediaKind ?? null,
      mediaStorageKey: opts?.mediaStorageKey ?? null,
      mediaMime: opts?.mediaMime ?? null,
      whatsappStatus: opts?.initialWhatsappStatus ?? null,
      externalId: extId ?? null,
    });
    let saved: ConversationMessage;
    try {
      saved = await this.msgRepo.save(msg);
    } catch (err: unknown) {
      const p = err as { code?: string; driverError?: { code?: string } };
      const code = p.code ?? p.driverError?.code;
      if (code === '23505' && extId) {
        const race = await this.msgRepo.findOne({ where: { tenantId, externalId: extId } });
        if (race) return race;
      }
      throw err;
    }
    await this.updateLastMessageAt(tenantId, conversationId);

    // Quando a conversa já está vinculada a ticket, o atendimento pode estar ouvindo
    // a sala ticket:<id> em vez da sala conversation:<id>. Emitimos nos dois canais.
    const emitMsg = (statusOverride?: string) => {
      const payload = {
        id: saved.id,
        conversationId: saved.conversationId,
        ticketId: conv.ticketId ?? null,
        channel: conv.channel,
        authorId: saved.authorId,
        authorType: saved.authorType,
        authorName: saved.authorName,
        content: saved.content,
        createdAt: saved.createdAt,
        whatsappStatus: statusOverride ?? saved.whatsappStatus,
        externalId: saved.externalId ?? null,
        mediaKind: saved.mediaKind ?? null,
        mediaMime: saved.mediaMime ?? null,
        hasMedia: !!(saved.mediaKind && saved.mediaStorageKey),
      };
      this.realtimeEmitter.emitNewConversationMessage(conversationId, payload);
      if (conv.ticketId) {
        this.realtimeEmitter.emitNewMessage(conv.ticketId, payload);
      }
    };

    emitMsg(); // emit inicial com o status que foi salvo

    if (conv.ticketId) {
      void this.ticketsService.findOne(tenantId, conv.ticketId).then((tk) => {
        if (!tk?.ticketNumber) return;
        const preview =
          saved.mediaKind === 'image'
            ? '[Imagem]' + (content ? `: ${content.slice(0, 40)}` : '')
            : saved.mediaKind === 'audio'
              ? '[Áudio]'
              : saved.mediaKind === 'video'
                ? '[Vídeo]' + (content ? `: ${content.slice(0, 40)}` : '')
                : content.length > 80
                ? `${content.slice(0, 77)}…`
                : content || '(mensagem)';
        this.realtimeEmitter.emitTenantTicketMessageNotify(tenantId, {
          ticketId: conv.ticketId!,
          ticketNumber: tk.ticketNumber,
          content: preview,
        });
      });
    }

    // Notifica todos os agentes do tenant sobre nova mensagem do contato (badges em tempo real)
    if (authorType === 'contact') {
      this.realtimeEmitter.emitToTenant(tenantId, 'new-message', {
        conversationId: conv.id,
        channel: conv.channel,
        contactName: authorName,
        preview:
          saved.mediaKind === 'image'
            ? '[Imagem]' + (content ? `: ${content.slice(0, 40)}` : '')
            : saved.mediaKind === 'audio'
              ? '[Áudio]'
              : saved.mediaKind === 'video'
                ? '[Vídeo]' + (content ? `: ${content.slice(0, 40)}` : '')
                : content.length > 80
                ? content.slice(0, 77) + '…'
                : content,
      });
    }

    // Envia via WhatsApp quando é mensagem do agente em conversa WhatsApp
    // skipOutbound=true quando o envio já foi feito pelo chamador (ex.: sendReplyFromTicket)
    // Fire-and-forget: retornamos `saved` imediatamente para o HTTP não segurar a resposta
    // enquanto o Baileys faz o upload — isso evitava que múltiplos setMessages no frontend
    // cancelassem o useEffect responsável por buscar o blob da mídia.
    if (!opts?.skipOutbound && authorType === 'user' && conv.channel === ConversationChannel.WHATSAPP && this.outboundSender) {
      const savedId = saved.id;
      void (async () => {
        try {
          const contact = await this.customersService.findContactById(tenantId, conv.contactId);
          if (contact?.whatsapp) {
            const absMedia =
              opts?.mediaKind && opts?.mediaStorageKey
                ? path.join(this.mediaRoot, opts.mediaStorageKey)
                : null;
            const outboundPayload =
              opts?.mediaKind && absMedia && await fs.promises.access(absMedia).then(() => true).catch(() => false)
                ? {
                    kind: opts.mediaKind,
                    filePath: absMedia,
                    caption: (opts && 'mediaCaption' in opts) ? (opts.mediaCaption || undefined) : (content || undefined),
                    mime: opts.mediaMime || undefined,
                  }
                : content;
            const raw = await this.outboundSender(tenantId, contact.whatsapp, outboundPayload as any);
            const sendResult = typeof raw === 'boolean' ? { success: raw } : raw;
            if (sendResult.success) {
              const externalId = sendResult.messageId ?? null;
              await this.msgRepo.update(savedId, { externalId, whatsappStatus: 'sent' });
              emitMsg('sent');
            } else {
              await this.msgRepo.update(savedId, { whatsappStatus: 'failed' });
              emitMsg('failed');
              console.warn(`[ConversationsService] Mensagem salva mas envio WhatsApp falhou (conv=${conversationId}): ${sendResult.error ?? 'sem detalhes'}`);
            }
          }
        } catch (e) {
          // Falha no envio WhatsApp não deve impedir o salvamento da mensagem
          await this.msgRepo.update(savedId, { whatsappStatus: 'failed' }).catch(() => {});
          emitMsg('failed');
          console.error('[ConversationsService] Falha ao enviar mensagem outbound WhatsApp:', e);
        }
      })();
    }

    return saved;
  }

  /**
   * Encerra a conversa.
   * - Se não tiver ticket: cria ticket e migra mensagens do conversation_messages.
   * - Se tiver ticket: migra mensagens do conversation_messages para o ticket existente.
   * - closureData: quando fornecido e keepTicketOpen=false, adiciona encerramento formal como interação separada.
   * Transcrição + atualização do ticket + conversa CLOSED: uma única transação (queryRunner); realtime e efeitos externos após commit.
   */
  async close(
    tenantId: string,
    id: string,
    userId?: string,
    userName?: string,
    keepTicketOpen?: boolean,
    closureData?: { solution?: string; rootCause?: string; timeSpentMin?: number; internalNote?: string; complexity?: number },
  ): Promise<Conversation> {
    const conv = await this.findOne(tenantId, id);

    if (conv.status === ConversationStatus.CLOSED) {
      return conv;
    }

    const ticketId = conv.ticketId;

    if (!ticketId) throw new BadRequestException('Conversa sem ticket vinculado nao pode ser encerrada.');

    const willResolveFormally = !keepTicketOpen && !!closureData?.solution?.trim();
    if (willResolveFormally) {
      await this.ticketsService.assertTicketReadyForFormalResolutionFromConversation(tenantId, ticketId);
    }

    const messagesToEmitRealtime: TicketMessage[] = [];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const em = queryRunner.manager;

      const convLocked = await em.findOne(Conversation, { where: { tenantId, id } });
      if (!convLocked) {
        throw new NotFoundException('Conversa não encontrada');
      }
      if (convLocked.status === ConversationStatus.CLOSED) {
        await queryRunner.rollbackTransaction();
        return convLocked;
      }

      const msgsTx = await em.find(ConversationMessage, {
        where: { tenantId, conversationId: id },
        order: { createdAt: 'ASC' },
      });

      for (const m of msgsTx) {
        const transcriptAtt = m.mediaStorageKey
          ? [{ mediaKind: m.mediaKind, mediaStorageKey: m.mediaStorageKey, mediaMime: m.mediaMime }]
          : null;
        const savedMsg = await this.ticketsService.addMessageTransactional(
          em,
          tenantId,
          ticketId,
          m.authorId ?? convLocked.contactId,
          m.authorName,
          m.authorType,
          {
            content: m.content,
            messageType: 'comment' as any,
            channel: convLocked.channel,
            skipInAppBell: true,
            attachments: transcriptAtt,
          },
        );
        messagesToEmitRealtime.push(savedMsg);
      }

      if (!keepTicketOpen) {
        const uid = userId ?? 'system';
        const uname = userName ?? 'Sistema';

        if (closureData?.solution?.trim()) {
          const parts: string[] = ['--- ENCERRAMENTO DO ATENDIMENTO ---', `Solução aplicada: ${closureData.solution.trim()}`];
          if (closureData.rootCause?.trim()) parts.push(`Causa raiz: ${closureData.rootCause.trim()}`);
          if (closureData.timeSpentMin != null && closureData.timeSpentMin > 0) parts.push(`Tempo gasto: ${closureData.timeSpentMin} min`);
          if (closureData.complexity != null && closureData.complexity > 0) parts.push(`Complexidade: ${closureData.complexity}/5`);
          const closureMsg = await this.ticketsService.addMessageTransactional(
            em,
            tenantId,
            ticketId,
            uid,
            uname,
            'user',
            {
              content: parts.join('\n'),
              messageType: 'comment' as any,
              skipInAppBell: true,
            },
          );
          messagesToEmitRealtime.push(closureMsg);

          await this.ticketsService.applyResolveTicketInConversationCloseTransaction(
            em,
            tenantId,
            ticketId,
            uid,
            uname,
            {
              resolutionSummary: closureData.solution.trim(),
              timeSpentMin: closureData.timeSpentMin,
            },
          );
        }

        if (closureData?.internalNote?.trim()) {
          const internalMsg = await this.ticketsService.addMessageTransactional(
            em,
            tenantId,
            ticketId,
            uid,
            uname,
            'user',
            {
              content: closureData.internalNote.trim(),
              messageType: 'internal' as any,
              skipInAppBell: true,
            },
          );
          messagesToEmitRealtime.push(internalMsg);
        }
      }

      convLocked.status = ConversationStatus.CLOSED;
      await em.getRepository(Conversation).save(convLocked);

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }

    for (const msg of messagesToEmitRealtime) {
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
    }

    if (willResolveFormally) {
      await this.ticketsService.runPostResolveSideEffectsAfterConversationCloseTransaction(tenantId, ticketId);
    }

    // Notifica todos os agentes do tenant que esta conversa foi encerrada
    // O frontend remove do inbox ativo sem precisar de polling
    this.realtimeEmitter.emitToTenant(tenantId, 'conversation:closed', { conversationId: id });

    // WhatsApp: ao encerrar o atendimento formalmente, dispara avaliação ao cliente.
    // Se o atendimento não foi encerrado (keepTicketOpen), apenas reseta a sessão.
    const convAfter = await this.findOne(tenantId, id);
    if (convAfter.channel === ConversationChannel.WHATSAPP && this.chatbotService) {
      const contact = convAfter.contactId
        ? await this.customersService.findContactById(tenantId, convAfter.contactId).catch(() => null)
        : null;
      const identifier =
        (contact as any)?.metadata?.whatsappLid
        || (contact as any)?.whatsapp
        || null;

      if (identifier) {
        const deveAvaliar = !keepTicketOpen && !!ticketId && !!this.outboundSender;
        console.log(`[ConversationsService.close] conversation=${id} ticket=${ticketId ?? 'none'} identifier=${identifier} keepTicketOpen=${!!keepTicketOpen} shouldRate=${deveAvaliar}`);
        if (deveAvaliar) {
          const sender = this.outboundSender!;
          await this.chatbotService.initiateRating(tenantId, identifier, ticketId!, 'whatsapp', async (text) => {
            await sender(tenantId, identifier, text);
          });
        } else if (!keepTicketOpen) {
          this.chatbotService.resetSession(tenantId, identifier, 'whatsapp').catch(() => {});
        }
      }
    }

    return convAfter;
  }

  async updateLastMessageAt(tenantId: string, conversationId: string) {
    await this.convRepo.update(
      { id: conversationId, tenantId },
      { lastMessageAt: new Date() },
    );
  }

  /**
   * Portal: Retorna ou cria conversa para ticket existente (aberto em andamento).
   * Se a conversa vinculada estiver fechada ou sem conversa, cria nova e vincula ao ticket.
   */
  async resumeOrCreateForTicket(
    tenantId: string,
    ticketId: string,
    contactId: string,
    isPrimary?: boolean,
  ): Promise<{ conversation: Conversation; ticket: any }> {
    const ticket = await this.ticketsService.findOne(tenantId, ticketId);
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    const canAccess = await this.customersService.canContactAccessTicket(
      tenantId, contactId, ticket.clientId, ticket.contactId ?? null, !!isPrimary,
    );
    if (!canAccess) throw new NotFoundException('Ticket não encontrado');
    if (!['open', 'in_progress', 'waiting_client'].includes(ticket.status)) {
      throw new BadRequestException('Ticket deve estar em aberto para continuar a conversa');
    }
    const loggedContact = await this.customersService.findContactById(tenantId, contactId);
    if (!loggedContact) throw new BadRequestException('Contato inválido');
    // Sempre usar o contato que está abrindo o chat (quem chamou), nunca o contato do ticket
    let effectiveContactId: string;
    if (loggedContact.clientId === ticket.clientId) {
      effectiveContactId = contactId;
    } else {
      const contactForClient = await this.customersService.findOrCreateContactForChat(tenantId, ticket.clientId, {
        name: loggedContact.name,
        email: loggedContact.email,
        phone: loggedContact.phone ?? undefined,
      });
      const c = Array.isArray(contactForClient) ? contactForClient[0] : contactForClient;
      effectiveContactId = c?.id;
      if (!effectiveContactId) throw new BadRequestException('Contato inválido');
    }

    if (ticket.conversationId) {
      const existing = await this.convRepo.findOne({
        where: { id: ticket.conversationId, tenantId },
      });
      if (existing?.status === ConversationStatus.ACTIVE) {
        return { conversation: existing, ticket };
      }
    }

    const conv = this.convRepo.create({
      tenantId,
      clientId: ticket.clientId,
      contactId: effectiveContactId,
      channel: ConversationChannel.PORTAL,
      status: ConversationStatus.ACTIVE,
      ticketId: ticket.id,
      initiatedBy: ConversationInitiatedBy.CONTACT,
    });
    const saved = await this.convRepo.save(conv);
    await this.ticketsService.linkToConversation(tenantId, ticketId, saved.id);
    return { conversation: saved, ticket };
  }

  /**
   * Atualiza o whatsappStatus de uma mensagem a partir do externalId (WhatsApp message key).
   * Chamado pelo BaileysService via callback ACK (messages.update).
   * Só promove o status (sent → delivered → read), nunca rebaixa.
   */
  async updateMessageStatusByExternalId(tenantId: string, externalId: string, newStatus: string): Promise<void> {
    await this.ensureConversationMessageMediaSchemaReady();
    const STATUS_RANK: Record<string, number> = { pending: 0, queued: 0, sent: 1, delivered: 2, read: 3 };
    const msg = await this.msgRepo.findOne({ where: { tenantId, externalId } });
    if (!msg) return; // mensagem ainda não persistida ou de outro tenant

    const currentRank = STATUS_RANK[msg.whatsappStatus ?? ''] ?? -1;
    const newRank = STATUS_RANK[newStatus] ?? -1;
    if (newRank <= currentRank) return; // não rebaixa

    await this.msgRepo.update(msg.id, { whatsappStatus: newStatus });

    // Emite socket para o frontend atualizar o ícone em tempo real
    const conv = await this.convRepo.findOne({ where: { tenantId, id: msg.conversationId } });
    const payload = {
      id: msg.id,
      conversationId: msg.conversationId,
      ticketId: conv?.ticketId ?? null,
      channel: conv?.channel ?? null,
      authorId: msg.authorId,
      authorType: msg.authorType,
      authorName: msg.authorName,
      content: msg.content,
      createdAt: msg.createdAt,
      whatsappStatus: newStatus,
      externalId: msg.externalId ?? null,
      mediaKind: msg.mediaKind ?? null,
      mediaMime: msg.mediaMime ?? null,
      hasMedia: !!(msg.mediaKind && msg.mediaStorageKey),
    };
    this.realtimeEmitter.emitNewConversationMessage(msg.conversationId, payload);
    if (conv?.ticketId) {
      this.realtimeEmitter.emitNewMessage(conv.ticketId, payload);
    }
  }
}

