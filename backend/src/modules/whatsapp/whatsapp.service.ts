import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CustomersService } from '../customers/customers.service';
import { TicketsService } from '../tickets/tickets.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';
import { BaileysService } from './baileys.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import { TicketOrigin } from '../tickets/entities/ticket.entity';
import { ConversationChannel } from '../conversations/entities/conversation.entity';

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

    let contact = await this.customersService.findContactByWhatsapp(tenantId, wa);
    if (!contact || !contact.client) {
      // Auto-create client + contact for unknown WhatsApp number
      this.logger.log(`Auto-creating client+contact for unknown WhatsApp: ${wa} (${msg.senderName || 'no name'})`);
      contact = await this.customersService.findOrCreateByWhatsapp(tenantId, wa, msg.senderName);
    }
    if (!contact || !contact.client) {
      return { created: false, reason: 'CONTACT_CREATE_FAILED' };
    }

    const { conversation, ticket } = await this.conversationsService.getOrCreateForContact(
      tenantId,
      contact.client.id,
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

    // Auto-link company detected by chatbot (CNPJ informed during bot conversation)
    if (ticket && chatbotClientId && !ticket.customerSelectedAt && !ticket.unlinkedContact) {
      try {
        await this.ticketsService.update(tenantId, ticket.id, 'system', 'Sistema', {
          clientId: chatbotClientId,
          customerSelectedAt: new Date() as any,
        } as any);
        this.logger.log(`Chatbot auto-linked ticket ${ticket.id} to client ${chatbotClientId}`);
      } catch (e) {
        this.logger.warn(`Failed to auto-link chatbot clientId to ticket ${ticket.id}`, e);
      }
    }

    // Auto-assign to least-loaded online agent when ticket has no assignee
    if (ticket && !ticket.assignedTo && this.presenceService) {
      try {
        const { statusMap } = await this.presenceService.getOnlineIdsAndStatus(tenantId);
        const onlineAgentIds = Object.entries(statusMap)
          .filter(([, status]) => status === 'online')
          .map(([id]) => id);
        if (onlineAgentIds.length > 0) {
          const assignedTo = await this.ticketsService.assignToLeastLoadedAgent(tenantId, ticket.id, onlineAgentIds);
          if (assignedTo) {
            this.logger.log(`WhatsApp ticket ${ticket.id} auto-assigned to agent ${assignedTo}`);
          }
        }
      } catch (e) {
        this.logger.warn('Failed to auto-assign WhatsApp ticket', e);
      }
    }

    return { created: true, ticketId: ticket.id };
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
    if (!contact?.whatsapp) {
      throw new BadRequestException('Contato não possui número WhatsApp cadastrado');
    }

    const rawWhatsapp = String(contact.whatsapp).trim();
    const digits = rawWhatsapp.replace(/\D/g, '');
    if (!digits || digits.length < 10) {
      throw new BadRequestException('Número WhatsApp do contato inválido');
    }

    // Try Baileys (QR-based) first; fall back to Meta API
    let sent = false;
    if (this.baileysService) {
      sent = await this.baileysService.sendMessage(tenantId, rawWhatsapp, text);
    }
    if (!sent) {
      await this.sendWhatsappMessage(digits, text);
    }

    if (ticket.conversationId) {
      try {
        await this.conversationsService.addMessage(tenantId, ticket.conversationId, authorId, authorName, 'user', text);
      } catch {
        // Conversation may already be closed; WhatsApp message was still delivered
      }
    }

    return { success: true };
  }

  async getVerifyToken(tenantId: string): Promise<string> {
    // Future: look up per-tenant verify token from DB
    return process.env.WHATSAPP_VERIFY_TOKEN || 'suporte-whatsapp-verify';
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

