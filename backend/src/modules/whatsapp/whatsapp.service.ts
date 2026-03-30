import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { CustomersService } from '../customers/customers.service';
import { TicketsService } from '../tickets/tickets.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { BaileysService } from './baileys.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { TicketOrigin } from '../tickets/entities/ticket.entity';
import { ConversationChannel } from '../conversations/entities/conversation.entity';
import { detectCnpjInText, normalizeCnpj } from '../../common/utils/cnpj.utils';
import { normalizeWhatsappNumber } from '../../common/utils/phone.utils';

export interface NormalizedWhatsappMessage {
  provider: 'generic' | 'meta';
  from: string;
  to?: string;
  text: string;
  messageId?: string;
  timestamp?: Date;
  senderName?: string;
  resolvedDigits?: string | null;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  private logWhatsappResolution(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  constructor(
    private readonly http: HttpService,
    private readonly customersService: CustomersService,
    private readonly ticketsService: TicketsService,
    private readonly conversationsService: ConversationsService,
    @Optional() private readonly presenceService: RealtimePresenceService,
    @Optional() private readonly baileysService: BaileysService,
    @Optional() private readonly chatbotService: ChatbotService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  normalizeGenericPayload(body: any): NormalizedWhatsappMessage | null {
    if (!body?.from || !body?.text) return null;
    return {
      provider: 'generic',
      from: String(body.from),
      to: body.to ? String(body.to) : undefined,
      text: String(body.text),
      messageId: body.messageId ? String(body.messageId) : undefined,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    };
  }

  normalizeMetaPayload(body: any): NormalizedWhatsappMessage | null {
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const msg = value?.messages?.[0];
      if (!msg || (!msg.text?.body && !msg.button?.text && !msg.interactive?.button_reply?.title)) return null;

      const text =
        msg.text?.body ||
        msg.button?.text ||
        msg.interactive?.button_reply?.title ||
        '';

      return {
        provider: 'meta',
        from: msg.from,
        to: value?.metadata?.display_phone_number || value?.metadata?.phone_number_id,
        text,
        messageId: msg.id,
        timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
      };
    } catch {
      return null;
    }
  }

  async handleIncomingMessage(tenantId: string, msg: NormalizedWhatsappMessage, department?: string, chatbotClientId?: string) {
    let wa = (msg.resolvedDigits || msg.from).replace(/\D/g, '');
    // Don't truncate LID-format numbers (from @lid JIDs) Ã¢â‚¬â€ keep full identifier
    // Only truncate if it looks like a real phone number (starts with country code)

    const text = msg.text?.trim();
    if (!text) return { created: false, reason: 'EMPTY_MESSAGE' };

    // For Meta webhook messages, run chatbot here (Baileys runs it in whatsapp.module.ts)
    let resolvedDepartment = department;
    if (msg.provider === 'meta' && !department && this.chatbotService) {
      try {
        const botResult = await this.chatbotService.processMessage(tenantId, msg.from, text, 'whatsapp', msg.senderName);
        if (botResult.handled) {
          // Send replies via Meta API
          for (const reply of botResult.replies) {
            this.sendWhatsappMessage(msg.from, reply).catch(() => {});
          }
          if (!botResult.transfer) {
            return { created: false, reason: 'CHATBOT_HANDLED' };
          }
          resolvedDepartment = botResult.transfer.department ?? undefined;
        }
      } catch (e) {
        this.logger.warn('Chatbot processing failed for Meta message', e);
      }
    }

    // Detecta se ÃƒÂ© um identificador LID (nÃƒÂ£o ÃƒÂ© nÃƒÂºmero de telefone real)
    // LIDs sÃƒÂ£o identificadores internos do WhatsApp Ã¢â‚¬â€ 14+ dÃƒÂ­gitos ou flag explÃƒÂ­cita do Baileys
    const rawFromDigits = msg.from.replace(/\D/g, '');
    const isLid = (msg as any).isLid === true || rawFromDigits.length >= 14;
    const normalizedWhatsapp = normalizeWhatsappNumber(wa) || wa;
    this.logWhatsappResolution({
      scope: 'contact-resolution',
      direction: 'inbound',
      tenantId,
      rawPhone: msg.from,
      rawWhatsapp: msg.from,
      normalizedPhone: normalizedWhatsapp,
      clientId: chatbotClientId ?? null,
      lid: isLid ? rawFromDigits : null,
      resolvedDigits: msg.resolvedDigits ?? null,
      stage: 'before-contact-resolution',
    });

    const canonicalContact = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
      rawWhatsapp: msg.from,
      normalizedWhatsapp,
      lid: isLid ? rawFromDigits : null,
      clientId: chatbotClientId ?? null,
      direction: 'inbound',
    });
    let contact = canonicalContact.contact;
    let contactAction: 'reuse' | 'create' = 'reuse';
    const blockedTechnicalOnly = canonicalContact.canonicalReason?.includes('blocked-technical-only') ?? false;
    if (!contact) {
      if (blockedTechnicalOnly) {
        const canMaterializeTrustedResolvedContact = Boolean(
          chatbotClientId &&
          msg.resolvedDigits &&
          normalizeWhatsappNumber(msg.resolvedDigits),
        );
        if (canMaterializeTrustedResolvedContact) {
          const resolvedPhone = normalizeWhatsappNumber(msg.resolvedDigits as string) || msg.resolvedDigits!;
          this.logger.log(
            `Materializando contato canônico para identificador técnico ${msg.from} usando resolvedDigits=${resolvedPhone} e clientId=${chatbotClientId}`,
          );
          contact = await this.customersService.findOrCreateByWhatsapp(
            tenantId,
            resolvedPhone,
            msg.senderName,
            false,
            {
              direction: 'inbound',
              clientId: chatbotClientId ?? null,
              rawInput: resolvedPhone,
            },
          );
          if (contact) {
            await this.customersService.persistWhatsappRuntimeIdentifiers(
              tenantId,
              contact.id,
              {
                whatsappLid: isLid ? rawFromDigits : null,
                whatsappResolvedDigits: resolvedPhone,
                whatsappJid: msg.from.includes('@') ? msg.from : null,
              },
              {
                direction: 'inbound',
                clientId: chatbotClientId ?? null,
                rawInput: msg.from,
              },
            ).catch(() => {});
            contact.metadata = {
              ...(contact.metadata ?? {}),
              ...(isLid ? { whatsappLid: rawFromDigits } : {}),
              whatsappResolvedDigits: resolvedPhone,
            };
            contactAction = 'create';
          }
        }
      }
      if (!contact && blockedTechnicalOnly) {
        this.logWhatsappResolution({
          scope: 'canonical-contact-resolution',
          direction: 'inbound',
          tenantId,
          rawPhone: msg.from,
          rawWhatsapp: msg.from,
          normalizedPhone: normalizedWhatsapp,
          clientId: chatbotClientId ?? null,
          lid: isLid ? rawFromDigits : null,
          candidates: canonicalContact.candidates,
          matchedBy: canonicalContact.matchedBy,
          canonicalReason: canonicalContact.canonicalReason,
          chosenContactId: null,
          stage: 'blocked-technical-contact-fallback',
        });
        return { created: false, reason: 'UNMATCHED_LID_CONTACT' };
      }
      // Cria apenas o contato (sem cliente temporÃƒÂ¡rio)
      this.logger.log(`Criando contato para WhatsApp desconhecido: ${wa} isLid=${isLid} (${msg.senderName || 'sem nome'})`);
      contact = await this.customersService.findOrCreateByWhatsapp(tenantId, wa, msg.senderName, isLid, {
        direction: 'inbound',
        clientId: chatbotClientId ?? null,
        rawInput: msg.from,
      });
      contactAction = 'create';
    }
    if (!contact) {
      this.logWhatsappResolution({
        scope: 'canonical-contact-resolution',
        direction: 'inbound',
        tenantId,
        rawPhone: msg.from,
        rawWhatsapp: msg.from,
        normalizedPhone: normalizedWhatsapp,
        clientId: chatbotClientId ?? null,
        lid: isLid ? wa : null,
        candidates: canonicalContact.candidates,
        matchedBy: canonicalContact.matchedBy,
        canonicalReason: canonicalContact.canonicalReason,
        chosenContactId: null,
        stage: 'unresolved-runtime-identifier',
      });
      return { created: false, reason: isLid ? 'UNMATCHED_LID_CONTACT' : 'CONTACT_CREATE_FAILED' };
    }
    this.logWhatsappResolution({
      scope: 'contact-resolution',
      direction: 'inbound',
      tenantId,
      rawPhone: msg.from,
      rawWhatsapp: msg.from,
      normalizedPhone: normalizedWhatsapp,
      clientId: chatbotClientId ?? contact.clientId ?? null,
      lid: isLid ? rawFromDigits : null,
      existingContactByWhatsapp: canonicalContact.matchedBy === 'whatsapp' || canonicalContact.matchedBy === 'whatsapp+lid'
        ? (canonicalContact.candidates[0] ?? null)
        : null,
      existingContactByPhone: canonicalContact.matchedBy === 'whatsapp' || canonicalContact.matchedBy === 'whatsapp+lid'
        ? (canonicalContact.candidates[0] ?? null)
        : null,
      existingContactByClientId: chatbotClientId && contact.clientId && String(contact.clientId) === String(chatbotClientId)
        ? contact.id
        : null,
      existingContactByLid: canonicalContact.matchedBy === 'lid' || canonicalContact.matchedBy === 'whatsapp+lid'
        ? (canonicalContact.candidates[canonicalContact.candidates.length - 1] ?? null)
        : null,
      chosenContactId: contact.id,
      action: contactAction,
      criterion: contactAction === 'create' ? 'findOrCreateByWhatsapp' : 'resolveCanonicalWhatsappContact',
      stage: 'after-contact-resolution',
      matchedBy: canonicalContact.matchedBy,
      candidates: canonicalContact.candidates,
      canonicalReason: canonicalContact.canonicalReason,
    });
    if (isLid && canonicalContact.matchedBy === 'none') {
      await this.customersService.persistWhatsappLid(tenantId, contact.id, rawFromDigits, {
        direction: 'inbound',
        clientId: chatbotClientId ?? contact.clientId ?? null,
        rawInput: msg.from,
      }).catch(() => {});
      contact.metadata = { ...(contact.metadata ?? {}), whatsappLid: rawFromDigits };
    }

