import { Module, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { BaileysService } from './baileys.service';
import { WhatsappConnection } from './entities/whatsapp-connection.entity';
import { CustomersModule } from '../customers/customers.module';
import { CustomersService } from '../customers/customers.service';
import { TicketsModule } from '../tickets/tickets.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { ChatbotService } from '../chatbot/chatbot.service';
import { restoreBrNinthDigit } from '../../common/utils/phone.utils';

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([WhatsappConnection]),
    CustomersModule,
    TicketsModule,
    ConversationsModule,
    PermissionsModule,
    RealtimeModule,
    ChatbotModule,
  ],
  providers: [WhatsappService, BaileysService],
  controllers: [WhatsappController],
  exports: [WhatsappService, BaileysService],
})
export class WhatsappModule implements OnModuleInit {
  private readonly logger = new Logger(WhatsappModule.name);
  private readonly processedInboundMessageIds = new Map<string, number>();

  private logSkipChatbot(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  constructor(
    private readonly baileysService: BaileysService,
    private readonly whatsappService: WhatsappService,
    private readonly customersService: CustomersService,
    private readonly conversationsService: ConversationsService,
    @Optional() private readonly chatbotService: ChatbotService,
  ) {}

  async onModuleInit() {
    // Registra dispatcher de mensagens outbound (agente → contato via WhatsApp)
    this.conversationsService.setOutboundSender(async (tenantId: string, toWhatsapp: string, payload: string | {
      kind: 'image' | 'audio' | 'video';
      filePath: string;
      caption?: string;
      mime?: string;
    }) => {
      if (typeof payload !== 'string') {
        if (this.baileysService) {
          const result = await this.baileysService.sendMedia(
            tenantId,
            toWhatsapp,
            payload.kind,
            payload.filePath,
            { caption: payload.caption, mime: payload.mime },
          );
          if (result.success) return result;
        }
        this.logger.warn('[outboundSender] Mídia só é enviada via Baileys (sessão QR).');
        return { success: false, error: 'Mídia requer Baileys activo' };
      }
      const text = payload;
      if (this.baileysService) {
        const result = await this.baileysService.sendMessage(tenantId, toWhatsapp, text);
        if (result.success) return result;
        this.logger.warn(`[outboundSender] Baileys falhou (${result.error}), tentando Meta API`);
      }
      try {
        const digits = toWhatsapp.replace(/\D/g, '');
        await this.whatsappService.sendWhatsappMessage(digits, text);
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message };
      }
    });
    this.logger.log('Outbound WhatsApp sender registrado para conversas');

    // 1. Wire Baileys incoming messages → chatbot → WhatsApp message handler
    // Wire read receipts: agente abre conversa no dashboard → Baileys envia readMessages ao contato
    this.conversationsService.setMarkReadHandler(
      (tenantId, remoteJid, messageIds) => this.baileysService.markMessagesRead(tenantId, remoteJid, messageIds),
    );

    // Wire ACK status updates: Baileys → ConversationsService → socket → frontend
    this.baileysService.setStatusUpdateHandler(async (tenantId: string, externalId: string, status: string) => {
      try {
        await this.conversationsService.updateMessageStatusByExternalId(tenantId, externalId, status);
      } catch (err) {
        this.logger.warn(`[statusUpdateHandler] Falha ao atualizar status ${status} para externalId=${externalId}`, err);
      }
    });

    this.baileysService.setMessageHandler(async (
      tenantId: string,
      from: string,
      text: string,
      messageId: string,
      senderName?: string,
      isLid?: boolean,
      resolvedDigits?: string | null,
      media?: { kind: 'image' | 'audio' | 'video'; storageKey: string; mime: string } | null,
    ) => {
      try {
        const messageKey = `${tenantId}:${messageId}`;
        const now = Date.now();
        const seenAt = this.processedInboundMessageIds.get(messageKey);
        if (seenAt && now - seenAt < 10 * 60 * 1000) {
          this.logger.log(`Skipping duplicated inbound WhatsApp message ${messageId} from ${from}`);
          return;
        }
        this.processedInboundMessageIds.set(messageKey, now);
        for (const [key, timestamp] of this.processedInboundMessageIds.entries()) {
          if (now - timestamp > 10 * 60 * 1000) {
            this.processedInboundMessageIds.delete(key);
          }
        }

        let skipChatbot = false;
        const wa = restoreBrNinthDigit(String(from).replace(/\D/g, ''));
        const normalizedWhatsapp = wa;
        let foundContactIds: string[] = [];
        let canonicalContactId: string | null = null;
        let foundActiveConversationId: string | null = null;
        let foundActiveConversationClientId: string | null = null;
        try {
          const canonical = await this.customersService.resolveCanonicalWhatsappContact(tenantId, {
            rawWhatsapp: from,
            normalizedWhatsapp,
            lid: isLid ? wa : null,
            direction: 'inbound',
          });
          foundContactIds = canonical.candidates;
          canonicalContactId = canonical.contact?.id ?? null;
          if (canonical.contact?.id) {
            const activeHumanConversation = await this.conversationsService.findActiveHumanWhatsappConversation(tenantId, canonical.contact.id);
            if (activeHumanConversation) {
              skipChatbot = true;
              foundActiveConversationId = activeHumanConversation.id;
              foundActiveConversationClientId = activeHumanConversation.clientId ?? null;
              this.logger.log(`Active human WhatsApp conversation found for ${from}; skipping chatbot`);
            }
          }
        } catch (err) {
          this.logger.warn(`Failed to evaluate active human conversation for ${from}`, err);
        }
        this.logSkipChatbot({
          scope: 'skip-chatbot',
          tenantId,
          rawPhone: from,
          rawWhatsapp: from,
          normalizedPhone: normalizedWhatsapp,
          contactIds: foundContactIds,
          canonicalContactId,
          activeConversationId: foundActiveConversationId,
          skipChatbot,
        });

        // Run through chatbot first if available
        let transferDept: string | undefined;
        let transferClientId: string | undefined;
        if (this.chatbotService && !skipChatbot && String(text || '').trim()) {
          const botResult = await this.chatbotService.processMessage(tenantId, from, text, 'whatsapp', senderName);
          if (botResult.handled) {
            // Send bot replies back via Baileys
            for (const reply of botResult.replies) {
              try {
                await this.baileysService.sendMessage(tenantId, from, reply);
              } catch (err) {
                this.logger.warn(`Failed to send bot reply to ${from}`, err);
              }
            }
            // If bot is transferring to human → fall through to create ticket
            if (!botResult.transfer) {
              this.logger.log(`Chatbot handled message from ${from} (no transfer)`);
              return;
            }
            transferDept = botResult.transfer.department ?? undefined;
            transferClientId = botResult.transfer.clientId ?? undefined;
            this.logger.log(`Chatbot transferring ${from} to dept=${transferDept ?? 'any'} clientId=${transferClientId ?? 'none'}`);
          }
        }

        // Bot didn't handle (or is handing off) → normal ticket/conversation flow
        if (!transferClientId && foundActiveConversationClientId) {
          transferClientId = foundActiveConversationClientId;
        }
        const msg = { provider: 'generic' as const, from, text, messageId, senderName, isLid, resolvedDigits, media: media ?? undefined };
        const result = await this.whatsappService.handleIncomingMessage(tenantId, msg, transferDept, transferClientId);
        this.logger.log(`Baileys message processed: tenantId=${tenantId} from=${from} result=${JSON.stringify(result)}`);
      } catch (err) {
        this.logger.error(`Failed to handle Baileys message from ${from}`, err);
      }
    });
    this.logger.log('Baileys message handler registered (with chatbot)');

    // 2. Restore sessions that were connected before backend restart
    await this.baileysService.restoreActiveSessions();
  }
}
