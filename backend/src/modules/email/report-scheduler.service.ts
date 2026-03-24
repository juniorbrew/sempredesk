import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EmailService } from './email.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
    private readonly settingsService: SettingsService,
  ) {}

  // Every Monday at 8am
  @Cron('0 8 * * 1')
  async sendWeeklyReports(): Promise<void> {
    this.logger.log('Sending weekly reports...');
    try {
      const tenants = await this.dataSource.query('SELECT DISTINCT tenant_id FROM tenant_settings WHERE escalation_email IS NOT NULL AND escalation_email != \'\'');
      for (const row of tenants) {
        const tenantId = row.tenant_id;
        const settings = await this.settingsService.findByTenant(tenantId);
        if (!settings.escalationEmail) continue;
        const [open] = await this.dataSource.query(`SELECT COUNT(*) as count FROM tickets WHERE tenant_id = $1 AND status = 'open'`, [tenantId]);
        const [inProgress] = await this.dataSource.query(`SELECT COUNT(*) as count FROM tickets WHERE tenant_id = $1 AND status = 'in_progress'`, [tenantId]);
        const [resolved] = await this.dataSource.query(`SELECT COUNT(*) as count FROM tickets WHERE tenant_id = $1 AND status = 'resolved' AND resolved_at >= NOW() - INTERVAL '7 days'`, [tenantId]);
        const [slaRisk] = await this.dataSource.query(`SELECT COUNT(*) as count FROM tickets WHERE tenant_id = $1 AND sla_resolve_at <= NOW() + INTERVAL '24 hours' AND status NOT IN ('resolved','closed','cancelled')`, [tenantId]);
        await this.emailService.sendWeeklyReport(tenantId, settings.escalationEmail, {
          open: parseInt(open.count),
          inProgress: parseInt(inProgress.count),
          resolved: parseInt(resolved.count),
          slaRisk: parseInt(slaRisk.count),
        });
      }
    } catch (e) {
      this.logger.error('Weekly report failed:', e.message);
    }
  }
}