    // Se o chatbot identificou o cliente via CNPJ, vincula o contato antes de criar a conversa
    if (chatbotClientId && !contact.clientId) {
      try {
        await this.customersService.linkContactToClient(tenantId, contact.id, chatbotClientId);
        contact.clientId = chatbotClientId;
        this.logger.log(`Contato ${contact.id} vinculado automaticamente ao cliente ${chatbotClientId} via CNPJ`);
      } catch (e) {
        this.logger.warn(`Falha ao vincular contato ${contact.id} ao cliente ${chatbotClientId} via CNPJ`, e);
      }
    }

    // CNPJ auto-detection: sÃƒÂ³ executa se chatbot nÃƒÂ£o identificou cliente e contato nÃƒÂ£o tem cliente
    if (!chatbotClientId && !contact.clientId) {
      const cnpjDetectado = detectCnpjInText(text ?? '');
      if (cnpjDetectado) {
        this.logger.log(`CNPJ detectado em mensagem do contato ${contact.id}: ${cnpjDetectado}`);
        try {
          const matches = await this.customersService.searchByNameOrCnpj(tenantId, cnpjDetectado);
          const exactMatch = matches.find((m) => normalizeCnpj(m.cnpj ?? '') === cnpjDetectado);
          if (exactMatch) {
            this.logger.log(`Cliente ${exactMatch.id} encontrado via CNPJ ${cnpjDetectado} Ã¢â‚¬â€ vinculando contato ${contact.id}`);
            await this.customersService.linkContactToClient(tenantId, contact.id, exactMatch.id);
            // Atualizar referÃƒÂªncia local para uso em getOrCreateForContact
            contact = { ...contact, clientId: exactMatch.id };
          } else {
            this.logger.warn(`CNPJ ${cnpjDetectado} detectado mas nenhum cliente encontrado Ã¢â‚¬â€ salvando como pendente`);
            await this.customersService.storePendingCnpj(tenantId, contact.id, cnpjDetectado);
          }
        } catch (err) {
          this.logger.warn(`Erro na detecÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica de CNPJ: ${(err as Error).message}`);
          // NÃƒÂ£o bloquear o fluxo principal
        }
      }
    }

