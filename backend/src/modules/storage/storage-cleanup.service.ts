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
 *   CLEANUP_ORPHAN_MIN_AGE_HOURS  (padrão: 24) — grace period antes de apagar
 *   CLEANUP_CRON                  (padrão: domingo 03:00)
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

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** Domingo às 03:00 (horário do servidor). */
  @Cron('0 3 * * 0')
  async runWeeklyCleanup(): Promise<void> {
    await this.run();
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

    if (!fs.existsSync(root)) return { deleted, bytes };

    // Estrutura esperada: root/{tenantId}/{filename}
    let tenantDirs: string[];
    try {
      tenantDirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (err) {
      this.logger.error(`[cleanup] Erro ao listar ${root}: ${(err as Error).message}`);
      return { deleted, bytes };
    }

    for (const tenantId of tenantDirs) {
      const tenantPath = path.join(root, tenantId);

      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(tenantPath, { withFileTypes: true }).filter((e) => e.isFile());
      } catch {
        continue;
      }

      for (const f of files) {
        const storageKey = `${tenantId}/${f.name}`;

        // Tem registo válido no DB → não é órfão
        if (validKeys.has(storageKey)) continue;

        const filePath = path.join(tenantPath, f.name);

        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }

        // Dentro do grace period → pode ser um upload em curso
        if (now - stat.mtimeMs < minAgeMs) continue;

        try {
          const size = stat.size;
          fs.unlinkSync(filePath);
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
    }

    return { deleted, bytes };
  }
}
