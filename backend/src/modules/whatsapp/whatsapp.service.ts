import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as FormData from 'form-data';
import { execFile } from 'child_process';
import { CustomersService } from '../customers/customers.service';
import { TicketsService } from '../tickets/tickets.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { BaileysService } from './baileys.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { TicketOrigin } from '../tickets/entities/ticket.entity';
import { ConversationChannel } from '../conversations/entities/conversation.entity';
import { detectCnpjInText, normalizeCnpj } from '../../common/utils/cnpj.utils';
import { normalizeWhatsappNumber, restoreBrNinthDigit } from '../../common/utils/phone.utils';

export interface NormalizedWhatsappMessage {
  provider: 'generic' | 'meta';
  from: string;
  to?: string;
  text: string;
  messageId?: string;
  timestamp?: Date;
  senderName?: string;
  resolvedDigits?: string | null;
  /** Mídia já gravada em disco (Baileys). */
  media?: { kind: 'image' | 'audio' | 'video'; storageKey: string; mime: string } | null;
  isLid?: boolean;
  /** stanzaId da mensagem citada (reply nativo WhatsApp → reply interno). */
  quotedStanzaId?: string | null;
  /** ID de mídia na Meta Graph API (precisa ser baixado antes de salvar). */
  metaMediaId?: string | null;
  metaMediaMime?: string | null;
  metaMediaType?: 'image' | 'audio' | 'video' | null;
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
      if (!msg) return null;

      const base = {
        provider: 'meta' as const,
        from: String(msg.from || ''),
        to: value?.metadata?.display_phone_number || value?.metadata?.phone_number_id,
        messageId: String(msg.id || ''),
        timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
        // context.id = wamid da mensagem que o contato citou (reply nativo WhatsApp)
        quotedStanzaId: (msg.context?.id as string | undefined) ?? null,
      };

      // Text / button / interactive
      if (msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title) {
        return {
          ...base,
          text: msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || '',
        };
      }

