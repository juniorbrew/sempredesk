import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Job semanal que remove ficheiros gravados pelo multer (diskStorage)
 * sem registo correspondente na base de dados (órfãos).
 *
 * Causa típica: multer gravou o ficheiro em disco, mas a transação
 * do Postgres falhou a seguir (validação de negócio, timeout, etc.).
 *
 * Diretórios vigiados:
 *   CONVERSATION_MEDIA_DIR  → conversation_messages.media_storage_key
 *   TICKET_REPLY_MEDIA_DIR  → ticket_reply_attachments.storage_key
 *   TICKET_ATTACHMENTS_DIR  → ticket_reply_attachments.storage_key
 *
 * Variáveis de ambiente:
 *   CLEANUP_ORPHAN_MIN_AGE_HOURS        (padrão: 24) — grace period antes de apagar órfãos
 *   CONVERSATION_MEDIA_RETENTION_DAYS   (padrão: 90) — retenção de média de conversas
 *   CLEANUP_CRON                        (padrão: domingo 03:00)
 */
@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  private readonly conversationMediaRoot =
    process.env.CONVERSATION_MEDIA_DIR ||
    path.join(process.cwd(), 'uploads', 'conversation-media');

  private readonly ticketReplyMediaRoot =
    process.env.TICKET_REPLY_MEDIA_DIR ||
    path.join(process.cwd(), 'uploads', 'ticket-reply-media');

  private readonly ticketAttachmentsRoot =
    process.env.TICKET_ATTACHMENTS_DIR ||
    path.join(process.cwd(), 'uploads', 'ticket-attachments');

  private readonly minAgeHours = Math.max(
    1,
    parseInt(process.env.CLEANUP_ORPHAN_MIN_AGE_HOURS ?? '24', 10) || 24,
  );

  private readonly conversationMediaRetentionDays = Math.max(
    1,
    parseInt(process.env.CONVERSATION_MEDIA_RETENTION_DAYS ?? '90', 10) || 90,
  );

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Domingo às 03:00 — órfãos + retenção de conversation-media. */
  @Cron('0 3 * * 0')
  async runWeeklyCleanup(): Promise<void> {
    await this.run();
    await this.runRetentionCleanup();
  }

  /** Pode ser invocado manualmente (ex.: via script ou teste). */
  async run(): Promise<{ deleted: number; bytes: number }> {
    this.logger.log(
      `[cleanup] Início — grace period: ${this.minAgeHours}h`,
    );

    const now = Date.now();
    const minAgeMs = this.minAgeHours * 3_600_000;

    // Chaves válidas por tabela
    const [convKeys, attKeys] = await Promise.all([
      this.fetchValidKeys(
        `SELECT media_storage_key AS k
         FROM conversation_messages
         WHERE media_storage_key IS NOT NULL`,
      ),
      this.fetchValidKeys(
        `SELECT storage_key AS k
         FROM ticket_reply_attachments
         WHERE storage_key IS NOT NULL`,
      ),
    ]);

    const [r1, r2, r3] = await Promise.all([
      this.cleanDirectory(this.conversationMediaRoot, convKeys, now, minAgeMs),
      this.cleanDirectory(this.ticketReplyMediaRoot, attKeys, now, minAgeMs),
      this.cleanDirectory(this.ticketAttachmentsRoot, attKeys, now, minAgeMs),
    ]);

    const deleted = r1.deleted + r2.deleted + r3.deleted;
    const bytes   = r1.bytes   + r2.bytes   + r3.bytes;

    this.logger.log(
      `[cleanup] Concluído — ${deleted} ficheiro(s) removido(s), ` +
      `${(bytes / 1024).toFixed(1)} KB libertados`,
    );

    return { deleted, bytes };
  }

  /**
   * Remove ficheiros de conversation-media mais antigos que
   * CONVERSATION_MEDIA_RETENTION_DAYS (padrão 90 dias) e limpa
   * media_storage_key no DB para evitar links quebrados no frontend.
   *
   * Processa em lotes de 200 para não saturar memória.
   */
  async runRetentionCleanup(): Promise<{ deleted: number; bytes: number }> {
    const retentionDays = this.conversationMediaRetentionDays;
    this.logger.log(
      `[retention] Início — retenção conversation-media: ${retentionDays} dias`,
    );

    let deleted = 0;
    let bytes = 0;
    const batchSize = 200;
    let offset = 0;

    while (true) {
      const rows: Array<{ id: string; media_storage_key: string }> =
        await this.dataSource.query(
          `SELECT id, media_storage_key
           FROM conversation_messages
           WHERE media_storage_key IS NOT NULL
             AND created_at < NOW() - INTERVAL '${retentionDays} days'
           ORDER BY created_at ASC
           LIMIT ${batchSize} OFFSET ${offset}`,
        );

      if (rows.length === 0) break;

      const expiredIds: string[] = [];

      for (const { id, media_storage_key } of rows) {
        // Normalizar e proteger contra path traversal
        const normalised = path.normalize(media_storage_key).replace(/^(\.\.(\/|\\|$))+/, '');
        const filePath = path.join(this.conversationMediaRoot, normalised);

        if (!filePath.startsWith(path.resolve(this.conversationMediaRoot) + path.sep)) {
          this.logger.warn(`[retention] Chave suspeita ignorada: ${media_storage_key}`);
          expiredIds.push(id);
          continue;
        }

        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (stat) {
          try {
            await fs.promises.unlink(filePath);
            bytes += stat.size;
            deleted++;
            this.logger.debug(`[retention] Removido: ${media_storage_key} (${stat.size} B)`);
          } catch (err) {
            this.logger.error(
              `[retention] Erro ao remover ${filePath}: ${(err as Error).message}`,
            );
            continue;
          }
        }
        // Ficheiro já não existe (removido anteriormente ou nunca chegou) — limpar DB na mesma
        expiredIds.push(id);
      }

      if (expiredIds.length > 0) {
        await this.dataSource.query(
          `UPDATE conversation_messages
           SET media_storage_key = NULL
           WHERE id = ANY($1)`,
          [expiredIds],
        );
      }

      offset += rows.length;
      if (rows.length < batchSize) break;
    }

    this.logger.log(
      `[retention] Concluído — ${deleted} ficheiro(s) removido(s), ` +
      `${(bytes / 1024).toFixed(1)} KB libertados`,
    );

    return { deleted, bytes };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async fetchValidKeys(query: string): Promise<Set<string>> {
    const rows: Array<{ k: string }> = await this.dataSource.query(query);
    const set = new Set<string>();
    for (const { k } of rows) {
      if (k) set.add(k);
    }
    return set;
  }

  private async cleanDirectory(
    root: string,
    validKeys: Set<string>,
    now: number,
    minAgeMs: number,
  ): Promise<{ deleted: number; bytes: number }> {
    let deleted = 0;
    let bytes = 0;

    const rootExists = await fs.promises.access(root).then(() => true).catch(() => false);
    if (!rootExists) return { deleted, bytes };

    // Coleta todos os arquivos recursivamente (suporta flat e {tenantId}/{YYYY-MM}/)
    const files = await this.listFilesUnderRoot(root, root);

    for (const { filePath, storageKey } of files) {
      if (validKeys.has(storageKey)) continue;

      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) continue;
      if (now - stat.mtimeMs < minAgeMs) continue;

      try {
        const size = stat.size;
        await fs.promises.unlink(filePath);
        deleted++;
        bytes += size;
        this.logger.warn(
          `[cleanup] Removido: ${storageKey} ` +
          `(${size} B, ${Math.round((now - stat.mtimeMs) / 3_600_000)}h atrás)`,
        );
      } catch (err) {
        this.logger.error(
          `[cleanup] Erro ao remover ${filePath}: ${(err as Error).message}`,
        );
      }
    }

    return { deleted, bytes };
  }

  /**
   * Lista recursivamente todos os arquivos abaixo de `dir`,
   * calculando o storageKey como caminho relativo ao `root`.
   * Suporta tanto `root/{tenantId}/{file}` quanto `root/{tenantId}/{YYYY-MM}/{file}`.
   */
  private async listFilesUnderRoot(
    root: string,
    dir: string,
  ): Promise<Array<{ filePath: string; storageKey: string }>> {
    const result: Array<{ filePath: string; storageKey: string }> = [];
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile()) {
        const storageKey = path.relative(root, fullPath).split(path.sep).join('/');
        result.push({ filePath: fullPath, storageKey });
      } else if (entry.isDirectory()) {
        const sub = await this.listFilesUnderRoot(root, fullPath);
        result.push(...sub);
      }
    }
    return result;
  }
}
