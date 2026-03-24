import { Injectable, Inject, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  PresenceStatus,
  PRESENCE_OFFLINE_THRESHOLD_MS,
} from './presence.types';
import { REDIS_CLIENT } from '../redis/redis.module';

const REDIS_PREFIX = 'presence';
const REDIS_DATA_KEY = (t: string, u: string) => `${REDIS_PREFIX}:data:${t}:${u}`;
const REDIS_SOCKETS_KEY = (t: string, u: string) => `${REDIS_PREFIX}:sockets:${t}:${u}`;
const REDIS_TENANT_USERS_KEY = (t: string) => `${REDIS_PREFIX}:tenant:${t}`;

interface UserPresenceInfo {
  status: PresenceStatus;
  lastSeen: number;
  socketIds: Set<string>;
}

/**
 * Presença de agentes: ONLINE, AWAY, BUSY, OFFLINE.
 * Usa Redis quando disponível (multi-instância); fallback em memória.
 * Heartbeat 15s; offline após 45s sem heartbeat.
 */
@Injectable()
export class RealtimePresenceService {
  private readonly tenantUserPresence = new Map<string, Map<string, UserPresenceInfo>>();
  private readonly socketToUser = new Map<string, { tenantId: string; userId: string }>();

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  private get redisAvailable(): boolean {
    return this.redis != null;
  }

  private readonly REDIS_TENANTS_KEY = `${REDIS_PREFIX}:tenants`;

  private async redisAdd(tenantId: string, userId: string, socketId: string): Promise<void> {
    if (!this.redis) return;
    const keyData = REDIS_DATA_KEY(tenantId, userId);
    const keySockets = REDIS_SOCKETS_KEY(tenantId, userId);
    const keyTenant = REDIS_TENANT_USERS_KEY(tenantId);
    const now = Date.now();
    const data = JSON.stringify({ status: 'online', lastSeen: now });
    await this.redis
      .multi()
      .incr(keySockets)
      .set(keyData, data, 'EX', 90)
      .sadd(keyTenant, userId)
      .sadd(this.REDIS_TENANTS_KEY, tenantId)
      .exec();
  }

  private async redisRemove(tenantId: string, userId: string): Promise<void> {
    if (!this.redis) return;
    const keyData = REDIS_DATA_KEY(tenantId, userId);
    const keySockets = REDIS_SOCKETS_KEY(tenantId, userId);
    const keyTenant = REDIS_TENANT_USERS_KEY(tenantId);
    const count = await this.redis.decr(keySockets);
    if (count <= 0) {
      await this.redis.multi().del(keySockets).del(keyData).srem(keyTenant, userId).exec();
      const remaining = await this.redis.scard(keyTenant);
      if (remaining === 0) {
        await this.redis.srem(this.REDIS_TENANTS_KEY, tenantId);
      }
    }
  }

  private async redisHeartbeat(tenantId: string, userId: string): Promise<boolean> {
    if (!this.redis) return false;
    const keyData = REDIS_DATA_KEY(tenantId, userId);
    const raw = await this.redis.get(keyData);
    if (!raw) return false;
    const obj = JSON.parse(raw) as { status: string; lastSeen: number };
    obj.lastSeen = Date.now();
    await this.redis.set(keyData, JSON.stringify(obj), 'EX', 90);
    return true;
  }

  private async redisSetStatus(tenantId: string, userId: string, status: PresenceStatus): Promise<boolean> {
    if (!this.redis) return false;
    if (!['online', 'away', 'busy'].includes(status)) return false;
    const keyData = REDIS_DATA_KEY(tenantId, userId);
    const raw = await this.redis.get(keyData);
    if (!raw) return false;
    const obj = JSON.parse(raw) as { status: string; lastSeen: number };
    obj.status = status;
    await this.redis.set(keyData, JSON.stringify(obj), 'EX', 90);
    return true;
  }

  private async redisGetPresenceMap(tenantId: string): Promise<Record<string, string>> {
    if (!this.redis) return {};
    const keyTenant = REDIS_TENANT_USERS_KEY(tenantId);
    const userIds = await this.redis.smembers(keyTenant);
    const now = Date.now();
    const result: Record<string, string> = {};
    for (const userId of userIds) {
      const keyData = REDIS_DATA_KEY(tenantId, userId);
      const raw = await this.redis.get(keyData);
      if (!raw) continue;
      const obj = JSON.parse(raw) as { status: string; lastSeen: number };
      const expired = now - obj.lastSeen > PRESENCE_OFFLINE_THRESHOLD_MS;
      result[userId] = expired ? 'offline' : obj.status;
    }
    return result;
  }

  add(tenantId: string, userId: string, socketId: string): void {
    if (!tenantId || !userId) return;
    userId = String(userId);
    this.socketToUser.set(socketId, { tenantId, userId });
    if (this.redisAvailable) {
      this.redisAdd(tenantId, userId, socketId).catch(() => {});
      return;
    }
    let userMap = this.tenantUserPresence.get(tenantId);
    if (!userMap) {
      userMap = new Map<string, UserPresenceInfo>();
      this.tenantUserPresence.set(tenantId, userMap);
    }
    let info = userMap.get(userId);
    const now = Date.now();
    if (!info) {
      info = { status: 'online', lastSeen: now, socketIds: new Set() };
      userMap.set(userId, info);
    }
    info.socketIds.add(socketId);
    info.lastSeen = now;
    info.status = info.status === 'offline' ? 'online' : info.status;
  }

