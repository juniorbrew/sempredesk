import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { TaskLog } from './entities/task-log.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { User } from '../auth/user.entity';
import { EmailModule } from '../email/email.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskReminderSchedulerService } from './task-reminder.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, TaskLog, User]),
    PermissionsModule,
    EmailModule,
    RealtimeModule,
  ],
  providers: [TasksService, TaskReminderSchedulerService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
