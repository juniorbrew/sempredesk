import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  Controller, Get, Post, Put, Body, Param, Query,
  UseGuards, Request, BadRequestException, NotFoundException, UnprocessableEntityException,
  UseInterceptors, UploadedFile,
  StreamableFile, Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ticketItem4AttachmentsDiskStorage, ticketReplyMediaDiskStorage } from '../../common/utils/multer-disk-storage.util';
import { readFilePrefixSync } from '../../common/utils/read-file-prefix.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UploadThrottlerGuard } from '../../common/guards/upload-throttler.guard';
import { StorageQuotaGuard } from '../../common/guards/storage-quota.guard';
import { StorageQuotaService } from '../../modules/storage/storage-quota.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TicketsService } from './tickets.service';
import { CustomersService } from '../customers/customers.service';

import {
  CreateTicketDto,
  UpdateTicketDto,
  UpdateTicketContentDto,
  AddMessageDto,
  FilterTicketsDto,
  ResolveTicketDto,
  CancelTicketDto,
} from './dto/ticket.dto';
import { TicketOrigin } from './entities/ticket.entity';
import { validateFileSignature } from '../../common/utils/file-signature.util';
import { validateFileSignature as validateStrictFileSignature } from '../../common/utils/validate-file-signature.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tickets')
export class TicketsController {
  private readonly logger = new Logger(TicketsController.name);

  constructor(
    private readonly ticketsService: TicketsService,
    private readonly customersService: CustomersService,
    private readonly quotaService: StorageQuotaService,
  ) {}

