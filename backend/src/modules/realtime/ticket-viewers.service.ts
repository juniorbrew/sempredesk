import { Injectable, Inject, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface TicketViewer {
  userId: string;
  userName: string;
  /** Epoch ms em que o agente abriu o ticket */
  since: number;
}

const PREFIX = 'ticket:viewers';
/** TTL da chave no Redis — renovado a cada join-ticket; limpa sozinho se agente sumir */
const TTL_SECONDS = 60;

/**
 * Rastreia quais agentes estão com um ticket aberto simultaneamente.
 *
 * Armazenamento: Redis Hash
 *   chave: ticket:viewers:{tenantId}:{ticketId}
 *   campo: userId → JSON { userId, userName, since }
 *   TTL: 60s — renovado via join-ticket (heartbeat de aba aberta)
 *
 * Sem Redis: opera em no-op seguro (sem travar a aplicação).
 * O gateway usa este serviço para emitir o evento "ticket:viewers"
 * e alertar o agente quando outro já está no mesmo ticket.
 */
@Injectable()
export class TicketViewersService {
  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private key(tenantId: string, ticketId: string): string {
    return `${PREFIX}:${tenantId}:${ticketId}`;
  }

  /** Registra agente como visualizando o ticket e retorna a lista atualizada. */
  async addViewer(
    tenantId: string,
    ticketId: string,
    userId: string,
    userName: string,
  ): Promise<TicketViewer[]> {
    if (!this.redis) return [];
    const k = this.key(tenantId, ticketId);
    const value = JSON.stringify({ userId, userName, since: Date.now() } satisfies TicketViewer);
    await this.redis.hset(k, userId, value);
    await this.redis.expire(k, TTL_SECONDS);
    return this.listViewers(tenantId, ticketId);
  }

  /** Remove agente da lista de visualizadores e retorna a lista atualizada. */
  async removeViewer(
    tenantId: string,
    ticketId: string,
    userId: string,
  ): Promise<TicketViewer[]> {
    if (!this.redis) return [];
    const k = this.key(tenantId, ticketId);
    await this.redis.hdel(k, userId);
    return this.listViewers(tenantId, ticketId);
  }

  /** Retorna todos os visualizadores atuais de um ticket. */
  async listViewers(tenantId: string, ticketId: string): Promise<TicketViewer[]> {
    if (!this.redis) return [];
    const k = this.key(tenantId, ticketId);
    const hash = await this.redis.hgetall(k);
    if (!hash) return [];
    return Object.values(hash).map((v) => JSON.parse(v) as TicketViewer);
  }

  /**
   * Remove o agente de todos os tickets rastreados na desconexão.
   * Recebe a lista de ticketIds que o agente estava visualizando
   * (mantida em memória no gateway — sem round-trip extra ao Redis).
   */
  async removeUserFromTickets(
    tenantId: string,
    userId: string,
    ticketIds: string[],
  ): Promise<Array<{ ticketId: string; viewers: TicketViewer[] }>> {
    if (!this.redis || ticketIds.length === 0) return [];
    const results: Array<{ ticketId: string; viewers: TicketViewer[] }> = [];
    for (const ticketId of ticketIds) {
      const viewers = await this.removeViewer(tenantId, ticketId, userId);
      results.push({ ticketId, viewers });
    }
    return results;
  }
}
