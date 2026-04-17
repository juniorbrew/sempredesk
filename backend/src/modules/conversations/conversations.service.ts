import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Conversation, ConversationChannel, ConversationStatus, ConversationInitiatedBy } from './entities/conversation.entity';
import { ConversationMessage, ReplyToSnapshot } from './entities/conversation-message.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CustomersService } from '../customers/customers.service';
import { TicketMessage, TicketOrigin } from '../tickets/entities/ticket.entity';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import {
  fetchWhatsappPrefixAgentEnabled,
  prependWhatsappAgentLine,
} from '../whatsapp/whatsapp-outbound-agent-prefix.util';
import { TicketSettingsService } from '../ticket-settings/ticket-settings.service';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  private readonly mediaRoot =
    process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');

  private logConversationResolution(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  /**
   * Fase 3: departamento (chatbot/menu ou portal) → prioridade padrão do ticket_settings
   * para contexto operacional da conversa, sem aplicar SLA contratual na conversa.
   */
  private async maybeApplyDepartmentPriorityFromOpts(
    tenantId: string,
    conversation: Conversation,
    opts: { department?: string | null; departmentId?: string | null } | undefined,
    manager?: EntityManager,
  ): Promise<void> {
    if (conversation.ticketId) return;
    const hasCtx = !!((opts?.department || '').trim() || (opts?.departmentId || '').trim());
    if (!hasCtx) return;

    const dept = await this.ticketSettingsService.resolveDepartmentSettingForSla(tenantId, {
      department: opts?.department,
      departmentId: opts?.departmentId,
    });
    const priorityId = dept?.defaultPriorityId ?? null;
    conversation.priorityId = priorityId;
    const convRepo = manager?.getRepository(Conversation) ?? this.convRepo;
    await convRepo.save(conversation);
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

  /** Injetado via setter em app.module para evitar dependência circular */
  private attendanceSvc: any = null;
  setAttendanceService(svc: any) { this.attendanceSvc = svc; }

  /** Dispatcher de envio outbound (WhatsApp/Baileys) — registrado pelo WhatsappModule.onModuleInit */
  private outboundSender:
    | ((
        tenantId: string,
        toWhatsapp: string,
        payload:
          | string
          | { kind: 'image' | 'audio' | 'video' | 'file'; filePath: string; caption?: string; mime?: string; fileName?: string },
        quotedMsg?: { externalId: string; content: string; fromMe: boolean } | null,
        /** ID do canal WhatsApp (whatsapp_connections.id) — garante saída pelo número correto */
        whatsappChannelId?: string | null,
      ) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>)
    | null = null;
  setOutboundSender(
    fn: (
      tenantId: string,
      toWhatsapp: string,
      payload: string | { kind: 'image' | 'audio' | 'video' | 'file'; filePath: string; caption?: string; mime?: string; fileName?: string },
      quotedMsg?: { externalId: string; content: string; fromMe: boolean } | null,
      whatsappChannelId?: string | null,
    ) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>,
  ) {
    this.outboundSender = fn;
  }

  /** Envia mensagem de boas-vindas pós-ticket (registrado pelo WhatsappModule.onModuleInit) */
  private postTicketMessageSender:
    | ((
        tenantId: string,
        wa: string,
        contact: { name?: string | null; email?: string | null },
        ticket: { ticketNumber: string; assignedTo?: string | null },
      ) => Promise<void>)
    | null = null;
  setPostTicketMessageSender(
    fn: (
      tenantId: string,
      wa: string,
      contact: { name?: string | null; email?: string | null },
      ticket: { ticketNumber: string; assignedTo?: string | null },
    ) => Promise<void>,
  ) {
    this.postTicketMessageSender = fn;
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
    private readonly ticketSettingsService: TicketSettingsService,
  ) {
    if (!fs.existsSync(this.mediaRoot)) {
      fs.mkdirSync(this.mediaRoot, { recursive: true });
    }
  }

  private isActiveConversationUniqueViolation(error: any): boolean {
    if (error?.code !== '23505') return false;
    const constraint = String(error?.constraint ?? '');
    const detail = String(error?.detail ?? '');
    return constraint === 'uq_conversations_active_contact_channel'
      || detail.includes('uq_conversations_active_contact_channel');
  }

  private async withConversationScopeLock<T>(
    tenantId: string,
    contactId: string,
    channel: ConversationChannel,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    const lockKey = `${tenantId}:${contactId}`;

    await queryRunner.connect();
    try {
      await queryRunner.query(
        'SELECT pg_advisory_lock(hashtext($1), hashtext($2))',
        [lockKey, channel],
      );
      await queryRunner.startTransaction();
      try {
        const result = await work(queryRunner.manager);
        await queryRunner.commitTransaction();
        return result;
      } catch (error) {
        await queryRunner.rollbackTransaction().catch(() => undefined);
        throw error;
      }
    } finally {
      await queryRunner.query(
        'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
        [lockKey, channel],
      ).catch(() => undefined);
      await queryRunner.release().catch(() => undefined);
    }
  }

  private async findLatestActiveConversationByContact(
    manager: EntityManager,
    tenantId: string,
    contactId: string,
    channel: ConversationChannel,
  ): Promise<Conversation | null> {
    return manager.getRepository(Conversation).findOne({
      where: { tenantId, contactId, channel, status: ConversationStatus.ACTIVE },
      order: { createdAt: 'DESC' },
    });
  }

  /** Stream de ficheiro de mensagem (imagem/áudio) — valida tenant e metadados. */
  async getMessageMediaStream(
    tenantId: string,
    messageId: string,
    opts?: { portalContactId?: string; portalIsPrimary?: boolean },
  ): Promise<{ stream: fs.ReadStream; mime: string }> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId, tenantId } });
    if (!msg?.mediaStorageKey || !msg.mediaMime) {
      throw new NotFoundException('Mídia não encontrada');
    }
    if (opts?.portalContactId) {
      await this.assertPortalConversationAccess(
        tenantId,
        msg.conversationId,
        opts.portalContactId,
        !!opts.portalIsPrimary,
      );
    }
    if (!msg.mediaStorageKey.startsWith(`${tenantId}/`)) {
      throw new NotFoundException('Mídia não encontrada');
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
    opts?: {
      chatAlert?: boolean;
      firstMessage?: string;
      contactName?: string;
      /** Nome do departamento (ex.: menu do chatbot). */
      department?: string;
      /** UUID do ticket_settings departamento (ex.: portal). */
      departmentId?: string;
      autoCreateTicket?: boolean;
      /**
       * ID do canal WhatsApp (whatsapp_connections.id) pelo qual esta conversa chegou.
       * Salvo em Conversation.whatsappChannelId para garantir respostas pelo canal correto.
       */
      whatsappChannelId?: string | null;
    },
  ): Promise<{ conversation: Conversation; ticket: any; ticketCreated: boolean }> {
    return this.withConversationScopeLock(tenantId, contactId, channel, async (manager) => {
    const convRepo = manager.getRepository(Conversation);
    // Busca por contactId+channel+status sem filtrar por clientId.
    // Evita criar conversa paralela quando o vínculo do contato com um cliente muda
    // (ex: contato chega sem clientId, é vinculado a um cliente, próxima mensagem usa clientId real).
    let active = await this.findLatestActiveConversationByContact(manager, tenantId, contactId, channel);

    // Se encontrou conversa com clientId/canal diferente do atual, atualiza antes de continuar.
    if (active) {
      let shouldPersist = false;
      if (clientId && active.clientId !== clientId) {
        active.clientId = clientId;
        shouldPersist = true;
      }
      if (opts?.whatsappChannelId && active.whatsappChannelId !== opts.whatsappChannelId) {
        active.whatsappChannelId = opts.whatsappChannelId;
        shouldPersist = true;
      }
      if (shouldPersist) {
        active = await convRepo.save(active);
      }
    }

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
      // Persiste departamento escolhido no chatbot se a conversa reutilizada ainda não tinha um.
      // Sem isso, startAttendance leria chatbotDepartment=null e criaria o ticket sem departamento.
      if (opts?.department?.trim() && !active.chatbotDepartment) {
        active.chatbotDepartment = opts.department.trim();
        this.logger.log(JSON.stringify({
          scope: 'conversation-department-update',
          conversationId: active.id,
          tenantId,
          chatbotDepartment: active.chatbotDepartment,
          stage: 'reuse-no-ticket-getOrCreateForContact',
        }));
      }
      if (opts?.departmentId?.trim() && !active.chatbotDepartmentId) {
        active.chatbotDepartmentId = opts.departmentId.trim();
      }
      await this.maybeApplyDepartmentPriorityFromOpts(tenantId, active, opts, manager);
      const autoCreated = await this.maybeAutoCreateTicketForConversation(
        tenantId,
        active,
        opts,
        convRepo,
      );
      if (autoCreated) {
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
        return autoCreated;
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
    const result = await this.startConversation(tenantId, clientId, contactId, channel, opts ?? {}, manager);
    const autoCreated = await this.maybeAutoCreateTicketForConversation(
      tenantId,
      result.conversation,
      opts,
      convRepo,
    );
    if (autoCreated) {
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
      return autoCreated;
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
    });
  }

  private async maybeAutoCreateTicketForConversation(
    tenantId: string,
    conv: Conversation,
    opts: {
      autoCreateTicket?: boolean;
      firstMessage?: string;
      contactName?: string;
      departmentId?: string;
      department?: string;
    } | undefined,
    convRepo: Repository<Conversation>,
  ): Promise<{ conversation: Conversation; ticket: any; ticketCreated: boolean } | null> {
    if (!opts?.autoCreateTicket || conv.ticketId || !conv.clientId) {
      return null;
    }

    const contact = await this.customersService.findContactById(tenantId, conv.contactId).catch(() => null);
    const contactName = opts.contactName || contact?.name || contact?.email || 'Cliente';

    try {
      const ticket = await this.createTicketForConversation(
        tenantId,
        conv,
        opts.firstMessage,
        contactName,
        undefined,
        undefined,
        undefined,
        undefined,
        opts.departmentId,
        opts.department,
      );
      conv.ticketId = ticket.id;
      await convRepo.update(
        { id: conv.id, tenantId },
        { ticketId: ticket.id } as Partial<Conversation>,
      );
      return { conversation: conv, ticket, ticketCreated: true };
    } catch (err: any) {
      this.logger.warn(
        `[getOrCreateForContact] Falha ao auto-criar ticket para a conversa ${conv.id}: ${err?.message}`,
      );
      return null;
    }
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

    // Resolve departmentId → nome para persistir como chatbotDepartment na conversa.
    // startConversation grava chatbotDepartment apenas de opts.department (string);
    // sem essa resolução prévia o departamento ficaria null e o ticket nasceria sem department.
    let portalDeptName: string | undefined;
    if (dto.departmentId) {
      const deptSetting = await this.ticketSettingsService.resolveDepartmentSettingForSla(tenantId, {
        departmentId: dto.departmentId,
      });
      portalDeptName = deptSetting?.name ?? undefined;
    }

    const result = await this.withConversationScopeLock(tenantId, contactId, ConversationChannel.PORTAL, async (manager) => {
      const active = await this.findLatestActiveConversationByContact(manager, tenantId, contactId!, ConversationChannel.PORTAL);
      if (active) {
        const ticket = active.ticketId
          ? await this.ticketsService.findOne(tenantId, active.ticketId).catch(() => null)
          : null;
        return { conversation: active, ticket };
      }
      return this.startConversation(tenantId, dto.clientId, contactId!, ConversationChannel.PORTAL, {
        chatAlert: dto.chatAlert,
        contactName,
        subject: dto.subject,
        description: dto.description,
        departmentId: dto.departmentId,
        department: portalDeptName,
      }, manager);
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
      /**
       * ID do canal WhatsApp (whatsapp_connections.id) pelo qual esta conversa chegou.
        * Salvo em Conversation.whatsappChannelId para garantir respostas pelo canal correto.
        */
      whatsappChannelId?: string | null;
    },
    manager?: EntityManager,
  ): Promise<{ conversation: Conversation; ticket: any | null }> {
    const convRepo = manager?.getRepository(Conversation) ?? this.convRepo;
    const conv = convRepo.create({
      tenantId,
      clientId,
      contactId,
      channel,
      status: ConversationStatus.ACTIVE,
      chatAlert: opts?.chatAlert ?? false,
      initiatedBy: ConversationInitiatedBy.CONTACT,
      whatsappChannelId: opts?.whatsappChannelId ?? null,
      queuedAt: new Date(),
      chatbotDepartment: opts?.department?.trim() || null,
      chatbotDepartmentId: opts?.departmentId?.trim() || null,
    });
    try {
      const savedConv = await convRepo.save(conv);
      const hasDeptCtx = !!((opts?.department || '').trim() || (opts?.departmentId || '').trim());
      if (hasDeptCtx) {
        await this.maybeApplyDepartmentPriorityFromOpts(tenantId, savedConv, opts, manager);
      }
      return { conversation: savedConv, ticket: null };
    } catch (error) {
      if (!this.isActiveConversationUniqueViolation(error)) throw error;
      const fallbackManager = manager ?? this.dataSource.manager;
      const existing = await this.findLatestActiveConversationByContact(fallbackManager, tenantId, contactId, channel);
      if (!existing) throw error;
      if (clientId && existing.clientId !== clientId) {
        existing.clientId = clientId;
      }
      if (opts?.whatsappChannelId && existing.whatsappChannelId !== opts.whatsappChannelId) {
        existing.whatsappChannelId = opts.whatsappChannelId;
      }
      if (opts?.department?.trim() && !existing.chatbotDepartment) {
        existing.chatbotDepartment = opts.department.trim();
      }
      if (opts?.departmentId?.trim() && !existing.chatbotDepartmentId) {
        existing.chatbotDepartmentId = opts.departmentId.trim();
      }
      const savedExisting = await convRepo.save(existing);
      const hasDeptCtx = !!((opts?.department || '').trim() || (opts?.departmentId || '').trim());
      if (hasDeptCtx) {
        await this.maybeApplyDepartmentPriorityFromOpts(tenantId, savedExisting, opts, manager);
      }
      return { conversation: savedExisting, ticket: null };
    }
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
    if (channel === ConversationChannel.WHATSAPP) {
      await this.resetChatbotSessionForWhatsappContact(tenantId, contact);
    }
    return this.withConversationScopeLock(tenantId, contactId, channel, async (manager) => {
      const convRepo = manager.getRepository(Conversation);
      let existing = await this.findLatestActiveConversationByContact(manager, tenantId, contactId, channel);
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
      if (existing) {
      // Garante que a conversa reutilizada seja marcada como iniciada pelo agente.
      // Sem isso, respostas do contato em conversas previamente iniciadas pelo contato
      // continuariam caindo no chatbot (initiated_by='contact' não passa pela guarda skipChatbot).
        let shouldPersist = false;
        if (resolvedClientId && existing.clientId !== resolvedClientId) {
          existing.clientId = resolvedClientId;
          shouldPersist = true;
        }
        if (existing.initiatedBy !== ConversationInitiatedBy.AGENT) {
          existing.initiatedBy = ConversationInitiatedBy.AGENT;
          shouldPersist = true;
        }
        if (shouldPersist) {
          existing = await convRepo.save(existing);
        }
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
    const conv = convRepo.create({
      tenantId,
      clientId: resolvedClientId,
      contactId,
      channel,
      status: ConversationStatus.ACTIVE,
      initiatedBy: ConversationInitiatedBy.AGENT,
      queuedAt: new Date(),
    });
      try {
        const savedConversation = await convRepo.save(conv);
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
      } catch (error) {
        if (!this.isActiveConversationUniqueViolation(error)) throw error;
        existing = await this.findLatestActiveConversationByContact(manager, tenantId, contactId, channel);
        if (!existing) throw error;
        if (resolvedClientId && existing.clientId !== resolvedClientId) {
          existing.clientId = resolvedClientId;
          existing = await convRepo.save(existing);
        }
        this.logConversationResolution({
          scope: 'conversation-resolution',
          tenantId,
          contactId,
          clientId: resolvedClientId,
          channel,
          existingConversationId: existing.id,
          action: 'reuse',
          stage: 'return-conflict-reused-startAgentConversation',
        });
        return existing;
      }
    });
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
    const chatbotDept = conv.chatbotDepartment?.trim() || undefined;
    const chatbotDeptId = conv.chatbotDepartmentId ?? undefined;
    const ticket = await this.createTicketForConversation(
      tenantId, conv, undefined, contactName, subject, authorId, authorName,
      undefined,      // descriptionOverride
      chatbotDeptId,  // departmentId — chave estável
      chatbotDept,    // department — nome para fallback/display
    );
    // Usar update() pontual para não sobrescrever campos SLA gravados por syncConversationSlaWithTicket
    await this.convRepo.update({ id: conversationId, tenantId }, { ticketId: ticket.id } as Partial<Conversation>);
    conv.ticketId = ticket.id;
    return { conversation: conv, ticket };
  }

  /**
   * Agente inicia atendimento manualmente: cria ticket vinculado à conversa e
   * registra a primeira resposta SLA (tempo da chegada do chat até agora).
   */
  async startAttendance(
    tenantId: string,
    conversationId: string,
    agentId: string,
    agentName: string,
  ): Promise<{ conversation: Conversation; ticket: any }> {
    // Bloqueia início de atendimento por agente em pausa ativa
    if (this.attendanceSvc) {
      const available = await this.attendanceSvc.isAvailable(tenantId, agentId).catch(() => true);
      if (available === false) {
        throw new BadRequestException('Agente em pausa — não é possível iniciar atendimento');
      }
    }

    const conv = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.ticketId) throw new BadRequestException('Atendimento já iniciado para esta conversa');

    const contact = await this.customersService.findContactById(tenantId, conv.contactId);
    const contactName = contact?.name || 'Cliente';

    // Resolve clientId: prioridade para conv.clientId; fallback para contato direto ou pivot contact_customers
    const originalClientId = conv.clientId;
    if (!conv.clientId && contact?.clientId) {
      conv.clientId = contact.clientId;
    }
    if (!conv.clientId) {
      const pivotRows: Array<{ client_id: string }> = await this.dataSource.query(
        `SELECT client_id FROM contact_customers WHERE tenant_id = $1 AND contact_id = $2 LIMIT 1`,
        [tenantId, conv.contactId],
      ).catch(() => []);
      if (pivotRows[0]?.client_id) conv.clientId = pivotRows[0].client_id;
    }

    // Departamento registrado na conversa pelo chatbot (nome + ID canônico).
    const chatbotDepartment: string | null = conv.chatbotDepartment ?? null;
    const chatbotDepartmentId: string | null = conv.chatbotDepartmentId ?? null;

    // Usa a primeira mensagem de texto do contato como assunto e descrição do ticket.
    // Isso captura a demanda digitada pelo cliente no chatbot ("descreva sua demanda").
    // Só cai no fallback genérico se não houver nenhuma mensagem de texto do contato.
    const firstContactMsgRows: Array<{ content: string }> = await this.dataSource.query(
      `SELECT content FROM conversation_messages
        WHERE conversation_id = $1 AND tenant_id = $2
          AND author_type = 'contact'
          AND (media_kind IS NULL OR media_kind = '')
          AND content <> ''
        ORDER BY created_at ASC LIMIT 1`,
      [conversationId, tenantId],
    ).catch(() => []);
    const demandText = firstContactMsgRows[0]?.content?.trim() || null;
    const subject = demandText
      ? demandText.slice(0, 120)
      : `Atendimento WhatsApp - ${contactName}`;

    // Cria ticket vinculado à conversa.
    // authorType='user' garante que o agente que clicou seja atribuído automaticamente
    // se nenhum outro agente estiver disponível (linha "if authorType=user && !assignedTo" no tickets.service).
    // Usa update() pontual para evitar sobrescrever métricas operacionais já gravadas na conversa.
    const ticket = await this.createTicketForConversation(
      tenantId,
      conv,
      undefined,                       // firstMessage
      contactName,
      subject,
      agentId,                         // authorId  → userId no ticketsService.create
      agentName,                       // authorName
      demandText || undefined,              // descriptionOverride — demanda como descrição
      chatbotDepartmentId || undefined,     // departmentId — chave estável
      chatbotDepartment || undefined,       // department — nome para fallback/display
    );

    // Garante atribuição ao agente que clicou via SQL direto (substitui round-robin e é idempotente)
    await this.dataSource.query(
      `UPDATE tickets SET assigned_to = $1, status = 'in_progress', auto_assigned_at = NOW()
        WHERE id = $2 AND tenant_id = $3`,
      [agentId, ticket.id, tenantId],
    );

    // Vincula conversa ao ticket via update pontual (preserva sla_first_response_deadline e sla_resolution_deadline).
    // Persiste também o clientId resolvido pelos fallbacks caso não estivesse gravado na conversa.
    const attendanceStartedAt = new Date();
    const convUpdate: Partial<Conversation> = { ticketId: ticket.id, attendanceStartedAt };
    if (conv.clientId && conv.clientId !== originalClientId) {
      convUpdate.clientId = conv.clientId;
    }
    await this.convRepo.update({ id: conversationId, tenantId }, convUpdate);
    conv.ticketId = ticket.id;
    conv.attendanceStartedAt = attendanceStartedAt;

    // Envia mensagem de boas-vindas ao contato via WhatsApp após iniciar atendimento
    if (conv.channel === 'whatsapp' && contact?.whatsapp && this.postTicketMessageSender) {
      this.postTicketMessageSender(tenantId, contact.whatsapp, { name: contactName }, ticket).catch((e) =>
        this.logger.warn(`[startAttendance] Falha ao enviar mensagem de boas-vindas #${ticket.ticketNumber}: ${e?.message}`),
      );
    }

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
        ...(conv.priorityId ? { priorityId: conv.priorityId } : {}),
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

  async assertPortalConversationAccess(
    tenantId: string,
    conversationId: string,
    portalContactId: string,
    isPrimary: boolean,
  ): Promise<Conversation> {
    const conv = await this.findOne(tenantId, conversationId);

    if (conv.ticketId) {
      const ticket = await this.ticketsService.findOne(tenantId, conv.ticketId);
      if (ticket.clientId) {
        const canAccess = await this.customersService.canContactAccessTicket(
          tenantId,
          portalContactId,
          ticket.clientId,
          ticket.contactId ?? null,
          isPrimary,
        );
        if (!canAccess) throw new NotFoundException('Conversa não encontrada');
      }
      return conv;
    }

    if (conv.clientId) {
      const canAccess = await this.customersService.canContactAccessTicket(
        tenantId,
        portalContactId,
        conv.clientId,
        conv.contactId ?? null,
        isPrimary,
      );
      if (!canAccess) throw new NotFoundException('Conversa não encontrada');
      return conv;
    }

    if (conv.contactId !== portalContactId) {
      throw new NotFoundException('Conversa não encontrada');
    }

    return conv;
  }

  /**
   * GET conversa (dashboard): inclui `priorityInfo` mesmo para prioridade inativa
   * (join direto por id; sem filtrar `active`).
   */
  async findOneForDashboard(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const conv = await this.convRepo.findOne({
      where: { id, tenantId },
      relations: ['tenantPriority'],
    });
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const tp = conv.tenantPriority;
    const base = { ...conv } as Record<string, unknown>;
    delete base.tenantPriority;
    base.priorityInfo = tp
      ? { id: tp.id, name: tp.name, color: tp.color, slug: tp.slug, active: tp.active }
      : null;
    return base;
  }

  async getActiveCount(
    tenantId: string,
    opts?: { agentId?: string },
  ): Promise<{ conversations: number; tickets: number; total: number }> {
    const agentId = opts?.agentId;
    const convQb = this.convRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.status = :status', { status: ConversationStatus.ACTIVE });

    if (agentId) {
      convQb.andWhere(
        `(c.ticket_id IS NULL OR EXISTS (
          SELECT 1 FROM tickets t_ag
          WHERE t_ag.id::text = c.ticket_id::text
            AND (t_ag.assigned_to IS NULL OR t_ag.assigned_to = :agentId)
        ))`,
        { agentId },
      );
    }

    const [conversations, tickets] = await Promise.all([
      convQb.getCount(),
      agentId
        ? this.ticketsService.getActiveInboxTicketCountForAgent(tenantId, agentId)
        : this.ticketsService.getActiveInboxTicketCount(tenantId),
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
    const rows = raws.entities.map((entity, i) => ({
      ...entity,
      contactName:    raws.raw[i]?.contactName    ?? null,
      ticketNumber:   raws.raw[i]?.ticketNumber   ?? null,
      clientName:     raws.raw[i]?.clientName     ?? null,
      assignedTo:     raws.raw[i]?.assignedTo     ?? null,
      assignedToName: raws.raw[i]?.assignedToName ?? null,
    }));

    if (rows.length > 0) {
      const convIds = rows.map((r) => r.id);
      const lastAgentRows: Array<{ conversation_id: string; last_agent_at: Date | string | null }> =
        await this.dataSource.query(
          `SELECT conversation_id, MAX(created_at) AS last_agent_at
           FROM conversation_messages
           WHERE tenant_id = $1
             AND conversation_id = ANY($2::uuid[])
             AND author_type = 'user'
           GROUP BY conversation_id`,
          [tenantId, convIds],
        );
      const lastAgentMap = new Map(
        lastAgentRows.map((r) => [
          r.conversation_id,
          r.last_agent_at ? new Date(r.last_agent_at as string | Date) : null,
        ]),
      );
      for (const r of rows) {
        (r as Conversation & { lastAgentMessageAt?: Date | null }).lastAgentMessageAt = lastAgentMap.get(r.id) ?? null;
      }

      // Última mensagem do cliente (contact) — necessária para cálculo do ciclo de espera visual.
      const lastClientRows: Array<{ conversation_id: string; last_client_at: Date | string | null }> =
        await this.dataSource.query(
          `SELECT conversation_id, MAX(created_at) AS last_client_at
           FROM conversation_messages
           WHERE tenant_id = $1
             AND conversation_id = ANY($2::uuid[])
             AND author_type = 'contact'
           GROUP BY conversation_id`,
          [tenantId, convIds],
        );
      const lastClientMap = new Map(
        lastClientRows.map((r) => [
          r.conversation_id,
          r.last_client_at ? new Date(r.last_client_at as string | Date) : null,
        ]),
      );
      for (const r of rows) {
        (r as Conversation & { lastClientMessageAt?: Date | null }).lastClientMessageAt = lastClientMap.get(r.id) ?? null;
      }
    }

    for (const r of rows) {
      (r as Conversation & { priorityInfo?: unknown }).priorityInfo = null;
    }
    const priorityIds = [...new Set(rows.map((r) => r.priorityId).filter(Boolean))] as string[];
    if (priorityIds.length > 0) {
      const prios = await this.dataSource.getRepository(TenantPriority).find({
        where: { tenantId, id: In(priorityIds) },
      });
      const pmap = new Map(prios.map((p) => [p.id, p]));
      for (const r of rows) {
        const tp = r.priorityId ? pmap.get(r.priorityId) : undefined;
        (r as Conversation & { priorityInfo?: unknown }).priorityInfo = tp
          ? { id: tp.id, name: tp.name, color: tp.color, slug: tp.slug, active: tp.active }
          : null;
      }
    }

    return rows;
  }

  /**
   * Retorna mensagens da conversa (chat em tempo real do portal).
   */
  /** Enriquece mensagens com snapshot das citadas (1 query IN para todos os replyToIds). */
  private async attachReplyToSnapshots(tenantId: string, messages: ConversationMessage[]): Promise<void> {
    const ids = [...new Set(messages.map((m) => m.replyToId).filter(Boolean))] as string[];
    if (ids.length === 0) return;
    const rows: Array<{ id: string; author_name: string; content: string; media_kind: string | null }> =
      await this.dataSource.query(
        `SELECT id, author_name, content, media_kind
         FROM conversation_messages
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])`,
        [tenantId, ids],
      );
    const map = new Map(
      rows.map((r) => [r.id, { id: r.id, authorName: r.author_name, content: r.content.slice(0, 100), mediaKind: r.media_kind ?? null } as ReplyToSnapshot]),
    );
    for (const m of messages) {
      m.replyTo = m.replyToId ? (map.get(m.replyToId) ?? null) : null;
    }
  }

  /**
   * Retorna os thresholds de SLA visual de fila configurados por tenant.
   * Lê tenant.settings.queueVisualSlaWarningMinutes / queueVisualSlaCriticalMinutes (global).
   * Lê tenant.settings.queueVisualSlaByChannel.{channel} para thresholds por canal.
   * Aplica fallback seguro (2 / 5 minutos) quando ausente ou inválido.
   */
  async getQueueSlaConfig(tenantId: string): Promise<{
    warningMinutes: number;
    criticalMinutes: number;
    byChannel: Record<string, { warningMinutes: number; criticalMinutes: number }>;
  }> {
    const rows: Array<{ settings: Record<string, unknown> }> = await this.dataSource.query(
      `SELECT settings FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    const s: Record<string, unknown> = rows[0]?.settings ?? {};

    // Thresholds globais com fallback seguro
    const rawW = Number(s.queueVisualSlaWarningMinutes);
    const rawC = Number(s.queueVisualSlaCriticalMinutes);
    const warningMinutes = Number.isFinite(rawW) && rawW >= 1 ? Math.floor(rawW) : 2;
    const criticalMinutes =
      Number.isFinite(rawC) && rawC > warningMinutes ? Math.floor(rawC) : Math.max(warningMinutes + 1, 5);

    // Thresholds por canal: { whatsapp: { warningMinutes, criticalMinutes }, portal: {...} }
    const rawByChannel = (s.queueVisualSlaByChannel ?? {}) as Record<string, unknown>;
    const byChannel: Record<string, { warningMinutes: number; criticalMinutes: number }> = {};
    for (const [ch, cfg] of Object.entries(rawByChannel)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const obj = cfg as Record<string, unknown>;
      const chW = Number(obj.warningMinutes);
      const chC = Number(obj.criticalMinutes);
      if (Number.isFinite(chW) && chW >= 1 && Number.isFinite(chC) && chC > chW) {
        byChannel[ch] = { warningMinutes: Math.floor(chW), criticalMinutes: Math.floor(chC) };
      }
    }

    return { warningMinutes, criticalMinutes, byChannel };
  }

  async getMessages(tenantId: string, conversationId: string): Promise<ConversationMessage[]> {
    const conv = await this.findOne(tenantId, conversationId);
    const messages = await this.msgRepo.find({
      where: { conversationId: conv.id, tenantId },
      order: { createdAt: 'ASC' },
    });
    await this.attachReplyToSnapshots(tenantId, messages);
    return messages;
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
    await this.attachReplyToSnapshots(tenantId, messages);
    return { messages, hasMore };
  }

  /**
   * Adiciona mensagem à conversa (cliente ou agente). Usado no chat do portal.
   */
  /**
   * Adiciona mensagem à conversa (cliente ou agente). Usado no chat do portal e WhatsApp.
   *
   * Contrato de authorType:
   *  - 'contact' → mensagem do cliente/contato (inbound)
   *  - 'user'    → mensagem de um atendente humano autenticado (outbound)
   *
   * Mensagens automáticas (boas-vindas pós-ticket, chatbot, avaliação) são enviadas
   * diretamente via Baileys/Meta e NÃO passam por este método — logo authorType='user'
   * representa exclusivamente um atendente humano. O SLA de primeira resposta é gatilhado
   * apenas para authorType='user', a menos que skipSlaFirstResponse=true seja passado
   * explicitamente (reservado para casos de automação futura que usem este método).
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
      mediaKind?: 'image' | 'audio' | 'video' | 'file' | null;
      mediaStorageKey?: string | null;
      mediaMime?: string | null;
      /** Nome original do arquivo enviado pelo usuário (ex: "relatorio.pdf"). Usado como fileName no WhatsApp. */
      mediaOriginalFilename?: string | null;
      /** Texto real do usuário para usar como caption no WhatsApp (sem emoji de placeholder). */
      mediaCaption?: string | null;
      /** ID da mensagem que está sendo respondida (reply estilo WhatsApp). */
      replyToId?: string | null;
      /**
       * Impede o registro de sla_first_response_at para esta mensagem.
       * Use somente para automações que passem authorType='user' mas não devam contar
       * como primeira resposta humana no SLA (ex: mensagem de sistema futura).
       */
      skipSlaFirstResponse?: boolean;
    },
  ): Promise<ConversationMessage> {
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

    let replyToId: string | null = null;
    if (opts?.replyToId) {
      const parent = await this.msgRepo.findOne({
        where: { id: opts.replyToId, tenantId, conversationId: conv.id },
      });
      replyToId = parent?.id ?? null;
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
      mediaOriginalFilename: opts?.mediaOriginalFilename ?? null,
      whatsappStatus: opts?.initialWhatsappStatus ?? null,
      externalId: extId ?? null,
      replyToId,
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

    // Registra a primeira resposta humana do agente nas métricas operacionais do chat.
    if (authorType === 'user' && !opts?.skipSlaFirstResponse) {
      if (!conv.firstAgentReplyAt) {
        await this.convRepo.update(
          { id: conversationId, tenantId },
          { firstAgentReplyAt: new Date() } as Partial<Conversation>,
        ).catch(() => undefined);
      }
    }

    // Busca snapshot da mensagem citada (1 query leve, só se houver replyToId)
    let replyToSnapshot: ReplyToSnapshot | null = null;
    if (saved.replyToId) {
      const parent = await this.msgRepo.findOne({ where: { id: saved.replyToId, tenantId, conversationId: conv.id } });
      if (parent) {
        replyToSnapshot = {
          id: parent.id,
          authorName: parent.authorName,
          content: parent.content.slice(0, 100),
          mediaKind: parent.mediaKind ?? null,
        };
      }
    }
    saved.replyTo = replyToSnapshot;

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
        mediaOriginalFilename: saved.mediaOriginalFilename ?? null,
        hasMedia: !!(saved.mediaKind && saved.mediaStorageKey),
        replyToId: saved.replyToId ?? null,
        replyTo: replyToSnapshot,
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
                : saved.mediaKind === 'file'
                  ? '[Documento]' + (content ? `: ${content.slice(0, 40)}` : '')
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
                : saved.mediaKind === 'file'
                  ? '[Documento]' + (content ? `: ${content.slice(0, 40)}` : '')
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
            const mediaPathOk =
              opts?.mediaKind &&
              absMedia &&
              (await fs.promises.access(absMedia).then(() => true).catch(() => false));
            const cap = ((opts && 'mediaCaption' in opts ? opts.mediaCaption : null) || '').trim();
            let outboundPayload:
              | string
              | { kind: 'image' | 'audio' | 'video' | 'file'; filePath: string; caption?: string; mime?: string; fileName?: string };
            if (mediaPathOk && opts?.mediaKind) {
              const fileName = opts?.mediaOriginalFilename || (opts?.mediaStorageKey ? path.basename(opts.mediaStorageKey) : undefined);
              this.logger.log(JSON.stringify({
                event: 'whatsapp_media_send_attempt',
                conversationId,
                kind: opts.mediaKind,
                mime: opts.mediaMime,
                fileName,
                filePath: absMedia,
              }));
              outboundPayload = {
                kind: opts.mediaKind as 'image' | 'audio' | 'video' | 'file',
                filePath: absMedia!,
                caption: (opts && 'mediaCaption' in opts) ? (opts.mediaCaption || undefined) : (content || undefined),
                mime: opts.mediaMime || undefined,
                // Usa nome original do arquivo se disponível; fallback para basename do storage key
                fileName,
              };
            } else {
              // Fallback para portal: só ocorre se não há mídia ou o arquivo não existe no disco
              if (opts?.mediaKind) {
                this.logger.warn(JSON.stringify({
                  event: 'whatsapp_media_send_fallback_portal',
                  conversationId,
                  kind: opts.mediaKind,
                  reason: !absMedia ? 'sem_storage_key' : 'arquivo_nao_encontrado_no_disco',
                  absMedia,
                }));
              }
              outboundPayload = content;
            }
            const prefixAgent = await fetchWhatsappPrefixAgentEnabled(this.dataSource, tenantId);
            if (prefixAgent && authorName?.trim()) {
              if (typeof outboundPayload === 'string') {
                outboundPayload = prependWhatsappAgentLine(authorName, outboundPayload);
              } else if (outboundPayload && typeof outboundPayload === 'object' && 'kind' in outboundPayload) {
                const cap = (outboundPayload as { caption?: string }).caption ?? '';
                outboundPayload = {
                  ...outboundPayload,
                  caption: prependWhatsappAgentLine(authorName, cap) || undefined,
                };
              }
            }
            // Resolve mensagem citada para reply nativo no WhatsApp
            let quotedMsg: { externalId: string; content: string; fromMe: boolean } | null = null;
            if (replyToId) {
              const parent = await this.msgRepo.findOne({
                where: { id: replyToId, tenantId, conversationId: conv.id },
              });
              if (parent?.externalId) {
                quotedMsg = {
                  externalId: parent.externalId,
                  content: parent.content.slice(0, 200),
                  fromMe: parent.authorType === 'user',
                };
              }
            }
            // Passa o canal da conversa para garantir que a resposta saia pelo número correto
            const raw = await this.outboundSender(tenantId, contact.whatsapp, outboundPayload as any, quotedMsg, conv.whatsappChannelId ?? null);
            const sendResult = typeof raw === 'boolean' ? { success: raw } : raw;
            if (sendResult.success) {
              const externalId = sendResult.messageId ?? null;
              await this.msgRepo.update(savedId, { externalId, whatsappStatus: 'sent' });
              saved.externalId = externalId; // atualiza em memória para o emitMsg incluir o id correto
              emitMsg('sent');
            } else {
              await this.msgRepo.update(savedId, { whatsappStatus: 'failed' });
              emitMsg('failed');
              console.warn(`[ConversationsService] Mensagem salva mas envio WhatsApp falhou (conv=${conversationId}): ${sendResult.error ?? 'sem detalhes'}`);
            }
          } else {
            this.logger.warn(`[ConversationsService] Contato ${conv.contactId} sem WhatsApp — mensagem salva sem envio outbound`);
            await this.msgRepo.update(savedId, { whatsappStatus: 'failed' }).catch(() => {});
            emitMsg('failed');
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
      convLocked.conversationClosedAt = new Date();
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

    // WhatsApp: ao encerrar a conversa, dispara avaliação ao cliente.
    // Isso inclui o caso keepTicketOpen=true: a conversa foi encerrada, o cliente pode avaliar
    // o atendimento mesmo que o ticket permaneça aberto para o agente continuar trabalhando.
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
        const deveAvaliar = !!ticketId && !!this.outboundSender;
        console.log(`[ConversationsService.close] conversation=${id} ticket=${ticketId ?? 'none'} identifier=${identifier} keepTicketOpen=${!!keepTicketOpen} shouldRate=${deveAvaliar}`);
        if (deveAvaliar) {
          const sender = this.outboundSender!;
          await this.chatbotService.initiateRating(tenantId, identifier, ticketId!, 'whatsapp', async (text) => {
            await sender(tenantId, identifier, text);
          });
        } else {
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

    return this.withConversationScopeLock(tenantId, effectiveContactId, ConversationChannel.PORTAL, async (manager) => {
      const convRepo = manager.getRepository(Conversation);
      const activeForTicket = await convRepo.findOne({
        where: { tenantId, ticketId: ticket.id, channel: ConversationChannel.PORTAL, status: ConversationStatus.ACTIVE },
        order: { createdAt: 'DESC' },
      });
      if (activeForTicket) {
        if (ticket.conversationId !== activeForTicket.id) {
          await this.ticketsService.linkToConversation(tenantId, ticketId, activeForTicket.id);
        }
        return { conversation: activeForTicket, ticket };
      }

      let active = await this.findLatestActiveConversationByContact(manager, tenantId, effectiveContactId, ConversationChannel.PORTAL);
      if (active) {
        if (active.ticketId && active.ticketId !== ticket.id) {
          throw new BadRequestException('Ja existe uma conversa ativa deste contato vinculada a outro ticket.');
        }
        if (active.ticketId !== ticket.id) {
          active.ticketId = ticket.id;
          active = await convRepo.save(active);
        }
        if (ticket.conversationId !== active.id) {
          await this.ticketsService.linkToConversation(tenantId, ticketId, active.id);
        }
        return { conversation: active, ticket };
      }

      const conv = convRepo.create({
        tenantId,
        clientId: ticket.clientId,
        contactId: effectiveContactId,
        channel: ConversationChannel.PORTAL,
        status: ConversationStatus.ACTIVE,
        ticketId: ticket.id,
        initiatedBy: ConversationInitiatedBy.CONTACT,
        queuedAt: new Date(),
      });
      try {
        const saved = await convRepo.save(conv);
        await this.ticketsService.linkToConversation(tenantId, ticketId, saved.id);
        return { conversation: saved, ticket };
      } catch (error) {
        if (!this.isActiveConversationUniqueViolation(error)) throw error;
        active = await this.findLatestActiveConversationByContact(manager, tenantId, effectiveContactId, ConversationChannel.PORTAL);
        if (!active) throw error;
        if (active.ticketId && active.ticketId !== ticket.id) {
          throw new BadRequestException('Ja existe uma conversa ativa deste contato vinculada a outro ticket.');
        }
        if (active.ticketId !== ticket.id) {
          active.ticketId = ticket.id;
          active = await convRepo.save(active);
        }
        if (ticket.conversationId !== active.id) {
          await this.ticketsService.linkToConversation(tenantId, ticketId, active.id);
        }
        return { conversation: active, ticket };
      }
    });
  }

  /**
   * Atualiza o whatsappStatus de uma mensagem a partir do externalId (WhatsApp message key).
   * Chamado pelo BaileysService via callback ACK (messages.update).
   * Só promove o status (sent → delivered → read), nunca rebaixa.
   */
  async updateMessageStatusByExternalId(tenantId: string, externalId: string, newStatus: string): Promise<void> {
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
      mediaOriginalFilename: msg.mediaOriginalFilename ?? null,
      hasMedia: !!(msg.mediaKind && msg.mediaStorageKey),
    };
    this.realtimeEmitter.emitNewConversationMessage(msg.conversationId, payload);
    if (conv?.ticketId) {
      this.realtimeEmitter.emitNewMessage(conv.ticketId, payload);
    }
  }
}

