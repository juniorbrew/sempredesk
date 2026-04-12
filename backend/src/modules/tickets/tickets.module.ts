import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket, TicketMessage } from './entities/ticket.entity';
import { TicketReplyAttachment } from './entities/ticket-reply-attachment.entity';
import { TicketsService } from './tickets.service';
import { TicketSatisfactionService } from './ticket-satisfaction.service';
import { TicketsController } from './tickets.controller';
import { InboundEmailController } from './inbound-email.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CustomersModule } from '../customers/customers.module';
import { TicketSettingsModule } from '../ticket-settings/ticket-settings.module';
import { AlertsModule } from '../alerts/alerts.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailModule } from '../email/email.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RoutingRulesModule } from '../routing-rules/routing-rules.module';
import { TicketAssignmentModule } from '../ticket-assignment/ticket-assignment.module';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { RoutingRulesService } from '../routing-rules/routing-rules.service';
import { TicketAssignmentService } from '../ticket-assignment/ticket-assignment.service';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { SlaModule } from '../sla/sla.module';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketMessage, TicketReplyAttachment, TenantPriority]),
    PermissionsModule,
    ContractsModule,
    CustomersModule,
    TicketSettingsModule,
    AlertsModule,
    RealtimeModule,
    EmailModule,
    WebhooksModule,
    RoutingRulesModule,
    TicketAssignmentModule,
    SlaModule,
  ],
  providers: [TicketsService, TicketSatisfactionService, StorageQuotaGuard],
  controllers: [TicketsController, InboundEmailController],
  exports: [TicketsService, TicketSatisfactionService],
})
export class TicketsModule {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly emailService: EmailService,
    private readonly webhooksService: WebhooksService,
    private readonly routingService: RoutingRulesService,
    private readonly assignmentService: TicketAssignmentService,
  ) {}

  onModuleInit() {
    this.ticketsService.setEmailService(this.emailService);
    this.ticketsService.setWebhooksService(this.webhooksService);
    this.ticketsService.setRoutingService(this.routingService);
    this.ticketsService.setAssignmentService(this.assignmentService);
  }
}