    // clientId: prioriza o identificado pelo chatbot (CNPJ), depois o jÃƒÂ¡ vinculado ao contato
    let resolvedClientId: string | null = chatbotClientId ?? null;
    if (!resolvedClientId) {
      const resolution = await this.customersService.resolveClientForSupportIdentifier(tenantId, wa);
      if (resolution.mode === 'single') {
        resolvedClientId = resolution.clientId;
      }
    }
    this.logWhatsappResolution({
      scope: 'conversation-resolution',
      direction: 'inbound',
      tenantId,
      rawPhone: msg.from,
      rawWhatsapp: msg.from,
      normalizedPhone: normalizedWhatsapp,
      clientId: resolvedClientId,
      lid: isLid ? rawFromDigits : null,
      contactId: contact.id,
      stage: 'before-conversation-resolution',
    });

    const { conversation, ticket, ticketCreated } = await this.conversationsService.getOrCreateForContact(
      tenantId,
      resolvedClientId,
      contact.id,
      ConversationChannel.WHATSAPP,
      {
        firstMessage: text,
        contactName: contact.name || contact.email || wa,
        department: resolvedDepartment,
        autoCreateTicket: true,
      },
    );
    this.logWhatsappResolution({
      scope: 'conversation-resolution',
      direction: 'inbound',
      tenantId,
      rawPhone: msg.from,
      rawWhatsapp: msg.from,
      normalizedPhone: normalizedWhatsapp,
      clientId: resolvedClientId,
      lid: isLid ? rawFromDigits : null,
      contactId: contact.id,
      conversationId: conversation.id,
      action: ticketCreated ? 'create' : 'reuse',
      stage: 'after-conversation-resolution',
    });

