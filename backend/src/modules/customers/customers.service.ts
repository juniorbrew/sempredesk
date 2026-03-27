import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Client, Contact } from './entities/customer.entity';
import {
  CreateClientDto, UpdateClientDto,
  CreateContactDto, UpdateContactDto, FilterClientsDto,
} from './dto/customer.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { normalizeCnpj, validateCnpj as validateCnpjUtil } from '../../common/utils/cnpj.utils';
import { normalizeWhatsappNumber } from '../../common/utils/phone.utils';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
  ) {}

  private async nextCode(tenantId: string): Promise<string> {
    const last = await this.clients.createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.code IS NOT NULL')
      .orderBy('c.code', 'DESC')
      .getOne();

    const next = last?.code ? parseInt(last.code, 10) + 1 : 1;
    return String(next).padStart(6, '0');
  }

  private async getClientOrFail(tenantId: string, id: string): Promise<Client> {
    const client = await this.clients.findOne({
      where: { id, tenantId },
      relations: ['contacts'],
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    client.contacts = (client.contacts || []).filter((ct) => ct.status !== 'inactive');
    return client;
  }

  private async getContactOrFail(tenantId: string, contactId: string): Promise<Contact> {
    const contact = await this.contacts.findOne({
      where: { id: contactId, tenantId },
      relations: ['client'],
    });

    if (!contact) {
      throw new NotFoundException('Contato não encontrado');
    }

    return contact;
  }

  /** Valida CPF pelo algoritmo dos dígitos verificadores */
  private validateCpf(cpf: string): boolean {
    const raw = cpf.replace(/\D/g, '');
    if (raw.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(raw)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(raw[i]) * (10 - i);
    let r = 11 - (sum % 11);
    if (r >= 10) r = 0;
    if (r !== parseInt(raw[9])) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(raw[i]) * (11 - i);
    r = 11 - (sum % 11);
    if (r >= 10) r = 0;
    return r === parseInt(raw[10]);
  }

  /** Valida CNPJ — delega ao utilitário centralizado em common/utils/cnpj.utils */
  private validateCnpj(cnpj: string): boolean {
    return validateCnpjUtil(cnpj);
  }

  private async assertNetworkBelongsToTenant(tenantId: string, networkId?: string | null) {
    if (!networkId) return;

    const result = await this.clients.manager.query(
      'SELECT id FROM networks WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [tenantId, networkId],
    );

    if (!result.length) {
      throw new BadRequestException('Rede informada não pertence ao tenant atual');
    }
  }

  /** Busca cliente e contato pelo email (contato tem prioridade sobre cliente) */
  async findClientAndContactByEmail(
    tenantId: string,
    email: string,
  ): Promise<{ clientId: string; contactId?: string } | null> {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return null;

    const contactRow = await this.clients.manager.query(
      `SELECT c.id as contact_id, c.client_id
       FROM contacts c
       WHERE c.tenant_id = $1 AND c.status = 'active'
         AND LOWER(TRIM(c.email)) = $2
       LIMIT 1`,
      [tenantId, normalized],
    );
    if (contactRow.length) {
      return { clientId: contactRow[0].client_id, contactId: contactRow[0].contact_id };
    }

    const clientRow = await this.clients.manager.query(
      `SELECT id FROM clients
       WHERE tenant_id = $1 AND status = 'active'
         AND LOWER(TRIM(email)) = $2
       LIMIT 1`,
      [tenantId, normalized],
    );
    if (clientRow.length) {
      return { clientId: clientRow[0].id };
    }

    return null;
  }

  /** Retorna ou cria o cliente fallback para e-mails de remetentes não identificados */
  async getOrCreateInboundEmailFallbackClient(tenantId: string): Promise<string> {
    const existing = await this.clients.findOne({
      where: {
        tenantId,
        companyName: 'E-mail não identificado',
        status: 'active',
      },
    });
    if (existing) return existing.id;

    const code = await this.nextCode(tenantId);
    const client = await this.clients.save(
      this.clients.create({
        tenantId,
        code,
        companyName: 'E-mail não identificado',
        tradeName: 'Remetentes de e-mail sem cadastro',
        status: 'active',
        metadata: { inbound_email_fallback: true },
      }),
    );
    return client.id;
  }

  async create(tenantId: string, dto: CreateClientDto) {
    const personType = (dto as any).personType || 'juridica';

    if (personType === 'juridica' && dto.cnpj) {
      const raw = dto.cnpj.replace(/\D/g, '');
      if (raw.length === 14 && !this.validateCnpj(raw)) {
        throw new BadRequestException('CNPJ inválido');
      }
      const existing = await this.clients.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere("REGEXP_REPLACE(c.cnpj, '[^0-9]', '', 'g') = :raw", { raw })
        .getOne();
      if (existing) throw new ConflictException('CNPJ já cadastrado para outro cliente');
    }

    if (personType === 'fisica' && (dto as any).cpf) {
      const raw = ((dto as any).cpf as string).replace(/\D/g, '');
      if (raw.length === 11 && !this.validateCpf(raw)) {
        throw new BadRequestException('CPF inválido');
      }
      const existing = await this.clients.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere("REGEXP_REPLACE(c.cpf, '[^0-9]', '', 'g') = :raw", { raw })
        .getOne();
      if (existing) throw new ConflictException('CPF já cadastrado para outro cliente');
    }

    await this.assertNetworkBelongsToTenant(tenantId, (dto as any).networkId);

    const code = await this.nextCode(tenantId);

    return this.clients.save(this.clients.create({
      ...dto,
      tenantId,
      code,
      personType,
    }));
  }

  async findAll(tenantId: string, filter: FilterClientsDto & PaginationDto) {
    const {
      search, status, city, state, page = 1, perPage = 20, networkId,
    } = filter as any;

    const qb = this.clients.createQueryBuilder('c')
      .leftJoinAndSelect('c.contacts', 'ct', "ct.status != 'inactive'")
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.code', 'ASC');

    if (search) {
      qb.andWhere(
        '(c.company_name ILIKE :s OR c.trade_name ILIKE :s OR c.cnpj ILIKE :s OR c.email ILIKE :s OR c.code ILIKE :s)',
        { s: `%${search}%` },
      );
    }

    if (status) qb.andWhere('c.status = :status', { status });
    if (networkId) qb.andWhere('c.network_id = :networkId', { networkId });
    if (city) qb.andWhere('c.city ILIKE :city', { city: `%${city}%` });
    if (state) qb.andWhere('c.state = :state', { state });

    const [data, total] = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return { data, total, page, perPage };
  }

  async findOne(tenantId: string, id: string) {
    return this.getClientOrFail(tenantId, id);
  }

  async update(tenantId: string, id: string, dto: UpdateClientDto) {
    const current = await this.getClientOrFail(tenantId, id);
    const personType = (dto as any).personType || current.personType || 'juridica';

    if (dto.cnpj) {
      const raw = dto.cnpj.replace(/\D/g, '');
      if (raw.length === 14 && !this.validateCnpj(raw)) {
        throw new BadRequestException('CNPJ inválido');
      }
      const existing = await this.clients.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.id != :id', { id })
        .andWhere("REGEXP_REPLACE(c.cnpj, '[^0-9]', '', 'g') = :raw", { raw })
        .getOne();
      if (existing) throw new ConflictException('CNPJ já cadastrado para outro cliente');
    }

    if ((dto as any).cpf) {
      const raw = ((dto as any).cpf as string).replace(/\D/g, '');
      if (raw.length === 11 && !this.validateCpf(raw)) {
        throw new BadRequestException('CPF inválido');
      }
      const existing = await this.clients.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.id != :id', { id })
        .andWhere("REGEXP_REPLACE(c.cpf, '[^0-9]', '', 'g') = :raw", { raw })
        .getOne();
      if (existing) throw new ConflictException('CPF já cadastrado para outro cliente');
    }

    await this.assertNetworkBelongsToTenant(tenantId, (dto as any).networkId);

    await this.clients.update({ id, tenantId }, { ...dto, personType } as any);

    return this.getClientOrFail(tenantId, id);
  }

  async changeNetwork(tenantId: string, id: string, networkId: string | null) {
    await this.getClientOrFail(tenantId, id);
    if (networkId) await this.assertNetworkBelongsToTenant(tenantId, networkId);
    await this.clients.update({ id, tenantId }, { networkId: networkId as any });
    return this.getClientOrFail(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.getClientOrFail(tenantId, id);

    const tickets = await this.clients.manager.query(
      'SELECT id FROM tickets WHERE tenant_id = $1 AND client_id = $2 LIMIT 1',
      [tenantId, id],
    );

    const devices = await this.clients.manager.query(
      'SELECT id FROM devices WHERE tenant_id = $1 AND client_id = $2 LIMIT 1',
      [tenantId, id],
    );

    const contracts = await this.clients.manager.query(
      'SELECT id FROM contracts WHERE tenant_id = $1 AND client_id = $2 LIMIT 1',
      [tenantId, id],
    );

    const contacts = await this.clients.manager.query(
      "SELECT id FROM contacts WHERE tenant_id = $1 AND client_id = $2 AND status != 'inactive' LIMIT 1",
      [tenantId, id],
    );

    const hasLinks =
      tickets.length > 0 ||
      devices.length > 0 ||
      contracts.length > 0 ||
      contacts.length > 0;

    if (hasLinks) {
      await this.clients.update({ id, tenantId }, { status: 'inactive' });
      return {
        action: 'inactivated',
        message: 'Cliente possui vínculos e foi inativado.',
      };
    }

    await this.clients.delete({ id, tenantId });

    return {
      action: 'deleted',
      message: 'Cliente excluído permanentemente.',
    };
  }

  async createContact(tenantId: string, clientId: string, dto: CreateContactDto) {
    await this.getClientOrFail(tenantId, clientId);

    const { password, ...contactData } = dto as any;
    const portalPassword = password ? await bcrypt.hash(password, 12) : undefined;

    // Remove caracteres não-numéricos do WhatsApp (sem truncar — truncamento é só para LIDs do webhook)
    if (contactData.whatsapp) {
      contactData.whatsapp = contactData.whatsapp.replace(/\D/g, '');
    }

    const contact = this.contacts.create({
      ...contactData,
      tenantId,
      clientId,
      portalPassword,
    });

    return this.contacts.save(contact);
  }

  async findContacts(tenantId: string, clientId: string) {
    await this.getClientOrFail(tenantId, clientId);

    return this.contacts.createQueryBuilder('ct')
      .where('ct.tenant_id = :tenantId', { tenantId })
      .andWhere('ct.client_id = :clientId', { clientId })
      .andWhere("ct.status != 'inactive'")
      .orderBy('ct.name', 'ASC')
      .getMany();
  }

  async updateContact(tenantId: string, contactId: string, dto: UpdateContactDto) {
    const contact = await this.getContactOrFail(tenantId, contactId);

    const updates: any = { ...dto };
    delete updates.password;

    // Remove caracteres não-numéricos do WhatsApp (sem truncar — truncamento é só para LIDs do webhook)
    if (updates.whatsapp) {
      updates.whatsapp = updates.whatsapp.replace(/\D/g, '');
    }

    if (dto.password && String(dto.password).trim()) {
      const hashed = await bcrypt.hash(String(dto.password).trim(), 12);

      if (contact.email) {
        await this.contacts.manager.query(
          'UPDATE contacts SET portal_password = $1 WHERE tenant_id = $2 AND LOWER(TRIM(email)) = LOWER(TRIM($3))',
          [hashed, tenantId, contact.email],
        );
      } else {
        updates.portalPassword = hashed;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.contacts.update({ id: contactId, tenantId }, updates);
    }

    return this.contacts.findOne({ where: { id: contactId, tenantId } });
  }

  async removeContact(tenantId: string, contactId: string) {
    const contact = await this.getContactOrFail(tenantId, contactId);
    await this.contacts.update({ id: contactId, tenantId }, { status: 'inactive' });
    // Limpa a sessão do chatbot para que a próxima interação comece do zero
    if (contact.whatsapp) {
      await this.contacts.manager.query(
        `DELETE FROM chatbot_sessions WHERE tenant_id = $1 AND identifier = $2`,
        [tenantId, contact.whatsapp],
      );
    }
  }

  findContactById(tenantId: string, contactId: string) {
    return this.contacts.findOne({
      where: { id: contactId, tenantId },
      relations: ['client'],
    });
  }

  async findContactByWhatsapp(tenantId: string, whatsapp: string) {
    const normalized = normalizeWhatsappNumber(whatsapp) || whatsapp;

    // Busca por whatsapp OU pelo LID técnico armazenado em metadata
    const contact = await this.contacts.createQueryBuilder('ct')
      .leftJoinAndSelect('ct.client', 'client')
      .where('ct.tenant_id = :tenantId', { tenantId })
      .andWhere("ct.status = 'active'")
      .andWhere(
        "(ct.whatsapp = :normalized OR ct.metadata->>'whatsappLid' = :normalized)",
        { normalized },
      )
      .getOne();

    if (!contact) return null;

    // Backfill automático: contato antigo com LID no campo whatsapp mas sem metadata.whatsappLid
    if (
      normalized.length >= 14 &&
      contact.whatsapp === normalized &&
      contact.metadata?.whatsappLid !== normalized
    ) {
      const updatedMeta = { ...(contact.metadata ?? {}), whatsappLid: normalized };
      await this.contacts.update({ id: contact.id, tenantId }, { metadata: updatedMeta } as any);
      contact.metadata = updatedMeta;
    }

    return contact;
  }

  findContactByEmail(tenantId: string, email: string) {
    return this.contacts.findOne({
      where: { tenantId, email },
      relations: ['client'],
    });
  }

  /**
   * Verifica se um contato pode acessar um cliente (portal).
   * Contato pode acessar: clientes aos quais está vinculado + clientes da mesma rede (se for primary).
   */
  async canContactAccessClient(tenantId: string, contactId: string, clientId: string): Promise<boolean> {
    const contact = await this.contacts.findOne({
      where: { id: contactId, tenantId, status: 'active' },
      relations: ['client'],
    });
    if (!contact) return false;
    if (contact.clientId === clientId) return true;
    if (contact.isPrimary && contact.client?.networkId) {
      const targetClient = await this.clients.findOne({
        where: { id: clientId, tenantId, status: 'active' },
      });
      if (targetClient?.networkId === contact.client.networkId) return true;
    }
    return false;
  }

  /** Contato principal: pode ver ticket se tiver acesso ao cliente. Contato normal: só se o ticket for dele (ou mesmo email). */
  async canContactAccessTicket(
    tenantId: string,
    contactId: string,
    ticketClientId: string,
    ticketContactId: string | null,
    isPrimary: boolean,
  ): Promise<boolean> {
    const canAccessClient = await this.canContactAccessClient(tenantId, contactId, ticketClientId);
    if (!canAccessClient) return false;
    if (isPrimary) return true;
    if (!ticketContactId) return false;
    if (ticketContactId === contactId) return true;
    const contact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    const ticketContact = await this.contacts.findOne({ where: { id: ticketContactId, tenantId } });
    if (!contact?.email || !ticketContact?.email) return false;
    return contact.email.toLowerCase() === ticketContact.email.toLowerCase();
  }

  /** Encontra ou cria contato para chat (pré-chat do portal) */
  async findOrCreateContactForChat(
    tenantId: string,
    clientId: string,
    data: { name: string; email: string; phone?: string },
  ) {
    await this.getClientOrFail(tenantId, clientId);
    const existing = await this.contacts.findOne({
      where: { tenantId, clientId, email: data.email },
    });
    if (existing) {
      if (data.phone && !existing.phone) {
        await this.contacts.update({ id: existing.id, tenantId }, { phone: data.phone });
        return this.contacts.findOne({ where: { id: existing.id, tenantId } });
      }
      return existing;
    }
    return this.createContact(tenantId, clientId, {
      name: data.name,
      email: data.email,
      phone: data.phone,
    } as any);
  }

  /**
   * Busca clientes por nome/razão social, nome fantasia ou CNPJ.
   * Usado na tela de validação de contato durante o atendimento e no chatbot do WhatsApp.
   * Retorna no máximo 20 resultados, excluindo clientes auto-criados via WhatsApp.
   *
   * A comparação de CNPJ normaliza ambos os lados (remove não-dígitos), garantindo que
   * clientes salvos com ou sem máscara sejam encontrados independentemente do formato enviado.
   * Exemplos que casam com o mesmo cliente:
   *   - "00.000.000/0001-00"  (com máscara — como o menu de cliente envia)
   *   - "00000000000100"      (sem máscara — como o chatbot WhatsApp envia após strip de dígitos)
   */
  async searchByNameOrCnpj(
    tenantId: string,
    q: string,
  ): Promise<Pick<Client, 'id' | 'companyName' | 'tradeName' | 'cnpj' | 'city' | 'state'>[]> {
    if (!q || q.trim().length < 2) return [];

    const term = `%${q.trim()}%`;
    // Versão normalizada (apenas dígitos) para comparar com CNPJs mascarados no banco
    const cnpjDigits = q.replace(/\D/g, '');

    const rows = await this.clients.manager.query<
      Pick<Client, 'id' | 'companyName' | 'tradeName' | 'cnpj' | 'city' | 'state'>[]
    >(
      `SELECT id,
              company_name  AS "companyName",
              trade_name    AS "tradeName",
              cnpj,
              city,
              state
       FROM clients
       WHERE tenant_id = $1
         AND status    = 'active'
         AND (metadata->>'autoCreated')::boolean IS NOT TRUE
         AND (
               company_name ILIKE $2
            OR trade_name   ILIKE $2
            OR cnpj         ILIKE $2
            OR (
                 $3 <> ''
                 AND REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') = $3
               )
         )
       ORDER BY company_name ASC
       LIMIT 20`,
      [tenantId, term, cnpjDigits],
    );

    return rows;
  }

  async findOrCreateByWhatsapp(tenantId: string, phone: string, displayName?: string, isLid = false) {
    const normalized = normalizeWhatsappNumber(phone) || phone;

    // 1. Busca por whatsapp OU por metadata.whatsappLid (inclui contatos LID antigos)
    const existing = await this.findContactByWhatsapp(tenantId, normalized);
    if (existing) {
      // Garante que metadata.whatsappLid está presente para contatos LID já existentes
      if (isLid && existing.metadata?.whatsappLid !== normalized) {
        const updatedMeta = { ...(existing.metadata ?? {}), whatsappLid: normalized };
        await this.contacts.update({ id: existing.id, tenantId }, { metadata: updatedMeta } as any);
        existing.metadata = updatedMeta;
      }
      return existing;
    }

    // 2. Cria SOMENTE o contato — sem cliente temporário
    // LID: mantém whatsapp preenchido para compatibilidade de roteamento,
    // mas não salva como phone (não é número real) e registra em metadata.whatsappLid
    const contact = await this.contacts.save(
      this.contacts.create({
        tenantId,
        clientId: null as any,
        name: displayName || (isLid ? 'WhatsApp' : `+${normalized}`),
        whatsapp: normalized,
        phone: isLid ? (null as any) : normalized,
        preferredChannel: 'whatsapp',
        canOpenTickets: true,
        status: 'active',
        metadata: isLid ? { whatsappLid: normalized } : {},
      }),
    );
    contact.client = null as any;
    return contact;
  }

  /**
   * Vincula um contato a um cliente existente e adiciona ao cadastro de contatos do cliente.
   * Usado quando o contato informa o CNPJ e o sistema identifica automaticamente.
   * Também insere no pivot contact_customers (vinculação automática, linked_by = null).
   */
  async linkContactToClient(tenantId: string, contactId: string, clientId: string): Promise<void> {
    const contact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    if (!contact) return;
    // Só vincula se o contato ainda não estiver associado a nenhum cliente
    if (contact.clientId) return;
    await this.contacts.update({ id: contactId, tenantId }, { clientId } as any);

    // Inserir no pivot contact_customers, prevenindo duplicata
    await this.contacts.manager.query(
      `INSERT INTO contact_customers (id, tenant_id, contact_id, client_id, linked_by, linked_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NULL, NOW())
       ON CONFLICT (contact_id, client_id) DO NOTHING`,
      [tenantId, contactId, clientId],
    );

    this.logger.log(`Contato ${contactId} vinculado automaticamente ao cliente ${clientId}`);
  }

  /**
   * Salva um CNPJ detectado como pendente no metadata do contato.
   * Usado quando o CNPJ é detectado em mensagem mas nenhum cliente foi encontrado.
   */
  async storePendingCnpj(
    tenantId: string,
    contactId: string,
    cnpj: string, // já normalizado (14 dígitos)
  ): Promise<void> {
    const contact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    if (!contact) {
      this.logger.warn(`storePendingCnpj: contato ${contactId} não encontrado no tenant ${tenantId}`);
      return;
    }

    // Merge com metadata existente para não sobrescrever outros campos
    const currentMetadata: Record<string, any> = contact.metadata ?? {};
    const updatedMetadata: Record<string, any> = {
      ...currentMetadata,
      pendingCnpj: cnpj,
      pendingCnpjReceivedAt: new Date().toISOString(),
    };

    await this.contacts.update({ id: contactId, tenantId }, { metadata: updatedMetadata } as any);
    this.logger.log(`CNPJ ${cnpj} salvo como pendente para contato ${contactId}`);
  }

  /**
   * Busca clientes ativos do tenant cujo CNPJ começa com os 8 primeiros dígitos fornecidos (raiz CNPJ).
   * Exclui clientes auto-criados. Limita a 10 resultados ordenados por nome.
   * Usado para sugerir candidatos quando há múltiplos clientes com mesma raiz CNPJ.
   */
  async findClientsByCnpjRoot(
    tenantId: string,
    cnpjRoot: string, // 8 primeiros dígitos
  ): Promise<Array<{ id: string; companyName: string; tradeName: string; cnpj: string }>> {
    const rows = await this.clients.manager.query<
      Array<{ id: string; company_name: string; trade_name: string; cnpj: string }>
    >(
      `SELECT id,
              company_name AS company_name,
              trade_name   AS trade_name,
              cnpj
       FROM clients
       WHERE tenant_id = $1
         AND status = 'active'
         AND (metadata->>'autoCreated')::boolean IS NOT TRUE
         AND REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') LIKE $2
       ORDER BY company_name ASC
       LIMIT 10`,
      [tenantId, cnpjRoot + '%'],
    );

    return rows.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      tradeName: r.trade_name,
      cnpj: r.cnpj,
    }));
  }
}
