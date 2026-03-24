import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ReportSchedulerService } from './report-scheduler.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [EmailService, ReportSchedulerService],
  exports: [EmailService],
})
export class EmailModule {}
