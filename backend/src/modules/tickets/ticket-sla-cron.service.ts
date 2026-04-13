import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Ticket, TicketPriority, TicketStatus, MessageType } from './entities/ticket.entity';
import { TenantPriority } from '../tenant-priorities/entities/tenant-priority.entity';
import { AlertsService } from '../alerts/alerts.service';
import { EmailService } from '../email/email.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TicketsService } from './tickets.service';

/**
 * Jobs cron de SLA para tickets.
 * Extraído de TicketsService para isolar monitoramento background do CRUD principal.
 *
 * Dependências circulares (EmailService ↔ TicketsService, WebhooksService ↔ TicketsService)
 * são geridas pelo mesmo padrão de setter injection usado em TicketsService.
 * TicketsModule.onModuleInit() chama setEmailService/setWebhooksService em ambos os serviços.
 */
@Injectable()
export class TicketSlaCronService {
  private readonly logger = new Logger(TicketSlaCronService.name);

  private emailSvc: EmailService | null = null;
  setEmailService(svc: EmailService) { this.emailSvc = svc; }

  private webhooksSvc: WebhooksService | null = null;
  setWebhooksService(svc: WebhooksService) { this.webhooksSvc = svc; }

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(TenantPriority)
    private readonly tenantPriorityRepo: Repository<TenantPriority>,
    private readonly alertsService: AlertsService,
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * Alerta de 80% do prazo de resolução.
   * Roda a cada 5 minutos e registra mensagem de sistema no ticket.
   */
  @Cron('*/5 * * * *')
  async checkSlaWarnings() {
    const now = new Date();

    const tickets = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.sla_resolve_at IS NOT NULL')
      .andWhere('t.created_at IS NOT NULL')
      .andWhere('t.status NOT IN (:...done)', {
        done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED],
      })
      .getMany();

    for (const t of tickets) {
      const totalMs = t.slaResolveAt.getTime() - t.createdAt.getTime();
      if (totalMs <= 0) continue;

      const elapsedMs = now.getTime() - t.createdAt.getTime();
      const ratio = elapsedMs / totalMs;

      // Janela de aviso: entre 80% e 100% do prazo total.
      if (ratio >= 0.8 && ratio < 1) {
        await this.ticketsService.registerSystemMessage(
          t.tenantId,
          t.id,
          '',
          'SLA Engine',
          'SLA: ticket atingiu 80% do prazo de resolução.',
          MessageType.SYSTEM,
        );
        try {
          await this.alertsService.notifySlaWarning(t);
        } catch { /* best-effort */ }
      }
    }
  }

  /**
   * Escalona automaticamente tickets com SLA de resolução violado para prioridade crítica.
   * Roda a cada 5 minutos por tenant.
   */
  @Cron('*/5 * * * *')
  async checkSlaBreaches() {
    const now = new Date();

    const tenants = await this.ticketRepo.manager.query(
      'SELECT DISTINCT tenant_id FROM tickets WHERE tenant_id IS NOT NULL',
    );

    for (const row of tenants) {
      const tenantId = row.tenant_id;

      const breached = await this.ticketRepo
        .createQueryBuilder('t')
        .where('t.tenant_id = :tenantId', { tenantId })
        .andWhere('t.status NOT IN (:...done)', {
          done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED],
        })
        .andWhere('t.sla_resolve_at < :now', { now })
        .andWhere('t.escalated = false')
        .getMany();

      for (const t of breached) {
        t.escalated = true;
        t.priority = TicketPriority.CRITICAL;
        t.priorityId =
          (await this.ticketsService.resolveTenantPriorityIdBySlug(tenantId, TicketPriority.CRITICAL)) ?? null;
        await this.ticketsService.applyConfiguredSlaToTicket(t);
        await this.ticketRepo.save(t);
        await this.ticketsService.syncConversationSlaWithTicket(t);
        await this.ticketsService.registerSystemMessage(
          t.tenantId,
          t.id,
          '',
          'SLA Engine',
          'SLA: prazo de resolução violado. Ticket escalonado automaticamente para prioridade crítica.',
          MessageType.SYSTEM,
        );
        try {
          await this.alertsService.notifySlaBreach(t);
        } catch { /* best-effort */ }
      }
    }
  }

  /** Marca escalated=true e dispara webhook/email para tickets a até 2h do prazo. */
  @Cron('0 */30 * * * *')
  async checkSlaEscalation(): Promise<void> {
    try {
      const threshold = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const atRisk = await this.ticketRepo
        .createQueryBuilder('t')
        .where('t.sla_resolve_at IS NOT NULL')
        .andWhere('t.sla_resolve_at <= :threshold', { threshold })
        .andWhere('t.escalated = false')
        .andWhere('t.status NOT IN (:...statuses)', {
          statuses: ['resolved', 'closed', 'cancelled'],
        })
        .getMany();

      for (const ticket of atRisk) {
        await this.ticketRepo.update(ticket.id, { escalated: true });
        if (this.webhooksSvc) {
          await this.webhooksSvc.fire(ticket.tenantId, 'sla.warning', {
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            slaResolveAt: ticket.slaResolveAt,
          });
        }
        if (this.emailSvc) {
          try {
            const settings = await this.ticketRepo.manager.query(
              'SELECT escalation_email FROM tenant_settings WHERE tenant_id = $1 LIMIT 1',
              [ticket.tenantId],
            );
            if (settings[0]?.escalation_email) {
              await this.emailSvc.sendEscalationAlert(ticket.tenantId, settings[0].escalation_email, ticket);
            }
          } catch { /* best-effort */ }
        }
      }
    } catch (e) {
      this.logger.error('SLA escalation check failed:', (e as Error).message);
    }
  }

  /** Fecha automaticamente tickets resolvidos há mais de 7 dias. Roda de hora em hora. */
  @Cron('0 * * * *')
  async autoCloseResolvedTickets() {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const tenants = await this.ticketRepo.manager.query(
      'SELECT DISTINCT tenant_id FROM tickets WHERE tenant_id IS NOT NULL',
    );

    for (const row of tenants) {
      const tenantId = row.tenant_id;
      await this.ticketRepo
        .createQueryBuilder()
        .update(Ticket)
        .set({ status: TicketStatus.CLOSED, closedAt: new Date() })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('status = :status', { status: TicketStatus.RESOLVED })
        .andWhere('resolved_at < :cutoff', { cutoff })
        .execute();
    }
  }
}
