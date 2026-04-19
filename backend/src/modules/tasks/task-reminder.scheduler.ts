import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskLog } from './entities/task-log.entity';
import { User } from '../auth/user.entity';
import { EmailService } from '../email/email.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';

@Injectable()
export class TaskReminderSchedulerService {
  private readonly logger = new Logger(TaskReminderSchedulerService.name);

  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskLog)
    private readonly logRepo: Repository<TaskLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly realtimeEmitter: RealtimeEmitterService,
  ) {}

  @Cron('* * * * *')
  async processDueReminders(): Promise<void> {
    const now = new Date();

    const tasks = await this.taskRepo
      .createQueryBuilder('task')
      .where('task.reminder_at IS NOT NULL')
      .andWhere('task.reminder_at <= :now', { now })
      .andWhere('task.status IN (:...statuses)', { statuses: ['pending', 'in_progress'] })
      .orderBy('task.reminder_at', 'ASC')
      .getMany();

    for (const task of tasks) {
      const reminderKey = task.reminderAt?.toISOString();
      if (!reminderKey) continue;

      const alreadySent = await this.logRepo.exist({
        where: {
          tenantId: task.tenantId,
          taskId: task.id,
          action: 'reminder_sent',
          toValue: reminderKey,
        },
      });

      if (alreadySent) continue;

      let assignedUser: User | null = null;
      if (task.assignedUserId) {
        assignedUser = await this.userRepo.findOne({
          where: { id: task.assignedUserId, tenantId: task.tenantId },
        });
      }

      await this.logRepo.save(
        this.logRepo.create({
          tenantId: task.tenantId,
          taskId: task.id,
          authorId: null,
          authorName: 'Reminder Engine',
          action: 'reminder_sent',
          toValue: reminderKey,
          comment: 'Lembrete interno processado automaticamente.',
        }),
      );

      this.realtimeEmitter.emitToTenant(task.tenantId, 'notification:task-reminder', {
        taskId: task.id,
        title: task.title,
        reminderAt: task.reminderAt,
        dueAt: task.dueAt,
        assignedUserId: task.assignedUserId,
        ticketId: task.ticketId,
      });

      if (assignedUser?.email) {
        await this.emailService.sendTaskReminder(task.tenantId, assignedUser.email, task);
      }

      this.logger.log(
        `Task reminder processed tenant=${task.tenantId} task=${task.id} assignedUser=${task.assignedUserId ?? 'none'}`,
      );
    }
  }
}
