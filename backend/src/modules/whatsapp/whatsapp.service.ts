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

export interface NormalizedWhatsappMessage {
  provider: 'generic' | 'meta';
  from: string;
  to?: string;
  text: string;
  messageId?: string;
  timestamp?: Date;
  senderName?: string;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

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

  private resolveContactWhatsappTarget(contact: any, fallback?: string): { raw: string; digits: string } {
    const technicalLid = String(contact?.metadata?.whatsappLid || '').trim();
    const storedWhatsapp = String(contact?.whatsapp || '').trim();
    const fallbackDigits = String(fallback || '').replace(/\D/g, '');
    const raw = technicalLid || storedWhatsapp || fallbackDigits;
    return { raw, digits: raw.replace(/\D/g, '') };
  }

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
    let wa = msg.from.replace(/\D/g, '');
    // Don't truncate LID-format numbers (from @lid JIDs) â€” keep full identifier
    // Only truncate if it looks like a real phone number (starts with country code)
    if (wa.length > 15) wa = wa.slice(-13);

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

    // Detecta se Ã© um identificador LID (nÃ£o Ã© nÃºmero de telefone real)
    // LIDs sÃ£o identificadores internos do WhatsApp â€” 14+ dÃ­gitos ou flag explÃ­cita do Baileys
    const isLid = (msg as any).isLid === true || wa.length >= 14;

    let contact = await this.customersService.findContactByWhatsapp(tenantId, wa);
    if (!contact) {
      // Cria apenas o contato (sem cliente temporÃ¡rio)
      this.logger.log(`Criando contato para WhatsApp desconhecido: ${wa} isLid=${isLid} (${msg.senderName || 'sem nome'})`);
      contact = await this.customersService.findOrCreateByWhatsapp(tenantId, wa, msg.senderName, isLid);
    }
    if (!contact) {
      return { created: false, reason: 'CONTACT_CREATE_FAILED' };
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

    // CNPJ auto-detection: sÃ³ executa se chatbot nÃ£o identificou cliente e contato nÃ£o tem cliente
    if (!chatbotClientId && !contact.clientId) {
      const cnpjDetectado = detectCnpjInText(text ?? '');
      if (cnpjDetectado) {
        this.logger.log(`CNPJ detectado em mensagem do contato ${contact.id}: ${cnpjDetectado}`);
        try {
          const matches = await this.customersService.searchByNameOrCnpj(tenantId, cnpjDetectado);
          const exactMatch = matches.find((m) => normalizeCnpj(m.cnpj ?? '') === cnpjDetectado);
          if (exactMatch) {
            this.logger.log(`Cliente ${exactMatch.id} encontrado via CNPJ ${cnpjDetectado} â€” vinculando contato ${contact.id}`);
            await this.customersService.linkContactToClient(tenantId, contact.id, exactMatch.id);
            // Atualizar referÃªncia local para uso em getOrCreateForContact
            contact = { ...contact, clientId: exactMatch.id };
          } else {
            this.logger.warn(`CNPJ ${cnpjDetectado} detectado mas nenhum cliente encontrado â€” salvando como pendente`);
            await this.customersService.storePendingCnpj(tenantId, contact.id, cnpjDetectado);
          }
        } catch (err) {
          this.logger.warn(`Erro na detecÃ§Ã£o automÃ¡tica de CNPJ: ${(err as Error).message}`);
          // NÃ£o bloquear o fluxo principal
        }
      }
    }

    // clientId: prioriza o identificado pelo chatbot (CNPJ), depois o jÃ¡ vinculado ao contato
    const resolvedClientId = chatbotClientId ?? contact.clientId ?? null;

    const { conversation, ticket, ticketCreated } = await this.conversationsService.getOrCreateForContact(
      tenantId,
      resolvedClientId,
      contact.id,
      ConversationChannel.WHATSAPP,
      {
        firstMessage: text,
        contactName: contact.name || contact.email || wa,
        department: resolvedDepartment,
      },
    );

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

    // A atribuiÃ§Ã£o automÃ¡tica jÃ¡ Ã© feita via round-robin em TicketsService.create()
    // (assignmentSvc.assignTicket). NÃ£o duplicar aqui com least-loaded.

    // Envia mensagem automÃ¡tica ao cliente somente quando um novo ticket foi criado
    if (ticketCreated && ticket) {
      this.sendPostTicketMessage(tenantId, wa, contact, ticket).catch((e) =>
        this.logger.warn(`Falha ao enviar mensagem pÃ³s-ticket #${ticket.ticketNumber}`, e),
      );
    }

    return { created: true, ticketId: ticket.id };
  }

