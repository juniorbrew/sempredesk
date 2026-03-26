import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject, Observable } from 'rxjs';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { WhatsappConnection, WhatsappConnectionStatus, WhatsappProvider } from './entities/whatsapp-connection.entity';

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

  constructor(
    @InjectRepository(WhatsappConnection)
    private readonly connRepo: Repository<WhatsappConnection>,
  ) {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  private onMessageCallback: ((tenantId: string, from: string, text: string, messageId: string, senderName?: string, isLid?: boolean) => void) | null = null;

  setMessageHandler(cb: (tenantId: string, from: string, text: string, messageId: string, senderName?: string, isLid?: boolean) => void) {
    this.onMessageCallback = cb;
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
        const text = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || msg.message?.videoMessage?.caption;
        if (!text) return;
        // Strip all JID suffixes: @s.whatsapp.net, @lid, @c.us
        const isLid = remoteJid.endsWith('@lid');
        const from = remoteJid.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '').trim();
        if (!from || from.includes('@')) {
          this.logger.warn(`Skipping message from unrecognized JID format: ${remoteJid}`);
          return;
        }
        this.logger.log(`Incoming WhatsApp message from ${from} (JID: ${remoteJid}, lid=${isLid})`);
        this.onMessageCallback?.(tenantId, from, text, msg.key.id, msg.pushName || undefined, isLid);
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
    if (digits.startsWith('55') && digits.length === 12) {
      // 12 dígitos: número antigo sem 9 → tenta com 9 primeiro
      const ddd = digits.slice(2, 4);
      const num = digits.slice(4);
      candidates.push(`55${ddd}9${num}@s.whatsapp.net`);
      candidates.push(`${digits}@s.whatsapp.net`);
    } else if (digits.startsWith('55') && digits.length === 13) {
      // 13 dígitos: padrão atual → tenta sem 9 como fallback
      const ddd = digits.slice(2, 4);
      const num9 = digits.slice(4);          // já tem o 9
      const numSem9 = num9.slice(1);         // remove o 9
      candidates.push(`${digits}@s.whatsapp.net`);
      candidates.push(`55${ddd}${numSem9}@s.whatsapp.net`);
    } else {
      candidates.push(`${digits}@s.whatsapp.net`);
    }

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

  async sendMessage(tenantId: string, to: string, text: string): Promise<SendMessageResult> {
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
        this.logger.log(`[OUTBOUND] LID detectado, usando JID: ${jid}`);
        const result = await sock.sendMessage(jid, { text });
        const messageId = result?.key?.id ?? null;
        this.logger.log(`[OUTBOUND] Enviado! JID=${jid} messageId=${messageId}`);
        return { success: true, jid, messageId };
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
        if (digits.startsWith('55') && digits.length === 12) {
          const ddd = digits.slice(2, 4);
          const num = digits.slice(4);
          candidates = [`55${ddd}9${num}@s.whatsapp.net`, jid];
        } else if (digits.startsWith('55') && digits.length === 13) {
          const ddd = digits.slice(2, 4);
          const numSem9 = digits.slice(5); // remove o 9
          candidates = [jid, `55${ddd}${numSem9}@s.whatsapp.net`];
        }
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

      this.logger.log(`[OUTBOUND] Enviando mensagem para JID: ${jid}`);
      const result = await sock.sendMessage(jid, { text });
      const messageId = result?.key?.id ?? null;
      this.logger.log(`[OUTBOUND] Enviado! JID=${jid} messageId=${messageId} status=${result?.status ?? 'desconhecido'}`);
      return { success: true, jid, messageId };
    } catch (error: any) {
      this.logger.error(`[OUTBOUND] Falha ao enviar para "${to}" (tenant ${tenantId}): ${error?.message}`, error?.stack);
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