      // Audio / Image / Video — mídia Meta (media_id precisa ser baixado)
      if (msg.type === 'audio' || msg.type === 'image' || msg.type === 'video') {
        const mediaData = msg[msg.type as string] as { id?: string; mime_type?: string } | undefined;
        return {
          ...base,
          text: '',
          metaMediaId: mediaData?.id ?? null,
          metaMediaMime: mediaData?.mime_type ?? null,
          metaMediaType: msg.type as 'audio' | 'image' | 'video',
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  async handleIncomingMessage(tenantId: string, msg: NormalizedWhatsappMessage, department?: string, chatbotClientId?: string) {
    let wa = (msg.resolvedDigits || msg.from).replace(/\D/g, '');
    // BR: PN resolvido de @lid ou JID legado pode vir com 12 dígitos sem o 9 após o DDD.
    // restoreBrNinthDigit é no-op para LIDs longos e números já com 13 dígitos.
    wa = restoreBrNinthDigit(wa);
    // Don't truncate LID-format numbers (from @lid JIDs) — keep full identifier
    // Only truncate if it looks like a real phone number (starts with country code)

    const text = msg.text?.trim() ?? '';
    if (!text && !msg.media && !msg.metaMediaId) return { created: false, reason: 'EMPTY_MESSAGE' };

    // For Meta webhook messages, run chatbot here (Baileys runs it in whatsapp.module.ts)
    let resolvedDepartment = department;
    if (msg.provider === 'meta' && !department && this.chatbotService) {
      // Verifica se existe conversa humana ativa antes de acionar chatbot.
      // Se o agente iniciou a conversa, a resposta do contato não deve cair no chatbot.
      let skipChatbot = false;
      try {
        const rawFromDigits = msg.from.replace(/\D/g, '');
        const isLid = msg.isLid === true || rawFromDigits.length >= 14;
        const normalizedWhatsapp = normalizeWhatsappNumber(wa) || wa;
        const canonical = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
          rawWhatsapp: msg.from,
          normalizedWhatsapp,
          lid: isLid ? rawFromDigits : null,
          direction: 'inbound',
        });
        if (canonical.contact?.id) {
          const activeHumanConversation = await this.conversationsService.findActiveHumanWhatsappConversation(tenantId, canonical.contact.id);
          if (activeHumanConversation) {
            skipChatbot = true;
            this.logger.log(`Active human WhatsApp conversation found for ${msg.from}; skipping chatbot (Meta)`);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to evaluate active human conversation for ${msg.from} (Meta)`, err);
      }

      if (!skipChatbot && text) {
        try {
          const botResult = await this.chatbotService.processMessage(tenantId, msg.from, text, 'whatsapp', msg.senderName);
          if (botResult.handled) {
            // Send replies via Meta API
            for (const reply of botResult.replies) {
              this.sendWhatsappMessage(tenantId, msg.from, reply).catch(() => {});
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
    }

    // Detecta se é um identificador LID (não é número de telefone real)
    // LIDs são identificadores internos do WhatsApp — 14+ dígitos ou flag explícita do Baileys
    const rawFromDigits = msg.from.replace(/\D/g, '');
    const isLid = msg.isLid === true || (msg as any).isLid === true || rawFromDigits.length >= 14;
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
          let resolvedPhone = normalizeWhatsappNumber(msg.resolvedDigits as string) || msg.resolvedDigits!;
          resolvedPhone = restoreBrNinthDigit(resolvedPhone);
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
      // Cria apenas o contato (sem cliente temporário)
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

    // CNPJ auto-detection: só executa se chatbot não identificou cliente e contato não tem cliente
    if (!chatbotClientId && !contact.clientId && text) {
      const cnpjDetectado = detectCnpjInText(text);
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

    // clientId: prioriza o identificado pelo chatbot (CNPJ), depois o já vinculado ao contato,
    // e por último o resolvido pelo identificador WhatsApp (telefone/LID).
    let resolvedClientId: string | null = chatbotClientId ?? null;
    if (!resolvedClientId) {
      if (contact.clientId) {
        // Contato já vinculado a um cliente — usa directamente sem consulta adicional.
        resolvedClientId = contact.clientId;
      } else {
        const resolution = await this.customersService.resolveClientForSupportIdentifier(tenantId, wa);
        if (resolution.mode === 'single') {
          resolvedClientId = resolution.clientId;
          // Vincular o contato ao cliente identificado pelo identificador WhatsApp.
          // Evita que chamadas futuras (e criação do ticket) falhem por incompatibilidade
          // entre o contato resolvido por LID e o cliente resolvido pelo mesmo número.
          try {
            await this.customersService.linkContactToClient(tenantId, contact.id, resolvedClientId);
            contact = { ...contact, clientId: resolvedClientId };
            this.logger.log(
              `[whatsapp] Contato ${contact.id} vinculado automaticamente ao cliente ${resolvedClientId} via resolveIdentifier`,
            );
          } catch (e) {
            this.logger.warn(
              `[whatsapp] Falha ao vincular contato ${contact.id} ao cliente ${resolvedClientId}: ${(e as Error).message}`,
            );
            // Não bloquear — o ticket ainda pode ser criado com a correção defensiva
          }
        }
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

    // Baixa mídia Meta (audio/image/video) antes de criar a conversa/ticket
    let resolvedMedia = msg.media ?? null;
    if (!resolvedMedia && msg.metaMediaId && msg.metaMediaType) {
      try {
        const storageKey = await this.downloadMetaMedia(
          tenantId,
          msg.metaMediaId,
          msg.metaMediaType,
          msg.metaMediaMime ?? undefined,
          msg.messageId,
        );
        if (storageKey) {
          resolvedMedia = { kind: msg.metaMediaType, storageKey, mime: msg.metaMediaMime ?? '' };
        }
      } catch (e) {
        this.logger.warn(`[Meta media] Falha ao baixar mídia ${msg.metaMediaId}: ${(e as Error).message}`);
      }
    }

    const firstPreview =
      text ||
      (resolvedMedia?.kind === 'image'
        ? '[Imagem]'
        : resolvedMedia?.kind === 'audio'
          ? '[Áudio]'
          : resolvedMedia?.kind === 'video'
            ? '[Vídeo]'
            : '');
    const { conversation, ticket, ticketCreated } = await this.conversationsService.getOrCreateForContact(
      tenantId,
      resolvedClientId,
      contact.id,
      ConversationChannel.WHATSAPP,
      {
        firstMessage: firstPreview,
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

    // Resolve replyToId: se a mensagem WhatsApp citar outra, localiza pelo externalId
    let inboundReplyToId: string | null = null;
    if (msg.quotedStanzaId) {
      try {
        const rows: Array<{ id: string }> = await this.dataSource.query(
          `SELECT id FROM conversation_messages WHERE external_id = $1 AND tenant_id = $2 LIMIT 1`,
          [msg.quotedStanzaId, tenantId],
        );
        if (rows?.[0]?.id) inboundReplyToId = rows[0].id;
      } catch { /* lookup falhou — segue sem reply */ }
    }

    await this.conversationsService.addMessage(
      tenantId,
      conversation.id,
      contact.id,
      contact.name || contact.email || wa,
      'contact',
      text ||
        (resolvedMedia?.kind === 'image'
          ? '📷 Imagem'
          : resolvedMedia?.kind === 'audio'
            ? '🎤 Áudio'
            : resolvedMedia?.kind === 'video'
              ? '📹 Vídeo'
              : ''),
      {
        initialExternalId: msg.messageId?.trim() || null,
        mediaKind: resolvedMedia?.kind ?? null,
        mediaStorageKey: resolvedMedia?.storageKey ?? null,
        mediaMime: resolvedMedia?.mime ?? null,
        replyToId: inboundReplyToId,
      },
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

    return { created: true, ticketId: ticket?.id ?? null, conversationId: conversation.id };
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
    const companyName = settingsRows[0]?.companyName || 'nossa equipe';

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
      'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nMeu nome é {agente} e estarei à disposição para ajudar.\n\n📋 O número do seu ticket é #{numero_ticket}.\n\nComo posso te auxiliar?';
    const DEFAULT_NO_AGENT =
      'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\n📋 O número do seu ticket é #{numero_ticket}.\n\nEm instantes um atendente dará continuidade.';

    const config = this.chatbotService
      ? await this.chatbotService.getOrCreateConfig(tenantId).catch(() => null)
      : null;

    const fallbackWithAgent =
      'Ola, {contato}.\n\nBem-vindo(a) ao suporte de {empresa_atendente}.\n\nMeu nome e {agente} e estarei a disposicao para ajudar.\n\nO numero do seu ticket e #{numero_ticket}.\n\nComo posso te auxiliar?';
    const fallbackNoAgent =
      'Ola, {contato}.\n\nBem-vindo(a) ao suporte de {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\nO numero do seu ticket e #{numero_ticket}.\n\nEm instantes um atendente dara continuidade.';
    const template = this.normalizePostTicketTemplate(
      agentName
        ? (config?.postTicketMessage || DEFAULT_WITH_AGENT)
        : (config?.postTicketMessageNoAgent || DEFAULT_NO_AGENT),
      agentName ? fallbackWithAgent : fallbackNoAgent,
    );

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
    await this.sendWhatsappMessage(tenantId, wa, message);
  }

  private normalizePostTicketTemplate(template: string | null | undefined, fallback: string): string {
    const raw = String(template || '').trim();
    if (!raw) return fallback;

    const looksBrokenEncoding =
      raw.includes('OlÃ') ||
      raw.includes('Ãƒ') ||
      raw.includes('Ã°') ||
      raw.includes('â‚¬') ||
      raw.includes('ðŸ');

    return looksBrokenEncoding ? fallback : raw;
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
    let externalMsgId: string | null = null;
    if (this.baileysService) {
      const result = await this.baileysService.sendMessage(tenantId, destination.raw, text);
      sent = result.success;
      externalMsgId = result.messageId ?? null; // ID para rastreamento de ACK (delivered/read)
    }
    if (!sent) {
      const wamid = await this.sendWhatsappMessage(tenantId, destination.digits, text);
      if (wamid) { externalMsgId = wamid; sent = true; }
    }

    let savedMessage: any = null;
    if (ticket.conversationId) {
      try {
        // skipOutbound=true: mensagem já foi enviada acima via Baileys/Meta, não reenviar.
        // initialWhatsappStatus + initialExternalId: permite rastrear ACK (delivered/read)
        // sem reload — o externalId é o ID do Baileys, usado no messages.update callback.
        savedMessage = await this.conversationsService.addMessage(
          tenantId, ticket.conversationId, authorId, authorName, 'user', text,
          { skipOutbound: true, initialWhatsappStatus: 'sent', initialExternalId: externalMsgId },
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
      templateName?: string;
      templateLanguage?: string;
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

    log(`[OUTBOUND-FLOW] Início — tenantId=${tenantId} authorId=${authorId} phone=${dto.phone ?? 'N/A'} contactId=${dto.contactId ?? 'N/A'}`);

    // --- 1. Encontrar ou criar contato ---
    let contact: any;
    let outboundContactAction: 'reuse' | 'create' = 'reuse';
    if (dto.contactId) {
      contact = await this.customersService.findContactById(tenantId, dto.contactId);
      if (!contact) throw new BadRequestException('Contato não encontrado');
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
      let digits = dto.phone.replace(/\D/g, '');
      digits = restoreBrNinthDigit(digits);
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
      log(`[OUTBOUND-FLOW] Número recebido: "${dto.phone}" → dígitos: ${digits}`);
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
        log(`[OUTBOUND-FLOW] Contato não encontrado para ${digits}, criando...`);
        contact = await this.customersService.findOrCreateByWhatsapp(tenantId, digits, undefined, false, {
          direction: 'outbound',
          clientId: dto.clientId ?? null,
          rawInput: dto.phone,
        });
        if (!contact) throw new BadRequestException('Não foi possível criar o contato para este número');
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
      throw new BadRequestException('phone ou contactId é obrigatório');
    }

    // Usa LID técnico (metadata.whatsappLid) se disponível; fallback para whatsapp ou phone
    const { raw: whatsapp } = this.resolveContactWhatsappTarget(contact, dto.phone?.replace(/\D/g, ''));
    if (!whatsapp) throw new BadRequestException('Contato sem número WhatsApp cadastrado');
    log(`[OUTBOUND-FLOW] WhatsApp do contato: ${whatsapp}`);

    // --- 2. Validar número no WhatsApp ---
    let resolvedJid: string | null = null;
    let numberExists = false;
    if (this.baileysService) {
      const check = await this.baileysService.checkNumberExists(tenantId, whatsapp);
      log(`[OUTBOUND-FLOW] Validação WhatsApp: exists=${check.exists} jid=${check.jid ?? 'N/A'} normalized=${check.normalized} candidatos=${check.candidates.join(', ')}`);
      numberExists = check.exists;
      resolvedJid = check.jid;
      if (check.exists) {
        const resolvedDigitsRaw = normalizeWhatsappNumber(
          check.normalized || check.jid?.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '') || '',
        ) || null;
        const resolvedDigits = resolvedDigitsRaw ? restoreBrNinthDigit(resolvedDigitsRaw) : null;
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
        log(`[OUTBOUND-FLOW] AVISO: Número "${whatsapp}" não foi encontrado no WhatsApp — envio pode falhar`);
      }
    } else {
      log(`[OUTBOUND-FLOW] Baileys não disponível, pulando validação de número`);
    }

    // --- 3. Usar instância conectada (tenantId é a sessão) ---
    log(`[OUTBOUND-FLOW] Instância Baileys: tenantId=${tenantId} (sessão ativa=${!!this.baileysService})`);

    // --- 4. Criar ou localizar conversa ---
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

    // Ticket NÃO é criado automaticamente — o atendente deve vincular ou criar após iniciar a conversa
    const ticket: any = null;
    log(`[OUTBOUND-FLOW] Conversa criada sem ticket — atendente vinculará manualmente`);

    // --- 5. Enviar primeira mensagem ---
    let firstMessageSent = false;
    if (dto.templateName?.trim()) {
      const tmplName = dto.templateName.trim();
      const tmplLang = dto.templateLanguage?.trim() || 'en_US';
      log(`[OUTBOUND-FLOW] Enviando template "${tmplName}" (lang=${tmplLang})`);
      try {
        const { digits } = this.resolveContactWhatsappTarget(contact, dto.phone?.replace(/\D/g, ''));
        const wamid = await this.sendTemplateMessage(tenantId, digits, tmplName, tmplLang);
        await this.conversationsService.addMessage(
          tenantId, conversation.id, authorId, authorName, 'user',
          `[Template: ${tmplName}]`,
          { skipOutbound: true, initialExternalId: wamid ?? null, initialWhatsappStatus: 'sent' },
        ).catch(() => {});
        firstMessageSent = true;
        log(`[OUTBOUND-FLOW] Template enviado com sucesso wamid=${wamid}`);
      } catch (e: any) {
        log(`[OUTBOUND-FLOW] Falha ao enviar template: ${e?.message}`);
      }
    } else if (dto.firstMessage?.trim()) {
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
   * Baixa um arquivo de mídia da Meta Graph API e salva em disco.
   * Retorna a chave relativa ao CONVERSATION_MEDIA_DIR.
   */
  private async downloadMetaMedia(
    tenantId: string,
    mediaId: string,
    kind: 'image' | 'audio' | 'video',
    mime?: string,
    messageId?: string,
  ): Promise<string | null> {
    const metaConfig = this.baileysService
      ? await this.baileysService.getMetaConfig(tenantId).catch(() => null)
      : null;
    const token = metaConfig?.metaToken || process.env.WHATSAPP_TOKEN;
    if (!token) {
      this.logger.warn(`[Meta media] Token não configurado para tenant=${tenantId}`);
      return null;
    }

    // 1. Obter URL de download
    const metaUrl = `https://graph.facebook.com/v20.0/${mediaId}`;
    const metaResp = await firstValueFrom(
      this.http.get<{ url: string; mime_type?: string }>(metaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const downloadUrl = metaResp.data?.url;
    const resolvedMime = mime || metaResp.data?.mime_type || 'application/octet-stream';
    if (!downloadUrl) {
      this.logger.warn(`[Meta media] URL de download não retornada para mediaId=${mediaId}`);
      return null;
    }

    // 2. Baixar binário
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const makeRequest = (url: string, redirects = 0) => {
        if (redirects > 5) { reject(new Error('Too many redirects')); return; }
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            makeRequest(res.headers.location!, redirects + 1);
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject);
      };
      makeRequest(downloadUrl);
    });

    // 3. Salvar em disco (mesma estrutura do baileys.service.ts)
    const mediaDir = process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');
    const yyyyMM = new Date().toISOString().slice(0, 7);
    const dir = path.join(mediaDir, tenantId, yyyyMM);
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = this.extForMimeLocal(resolvedMime);
    const safeId = String(messageId || mediaId || 'msg').replace(/[^\w.-]/g, '_');
    const fname = `${safeId}.${ext}`;
    await fs.promises.writeFile(path.join(dir, fname), buffer);
    const storageKey = path.join(tenantId, yyyyMM, fname);
    this.logger.log(`[Meta media] Mídia ${kind} salva: ${storageKey} (${buffer.length} bytes)`);
    return storageKey;
  }

  private extForMimeLocal(mime?: string | null): string {
    const m = (mime || '').toLowerCase().split(';')[0].trim();
    if (m.startsWith('video/')) {
      if (m.includes('webm')) return 'webm';
      if (m.includes('mp4')) return 'mp4';
      return 'mp4';
    }
    if (m.startsWith('image/')) {
      if (m.includes('png')) return 'png';
      if (m.includes('gif')) return 'gif';
      if (m.includes('webp')) return 'webp';
      return 'jpg';
    }
    if (m.startsWith('audio/')) {
      if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
      if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
      if (m.includes('wav')) return 'wav';
      return 'ogg';
    }
    return 'bin';
  }

  /**
   * Envia mídia (áudio, imagem, vídeo) via Meta Cloud API.
   * Faz upload do arquivo para a Meta e depois envia como mensagem de mídia.
   * Retorna o wamid da mensagem ou null em caso de falha.
   */
  async sendMetaMedia(
    tenantId: string,
    to: string,
    kind: 'image' | 'audio' | 'video',
    filePath: string,
    opts?: { caption?: string; mime?: string; contextMessageId?: string | null },
  ): Promise<string | null> {
    const metaConfig = this.baileysService
      ? await this.baileysService.getMetaConfig(tenantId).catch(() => null)
      : null;
    const phoneNumberId = metaConfig?.metaPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = metaConfig?.metaToken || process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn(`[Meta media] Credenciais não configuradas para tenant=${tenantId}`);
      return null;
    }

    // Converte formatos não suportados pela Meta API
    let uploadPath = filePath;
    let uploadMime = opts?.mime || this.guessMimeFromPath(filePath, kind);
    let tempConverted: string | null = null;

    const webmAudio = kind === 'audio' && (uploadMime.includes('webm') || filePath.endsWith('.webm'));
    if (webmAudio) {
      tempConverted = filePath.replace(/\.\w+$/, '') + '_conv.ogg';
      try {
        await this.ffmpegConvert(filePath, tempConverted, ['-c:a', 'libopus', '-b:a', '48k', '-vn']);
        uploadPath = tempConverted;
        uploadMime = 'audio/ogg; codecs=opus';
        this.logger.log(`[Meta media] Convertido webm→ogg: ${tempConverted}`);
      } catch (e) {
        this.logger.warn(`[Meta media] ffmpeg falhou, tentando webm direto: ${(e as Error).message}`);
        tempConverted = null;
      }
    }

    // 1. Upload do arquivo para a Meta
    const fileBuffer = await fs.promises.readFile(uploadPath);
    const mime = uploadMime;
    const form = new FormData();
    form.append('file', fileBuffer, { filename: path.basename(uploadPath), contentType: mime });
    form.append('type', mime);
    form.append('messaging_product', 'whatsapp');

    const uploadUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/media`;
    let uploadedMediaId: string;
    try {
      const uploadResp = await firstValueFrom(
        this.http.post<{ id: string }>(uploadUrl, form, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...form.getHeaders(),
          },
        }),
      );
      uploadedMediaId = uploadResp.data?.id;
      if (!uploadedMediaId) throw new Error('Upload não retornou media id');
      this.logger.log(`[Meta media] Upload OK — mediaId=${uploadedMediaId} tipo=${kind}`);
    } catch (e: any) {
      this.logger.error(`[Meta media] Falha no upload de mídia`, e?.response?.data || e?.message);
      if (tempConverted) fs.promises.unlink(tempConverted).catch(() => {});
      return null;
    }

    if (tempConverted) fs.promises.unlink(tempConverted).catch(() => {});

    // 2. Enviar mensagem de mídia
    const mediaPayload: Record<string, unknown> = { id: uploadedMediaId };
    if (opts?.caption && kind !== 'audio') mediaPayload.caption = opts.caption;

    const msgPayload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: kind,
      [kind]: mediaPayload,
    };
    if (opts?.contextMessageId) msgPayload.context = { message_id: opts.contextMessageId };

    const msgUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    try {
      const msgResp = await firstValueFrom(
        this.http.post<{ messages: Array<{ id: string }> }>(msgUrl, msgPayload, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        }),
      );
      const wamid = msgResp.data?.messages?.[0]?.id ?? null;
      this.logger.log(`[Meta media] Mensagem ${kind} enviada para ${to} wamid=${wamid}`);
      return wamid;
    } catch (e: any) {
      this.logger.error(`[Meta media] Falha ao enviar mensagem de mídia`, e?.response?.data || e?.message);
      return null;
    }
  }

  private ffmpegConvert(input: string, output: string, extraArgs: string[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-i', input, ...extraArgs, output], (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });
  }

  private guessMimeFromPath(filePath: string, kind: 'image' | 'audio' | 'video'): string {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap: Record<string, string> = {
      ogg: 'audio/ogg; codecs=opus', opus: 'audio/ogg; codecs=opus', mp3: 'audio/mpeg',
      m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    };
    return mimeMap[ext] || (kind === 'audio' ? 'audio/ogg' : kind === 'image' ? 'image/jpeg' : 'video/mp4');
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
   * Processa atualização de status vinda do webhook Meta (delivered/read).
   * Atualiza o whatsappStatus da mensagem pelo wamid (externalId).
   */
  async handleMetaStatusUpdate(tenantId: string, wamid: string, status: string): Promise<void> {
    const normalized = status === 'delivered' ? 'delivered' : status === 'read' ? 'read' : status === 'failed' ? 'failed' : null;
    if (!normalized) return;
    await this.conversationsService.updateMessageStatusByExternalId(tenantId, wamid, normalized).catch(() => {});
  }

  /**
   * Envio de mensagem via Meta Cloud API (Graph API).
   * Credenciais lidas do banco (por tenant) com fallback em variáveis de ambiente.
   */
  async sendWhatsappMessage(tenantId: string, to: string, text: string, contextMessageId?: string | null) {
    const metaConfig = this.baileysService
      ? await this.baileysService.getMetaConfig(tenantId).catch(() => null)
      : null;

    const phoneNumberId =
      metaConfig?.metaPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token =
      metaConfig?.metaToken || process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn(
        `[Meta API] Credenciais não configuradas para tenant=${tenantId}. ` +
        `Configure via PUT /webhooks/whatsapp/config/meta`,
      );
      return null;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    };
    if (contextMessageId) {
      payload.context = { message_id: contextMessageId };
    }

    try {
      const response = await firstValueFrom(
        this.http.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      // Retorna o wamid para rastreamento de status (delivered/read)
      return (response.data?.messages?.[0]?.id as string) ?? null;
    } catch (err: any) {
      this.logger.error('Erro ao enviar mensagem WhatsApp', err?.response?.data || err?.message || err);
      throw err;
    }
  }

  /**
   * Envia template de mensagem via Meta Cloud API.
   * Obrigatório para iniciar conversa fora da janela de 24h (primeiro contato).
   */
  async sendTemplateMessage(
    tenantId: string,
    to: string,
    templateName: string,
    languageCode: string = 'en_US',
  ): Promise<string | null> {
    const metaConfig = this.baileysService
      ? await this.baileysService.getMetaConfig(tenantId).catch(() => null)
      : null;

    const phoneNumberId = metaConfig?.metaPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = metaConfig?.metaToken || process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !token) {
      this.logger.warn(`[Meta API] Credenciais não configuradas para tenant=${tenantId}.`);
      return null;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    };

    try {
      const response = await firstValueFrom(
        this.http.post(url, payload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }),
      );
      this.logger.log(`[Meta API] Template "${templateName}" enviado para ${to} wamid=${response.data?.messages?.[0]?.id}`);
      return (response.data?.messages?.[0]?.id as string) ?? null;
    } catch (err: any) {
      this.logger.error(`[Meta API] Erro ao enviar template "${templateName}"`, err?.response?.data || err?.message || err);
      throw err;
    }
  }
}

