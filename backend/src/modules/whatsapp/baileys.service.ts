import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject, Observable } from 'rxjs';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { WhatsappConnection, WhatsappConnectionStatus, WhatsappProvider } from './entities/whatsapp-connection.entity';
import { StorageQuotaService } from '../storage/storage-quota.service';

export interface QrEvent {
  qr: string; // base64 data URL
  tenantId: string;
}

export interface StatusEvent {
  tenantId: string;
  status: WhatsappConnectionStatus;
  phoneNumber?: string | null;
}

export interface SendMessageResult {
  success: boolean;
  jid?: string;
  messageId?: string;
  error?: string;
}

export interface CheckNumberResult {
  exists: boolean;
  jid: string | null;
  normalized: string;
  candidates: string[];
}

@Injectable()
export class BaileysService {
  private readonly logger = new Logger(BaileysService.name);
  private sessions = new Map<string, any>(); // tenantId -> sock
  private qrSubjects = new Map<string, Subject<MessageEvent>>();
  private statusSubjects = new Map<string, Subject<MessageEvent>>();
  private lastQrs = new Map<string, string>();
  private emitter = new EventEmitter();
  private intentionalDisconnects = new Set<string>();
  private reconnectAttempts = new Map<string, number>(); // tenantId -> attempt count
  private readonly sessionsDir = process.env.WHATSAPP_SESSIONS_DIR || '/app/whatsapp-sessions';
  /** Mídia recebida/enviada nas conversas (imagens/áudio WhatsApp). */
  private readonly conversationMediaDir = process.env.CONVERSATION_MEDIA_DIR || path.join(process.cwd(), 'uploads', 'conversation-media');

  // ── Rate limiting de envio ──────────────────────────────────────────────────
  // Fila por tenant: serializa envios e impõe delay mínimo entre mensagens
  // consecutivas para evitar bloqueio do WhatsApp por envio em rajada.
  private sendQueues = new Map<string, Promise<void>>();
  private lastSendTime = new Map<string, number>(); // tenantId → timestamp do último envio
  private readonly SEND_DELAY_MS = parseInt(process.env.WHATSAPP_SEND_DELAY_MS ?? '1200', 10);

  private extractDigitsFromJid(jid?: string | null): string | null {
    const raw = String(jid || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/@s\.whatsapp\.net|@lid|@c\.us|@hosted|@hosted\.lid/g, '').trim();
    const userPart = cleaned.split(':')[0]?.trim() || '';
    const digits = userPart.replace(/\D/g, '');
    return digits || null;
  }

  private buildPhoneCandidateJids(digits: string): string[] {
    const normalized = this.extractDigitsFromJid(digits);
    if (!normalized) return [];

    // Brasil: 55 + DDD + número (12 dígitos sem 9, 13 com 9)
    if (normalized.startsWith('55') && normalized.length === 12) {
      const ddd = normalized.slice(2, 4);
      const num = normalized.slice(4);
      return [`55${ddd}9${num}@s.whatsapp.net`, `${normalized}@s.whatsapp.net`];
    }

    if (normalized.startsWith('55') && normalized.length === 13) {
      const ddd = normalized.slice(2, 4);
      const numSem9 = normalized.slice(5);
      return [`${normalized}@s.whatsapp.net`, `55${ddd}${numSem9}@s.whatsapp.net`];
    }

    // Internacional (ex: Argentina +54): números de 12–13 dígitos com DDI de 2 dígitos
    // podem ter um "9" móvel logo após o DDI (posição 2). Testa as duas variantes e
    // deixa o onWhatsApp() escolher o JID correto — sem alterar números que não se encaixam.
    if (normalized.length === 13 && normalized.charAt(2) === '9') {
      // Tem o 9: testa com 9 (original) e sem 9 (remove posição 2)
      const withoutNine = normalized.slice(0, 2) + normalized.slice(3);
      return [`${normalized}@s.whatsapp.net`, `${withoutNine}@s.whatsapp.net`];
    }
    if (normalized.length === 12 && !normalized.startsWith('55')) {
      // Sem o 9: testa sem 9 (original) e com 9 (insere na posição 2)
      const withNine = normalized.slice(0, 2) + '9' + normalized.slice(2);
      return [`${normalized}@s.whatsapp.net`, `${withNine}@s.whatsapp.net`];
    }

    return [`${normalized}@s.whatsapp.net`];
  }

  private async resolvePreferredInboundDigits(sock: any, digits?: string | null): Promise<string | null> {
    const normalized = this.extractDigitsFromJid(digits);
    if (!normalized) return null;
    if (!normalized.startsWith('55') || (normalized.length !== 12 && normalized.length !== 13)) {
      return normalized;
    }

    try {
      const candidates = this.buildPhoneCandidateJids(normalized);
      const results: Array<{ exists: boolean; jid: string }> = await sock.onWhatsApp(...candidates);
      const found = results?.find((result) => result.exists && result.jid);
      const preferredDigits = this.extractDigitsFromJid(found?.jid);
      if (preferredDigits) {
        return preferredDigits;
      }
    } catch (error: any) {
      this.logger.warn(`[INBOUND] onWhatsApp falhou ao validar número aprendido ${normalized}: ${error?.message}`);
    }

    return normalized;
  }

