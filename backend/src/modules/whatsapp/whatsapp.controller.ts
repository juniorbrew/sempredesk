import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  UseGuards,
  Request,
  Res,
  Sse,
  Headers,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Response, Request as ExpressRequest } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsappService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { JwtAuthGuard, Public } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly baileysService: BaileysService,
  ) {}

  // ── Meta webhook verification (GET) ──────────────────────────────────
  @Public()
  @Get()
  verify(
    @TenantId() tenantId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const defaultToken = process.env.WHATSAPP_VERIFY_TOKEN || 'suporte-whatsapp-verify';
    if (mode === 'subscribe' && verifyToken === defaultToken) {
      return challenge ?? 'OK';
    }
    return 'INVALID_TOKEN';
  }

  // ── Meta/Generic webhook receive (POST) ──────────────────────────────
  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Request() req: RawBodyRequest<ExpressRequest>,
    @Body() body: any,
    @Headers('x-hub-signature-256') metaSignature?: string,
  ) {
    const metaAppSecret = process.env.META_APP_SECRET;
    const isMetaPayload = body?.object === 'whatsapp_business_account';

    if (metaAppSecret && isMetaPayload) {
      if (!metaSignature) {
        return { success: false, reason: 'MISSING_SIGNATURE' };
      }
      const rawBody = req.rawBody;
      if (!rawBody) {
        return { success: false, reason: 'RAW_BODY_UNAVAILABLE' };
      }
      const expectedHmac = 'sha256=' + createHmac('sha256', metaAppSecret).update(rawBody).digest('hex');
      const sigBuf = Buffer.from(metaSignature, 'utf8');
      const expBuf = Buffer.from(expectedHmac, 'utf8');
      const valid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
      if (!valid) {
        return { success: false, reason: 'INVALID_SIGNATURE' };
      }
    }

    const tenantId = body?.tenantId || body?.tenant_id || body?.tenant || '00000000-0000-0000-0000-000000000001';
    const generic = this.whatsappService.normalizeGenericPayload(body);
    const meta = !generic ? this.whatsappService.normalizeMetaPayload(body) : null;
    const msg = generic || meta;
    if (!msg) return { success: false, reason: 'UNSUPPORTED_PAYLOAD' };

    const connection = await this.baileysService.getStatus(tenantId).catch(() => null);
    if (connection?.status === 'connected') {
      return { success: true, skipped: true, reason: 'BAILEYS_CONNECTED' };
    }

    const result = await this.whatsappService.handleIncomingMessage(tenantId, msg);
    return { success: true, ...result };
  }

  // ── Send via Meta API ─────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.reply')
  @Post('send')
  async send(@Body() body: { to: string; text: string }) {
    await this.whatsappService.sendWhatsappMessage(body.to, body.text);
    return { success: true };
  }

  // ── Send reply from ticket ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.reply')
  @Post('send-from-ticket')
  async sendFromTicket(@Request() req: any, @Body() body: { ticketId: string; text: string }) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const userId = req.user?.id || req.user?.sub;
    const userName = req.user?.name || req.user?.email || 'Equipe';
    if (!tenantId || !body.ticketId || !body.text?.trim()) {
      return { success: false, message: 'tenantId, ticketId e text são obrigatórios' };
    }
    return this.whatsappService.sendReplyFromTicket(tenantId, body.ticketId, userId, userName, body.text.trim());
  }

  // ──────────────────────────────────────────────────────────────────────
  // ── Check number ─────────────────────────────────────────────────────
  /**
   * Verifica se um número de telefone está registrado no WhatsApp.
   * Usa onWhatsApp() do Baileys para obter o JID real e confirmar existência.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post('check-number')
  async checkNumber(@TenantId() tenantId: string, @Body() body: { phone: string }) {
    if (!body.phone?.trim()) return { exists: false, jid: null, error: 'Número não informado' };
    return this.baileysService.checkNumberExists(tenantId, body.phone.trim());
  }

  // ── Start outbound conversation ───────────────────────────────────────
  /**
   * Fluxo completo de início de conversa outbound:
   * valida número → cria/localiza contato → cria/localiza conversa → cria ticket → envia 1ª mensagem.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.create')
  @Post('start-outbound')
  async startOutbound(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Body() body: { phone?: string; contactId?: string; clientId?: string; subject?: string; firstMessage?: string },
  ) {
    const authorId = req.user?.id;
    const authorName = req.user?.name || req.user?.email || 'Equipe';
    return this.whatsappService.startOutboundConversation(tenantId, authorId, authorName, body);
  }

  // CONNECTION MANAGEMENT ENDPOINTS
  // ──────────────────────────────────────────────────────────────────────

  /** GET current connection status + Meta config (masked token) */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('connection')
  async getConnection(@TenantId() tenantId: string) {
    const status = await this.baileysService.getStatus(tenantId);
    const metaConfig = await this.baileysService.getMetaConfig(tenantId);
    return {
      ...status,
      meta: metaConfig ? {
        metaPhoneNumberId: metaConfig.metaPhoneNumberId,
        metaToken: metaConfig.metaToken ? '••••••••' + metaConfig.metaToken.slice(-4) : null,
        metaVerifyToken: metaConfig.metaVerifyToken,
        metaWebhookUrl: metaConfig.metaWebhookUrl,
        configured: !!(metaConfig.metaPhoneNumberId && metaConfig.metaToken),
      } : null,
    };
  }

  /** GET current QR code (polling endpoint) */
  @UseGuards(JwtAuthGuard)
  @Get('qr')
  getCurrentQr(@TenantId() tenantId: string) {
    const qr = this.baileysService.getLastQr(tenantId);
    return { qr };
  }

  /** POST start QR code session */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post('connect')
  async connect(@TenantId() tenantId: string) {
    // Fire and forget — QR arrives via SSE or polling
    this.baileysService.startQrSession(tenantId).catch(() => {
      // logged inside the service
    });
    return { success: true, message: 'Iniciando sessão... aguarde o QR Code.' };
  }

  /** GET SSE stream — emits { type:'qr', qr: 'data:image/png;base64,...' } and { type:'status', status: '...' } */
  @UseGuards(JwtAuthGuard)
  @Sse('qr/stream')
  qrStream(@TenantId() tenantId: string): Observable<MessageEvent> {
    return this.baileysService.getQrObservable(tenantId);
  }

  /** POST disconnect Baileys session */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post('disconnect')
  async disconnect(@TenantId() tenantId: string) {
    await this.baileysService.disconnect(tenantId);
    return { success: true };
  }

  /** PUT save Meta API configuration */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Put('config/meta')
  async saveMetaConfig(
    @TenantId() tenantId: string,
    @Body() body: { metaPhoneNumberId: string; metaToken: string; metaVerifyToken?: string; metaWebhookUrl?: string },
  ) {
    if (!body.metaPhoneNumberId?.trim() || !body.metaToken?.trim()) {
      return { success: false, message: 'metaPhoneNumberId e metaToken são obrigatórios' };
    }
    await this.baileysService.saveMetaConfig(tenantId, {
      metaPhoneNumberId: body.metaPhoneNumberId.trim(),
      metaToken: body.metaToken.trim(),
      metaVerifyToken: body.metaVerifyToken?.trim() || 'sempredesk-verify',
      metaWebhookUrl: body.metaWebhookUrl?.trim(),
    });
    return { success: true, message: 'Configuração Meta salva com sucesso!' };
  }
}
