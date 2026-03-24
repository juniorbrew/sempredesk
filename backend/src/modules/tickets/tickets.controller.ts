import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  Controller, Get, Post, Put, Body, Param, Query,
  UseGuards, Request, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TicketsService } from './tickets.service';
import { CustomersService } from '../customers/customers.service';

import {
  CreateTicketDto,
  UpdateTicketDto,
  AddMessageDto,
  FilterTicketsDto,
  ResolveTicketDto,
  CancelTicketDto,
} from './dto/ticket.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  @RequirePermission('ticket.create')
  async create(@Request() req: any, @Body() dto: CreateTicketDto) {
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
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
        const canAccess = await this.customersService.canContactAccessClient(tenantId, contactId, requestedClientId);
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
  getMessages(@TenantId() tenantId: string, @Param('id') id: string, @Query('internal') internal?: string) {
    return this.ticketsService.getMessages(tenantId, id, internal !== 'false');
  }

  @Post(':id/messages')
  @RequirePermission('ticket.reply')
  addMessage(@Request() req, @Param('id') id: string, @Body() dto: AddMessageDto) {
    const isPortal = req.user?.isPortal === true;
    const authorType = isPortal ? 'contact' : 'user';
    const dtoWithChannel = { ...dto, channel: isPortal ? 'portal' : dto.channel };
    return this.ticketsService.addMessage(req.tenantId, id, req.user.id, req.user.name, authorType, dtoWithChannel);
  }
}