    await this.conversationsService.addMessage(
      tenantId,
      conversation.id,
      contact.id,
      contact.name || contact.email || wa,
      'contact',
      text,
    );

    // Se o cliente foi identificado via CNPJ, marca o ticket como validado automaticamente
    if (chatbotClientId && ticket) {
      try {
        await this.ticketsService.markCustomerSelectedByCnpj(tenantId, ticket.id, chatbotClientId);
        this.logger.log(`Ticket ${ticket.id} marcado como validado via CNPJ (cliente ${chatbotClientId})`);
      } catch (e) {
        this.logger.warn(`Falha ao marcar ticket ${ticket.id} como validado via CNPJ`, e);
      }
    }

    // A atribuiÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica jÃƒÂ¡ ÃƒÂ© feita via round-robin em TicketsService.create()
    // (assignmentSvc.assignTicket). NÃƒÂ£o duplicar aqui com least-loaded.

    // Envia mensagem automÃƒÂ¡tica ao cliente somente quando um novo ticket foi criado
    if (ticketCreated && ticket) {
      this.sendPostTicketMessage(tenantId, wa, contact, ticket).catch((e) =>
        this.logger.warn(`Falha ao enviar mensagem pÃƒÂ³s-ticket #${ticket.ticketNumber}`, e),
      );
    }

