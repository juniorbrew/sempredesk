/**
 * CalendarCryptoService
 * ─────────────────────
 * Criptografia AES-256-GCM para tokens OAuth (access_token, refresh_token).
 * Nunca armazena tokens em texto plano no banco de dados.
 *
 * Variável de ambiente obrigatória para produção:
 *   CALENDAR_TOKEN_SECRET=<64 chars hex = 32 bytes>
 *   Gerar com: openssl rand -hex 32
 *
 * Se a variável não estiver configurada, o serviço opera sem criptografia
 * e emite um aviso de segurança — útil apenas em desenvolvimento local.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CalendarCryptoService {
  private readonly logger = new Logger(CalendarCryptoService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer | null;

  constructor(private readonly cfg: ConfigService) {
    const hex = this.cfg.get<string>('CALENDAR_TOKEN_SECRET', '');
    if (hex && hex.length === 64) {
      this.key = Buffer.from(hex, 'hex');
    } else {
      this.key = null;
      this.logger.warn(
        'CALENDAR_TOKEN_SECRET não configurado ou inválido. ' +
        'Tokens OAuth serão armazenados SEM criptografia. ' +
        'Configure uma chave de 64 chars hex (openssl rand -hex 32) em produção.',
      );
    }
  }

  /**
   * Criptografa um texto usando AES-256-GCM.
   * Formato: base64(iv[12] || authTag[16] || ciphertext)
   */
  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * Descriptografa um valor previamente cifrado com encrypt().
   * Retorna o plaintext ou lança erro se o token foi adulterado.
   */
  decrypt(encoded: string): string {
    if (!this.key) return encoded;
    const buf = Buffer.from(encoded, 'base64');
    const iv        = buf.subarray(0, 12);
    const tag       = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher  = crypto.createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
  }

  /** Gera um state seguro para OAuth (prevenção CSRF). */
  generateState(payload: object): string {
    const json  = JSON.stringify({ ...payload, nonce: crypto.randomBytes(8).toString('hex') });
    const hmacKey = this.key ?? crypto.randomBytes(32);
    const hmac  = crypto.createHmac('sha256', hmacKey).update(json).digest('base64url');
    return Buffer.from(json).toString('base64url') + '.' + hmac;
  }

  /**
   * Valida e desempacota um state OAuth.
   * Lança Error se inválido ou adulterado.
   */
  verifyState(state: string): Record<string, string> {
    const [payloadB64, hmacActual] = state.split('.');
    if (!payloadB64 || !hmacActual) throw new Error('State OAuth malformado');
    const json     = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const hmacKey  = this.key ?? Buffer.alloc(32);
    const expected = crypto.createHmac('sha256', hmacKey).update(json).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(hmacActual), Buffer.from(expected))) {
      throw new Error('State OAuth inválido (CSRF ou adulterado)');
    }
    return JSON.parse(json);
  }
}
