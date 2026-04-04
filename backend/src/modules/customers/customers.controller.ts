import { TenantId } from '../../common/decorators/tenant-id.decorator';
import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CustomersService } from './customers.service';
import {
  CreateClientDto, UpdateClientDto,
  CreateContactDto, UpdateContactDto, FilterClientsDto,
} from './dto/customer.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  /**
   * GET /api/v1/customers/search?q=<termo>
   * Busca clientes por nome/CNPJ (mínimo 2 caracteres).
   * Usado na validação de contato durante o atendimento.
   */
  @Get('search')
  @RequirePermission('customer.view')
  search(@TenantId() tenantId: string, @Query('q') q: string) {
    if (!q || q.trim().length < 2) {
      throw new BadRequestException('Parâmetro "q" deve ter pelo menos 2 caracteres');
    }
    return this.svc.searchByNameOrCnpj(tenantId, q);
  }

  @Post()
  @RequirePermission('customer.create')
  create(@TenantId() tenantId: string, @Body() dto: CreateClientDto) {
    return this.svc.create(tenantId, dto);
  }

  @Get()
  @RequirePermission('customer.view')
  findAll(@TenantId() tenantId: string, @Query() q: FilterClientsDto) {
    return this.svc.findAll(tenantId, q);
  }

  @Get(':id')
  @RequirePermission('customer.view')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission('customer.edit')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.svc.update(tenantId, id, dto);
  }

  @Patch(':id/network')
  @RequirePermission('customer.edit')
  changeNetwork(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { networkId: string | null },
  ) {
    return this.svc.changeNetwork(tenantId, id, body.networkId ?? null);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customer.edit')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.svc.remove(tenantId, id);
  }

  @Post(':id/contacts')
  @RequirePermission('customer.edit')
  createContact(@TenantId() tenantId: string, @Param('id') cId: string, @Body() dto: CreateContactDto) {
    return this.svc.createContact(tenantId, cId, dto);
  }

  @Get(':id/contacts')
  @RequirePermission('customer.view')
  getContacts(@TenantId() tenantId: string, @Param('id') cId: string) {
    return this.svc.findContacts(tenantId, cId);
  }

  @Put(':id/contacts/:cid')
  @RequirePermission('customer.edit')
  updateContact(@TenantId() tenantId: string, @Param('cid') cid: string, @Body() dto: UpdateContactDto) {
    return this.svc.updateContact(tenantId, cid, dto);
  }

  @Delete(':id/contacts/:cid')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('customer.edit')
  removeContact(@TenantId() tenantId: string, @Param('cid') cid: string) {
    return this.svc.removeContact(tenantId, cid);
  }

  /** PATCH /customers/:id/contacts/:cid/archive — arquiva contato ativo */
  @Patch(':id/contacts/:cid/archive')
  @RequirePermission('customer.edit')
  archiveContact(@TenantId() tenantId: string, @Param('cid') cid: string) {
    return this.svc.archiveContact(tenantId, cid);
  }

  /** PATCH /customers/:id/contacts/:cid/unarchive — reativa contato arquivado */
  @Patch(':id/contacts/:cid/unarchive')
  @RequirePermission('customer.edit')
  unarchiveContact(@TenantId() tenantId: string, @Param('cid') cid: string) {
    return this.svc.unarchiveContact(tenantId, cid);
  }

  /** GET /customers/contact/:id — busca contato por ID (independente do cliente) */
  @Get('contact/:contactId')
  @RequirePermission('ticket.view')
  getContactById(@TenantId() tenantId: string, @Param('contactId') contactId: string) {
    return this.svc.findContactById(tenantId, contactId);
  }
}
