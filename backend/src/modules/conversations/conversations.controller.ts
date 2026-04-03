import { Body, Controller, Get, Post, Param, Query, UseGuards, BadRequestException, Request, Put, UseInterceptors, UploadedFile, StreamableFile } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';
import { validateFileSignature } from '../../common/utils/validate-file-signature.util';
import { FileInterceptor } from '@nestjs/platform-express';
import { conversationMediaDiskStorage } from '../../common/utils/multer-disk-storage.util';
import { readFilePrefixSync } from '../../common/utils/read-file-prefix.util';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UploadThrottlerGuard } from '../../common/guards/upload-throttler.guard';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { StartConversationDto, StartAgentConversationDto, CreateTicketForConversationDto, LinkTicketDto, AddConversationMessageDto, CloseConversationDto, UpdateConversationTagsDto } from './dto/conversation.dto';
import { ConversationChannel } from './entities/conversation.entity';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

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
  async getActiveCount(@TenantId() tenantId: string) {
    return this.conversationsService.getActiveCount(tenantId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Get('by-client/:clientId')
  async findByClient(@TenantId() tenantId: string, @Param('clientId') clientId: string, @Query('channel') channel?: string) {
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
    });
    return new StreamableFile(stream, { type: mime, disposition: `inline; filename="media-${messageId}"` });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.findOne(tenantId, id);
  }

  /** Agente abriu a conversa — envia read receipts das mensagens do contato via Baileys */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('ticket.view')
  @Post(':id/mark-read')
  async markRead(@TenantId() tenantId: string, @Param('id') id: string) {
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
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('limit') limitStr?: string,
    @Query('before') before?: string,
  ) {
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
    const authorType = isPortal ? 'contact' : 'user';
    const contentRaw = (dto.content ?? '').trim();
    let mediaKind: 'image' | 'audio' | 'video' | null = null;
    let mediaStorageKey: string | null = null;
    let mediaMime: string | null = null;
    if (file?.path && (file.size ?? 0) > 0) {
      const mime = file.mimetype || '';
      if (mime.startsWith('image/')) mediaKind = 'image';
      else if (mime.startsWith('audio/')) mediaKind = 'audio';
      else if (mime === 'video/mp4' || mime.startsWith('video/mp4;')) mediaKind = 'video';
      else if (mime.startsWith('video/'))
        throw new BadRequestException('Para vídeo no WhatsApp use MP4 (video/mp4).');
      else
        throw new BadRequestException(
          'Envie uma imagem, um áudio ou um vídeo MP4 (tipos: image/*, audio/*, video/mp4).',
        );
      const head = readFilePrefixSync(file.path, 12);
      if (!validateFileSignature(head, mime)) {
        await fs.promises.unlink(file.path).catch(() => {});
        throw new BadRequestException('Tipo de arquivo não permitido');
      }
      const fname = path.basename(file.path);
      mediaStorageKey = path.posix.join(tenantId, fname);
      mediaMime =
        mime ||
        (mediaKind === 'image' ? 'image/jpeg' : mediaKind === 'audio' ? 'audio/mpeg' : mediaKind === 'video' ? 'video/mp4' : null);
    }
    const display =
      contentRaw ||
      (mediaKind === 'image' ? '📷 Imagem' : mediaKind === 'audio' ? '🎤 Áudio' : mediaKind === 'video' ? '📹 Vídeo' : '');
    if (!display && !mediaKind) {
      throw new BadRequestException('Mensagem vazia ou ficheiro em falta.');
    }
    return this.conversationsService.addMessage(tenantId, id, req.user.id, req.user.name, authorType, display, {
      mediaKind,
      mediaStorageKey,
      mediaMime,
    });
  }
}
