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
  Logger,
  RawBodyRequest,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ticketItem4AttachmentsDiskStorage } from '../../common/utils/multer-disk-storage.util';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { UploadThrottlerGuard } from '../../common/guards/upload-throttler.guard';
import { StorageQuotaService } from '../storage/storage-quota.service';
import { Observable } from 'rxjs';
import { Response, Request as ExpressRequest } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsappService } from './whatsapp.service';
import { BaileysService } from './baileys.service';
import { WhatsappProvider } from './entities/whatsapp-connection.entity';
import { JwtAuthGuard, Public } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@Controller('webhooks/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly baileysService: BaileysService,
    private readonly quotaService: StorageQuotaService,
  ) {}

  // ── Meta webhook verification (GET) ──────────────────────────────────
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || 'sempredesk-verify';
    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return res.send(challenge);
    }
    return res.status(403).send('Forbidden');
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

    // Tenta resolver o tenant e o canal pelo phoneNumberId da Meta
    const metaPhoneNumberId = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id as string | undefined;
    const resolved = metaPhoneNumberId
      ? await this.baileysService.findTenantByMetaPhoneNumberId(metaPhoneNumberId).catch(() => null)
      : null;

    // Nunca usar fallback hardcoded para tenant real — isso contaminaria dados entre empresas.
    // Se não for possível resolver o tenant, descartar o payload (200 para Meta não reenviar).
    const tenantId = resolved?.tenantId || body?.tenantId || body?.tenant_id || body?.tenant;
    /** ID do registro whatsapp_connections que recebeu esta mensagem — propaga o canal correto */
    const inboundChannelId: string | undefined = resolved?.connectionId;
    if (!tenantId) {
      this.logger.warn(`[webhook] Payload descartado: meta_phone_number_id="${metaPhoneNumberId ?? 'N/A'}" não mapeado a nenhum tenant`);
      return { success: true };
    }

    // ── Processar status updates da Meta (delivered/read) ─────────────────
    const metaStatuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses as any[] | undefined;
    if (metaStatuses?.length) {
      setImmediate(async () => {
        for (const s of metaStatuses) {
          const wamid: string | undefined = s?.id;
          const status: string | undefined = s?.status; // sent | delivered | read | failed
          if (wamid && status) {
            await this.whatsappService.handleMetaStatusUpdate(tenantId, wamid, status).catch(() => {});
          }
        }
      });
      return { success: true };
    }

    // ── Processar mensagens recebidas ─────────────────────────────────────
    const generic = this.whatsappService.normalizeGenericPayload(body);
    const meta = !generic ? this.whatsappService.normalizeMetaPayload(body) : null;
    const msg = generic || meta;
    if (!msg) return { success: false, reason: 'UNSUPPORTED_PAYLOAD' };

    // Responde à Meta imediatamente (timeout deles é 5 s).
    // O processamento real acontece de forma assíncrona via setImmediate
    // para não bloquear a resposta HTTP nem perder a mensagem.
    setImmediate(async () => {
      try {
        const connection = await this.baileysService.getStatus(tenantId).catch(() => null);
        // Descarta apenas se for sessão Baileys ATIVA: mensagens Baileys chegam pelo socket
        // diretamente (messages.upsert), processar aqui causaria duplicata.
        // Conexões Meta (provider='meta') DEVEM ser processadas por este webhook mesmo que
        // o status apareça como connected — o socket Baileys não existe para elas.
        if (connection?.provider === 'baileys' && connection?.status === 'connected') return;
        await this.whatsappService.handleIncomingMessage(tenantId, msg, undefined, undefined, inboundChannelId);
      } catch (err) {
        this.logger.error(`Erro ao processar mensagem WhatsApp (tenant=${tenantId}): ${err}`);
      }
    });

    return { success: true, queued: true };
  }

  // ── Send via Meta API ─────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.reply')
  @Post('send')
  async send(@TenantId() tenantId: string, @Body() body: { to: string; text: string }) {
    await this.whatsappService.sendWhatsappMessage(tenantId, body.to, body.text);
    return { success: true };
  }

  // ── Send reply from ticket ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.reply')
  @Post('send-from-ticket')
  async sendFromTicket(@Request() req: any, @Body() body: { ticketId: string; text: string; replyToId?: string }) {
    const tenantId = req.tenantId || req.user?.tenantId;
    const userId = req.user?.id || req.user?.sub;
    const userName = req.user?.name || req.user?.email || 'Equipe';
    if (!tenantId || !body.ticketId || !body.text?.trim()) {
      return { success: false, message: 'tenantId, ticketId e text são obrigatórios' };
    }
    return this.whatsappService.sendReplyFromTicket(tenantId, body.ticketId, userId, userName, body.text.trim(), body.replyToId ?? null);
  }

  /** Ticket WhatsApp sem conversa: multipart `file` + opcional `content` / `replyToId` — envia WA e grava em ticket_messages. */
  @UseGuards(JwtAuthGuard, PermissionsGuard, StorageQuotaGuard, UploadThrottlerGuard)
  @RequirePermission('ticket.reply')
  @Throttle({ upload: { limit: parseInt(process.env.UPLOAD_RATE_LIMIT ?? '30', 10) || 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: ticketItem4AttachmentsDiskStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  @Post('send-media-from-ticket/:ticketId')
  async sendMediaFromTicket(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Body('content') content?: string,
    @Body('replyToId') replyToId?: string,
    @UploadedFile() file?: { path?: string; mimetype?: string; originalname?: string; size?: number },
  ) {
    if (!file?.path || (file.size ?? 0) <= 0) {
      throw new BadRequestException('Envie o ficheiro no campo file.');
    }
    const userId = req.user?.id || req.user?.sub;
    const userName = req.user?.name || req.user?.email || 'Equipe';
    const result = await this.whatsappService.sendMediaReplyFromTicket(
      tenantId,
      ticketId,
      userId,
      userName,
      { path: file.path, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
      { content: content ?? undefined, replyToId: replyToId ?? null },
    );
    this.logger.log(JSON.stringify({
      event: 'upload.whatsapp_ticket_media',
      tenantId,
      ticketId,
      sizeBytes: file.size,
      mime: file.mimetype,
    }));
    this.quotaService.invalidateCache(tenantId);
    return result;
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

  // ── List Meta templates ───────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('templates')
  listTemplates(@TenantId() tenantId: string) {
    return this.whatsappService.listMetaTemplates(tenantId);
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
    @Body() body: { phone?: string; contactId?: string; clientId?: string; subject?: string; firstMessage?: string; templateName?: string; templateLanguage?: string; templateParams?: string[] },
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
        metaWabaId: metaConfig.metaWabaId,
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
    @Body() body: { metaPhoneNumberId: string; metaToken?: string; metaVerifyToken?: string; metaWebhookUrl?: string; metaWabaId?: string },
  ) {
    if (!body.metaPhoneNumberId?.trim()) {
      return { success: false, message: 'metaPhoneNumberId é obrigatório' };
    }
    await this.baileysService.saveMetaConfig(tenantId, {
      metaPhoneNumberId: body.metaPhoneNumberId.trim(),
      metaToken: body.metaToken?.trim() || null,
      metaVerifyToken: body.metaVerifyToken?.trim() || 'sempredesk-verify',
      metaWebhookUrl: body.metaWebhookUrl?.trim(),
      metaWabaId: body.metaWabaId?.trim() || undefined,
    });
    return { success: true, message: 'Configuração Meta salva com sucesso!' };
  }

  // ── Multi-channel management ──────────────────────────────────────────

  /** GET /channels — lista todos os canais WhatsApp do tenant */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('channels')
  async listChannels(@TenantId() tenantId: string) {
    const channels = await this.baileysService.listChannels(tenantId);
    return channels.map(c => ({
      id: c.id,
      label: c.label,
      provider: c.provider,
      isDefault: c.isDefault,
      status: c.status,
      metaPhoneNumberId: c.metaPhoneNumberId,
      metaToken: c.metaToken ? '••••••••' + c.metaToken.slice(-4) : null,
      metaVerifyToken: c.metaVerifyToken,
      metaWebhookUrl: c.metaWebhookUrl,
      metaWabaId: c.metaWabaId,
      configured: !!(c.metaPhoneNumberId && c.metaToken),
      createdAt: c.createdAt,
    }));
  }

  /** POST /channels — adiciona novo canal Meta ao tenant */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post('channels')
  async addChannel(
    @TenantId() tenantId: string,
    @Body() body: {
      label?: string;
      metaPhoneNumberId: string;
      metaToken: string;
      metaVerifyToken?: string;
      metaWebhookUrl?: string;
      metaWabaId?: string;
      isDefault?: boolean;
    },
  ) {
    if (!body.metaPhoneNumberId?.trim() || !body.metaToken?.trim()) {
      return { success: false, message: 'metaPhoneNumberId e metaToken são obrigatórios' };
    }
    const channel = await this.baileysService.addChannel(tenantId, {
      label: body.label?.trim() || 'Número ' + body.metaPhoneNumberId.trim().slice(-4),
      metaPhoneNumberId: body.metaPhoneNumberId.trim(),
      metaToken: body.metaToken.trim(),
      metaVerifyToken: body.metaVerifyToken?.trim() || 'sempredesk-verify',
      metaWebhookUrl: body.metaWebhookUrl?.trim(),
      metaWabaId: body.metaWabaId?.trim(),
      isDefault: body.isDefault ?? false,
    });
    return {
      success: true,
      message: 'Canal adicionado com sucesso!',
      channel: {
        id: channel.id,
        label: channel.label,
        provider: channel.provider,
        isDefault: channel.isDefault,
        metaPhoneNumberId: channel.metaPhoneNumberId,
        configured: !!(channel.metaPhoneNumberId && channel.metaToken),
      },
    };
  }

  /** PUT /channels/:id — atualiza label / token de um canal existente */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Put('channels/:id')
  async updateChannel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: {
      label?: string;
      metaToken?: string;
      metaVerifyToken?: string;
      metaWebhookUrl?: string;
      metaWabaId?: string;
    },
  ) {
    await this.baileysService.updateChannel(tenantId, id, {
      label: body.label?.trim(),
      metaToken: body.metaToken?.trim(),
      metaVerifyToken: body.metaVerifyToken?.trim(),
      metaWebhookUrl: body.metaWebhookUrl?.trim(),
      metaWabaId: body.metaWabaId?.trim(),
    });
    return { success: true, message: 'Canal atualizado com sucesso!' };
  }

  /** PUT /channels/:id/default — define este canal como padrão do tenant */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Put('channels/:id/default')
  async setDefaultChannel(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.baileysService.setDefaultChannel(tenantId, id);
    return { success: true, message: 'Canal padrão atualizado!' };
  }

  /** DELETE /channels/:id — remove canal (não pode ser o único nem o padrão) */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Delete('channels/:id')
  async deleteChannel(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.baileysService.deleteChannel(tenantId, id);
    return { success: true, message: 'Canal removido com sucesso!' };
  }
}
