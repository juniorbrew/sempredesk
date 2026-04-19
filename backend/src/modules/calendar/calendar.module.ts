import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entidades
import { CalendarEvent }               from './entities/calendar-event.entity';
import { CalendarEventParticipant }    from './entities/calendar-event-participant.entity';
import { CalendarIntegration }         from './entities/calendar-integration.entity';
import { CalendarSyncLog }             from './entities/calendar-sync-log.entity';
import { CalendarWebhookSubscription } from './entities/calendar-webhook-subscription.entity';

// Módulos externos
import { PermissionsModule } from '../permissions/permissions.module';

// Fase 3 — Eventos
import { CalendarService }    from './calendar.service';
import { CalendarController } from './calendar.controller';

// Fase 4 — Integrações OAuth (leitura)
import { CalendarCryptoService }          from './crypto/calendar-crypto.service';
import { GoogleCalendarAdapter }          from './adapters/google-calendar.adapter';
import { MicrosoftCalendarAdapter }       from './adapters/microsoft-calendar.adapter';
import { CalendarIntegrationsService }    from './integrations/calendar-integrations.service';
import { CalendarIntegrationsController } from './integrations/calendar-integrations.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarEvent,
      CalendarEventParticipant,
      CalendarIntegration,
      CalendarSyncLog,
      CalendarWebhookSubscription,
    ]),
    PermissionsModule,
  ],
  providers: [
    CalendarService,
    // Fase 4
    CalendarCryptoService,
    GoogleCalendarAdapter,
    MicrosoftCalendarAdapter,
    CalendarIntegrationsService,
  ],
  controllers: [
    CalendarController,
    CalendarIntegrationsController,
  ],
  exports: [
    CalendarService,
    CalendarIntegrationsService,
  ],
})
export class CalendarModule {}
