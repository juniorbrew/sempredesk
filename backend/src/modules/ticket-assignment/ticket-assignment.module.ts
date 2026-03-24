import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentDepartment } from './entities/agent-department.entity';
import { DistributionQueue } from './entities/distribution-queue.entity';
import { Ticket } from '../tickets/entities/ticket.entity';
import { User } from '../auth/user.entity';
import { TicketAssignmentService } from './ticket-assignment.service';
import { TicketAssignmentController } from './ticket-assignment.controller';
import { TicketAssignmentScheduler } from './ticket-assignment.scheduler';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentDepartment, DistributionQueue, Ticket, User]),
    RealtimeModule,
  ],
  providers: [TicketAssignmentService, TicketAssignmentScheduler],
  controllers: [TicketAssignmentController],
  exports: [TicketAssignmentService],
})
export class TicketAssignmentModule {}
