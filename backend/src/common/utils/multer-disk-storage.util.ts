import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { diskStorage } from 'multer';

// ── Roots exportados ─────────────────────────────────────────────────────────
// Usados pelos controllers para calcular storageKey relativo ao root
// sem repetir a lógica de env var.

export const CONVERSATION_MEDIA_ROOT =
  process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');

export const TICKET_REPLY_MEDIA_ROOT =
  process.env.TICKET_REPLY_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'ticket-reply-media');

export const TICKET_ATTACHMENTS_ROOT =
  process.env.TICKET_ATTACHMENTS_DIR || path.join(process.cwd(), 'uploads', 'ticket-attachments');

/**
 * Converte o caminho absoluto retornado pelo multer em storage key
 * relativa ao root (formato: `{tenantId}/{YYYY-MM}/{filename}`).
 */
export function filePathToStorageKey(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

/** Retorna o mês corrente no formato YYYY-MM. */
function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ── Disk storages ─────────────────────────────────────────────────────────────

/** Upload de mídia em conversa → CONVERSATION_MEDIA_DIR/{tenantId}/{YYYY-MM}/agent-{uuid}.{ext} */
export function conversationMediaDiskStorage() {
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(CONVERSATION_MEDIA_ROOT, tenantId, currentYearMonth());
      fs.promises.mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err: Error) => cb(err, ''));
    },
    filename: (_req, file, cb) => {
      const mime = (file.mimetype || '').toLowerCase();
      let ext = 'bin';
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.startsWith('image/')) ext = 'jpg';
      else if (mime.includes('webm')) ext = 'webm';
      else if (mime.includes('ogg')) ext = 'ogg';
      else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
      else if (mime.startsWith('video/')) {
        if (mime.includes('mp4')) ext = 'mp4';
        else if (mime.includes('webm')) ext = 'webm';
        else if (mime.includes('quicktime')) ext = 'mov';
        else if (mime.includes('3gpp')) ext = '3gp';
        else ext = 'mp4';
      } else if (mime.startsWith('audio/')) ext = 'm4a';
      // Documentos: preserva extensão correta para que o WhatsApp exiba o tipo certo
      else if (mime === 'application/pdf') ext = 'pdf';
      else if (mime === 'text/plain') ext = 'txt';
      else if (mime === 'text/csv' || mime === 'application/csv') ext = 'csv';
      else if (mime === 'application/msword') ext = 'doc';
      else if (mime.includes('wordprocessingml')) ext = 'docx';
      else if (mime === 'application/vnd.ms-excel') ext = 'xls';
      else if (mime.includes('spreadsheetml')) ext = 'xlsx';
      else if (mime === 'application/zip' || mime === 'application/x-zip-compressed') ext = 'zip';
      else if (mime.includes('rar')) ext = 'rar';
      else {
        // Fallback: tenta preservar extensão do nome original
        const origExt = path.extname((file as any).originalname || '').replace(/^\./, '').toLowerCase();
        if (origExt && /^[a-z0-9]{1,6}$/.test(origExt)) ext = origExt;
      }
      cb(null, `agent-${crypto.randomUUID()}.${ext}`);
    },
  });
}

/** POST /tickets/:id/messages/attachment → TICKET_REPLY_MEDIA_DIR/{tenantId}/{YYYY-MM}/ticket-{uuid}{ext} */
export function ticketReplyMediaDiskStorage() {
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(TICKET_REPLY_MEDIA_ROOT, tenantId, currentYearMonth());
      fs.promises.mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err: Error) => cb(err, ''));
    },
    filename: (_req, file, cb) => {
      const safeBase = path
        .basename((file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120));
      const extFromName = path.extname(safeBase);
      const ext = extFromName || '.bin';
      cb(null, `ticket-${crypto.randomUUID()}${ext}`);
    },
  });
}

/** POST /tickets/:id/attachments → TICKET_ATTACHMENTS_DIR/{tenantId}/{YYYY-MM}/{uuid}.{ext} */
export function ticketItem4AttachmentsDiskStorage() {
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(TICKET_ATTACHMENTS_ROOT, tenantId, currentYearMonth());
      fs.promises.mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err: Error) => cb(err, ''));
    },
    filename: (_req, file, cb) => {
      const m = (file.mimetype || '').toLowerCase().split(';')[0].trim();
      const extMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'application/pdf': '.pdf',
      };
      const ext = extMap[m] || '.bin';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
}
