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
    // Don't truncate LID-format numbers (from @lid JIDs) — keep full identifier
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

    // Detecta se é um identificador LID (não é número de telefone real)
    // LIDs são identificadores internos do WhatsApp — 14+ dígitos ou flag explícita do Baileys
    const isLid = (msg as any).isLid === true || wa.length >= 14;

    let contact = await this.customersService.findContactByWhatsapp(tenantId, wa);
    if (!contact) {
      // Cria apenas o contato (sem cliente temporário)
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

    // CNPJ auto-detection: só executa se chatbot não identificou cliente e contato não tem cliente
    if (!chatbotClientId && !contact.clientId) {
      const cnpjDetectado = detectCnpjInText(text ?? '');
      if (cnpjDetectado) {
        this.logger.log(`CNPJ detectado em mensagem do contato ${contact.id}: ${cnpjDetectado}`);
        try {
          const matches = await this.customersService.searchByNameOrCnpj(tenantId, cnpjDetectado);
          const exactMatch = matches.find((m) => normalizeCnpj(m.cnpj ?? '') === cnpjDetectado);
          if (exactMatch) {
            this.logger.log(`Cliente ${exactMatch.id} encontrado via CNPJ ${cnpjDetectado} — vinculando contato ${contact.id}`);
            await this.customersService.linkContactToClient(tenantId, contact.id, exactMatch.id);
            // Atualizar referência local para uso em getOrCreateForContact
            contact = { ...contact, clientId: exactMatch.id };
          } else {
            this.logger.warn(`CNPJ ${cnpjDetectado} detectado mas nenhum cliente encontrado — salvando como pendente`);
            await this.customersService.storePendingCnpj(tenantId, contact.id, cnpjDetectado);
          }
        } catch (err) {
          this.logger.warn(`Erro na detecção automática de CNPJ: ${(err as Error).message}`);
          // Não bloquear o fluxo principal
        }
      }
    }

    // clientId: prioriza o identificado pelo chatbot (CNPJ), depois o já vinculado ao contato
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

    // A atribuição automática já é feita via round-robin em TicketsService.create()
    // (assignmentSvc.assignTicket). Não duplicar aqui com least-loaded.

    // Envia mensagem automática ao cliente somente quando um novo ticket foi criado
    if (ticketCreated && ticket) {
      this.sendPostTicketMessage(tenantId, wa, contact, ticket).catch((e) =>
        this.logger.warn(`Falha ao enviar mensagem pós-ticket #${ticket.ticketNumber}`, e),
      );
    }

    return { created: true, ticketId: ticket.id };
  }

  /**
   * Monta e envia a mensagem automática ao cliente logo após a criação do ticket.
   * Usa o template configurado em ChatbotConfig, com fallback para o texto padrão.
   * Versão com agente: {contato}, {empresa_atendente}, {agente}, {numero_ticket}
   * Versão sem agente: {contato}, {empresa_atendente}, {numero_ticket}
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

    // 2. Busca o nome do agente atribuído (se houver)
    let agentName: string | null = null;
    if (ticket.assignedTo) {
      const agentRows = await this.dataSource.query<{ name: string }[]>(
        `SELECT name FROM users WHERE id::text = $1 AND tenant_id::text = $2 LIMIT 1`,
        [ticket.assignedTo, tenantId],
      ).catch(() => []);
      agentName = agentRows[0]?.name ?? null;
    }

    // 3. Busca o template configurado no chatbot (ou usa padrão)
    const DEFAULT_WITH_AGENT =
      'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nMeu nome é {agente} e estarei à disposição para ajudar.\n\n📌 O número do seu ticket é #{numero_ticket}.\n\nComo posso te auxiliar?';
    const DEFAULT_NO_AGENT =
      'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\n📌 O número do seu ticket é #{numero_ticket}.\n\nEm instantes um atendente dará continuidade.';

    const config = this.chatbotService
      ? await this.chatbotService.getOrCreateConfig(tenantId).catch(() => null)
      : null;

    const template = agentName
      ? (config?.postTicketMessage || DEFAULT_WITH_AGENT)
      : (config?.postTicketMessageNoAgent || DEFAULT_NO_AGENT);

    // 4. Interpola as variáveis
    const contactName = contact.name || contact.email || 'cliente';
    const message = template
      .replace(/{contato}/g, contactName)
      .replace(/{empresa_atendente}/g, companyName)
      .replace(/{agente}/g, agentName ?? '')
      .replace(/{numero_ticket}/g, ticket.ticketNumber.replace(/^#/, ''));

    // 5. Envia via Baileys ou Meta (mesma lógica de sendReplyFromTicket)
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
      throw new BadRequestException('Este ticket não é originado via WhatsApp');
    }
    if (!ticket.contactId) {
      throw new BadRequestException('Ticket sem contato associado');
    }

    const contact = await this.customersService.findContactById(tenantId, ticket.contactId);
    if (!contact?.whatsapp && !contact?.metadata?.whatsappLid) {
      throw new BadRequestException('Contato não possui número WhatsApp cadastrado');
    }

    // Usa LID técnico (metadata.whatsappLid) se disponível; fallback para whatsapp
    const destination = this.resolveContactWhatsappTarget(contact);
    if (!destination.digits || destination.digits.length < 10) {
      throw new BadRequestException('Número WhatsApp do contato inválido');
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
        // skipOutbound=true: mensagem já foi enviada acima via Baileys/Meta, não reenviar.
        // initialWhatsappStatus + initialExternalId: permite rastrear ACK (delivered/read)
        // sem reload — o externalId é o ID do Baileys, usado no messages.update callback.
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
   * 1. Normaliza e valida o número
   * 2. Cria ou localiza o contato
   * 3. Cria ou localiza a conversa (sem ticket — o atendente vincula/cria depois)
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

    log(`[OUTBOUND-FLOW] Início — tenantId=${tenantId} authorId=${authorId} phone=${dto.phone ?? 'N/A'} contactId=${dto.contactId ?? 'N/A'}`);

    // ── 1. Encontrar ou criar contato ─────────────────────────────────
    let contact: any;
    if (dto.contactId) {
      contact = await this.customersService.findContactById(tenantId, dto.contactId);
      if (!contact) throw new BadRequestException('Contato não encontrado');
      log(`[OUTBOUND-FLOW] Contato localizado por ID: ${contact.id} (${contact.name})`);
    } else if (dto.phone) {
      const digits = dto.phone.replace(/\D/g, '');
      log(`[OUTBOUND-FLOW] Número recebido: "${dto.phone}" → dígitos: ${digits}`);
      contact = await this.customersService.findContactByWhatsapp(tenantId, digits);
      if (contact) {
        log(`[OUTBOUND-FLOW] Contato localizado pelo WhatsApp ${digits}: ${contact.id} (${contact.name})`);
      } else {
        log(`[OUTBOUND-FLOW] Contato não encontrado para ${digits}, criando...`);
        contact = await this.customersService.findOrCreateByWhatsapp(tenantId, digits, undefined, false);
        if (!contact) throw new BadRequestException('Não foi possível criar o contato para este número');
        log(`[OUTBOUND-FLOW] Contato criado: ${contact.id}`);
      }
    } else {
      throw new BadRequestException('phone ou contactId é obrigatório');
    }

    // Usa LID técnico (metadata.whatsappLid) se disponível; fallback para whatsapp ou phone
    const { raw: whatsapp } = this.resolveContactWhatsappTarget(contact, dto.phone?.replace(/\D/g, ''));
    if (!whatsapp) throw new BadRequestException('Contato sem número WhatsApp cadastrado');
    log(`[OUTBOUND-FLOW] WhatsApp do contato: ${whatsapp}`);

    // ── 2. Validar número no WhatsApp ──────────────────────────────────
    let resolvedJid: string | null = null;
    let numberExists = false;
    if (this.baileysService) {
      const check = await this.baileysService.checkNumberExists(tenantId, whatsapp);
      log(`[OUTBOUND-FLOW] Validação WhatsApp: exists=${check.exists} jid=${check.jid ?? 'N/A'} normalized=${check.normalized} candidatos=${check.candidates.join(', ')}`);
      numberExists = check.exists;
      resolvedJid = check.jid;
      if (!check.exists) {
        log(`[OUTBOUND-FLOW] AVISO: Número "${whatsapp}" não foi encontrado no WhatsApp — envio pode falhar`);
      }
    } else {
      log(`[OUTBOUND-FLOW] Baileys não disponível, pulando validação de número`);
    }

    // ── 3. Usar instância conectada (tenantId é a sessão) ─────────────
    log(`[OUTBOUND-FLOW] Instância Baileys: tenantId=${tenantId} (sessão ativa=${!!this.baileysService})`);

    // ── 4. Criar ou localizar conversa ────────────────────────────────
    const clientId = dto.clientId || contact.clientId || null;
    log(`[OUTBOUND-FLOW] clientId=${clientId ?? 'N/A'} contactId=${contact.id}`);

    const conversation = await this.conversationsService.startAgentConversation(
      tenantId, clientId, contact.id, ConversationChannel.WHATSAPP,
    );
    log(`[OUTBOUND-FLOW] Conversa: id=${conversation.id} status=${conversation.status} ticketId=${conversation.ticketId ?? 'N/A'} nova=${!conversation.ticketId}`);

    // Ticket NÃO é criado automaticamente — o atendente deve vincular ou criar após iniciar a conversa
    const ticket: any = null;
    log(`[OUTBOUND-FLOW] Conversa criada sem ticket — atendente vinculará manualmente`);

    // ── 5. Enviar primeira mensagem ───────────────────────────────────
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

    log(`[OUTBOUND-FLOW] Concluído — conversaId=${conversation.id} jid=${resolvedJid ?? 'N/A'} msgEnviada=${firstMessageSent}`);
    return { conversation, contact, ticket, whatsappJid: resolvedJid, numberExists, firstMessageSent, logs };
  }

  async getVerifyToken(tenantId: string): Promise<string> {
    // Future: look up per-tenant verify token from DB
    return process.env.WHATSAPP_VERIFY_TOKEN || 'suporte-whatsapp-verify';
  }

  /**
   * Resolve o destino técnico correto para envio WhatsApp de um contato.
   * Prioridade: metadata.whatsappLid → contact.whatsapp → fallback
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
   * Requer as variáveis:
   * - WHATSAPP_PHONE_NUMBER_ID
   * - WHATSAPP_TOKEN
   */
  async sendWhatsappMessage(to: string, text: string) {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn('WHATSAPP_PHONE_NUMBER_ID ou WHATSAPP_TOKEN não configurados');
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

