import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { EmailService } from '../email/email.service';

/**
 * Cron de atualização de status SLA para conversas abertas.
 * Roda a cada 5 minutos e:
 *  1. Atualiza sla_status de 'within' → 'at_risk' quando < 20% do prazo restante.
 *  2. Atualiza sla_status de qualquer valor → 'breached' quando prazo expirou.
 *  3. Envia e-mail de alerta para tenants com sla_warning_notify = 'true' e escalation_email preenchido.
 */
@Injectable()
export class SlaAlertScheduler {
  private readonly logger = new Logger(SlaAlertScheduler.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly emailService: EmailService,
  ) {}

  @Cron('*/5 * * * *')
  async runSlaStatusSync(): Promise<void> {
    try {
      await this.updateBreached();
      await this.updateAtRisk();
      await this.sendAlerts();
    } catch (err: any) {
      this.logger.warn(`[SlaAlert] erro no cron: ${err?.message}`, err?.stack);
    }
  }

  /** Marca como 'breached' conversas cujo prazo de resolução já passou. */
  private async updateBreached(): Promise<void> {
    const result = await this.dataSource.query(
      `UPDATE conversations
          SET sla_status = 'breached'
        WHERE sla_policy_id IS NOT NULL
          AND sla_resolved_at IS NULL
          AND status NOT IN ('closed')
          AND sla_resolution_deadline < NOW()
          AND (sla_status IS NULL OR sla_status != 'breached')`,
    );
    const affected = result?.[1] ?? 0;
    if (affected > 0) {
      this.logger.warn(`[SlaAlert] ${affected} conversa(s) marcada(s) como breached`);
    }
  }

  /** Marca como 'at_risk' conversas com menos de 20% do prazo de resolução restante. */
  private async updateAtRisk(): Promise<void> {
    const result = await this.dataSource.query(
      `UPDATE conversations
          SET sla_status = 'at_risk'
        WHERE sla_policy_id IS NOT NULL
          AND sla_resolved_at IS NULL
          AND status NOT IN ('closed')
          AND sla_resolution_deadline > NOW()
          AND sla_first_response_deadline IS NOT NULL
          AND (sla_resolution_deadline - NOW()) < (sla_resolution_deadline - created_at) * 0.20
          AND (sla_status IS NULL OR sla_status = 'within')`,
    );
    const affected = result?.[1] ?? 0;
    if (affected > 0) {
      this.logger.log(`[SlaAlert] ${affected} conversa(s) marcada(s) como at_risk`);
    }
  }

  /** Envia e-mail de alerta para tenants com notificações ativas e conversas em risco/violadas. */
  private async sendAlerts(): Promise<void> {
    // Busca tenants com alertas SLA habilitados
    const tenants: Array<{ tenant_id: string; escalation_email: string }> =
      await this.dataSource.query(
        `SELECT tenant_id, escalation_email
           FROM tenant_settings
          WHERE sla_warning_notify = 'true'
            AND escalation_email IS NOT NULL
            AND escalation_email != ''`,
      );

    for (const { tenant_id, escalation_email } of tenants) {
      try {
        const rows: Array<{ sla_status: string; count: string }> = await this.dataSource.query(
          `SELECT sla_status, COUNT(*) AS count
             FROM conversations
            WHERE tenant_id = $1
              AND sla_policy_id IS NOT NULL
              AND sla_resolved_at IS NULL
              AND status NOT IN ('closed')
              AND sla_status IN ('at_risk', 'breached')
            GROUP BY sla_status`,
          [tenant_id],
        );

        if (!rows.length) continue;

        const atRisk   = parseInt(rows.find(r => r.sla_status === 'at_risk')?.count  ?? '0', 10);
        const breached = parseInt(rows.find(r => r.sla_status === 'breached')?.count ?? '0', 10);

        await this.emailService.sendSlaAlert(tenant_id, escalation_email, { atRisk, breached });
      } catch (err: any) {
        this.logger.warn(`[SlaAlert] falha ao enviar alerta tenant=${tenant_id}: ${err?.message}`);
      }
    }
  }
}
