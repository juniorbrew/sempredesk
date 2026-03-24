import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotConfig } from './entities/chatbot-config.entity';
import { ChatbotMenuItem } from './entities/chatbot-menu-item.entity';
import { ChatbotSession } from './entities/chatbot-session.entity';
import { ChatbotWidgetMessage } from './entities/chatbot-widget-message.entity';
import { ChatbotService } from './chatbot.service';
import { ChatbotController } from './chatbot.controller';
import { ChatbotScheduler } from './chatbot.scheduler';
import { CustomersModule } from '../customers/customers.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatbotConfig, ChatbotMenuItem, ChatbotSession, ChatbotWidgetMessage]),
    CustomersModule,
    ConversationsModule,
  ],
  providers: [ChatbotService, ChatbotScheduler],
  controllers: [ChatbotController],
  exports: [ChatbotService],
})
export class ChatbotModule {}
