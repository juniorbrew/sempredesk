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
    @Optional() private readonly chatbotService: ChatbotService,
  ) {}

  async onModuleInit() {
    // 1. Wire Baileys incoming messages → chatbot → WhatsApp message handler
    this.baileysService.setMessageHandler(async (tenantId: string, from: string, text: string, messageId: string, senderName?: string) => {
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
        const msg = { provider: 'generic' as const, from, text, messageId, senderName };
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
