import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEmitterService } from './realtime-emitter.service';
import { RealtimePresenceService } from './realtime-presence.service';
import { TicketViewersService } from './ticket-viewers.service';
import { PresenceController } from './presence.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [PermissionsModule, AttendanceModule],
  controllers: [PresenceController],
  providers: [RealtimeGateway, RealtimeEmitterService, RealtimePresenceService, TicketViewersService],
  exports: [RealtimeEmitterService, RealtimePresenceService, TicketViewersService],
})
export class RealtimeModule {}
