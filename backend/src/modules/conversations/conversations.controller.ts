import { Body, Controller, Get, Post, Param, Query, UseGuards, BadRequestException, Request, Put, UseInterceptors, UploadedFile, StreamableFile, Logger, ForbiddenException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';
import { resolveValidatedConversationMime, validateFileSignature } from '../../common/utils/validate-file-signature.util';
import { FileInterceptor } from '@nestjs/platform-express';
import { conversationMediaDiskStorage, CONVERSATION_MEDIA_ROOT, filePathToStorageKey } from '../../common/utils/multer-disk-storage.util';
import { readFilePrefixSync } from '../../common/utils/read-file-prefix.util';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UploadThrottlerGuard } from '../../common/guards/upload-throttler.guard';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { StorageQuotaService } from '../../modules/storage/storage-quota.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { StartConversationDto, StartAgentConversationDto, CreateTicketForConversationDto, LinkTicketDto, AddConversationMessageDto, CloseConversationDto, UpdateConversationTagsDto } from './dto/conversation.dto';
import { ConversationChannel } from './entities/conversation.entity';

const CONVERSATION_DOCUMENT_MIMES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
]);

function conversationMimeFromOriginalname(name: string): string | null {
  const ext = path.extname(name).toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
  };
  return map[ext] ?? null;
}

/** Browsers/OS enviam aliases; validateFileSignature usa MIME canónico. */
function normalizeConversationDeclaredMime(raw: string): string {
  const m = raw.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png',
    'audio/mp3': 'audio/mpeg',
    'audio/x-mp3': 'audio/mpeg',
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'application/x-pdf': 'application/pdf',
    'audio/wave': 'audio/wav',
    'audio/x-wav': 'audio/wav',
  };
  return map[m] ?? m;
}

