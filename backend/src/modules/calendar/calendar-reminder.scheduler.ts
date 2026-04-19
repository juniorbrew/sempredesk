import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { User } from '../auth/user.entity';
import { EmailService } from '../email/email.service';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';

@Injectable()
export class CalendarReminderSchedulerService {
  private readonly logger = new Logger(CalendarReminderSchedulerService.name);

  constructor(
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly emailService: EmailService,
    private readonly realtimeEmitter: RealtimeEmitterService,
  ) {}

  @Cron('* * * * *')
  async processDueReminders(): Promise<void> {
    const now = new Date();
    const events = await this.eventRepo.find({
      where: [
        { status: 'scheduled' as any },
        { status: 'confirmed' as any },
      ],
    });

    for (const event of events) {
      const reminderAtRaw = event.metadata?.reminderAt;
      if (!reminderAtRaw) continue;

      const reminderAt = new Date(reminderAtRaw);
      if (Number.isNaN(reminderAt.getTime()) || reminderAt > now) continue;

      const alreadySentAt = event.metadata?.reminderSentAt;
      if (alreadySentAt) continue;

      let assignedUser: User | null = null;
      if (event.assignedUserId) {
        assignedUser = await this.userRepo.findOne({
          where: { id: event.assignedUserId, tenantId: event.tenantId },
        });
      }

      event.metadata = {
        ...(event.metadata ?? {}),
        reminderSentAt: now.toISOString(),
      };
      await this.eventRepo.save(event);

      this.realtimeEmitter.emitToTenant(event.tenantId, 'notification:calendar-reminder', {
        eventId: event.id,
        title: event.title,
        reminderAt: reminderAt.toISOString(),
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        assignedUserId: event.assignedUserId,
        ticketId: event.ticketId,
        eventType: event.eventType,
      });

      if (assignedUser?.email) {
        await this.emailService.sendTaskReminder(event.tenantId, assignedUser.email, {
          id: event.id,
          title: event.title,
          description: event.description,
          dueAt: event.startsAt,
          reminderAt: reminderAt.toISOString(),
          ticketId: event.ticketId,
          priority: event.eventType,
        });
      }

      this.logger.log(
        `Calendar reminder processed tenant=${event.tenantId} event=${event.id} assignedUser=${event.assignedUserId ?? 'none'}`,
      );
    }
  }
}
