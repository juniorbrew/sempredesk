import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Conversation, ConversationChannel, ConversationStatus, ConversationInitiatedBy } from './entities/conversation.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CustomersService } from '../customers/customers.service';
import { TicketOrigin } from '../tickets/entities/ticket.entity';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';

@Injectable()
export class ConversationsService {
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
  private outboundSender: ((tenantId: string, toWhatsapp: string, text: string) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>) | null = null;
  setOutboundSender(fn: (tenantId: string, toWhatsapp: string, text: string) => Promise<{ success: boolean; jid?: string | null; messageId?: string | null; error?: string } | boolean>) {
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
    private readonly ticketsService: TicketsService,
    private readonly customersService: CustomersService,
    private readonly realtimeEmitter: RealtimeEmitterService,
  ) {}

  /**
   * Builds or creates a conversation for a contact, creating the ticket in the background.
   * Used when starting a portal chat or receiving the first WhatsApp message.
   */
  async getOrCreateForContact(
    tenantId: string,
    clientId: string | null,
    contactId: string,
    channel: ConversationChannel,
    opts?: { chatAlert?: boolean; firstMessage?: string; contactName?: string; department?: string },
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
    if (active?.ticketId) {
      const ticket = await this.ticketsService.findOne(tenantId, active.ticketId);
      return { conversation: active, ticket, ticketCreated: false };
    }
    if (active && !active.ticketId) {
      const contact = await this.customersService.findContactById(tenantId, contactId);
      const contactName = opts?.contactName || contact?.name || 'Cliente';
      const ticket = await this.createTicketForConversation(
        tenantId, active, opts?.firstMessage, contactName, undefined, contactId, contactName, undefined, opts?.department,
      );
      active.ticketId = ticket.id;
      await this.convRepo.save(active);
      return { conversation: active, ticket, ticketCreated: true };
    }
    const result = await this.startConversation(tenantId, clientId, contactId, channel, opts as any);
    return { ...result, ticketCreated: true };
  }

