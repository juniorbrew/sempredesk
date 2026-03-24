import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TicketAssignmentService } from './ticket-assignment.service';
import { RealtimePresenceService } from '../realtime/realtime-presence.service';

/**
 * Scheduler de distribuição de tickets.
 *
 * Executa a cada 2 minutos e realiza dois tipos de verificação:
 *
 * 1. **Redis snapshot diff** — detecta agentes que ficaram online/offline
 *    via WebSocket (comparando snapshots consecutivos do Redis).
 *
 * 2. **DB heartbeat timeout** — detecta agentes que perderam o heartbeat HTTP
 *    (last_seen_at > 5 min) e os marca offline, redistribuindo seus tickets.
 *    Cobre clientes que usam presença via HTTP em vez de WebSocket.
 */
@Injectable()
export class TicketAssignmentScheduler {
  private readonly logger = new Logger(TicketAssignmentScheduler.name);

  /** Snapshot anterior da presença Redis: tenantId → Set<userId> */
  private previousOnline = new Map<string, Set<string>>();

  constructor(
    private readonly assignmentService: TicketAssignmentService,
    private readonly presenceService: RealtimePresenceService,
  ) {}

  @Cron('*/2 * * * *')
  async syncPresenceAndTimeouts(): Promise<void> {
    await Promise.allSettled([
      this.checkRedisPresenceDiff(),
      this.checkDbHeartbeatTimeouts(),
    ]);
  }

  // ─── 1. Redis snapshot diff ───────────────────────────────────────────────

  /**
   * Compara snapshot atual do Redis com o anterior.
   * Agentes que saíram do online → redistribute.
   * Agentes que entraram online  → rebalance.
   */
  private async checkRedisPresenceDiff(): Promise<void> {
    try {
      const tenantIds = await this.presenceService.getTenantIdsAsync();

      for (const tenantId of tenantIds) {
        const { onlineIds } = await this.presenceService.getOnlineIdsAndStatus(tenantId);
        const current = new Set(onlineIds);
        const prev = this.previousOnline.get(tenantId) ?? new Set<string>();

        // Agentes que ficaram offline
        for (const userId of prev) {
          if (!current.has(userId)) {
            this.logger.log(
              `[redis-diff] offline: userId=${userId} tenant=${tenantId}`,
            );
            await this.assignmentService
              .redistributeOnAgentOffline(tenantId, userId)
              .catch((err: unknown) =>
                this.logger.error(
                  `[redis-diff] redistribuição falhou userId=${userId}`,
                  err,
                ),
              );
          }
        }

        // Agentes que ficaram online
        for (const userId of current) {
          if (!prev.has(userId)) {
            this.logger.log(
              `[redis-diff] online: userId=${userId} tenant=${tenantId}`,
            );
            await this.assignmentService
              .rebalanceOnAgentOnline(tenantId, userId)
              .catch((err: unknown) =>
                this.logger.error(
                  `[redis-diff] rebalanceamento falhou userId=${userId}`,
                  err,
                ),
              );
          }
        }

        this.previousOnline.set(tenantId, current);
      }
    } catch (err: unknown) {
      this.logger.error('[redis-diff] syncPresenceChanges falhou', err);
    }
  }

  // ─── 2. DB heartbeat timeout ──────────────────────────────────────────────

  /**
   * Detecta agentes marcados como online/away/busy no DB cujo last_seen_at
   * excedeu 5 minutos (heartbeat HTTP perdido).
   * Marca offline e redistribui tickets.
   */
  private async checkDbHeartbeatTimeouts(): Promise<void> {
    try {
      await this.assignmentService.markOfflineByDbTimeout();
    } catch (err: unknown) {
      this.logger.error('[db-timeout] checkDbHeartbeatTimeouts falhou', err);
    }
  }
}
