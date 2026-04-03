import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { diskStorage } from 'multer';

/** Upload de mídia em conversa → CONVERSATION_MEDIA_DIR/{tenantId}/agent-{uuid}.{ext} */
export function conversationMediaDiskStorage() {
  const mediaRoot =
    process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(mediaRoot, tenantId);
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
      else if (mime.includes('ogg')) ext = 'ogg';
      else if (mime.includes('mpeg') || mime.includes('mp3')) ext = 'mp3';
      else if (mime.startsWith('video/')) {
        if (mime.includes('mp4')) ext = 'mp4';
        else if (mime.includes('webm')) ext = 'webm';
        else if (mime.includes('quicktime')) ext = 'mov';
        else if (mime.includes('3gpp')) ext = '3gp';
        else ext = 'mp4';
      } else if (mime.startsWith('audio/')) ext = 'm4a';
      cb(null, `agent-${crypto.randomUUID()}.${ext}`);
    },
  });
}

/** POST /tickets/:id/messages/attachment → TICKET_REPLY_MEDIA_DIR/{tenantId}/ticket-{uuid}{ext} */
export function ticketReplyMediaDiskStorage() {
  const root =
    process.env.TICKET_REPLY_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'ticket-reply-media');
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(root, tenantId);
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

/** POST /tickets/:id/attachments → TICKET_ATTACHMENTS_DIR/{tenantId}/{uuid}.{ext} */
export function ticketItem4AttachmentsDiskStorage() {
  const root =
    process.env.TICKET_ATTACHMENTS_DIR || path.join(process.cwd(), 'uploads', 'ticket-attachments');
  return diskStorage({
    destination: (req: any, _file, cb) => {
      const tenantId = req.tenantId as string | undefined;
      if (!tenantId) {
        cb(new Error('Sem tenant'), '');
        return;
      }
      const dir = path.join(root, tenantId);
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
