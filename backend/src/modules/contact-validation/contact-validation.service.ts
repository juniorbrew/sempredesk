import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Contact } from '../customers/entities/customer.entity';
import { Client } from '../customers/entities/customer.entity';
import { ContactCustomer } from './entities/contact-customer.entity';

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface CandidateClient {
  id: string;
  companyName: string;
  tradeName: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
}

export interface ValidationResult {
  /** true → o agente precisa confirmar/vincular o cliente real */
  needsValidation: boolean;
  /** true → já foi resolvido (confirmado ou pulado) */
  alreadyValidated: boolean;
  contact: {
    id: string;
    name: string;
    whatsapp: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  currentClient: {
    id: string;
    companyName: string;
    autoCreated: boolean;
  } | null;
  /** Clientes reais candidatos para vinculação (via pivot ou por busca por nome/tel) */
  candidateClients: CandidateClient[];
}

// ─── Internal row types ───────────────────────────────────────────────────────

interface ClientRow {
  id: string;
  company_name: string;
  trade_name: string | null;
  cnpj: string | null;
  city: string | null;
  state: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ContactValidationService {
  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,

    @InjectRepository(Contact)
    private readonly contacts: Repository<Contact>,

    @InjectRepository(Client)
    private readonly clients: Repository<Client>,

    @InjectRepository(ContactCustomer)
    private readonly contactCustomers: Repository<ContactCustomer>,
  ) {}

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private get em(): EntityManager {
    return this.tickets.manager;
  }