    return { created: true, ticketId: ticket?.id ?? null, conversationId: conversation.id };
  }

  /**
   * Monta e envia a mensagem automÃƒÂ¡tica ao cliente logo apÃƒÂ³s a criaÃƒÂ§ÃƒÂ£o do ticket.
   * Usa o template configurado em ChatbotConfig, com fallback para o texto padrÃƒÂ£o.
   * VersÃƒÂ£o com agente: {contato}, {empresa_atendente}, {agente}, {numero_ticket}
   * VersÃƒÂ£o sem agente: {contato}, {empresa_atendente}, {numero_ticket}
   */
  private async sendPostTicketMessage(
    tenantId: string,
    wa: string,
    contact: { name?: string | null; email?: string | null },
    ticket: { ticketNumber: string; assignedTo?: string | null },
  ): Promise<void> {
    // 1. Busca o nome fantasia da empresa atendente (tenant_settings)
    const settingsRows = await this.dataSource.query<{ companyName: string | null }[]>(
      `SELECT "companyName" FROM tenant_settings WHERE tenant_id::text = $1 LIMIT 1`,
      [tenantId],
    ).catch(() => []);
    const companyName = settingsRows[0]?.companyName || 'nosso suporte';

    // 2. Busca o nome do agente atribuÃƒÂ­do (se houver)
    let agentName: string | null = null;
    if (ticket.assignedTo) {
      const agentRows = await this.dataSource.query<{ name: string }[]>(
        `SELECT name FROM users WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
        [ticket.assignedTo, tenantId],
      ).catch(() => []);
      agentName = agentRows[0]?.name ?? null;
    }

    // 3. Busca o template configurado no chatbot (ou usa padrÃƒÂ£o)
    const DEFAULT_WITH_AGENT =
      'OlÃƒÂ¡, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nMeu nome ÃƒÂ© {agente} e estarei ÃƒÂ  disposiÃƒÂ§ÃƒÂ£o para ajudar.\n\nÃ°Å¸â€œÅ’ O nÃƒÂºmero do seu ticket ÃƒÂ© #{numero_ticket}.\n\nComo posso te auxiliar?';
    const DEFAULT_NO_AGENT =
      'OlÃƒÂ¡, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\nÃ°Å¸â€œÅ’ O nÃƒÂºmero do seu ticket ÃƒÂ© #{numero_ticket}.\n\nEm instantes um atendente darÃƒÂ¡ continuidade.';

    const config = this.chatbotService
      ? await this.chatbotService.getOrCreateConfig(tenantId).catch(() => null)
      : null;

    const template = agentName
      ? (config?.postTicketMessage || DEFAULT_WITH_AGENT)
      : (config?.postTicketMessageNoAgent || DEFAULT_NO_AGENT);

    // 4. Interpola as variÃƒÂ¡veis
    const contactName = contact.name || contact.email || 'cliente';
    const message = template
      .replace(/{contato}/g, contactName)
      .replace(/{empresa_atendente}/g, companyName)
      .replace(/{agente}/g, agentName ?? '')
      .replace(/{numero_ticket}/g, ticket.ticketNumber.replace(/^#/, ''));

    // 5. Envia via Baileys ou Meta (mesma lÃƒÂ³gica de sendReplyFromTicket)
    if (this.baileysService) {
      const result = await this.baileysService.sendMessage(tenantId, wa, message).catch(() => ({ success: false }));
      if (result.success) return;
      this.logger.warn(`[postTicketMessage] Baileys falhou, tentando Meta API`);
    }
    await this.sendWhatsappMessage(wa, message);
  }

  /**
   * Envia resposta via WhatsApp a partir de um ticket do painel.
   * O ticket deve ter origin=whatsapp e contactId com contato que possui whatsapp.
   */
  async sendReplyFromTicket(
    tenantId: string,
    ticketId: string,
    authorId: string,
    authorName: string,
    text: string,
  ) {
    const ticket = await this.ticketsService.findOne(tenantId, ticketId);
    if (ticket.origin !== TicketOrigin.WHATSAPP) {
      throw new BadRequestException('Este ticket nÃƒÂ£o ÃƒÂ© originado via WhatsApp');
    }
    if (!ticket.contactId) {
      throw new BadRequestException('Ticket sem contato associado');
    }

    const contact = await this.customersService.findContactById(tenantId, ticket.contactId);
    if (!contact?.whatsapp && !contact?.metadata?.whatsappLid) {
      throw new BadRequestException('Contato nÃƒÂ£o possui nÃƒÂºmero WhatsApp cadastrado');
    }

    // Usa LID tÃƒÂ©cnico (metadata.whatsappLid) se disponÃƒÂ­vel; fallback para whatsapp
    const destination = this.resolveContactWhatsappTarget(contact);
    if (!destination.digits || destination.digits.length < 10) {
      throw new BadRequestException('NÃƒÂºmero WhatsApp do contato invÃƒÂ¡lido');
    }

    // Tenta Baileys (QR) primeiro; fallback Meta API
    let sent = false;
    let baileysMsgId: string | null = null;
    if (this.baileysService) {
      const result = await this.baileysService.sendMessage(tenantId, destination.raw, text);
      sent = result.success;
      baileysMsgId = result.messageId ?? null; // ID para rastreamento de ACK (delivered/read)
    }
    if (!sent) {
      await this.sendWhatsappMessage(destination.digits, text);
    }

    let savedMessage: any = null;
    if (ticket.conversationId) {
      try {
        // skipOutbound=true: mensagem jÃƒÂ¡ foi enviada acima via Baileys/Meta, nÃƒÂ£o reenviar.
        // initialWhatsappStatus + initialExternalId: permite rastrear ACK (delivered/read)
        // sem reload Ã¢â‚¬â€ o externalId ÃƒÂ© o ID do Baileys, usado no messages.update callback.
        savedMessage = await this.conversationsService.addMessage(
          tenantId, ticket.conversationId, authorId, authorName, 'user', text,
          { skipOutbound: true, initialWhatsappStatus: 'sent', initialExternalId: baileysMsgId },
        );
      } catch {
        // Conversation may already be closed; WhatsApp message was still delivered
      }
    }

    // Retorna a mensagem salva para o frontend substituir o otimista sem flash
    return { success: true, message: savedMessage };
  }

  /**
   * Inicia uma conversa WhatsApp outbound completa:
   * 1. Normaliza e valida o nÃƒÂºmero
   * 2. Cria ou localiza o contato
   * 3. Cria ou localiza a conversa (sem ticket Ã¢â‚¬â€ o atendente vincula/cria depois)
   * 4. Envia a primeira mensagem (opcional)
   * 5. Retorna logs detalhados de cada etapa
   */
  async startOutboundConversation(
    tenantId: string,
    authorId: string,
    authorName: string,
    dto: {
      phone?: string;
      contactId?: string;
      clientId?: string;
      subject?: string;
      firstMessage?: string;
    },
  ): Promise<{
    conversation: any;
    contact: any;
    ticket: any | null;
    whatsappJid: string | null;
    numberExists: boolean;
    firstMessageSent: boolean;
    logs: string[];
  }> {
    const logs: string[] = [];
    const log = (msg: string) => { this.logger.log(msg); logs.push(msg); };
    const logStructured = (payload: Record<string, unknown>) => this.logWhatsappResolution(payload);

    log(`[OUTBOUND-FLOW] InÃƒÂ­cio Ã¢â‚¬â€ tenantId=${tenantId} authorId=${authorId} phone=${dto.phone ?? 'N/A'} contactId=${dto.contactId ?? 'N/A'}`);

    // Ã¢â€â‚¬Ã¢â€â‚¬ 1. Encontrar ou criar contato Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let contact: any;
    let outboundContactAction: 'reuse' | 'create' = 'reuse';
    if (dto.contactId) {
      contact = await this.customersService.findContactById(tenantId, dto.contactId);
      if (!contact) throw new BadRequestException('Contato nÃƒÂ£o encontrado');
      log(`[OUTBOUND-FLOW] Contato localizado por ID: ${contact.id} (${contact.name})`);
      logStructured({
        scope: 'contact-resolution',
        direction: 'outbound',
        tenantId,
        rawInput: dto.contactId,
        rawPhone: dto.phone ?? null,
        rawWhatsapp: dto.phone ?? null,
        normalizedWhatsapp: (normalizeWhatsappNumber(dto.phone ?? '') || dto.phone) ?? null,
        normalizedPhone: (normalizeWhatsappNumber(dto.phone ?? '') || dto.phone) ?? null,
        clientId: dto.clientId ?? contact.clientId ?? null,
        lid: (contact.metadata?.whatsappLid as string | undefined) ?? null,
        existingContactByWhatsapp: null,
        existingContactByPhone: null,
        existingContactByClientId: dto.clientId ? contact.id : null,
        existingContactByLid: contact.metadata?.whatsappLid ? contact.id : null,
        chosenContactId: contact.id,
        action: 'reuse',
        criterion: 'findContactById',
        stage: 'after-contact-resolution',
      });
    } else if (dto.phone) {
      const digits = dto.phone.replace(/\D/g, '');
      const normalizedPhone = normalizeWhatsappNumber(digits) || digits;
      const outboundTechnicalInput = dto.phone.includes('@') || normalizedPhone.length >= 14;
      const canonicalContact = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
        rawWhatsapp: dto.phone,
        normalizedWhatsapp: normalizedPhone,
        clientId: dto.clientId ?? null,
        direction: 'outbound',
      });
      logStructured({
        scope: 'contact-resolution',
        direction: 'outbound',
        tenantId,
        rawPhone: dto.phone,
        rawWhatsapp: dto.phone,
        normalizedPhone,
        clientId: dto.clientId ?? null,
        lid: null,
        stage: 'before-contact-resolution',
      });
      log(`[OUTBOUND-FLOW] NÃƒÂºmero recebido: "${dto.phone}" Ã¢â€ â€™ dÃƒÂ­gitos: ${digits}`);
      contact = canonicalContact.contact;
      if (!contact && outboundTechnicalInput) {
        logStructured({
          scope: 'whatsapp-identity-guard',
          direction: 'outbound',
          tenantId,
          attemptedValue: dto.phone,
          normalizedPhone,
          reason: 'technical-identifier-blocked-outbound',
        });
        logStructured({
          scope: 'contact-create',
          source: 'outbound',
          whatsapp: normalizedPhone,
          isTechnical: true,
          allowed: false,
          stage: 'blocked-before-findOrCreateByWhatsapp',
        });
        throw new BadRequestException('Nao foi possivel iniciar o outbound com identificador tecnico do WhatsApp');
      }
      if (contact) {
        log(`[OUTBOUND-FLOW] Contato localizado pelo WhatsApp ${digits}: ${contact.id} (${contact.name})`);
      } else {
        log(`[OUTBOUND-FLOW] Contato nÃƒÂ£o encontrado para ${digits}, criando...`);
        contact = await this.customersService.findOrCreateByWhatsapp(tenantId, digits, undefined, false, {
          direction: 'outbound',
          clientId: dto.clientId ?? null,
          rawInput: dto.phone,
        });
        if (!contact) throw new BadRequestException('NÃƒÂ£o foi possÃƒÂ­vel criar o contato para este nÃƒÂºmero');
        outboundContactAction = 'create';
        log(`[OUTBOUND-FLOW] Contato criado: ${contact.id}`);
      }
      logStructured({
        scope: 'contact-resolution',
        direction: 'outbound',
        tenantId,
        rawInput: dto.phone,
        rawPhone: dto.phone,
        rawWhatsapp: dto.phone,
        normalizedWhatsapp: normalizedPhone,
        normalizedPhone,
        clientId: dto.clientId ?? contact.clientId ?? null,
        lid: (contact.metadata?.whatsappLid as string | undefined) ?? null,
        existingContactByWhatsapp: canonicalContact.matchedBy === 'whatsapp' || canonicalContact.matchedBy === 'whatsapp+lid'
          ? (canonicalContact.candidates[0] ?? null)
          : null,
        existingContactByPhone: canonicalContact.matchedBy === 'whatsapp' || canonicalContact.matchedBy === 'whatsapp+lid'
          ? (canonicalContact.candidates[0] ?? null)
          : null,
        existingContactByClientId: dto.clientId && contact.clientId && String(contact.clientId) === String(dto.clientId)
          ? contact.id
          : null,
        existingContactByLid: canonicalContact.matchedBy === 'lid' || canonicalContact.matchedBy === 'whatsapp+lid'
          ? (canonicalContact.candidates[canonicalContact.candidates.length - 1] ?? null)
          : null,
        chosenContactId: contact.id,
        action: outboundContactAction,
        criterion: outboundContactAction === 'create' ? 'findOrCreateByWhatsapp' : 'resolveCanonicalWhatsappContact',
        stage: 'after-contact-resolution',
        matchedBy: canonicalContact.matchedBy,
        candidates: canonicalContact.candidates,
        canonicalReason: canonicalContact.canonicalReason,
      });
    } else {
      throw new BadRequestException('phone ou contactId ÃƒÂ© obrigatÃƒÂ³rio');
    }

    // Usa LID tÃƒÂ©cnico (metadata.whatsappLid) se disponÃƒÂ­vel; fallback para whatsapp ou phone
    const { raw: whatsapp } = this.resolveContactWhatsappTarget(contact, dto.phone?.replace(/\D/g, ''));
    if (!whatsapp) throw new BadRequestException('Contato sem nÃƒÂºmero WhatsApp cadastrado');
    log(`[OUTBOUND-FLOW] WhatsApp do contato: ${whatsapp}`);

    // Ã¢â€â‚¬Ã¢â€â‚¬ 2. Validar nÃƒÂºmero no WhatsApp Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let resolvedJid: string | null = null;
    let numberExists = false;
    if (this.baileysService) {
      const check = await this.baileysService.checkNumberExists(tenantId, whatsapp);
      log(`[OUTBOUND-FLOW] ValidaÃƒÂ§ÃƒÂ£o WhatsApp: exists=${check.exists} jid=${check.jid ?? 'N/A'} normalized=${check.normalized} candidatos=${check.candidates.join(', ')}`);
      numberExists = check.exists;
      resolvedJid = check.jid;
      if (check.exists) {
        const resolvedDigits = normalizeWhatsappNumber(
          check.normalized || check.jid?.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '') || '',
        ) || null;
        const resolvedLid = check.jid?.endsWith('@lid')
          ? (normalizeWhatsappNumber(check.jid.replace(/@lid$/i, '')) || check.jid.replace(/@lid$/i, ''))
          : null;
        await this.customersService.persistWhatsappRuntimeIdentifiers(
          tenantId,
          contact.id,
          {
            whatsappJid: check.jid ?? null,
            whatsappLid: resolvedLid,
            whatsappResolvedDigits: resolvedDigits,
          },
          {
            direction: 'outbound',
            clientId: dto.clientId ?? contact.clientId ?? null,
            rawInput: dto.phone ?? contact.id,
          },
        ).catch(() => {});
        contact.metadata = {
          ...(contact.metadata ?? {}),
          ...(check.jid ? { whatsappJid: check.jid } : {}),
          ...(resolvedLid ? { whatsappLid: resolvedLid } : {}),
          ...(resolvedDigits ? { whatsappResolvedDigits: resolvedDigits } : {}),
        };
        logStructured({
          scope: 'canonical-contact-resolution',
          tenantId,
          normalizedWhatsapp: normalizeWhatsappNumber(whatsapp) || whatsapp,
          lid: resolvedLid,
          clientId: dto.clientId ?? contact.clientId ?? null,
          candidates: [contact.id],
          matchedBy: resolvedLid && resolvedDigits ? 'whatsapp+lid' : resolvedLid ? 'lid' : 'whatsapp',
          canonicalReason: 'outbound-learned-runtime-identifiers',
          chosenContactId: contact.id,
          whatsappJid: check.jid ?? null,
          whatsappResolvedDigits: resolvedDigits,
        });
        if (resolvedLid) {
          log(`[OUTBOUND-FLOW] LID persistido no contato: ${resolvedLid}`);
        }
      }
      if (!check.exists) {
        log(`[OUTBOUND-FLOW] AVISO: NÃƒÂºmero "${whatsapp}" nÃƒÂ£o foi encontrado no WhatsApp Ã¢â‚¬â€ envio pode falhar`);
      }
    } else {
      log(`[OUTBOUND-FLOW] Baileys nÃƒÂ£o disponÃƒÂ­vel, pulando validaÃƒÂ§ÃƒÂ£o de nÃƒÂºmero`);
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ 3. Usar instÃƒÂ¢ncia conectada (tenantId ÃƒÂ© a sessÃƒÂ£o) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    log(`[OUTBOUND-FLOW] InstÃƒÂ¢ncia Baileys: tenantId=${tenantId} (sessÃƒÂ£o ativa=${!!this.baileysService})`);

    // Ã¢â€â‚¬Ã¢â€â‚¬ 4. Criar ou localizar conversa Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const clientId = dto.clientId || contact.clientId || null;
    log(`[OUTBOUND-FLOW] clientId=${clientId ?? 'N/A'} contactId=${contact.id}`);
    logStructured({
      scope: 'conversation-resolution',
      direction: 'outbound',
      tenantId,
      rawInput: dto.contactId ?? dto.phone ?? null,
      rawPhone: dto.phone ?? null,
      rawWhatsapp: whatsapp,
      normalizedWhatsapp: normalizeWhatsappNumber(whatsapp) || whatsapp,
      normalizedPhone: normalizeWhatsappNumber(whatsapp) || whatsapp,
      clientId,
      lid: (contact.metadata?.whatsappLid as string | undefined) ?? null,
      contactId: contact.id,
      stage: 'before-conversation-resolution',
    });

    const conversation = await this.conversationsService.startAgentConversation(
      tenantId, clientId, contact.id, ConversationChannel.WHATSAPP,
    );
    log(`[OUTBOUND-FLOW] Conversa: id=${conversation.id} status=${conversation.status} ticketId=${conversation.ticketId ?? 'N/A'} nova=${!conversation.ticketId}`);
    logStructured({
      scope: 'conversation-resolution',
      direction: 'outbound',
      tenantId,
      rawInput: dto.contactId ?? dto.phone ?? null,
      rawPhone: dto.phone ?? null,
      rawWhatsapp: whatsapp,
      normalizedWhatsapp: normalizeWhatsappNumber(whatsapp) || whatsapp,
      normalizedPhone: normalizeWhatsappNumber(whatsapp) || whatsapp,
      clientId,
      lid: (contact.metadata?.whatsappLid as string | undefined) ?? null,
      contactId: contact.id,
      conversationId: conversation.id,
      stage: 'after-conversation-resolution',
    });

    // Ticket NÃƒÆ’O ÃƒÂ© criado automaticamente Ã¢â‚¬â€ o atendente deve vincular ou criar apÃƒÂ³s iniciar a conversa
    const ticket: any = null;
    log(`[OUTBOUND-FLOW] Conversa criada sem ticket Ã¢â‚¬â€ atendente vincularÃƒÂ¡ manualmente`);

    // Ã¢â€â‚¬Ã¢â€â‚¬ 5. Enviar primeira mensagem Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let firstMessageSent = false;
    if (dto.firstMessage?.trim()) {
      log(`[OUTBOUND-FLOW] Enviando primeira mensagem: "${dto.firstMessage.trim().slice(0, 50)}..."`);
      try {
        await this.conversationsService.addMessage(
          tenantId, conversation.id, authorId, authorName, 'user', dto.firstMessage.trim(),
        );
        firstMessageSent = true;
        log(`[OUTBOUND-FLOW] Primeira mensagem enviada com sucesso`);
      } catch (e: any) {
        log(`[OUTBOUND-FLOW] Falha ao enviar primeira mensagem: ${e?.message}`);
      }
    } else {
      log(`[OUTBOUND-FLOW] Nenhuma mensagem inicial informada`);
    }

    log(`[OUTBOUND-FLOW] ConcluÃƒÂ­do Ã¢â‚¬â€ conversaId=${conversation.id} jid=${resolvedJid ?? 'N/A'} msgEnviada=${firstMessageSent}`);
    return { conversation, contact, ticket, whatsappJid: resolvedJid, numberExists, firstMessageSent, logs };
  }

  async getVerifyToken(tenantId: string): Promise<string> {
    // Future: look up per-tenant verify token from DB
    return process.env.WHATSAPP_VERIFY_TOKEN || 'suporte-whatsapp-verify';
  }

  /**
   * Resolve o destino tÃƒÂ©cnico correto para envio WhatsApp de um contato.
   * Prioridade: metadata.whatsappLid Ã¢â€ â€™ contact.whatsapp Ã¢â€ â€™ fallback
   * Retorna { raw } para Baileys e { digits } para Meta API.
   */
  private resolveContactWhatsappTarget(
    contact: any,
    fallback?: string,
  ): { raw: string; digits: string } {
    const raw: string =
      (contact?.metadata?.whatsappLid as string | undefined) ||
      (contact?.whatsapp as string | undefined) ||
      fallback ||
      '';
    const digits = raw.replace(/\D/g, '');
    return { raw, digits };
  }

  /**
   * Envio de mensagem via Meta (Graph API).
   * Requer as variÃƒÂ¡veis:
   * - WHATSAPP_PHONE_NUMBER_ID
   * - WHATSAPP_TOKEN
   */
  async sendWhatsappMessage(to: string, text: string) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn('WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_TOKEN nÃƒÂ£o configurados');
      return;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    };

    try {
      await firstValueFrom(
        this.http.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (err: any) {
      this.logger.error('Erro ao enviar mensagem WhatsApp', err?.response?.data || err?.message || err);
      throw err;
    }
  }
}

