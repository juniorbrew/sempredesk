import { Module, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { BaileysService } from './baileys.service';
import { WhatsappConnection } from './entities/whatsapp-connection.entity';
import { CustomersModule } from '../customers/customers.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationsService } from '../conversations/conversations.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatbotModule } from '../chatbot/chatbot.module';
import { ChatbotService } from '../chatbot/chatbot.service';

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

  constructor(
    private readonly baileysService: BaileysService,
    private readonly whatsappService: WhatsappService,
    private readonly conversationsService: ConversationsService,
    @Optional() private readonly chatbotService: ChatbotService,
  ) {}

  async onModuleInit() {
    // Registra dispatcher de mensagens outbound (agente → contato via WhatsApp)
    this.conversationsService.setOutboundSender(async (tenantId: string, toWhatsapp: string, text: string) => {
      if (this.baileysService) {
        const result = await this.baileysService.sendMessage(tenantId, toWhatsapp, text);
        if (result.success) return result;
        this.logger.warn(`[outboundSender] Baileys falhou (${result.error}), tentando Meta API`);
      }
      // Fallback Meta API
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
    // Wire ACK status updates: Baileys → ConversationsService → socket → frontend
    this.baileysService.setStatusUpdateHandler(async (tenantId: string, externalId: string, status: string) => {
      try {
        await this.conversationsService.updateMessageStatusByExternalId(tenantId, externalId, status);
      } catch (err) {
        this.logger.warn(`[statusUpdateHandler] Falha ao atualizar status ${status} para externalId=${externalId}`, err);
      }
    });

    this.baileysService.setMessageHandler(async (tenantId: string, from: string, text: string, messageId: string, senderName?: string, isLid?: boolean) => {
      try {
        // Run through chatbot first if available
        let transferDept: string | undefined;
        let transferClientId: string | undefined;
        if (this.chatbotService) {
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
        const msg = { provider: 'generic' as const, from, text, messageId, senderName, isLid };
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
