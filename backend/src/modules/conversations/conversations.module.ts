import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { CustomersModule } from '../customers/customers.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { SlaModule } from '../sla/sla.module';
import { TicketSettingsModule } from '../ticket-settings/ticket-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationMessage]),
    TicketsModule,
    CustomersModule,
    RealtimeModule,
    PermissionsModule,
    SlaModule,
    TicketSettingsModule,
  ],
  providers: [ConversationsService, StorageQuotaGuard],
  controllers: [ConversationsController],
  exports: [ConversationsService],
})
export class ConversationsModule {}