  private async getTicketOrFail(tenantId: string, ticketId: string): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id: ticketId, tenantId } });
    if (!ticket) throw new NotFoundException('Ticket não encontrado');
    return ticket;
  }

  /** Retorna clientes vinculados ao contato via pivot contact_customers */
  private async linkedClients(
    tenantId: string,
    contactId: string,
  ): Promise<CandidateClient[]> {
    const rows = await this.em.query<ClientRow[]>(
      `SELECT c.id,
              c.company_name AS company_name,
              c.trade_name   AS trade_name,
              c.cnpj,
              c.city,
              c.state
       FROM contact_customers cc
       JOIN clients c ON c.id::text = cc.client_id::text
       WHERE cc.tenant_id::text = $1
         AND cc.contact_id::text = $2
         AND c.status = 'active'
       ORDER BY c.company_name ASC`,
      [tenantId, contactId],
    );

    return rows.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      tradeName: r.trade_name,
      cnpj: r.cnpj,
      city: r.city,
      state: r.state,
    }));
  }

  /**
   * Tenta encontrar clientes reais por nome/whatsapp/email do contato.
   * Exclui clientes auto-criados e o próprio cliente atual.
   */
  private async suggestByContactInfo(
    tenantId: string,
    contact: Contact,
    excludeClientId: string,
  ): Promise<CandidateClient[]> {
    const parts: string[] = [];
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (contact.whatsapp) {
      parts.push(`c.whatsapp = $${idx++}`);
      params.push(contact.whatsapp);
    }
    if (contact.email) {
      parts.push(`LOWER(TRIM(c.email)) = $${idx++}`);
      params.push(contact.email.toLowerCase().trim());
    }
    if (contact.name) {
      parts.push(`c.company_name ILIKE $${idx++}`);
      params.push(`%${contact.name}%`);
    }

    if (parts.length === 0) return [];

    params.push(excludeClientId);
    const excludeIdx = idx++;

    const rows = await this.em.query<ClientRow[]>(
      `SELECT c.id,
              c.company_name AS company_name,
              c.trade_name   AS trade_name,
              c.cnpj,
              c.city,
              c.state
       FROM clients c
       WHERE c.tenant_id::text = $1
         AND c.status = 'active'
         AND c.id::text != $${excludeIdx}
         AND (metadata->>'autoCreated')::boolean IS NOT TRUE
         AND (${parts.join(' OR ')})
       ORDER BY c.company_name ASC
       LIMIT 10`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      tradeName: r.trade_name,
      cnpj: r.cnpj,
      city: r.city,
      state: r.state,
    }));
  }

  /** Deduplicates candidate lists by id, linked-clients first */
  private mergeCandidates(
    linked: CandidateClient[],
    suggested: CandidateClient[],
  ): CandidateClient[] {
    const seen = new Set<string>(linked.map((c) => c.id));
    const extra = suggested.filter((c) => !seen.has(c.id));
    return [...linked, ...extra];
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * GET /attendance/:ticketId/contact-validation
   *
   * Retorna o status de validação do contato para o agente:
   *  - Se não há contactId no ticket → needsValidation = false
   *  - Se o cliente atual foi auto-criado e ainda não foi validado → needsValidation = true
   *  - Se já foi validado (customerSelectedAt ou unlinkedContact) → alreadyValidated = true
   */
  async validateContactOnAttendance(
    tenantId: string,
    ticketId: string,
  ): Promise<ValidationResult> {
    const ticket = await this.getTicketOrFail(tenantId, ticketId);

    // Sem contato → não há o que validar
    if (!ticket.contactId) {
      return {
        needsValidation: false,
        alreadyValidated: false,
        contact: null,
        currentClient: null,
        candidateClients: [],
      };
    }

    // Já resolvido
    if (ticket.customerSelectedAt || ticket.unlinkedContact) {
      return {
        needsValidation: false,
        alreadyValidated: true,
        contact: null,
        currentClient: null,
        candidateClients: [],
      };
    }

    const contact = await this.contacts.findOne({
      where: { id: ticket.contactId, tenantId },
      relations: ['client'],
    });

    if (!contact) {
      return {
        needsValidation: false,
        alreadyValidated: false,
        contact: null,
        currentClient: null,
        candidateClients: [],
      };
    }

    const currentClient = ticket.clientId
      ? await this.clients.findOne({ where: { id: ticket.clientId, tenantId } })
      : null;

    // Detecta cliente temporário (WhatsApp) por metadata OU pelo padrão de nome "(WhatsApp)"
    const isAutoCreated =
      currentClient?.metadata?.['autoCreated'] === true ||
      currentClient?.metadata?.['autoCreated'] === 'true' ||
      /\(WhatsApp\)$/i.test(currentClient?.companyName ?? '') ||
      /\(WhatsApp\)$/i.test(currentClient?.tradeName ?? '');

    // O contato já está vinculado a um cliente real (não auto-criado) → sem necessidade de validação
    // Verifica tanto o contato em si quanto o cliente do ticket
    const contactLinkedClient = contact.clientId
      ? await this.clients.findOne({ where: { id: contact.clientId, tenantId } })
      : null;
    const contactClientIsTemp =
      !contactLinkedClient ||
      /\(WhatsApp\)$/i.test(contactLinkedClient?.companyName ?? '') ||
      contactLinkedClient?.metadata?.['autoCreated'] === true;

    const contactAlreadyLinked = !!contact.clientId && !contactClientIsTemp;
    const clientIsReal = currentClient && !isAutoCreated;

    if (contactAlreadyLinked && clientIsReal) {
      return {
        needsValidation: false,
        alreadyValidated: false,
        contact: {
          id: contact.id,
          name: contact.name,
          whatsapp: contact.whatsapp ?? null,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
        },
        currentClient: { id: currentClient.id, companyName: currentClient.companyName, autoCreated: false },
        candidateClients: [],
      };
    }

    // Contato sem cliente vinculado OU cliente auto-criado → agente precisa confirmar/vincular
    // Busca candidatos: clientes vinculados via pivot + sugestão por dados do contato
    const linked = await this.linkedClients(tenantId, contact.id);
    const suggested = await this.suggestByContactInfo(
      tenantId,
      contact,
      ticket.clientId ?? '',
    );
    const candidateClients = this.mergeCandidates(linked, suggested);

    return {
      needsValidation: true,
      alreadyValidated: false,
      contact: {
        id: contact.id,
        name: contact.name,
        whatsapp: contact.whatsapp ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
      },
      currentClient: currentClient
        ? {
            id: currentClient.id,
            companyName: currentClient.companyName,
            autoCreated: isAutoCreated,
          }
        : null,
      candidateClients,
    };
  }

  /**
   * POST /attendance/:ticketId/select-customer
   * Body: { clientId }
   *
   * Atualiza ticket.clientId para o cliente selecionado (já existente no sistema).
   * Não cria vínculo N:N — apenas confirma o cliente correto.
   */
  async selectCustomerForTicket(
    tenantId: string,
    ticketId: string,
    clientId: string,
    agentId: string,
  ): Promise<{ ticketId: string; clientId: string }> {
    await this.em.transaction(async (trx) => {
      const ticket = await trx.findOne(Ticket, {
        where: { id: ticketId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Ticket não encontrado');

      const client = await trx.findOne(Client, { where: { id: clientId, tenantId } });
      if (!client) throw new NotFoundException('Cliente não encontrado');

      if (ticket.customerSelectedAt || ticket.unlinkedContact) {
        throw new BadRequestException('Ticket já foi validado');
      }

      ticket.clientId = clientId;
      ticket.customerSelectedAt = new Date();
      await trx.save(Ticket, ticket);

      // Atualiza conversa vinculada ao ticket
      if (ticket.conversationId) {
        await trx.query(
          `UPDATE conversations SET client_id = $1 WHERE id = $2 AND tenant_id = $3`,
          [clientId, ticket.conversationId, tenantId],
        );
      }

      // Vincula o contato ao cliente (se ainda não tiver clientId)
      if (ticket.contactId) {
        await trx.query(
          `UPDATE contacts SET client_id = $1 WHERE id = $2 AND tenant_id = $3 AND client_id IS NULL`,
          [clientId, ticket.contactId, tenantId],
        );
      }

      // Audit log
      await trx.query(
        `INSERT INTO ticket_messages
           (id, tenant_id, ticket_id, author_id, author_type, author_name, "messageType", content, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'user', 'Sistema', 'system',
            $4, NOW())`,
        [
          tenantId,
          ticketId,
          agentId,
          `Cliente vinculado: "${client.tradeName || client.companyName}" — contato adicionado automaticamente ao cadastro`,
        ],
      );
    });

    return { ticketId, clientId };
  }

  /**
   * POST /attendance/:ticketId/link-contact
   * Body: { clientId }
   *
   * Cria registro N:N em contact_customers (contactId ↔ clientId)
   * E atualiza o ticket para apontar ao cliente real.
   */
  async linkContactToCustomer(
    tenantId: string,
    ticketId: string,
    clientId: string,
    agentId: string,
  ): Promise<{ ticketId: string; clientId: string; contactCustomerId: string }> {
    let contactCustomerId = '';

    await this.em.transaction(async (trx) => {
      const ticket = await trx.findOne(Ticket, {
        where: { id: ticketId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Ticket não encontrado');

      if (!ticket.contactId) {
        throw new BadRequestException('Ticket não possui contato associado');
      }

      const client = await trx.findOne(Client, { where: { id: clientId, tenantId } });
      if (!client) throw new NotFoundException('Cliente não encontrado');

      const contact = await trx.findOne(Contact, {
        where: { id: ticket.contactId, tenantId },
      });
      if (!contact) throw new NotFoundException('Contato do ticket não encontrado');

      if (ticket.customerSelectedAt || ticket.unlinkedContact) {
        throw new BadRequestException('Ticket já foi validado');
      }

      // Upsert no pivot (evita duplicata — único por contact_id+client_id)
      const upsertResult = await trx.query<{ id: string }[]>(
        `INSERT INTO contact_customers (id, tenant_id, contact_id, client_id, linked_by, linked_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
         ON CONFLICT (contact_id, client_id) DO UPDATE
           SET linked_by = EXCLUDED.linked_by,
               linked_at = EXCLUDED.linked_at
         RETURNING id`,
        [tenantId, contact.id, clientId, agentId],
      );
      contactCustomerId = upsertResult[0]?.id ?? '';

      // Vincula o contato ao cliente no cadastro (contact.clientId)
      contact.clientId = clientId;
      await trx.save(Contact, contact);

      // Atualiza ticket
      ticket.clientId = clientId;
      ticket.customerSelectedAt = new Date();
      await trx.save(Ticket, ticket);

      // Audit log
      await trx.query(
        `INSERT INTO ticket_messages
           (id, tenant_id, ticket_id, author_id, author_type, author_name, "messageType", content, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'user', 'Sistema', 'system', $4, NOW())`,
        [
          tenantId,
          ticketId,
          agentId,
          `Contato vinculado ao cliente "${client.companyName}" pelo agente`,
        ],
      );
    });

    return { ticketId, clientId, contactCustomerId };
  }

  /**
   * POST /attendance/:ticketId/skip-link
   *
   * Agente optou por não vincular o contato a um cliente real.
   * Marca ticket.unlinkedContact = true.
   */
  async skipCustomerLink(
    tenantId: string,
    ticketId: string,
    agentId: string,
  ): Promise<{ ticketId: string }> {
    await this.em.transaction(async (trx) => {
      const ticket = await trx.findOne(Ticket, {
        where: { id: ticketId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) throw new NotFoundException('Ticket não encontrado');

      if (ticket.customerSelectedAt || ticket.unlinkedContact) {
        throw new BadRequestException('Ticket já foi validado');
      }

      ticket.unlinkedContact = true;
      await trx.save(Ticket, ticket);

      // Audit log
      await trx.query(
        `INSERT INTO ticket_messages
           (id, tenant_id, ticket_id, author_id, author_type, author_name, "messageType", content, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, 'user', 'Sistema', 'system', $4, NOW())`,
        [
          tenantId,
          ticketId,
          agentId,
          'Agente optou por não vincular o contato a um cliente cadastrado',
        ],
      );
    });

    return { ticketId };
  }
}
