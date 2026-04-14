import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PauseReason } from './entities/pause-reason.entity';
import { AgentPauseRequest } from './entities/agent-pause-request.entity';
import { AgentAttendance } from '../attendance/attendance.entity';
import { User } from '../auth/user.entity';
import { AgentPausesService } from './agent-pauses.service';
import { AgentPausesController } from './agent-pauses.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PauseReason, AgentPauseRequest, AgentAttendance, User]),
    RealtimeModule,
  ],
  providers: [AgentPausesService],
  controllers: [AgentPausesController],
  exports: [AgentPausesService],
})
export class AgentPausesModule {}
