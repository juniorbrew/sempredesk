import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../tickets/entities/ticket.entity';
import { Client, Contact } from '../customers/entities/customer.entity';
import { User } from '../auth/user.entity';
import { KbArticle } from '../knowledge/entities/knowledge.entity';
import { ContactArchiveRolloutService } from '../customers/contact-archive-rollout.service';

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
    @InjectRepository(Contact)
    private readonly contactRepo: Repository<Contact>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(KbArticle)
    private readonly articleRepo: Repository<KbArticle>,
    private readonly contactArchiveRollout: ContactArchiveRolloutService,
  ) {}

  async health() {
    const db = await this.ticketRepo.query('SELECT 1 as ok');
    return {
      ok: true,
      service: 'backend',
      database: Array.isArray(db) && db.length ? 'up' : 'down',
      rollout: {
        contactArchiveFeatureEnabled: this.contactArchiveRollout.isArchiveFeatureEnabled(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Métricas Etapa 9 — arquivamento de contatos (contadores por processo + agregados SQL).
   * Uso: painel interno, Datadog, ou alertas (taxa de reativação / arquivo).
   */
  async contactArchiveRolloutStats() {
    const [totalArchived, reactivated24hRows] = await Promise.all([
      this.contactRepo.count({ where: { status: 'archived' as any } }),
      this.contactRepo.query(
        `SELECT COUNT(*)::int AS c
           FROM contacts
          WHERE status = 'active'
            AND metadata IS NOT NULL
            AND metadata->>'reactivatedAt' IS NOT NULL
            AND (metadata->>'reactivatedAt')::timestamptz >= NOW() - INTERVAL '24 hours'`,
      ),
    ]);

    const reactivated24h = Number(
      Array.isArray(reactivated24hRows) && reactivated24hRows[0] ? (reactivated24hRows[0] as any).c : 0,
    );

    return {
      ok: true,
      featureContactArchiveEnabled: this.contactArchiveRollout.isArchiveFeatureEnabled(),
      processCountersSinceBoot: this.contactArchiveRollout.getCounters(),
      database: {
        totalArchivedContacts: totalArchived,
        activeWithReactivatedAtInLast24h: reactivated24h,
      },
      hints: {
        archivesVsUnarchives:
          'Compare archiveManual vs unarchiveManual + auto reactivations para detectar desbalanceamento.',
        autoReactivationSpike:
          'Alertar se autoReactivateCanonical + autoReactivateFindOrCreateFallback > limiar/hora vs baseline.',
        duplicateContacts:
          'Correlacionar com regras de negócio / WhatsApp identity; não medido diretamente aqui.',
      },
      timestamp: new Date().toISOString(),
    };
  }

  async globalStats() {
    const [
      totalTenants,
      totalUsers,
      totalClients,
      totalTickets,
      openTickets,
      resolvedTickets,
      publishedArticles,
    ] = await Promise.all([
      this.userRepo.createQueryBuilder('u')
        .select('COUNT(DISTINCT u.tenant_id)', 'count')
        .where('u.tenant_id IS NOT NULL')
        .getRawOne(),
      this.userRepo.count(),
      this.clientRepo.count(),
      this.ticketRepo.count(),
      this.ticketRepo.count({ where: { status: TicketStatus.OPEN } }),
      this.ticketRepo.count({ where: { status: TicketStatus.RESOLVED } }),
      this.articleRepo.count(),
    ]);

    return {
      ok: true,
      totals: {
        tenants: Number(totalTenants?.count || 0),
        users: totalUsers,
        clients: totalClients,
        tickets: totalTickets,
        openTickets,
        resolvedTickets,
        articles: publishedArticles,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async tenantStats(tenantId: string) {
    const [
      users,
      clients,
      tickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      articles,
    ] = await Promise.all([
      this.userRepo.count({ where: { tenantId } }),
      this.clientRepo.count({ where: { tenantId } }),
      this.ticketRepo.count({ where: { tenantId } }),
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.OPEN } }),
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.IN_PROGRESS } }),
      this.ticketRepo.count({ where: { tenantId, status: TicketStatus.RESOLVED } }),
      this.articleRepo.count({ where: { tenantId } }),
    ]);

    return {
      ok: true,
      tenantId,
      totals: {
        users,
        clients,
        tickets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        articles,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async suspiciousActivity() {
    const lateTickets = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.status NOT IN (:...done)', {
        done: [TicketStatus.RESOLVED, TicketStatus.CLOSED, TicketStatus.CANCELLED],
      })
      .andWhere('t.sla_resolve_at IS NOT NULL')
      .andWhere('t.sla_resolve_at < :now', { now: new Date() })
      .select([
        't.id as id',
        't.tenant_id as tenant_id',
        't.ticket_number as ticket_number',
        't.status as status',
        't.priority as priority',
      ])
      .limit(20)
      .getRawMany();

    return {
      ok: true,
      breachedTickets: lateTickets,
      count: lateTickets.length,
      timestamp: new Date().toISOString(),
    };
  }
}