  /**
   * Enfileira uma operação de envio para o tenant.
   * - Se o último envio foi há mais de SEND_DELAY_MS: executa imediatamente.
   * - Se foi recente: aguarda o intervalo restante antes de enviar.
   * Falhas em envios anteriores não bloqueiam a fila.
   */
  private enqueueOutbound<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sendQueues.get(tenantId) ?? Promise.resolve();
    const current: Promise<T> = prev
      .catch(() => {}) // falha anterior não bloqueia a fila
      .then(async () => {
        const elapsed = Date.now() - (this.lastSendTime.get(tenantId) ?? 0);
        if (elapsed < this.SEND_DELAY_MS) {
          await new Promise<void>((r) => setTimeout(r, this.SEND_DELAY_MS - elapsed));
        }
        const result = await fn();
        this.lastSendTime.set(tenantId, Date.now());
        return result;
      });
    this.sendQueues.set(tenantId, current.then(() => {}, () => {}));
    return current;
  }

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly connRepo: Repository<WhatsappConnection>,
    private readonly quotaService: StorageQuotaService,
  ) {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    if (!fs.existsSync(this.conversationMediaDir)) {
      fs.mkdirSync(this.conversationMediaDir, { recursive: true });
    }
  }

  private extForMime(mime?: string | null): string {
    const m = (mime || '').toLowerCase().split(';')[0].trim();
    if (m.startsWith('video/')) {
      if (m.includes('webm')) return 'webm';
      if (m.includes('quicktime')) return 'mov';
      if (m.includes('3gpp')) return '3gp';
      if (m.includes('mp4')) return 'mp4';
      return 'mp4';
    }
    if (m.includes('png')) return 'png';
    if (m.includes('webp')) return 'webp';
    if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
    if (m.includes('opus')) return 'opus';
    return 'bin';
  }

  /** Grava buffer recebido do WhatsApp e devolve chave relativa a CONVERSATION_MEDIA_DIR. */
  private async saveInboundMedia(tenantId: string, waMessageId: string, kind: 'image' | 'audio' | 'video', buffer: Buffer, mime: string): Promise<string> {
    if (await this.quotaService.isOverQuota(tenantId)) {
      this.logger.warn(`[INBOUND] tenant=${tenantId} over storage quota — mídia ${kind} descartada`);
      throw new Error('Cota de armazenamento excedida para este tenant');
    }
    const yyyyMM = new Date().toISOString().slice(0, 7);
    const dir = path.join(this.conversationMediaDir, tenantId, yyyyMM);
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = this.extForMime(mime);
    const safeId = String(waMessageId || 'msg').replace(/[^\w.-]/g, '_');
    const fname = `${safeId}.${ext}`;
    const full = path.join(dir, fname);
    await fs.promises.writeFile(full, buffer);
    this.logger.log(JSON.stringify({
      event: 'upload.whatsapp_inbound_media',
      tenantId,
      kind,
      sizeBytes: buffer.byteLength,
      mime,
    }));
    this.quotaService.invalidateCache(tenantId);
    return path.posix.join(tenantId, yyyyMM, fname);
  }

  private onMessageCallback: ((
    tenantId: string,
    from: string,
    text: string,
    messageId: string,
    senderName?: string,
    isLid?: boolean,
    resolvedDigits?: string | null,
    media?: { kind: 'image' | 'audio' | 'video'; storageKey: string; mime: string } | null,
    quotedStanzaId?: string | null,
  ) => void) | null = null;

  setMessageHandler(cb: (
    tenantId: string,
    from: string,
    text: string,
    messageId: string,
    senderName?: string,
    isLid?: boolean,
    resolvedDigits?: string | null,
    media?: { kind: 'image' | 'audio' | 'video'; storageKey: string; mime: string } | null,
    quotedStanzaId?: string | null,
  ) => void) {
    this.onMessageCallback = cb;
  }

  private onStatusUpdateCallback: ((tenantId: string, externalId: string, status: string) => void) | null = null;

  setStatusUpdateHandler(cb: (tenantId: string, externalId: string, status: string) => void) {
    this.onStatusUpdateCallback = cb;
  }

  /** Emitter para repassar eventos de presença do contato ao frontend via WebSocket */
  private realtimeEmitter: any = null;
  setRealtimeEmitter(emitter: any) { this.realtimeEmitter = emitter; }

  /**
   * Envia indicador de "digitando..." ou "parou de digitar" para um contato via WhatsApp.
   * Chamado pelo RealtimeGateway quando o agente está digitando no chat.
   */
  async sendPresenceUpdate(tenantId: string, to: string, presence: 'composing' | 'paused'): Promise<void> {
    const sock = this.sessions.get(tenantId);
    if (!sock) return;
    let jid = to;
    if (!jid.includes('@')) {
      const digits = to.replace(/\D/g, '');
      jid = digits.length >= 14 ? `${digits}@lid` : `${digits}@s.whatsapp.net`;
    }
    try {
      await sock.sendPresenceUpdate(presence, jid);
    } catch (e: any) {
      this.logger.warn(`[PRESENCE] sendPresenceUpdate ${presence} para ${jid} falhou: ${e?.message}`);
    }
  }

  /**
   * Assina atualizações de presença de um contato (necessário para receber presence.update).
   */
  async subscribePresence(tenantId: string, jid: string): Promise<void> {
    const sock = this.sessions.get(tenantId);
    if (!sock) return;
    try {
      await sock.subscribePresence(jid);
    } catch (e: any) {
      this.logger.warn(`[PRESENCE] subscribePresence para ${jid} falhou: ${e?.message}`);
    }
  }

  /**
   * Envia confirmação de leitura para mensagens do contato via Baileys.
   * Chamado quando o agente abre uma conversa no dashboard.
   */
  async markMessagesRead(tenantId: string, remoteJid: string, messageIds: string[]): Promise<void> {
    if (!messageIds.length) return;
    const sock = this.sessions.get(tenantId);
    if (!sock) return;
    try {
      const keys = messageIds.map((id) => ({ remoteJid, id, fromMe: false, participant: undefined }));
      await sock.readMessages(keys);
      this.logger.log(`[markRead] tenantId=${tenantId} jid=${remoteJid} count=${messageIds.length}`);
    } catch (e: any) {
      this.logger.warn(`[markRead] Falha ao enviar read receipts: ${e?.message}`);
    }
  }

  getQrObservable(tenantId: string): Observable<MessageEvent> {
    if (!this.qrSubjects.has(tenantId)) {
      this.qrSubjects.set(tenantId, new Subject<MessageEvent>());
    }
    return this.qrSubjects.get(tenantId)!.asObservable();
  }

  getStatusObservable(tenantId: string): Observable<MessageEvent> {
    if (!this.statusSubjects.has(tenantId)) {
      this.statusSubjects.set(tenantId, new Subject<MessageEvent>());
    }
    return this.statusSubjects.get(tenantId)!.asObservable();
  }

  getLastQr(tenantId: string): string | null {
    return this.lastQrs.get(tenantId) || null;
  }

  private emitQr(tenantId: string, qrDataUrl: string) {
    this.lastQrs.set(tenantId, qrDataUrl);
    const subject = this.qrSubjects.get(tenantId);
    if (subject) {
      subject.next({ data: JSON.stringify({ type: 'qr', qr: qrDataUrl }) } as MessageEvent);
    }
  }

  private emitStatus(tenantId: string, status: WhatsappConnectionStatus, phoneNumber?: string | null) {
    const subject = this.statusSubjects.get(tenantId);
    if (subject) {
      subject.next({ data: JSON.stringify({ type: 'status', status, phoneNumber }) } as MessageEvent);
    }
    const qrSubject = this.qrSubjects.get(tenantId);
    if (qrSubject) {
      qrSubject.next({ data: JSON.stringify({ type: 'status', status, phoneNumber }) } as MessageEvent);
    }
  }

  async getOrCreateConnection(tenantId: string): Promise<WhatsappConnection> {
    let conn = await this.connRepo.findOne({ where: { tenantId } });
    if (!conn) {
      conn = this.connRepo.create({ tenantId, provider: WhatsappProvider.BAILEYS, status: WhatsappConnectionStatus.DISCONNECTED });
      await this.connRepo.save(conn);
    }
    return conn;
  }

  async getStatus(tenantId: string): Promise<{ status: WhatsappConnectionStatus; provider: WhatsappProvider; phoneNumber?: string | null; reconnecting?: boolean }> {
    const conn = await this.getOrCreateConnection(tenantId);
    const liveSession = this.sessions.get(tenantId);

    // If DB says CONNECTED but there's no live session AND no reconnect in progress,
    // only then mark as disconnected. Don't touch the DB during transient reconnect windows.
    if (!liveSession && conn.status === WhatsappConnectionStatus.CONNECTED) {
      const attempts = this.reconnectAttempts.get(tenantId) ?? 0;
      const isReconnecting = attempts > 0;
      if (!isReconnecting) {
        conn.status = WhatsappConnectionStatus.DISCONNECTED;
        await this.connRepo.save(conn);
      }
    }

    // Expose whether we're in an auto-reconnect cycle so the frontend can show the right UI
    const reconnecting = (conn.status === WhatsappConnectionStatus.CONNECTING)
      && (this.reconnectAttempts.get(tenantId) ?? 0) > 0;

    return { status: conn.status, provider: conn.provider, phoneNumber: conn.phoneNumber, reconnecting };
  }

  async startQrSession(tenantId: string): Promise<void> {
    // If there's already a session, close it cleanly first
    if (this.sessions.has(tenantId)) {
      this.logger.log(`Session already exists for tenant ${tenantId}, disconnecting first`);
      await this.disconnect(tenantId);
      // Small delay to ensure cleanup completes before re-connecting
      await new Promise(r => setTimeout(r, 500));
    }

    // Clear any intentional disconnect flag so reconnect logic works
    this.intentionalDisconnects.delete(tenantId);

    const conn = await this.getOrCreateConnection(tenantId);
    conn.status = WhatsappConnectionStatus.CONNECTING;
    conn.provider = WhatsappProvider.BAILEYS;
    await this.connRepo.save(conn);

    this.emitStatus(tenantId, WhatsappConnectionStatus.CONNECTING);

    try {
      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys') as any;
      const qrcodeModule = await import('qrcode') as any;
      const QRCode = qrcodeModule.default ?? qrcodeModule;
      const pinoModule = await import('pino');
      const pinoFn: any = (pinoModule as any).default ?? pinoModule;
      const pinoLogger = pinoFn({ level: 'silent' });

      const authDir = path.join(this.sessionsDir, tenantId);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      let version: number[];
      let isLatest = false;
      try {
        const versionInfo = await fetchLatestBaileysVersion();
        version = versionInfo.version;
        isLatest = versionInfo.isLatest;
      } catch (e) {
        // Fallback to a known-good version when fetch fails (e.g. no internet access to GitHub)
        version = [2, 3000, 1023456789];
        this.logger.warn(`fetchLatestBaileysVersion failed, using fallback version: ${version.join('.')}`);
      }
      this.logger.log(`Baileys WA version: ${version.join('.')}, isLatest: ${isLatest}`);

      const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.ubuntu('SempreDesk'),
        printQRInTerminal: false,
        logger: pinoLogger,
        connectTimeoutMs: 30_000,
        qrTimeout: 60_000,
        keepAliveIntervalMs: 25_000,
        retryRequestDelayMs: 2_000,
      });

      this.sessions.set(tenantId, sock);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 1 });
            this.logger.log(`QR code generated for tenant ${tenantId}`);
            this.emitQr(tenantId, qrDataUrl);
          } catch (e) {
            this.logger.error('Error generating QR code', e);
          }
        }

        if (connection === 'close') {
          this.sessions.delete(tenantId);

          // If we intentionally disconnected, do NOT reconnect
          if (this.intentionalDisconnects.has(tenantId)) {
            this.logger.log(`Connection closed intentionally for tenant ${tenantId}`);
            this.intentionalDisconnects.delete(tenantId);
            const freshConn = await this.getOrCreateConnection(tenantId);
            freshConn.status = WhatsappConnectionStatus.DISCONNECTED;
            freshConn.phoneNumber = null;
            await this.connRepo.save(freshConn);
            this.lastQrs.delete(tenantId);
            this.emitStatus(tenantId, WhatsappConnectionStatus.DISCONNECTED, null);
            return;
          }

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.logger.log(`Connection closed for tenant ${tenantId}. StatusCode: ${statusCode}, Reconnect: ${shouldReconnect}`);

          if (shouldReconnect) {
            const freshConn = await this.getOrCreateConnection(tenantId);
            if (freshConn.status !== WhatsappConnectionStatus.DISCONNECTED) {
              const attempts = (this.reconnectAttempts.get(tenantId) ?? 0) + 1;
              this.reconnectAttempts.set(tenantId, attempts);
              // Exponential backoff: 3s, 6s, 12s, capped at 30s
              const delayMs = Math.min(3000 * Math.pow(2, attempts - 1), 30_000);
              this.logger.log(`Reconnecting tenant ${tenantId} in ${delayMs}ms (attempt ${attempts})`);
              freshConn.status = WhatsappConnectionStatus.CONNECTING;
              await this.connRepo.save(freshConn);
              setTimeout(() => this.startQrSession(tenantId), delayMs);
            } else {
              this.reconnectAttempts.delete(tenantId);
              this.lastQrs.delete(tenantId);
              this.emitStatus(tenantId, WhatsappConnectionStatus.DISCONNECTED, null);
            }
          } else {
            // Logged out — clear auth state
            const authDir = path.join(this.sessionsDir, tenantId);
            if (fs.existsSync(authDir)) {
              fs.rmSync(authDir, { recursive: true, force: true });
            }
            const freshConn = await this.getOrCreateConnection(tenantId);
            freshConn.status = WhatsappConnectionStatus.DISCONNECTED;
            freshConn.phoneNumber = null;
            await this.connRepo.save(freshConn);
            this.lastQrs.delete(tenantId);
            this.emitStatus(tenantId, WhatsappConnectionStatus.DISCONNECTED, null);
          }
        }

        if (connection === 'open') {
          this.reconnectAttempts.delete(tenantId); // reset backoff on successful connect
          this.logger.log(`Connected to WhatsApp for tenant ${tenantId}`);
          const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.lid?.split(':')[0] || null;
          const freshConn = await this.getOrCreateConnection(tenantId);
          freshConn.status = WhatsappConnectionStatus.CONNECTED;
          freshConn.phoneNumber = phoneNumber;
          await this.connRepo.save(freshConn);
          this.lastQrs.delete(tenantId);
          this.emitStatus(tenantId, WhatsappConnectionStatus.CONNECTED, phoneNumber);
        }
      });

      sock.ev.on('messages.upsert', async (m: any) => {
        if (m.type !== 'notify') return; // ignore history sync
        const msg = m.messages[0];
        if (!msg || msg.key.fromMe) return;
        const remoteJid: string = msg.key.remoteJid || '';
        // Skip group messages (@g.us) and status broadcasts
        if (remoteJid.includes('@g.us') || remoteJid === 'status@broadcast') return;
        let text =
          msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || msg.message?.videoMessage?.caption
          || msg.message?.documentMessage?.caption
          || '';
        let media: { kind: 'image' | 'audio' | 'video'; storageKey: string; mime: string } | null = null;
        const img = msg.message?.imageMessage;
        const vid = msg.message?.videoMessage;
        const aud = msg.message?.audioMessage;
        const doc = msg.message?.documentMessage;
        const docMime = String(doc?.mimetype || '')
          .toLowerCase()
          .split(';')[0]
          .trim();
        const docAsVideo = doc && docMime.startsWith('video/');
        const docAsImage = doc && docMime.startsWith('image/');
        if (img) {
          try {
            const dl = await import('@whiskeysockets/baileys');
            const downloadMediaMessage = (dl as any).downloadMediaMessage ?? (dl as any).default?.downloadMediaMessage;
            if (typeof downloadMediaMessage === 'function') {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pinoLogger, reuploadRequest: sock.updateMediaMessage },
              )) as Buffer;
              const mime = String(img.mimetype || 'image/jpeg');
              const storageKey = await this.saveInboundMedia(tenantId, msg.key.id!, 'image', buffer, mime);
              media = { kind: 'image', storageKey, mime };
              if (!text) text = '📷 Imagem';
            }
          } catch (e: any) {
            this.logger.warn(`[INBOUND] Falha ao descarregar imagem: ${e?.message}`);
            if (!text) text = '📷 Imagem (erro ao obter ficheiro)';
          }
        } else if (vid) {
          try {
            const dl = await import('@whiskeysockets/baileys');
            const downloadMediaMessage = (dl as any).downloadMediaMessage ?? (dl as any).default?.downloadMediaMessage;
            if (typeof downloadMediaMessage === 'function') {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pinoLogger, reuploadRequest: sock.updateMediaMessage },
              )) as Buffer;
              const mime = String(vid.mimetype || 'video/mp4');
              const storageKey = await this.saveInboundMedia(tenantId, msg.key.id!, 'video', buffer, mime);
              media = { kind: 'video', storageKey, mime };
              if (!text) text = '📹 Vídeo';
            }
          } catch (e: any) {
            this.logger.warn(`[INBOUND] Falha ao descarregar vídeo: ${e?.message}`);
            if (!text) text = '📹 Vídeo (erro ao obter ficheiro)';
          }
        } else if (aud) {
          try {
            const dl = await import('@whiskeysockets/baileys');
            const downloadMediaMessage = (dl as any).downloadMediaMessage ?? (dl as any).default?.downloadMediaMessage;
            if (typeof downloadMediaMessage === 'function') {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pinoLogger, reuploadRequest: sock.updateMediaMessage },
              )) as Buffer;
              const mime = String(aud.mimetype || 'audio/ogg; codecs=opus');
              const storageKey = await this.saveInboundMedia(tenantId, msg.key.id!, 'audio', buffer, mime);
              media = { kind: 'audio', storageKey, mime };
              if (!text) text = '🎤 Áudio';
            }
          } catch (e: any) {
            this.logger.warn(`[INBOUND] Falha ao descarregar áudio: ${e?.message}`);
            if (!text) text = '🎤 Áudio (erro ao obter ficheiro)';
          }
        } else if (docAsVideo) {
          // Vídeo enviado como documento (comum em alguns clientes / “Enviar como documento”)
          try {
            const dl = await import('@whiskeysockets/baileys');
            const downloadMediaMessage = (dl as any).downloadMediaMessage ?? (dl as any).default?.downloadMediaMessage;
            if (typeof downloadMediaMessage === 'function') {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pinoLogger, reuploadRequest: sock.updateMediaMessage },
              )) as Buffer;
              const mime = docMime || 'video/mp4';
              const storageKey = await this.saveInboundMedia(tenantId, msg.key.id!, 'video', buffer, mime);
              media = { kind: 'video', storageKey, mime };
              if (!text) text = '📹 Vídeo';
            }
          } catch (e: any) {
            this.logger.warn(`[INBOUND] Falha ao descarregar vídeo (documento): ${e?.message}`);
            if (!text) text = '📹 Vídeo (erro ao obter ficheiro)';
          }
        } else if (docAsImage) {
          // Imagem enviada como documento (“Enviar como documento” / compressão sem perdas em alguns clientes)
          try {
            const dl = await import('@whiskeysockets/baileys');
            const downloadMediaMessage = (dl as any).downloadMediaMessage ?? (dl as any).default?.downloadMediaMessage;
            if (typeof downloadMediaMessage === 'function') {
              const buffer = (await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: pinoLogger, reuploadRequest: sock.updateMediaMessage },
              )) as Buffer;
              const mime = docMime || 'image/jpeg';
              const storageKey = await this.saveInboundMedia(tenantId, msg.key.id!, 'image', buffer, mime);
              media = { kind: 'image', storageKey, mime };
              if (!text) text = '📷 Imagem';
            }
          } catch (e: any) {
            this.logger.warn(`[INBOUND] Falha ao descarregar imagem (documento): ${e?.message}`);
            if (!text) text = '📷 Imagem (erro ao obter ficheiro)';
          }
        }
        if (!text.trim() && !media) return;
        // Extrai stanzaId da mensagem citada (reply nativo do WhatsApp → reply interno)
        const contextInfo =
          msg.message?.extendedTextMessage?.contextInfo
          ?? msg.message?.imageMessage?.contextInfo
          ?? msg.message?.videoMessage?.contextInfo
          ?? msg.message?.audioMessage?.contextInfo
          ?? msg.message?.documentMessage?.contextInfo
          ?? null;
        const quotedStanzaId: string | null = contextInfo?.stanzaId ?? null;
        // Strip all JID suffixes: @s.whatsapp.net, @lid, @c.us
        const isLid = remoteJid.endsWith('@lid');
        const from = remoteJid.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '').trim();
        const altJid = String(msg.key.participantAlt || msg.key.remoteJidAlt || '').trim();
        let resolvedDigits = this.extractDigitsFromJid(altJid);
        if (!resolvedDigits && isLid) {
          try {
            const mappedPnJid = await sock.signalRepository?.lidMapping?.getPNForLID(remoteJid);
            resolvedDigits = this.extractDigitsFromJid(mappedPnJid);
          } catch (error: any) {
            this.logger.warn(`Failed to resolve PN for LID ${remoteJid}: ${error?.message}`);
          }
        }
        if (resolvedDigits) {
          const preferredDigits = await this.resolvePreferredInboundDigits(sock, resolvedDigits);
          if (preferredDigits && preferredDigits !== resolvedDigits) {
            this.logger.log(`[INBOUND] Ajustando número aprendido ${resolvedDigits} -> ${preferredDigits}`);
          }
          resolvedDigits = preferredDigits;
        }
        if (!from || from.includes('@')) {
          this.logger.warn(`Skipping message from unrecognized JID format: ${remoteJid}`);
          return;
        }
        this.logger.log(`Incoming WhatsApp message from ${from} (JID: ${remoteJid}, lid=${isLid}, resolved=${resolvedDigits ?? 'none'}, media=${media?.kind ?? 'none'})`);
        this.onMessageCallback?.(tenantId, from, text, msg.key.id, msg.pushName || undefined, isLid, resolvedDigits, media, quotedStanzaId);
      });

      // Presença do contato: repassa "digitando..." ao frontend via WebSocket
      sock.ev.on('presence.update', ({ id, presences }: any) => {
        try {
          const fromJid: string = id || '';
          const phone = fromJid.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '').trim();
          if (!phone) return;
          const allPresences = Object.values(presences || {});
          const isTyping = allPresences.some((p: any) => p?.lastKnownPresence === 'composing');
          if (this.realtimeEmitter) {
            this.realtimeEmitter.emitToTenant(tenantId, 'contact:typing', { phone, isTyping });
          }
        } catch {}
      });

      // ACK events: map Baileys numeric ACK to whatsappStatus string
      sock.ev.on('messages.update', (updates: any[]) => {
        for (const update of updates) {
          if (!update.key?.fromMe) continue; // only track outbound (our) messages
          const externalId: string | null = update.key?.id ?? null;
          if (!externalId) continue;
          const ack: number | undefined = update.update?.status;
          if (ack == null) continue;
          // Baileys ACK levels: 1=PENDING, 2=SERVER_ACK(sent), 3=DELIVERY_ACK(delivered), 4=READ, 5=PLAYED
          let status: string | null = null;
          if (ack === 2) status = 'sent';
          else if (ack === 3) status = 'delivered';
          else if (ack >= 4) status = 'read';
          if (status) {
            this.logger.log(`[ACK] tenantId=${tenantId} externalId=${externalId} ack=${ack} status=${status}`);
            this.onStatusUpdateCallback?.(tenantId, externalId, status);
          }
        }
      });

    } catch (error) {
      this.logger.error(`Failed to start Baileys session for tenant ${tenantId}`, error);
      const freshConn = await this.getOrCreateConnection(tenantId);
      freshConn.status = WhatsappConnectionStatus.DISCONNECTED;
      await this.connRepo.save(freshConn);
      this.emitStatus(tenantId, WhatsappConnectionStatus.DISCONNECTED);
      throw error;
    }
  }

  async disconnect(tenantId: string): Promise<void> {
    // Mark as intentional BEFORE calling sock.end() to prevent reconnect loop
    this.intentionalDisconnects.add(tenantId);

    const sock = this.sessions.get(tenantId);
    if (sock) {
      try { sock.end(undefined); } catch {}
      this.sessions.delete(tenantId);
    }

    // Update DB status immediately (before async close event fires)
    const conn = await this.getOrCreateConnection(tenantId);
    conn.status = WhatsappConnectionStatus.DISCONNECTED;
    conn.phoneNumber = null;
    await this.connRepo.save(conn);

    // Clean auth dir to force new QR on next connect
    const authDir = path.join(this.sessionsDir, tenantId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    this.lastQrs.delete(tenantId);
    this.emitStatus(tenantId, WhatsappConnectionStatus.DISCONNECTED, null);

    // Remove from intentional set after a short delay (in case the close event fires after)
    setTimeout(() => this.intentionalDisconnects.delete(tenantId), 5000);
  }

  /**
   * Verifica se um número de telefone está registrado no WhatsApp.
   * Retorna o JID real (pode incluir o dígito 9 para celulares brasileiros).
   */
  async checkNumberExists(tenantId: string, phone: string): Promise<CheckNumberResult> {
    const sock = this.sessions.get(tenantId);
    let digits = phone.replace(/\D/g, '');
    this.logger.log(`[CHECK-NUMBER] tenantId=${tenantId} phone=${phone} digits=${digits}`);

    if (!sock) {
      this.logger.warn(`[CHECK-NUMBER] Nenhuma sessão Baileys ativa para tenant ${tenantId}`);
      return { exists: false, jid: null, normalized: digits, candidates: [] };
    }

    // LID (14+ dígitos) — identificador interno, assume como existente
    if (digits.length >= 14) {
      const jid = `${digits}@lid`;
      this.logger.log(`[CHECK-NUMBER] LID detectado: ${jid}`);
      return { exists: true, jid, normalized: digits, candidates: [jid] };
    }

    // Normaliza para DDI brasileiro se necessário
    if (digits.length <= 11 && !digits.startsWith('55')) {
      digits = `55${digits}`;
    }

    // Gera candidatos: para Brasil, tenta com e sem o dígito 9
    const candidates: string[] = [];
    candidates.push(...this.buildPhoneCandidateJids(digits));

    this.logger.log(`[CHECK-NUMBER] Candidatos: ${candidates.join(', ')}`);

    try {
      // onWhatsApp aceita array de JIDs e retorna [{ exists, jid }]
      const results: Array<{ exists: boolean; jid: string }> = await sock.onWhatsApp(...candidates);
      this.logger.log(`[CHECK-NUMBER] Resultado onWhatsApp: ${JSON.stringify(results)}`);
      const found = results?.find(r => r.exists);
      if (found) {
        this.logger.log(`[CHECK-NUMBER] JID encontrado: ${found.jid}`);
        return { exists: true, jid: found.jid, normalized: digits, candidates };
      }
      this.logger.warn(`[CHECK-NUMBER] Número NÃO encontrado no WhatsApp: ${phone}`);
      return { exists: false, jid: null, normalized: digits, candidates };
    } catch (error: any) {
      this.logger.warn(`[CHECK-NUMBER] onWhatsApp falhou para ${phone}: ${error?.message}`);
      // Retorna melhor palpite sem confirmar existência
      return { exists: false, jid: candidates[0] ?? null, normalized: digits, candidates };
    }
  }

  async sendMessage(
    tenantId: string,
    to: string,
    text: string,
    opts?: { quoted?: { externalId: string; content: string; fromMe: boolean } | null },
  ): Promise<SendMessageResult> {
    const sock = this.sessions.get(tenantId);
    this.logger.log(`[OUTBOUND] tenantId=${tenantId} para=${to}`);

    if (!sock) {
      this.logger.warn(`[OUTBOUND] Nenhuma sessão Baileys ativa para tenant ${tenantId}`);
      return { success: false, error: 'Nenhuma sessão Baileys ativa' };
    }
    try {
      let digits = to.replace(/\D/g, '');
      this.logger.log(`[OUTBOUND] Número recebido: "${to}" → dígitos: ${digits}`);

      // LID: identificador interno do WhatsApp (14+ dígitos) — usa sufixo @lid
      if (digits.length >= 14) {
        const jid = `${digits}@lid`;
        const quotedWAMsg = opts?.quoted
          ? { key: { id: opts.quoted.externalId, remoteJid: jid, fromMe: opts.quoted.fromMe }, message: { conversation: opts.quoted.content } }
          : undefined;
        this.logger.log(`[OUTBOUND] LID detectado, usando JID: ${jid}`);
        return await this.enqueueOutbound(tenantId, async () => {
          const result = await sock.sendMessage(jid, { text }, quotedWAMsg ? { quoted: quotedWAMsg as any } : undefined);
          const messageId = result?.key?.id ?? null;
          this.logger.log(`[OUTBOUND] Enviado! JID=${jid} messageId=${messageId}`);
          return { success: true as const, jid, messageId };
        });
      }

      // Normaliza para formato internacional brasileiro
      if (digits.length <= 11 && !digits.startsWith('55')) {
        digits = `55${digits}`;
        this.logger.log(`[OUTBOUND] DDI 55 adicionado → ${digits}`);
      }

      // Tenta descobrir o JID real via onWhatsApp (verifica com e sem dígito 9)
      let jid = `${digits}@s.whatsapp.net`;
      try {
        let candidates: string[] = [jid];
        candidates = this.buildPhoneCandidateJids(digits);
        this.logger.log(`[OUTBOUND] Verificando JID via onWhatsApp: ${candidates.join(', ')}`);
        const check: Array<{ exists: boolean; jid: string }> = await sock.onWhatsApp(...candidates);
        const found = check?.find(r => r.exists);
        if (found?.jid) {
          jid = found.jid;
          this.logger.log(`[OUTBOUND] JID confirmado via onWhatsApp: ${jid}`);
        } else {
          this.logger.warn(`[OUTBOUND] Número não encontrado via onWhatsApp, usando JID estimado: ${jid}`);
        }
      } catch (checkErr: any) {
        this.logger.warn(`[OUTBOUND] onWhatsApp falhou (${checkErr?.message}), usando JID estimado: ${jid}`);
      }

      const quotedWAMsg = opts?.quoted
        ? { key: { id: opts.quoted.externalId, remoteJid: jid, fromMe: opts.quoted.fromMe }, message: { conversation: opts.quoted.content } }
        : undefined;
      return await this.enqueueOutbound(tenantId, async () => {
        this.logger.log(`[OUTBOUND] Enviando mensagem para JID: ${jid}`);
        const result = await sock.sendMessage(jid, { text }, quotedWAMsg ? { quoted: quotedWAMsg as any } : undefined);
        const messageId = result?.key?.id ?? null;
        this.logger.log(`[OUTBOUND] Enviado! JID=${jid} messageId=${messageId} status=${result?.status ?? 'desconhecido'}`);
        return { success: true as const, jid, messageId };
      });
    } catch (error: any) {
      this.logger.error(`[OUTBOUND] Falha ao enviar para "${to}" (tenant ${tenantId}): ${error?.message}`, error?.stack);
      return { success: false, error: error?.message };
    }
  }

  /** Payload Baileys alinhado ao que o WhatsApp espera (imagem / áudio / vídeo). */
  private buildBaileysMediaPayload(
    kind: 'image' | 'audio' | 'video',
    buffer: Buffer,
    opts?: { caption?: string; mime?: string },
  ): Record<string, unknown> {
    if (kind === 'image') {
      return { image: buffer, caption: opts?.caption || undefined };
    }
    if (kind === 'audio') {
      // PTT (nota de voz) só funciona com OGG/Opus — os bytes devem ser OGG, não WebM.
      // audio/webm (gravação do browser Chrome) é enviado como arquivo normal (ptt=false).
      const mimeBase = (opts?.mime || '').split(';')[0].trim();
      const isOgg = mimeBase === 'audio/ogg';
      return {
        audio: buffer,
        mimetype: isOgg ? 'audio/ogg; codecs=opus' : (opts?.mime || 'audio/mpeg'),
        ptt: isOgg,
      };
    }
    return {
      video: buffer,
      caption: opts?.caption || undefined,
      mimetype: opts?.mime || 'video/mp4',
      gifPlayback: false,
    };
  }

  /** Envia imagem, áudio ou vídeo (ficheiro local) via Baileys. */
  async sendMedia(
    tenantId: string,
    to: string,
    kind: 'image' | 'audio' | 'video',
    filePath: string,
    opts?: { caption?: string; mime?: string; quoted?: { externalId: string; content: string; fromMe: boolean } | null },
  ): Promise<SendMessageResult> {
    const sock = this.sessions.get(tenantId);
    this.logger.log(`[OUTBOUND-MEDIA] tenantId=${tenantId} kind=${kind} mime=${opts?.mime ?? 'n/a'} para=${to}`);
    if (!sock) {
      this.logger.warn(`[OUTBOUND-MEDIA] Nenhuma sessão Baileys ativa para tenant ${tenantId}`);
      return { success: false, error: 'Nenhuma sessão Baileys ativa' };
    }
    if (!fs.existsSync(filePath)) {
      this.logger.warn(`[OUTBOUND-MEDIA] Ficheiro não encontrado: ${filePath}`);
      return { success: false, error: 'Ficheiro de mídia não encontrado' };
    }
    const rawBuffer = fs.readFileSync(filePath);

    // Transcodifica WebM → OGG/Opus antes de enviar ao WhatsApp.
    // O WhatsApp não entrega audio/webm ao destinatário — só aceita ogg, mpeg e mp4.
    // Se o ffmpeg não estiver disponível ou falhar, usa o webm como fallback.
    let buffer = rawBuffer;
    let effectiveOpts = opts;
    if (kind === 'audio' && (opts?.mime || '').includes('webm')) {
      const tmpOut = path.join(os.tmpdir(), `wa-audio-${Date.now()}.ogg`);
      try {
        execFileSync('ffmpeg', ['-i', filePath, '-c:a', 'libopus', '-b:a', '64k', '-y', tmpOut], {
          timeout: 15000,
          stdio: 'ignore',
        });
        buffer = fs.readFileSync(tmpOut);
        effectiveOpts = { ...opts, mime: 'audio/ogg' };
        this.logger.log('[OUTBOUND-MEDIA] WebM → OGG/Opus via ffmpeg');
      } catch (err: any) {
        this.logger.warn(`[OUTBOUND-MEDIA] ffmpeg falhou (${err?.message ?? 'erro desconhecido'}), enviando webm como fallback`);
      } finally {
        try { fs.unlinkSync(tmpOut); } catch { /* ignora */ }
      }
    }

    try {
      let digits = to.replace(/\D/g, '');
      if (digits.length >= 14) {
        const jid = `${digits}@lid`;
        this.logger.log(`[OUTBOUND-MEDIA] LID detectado → ${jid}`);
        const quotedWAMsgMedia = opts?.quoted
          ? { key: { id: opts.quoted.externalId, remoteJid: jid, fromMe: opts.quoted.fromMe }, message: { conversation: opts.quoted.content } }
          : undefined;
        return await this.enqueueOutbound(tenantId, async () => {
          const payload = this.buildBaileysMediaPayload(kind, buffer, effectiveOpts);
          const result = await sock.sendMessage(jid, payload as any, quotedWAMsgMedia ? { quoted: quotedWAMsgMedia as any } : undefined);
          const messageId = result?.key?.id ?? null;
          this.logger.log(`[OUTBOUND-MEDIA] Enviado! JID=${jid} messageId=${messageId}`);
          return { success: true as const, jid, messageId };
        });
      }
      if (digits.length <= 11 && !digits.startsWith('55')) {
        digits = `55${digits}`;
      }
      let jid = `${digits}@s.whatsapp.net`;
      try {
        const candidates = this.buildPhoneCandidateJids(digits);
        const check: Array<{ exists: boolean; jid: string }> = await sock.onWhatsApp(...candidates);
        const found = check?.find((r) => r.exists);
        if (found?.jid) jid = found.jid;
      } catch {
        /* usa JID estimado */
      }
      const quotedWAMsgMedia = opts?.quoted
        ? { key: { id: opts.quoted.externalId, remoteJid: jid, fromMe: opts.quoted.fromMe }, message: { conversation: opts.quoted.content } }
        : undefined;
      this.logger.log(`[OUTBOUND-MEDIA] Enviando para JID: ${jid}`);
      return await this.enqueueOutbound(tenantId, async () => {
        const payload = this.buildBaileysMediaPayload(kind, buffer, effectiveOpts);
        const result = await sock.sendMessage(jid, payload as any, quotedWAMsgMedia ? { quoted: quotedWAMsgMedia as any } : undefined);
        const messageId = result?.key?.id ?? null;
        this.logger.log(`[OUTBOUND-MEDIA] Enviado! JID=${jid} messageId=${messageId}`);
        return { success: true as const, jid, messageId };
      });
    } catch (error: any) {
      this.logger.error(`[OUTBOUND-MEDIA] Falha tenant ${tenantId}: ${error?.message}`, error?.stack);
      return { success: false, error: error?.message };
    }
  }

  /**
   * Called on application startup to automatically reconnect any sessions
   * that were CONNECTED before the backend restarted (auth state persisted on disk).
   */
  async restoreActiveSessions(): Promise<void> {
    try {
      const connected = await this.connRepo.find({
        where: { status: WhatsappConnectionStatus.CONNECTED, provider: WhatsappProvider.BAILEYS },
      });
      if (connected.length === 0) return;
      this.logger.log(`Restoring ${connected.length} active WhatsApp session(s) after restart...`);
      for (const conn of connected) {
        const authDir = path.join(this.sessionsDir, conn.tenantId);
        if (!fs.existsSync(authDir)) {
          // No auth files on disk — mark as disconnected so user needs to re-scan QR
          conn.status = WhatsappConnectionStatus.DISCONNECTED;
          await this.connRepo.save(conn);
          this.logger.warn(`No auth state found for tenant ${conn.tenantId}, marking as disconnected`);
          continue;
        }
        // Mark as CONNECTING + seed reconnectAttempts immediately so getStatus
        // doesn't overwrite to DISCONNECTED during the restore window
        conn.status = WhatsappConnectionStatus.CONNECTING;
        await this.connRepo.save(conn);
        this.reconnectAttempts.set(conn.tenantId, 1);

        this.logger.log(`Resuming Baileys session for tenant ${conn.tenantId}`);
        // Small stagger to avoid hammering WA servers on startup
        const delay = connected.indexOf(conn) * 3000;
        setTimeout(() => {
          this.startQrSession(conn.tenantId).catch(err => {
            this.logger.error(`Failed to restore session for tenant ${conn.tenantId}`, err);
          });
        }, delay);
      }
    } catch (err) {
      this.logger.error('Failed to restore active WhatsApp sessions', err);
    }
  }

  async saveMetaConfig(tenantId: string, config: { metaPhoneNumberId: string; metaToken: string; metaVerifyToken: string; metaWebhookUrl?: string }): Promise<WhatsappConnection> {
    const conn = await this.getOrCreateConnection(tenantId);
    conn.provider = WhatsappProvider.META;
    conn.metaPhoneNumberId = config.metaPhoneNumberId;
    conn.metaToken = config.metaToken;
    conn.metaVerifyToken = config.metaVerifyToken;
    conn.metaWebhookUrl = config.metaWebhookUrl || null;
    return this.connRepo.save(conn);
  }

  async getMetaConfig(tenantId: string): Promise<{ metaPhoneNumberId: string | null; metaToken: string | null; metaVerifyToken: string | null; metaWebhookUrl: string | null } | null> {
    const conn = await this.connRepo.findOne({ where: { tenantId } });
    if (!conn) return null;
    return {
      metaPhoneNumberId: conn.metaPhoneNumberId,
      metaToken: conn.metaToken,
      metaVerifyToken: conn.metaVerifyToken,
      metaWebhookUrl: conn.metaWebhookUrl,
    };
  }
}
