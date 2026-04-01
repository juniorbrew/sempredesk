import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantLicense } from './tenant-license.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../auth/user.entity';
import { EmailService } from '../email/email.service';

type LicenseMeta = {
  trialRemind7?: string;
  trialRemind3?: string;
  trialRemind1?: string;
};

/**
 * Lembretes de expiração do trial (e-mail via SMTP da plataforma SAAS_SMTP_*).
 * Janelas: 6–7 dias, 2–3 dias, ≤1 dia antes do fim (uma vez por janela, em meta).
 */
@Injectable()
export class TrialLicenseReminderService {
  private readonly logger = new Logger(TrialLicenseReminderService.name);

  constructor(
    @InjectRepository(TenantLicense)
    private readonly licenses: Repository<TenantLicense>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly email: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDailyReminders() {
    if (this.cfgDisabled()) return;

    const rows = await this.licenses.find({
      where: { status: 'trial' as any },
    });

    const now = new Date();
    const dayMs = 86400000;

    for (const lic of rows) {
      if (!lic.expiresAt) continue;
      const expires = new Date(lic.expiresAt);
      if (expires.getTime() <= now.getTime()) continue;

      const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / dayMs);
      const meta: LicenseMeta = { ...(lic.meta as LicenseMeta) || {} };
      let changed = false;

      const tenant = await this.tenants.findOne({ where: { id: lic.tenantId } });
      if (!tenant) continue;

      const to = await this.resolveRecipientEmail(lic.tenantId, tenant.email);
      if (!to) {
        this.logger.warn(`Trial reminder: sem e-mail para tenant ${tenant.slug} (${lic.tenantId})`);
        continue;
      }

      if (!meta.trialRemind7 && daysLeft <= 7 && daysLeft >= 6) {
        await this.sendMail(
          to,
          tenant.name,
          daysLeft,
          expires,
          'O período de trial da sua empresa no SempreDesk está a terminar.',
        );
        meta.trialRemind7 = new Date().toISOString();
        changed = true;
      } else if (!meta.trialRemind3 && daysLeft <= 3 && daysLeft >= 2) {
        await this.sendMail(
          to,
          tenant.name,
          daysLeft,
          expires,
          'Faltam poucos dias para o fim do trial. Renove para não interromper o suporte.',
        );
        meta.trialRemind3 = new Date().toISOString();
        changed = true;
      } else if (!meta.trialRemind1 && daysLeft <= 1) {
        await this.sendMail(
          to,
          tenant.name,
          Math.max(1, daysLeft),
          expires,
          'Último dia(s) de trial. Entre em contacto connosco para renovar a licença.',
        );
        meta.trialRemind1 = new Date().toISOString();
        changed = true;
      }

      if (changed) {
        lic.meta = { ...(lic.meta || {}), ...meta };
        await this.licenses.save(lic);
      }
    }
  }

  private cfgDisabled() {
    const v = process.env.SAAS_TRIAL_REMINDER_ENABLED;
    return v === '0' || v === 'false';
  }

  private async resolveRecipientEmail(tenantId: string, tenantEmail?: string | null) {
    const admin = await this.users.findOne({
      where: { tenantId, role: 'admin', status: 'active' },
      order: { createdAt: 'ASC' },
    });
    if (admin?.email) return admin.email.trim();
    if (tenantEmail?.trim()) return tenantEmail.trim();
    return null;
  }

  private async sendMail(
    to: string,
    tenantName: string,
    daysLeft: number,
    expires: Date,
    intro: string,
  ) {
    const expStr = expires.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#4F46E5;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0">SempreDesk — Trial a expirar</h2>
        </div>
        <div style="background:#F8FAFC;padding:20px;border-radius:0 0 8px 8px;border:1px solid #E2E8F0">
          <p><strong>${tenantName}</strong></p>
          <p>${intro}</p>
          <p><strong>Dias restantes (aprox.):</strong> ${daysLeft}</p>
          <p><strong>Data de fim:</strong> ${expStr}</p>
          <p style="color:#64748B;font-size:13px">Aceda ao painel para mais detalhes ou contacte o suporte SempreDesk.</p>
        </div>
      </div>`;
    const ok = await this.email.sendSaasPlatformEmail(
      to,
      `[SempreDesk] Trial — ${tenantName} — faltam cerca de ${daysLeft} dia(s)`,
      html,
    );
    if (ok) this.logger.log(`Trial reminder enviado → ${to} (${tenantName}, ~${daysLeft}d)`);
  }
}
