import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Mede e enforça quota de disco por tenant.
 *
 * Soma ficheiros nas 3 pastas de upload para o tenant.
 * Resultado é cacheado em memória por QUOTA_CACHE_TTL_MS (padrão: 5 min)
 * para não executar I/O a cada requisição de upload.
 *
 * Variáveis de ambiente:
 *   TENANT_STORAGE_QUOTA_MB  — quota máxima por tenant em MB (padrão: 5000 = 5 GB)
 *   QUOTA_CACHE_TTL_MS       — TTL do cache em ms (padrão: 300000 = 5 min)
 */
@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  private readonly uploadDirs = [
    process.env.CONVERSATION_MEDIA_DIR  || path.join(process.cwd(), 'uploads', 'conversation-media'),
    process.env.TICKET_REPLY_MEDIA_DIR  || path.join(process.cwd(), 'uploads', 'ticket-reply-media'),
    process.env.TICKET_ATTACHMENTS_DIR  || path.join(process.cwd(), 'uploads', 'ticket-attachments'),
  ];

  private readonly quotaBytes =
    Math.max(1, parseInt(process.env.TENANT_STORAGE_QUOTA_MB ?? '5000', 10) || 5000) *
    1024 * 1024;

  private readonly cacheTtlMs =
    Math.max(10_000, parseInt(process.env.QUOTA_CACHE_TTL_MS ?? '300000', 10) || 300_000);

  /** Cache em memória: tenantId → { bytes, expiresAt } */
  private readonly cache = new Map<string, { bytes: number; expiresAt: number }>();

  /**
   * Devolve o uso total em bytes para o tenant, lendo do cache ou do disco.
   */
  async getTenantUsageBytes(tenantId: string): Promise<number> {
    const now = Date.now();
    const cached = this.cache.get(tenantId);
    if (cached && now < cached.expiresAt) return cached.bytes;

    let total = 0;
    for (const root of this.uploadDirs) {
      total += await this.sumDir(path.join(root, tenantId));
    }

    this.cache.set(tenantId, { bytes: total, expiresAt: now + this.cacheTtlMs });
    return total;
  }

  /**
   * Retorna true se o tenant estiver no limite ou acima.
   * Loga um aviso com os valores actuais.
   */
  async isOverQuota(tenantId: string): Promise<boolean> {
    const usage = await this.getTenantUsageBytes(tenantId);
    if (usage >= this.quotaBytes) {
      this.logger.warn(
        `[quota] tenant=${tenantId} ` +
        `uso=${(usage / 1_048_576).toFixed(1)} MB ` +
        `>= quota=${(this.quotaBytes / 1_048_576).toFixed(0)} MB`,
      );
      return true;
    }
    return false;
  }

  /**
   * Invalida o cache para o tenant (chamar após upload/delete bem-sucedido).
   */
  invalidateCache(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  // ─── Privado ──────────────────────────────────────────────────────────────

  private async sumDir(dir: string): Promise<number> {
    const exists = await fs.promises.access(dir).then(() => true).catch(() => false);
    if (!exists) return 0;

    let total = 0;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      await Promise.all(
        entries.map(async (e) => {
          const fullPath = path.join(dir, e.name);
          if (e.isFile()) {
            const stat = await fs.promises.stat(fullPath).catch(() => null);
            if (stat) total += stat.size;
          } else if (e.isDirectory()) {
            // Suporta {tenantId}/{YYYY-MM}/ sem profundidade arbitrária
            total += await this.sumDir(fullPath);
          }
        }),
      );
    } catch (err) {
      this.logger.error(`[quota] erro ao medir ${dir}: ${(err as Error).message}`);
    }
    return total;
  }
}
