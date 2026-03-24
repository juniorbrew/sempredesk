import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChatbotService } from './chatbot.service';

@Injectable()
export class ChatbotScheduler {
  private readonly logger = new Logger(ChatbotScheduler.name);

  constructor(private readonly chatbotService: ChatbotService) {}

  /** A cada minuto: auto-transfere sessões em awaiting_description com timeout >= 3 min */
  @Cron('* * * * *')
  async runDescriptionTimeout() {
    try {
      await this.chatbotService.runDescriptionTimeoutCron();
    } catch (e) {
      this.logger.warn('ChatbotScheduler error', e);
    }
  }
}
