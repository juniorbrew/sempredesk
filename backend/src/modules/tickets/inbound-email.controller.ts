import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { CustomersService } from '../customers/customers.service';
import { TicketPriority, TicketOrigin } from './entities/ticket.entity';

/**
 * Endpoint para receber e-mails inbound de provedores (Mailgun, SendGrid, Postmark, etc).
 * Configure o webhook para: POST /api/v1/email/inbound
 * Headers obrigatórios: x-tenant-id. Opcional: x-api-secret (se INBOUND_EMAIL_SECRET definido).
 *
 * Associação ao cliente:
 * - Busca contato/cliente pelo e-mail do remetente (contato tem prioridade)
 * - Se não encontrar, usa cliente "E-mail não identificado" (criado automaticamente)
 */
@Controller('email/inbound')
export class InboundEmailController {
  private readonly logger = new Logger(InboundEmailController.name);

  constructor(
    private readonly ticketsService: TicketsService,
    private readonly customersService: CustomersService,
  ) {}

  @Post()
  async receiveEmail(
    @Body() body: any,
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-api-secret') apiSecret?: string,
  ) {
    const expectedSecret = process.env.INBOUND_EMAIL_SECRET;
    if (expectedSecret && apiSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid API secret');
    }

    if (!tenantId) {
      this.logger.warn('Inbound email received without tenantId header');
      return { ok: true };
    }

    try {
      const from = body.from || body.sender || body.From || '';
      const subject = body.subject || body.Subject || 'E-mail sem assunto';
      const text = body['body-plain'] || body.text || body.TextBody || body.body || '';
      const senderEmail = from.match(/<([^>]+)>/)?.[1] || from.trim();
      const senderName = from.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || senderEmail;

      this.logger.log(`Inbound email from ${senderEmail} for tenant ${tenantId}: ${subject}`);

      let clientId: string;
      let contactId: string | undefined;

      const match = await this.customersService.findClientAndContactByEmail(tenantId, senderEmail);
      if (match) {
        clientId = match.clientId;
        contactId = match.contactId;
        this.logger.debug(`Matched to client ${clientId}${contactId ? `, contact ${contactId}` : ''}`);
      } else {
        clientId = await this.customersService.getOrCreateInboundEmailFallbackClient(tenantId);
        this.logger.debug(`Using fallback client ${clientId} for unknown sender ${senderEmail}`);
      }

      const description = `**E-mail recebido de:** ${senderName} <${senderEmail}>\n\n${text.slice(0, 5000)}`;

      const priorityId =
        (await this.ticketsService.resolvePriorityIdFromLegacyEnum(tenantId, TicketPriority.MEDIUM)) ??
        undefined;

      await this.ticketsService.create(
        tenantId,
        'system',
        'Sistema (E-mail)',
        {
          clientId,
          contactId,
          subject: subject.slice(0, 200),
          description,
          priority: TicketPriority.MEDIUM,
          ...(priorityId ? { priorityId } : {}),
          origin: TicketOrigin.EMAIL,
        },
        'user',
      );
    } catch (e) {
      this.logger.error('Failed to create ticket from inbound email:', e?.message || e);
    }

    return { ok: true };
  }
}