  remove(socketId: string): { tenantId: string; userId: string } | null {
    const data = this.socketToUser.get(socketId);
    if (!data) return null;
    this.socketToUser.delete(socketId);
    if (this.redisAvailable) {
      this.redisRemove(data.tenantId, data.userId).catch(() => {});
      return data;
    }
    const userMap = this.tenantUserPresence.get(data.tenantId);
    if (userMap) {
      const info = userMap.get(data.userId);
      if (info) {
        info.socketIds.delete(socketId);
        if (info.socketIds.size === 0) userMap.delete(data.userId);
      }
      if (userMap.size === 0) this.tenantUserPresence.delete(data.tenantId);
    }
    return data;
  }

  heartbeat(tenantId: string, userId: string, socketId: string): boolean {
    if (this.redisAvailable) return false;
    const userMap = this.tenantUserPresence.get(tenantId);
    if (!userMap) return false;
    const info = userMap.get(String(userId));
    if (!info || !info.socketIds.has(socketId)) return false;
    info.lastSeen = Date.now();
    return true;
  }

  /** Heartbeat síncrono ou assíncrono conforme backend (Redis vs memória) */
  async heartbeatAsync(tenantId: string, userId: string, socketId: string): Promise<boolean> {
    if (this.redisAvailable) {
      return this.redisHeartbeat(tenantId, String(userId));
    }
    return this.heartbeat(tenantId, userId, socketId);
  }

  setStatus(tenantId: string, userId: string, status: PresenceStatus): boolean {
    if (this.redisAvailable) {
      return false;
    }
    const userMap = this.tenantUserPresence.get(tenantId);
    if (!userMap) return false;
    const info = userMap.get(String(userId));
    if (!info) return false;
    if (['online', 'away', 'busy'].includes(status)) {
      info.status = status;
      return true;
    }
    return false;
  }

  async setStatusAsync(tenantId: string, userId: string, status: PresenceStatus): Promise<boolean> {
    if (this.redisAvailable) {
      return this.redisSetStatus(tenantId, String(userId), status);
    }
    return this.setStatus(tenantId, userId, status);
  }

  getPresenceMap(tenantId: string): Record<string, string> {
    if (this.redisAvailable) {
      return {};
    }
    const userMap = this.tenantUserPresence.get(tenantId);
    if (!userMap) return {};
    const now = Date.now();
    const result: Record<string, string> = {};
    for (const [userId, info] of userMap) {
      const expired = now - info.lastSeen > PRESENCE_OFFLINE_THRESHOLD_MS;
      result[userId] = expired ? 'offline' : info.status;
    }
    return result;
  }

  async getPresenceMapAsync(tenantId: string): Promise<Record<string, string>> {
    if (this.redisAvailable) {
      return this.redisGetPresenceMap(tenantId);
    }
    return this.getPresenceMap(tenantId);
  }

  getOnline(tenantId: string): string[] {
    const result = this.getPresenceMap(tenantId);
    return Object.keys(result).filter((uid) => result[uid] !== 'offline');
  }

  async getOnlineIdsAndStatus(tenantId: string): Promise<{ onlineIds: string[]; statusMap: Record<string, string> }> {
    const statusMap = this.redisAvailable
      ? await this.redisGetPresenceMap(tenantId)
      : this.getPresenceMap(tenantId);
    const onlineIds = Object.entries(statusMap)
      .filter(([, status]) => status !== 'offline')
      .map(([uid]) => uid);
    return { onlineIds, statusMap };
  }

  getSocketInfo(socketId: string): { tenantId: string; userId: string } | null {
    return this.socketToUser.get(socketId) || null;
  }

  async getTenantIdsAsync(): Promise<string[]> {
    if (this.redisAvailable && this.redis) {
      return this.redis.smembers(this.REDIS_TENANTS_KEY);
    }
    return Array.from(this.tenantUserPresence.keys());
  }

  getTenantIds(): string[] {
    if (this.redisAvailable) return [];
    return Array.from(this.tenantUserPresence.keys());
  }

  /** API: setOnline - marca agente como online */
  async setOnline(tenantId: string, userId: string): Promise<boolean> {
    return this.setStatusAsync(tenantId, userId, 'online');
  }

  /** API: setAway - marca agente como ausente */
  async setAway(tenantId: string, userId: string): Promise<boolean> {
    return this.setStatusAsync(tenantId, userId, 'away');
  }

  /** API: setBusy - marca agente como ocupado */
  async setBusy(tenantId: string, userId: string): Promise<boolean> {
    return this.setStatusAsync(tenantId, userId, 'busy');
  }

  /** API: setOffline - marca agente como offline (remove da presença ativa) */
  async setOffline(tenantId: string, userId: string): Promise<boolean> {
    if (this.redisAvailable && this.redis) {
      const keyData = REDIS_DATA_KEY(tenantId, userId);
      const keyTenant = REDIS_TENANT_USERS_KEY(tenantId);
      await this.redis.del(keyData);
      await this.redis.srem(keyTenant, userId);
      return true;
    }
    const userMap = this.tenantUserPresence.get(tenantId);
    const info = userMap?.get(String(userId));
    if (info) {
      info.status = 'offline';
      return true;
    }
    return false;
  }

  /** API: getStatus - retorna status de um agente */
  async getStatus(tenantId: string, userId: string): Promise<PresenceStatus> {
    const statusMap = await this.getOnlineIdsAndStatus(tenantId);
    return (statusMap.statusMap[userId] as PresenceStatus) || 'offline';
  }

  /** API: getManyStatuses - retorna status de vários agentes */
  async getManyStatuses(tenantId: string, userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const { statusMap } = await this.getOnlineIdsAndStatus(tenantId);
    const result: Record<string, PresenceStatus> = {};
    for (const uid of userIds) {
      result[uid] = (statusMap[uid] as PresenceStatus) || 'offline';
    }
    return result;
  }
}