  /**
   * Portal: Iniciar atendimento. Cria conversa + ticket automaticamente.
   * Aceita subject, description e departmentId para criar ticket completo.
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

    const estimatedResponse = this.calcEstimatedResponse(result.ticket?.slaResponseAt);

    return {
      conversation: result.conversation,
      ticket: result.ticket,
      ticketNumber: result.ticket?.ticketNumber,
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
   * Inbound: starts conversation + ticket (portal "Iniciar atendimento" ou primeira mensagem WhatsApp).
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
  ): Promise<{ conversation: Conversation; ticket: any }> {
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
    const ticket = await this.createTicketForConversation(tenantId, savedConv, opts?.firstMessage, opts?.contactName, opts?.subject, undefined, undefined, opts?.description, opts?.departmentId, opts?.department);
    savedConv.ticketId = ticket.id;
    await this.convRepo.save(savedConv);
    return { conversation: savedConv, ticket };
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
    if (clientId && contact.clientId && String(contact.clientId) !== String(clientId)) {
      throw new BadRequestException('Contato pertence a outro cliente');
    }
    if (channel === ConversationChannel.WHATSAPP && !contact.whatsapp) {
      throw new BadRequestException('Contato não possui WhatsApp cadastrado');
    }
    // Usa o clientId do contato se já vinculado; caso contrário usa o informado
    const resolvedClientId = contact.clientId ? String(contact.clientId) : (clientId ?? null);
    const existing = await this.convRepo.findOne({
      where: { tenantId, clientId: resolvedClientId, contactId, channel, status: ConversationStatus.ACTIVE },
    });
    if (existing) return existing;
    const conv = this.convRepo.create({
      tenantId,
      clientId: resolvedClientId,
      contactId,
      channel,
      status: ConversationStatus.ACTIVE,
      initiatedBy: ConversationInitiatedBy.AGENT,
    });
    return this.convRepo.save(conv);
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

    // Filtro por agente: sem ticket (fila livre) OU ticket atribuído a este agente
    if (agentId) {
      qb.andWhere(
        `(c.ticket_id IS NULL OR EXISTS (
          SELECT 1 FROM tickets t_ag
          WHERE t_ag.id::text = c.ticket_id::text
            AND t_ag.assigned_to = :agentId
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
    const conv = await this.findOne(tenantId, conversationId);
    return this.msgRepo.find({
      where: { conversationId: conv.id, tenantId },
      order: { createdAt: 'ASC' },
    });
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
    opts?: { skipOutbound?: boolean; initialWhatsappStatus?: string },
  ): Promise<ConversationMessage> {
    const conv = await this.findOne(tenantId, conversationId);
    if (conv.status === ConversationStatus.CLOSED) {
      throw new BadRequestException('Conversa já encerrada.');
    }
    const msg = this.msgRepo.create({
      tenantId,
      conversationId: conv.id,
      authorId,
      authorName,
      authorType,
      content,
      // Status inicial fornecido pelo chamador (ex: sendReplyFromTicket já enviou via Baileys)
      whatsappStatus: opts?.initialWhatsappStatus ?? null,
    });
    const saved = await this.msgRepo.save(msg);
    await this.updateLastMessageAt(tenantId, conversationId);

    // Helper: emite evento de mensagem incluindo campos de status
    const emitMsg = (statusOverride?: string) =>
      this.realtimeEmitter.emitNewConversationMessage(conversationId, {
        id: saved.id,
        conversationId: saved.conversationId,
        authorId: saved.authorId,
        authorType: saved.authorType,
        authorName: saved.authorName,
        content: saved.content,
        createdAt: saved.createdAt,
        whatsappStatus: statusOverride ?? saved.whatsappStatus,
        externalId: saved.externalId ?? null,
      });

    emitMsg(); // emit inicial com o status que foi salvo

    // Notifica todos os agentes do tenant sobre nova mensagem do contato (badges em tempo real)
    if (authorType === 'contact') {
      this.realtimeEmitter.emitToTenant(tenantId, 'new-message', {
        conversationId: conv.id,
        channel: conv.channel,
        contactName: authorName,
        preview: content.length > 80 ? content.slice(0, 77) + '…' : content,
      });
    }

    // Envia via WhatsApp quando é mensagem do agente em conversa WhatsApp
    // skipOutbound=true quando o envio já foi feito pelo chamador (ex.: sendReplyFromTicket)
    if (!opts?.skipOutbound && authorType === 'user' && conv.channel === ConversationChannel.WHATSAPP && this.outboundSender) {
      try {
        const contact = await this.customersService.findContactById(tenantId, conv.contactId);
        if (contact?.whatsapp) {
          const raw = await this.outboundSender(tenantId, contact.whatsapp, content);
          const sendResult = typeof raw === 'boolean' ? { success: raw } : raw;
          if (sendResult.success) {
            const externalId = sendResult.messageId ?? null;
            await this.msgRepo.update(saved.id, { externalId, whatsappStatus: 'sent' });
            saved.externalId = externalId;
            saved.whatsappStatus = 'sent';
            // Re-emite com status atualizado para o frontend atualizar o ícone sem reload
            emitMsg('sent');
          } else {
            await this.msgRepo.update(saved.id, { whatsappStatus: 'failed' });
            saved.whatsappStatus = 'failed';
            emitMsg('failed');
            console.warn(`[ConversationsService] Mensagem salva mas envio WhatsApp falhou (conv=${conversationId}): ${sendResult.error ?? 'sem detalhes'}`);
          }
        }
      } catch (e) {
        // Falha no envio WhatsApp não deve impedir o salvamento da mensagem
        await this.msgRepo.update(saved.id, { whatsappStatus: 'failed' }).catch(() => {});
        emitMsg('failed');
        console.error('[ConversationsService] Falha ao enviar mensagem outbound WhatsApp:', e);
      }
    }

    return saved;
  }

  /**
   * Encerra a conversa.
   * - Se não tiver ticket: cria ticket e migra mensagens do conversation_messages.
   * - Se tiver ticket: migra mensagens do conversation_messages para o ticket existente.
   * - closureData: quando fornecido e keepTicketOpen=false, adiciona encerramento formal como interação separada.
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

    let ticketId = conv.ticketId;

    if (!ticketId) {
      const contact = await this.customersService.findContactById(tenantId, conv.contactId);
      const contactName = contact?.name || 'Cliente';
      const ticket = await this.createTicketForConversation(tenantId, conv, undefined, contactName, undefined, userId, userName);

      ticketId = ticket.id;
      conv.ticketId = ticketId;
      await this.convRepo.save(conv);
    }

    // 1. Copiar mensagens da conversa para o ticket (transcrição do chat)
    const msgs = await this.getMessages(tenantId, conv.id);
    for (const m of msgs) {
      await this.ticketsService.addMessage(tenantId, ticketId, m.authorId ?? conv.contactId, m.authorName, m.authorType, {
        content: m.content, messageType: 'comment' as any, channel: conv.channel,
      });
    }

    if (!keepTicketOpen) {
      const uid = userId ?? 'system';
      const uname = userName ?? 'Sistema';

      // 2. Encerramento formal: adicionar como interação separada da conversa
      if (closureData?.solution?.trim()) {
        const parts: string[] = ['--- ENCERRAMENTO DO ATENDIMENTO ---', `Solução aplicada: ${closureData.solution.trim()}`];
        if (closureData.rootCause?.trim()) parts.push(`Causa raiz: ${closureData.rootCause.trim()}`);
        if (closureData.timeSpentMin != null && closureData.timeSpentMin > 0) parts.push(`Tempo gasto: ${closureData.timeSpentMin} min`);
        if (closureData.complexity != null && closureData.complexity > 0) parts.push(`Complexidade: ${closureData.complexity}/5`);
        await this.ticketsService.addMessage(tenantId, ticketId, uid, uname, 'user', {
          content: parts.join('\n'),
          messageType: 'comment' as any,
        });
        await this.ticketsService.resolve(tenantId, ticketId, uid, uname, {
          resolutionSummary: closureData.solution.trim(),
          timeSpentMin: closureData.timeSpentMin,
        });
      }
      if (closureData?.internalNote?.trim()) {
        await this.ticketsService.addMessage(tenantId, ticketId, uid, uname, 'user', {
          content: closureData.internalNote.trim(),
          messageType: 'internal' as any,
        });
      }

      // Ticket permanece como "resolvido" — cliente tem 7 dias para confirmar no portal.
      // O cron autoCloseResolvedTickets fecha automaticamente após esse prazo.
    }

    conv.status = ConversationStatus.CLOSED;
    await this.convRepo.save(conv);

    // WhatsApp: ao encerrar o atendimento formalmente, dispara avaliação ao cliente.
    // Se o atendimento não foi encerrado (keepTicketOpen), apenas reseta a sessão.
    if (conv.channel === ConversationChannel.WHATSAPP && this.chatbotService) {
      const contact = conv.contactId
        ? await this.customersService.findContactById(tenantId, conv.contactId).catch(() => null)
        : null;
      const identifier = (contact as any)?.whatsapp ?? null;

      if (identifier) {
        const deveAvaliar = !keepTicketOpen && !!ticketId && !!this.outboundSender;
        if (deveAvaliar) {
          const sender = this.outboundSender!;
          this.chatbotService
            .initiateRating(tenantId, identifier, ticketId!, 'whatsapp', async (text) => {
              await sender(tenantId, identifier, text);
            })
            .catch(() => {
              // Fallback: se avaliação falhar, apenas reseta a sessão
              this.chatbotService!.resetSession(tenantId, identifier, 'whatsapp').catch(() => {});
            });
        } else {
          this.chatbotService.resetSession(tenantId, identifier, 'whatsapp').catch(() => {});
        }
      }
    }

    return conv;
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
    const STATUS_RANK: Record<string, number> = { pending: 0, queued: 0, sent: 1, delivered: 2, read: 3 };
    const msg = await this.msgRepo.findOne({ where: { tenantId, externalId } });
    if (!msg) return; // mensagem ainda não persistida ou de outro tenant

    const currentRank = STATUS_RANK[msg.whatsappStatus ?? ''] ?? -1;
    const newRank = STATUS_RANK[newStatus] ?? -1;
    if (newRank <= currentRank) return; // não rebaixa

    await this.msgRepo.update(msg.id, { whatsappStatus: newStatus });

    // Emite socket para o frontend atualizar o ícone em tempo real
    this.realtimeEmitter.emitNewConversationMessage(msg.conversationId, {
      id: msg.id,
      conversationId: msg.conversationId,
      authorId: msg.authorId,
      authorType: msg.authorType,
      authorName: msg.authorName,
      content: msg.content,
      createdAt: msg.createdAt,
      whatsappStatus: newStatus,
      externalId: msg.externalId ?? null,
    });
  }
}