  @Post()
  @RequirePermission('ticket.create')
  async create(@Request() req: any, @Body() dto: CreateTicketDto) {
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    if (isPortal) {
      if (!dto.clientId) {
        throw new BadRequestException('clientId é obrigatório para o portal');
      }

      const portalContact = await this.customersService.findPortalContactForClient(
        req.tenantId,
        req.user?.email,
        dto.clientId,
      );

      if (!portalContact) {
        throw new BadRequestException('Contato do portal não possui acesso a esta empresa');
      }

      dto = {
        ...dto,
        contactId: portalContact.id,
        origin: dto.origin || TicketOrigin.PORTAL,
      };
    }

    const ticket = await this.ticketsService.create(req.tenantId, req.user.id, req.user.name, dto, authorType);
    if (isPortal) {
      const diff = ticket.slaResponseAt ? Math.max(0, ticket.slaResponseAt.getTime() - Date.now()) : 0;
      const mins = Math.ceil(diff / 60000);
      const estimated = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}min`;
      return { ticket_id: ticket.ticketNumber, id: ticket.id, status: ticket.status, estimated_response: estimated };
    }
    return ticket;
  }

  @Get()
  @RequirePermission('ticket.view')
  async findAll(@Request() req: any, @TenantId() tenantId: string, @Query() filters: FilterTicketsDto) {
    // Agentes sem ticket.view_all só enxergam os próprios tickets
    if (!req.user?.isPortal) {
      const role: string = req.user?.role || '';
      const perms: string[] = req.user?.permissions || [];
      const isAdmin = role === 'super_admin' || role === 'admin';
      if (!isAdmin && !perms.includes('ticket.view_all')) {
        if (!(filters as any).assignedTo) {
          (filters as any).assignedTo = req.user.id;
        }
      }
    }
    if (req.user?.isPortal) {
      const requestedClientId = (filters as any).clientId;
      const contactId = req.user.id;
      const fallbackClientId = req.user.clientId;
      const isPrimary = !!req.user.isPrimary;
      let effectiveClientId = fallbackClientId;
      if (requestedClientId) {
        const canAccess = await this.customersService.canPortalEmailAccessClient(
          tenantId,
          req.user?.email,
          requestedClientId,
        );
        effectiveClientId = canAccess ? requestedClientId : fallbackClientId;
      }
      filters = { ...filters, clientId: effectiveClientId };
      // Contato principal: vê todos os tickets da empresa. Contato normal: só os vinculados a ele.
      if (isPrimary) delete (filters as any).contactId;
      else (filters as any).contactId = contactId;
    }
    return this.ticketsService.findAll(tenantId, filters);
  }

  @Get('stats')
  @RequirePermission('ticket.view')
  getStats(@TenantId() tenantId: string) {
    return this.ticketsService.getStats(tenantId);
  }

  /** Tickets em formato de conversas para inbox (portal/whatsapp) — ordenados por última mensagem */
  @Get('conversations')
  @RequirePermission('ticket.view')
  getConversations(
    @TenantId() tenantId: string,
    @Query('origin') origin?: 'portal' | 'whatsapp',
    @Query('status') status?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.ticketsService.getConversationsAsInbox(tenantId, {
      origin: origin === 'portal' || origin === 'whatsapp' ? origin : undefined,
      status: status || 'active',
      perPage: perPage ? parseInt(perPage, 10) : 50,
    });
  }

  @Get('by-number/:number')
  @RequirePermission('ticket.view')
  async findByNumber(@Request() req: any, @TenantId() tenantId: string, @Param('number') number: string, @Query('clientId') clientId?: string) {
    const cid = clientId || req.user?.clientId;
    if (req.user?.isPortal && !cid) throw new BadRequestException('clientId é obrigatório para o portal');
    return this.ticketsService.findByNumberForClient(tenantId, number.trim(), cid);
  }

  /** Download de anexo criado via POST /tickets/:id/attachments (TICKET_ATTACHMENTS_DIR). */
  @Get('attachments/:attachmentId')
  @RequirePermission('ticket.view')
  async getTicketAttachmentItem4(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<StreamableFile> {
    if (req.user?.isPortal === true) {
      const ticketId = await this.ticketsService.getTicketReplyAttachmentTicketId(tenantId, attachmentId);
      const ticket = await this.ticketsService.findOne(tenantId, ticketId);
      if (ticket.clientId) {
        const canAccess = await this.customersService.canContactAccessTicket(
          tenantId,
          req.user.id,
          ticket.clientId,
          ticket.contactId ?? null,
          !!req.user.isPrimary,
        );
        if (!canAccess) throw new NotFoundException('Ticket não encontrado');
      }
    }
    const { stream, mime, originalFilename } = await this.ticketsService.getItem4AttachmentMediaStream(
      tenantId,
      attachmentId,
      { isPortal: req.user?.isPortal === true },
    );
    const safeBase = (originalFilename || 'anexo').replace(/["\r\n]/g, '_').slice(0, 200);
    return new StreamableFile(stream, {
      type: mime,
      disposition: `inline; filename="${safeBase}"`,
    });
  }

  @Get(':id')
  @RequirePermission('ticket.view')
  async findOne(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string) {
    const ticket = await this.ticketsService.findOne(tenantId, id);
    if (req.user?.isPortal && ticket.clientId) {
      const canAccess = await this.customersService.canContactAccessTicket(
        tenantId,
        req.user.id,
        ticket.clientId,
        ticket.contactId ?? null,
        !!req.user.isPrimary,
      );
      if (!canAccess) throw new NotFoundException('Ticket não encontrado');
    }
    return ticket;
  }

  @Put(':id')
  @RequirePermission('ticket.edit')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketsService.update(req.tenantId, id, req.user.id, req.user.name, dto);
  }

  @Put(':id/content')
  @RequirePermission('ticket.edit_content')
  updateContent(@Request() req, @Param('id') id: string, @Body() dto: UpdateTicketContentDto) {
    return this.ticketsService.updateContent(req.tenantId, id, req.user.id, req.user.name, dto);
  }

  @Post(':id/attachments')
  @RequirePermission('ticket.reply')
  @UseGuards(StorageQuotaGuard, UploadThrottlerGuard)
  @Throttle({ upload: { limit: parseInt(process.env.UPLOAD_RATE_LIMIT ?? '30', 10) || 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: ticketItem4AttachmentsDiskStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  async addTicketAttachmentItem4(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('content') content: string | undefined,
    @UploadedFile() file?: { path?: string; mimetype?: string; originalname?: string; size?: number },
  ) {
    if (!file?.path || (file.size ?? 0) <= 0) {
      throw new BadRequestException('Envie o ficheiro no campo file.');
    }
    const head = readFilePrefixSync(file.path, 12);
    if (!validateStrictFileSignature(head, file.mimetype || '')) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new BadRequestException('Tipo de arquivo não permitido');
    }
    const ticket = await this.ticketsService.findOne(tenantId, id);
    if (req.user?.isPortal === true && ticket.clientId) {
      const canAccess = await this.customersService.canContactAccessTicket(
        tenantId,
        req.user.id,
        ticket.clientId,
        ticket.contactId ?? null,
        !!req.user.isPrimary,
      );
      if (!canAccess) throw new NotFoundException('Ticket não encontrado');
    }
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    const storageKey = path.posix.join(tenantId, path.basename(file.path));
    const result = await this.ticketsService.addTicketAttachmentItem4(
      tenantId,
      id,
      req.user.id,
      req.user.name,
      authorType,
      {
        content: content ?? undefined,
        storageKey,
        originalFilename: file.originalname,
        mime: file.mimetype || '',
        channel: isPortal ? 'portal' : undefined,
      },
    );
    this.logger.log(JSON.stringify({
      event: 'upload.ticket_attachment',
      tenantId,
      ticketId: id,
      sizeBytes: file.size,
      mime: file.mimetype,
    }));
    this.quotaService.invalidateCache(tenantId);
    return result;
  }

  @Post(':id/assign')
  @RequirePermission('ticket.transfer')
  assign(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string, @Body() body: { techId: string }) {
    return this.ticketsService.assign(tenantId, id, body.techId, req.user?.id, req.user?.name);
  }

  @Post(':id/resolve')
  @RequirePermission('ticket.close')
  resolve(@Request() req, @Param('id') id: string, @Body() dto: ResolveTicketDto) {
    return this.ticketsService.resolve(req.tenantId, id, req.user.id, req.user.name, dto);
  }

  @Post(':id/close')
  @RequirePermission('ticket.close')
  close(@Request() req, @Param('id') id: string) {
    return this.ticketsService.close(req.tenantId, id, req.user.id, req.user.name);
  }

  @Post(':id/cancel')
  @RequirePermission('ticket.close')
  cancel(@Request() req, @Param('id') id: string, @Body() dto: CancelTicketDto) {
    return this.ticketsService.cancel(req.tenantId, id, req.user.id, req.user.name, dto);
  }

  @Post(':id/escalate')
  @RequirePermission('ticket.transfer')
  escalate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ticketsService.escalate(tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/satisfaction')
  submitSatisfaction(@TenantId() tenantId: string, @Param('id') id: string, @Body() body: { score: 'approved' | 'rejected' }) {
    return this.ticketsService.submitSatisfaction(tenantId, id, body.score);
  }

  @Get(':id/messages')
  @RequirePermission('ticket.view')
  getMessages(
    @Request() req,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('includeInternal') includeInternal?: string,
    @Query('limit') limitStr?: string,
    @Query('before') before?: string,
  ) {
    // Usuários portal NUNCA recebem notas internas, independente do parâmetro enviado
    const isPortal = req.user?.isPortal === true;
    const withInternal = isPortal ? false : includeInternal !== 'false';
    if (limitStr) {
      const limit = parseInt(limitStr, 10);
      if (!isNaN(limit) && limit > 0) {
        return this.ticketsService.getMessagesPage(tenantId, id, { limit, before, includeInternal: withInternal });
      }
    }
    return this.ticketsService.getMessages(tenantId, id, withInternal);
  }

  /**
   * Download/stream do anexo de resposta pública (tabela ticket_reply_attachments).
   * Não reutiliza GET /conversations/messages/:id/media.
   */
  @Get(':id/reply-attachments/:attachmentId/media')
  @RequirePermission('ticket.view')
  async getReplyAttachmentMedia(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<StreamableFile> {
    const ticket = await this.ticketsService.findOne(tenantId, id);
    if (req.user?.isPortal === true && ticket.clientId) {
      const canAccess = await this.customersService.canContactAccessTicket(
        tenantId,
        req.user.id,
        ticket.clientId,
        ticket.contactId ?? null,
        !!req.user.isPrimary,
      );
      if (!canAccess) {
        throw new NotFoundException('Ticket não encontrado');
      }
    }
    const { stream, mime, originalFilename } = await this.ticketsService.getReplyAttachmentMediaStream(
      tenantId,
      id,
      attachmentId,
      { isPortal: req.user?.isPortal === true },
    );
    const safeBase = (originalFilename || 'anexo').replace(/["\r\n]/g, '_').slice(0, 200);
    return new StreamableFile(stream, {
      type: mime,
      disposition: `inline; filename="${safeBase}"`,
    });
  }

  /**
   * Resposta pública com anexo (domínio ticket). Não usa conversa nem conversationId.
   * Multipart: campo `file` + opcional `content`. Áudio/vídeo não permitidos.
   */
  @Post(':id/messages/attachment')
  @RequirePermission('ticket.reply')
  @UseGuards(StorageQuotaGuard, UploadThrottlerGuard)
  @Throttle({ upload: { limit: parseInt(process.env.UPLOAD_RATE_LIMIT ?? '30', 10) || 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: ticketReplyMediaDiskStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  async addPublicReplyAttachment(
    @Request() req: any,
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('content') content: string | undefined,
    @UploadedFile() file?: { path?: string; mimetype?: string; originalname?: string; size?: number },
  ) {
    if (!file?.path || (file.size ?? 0) <= 0) {
      throw new BadRequestException('Envie o ficheiro no campo file.');
    }
    const head = readFilePrefixSync(file.path, 64);
    if (!validateFileSignature(head, file.mimetype || '')) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new UnprocessableEntityException('O conteúdo do ficheiro não corresponde ao tipo declarado.');
    }
    if (!this.ticketsService.isPublicReplyAttachmentMimeAllowed(file.mimetype || '')) {
      await fs.promises.unlink(file.path).catch(() => {});
      throw new BadRequestException(
        'Tipo de ficheiro não permitido para anexo de ticket (áudio/vídeo não são aceites; use imagem, PDF, Office ou ZIP).',
      );
    }
    const ticket = await this.ticketsService.findOne(tenantId, id);
    if (req.user?.isPortal === true && ticket.clientId) {
      const canAccess = await this.customersService.canContactAccessTicket(
        tenantId,
        req.user.id,
        ticket.clientId,
        ticket.contactId ?? null,
        !!req.user.isPrimary,
      );
      if (!canAccess) throw new NotFoundException('Ticket não encontrado');
    }
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    const storageKey = path.posix.join(tenantId, path.basename(file.path));
    const result = await this.ticketsService.addPublicReplyWithAttachment(
      tenantId,
      id,
      req.user.id,
      req.user.name,
      authorType,
      {
        content: content ?? undefined,
        storageKey,
        originalFilename: file.originalname,
        mime: file.mimetype || '',
        channel: isPortal ? 'portal' : undefined,
      },
    );
    this.logger.log(JSON.stringify({
      event: 'upload.ticket_reply_attachment',
      tenantId,
      ticketId: id,
      sizeBytes: file.size,
      mime: file.mimetype,
    }));
    this.quotaService.invalidateCache(tenantId);
    return result;
  }

  @Post(':id/messages')
  @RequirePermission('ticket.reply')
  addMessage(@Request() req, @Param('id') id: string, @Body() dto: AddMessageDto) {
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    const { skipInAppBell: _ignore, ...safeDto } = dto as AddMessageDto & { skipInAppBell?: boolean };
    const dtoWithChannel = { ...safeDto, channel: isPortal ? 'portal' : safeDto.channel };
    return this.ticketsService.addMessage(req.tenantId, id, req.user.id, req.user.name, authorType, dtoWithChannel);
  }
}