  /**
   * Monta e envia a mensagem automÃ¡tica ao cliente logo apÃ³s a criaÃ§Ã£o do ticket.
   * Usa o template configurado em ChatbotConfig, com fallback para o texto padrÃ£o.
   * VersÃ£o com agente: {contato}, {empresa_atendente}, {agente}, {numero_ticket}
   * VersÃ£o sem agente: {contato}, {empresa_atendente}, {numero_ticket}
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

    // 2. Busca o nome do agente atribuÃ­do (se houver)
    let agentName: string | null = null;
    if (ticket.assignedTo) {
      const agentRows = await this.dataSource.query<{ name: string }[]>(
        `SELECT name FROM users WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
        [ticket.assignedTo, tenantId],
      ).catch(() => []);
      agentName = agentRows[0]?.name ?? null;
    }

    // 3. Busca o template configurado no chatbot (ou usa padrÃ£o)
    const DEFAULT_WITH_AGENT =
      'OlÃ¡, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nMeu nome Ã© {agente} e estarei Ã  disposiÃ§Ã£o para ajudar.\n\nðŸ“Œ O nÃºmero do seu ticket Ã© #{numero_ticket}.\n\nComo posso te auxiliar?';
    const DEFAULT_NO_AGENT =
      'OlÃ¡, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\nðŸ“Œ O nÃºmero do seu ticket Ã© #{numero_ticket}.\n\nEm instantes um atendente darÃ¡ continuidade.';

    const config = this.chatbotService
      ? await this.chatbotService.getOrCreateConfig(tenantId).catch(() => null)
      : null;

    const template = agentName
      ? (config?.postTicketMessage || DEFAULT_WITH_AGENT)
      : (config?.postTicketMessageNoAgent || DEFAULT_NO_AGENT);

    // 4. Interpola as variÃ¡veis
    const contactName = contact.name || contact.email || 'cliente';
    const message = template
      .replace(/{contato}/g, contactName)
      .replace(/{empresa_atendente}/g, companyName)
      .replace(/{agente}/g, agentName ?? '')
      .replace(/{numero_ticket}/g, ticket.ticketNumber.replace(/^#/, ''));

    // 5. Envia via Baileys ou Meta (mesma lÃ³gica de sendReplyFromTicket)
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
      throw new BadRequestException('Este ticket nÃ£o Ã© originado via WhatsApp');
    }
    if (!ticket.contactId) {
      throw new BadRequestException('Ticket sem contato associado');
    }

    const contact = await this.customersService.findContactById(tenantId, ticket.contactId);
    if (!contact?.whatsapp && !contact?.metadata?.whatsappLid) {
      throw new BadRequestException('Contato nÃ£o possui nÃºmero WhatsApp cadastrado');
    }

    // Usa LID tÃ©cnico (metadata.whatsappLid) se disponÃ­vel; fallback para whatsapp
    const destination = this.resolveContactWhatsappTarget(contact);
    if (!destination.digits || destination.digits.length < 10) {
      throw new BadRequestException('NÃºmero WhatsApp do contato invÃ¡lido');
    }

    // Tenta Baileys (QR) primeiro; fallback Meta API
    let sent = false;
    if (this.baileysService) {
      const result = await this.baileysService.sendMessage(tenantId, destination.raw, text);
      sent = result.success;
    }
    if (!sent) {
      await this.sendWhatsappMessage(destination.digits, text);
    }

    let savedMessage: any = null;
    if (ticket.conversationId) {
      try {
        // skipOutbound=true: mensagem jÃ¡ foi enviada acima via Baileys/Meta, nÃ£o reenviar.
        // initialWhatsappStatus: reflete o resultado real do envio para o frontend exibir
        // o Ã­cone correto via socket sem necessitar reload.
        savedMessage = await this.conversationsService.addMessage(
          tenantId, ticket.conversationId, authorId, authorName, 'user', text,
          // Se chegamos aqui sem exceÃ§Ã£o, o envio via Baileys ou Meta API foi bem-sucedido
          { skipOutbound: true, initialWhatsappStatus: 'sent' },
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
   * 1. Normaliza e valida o nÃºmero
   * 2. Cria ou localiza o contato
   * 3. Cria ou localiza a conversa
   * 4. Cria ticket vinculado
   * 5. Envia a primeira mensagem
   * 6. Retorna logs detalhados de cada etapa
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

    log(`[OUTBOUND-FLOW] InÃ­cio â€” tenantId=${tenantId} authorId=${authorId} phone=${dto.phone ?? 'N/A'} contactId=${dto.contactId ?? 'N/A'}`);

    // â”€â”€ 1. Encontrar ou criar contato â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let contact: any;
    if (dto.contactId) {
      contact = await this.customersService.findContactById(tenantId, dto.contactId);
      if (!contact) throw new BadRequestException('Contato nÃ£o encontrado');
      log(`[OUTBOUND-FLOW] Contato localizado por ID: ${contact.id} (${contact.name})`);
    } else if (dto.phone) {
      const digits = dto.phone.replace(/\D/g, '');
      log(`[OUTBOUND-FLOW] NÃºmero recebido: "${dto.phone}" â†’ dÃ­gitos: ${digits}`);
      contact = await this.customersService.findContactByWhatsapp(tenantId, digits);
      if (contact) {
        log(`[OUTBOUND-FLOW] Contato localizado pelo WhatsApp ${digits}: ${contact.id} (${contact.name})`);
      } else {
        log(`[OUTBOUND-FLOW] Contato nÃ£o encontrado para ${digits}, criando...`);
        contact = await this.customersService.findOrCreateByWhatsapp(tenantId, digits, undefined, false);
        if (!contact) throw new BadRequestException('NÃ£o foi possÃ­vel criar o contato para este nÃºmero');
        log(`[OUTBOUND-FLOW] Contato criado: ${contact.id}`);
      }
    } else {
      throw new BadRequestException('phone ou contactId Ã© obrigatÃ³rio');
    }

    // Usa LID tÃ©cnico (metadata.whatsappLid) se disponÃ­vel; fallback para whatsapp ou phone
    const { raw: whatsapp } = this.resolveContactWhatsappTarget(contact, dto.phone?.replace(/\D/g, ''));
    if (!whatsapp) throw new BadRequestException('Contato sem nÃºmero WhatsApp cadastrado');
    log(`[OUTBOUND-FLOW] WhatsApp do contato: ${whatsapp}`);

    // â”€â”€ 2. Validar nÃºmero no WhatsApp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let resolvedJid: string | null = null;
    let numberExists = false;
    if (this.baileysService) {
      const check = await this.baileysService.checkNumberExists(tenantId, whatsapp);
      log(`[OUTBOUND-FLOW] ValidaÃ§Ã£o WhatsApp: exists=${check.exists} jid=${check.jid ?? 'N/A'} normalized=${check.normalized} candidatos=${check.candidates.join(', ')}`);
      numberExists = check.exists;
      resolvedJid = check.jid;
      if (!check.exists) {
        log(`[OUTBOUND-FLOW] AVISO: NÃºmero "${whatsapp}" nÃ£o foi encontrado no WhatsApp â€” envio pode falhar`);
      }
    } else {
      log(`[OUTBOUND-FLOW] Baileys nÃ£o disponÃ­vel, pulando validaÃ§Ã£o de nÃºmero`);
    }

    // â”€â”€ 3. Usar instÃ¢ncia conectada (tenantId Ã© a sessÃ£o) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    log(`[OUTBOUND-FLOW] InstÃ¢ncia Baileys: tenantId=${tenantId} (sessÃ£o ativa=${!!this.baileysService})`);

    // â”€â”€ 4. Criar ou localizar conversa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const clientId = dto.clientId || contact.clientId || null;
    log(`[OUTBOUND-FLOW] clientId=${clientId ?? 'N/A'} contactId=${contact.id}`);

    const conversation = await this.conversationsService.startAgentConversation(
      tenantId, clientId, contact.id, ConversationChannel.WHATSAPP,
    );
    log(`[OUTBOUND-FLOW] Conversa: id=${conversation.id} status=${conversation.status} ticketId=${conversation.ticketId ?? 'N/A'} nova=${!conversation.ticketId}`);

    // â”€â”€ 5. Criar ticket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ticket: any = null;
    if (!conversation.ticketId) {
      try {
        const result = await this.conversationsService.createTicketForConversationById(
          tenantId, conversation.id, authorId, authorName,
          { subject: dto.subject || `WhatsApp - ${contact.name || whatsapp}` },
        );
        ticket = result.ticket;
        log(`[OUTBOUND-FLOW] Ticket criado: ${ticket.id} #${ticket.ticketNumber}`);
      } catch (e: any) {
        log(`[OUTBOUND-FLOW] Falha ao criar ticket: ${e?.message}`);
      }
    } else {
      try {
        ticket = await this.ticketsService.findOne(tenantId, conversation.ticketId);
        log(`[OUTBOUND-FLOW] Ticket existente: ${ticket.id} #${ticket.ticketNumber}`);
      } catch {
        log(`[OUTBOUND-FLOW] Ticket ${conversation.ticketId} nÃ£o encontrado`);
      }
    }

    // â”€â”€ 6. Enviar primeira mensagem â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    log(`[OUTBOUND-FLOW] ConcluÃ­do â€” conversaId=${conversation.id} jid=${resolvedJid ?? 'N/A'} msgEnviada=${firstMessageSent}`);
    return { conversation, contact, ticket, whatsappJid: resolvedJid, numberExists, firstMessageSent, logs };
  }

  async getVerifyToken(tenantId: string): Promise<string> {
    // Future: look up per-tenant verify token from DB
    return process.env.WHATSAPP_VERIFY_TOKEN || 'suporte-whatsapp-verify';
  }

  /**
   * Envio de mensagem via Meta (Graph API).
   * Requer as variÃ¡veis:
   * - WHATSAPP_PHONE_NUMBER_ID
   * - WHATSAPP_TOKEN
   */
  async sendWhatsappMessage(to: string, text: string) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn('WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_TOKEN nÃ£o configurados');
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

