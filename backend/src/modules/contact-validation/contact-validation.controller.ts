import {
  Controller, Get, Post, Param, Body, UseGuards, HttpCode, HttpStatus, Request,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { ContactValidationService, LinkByCnpjResult } from './contact-validation.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class SelectOrLinkCustomerDto {
  @IsUUID()
  clientId!: string;
}

class LinkByCnpjDto {
  cnpj!: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * Endpoints de validação e vinculação de contato durante o atendimento.
 *
 * Fluxo:
 *   1. GET  /attendance/:ticketId/contact-validation — verifica se precisa validar
 *   2. Se needsValidation = true, o agente escolhe uma ação:
 *      a. POST /attendance/:ticketId/select-customer  — confirma cliente existente
 *      b. POST /attendance/:ticketId/link-contact     — vincula contato ao cliente (pivot N:N)
 *      c. POST /attendance/:ticketId/skip-link        — pula vinculação
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContactValidationController {
  constructor(private readonly validationSvc: ContactValidationService) {}

  /**
   * GET /api/v1/attendance/:ticketId/contact-validation
   *
   * Retorna o estado de validação do contato associado ao ticket.
   * Se needsValidation = true → exibir painel de vinculação para o agente.
   */
  @Get(':ticketId/contact-validation')
  @RequirePermission('attendance.view')
  getValidation(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
  ) {
    return this.validationSvc.validateContactOnAttendance(tenantId, ticketId);
  }

  /**
   * POST /api/v1/attendance/:ticketId/select-customer
   * Body: { "clientId": "<uuid>" }
   *
   * Confirma que o ticket deve ser associado ao clientId fornecido.
   * Não cria vínculo N:N — apenas atualiza o ticket.
   */
  @Post(':ticketId/select-customer')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customer.edit')
  selectCustomer(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: SelectOrLinkCustomerDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.validationSvc.selectCustomerForTicket(
      tenantId,
      ticketId,
      dto.clientId,
      req.user.id,
    );
  }

  /**
   * POST /api/v1/attendance/:ticketId/link-contact
   * Body: { "clientId": "<uuid>" }
   *
   * Cria vínculo N:N (contact_customers) e atualiza o ticket para o cliente real.
   */
  @Post(':ticketId/link-contact')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customer.edit')
  linkContact(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Body() dto: SelectOrLinkCustomerDto,
    @Request() req: { user: { id: string } },
  ) {
    return this.validationSvc.linkContactToCustomer(
      tenantId,
      ticketId,
      dto.clientId,
      req.user.id,
    );
  }

  /**
   * POST /api/v1/attendance/:ticketId/skip-link
   *
   * Agente opta por não vincular o contato a um cliente real.
   * Marca ticket.unlinkedContact = true.
   */
  @Post(':ticketId/skip-link')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customer.edit')
  skipLink(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.validationSvc.skipCustomerLink(tenantId, ticketId, req.user.id);
  }

  /**
   * POST /api/v1/attendance/:ticketId/link-by-cnpj
   * Body: { "cnpj": "XX.XXX.XXX/XXXX-XX" }
   *
   * Tenta vincular o contato do ticket ao cliente correspondente ao CNPJ informado.
   * Retorna status: 'linked' | 'multiple_matches' | 'not_found' | 'invalid_cnpj'
   */
  @Post(':ticketId/link-by-cnpj')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('customer.edit')
  linkByCnpj(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: LinkByCnpjDto,
    @Request() req: { user: { id: string } },
  ): Promise<LinkByCnpjResult> {
    return this.validationSvc.linkContactByCnpj(tenantId, ticketId, body.cnpj, req.user.id);
  }
}