@Controller('conversations')
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly quotaService: StorageQuotaService,
  ) {}

  /** Portal: Retorna ou cria conversa para ticket existente (aberto). Usado ao consultar ticket em andamento. */
  @UseGuards(JwtAuthGuard)
  @Post('resume-for-ticket')
  async resumeForTicket(@Request() req: any, @Body() body: { ticketId: string }) {
    if (!req.user?.isPortal) throw new BadRequestException('Apenas para portal do cliente');
    const tid = req.tenantId || (body as any).tenantId;
    if (!tid || !body.ticketId) throw new BadRequestException('tenantId e ticketId são obrigatórios');
    return this.conversationsService.resumeOrCreateForTicket(tid, body.ticketId, req.user.id, !!req.user.isPrimary);
  }

  /** Portal: Iniciar atendimento (após preencher pré-chat). Inbound → ticket auto. */
  @UseGuards(JwtAuthGuard)
  @Post('start')
  async start(@Request() req: any, @Body() dto: StartConversationDto) {
    const tid = req.tenantId || (dto as any).tenantId;
    if (!tid) throw new BadRequestException('tenantId é obrigatório (faça login ou informe no body)');
    return this.conversationsService.startPortalConversation(tid, dto);
  }

  /** Agente inicia conversa (outbound). Sem ticket até criar/vincular. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.create')
  @Post('start-by-agent')
  async startByAgent(@Request() req: any, @Body() dto: StartAgentConversationDto) {
    return this.conversationsService.startAgentConversation(req.tenantId, dto.clientId, dto.contactId, dto.channel);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get()
  async findAll(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Query('channel') channel?: string,
    @Query('hasTicket') hasTicket?: 'yes' | 'no' | 'all',
    @Query('status') status?: 'active' | 'closed' | 'all',
  ) {
    if (req.user?.isPortal) throw new ForbiddenException('Endpoint disponivel apenas para a equipe interna');
    const ch = channel === 'whatsapp' ? ConversationChannel.WHATSAPP : channel === 'portal' ? ConversationChannel.PORTAL : undefined;

    // Agentes sem attendance.view_all só veem suas conversas (ou sem dono ainda)
    let agentId: string | undefined;
    if (!req.user?.isPortal) {
      const role: string = req.user?.role || '';
      const perms: string[] = req.user?.permissions || [];
      const isAdmin = role === 'super_admin' || role === 'admin';
      if (!isAdmin && !perms.includes('attendance.view_all')) {
        agentId = req.user?.id;
      }
    }

    return this.conversationsService.findActive(tenantId, { channel: ch, hasTicket, status, agentId });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('active-count')
  async getActiveCount(@Request() req: any, @TenantId() tenantId: string) {
    if (req.user?.isPortal) throw new ForbiddenException('Endpoint disponivel apenas para a equipe interna');
    let agentId: string | undefined;
    const role: string = req.user?.role || '';
    const perms: string[] = req.user?.permissions || [];
    const isAdmin = role === 'super_admin' || role === 'admin';
    if (!isAdmin && !perms.includes('attendance.view_all')) {
      agentId = req.user?.id;
    }
    return this.conversationsService.getActiveCount(tenantId, { agentId });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('by-client/:clientId')
  async findByClient(@Request() req: any, @TenantId() tenantId: string, @Param('clientId') clientId: string, @Query('channel') channel?: string) {
    if (req.user?.isPortal) throw new ForbiddenException('Endpoint disponivel apenas para a equipe interna');
    const ch = channel === 'whatsapp' ? ConversationChannel.WHATSAPP : channel === 'portal' ? ConversationChannel.PORTAL : undefined;
    return this.conversationsService.findByClient(tenantId, clientId, ch);
  }

  /** Imagem ou áudio associado a uma mensagem da conversa (agente ou portal). */
  @UseGuards(JwtAuthGuard)
  @Get('messages/:messageId/media')
  async getMessageMedia(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('messageId') messageId: string,
  ): Promise<StreamableFile> {
    const portalId = req.user?.isPortal ? String(req.user.id) : undefined;
    const { stream, mime } = await this.conversationsService.getMessageMediaStream(tenantId, messageId, {
      portalContactId: portalId,
      portalIsPrimary: !!req.user?.isPrimary,
    });
    return new StreamableFile(stream, { type: mime, disposition: `inline; filename="media-${messageId}"` });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string) {
    if (req.user?.isPortal) {
      await this.conversationsService.assertPortalConversationAccess(tenantId, id, req.user.id, !!req.user.isPrimary);
    }
    return this.conversationsService.findOneForDashboard(tenantId, id);
  }

  /** Agente abriu a conversa — envia read receipts das mensagens do contato via Baileys */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post(':id/mark-read')
  async markRead(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string) {
    if (req.user?.isPortal) throw new ForbiddenException('Endpoint disponivel apenas para a equipe interna');
    await this.conversationsService.markConversationRead(tenantId, id);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.create')
  @Post(':id/create-ticket')
  async createTicket(@Request() req: any, @Param('id') id: string, @Body() dto: CreateTicketForConversationDto) {
    return this.conversationsService.createTicketForConversationById(
      req.tenantId, id, req.user.id, req.user.name, dto,
    );
  }

  /** Agente inicia atendimento: cria ticket vinculado e registra SLA de primeira resposta. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.create')
  @Post(':id/start-attendance')
  async startAttendance(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.conversationsService.startAttendance(tenantId, id, req.user.id, req.user.name);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.edit')
  @Post(':id/link-ticket')
  async linkTicket(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: LinkTicketDto) {
    return this.conversationsService.linkTicket(tenantId, id, dto.ticketId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.close')
  @Post(':id/close')
  async close(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string, @Body() body?: CloseConversationDto) {
    return this.conversationsService.close(tenantId, id, req.user?.id, req.user?.name, body?.keepTicketOpen, body);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.edit')
  @Put(':id/tags')
  async updateTags(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateConversationTagsDto) {
    return this.conversationsService.updateTags(tenantId, id, dto.tags || []);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/messages')
  async getMessages(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('limit') limitStr?: string,
    @Query('before') before?: string,
  ) {
    if (req.user?.isPortal) {
      await this.conversationsService.assertPortalConversationAccess(tenantId, id, req.user.id, !!req.user.isPrimary);
    }
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (!isNaN(limit) && limit > 0) {
        return this.conversationsService.getMessagesPage(tenantId, id, { limit, before });
      }
    }
    return this.conversationsService.getMessages(tenantId, id);
  }

  @UseGuards(JwtAuthGuard, StorageQuotaGuard, UploadThrottlerGuard)
  @Throttle({ upload: { limit: parseInt(process.env.UPLOAD_RATE_LIMIT ?? '30', 10) || 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: conversationMediaDiskStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  @Post(':id/messages')
  async addMessage(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddConversationMessageDto,
    @UploadedFile() file?: { path?: string; mimetype?: string; size?: number },
  ) {
    const isPortal = req.user?.isPortal === true;
    if (isPortal) {
      await this.conversationsService.assertPortalConversationAccess(tenantId, id, req.user.id, !!req.user.isPrimary);
    }
    const authorType = isPortal ? 'contact' : 'user';
    const contentRaw = (dto.content ?? '').trim();
    let mediaKind: 'image' | 'audio' | 'video' | 'file' | null = null;
    let mediaStorageKey: string | null = null;
    let mediaMime: string | null = null;
    if (file?.path && (file.size ?? 0) > 0) {
      const origName = String((file as { originalname?: string }).originalname || '');
      let mime = normalizeConversationDeclaredMime(
        String(file.mimetype || '')
          .split(';')[0]
          .trim(),
      );
      if (!mime || mime === 'application/octet-stream') {
        const guessed = origName ? conversationMimeFromOriginalname(origName) : null;
        if (guessed) mime = guessed;
      }
      if (mime.startsWith('image/')) mediaKind = 'image';
      else if (mime.startsWith('audio/')) mediaKind = 'audio';
      else if (mime === 'video/mp4' || mime.startsWith('video/mp4;')) mediaKind = 'video';
      else if (mime.startsWith('video/'))
        throw new BadRequestException('Para vídeo no WhatsApp use MP4 (video/mp4).');
      else if (CONVERSATION_DOCUMENT_MIMES.has(mime)) mediaKind = 'file';
      else
        throw new BadRequestException(
          'Tipo de arquivo não permitido (imagem, áudio, vídeo MP4, PDF, Office, CSV, TXT, ZIP, RAR).',
        );
      const head = readFilePrefixSync(file.path, 512);
      const resolvedMime =
        mediaKind === 'file'
          ? validateFileSignature(head, mime)
            ? mime
            : null
          : resolveValidatedConversationMime(head, mime, mediaKind);
      if (!resolvedMime) {
        await fs.promises.unlink(file.path).catch(() => {});
        throw new BadRequestException('Tipo de arquivo não permitido');
      }
      mime = resolvedMime;
      mediaStorageKey = filePathToStorageKey(CONVERSATION_MEDIA_ROOT, file.path);
      mediaMime =
        mime ||
        (mediaKind === 'image' ? 'image/jpeg' : mediaKind === 'audio' ? 'audio/mpeg' : mediaKind === 'video' ? 'video/mp4' : null);
    }
    const display =
      contentRaw ||
      (mediaKind === 'image'
        ? '📷 Imagem'
        : mediaKind === 'audio'
          ? '🎤 Áudio'
          : mediaKind === 'video'
            ? '📹 Vídeo'
            : mediaKind === 'file'
              ? '📎 Documento'
              : '');
    if (!display && !mediaKind) {
      throw new BadRequestException('Mensagem vazia ou ficheiro em falta.');
    }
    const result = await this.conversationsService.addMessage(tenantId, id, req.user.id, req.user.name, authorType, display, {
      mediaKind,
      mediaStorageKey,
      mediaMime,
      mediaCaption: contentRaw || null,
      replyToId: dto.replyToId || null,
    });
    if (file?.size) {
      this.logger.log(JSON.stringify({
        event: 'upload.conversation_media',
        tenantId,
        sizeBytes: file.size,
        mime: file.mimetype,
      }));
      this.quotaService.invalidateCache(tenantId);
    }
    return result;
  }
}
