import { TicketSettingsModule } from './modules/ticket-settings/ticket-settings.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { EmailModule } from './modules/email/email.module';
import { RoutingRulesModule } from './modules/routing-rules/routing-rules.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { TeamChatModule } from './modules/team-chat/team-chat.module';
import { InternalChatModule } from './modules/internal-chat/internal-chat.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { TicketAssignmentModule } from './modules/ticket-assignment/ticket-assignment.module';
import { ContactValidationModule } from './modules/contact-validation/contact-validation.module';
import { Module, MiddlewareConsumer, NestModule, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { TeamModule } from './modules/team/team.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { DevicesModule } from './modules/devices/devices.module';
import { NetworksModule } from './modules/networks/networks.module';
import { SettingsModule } from './modules/settings/settings.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { RedisModule } from './modules/redis/redis.module';
import { TenantMiddleware } from './common/middlewares/tenant.middleware';
import { RealtimeGateway } from './modules/realtime/realtime.gateway';
import { TicketAssignmentService } from './modules/ticket-assignment/ticket-assignment.service';
import { AttendanceService } from './modules/attendance/attendance.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host:     cfg.get('DB_HOST', 'localhost'),
        port:     cfg.get<number>('DB_PORT', 5432),
        username: cfg.get('DB_USER', 'suporte'),
        password: cfg.get('DB_PASSWORD', 'suporte123'),
        database: cfg.get('DB_NAME', 'suporte_tecnico'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: cfg.get('NODE_ENV') !== 'production',
        logging: false,
        ssl: cfg.get('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        extra: { max: 20 },
      }),
      inject: [ConfigService],
    }),

    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),

    HealthModule,
    PermissionsModule,
    AuthModule,
    TenantsModule,
    CustomersModule,
    ContractsModule,
    TicketsModule,
    TicketSettingsModule,
    TeamModule,
    KnowledgeModule,
    DevicesModule,
    AlertsModule,
    SettingsModule,
    AttendanceModule,
    MonitoringModule,
    NetworksModule,
    DashboardModule,
    WhatsappModule,
    ConversationsModule,
    RealtimeModule,
    EmailModule,
    RoutingRulesModule,
    WebhooksModule,
    ApiKeysModule,
    TeamChatModule,
    InternalChatModule,
    ChatbotModule,
    TicketAssignmentModule,
    ContactValidationModule,
  ],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(private readonly moduleRef: ModuleRef) {}

  /** Wira o TicketAssignmentService no RealtimeGateway (evita dependência circular) */
  onModuleInit() {
    try {
      const gateway = this.moduleRef.get(RealtimeGateway, { strict: false });
      const assignmentSvc = this.moduleRef.get(TicketAssignmentService, { strict: false });
      if (gateway && assignmentSvc) {
        gateway.setAssignmentService(assignmentSvc);
      }
      const attendanceSvc = this.moduleRef.get(AttendanceService, { strict: false });
      if (gateway && attendanceSvc) {
        gateway.setAttendanceService(attendanceSvc);
      }
    } catch { /* opcional — não quebra se não encontrar */ }

    // Wira o BaileysService no ChatbotService (evita dependência circular)
    try {
      const { ChatbotService } = require('./modules/chatbot/chatbot.service');
      const { BaileysService } = require('./modules/whatsapp/baileys.service');
      const chatbotSvc = this.moduleRef.get(ChatbotService, { strict: false });
      const baileysSvc = this.moduleRef.get(BaileysService, { strict: false });
      if (chatbotSvc && baileysSvc) chatbotSvc.setBaileysService(baileysSvc);
    } catch { /* opcional */ }

    // Wira o ChatbotService no ConversationsService (reset de sessão ao fechar atendimento)
    try {
      const { ChatbotService } = require('./modules/chatbot/chatbot.service');
      const { ConversationsService } = require('./modules/conversations/conversations.service');
      const chatbotSvc = this.moduleRef.get(ChatbotService, { strict: false });
      const convSvc = this.moduleRef.get(ConversationsService, { strict: false });
      if (chatbotSvc && convSvc) convSvc.setChatbotService(chatbotSvc);
    } catch { /* opcional */ }

    // Wira o TicketAssignmentService no TicketsService (distribuição automática round-robin)
    try {
      const { TicketsService } = require('./modules/tickets/tickets.service');
      const ticketsSvc = this.moduleRef.get(TicketsService, { strict: false });
      const assignmentSvc = this.moduleRef.get(TicketAssignmentService, { strict: false });
      if (ticketsSvc && assignmentSvc) ticketsSvc.setAssignmentService(assignmentSvc);
    } catch { /* opcional */ }
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
