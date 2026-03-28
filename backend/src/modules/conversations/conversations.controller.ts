import { Body, Controller, Get, Post, Param, Query, UseGuards, BadRequestException, Request, Put } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
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

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.findOne(tenantId, id);
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
  async getMessages(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.conversationsService.getMessages(tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/messages')
  async addMessage(@Request() req: any, @TenantId() tenantId: string, @Param('id') id: string, @Body() dto: AddConversationMessageDto) {
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    return this.conversationsService.addMessage(tenantId, id, req.user.id, req.user.name, authorType, dto.content);
  }
}
