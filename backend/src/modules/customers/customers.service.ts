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
import { brPhoneWithout9, normalizeWhatsappNumber, restoreBrNinthDigit } from '../../common/utils/phone.utils';

export type ResolveCanonicalWhatsappContactResult = {
  contact: Contact | null;
  matchedBy: 'whatsapp' | 'lid' | 'whatsapp+lid' | 'none';
  normalizedWhatsapp: string | null;
  lid: string | null;
  candidates: string[];
  canonicalReason: string;
};

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  private logContactResolution(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  private logWhatsappIdentityGuard(payload: Record<string, unknown>) {
    this.logger.warn(JSON.stringify(payload));
  }

  private logContactCreateAudit(payload: Record<string, unknown>) {
    this.logger.log(JSON.stringify(payload));
  }

  /** Tenta 55+12 / 55+13 com e sem 9º dígito para reaproveitar contatos antigos. */
  private brWhatsappLookupVariants(normalized: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (v: string) => {
      if (!v || seen.has(v)) return;
      seen.add(v);
      out.push(v);
    };

    // Gera variante sem DDI "55" (número salvo sem código de país)
    const withoutCC = normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13)
      ? normalized.slice(2)
      : null;

    // Gera variante com DDI "55" (número salvo com código de país)
    const withCC = !normalized.startsWith('55') && (normalized.length === 10 || normalized.length === 11)
      ? `55${normalized}`
      : null;

    // Aplica todas as transformações de 9º dígito sobre cada base (com e sem DDI).
    // Garante que o mesmo contato seja encontrado independentemente do formato em que foi salvo.
    for (const base of [normalized, withoutCC, withCC].filter(Boolean) as string[]) {
      push(base);
      // Restaura 9º dígito em JIDs BR legados (55 + DDD + 8 dígitos → 12 dígitos com DDI)
      const restored = restoreBrNinthDigit(base);
      if (restored !== base) push(restored);
      // Remove 9º dígito para bater com cadastros antigos (com DDI)
      const without9 = brPhoneWithout9(base);
      if (without9) push(without9);
      // Remove 9º dígito para formatos sem DDI (ex: "11987654321" → "1187654321")
      if (!base.startsWith('55') && base.length === 11 && base.charAt(2) === '9') {
        push(`${base.slice(0, 2)}${base.slice(3)}`);
      }
    }

    return out;
  }

  private mergeContactQueryChunks(chunks: Contact[][]): Contact[] {
    const byId = new Map<string, Contact>();
    for (const rows of chunks) {
      for (const c of rows) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
    return [...byId.values()];
  }

  private isTechnicalWhatsappIdentifier(value?: string | null, rawValue?: string | null): boolean {
    const raw = String(rawValue ?? value ?? '');
    const normalized = normalizeWhatsappNumber(value ?? raw) || String(value ?? raw ?? '');
    if (!normalized) return false;
    if (raw.includes('@')) return true;
    if (normalized.length >= 14) return true;
    return false;
  }

  private isCanonicalWhatsappValue(value?: string | null, rawValue?: string | null): boolean {
    const normalized = normalizeWhatsappNumber(value ?? rawValue ?? '');
    if (!normalized) return false;
    return !this.isTechnicalWhatsappIdentifier(value ?? null, rawValue ?? null);
  }

  private filterVisibleContactsForClient(contacts: Contact[]): Contact[] {
    const activeContacts = (contacts || []).filter((contact) => contact.status !== 'inactive');
    const hasCanonicalContact = activeContacts.some((contact) =>
      this.isCanonicalWhatsappValue(contact.whatsapp, contact.whatsapp),
    );
    if (!hasCanonicalContact) return activeContacts;

    return activeContacts.filter((contact) =>
      this.isCanonicalWhatsappValue(contact.whatsapp, contact.whatsapp)
      || !contact.whatsapp
      || contact.isPrimary,
    );
  }

  private async getContactResolutionSnapshot(
    tenantId: string,
    normalizedWhatsapp: string,
    clientId?: string | null,
  ) {
    const [existingByWhatsapp, existingByLid, existingByClientId] = await Promise.all([
      this.contacts.createQueryBuilder('ct')
        .select('ct.id', 'id')
        .where('ct.tenant_id = :tenantId', { tenantId })
        .andWhere('ct.whatsapp = :normalizedWhatsapp', { normalizedWhatsapp })
        .orderBy("ct.status = 'active'", 'DESC')
        .addOrderBy('ct.created_at', 'ASC')
        .getRawOne<{ id: string }>(),
      this.contacts.createQueryBuilder('ct')
        .select('ct.id', 'id')
        .where('ct.tenant_id = :tenantId', { tenantId })
        .andWhere("ct.metadata->>'whatsappLid' = :normalizedWhatsapp", { normalizedWhatsapp })
        .orderBy("ct.status = 'active'", 'DESC')
        .addOrderBy('ct.created_at', 'ASC')
        .getRawOne<{ id: string }>(),
      clientId
        ? this.contacts.createQueryBuilder('ct')
          .select('ct.id', 'id')
          .where('ct.tenant_id = :tenantId', { tenantId })
          .andWhere('ct.client_id::text = :clientId', { clientId })
          .andWhere(
            "(ct.whatsapp = :normalizedWhatsapp OR ct.metadata->>'whatsappLid' = :normalizedWhatsapp)",
            { normalizedWhatsapp },
          )
          .orderBy("ct.status = 'active'", 'DESC')
          .addOrderBy('ct.created_at', 'ASC')
          .getRawOne<{ id: string }>()
        : Promise.resolve(null),
    ]);

    return {
      existingContactByWhatsapp: existingByWhatsapp?.id ?? null,
      existingContactByPhone: existingByWhatsapp?.id ?? null,
      existingContactByLid: existingByLid?.id ?? null,
      existingContactByClientId: existingByClientId?.id ?? null,
    };
  }

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
    });

    if (!client) {
      throw new NotFoundException('Cliente não encontrado');
    }

    client.contacts = await this.findContacts(tenantId, id);
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

    for (const client of data) {
      client.contacts = await this.findContacts(tenantId, client.id);
    }

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

    if (contactData.whatsapp) {
      const existing = await this.contacts.findOne({
        where: { tenantId, whatsapp: contactData.whatsapp },
      });

      if (existing) {
        const updates: Partial<Contact> = {};
        if (!existing.phone && contactData.phone) updates.phone = contactData.phone;
        if (!existing.email && contactData.email) updates.email = contactData.email;
        if (!existing.role && contactData.role) updates.role = contactData.role;
        if (!existing.department && contactData.department) updates.department = contactData.department;
        if (!existing.notes && contactData.notes) updates.notes = contactData.notes;
        if (!existing.preferredChannel && contactData.preferredChannel) updates.preferredChannel = contactData.preferredChannel;
        if (!existing.portalPassword && portalPassword) updates.portalPassword = portalPassword;
        if (existing.status === 'inactive') updates.status = 'active' as any;

        if (Object.keys(updates).length > 0) {
          await this.contacts.update({ id: existing.id, tenantId }, updates as any);
        }

        await this.contacts.manager.query(
          `INSERT INTO contact_customers (id, tenant_id, contact_id, client_id, linked_by, linked_at)
           VALUES (gen_random_uuid(), $1, $2, $3, NULL, NOW())
           ON CONFLICT (contact_id, client_id) DO NOTHING`,
          [tenantId, existing.id, clientId],
        );

        return this.contacts.findOne({ where: { id: existing.id, tenantId } });
      }
    }

    const contact = this.contacts.create({
      ...contactData,
      tenantId,
      clientId,
      portalPassword,
    });

    const saved = await this.contacts.save(contact as any);

    await this.contacts.manager.query(
      `INSERT INTO contact_customers (id, tenant_id, contact_id, client_id, linked_by, linked_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NULL, NOW())
       ON CONFLICT (contact_id, client_id) DO NOTHING`,
      [tenantId, saved.id, clientId],
    );

    return saved;
  }

  async findContacts(tenantId: string, clientId: string) {
    const clientExists = await this.clients.findOne({
      where: { id: clientId, tenantId },
      select: ['id'],
    });
    if (!clientExists) {
      throw new NotFoundException('Cliente não encontrado');
    }

    const contacts = await this.contacts.createQueryBuilder('ct')
      .where('ct.tenant_id::text = :tenantId', { tenantId })
      .andWhere(
        `(ct.client_id::text = :clientId OR EXISTS (
           SELECT 1
             FROM contact_customers cc
            WHERE cc.contact_id::text = ct.id::text
              AND cc.client_id::text = :clientId
              AND cc.tenant_id::text = :tenantId
         ))`,
        { clientId, tenantId },
      )
      .andWhere("ct.status != 'inactive'")
      .orderBy('ct.name', 'ASC')
      .getMany();
    const visibleContacts = this.filterVisibleContactsForClient(contacts);
    return Promise.all(
      visibleContacts.map((contact) => this.sanitizeTechnicalContactIdentifiers(tenantId, contact)),
    );
  }

  async updateContact(tenantId: string, contactId: string, dto: UpdateContactDto) {
    const contact = await this.getContactOrFail(tenantId, contactId);

    const updates: any = { ...dto };
    delete updates.password;

    // Remove caracteres não-numéricos do WhatsApp (sem truncar — truncamento é só para LIDs do webhook)
    if (updates.whatsapp) {
      updates.whatsapp = updates.whatsapp.replace(/\D/g, '');
    }

    if (typeof updates.whatsapp === 'string' && updates.whatsapp) {
      // Verifica conflito contra todas as variantes BR do número (com/sem DDI "55", com/sem 9º dígito).
      // Impede que dois contatos coexistam com o mesmo número em formatos diferentes.
      const variants = this.brWhatsappLookupVariants(updates.whatsapp);
      const conflictingContacts = await this.contacts.manager.query(
        `SELECT id
           FROM contacts
          WHERE tenant_id::text = $1
            AND whatsapp = ANY($2)
            AND id::text <> $3
            AND status <> 'inactive'
          LIMIT 1`,
        [tenantId, variants, contactId],
      );

      if (Array.isArray(conflictingContacts) && conflictingContacts.length > 0) {
        throw new ConflictException('Já existe outro contato ativo com este WhatsApp.');
      }
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

  /**
   * Arquiva um contato ativo.
   *
   * Transições de estado permitidas: 'active' → 'archived'
   * Efeitos colaterais:
   *   - Fecha todas as conversas WhatsApp abertas do contato (evita atendimentos órfãos na fila)
   *   - Apaga a sessão do chatbot (ao reativar, o próximo contato começa do zero)
   */
  async archiveContact(tenantId: string, contactId: string): Promise<Contact> {
    // 1. Garante que o contato existe — NotFoundException se não encontrar
    const contact = await this.getContactOrFail(tenantId, contactId);

    // 2. Rejeita se já estiver arquivado ou inativo
    if (contact.status !== 'active') {
      throw new BadRequestException(
        contact.status === 'archived'
          ? 'Contato já está arquivado.'
          : 'Não é possível arquivar um contato inativo.',
      );
    }

    // 3. Mescla archivedAt ao metadata existente sem sobrescrever outros campos
    const updatedMetadata = {
      ...(contact.metadata ?? {}),
      archivedAt: new Date().toISOString(),
    };

    await this.contacts.update(
      { id: contactId, tenantId },
      { status: 'archived', metadata: updatedMetadata } as any,
    );

    // 4. Fecha conversas ativas do contato para não deixar atendimentos sem responsável
    await this.contacts.manager.query(
      `UPDATE conversations
          SET status = 'closed'
        WHERE tenant_id::text = $1
          AND contact_id::text = $2
          AND status = 'active'`,
      [tenantId, contactId],
    );

    // 5. Remove sessão do chatbot pelo número WhatsApp — mesmo padrão de removeContact
    if (contact.whatsapp) {
      await this.contacts.manager.query(
        `DELETE FROM chatbot_sessions WHERE tenant_id = $1 AND identifier = $2`,
        [tenantId, contact.whatsapp],
      );
    }

    // 6. Retorna o contato com o estado persistido
    return this.contacts.findOne({ where: { id: contactId, tenantId } }) as Promise<Contact>;
  }

  /**
   * Reativa manualmente um contato arquivado.
   *
   * Transições de estado permitidas: 'archived' → 'active'
   * Contatos 'inactive' NÃO são reativados por este método —
   * 'inactive' é reservado para remoções e mesclagens feitas pelo sistema.
   */
  async unarchiveContact(tenantId: string, contactId: string): Promise<Contact> {
    // 1. Garante que o contato existe — NotFoundException se não encontrar
    const contact = await this.getContactOrFail(tenantId, contactId);

    // 2. Rejeita qualquer status que não seja 'archived'
    if (contact.status !== 'archived') {
      throw new BadRequestException(
        contact.status === 'active'
          ? 'Contato já está ativo.'
          : 'Não é possível reativar um contato inativo.',
      );
    }

    // 3. Limpa archivedAt e registra reactivatedAt, preservando o restante do metadata
    const updatedMetadata = {
      ...(contact.metadata ?? {}),
      archivedAt: null,
      reactivatedAt: new Date().toISOString(),
    };

    await this.contacts.update(
      { id: contactId, tenantId },
      { status: 'active', metadata: updatedMetadata } as any,
    );

    // 4. Retorna o contato com o estado persistido
    return this.contacts.findOne({ where: { id: contactId, tenantId } }) as Promise<Contact>;
  }

  findContactById(tenantId: string, contactId: string) {
    return this.contacts.findOne({
      where: { id: contactId, tenantId },
      relations: ['client'],
    });
  }

  private buildWhatsappContactsQuery(tenantId: string, normalized: string, includeInactive = false) {
    const qb = this.contacts.createQueryBuilder('ct')
      .leftJoinAndSelect('ct.client', 'client')
      .addSelect(
        `CASE
           WHEN ct.metadata->>'whatsappLid' = :normalized THEN 0
           WHEN ct.whatsapp = :normalized THEN 1
           ELSE 2
         END`,
        'match_rank',
      )
      .addSelect(
        `(SELECT COUNT(*)
            FROM contact_customers cc
           WHERE cc.tenant_id::text = :tenantId
             AND cc.contact_id::text = ct.id::text)`,
        'link_count',
      )
      .where('ct.tenant_id = :tenantId', { tenantId })
      .andWhere(
        "(ct.whatsapp = :normalized OR ct.metadata->>'whatsappLid' = :normalized)",
        { normalized },
      );

    if (!includeInactive) {
      qb.andWhere("ct.status = 'active'");
    }

    return qb
      .orderBy('match_rank', 'ASC')
      .addOrderBy('ct.is_primary', 'DESC')
      .addOrderBy('link_count', 'DESC')
      .addOrderBy('ct.created_at', 'ASC');
  }

  private async consolidateWhatsappContactLinks(tenantId: string, targetContactId: string, normalized: string) {
    const matches = await this.buildWhatsappContactsQuery(tenantId, normalized, true).getMany();
    if (!matches.length) return;

    const allClientIds = Array.from(new Set([
      ...matches.map((contact) => contact.clientId ? String(contact.clientId) : null),
      ...(await this.contacts.manager.query<{ client_id: string }[]>(
        `SELECT DISTINCT cc.client_id::text AS client_id
           FROM contact_customers cc
          WHERE cc.tenant_id::text = $1
            AND cc.contact_id::text = ANY($2::text[])`,
        [tenantId, matches.map((contact) => contact.id)],
      )).map((row) => row.client_id),
    ].filter(Boolean) as string[]));

    for (const clientId of allClientIds) {
      await this.contacts.manager.query(
        `INSERT INTO contact_customers (id, tenant_id, contact_id, client_id, linked_by, linked_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NULL, NOW())
         ON CONFLICT (contact_id, client_id) DO NOTHING`,
        [tenantId, targetContactId, clientId],
      );
    }

    const target = matches.find((contact) => contact.id === targetContactId)
      || await this.contacts.findOne({ where: { id: targetContactId, tenantId } });
    if (!target) return;

    const updates: Record<string, unknown> = {};
    const updatedMeta = { ...(target.metadata ?? {}) } as Record<string, unknown>;
    if (normalized.length >= 14 && updatedMeta.whatsappLid !== normalized) {
      updatedMeta.whatsappLid = normalized;
    }
    if (JSON.stringify(updatedMeta) !== JSON.stringify(target.metadata ?? {})) {
      updates.metadata = updatedMeta;
    }
    if (target.status === 'inactive') {
      // 'inactive' é marcação de sistema (remoção/merge pelo sistema, sem fluxo de
      // arquivamento explícito). Pode ser promovido para 'active' dentro de consolidate
      // porque o contexto de consolidação já implica que esse número deve estar ativo:
      // é o target escolhido para receber todos os vínculos dos candidatos duplicados.
      updates.status = 'active';
    }
    // 'archived': consolidate NÃO reativa. Reativação de contatos arquivados é
    // responsabilidade exclusiva de resolveCanonicalWhatsappContact e
    // findOrCreateByWhatsapp, que possuem contexto completo (direction, rawInput, etc.)
    // e atualizam metadata corretamente (archivedAt=null, reactivatedAt=now, log).
    // Tocar no status aqui quebraria a trilha de auditoria sem qualquer justificativa
    // rastreável. Os callers que chegam com target 'archived' já passaram pelas camadas
    // de reativação antes de invocar consolidate — se ainda estiver 'archived', é porque
    // não houve mensagem inbound válida para justificar reativação.
    if (!target.isPrimary && allClientIds.length > 1) {
      updates.isPrimary = true;
    }
    if (Object.keys(updates).length) {
      await this.contacts.update({ id: targetContactId, tenantId }, updates as any);
    }
  }

  private async isContactLinkedToClient(tenantId: string, contactId: string, clientId?: string | null): Promise<boolean> {
    if (!clientId) return false;

    const directMatch = await this.contacts.findOne({
      where: { id: contactId, tenantId, clientId },
      select: ['id'],
    });
    if (directMatch) return true;

    const linkedRows = await this.contacts.manager.query<{ linked: string }[]>(
      `SELECT '1' AS linked
         FROM contact_customers cc
        WHERE cc.tenant_id::text = $1
          AND cc.contact_id::text = $2
          AND cc.client_id::text = $3
        LIMIT 1`,
      [tenantId, contactId, clientId],
    );

    return linkedRows.length > 0;
  }

  private async sanitizeTechnicalContactIdentifiers(tenantId: string, contact: Contact): Promise<Contact> {
    const normalizedWhatsapp = contact.whatsapp
      ? (normalizeWhatsappNumber(contact.whatsapp) || contact.whatsapp)
      : null;
    const normalizedPhone = contact.phone
      ? (normalizeWhatsappNumber(contact.phone) || contact.phone)
      : null;
    const normalizedResolvedDigits = typeof contact.metadata?.whatsappResolvedDigits === 'string'
      ? (normalizeWhatsappNumber(contact.metadata.whatsappResolvedDigits) || contact.metadata.whatsappResolvedDigits)
      : null;
    const safeResolvedDigits = normalizedResolvedDigits && !this.isTechnicalWhatsappIdentifier(
      normalizedResolvedDigits,
      contact.metadata?.whatsappResolvedDigits ?? null,
    )
      ? normalizedResolvedDigits
      : null;

    const technicalWhatsapp = normalizedWhatsapp && this.isTechnicalWhatsappIdentifier(normalizedWhatsapp, contact.whatsapp)
      ? normalizedWhatsapp
      : null;
    const technicalPhone = normalizedPhone && this.isTechnicalWhatsappIdentifier(normalizedPhone, contact.phone)
      ? normalizedPhone
      : null;
    const shouldPromoteResolvedDigitsToPhone = !!safeResolvedDigits && (!normalizedPhone || !!technicalPhone);

    if (!technicalWhatsapp && !technicalPhone && !shouldPromoteResolvedDigitsToPhone) {
      return contact;
    }

    const updates: Record<string, unknown> = {};
    const updatedMetadata = { ...(contact.metadata ?? {}) } as Record<string, unknown>;
    const resolvedLid = technicalWhatsapp || technicalPhone;

    if (resolvedLid && updatedMetadata.whatsappLid !== resolvedLid) {
      updatedMetadata.whatsappLid = resolvedLid;
      updates.metadata = updatedMetadata;
    }
    if (technicalWhatsapp) {
      updates.whatsapp = null;
    }
    if (technicalPhone) {
      updates.phone = null;
    }
    if (shouldPromoteResolvedDigitsToPhone) {
      updates.phone = safeResolvedDigits;
    }

    if (!Object.keys(updates).length) {
      return contact;
    }

    await this.contacts.update({ id: contact.id, tenantId }, updates as any);
    return this.contacts.findOne({
      where: { id: contact.id, tenantId },
      relations: ['client'],
    }) as Promise<Contact>;
  }

  async findContactsByWhatsapp(tenantId: string, whatsapp: string) {
    const normalized = normalizeWhatsappNumber(whatsapp) || whatsapp;

    return this.buildWhatsappContactsQuery(tenantId, normalized).getMany();
  }

  async persistWhatsappRuntimeIdentifiers(
    tenantId: string,
    contactId: string,
    identifiers: {
      whatsappJid?: string | null;
      whatsappLid?: string | null;
      whatsappResolvedDigits?: string | null;
    },
    opts?: { direction?: 'inbound' | 'outbound'; clientId?: string | null; rawInput?: string },
  ) {
    const contact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    if (!contact) return;

    const normalizedLid = identifiers.whatsappLid
      ? (normalizeWhatsappNumber(identifiers.whatsappLid) || identifiers.whatsappLid)
      : null;
    const normalizedResolvedDigits = identifiers.whatsappResolvedDigits
      ? (normalizeWhatsappNumber(identifiers.whatsappResolvedDigits) || identifiers.whatsappResolvedDigits)
      : null;
    const safeResolvedDigits = normalizedResolvedDigits && !this.isTechnicalWhatsappIdentifier(
      normalizedResolvedDigits,
      identifiers.whatsappResolvedDigits ?? null,
    )
      ? normalizedResolvedDigits
      : null;
    const whatsappJid = identifiers.whatsappJid ?? null;

    const updatedMeta = { ...(contact.metadata ?? {}) } as Record<string, unknown>;
    if (normalizedLid) updatedMeta.whatsappLid = normalizedLid;
    if (whatsappJid) updatedMeta.whatsappJid = whatsappJid;
    if (safeResolvedDigits) updatedMeta.whatsappResolvedDigits = safeResolvedDigits;
    else if (
      normalizedResolvedDigits &&
      typeof updatedMeta.whatsappResolvedDigits === 'string' &&
      updatedMeta.whatsappResolvedDigits === normalizedResolvedDigits
    ) {
      delete updatedMeta.whatsappResolvedDigits;
    }

    const normalizedPhone = contact.phone
      ? (normalizeWhatsappNumber(contact.phone) || contact.phone)
      : null;
    const technicalPhone = normalizedPhone && this.isTechnicalWhatsappIdentifier(normalizedPhone, contact.phone);
    const updates: Record<string, unknown> = {};

    if (JSON.stringify(updatedMeta) !== JSON.stringify(contact.metadata ?? {})) {
      updates.metadata = updatedMeta;
      contact.metadata = updatedMeta as any;
    }

    if (safeResolvedDigits && (!normalizedPhone || technicalPhone)) {
      updates.phone = safeResolvedDigits;
      contact.phone = safeResolvedDigits;
    }

    if (Object.keys(updates).length) {
      await this.contacts.update({ id: contactId, tenantId }, updates as any);
    }

    this.logContactResolution({
      scope: 'canonical-contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      normalizedWhatsapp: safeResolvedDigits ?? contact.whatsapp ?? null,
      lid: normalizedLid,
      clientId: opts?.clientId ?? contact.clientId ?? null,
      candidates: [contactId],
      matchedBy: normalizedLid && safeResolvedDigits ? 'whatsapp+lid' : normalizedLid ? 'lid' : safeResolvedDigits ? 'whatsapp' : 'none',
      canonicalReason: 'persist-runtime-identifiers',
      chosenContactId: contactId,
      whatsappJid,
      whatsappResolvedDigits: safeResolvedDigits,
      stage: 'persistWhatsappRuntimeIdentifiers',
    });
  }

  private chooseCanonicalWhatsappContact(
    candidates: Contact[],
    normalizedWhatsapp: string | null,
    lid: string | null,
    rawWhatsapp: string | null,
    clientId?: string | null,
  ): { contact: Contact | null; reason: string } {
    if (!candidates.length) {
      return { contact: null, reason: 'no-candidates' };
    }

    const sorted = [...candidates].sort((a, b) => {
      const aWhatsappMatch = normalizedWhatsapp
        && this.isCanonicalWhatsappValue(a.whatsapp, a.whatsapp)
        && a.whatsapp === normalizedWhatsapp ? 1 : 0;
      const bWhatsappMatch = normalizedWhatsapp
        && this.isCanonicalWhatsappValue(b.whatsapp, b.whatsapp)
        && b.whatsapp === normalizedWhatsapp ? 1 : 0;
      if (aWhatsappMatch !== bWhatsappMatch) return bWhatsappMatch - aWhatsappMatch;

      const aClientMatch = clientId && a.clientId && String(a.clientId) === String(clientId) ? 1 : 0;
      const bClientMatch = clientId && b.clientId && String(b.clientId) === String(clientId) ? 1 : 0;
      if (aClientMatch !== bClientMatch) return bClientMatch - aClientMatch;

      const aRealWhatsapp = this.isCanonicalWhatsappValue(a.whatsapp, a.whatsapp) ? 1 : 0;
      const bRealWhatsapp = this.isCanonicalWhatsappValue(b.whatsapp, b.whatsapp) ? 1 : 0;
      if (aRealWhatsapp !== bRealWhatsapp) return bRealWhatsapp - aRealWhatsapp;

      const aTechnicalMatch =
        (normalizedWhatsapp && a.metadata?.whatsappResolvedDigits === normalizedWhatsapp ? 1 : 0) +
        (rawWhatsapp && a.metadata?.whatsappJid === rawWhatsapp ? 1 : 0) +
        (lid && a.metadata?.whatsappLid === lid ? 1 : 0);
      const bTechnicalMatch =
        (normalizedWhatsapp && b.metadata?.whatsappResolvedDigits === normalizedWhatsapp ? 1 : 0) +
        (rawWhatsapp && b.metadata?.whatsappJid === rawWhatsapp ? 1 : 0) +
        (lid && b.metadata?.whatsappLid === lid ? 1 : 0);
      if (aTechnicalMatch !== bTechnicalMatch) return bTechnicalMatch - aTechnicalMatch;

      // isPrimary removido intencionalmente: cada contato é responsável pela sua própria
      // conversa/ticket — o contato principal não deve interferir na identificação do remetente.

      const aActive = a.status === 'active' ? 1 : 0;
      const bActive = b.status === 'active' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    const chosen = sorted[0];
    const reasonParts = [
      normalizedWhatsapp
      && this.isCanonicalWhatsappValue(chosen.whatsapp, chosen.whatsapp)
      && chosen.whatsapp === normalizedWhatsapp ? 'matched-whatsapp' : null,
      clientId && chosen.clientId && String(chosen.clientId) === String(clientId) ? 'matched-clientId' : null,
      this.isCanonicalWhatsappValue(chosen.whatsapp, chosen.whatsapp) ? 'real-whatsapp' : null,
      normalizedWhatsapp && chosen.metadata?.whatsappResolvedDigits === normalizedWhatsapp ? 'matched-resolved-digits' : null,
      rawWhatsapp && chosen.metadata?.whatsappJid === rawWhatsapp ? 'matched-jid' : null,
      lid && chosen.metadata?.whatsappLid === lid ? 'matched-lid' : null,
      chosen.status === 'active' ? 'active' : null,
      'oldest',
    ].filter(Boolean);

    return { contact: chosen, reason: reasonParts.join(',') };
  }

  async resolveCanonicalWhatsappContact(
    tenantId: string,
    opts: {
      rawWhatsapp?: string | null;
      normalizedWhatsapp?: string | null;
      lid?: string | null;
      clientId?: string | null;
      direction?: 'inbound' | 'outbound';
    },
  ): Promise<ResolveCanonicalWhatsappContactResult> {
    const normalizedWhatsapp = opts.normalizedWhatsapp
      ? (normalizeWhatsappNumber(opts.normalizedWhatsapp) || opts.normalizedWhatsapp)
      : (opts.rawWhatsapp ? (normalizeWhatsappNumber(opts.rawWhatsapp) || opts.rawWhatsapp) : null);
    const lid = opts.lid ? (normalizeWhatsappNumber(opts.lid) || opts.lid) : null;
    const rawWhatsapp = opts.rawWhatsapp ?? null;

    const brVariants = normalizedWhatsapp ? this.brWhatsappLookupVariants(normalizedWhatsapp) : [];

    const [whatsappChunks, lidMatches, jidMatches, resolvedChunks] = await Promise.all([
      brVariants.length
        ? Promise.all(
          brVariants.map((variant) => this.buildWhatsappContactsQuery(tenantId, variant, true).getMany()),
        )
        : Promise.resolve([] as Contact[][]),
      lid
        ? this.contacts.createQueryBuilder('ct')
          .leftJoinAndSelect('ct.client', 'client')
          .where('ct.tenant_id = :tenantId', { tenantId })
          .andWhere("ct.metadata->>'whatsappLid' = :lid", { lid })
          .orderBy("ct.status = 'active'", 'DESC')
          .addOrderBy('ct.is_primary', 'DESC')
          .addOrderBy('ct.created_at', 'ASC')
          .getMany()
        : Promise.resolve([] as Contact[]),
      rawWhatsapp
        ? this.contacts.createQueryBuilder('ct')
          .leftJoinAndSelect('ct.client', 'client')
          .where('ct.tenant_id = :tenantId', { tenantId })
          .andWhere("ct.metadata->>'whatsappJid' = :rawWhatsapp", { rawWhatsapp })
          .orderBy("ct.status = 'active'", 'DESC')
          .addOrderBy('ct.is_primary', 'DESC')
          .addOrderBy('ct.created_at', 'ASC')
          .getMany()
        : Promise.resolve([] as Contact[]),
      brVariants.length
        ? Promise.all(
          brVariants.map((variant) =>
            this.contacts.createQueryBuilder('ct')
              .leftJoinAndSelect('ct.client', 'client')
              .where('ct.tenant_id = :tenantId', { tenantId })
              .andWhere("ct.metadata->>'whatsappResolvedDigits' = :variant", { variant })
              .orderBy("ct.status = 'active'", 'DESC')
              .addOrderBy('ct.is_primary', 'DESC')
              .addOrderBy('ct.created_at', 'ASC')
              .getMany(),
          ),
        )
        : Promise.resolve([] as Contact[][]),
    ]);

    const whatsappMatches = this.mergeContactQueryChunks(whatsappChunks);
    const resolvedDigitsMatches = this.mergeContactQueryChunks(resolvedChunks);

    const candidateMap = new Map<string, Contact>();
    for (const contact of [...whatsappMatches, ...lidMatches, ...jidMatches, ...resolvedDigitsMatches]) {
      if (!candidateMap.has(contact.id)) candidateMap.set(contact.id, contact);
    }
    const candidateClientIds = Array.from(
      new Set(
        Array.from(candidateMap.values())
          .map((candidate) => candidate.clientId ? String(candidate.clientId) : null)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    // siblingMatches: só adiciona contatos do mesmo cliente que tenham match técnico real
    // com os identificadores da mensagem (whatsapp, jid, lid ou resolvedDigits).
    // Contatos sem nenhum match direto — incluindo o contato principal — não entram no pool,
    // evitando que isPrimary influencie a seleção do remetente via critério de desempate.
    if (candidateClientIds.length) {
      const techValues = Array.from(new Set([
        normalizedWhatsapp,
        rawWhatsapp,
        lid,
        ...brVariants,
      ].filter((v): v is string => Boolean(v))));

      if (techValues.length) {
        const siblingMatches = await this.contacts.createQueryBuilder('ct')
          .leftJoinAndSelect('ct.client', 'client')
          .where('ct.tenant_id = :tenantId', { tenantId })
          .andWhere('ct.client_id::text IN (:...candidateClientIds)', { candidateClientIds })
          .andWhere(
            `(ct.whatsapp IN (:...techValues)
              OR ct.metadata->>'whatsappResolvedDigits' IN (:...techValues)
              OR ct.metadata->>'whatsappJid' IN (:...techValues)
              OR ct.metadata->>'whatsappLid' IN (:...techValues))`,
            { techValues },
          )
          .orderBy("ct.status = 'active'", 'DESC')
          .addOrderBy('ct.created_at', 'ASC')
          .getMany();
        for (const contact of siblingMatches) {
          if (!candidateMap.has(contact.id)) candidateMap.set(contact.id, contact);
        }
      }
    }
    const candidates = Array.from(candidateMap.values());
    const canonicalCandidates = candidates.filter((candidate) =>
      this.isCanonicalWhatsappValue(candidate.whatsapp, candidate.whatsapp),
    );

    const { contact, reason } = this.chooseCanonicalWhatsappContact(
      candidates,
      normalizedWhatsapp,
      lid,
      rawWhatsapp,
      opts.clientId,
    );
    const matchedBy: ResolveCanonicalWhatsappContactResult['matchedBy'] =
      whatsappMatches.length && lidMatches.length ? 'whatsapp+lid'
        : whatsappMatches.length ? 'whatsapp'
          : lidMatches.length ? 'lid'
            : 'none';

    const hasTrustedLidOnlyContact = Boolean(
      contact &&
      !canonicalCandidates.length &&
      lid &&
      (contact.status === 'active' || contact.status === 'archived') &&
      contact.isPrimary &&
      contact.metadata?.whatsappLid === lid,
    );

    const hasTrustedClientLinkedTechnicalContact = Boolean(
      contact &&
      !canonicalCandidates.length &&
      (contact.status === 'active' || contact.status === 'archived') &&
      opts.clientId &&
      await this.isContactLinkedToClient(tenantId, contact.id, opts.clientId),
    );

    const hasTrustedExplicitClientSelectionForSingleTechnicalCandidate = Boolean(
      contact &&
      !canonicalCandidates.length &&
      (contact.status === 'active' || contact.status === 'archived') &&
      opts.clientId &&
      lid &&
      matchedBy !== 'none' &&
      candidates.length === 1,
    );

    const safeContact = contact && (
      canonicalCandidates.length > 0
      || matchedBy === 'whatsapp'
      || hasTrustedLidOnlyContact
      || hasTrustedClientLinkedTechnicalContact
      || hasTrustedExplicitClientSelectionForSingleTechnicalCandidate
    )
      ? contact
      : null;

    if (contact && !safeContact) {
      this.logWhatsappIdentityGuard({
        scope: 'whatsapp-identity-guard',
        tenantId,
        attemptedWhatsappValue: contact.whatsapp ?? rawWhatsapp ?? lid ?? normalizedWhatsapp,
        reason: 'technical-identifier-blocked',
      });
    }

    if (safeContact && (lid || rawWhatsapp || normalizedWhatsapp)) {
      await this.persistWhatsappRuntimeIdentifiers(
        tenantId,
        safeContact.id,
        {
          whatsappJid: rawWhatsapp && rawWhatsapp.includes('@') ? rawWhatsapp : null,
          whatsappLid: lid,
          whatsappResolvedDigits: this.isTechnicalWhatsappIdentifier(normalizedWhatsapp, opts.rawWhatsapp ?? null)
            ? null
            : normalizedWhatsapp,
        },
        {
          direction: opts.direction ?? 'inbound',
          clientId: opts.clientId ?? null,
          rawInput: opts.rawWhatsapp ?? lid ?? normalizedWhatsapp,
        },
      ).catch(() => {});
      safeContact.metadata = {
        ...(safeContact.metadata ?? {}),
        ...(lid ? { whatsappLid: lid } : {}),
        ...((rawWhatsapp && rawWhatsapp.includes('@')) ? { whatsappJid: rawWhatsapp } : {}),
        ...(!this.isTechnicalWhatsappIdentifier(normalizedWhatsapp, opts.rawWhatsapp ?? null) && normalizedWhatsapp
          ? { whatsappResolvedDigits: normalizedWhatsapp }
          : {}),
      };
    }

    // Reativa automaticamente contato arquivado que voltou a enviar mensagem via WhatsApp.
    // Ocorre aqui — após persistir os identificadores de runtime e antes de retornar —
    // para que handleIncomingMessage receba o contato já com status='active',
    // garantindo que skipChatbot e getOrCreateForContact funcionem sem duplicações.
    // Contatos 'inactive' (removidos pelo sistema) NÃO são reativados.
    if (safeContact && safeContact.status === 'archived') {
      const reactivatedMetadata = {
        ...(safeContact.metadata ?? {}),
        archivedAt: null,
        reactivatedAt: new Date().toISOString(),
      };
      await this.contacts.update(
        { id: safeContact.id, tenantId },
        { status: 'active', metadata: reactivatedMetadata } as any,
      );
      safeContact.status = 'active';
      safeContact.metadata = reactivatedMetadata;
      this.logger.log(JSON.stringify({
        scope: 'contact-reactivation',
        reason: 'inbound-whatsapp-message',
        tenantId,
        contactId: safeContact.id,
      }));
    }

    this.logContactResolution({
      scope: 'canonical-contact-resolution',
      direction: opts.direction ?? 'inbound',
      tenantId,
      rawInput: opts.rawWhatsapp ?? lid ?? normalizedWhatsapp,
      normalizedWhatsapp,
      clientId: opts.clientId ?? null,
      lid,
      existingContactByWhatsapp: whatsappMatches[0]?.id ?? null,
      existingContactByPhone: whatsappMatches[0]?.id ?? null,
      existingContactByClientId: opts.clientId
        ? candidates.find((candidate) => candidate.clientId && String(candidate.clientId) === String(opts.clientId))?.id ?? null
        : null,
      existingContactByLid: lidMatches[0]?.id ?? null,
      chosenContactId: safeContact?.id ?? null,
      action: safeContact ? 'reuse' : 'create',
      stage: 'resolveCanonicalWhatsappContact',
      matchedBy,
      candidates: candidates.map((candidate) => candidate.id),
      canonicalReason: safeContact ? reason : `${reason},blocked-technical-only`,
      whatsappJid: jidMatches[0]?.metadata?.whatsappJid ?? null,
      whatsappResolvedDigits: resolvedDigitsMatches[0]?.metadata?.whatsappResolvedDigits ?? null,
    });

    return {
      contact: safeContact ?? null,
      matchedBy,
      normalizedWhatsapp,
      lid,
      candidates: candidates.map((candidate) => candidate.id),
      canonicalReason: safeContact ? reason : `${reason},blocked-technical-only`,
    };
  }

  async findContactByWhatsappOrLid(tenantId: string, whatsappOrLid: string) {
    const normalized = normalizeWhatsappNumber(whatsappOrLid) || whatsappOrLid;
    const snapshot = await this.getContactResolutionSnapshot(tenantId, normalized);
    this.logContactResolution({
      scope: 'contact-resolution',
      direction: 'unknown',
      tenantId,
      rawInput: whatsappOrLid,
      normalizedWhatsapp: normalized,
      clientId: null,
      lid: normalized.length >= 14 ? normalized : null,
      ...snapshot,
      chosenContactId: null,
      action: 'create',
      stage: 'before-findContactByWhatsappOrLid',
    });

    let contact: Contact | null = null;
    for (const variant of this.brWhatsappLookupVariants(normalized)) {
      const [found] = await this.buildWhatsappContactsQuery(tenantId, variant, true).getMany();
      if (found) {
        contact = found;
        break;
      }
    }
    if (contact) {
      this.logContactResolution({
        scope: 'contact-resolution',
        direction: 'unknown',
        tenantId,
        rawInput: whatsappOrLid,
        normalizedWhatsapp: normalized,
        clientId: contact.clientId ?? null,
        lid: normalized.length >= 14 ? normalized : null,
        ...snapshot,
        chosenContactId: contact.id,
        action: 'reuse',
        stage: 'after-findContactByWhatsappOrLid',
      });
      return contact;
    }

    for (const variant of this.brWhatsappLookupVariants(normalized)) {
      contact = await this.contacts.createQueryBuilder('ct')
        .leftJoinAndSelect('ct.client', 'client')
        .where('ct.tenant_id = :tenantId', { tenantId })
        .andWhere(
          "(ct.whatsapp = :normalized OR ct.metadata->>'whatsappLid' = :normalized)",
          { normalized: variant },
        )
        .orderBy("ct.status = 'active'", 'DESC')
        .addOrderBy('ct.is_primary', 'DESC')
        .addOrderBy('ct.created_at', 'ASC')
        .getOne();
      if (contact) break;
    }

    this.logContactResolution({
      scope: 'contact-resolution',
      direction: 'unknown',
      tenantId,
      rawInput: whatsappOrLid,
      normalizedWhatsapp: normalized,
      clientId: contact?.clientId ?? null,
      lid: normalized.length >= 14 ? normalized : null,
      ...snapshot,
      chosenContactId: contact?.id ?? null,
      action: contact ? 'reuse' : 'create',
      stage: 'after-findContactByWhatsappOrLid',
    });

    return contact ?? null;
  }

  async findContactByWhatsapp(
    tenantId: string,
    whatsapp: string,
    opts?: { direction?: 'inbound' | 'outbound'; clientId?: string | null; rawInput?: string; lid?: string | null },
  ) {
    const normalized = normalizeWhatsappNumber(whatsapp) || whatsapp;
    const snapshot = await this.getContactResolutionSnapshot(tenantId, normalized, opts?.clientId);
    this.logContactResolution({
      scope: 'contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      rawInput: opts?.rawInput ?? whatsapp,
      normalizedWhatsapp: normalized,
      clientId: opts?.clientId ?? null,
      lid: opts?.lid ?? (normalized.length >= 14 ? normalized : null),
      ...snapshot,
      chosenContactId: null,
      action: 'create',
      stage: 'before-findContactByWhatsapp',
    });

    // Busca por telefone normalizado ou LID, sempre reaproveitando o mesmo contato
    let contact = await this.findContactByWhatsappOrLid(tenantId, normalized);

    if (!contact) {
      const [inactiveCandidate] = await this.buildWhatsappContactsQuery(tenantId, normalized, true).getMany();
      if (inactiveCandidate) {
        if (inactiveCandidate.status === 'inactive') {
          // 'inactive' é marcação de sistema (remoção/merge). Pode ser reativado diretamente
          // sem trilha de auditoria — esse era o comportamento original e é seguro manter,
          // pois 'inactive' nunca passou pelo fluxo de arquivamento explícito.
          await this.contacts.update(
            { id: inactiveCandidate.id, tenantId },
            { status: 'active', isPrimary: inactiveCandidate.isPrimary || undefined } as any,
          );
        } else if (inactiveCandidate.status === 'archived') {
          // 'archived' foi explicitamente arquivado por um agente. A reativação aqui
          // seria indevida: este método não tem contexto suficiente para decidir se o
          // contato deve ser reativado (essa decisão pertence à camada de resolução de
          // identidade WhatsApp: resolveCanonicalWhatsappContact e findOrCreateByWhatsapp).
          // Reativar sem metadata quebraria a trilha de auditoria (archivedAt ficaria
          // populado, reactivatedAt ficaria ausente).
          // Não tocamos no status; apenas consolidamos os vínculos.
          this.logger.warn(JSON.stringify({
            scope: 'contact-reactivation-skipped',
            reason: 'archived-contact-in-findContactByWhatsapp-fallback',
            tenantId,
            contactId: inactiveCandidate.id,
          }));
        } else {
          // Status inesperado (ex.: valor legado ou futuro): não reativa para evitar
          // regressões silenciosas. Apenas loga para diagnóstico.
          this.logger.warn(JSON.stringify({
            scope: 'contact-unknown-status-in-fallback',
            reason: 'unexpected-status-skipped-reactivation',
            tenantId,
            contactId: inactiveCandidate.id,
            status: inactiveCandidate.status,
          }));
        }
        await this.consolidateWhatsappContactLinks(tenantId, inactiveCandidate.id, normalized);
        contact = await this.contacts.findOne({
          where: { id: inactiveCandidate.id, tenantId },
          relations: ['client'],
        });
      }
    }

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

    await this.consolidateWhatsappContactLinks(tenantId, contact.id, normalized);
    contact = await this.contacts.findOne({
      where: { id: contact.id, tenantId },
      relations: ['client'],
    });

    this.logContactResolution({
      scope: 'contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      rawInput: opts?.rawInput ?? whatsapp,
      normalizedWhatsapp: normalized,
      clientId: opts?.clientId ?? contact?.clientId ?? null,
      lid: opts?.lid ?? (normalized.length >= 14 ? normalized : null),
      ...snapshot,
      chosenContactId: contact?.id ?? null,
      action: contact ? 'reuse' : 'create',
      stage: 'after-findContactByWhatsapp',
    });

    return contact;
  }

  async persistWhatsappLid(
    tenantId: string,
    contactId: string,
    whatsappLid: string,
    opts?: { direction?: 'inbound' | 'outbound'; clientId?: string | null; rawInput?: string },
  ) {
    const normalized = normalizeWhatsappNumber(whatsappLid) || whatsappLid;
    if (!normalized) return;
    const snapshot = await this.getContactResolutionSnapshot(tenantId, normalized, opts?.clientId);
    this.logContactResolution({
      scope: 'contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      rawInput: opts?.rawInput ?? whatsappLid,
      normalizedWhatsapp: normalized,
      clientId: opts?.clientId ?? null,
      lid: normalized,
      ...snapshot,
      chosenContactId: contactId,
      action: 'reuse',
      stage: 'persistWhatsappLid',
    });

    const contact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    if (!contact) return;
    const anchorWhatsapp = contact.whatsapp && contact.whatsapp !== normalized ? contact.whatsapp : null;

    const siblingContacts = anchorWhatsapp
      ? await this.contacts.find({
          where: { tenantId, whatsapp: anchorWhatsapp, status: 'active' as any },
        })
      : [];

    const contactsToUpdate = [contact, ...siblingContacts.filter((sibling) => sibling.id !== contact.id)];
    for (const current of contactsToUpdate) {
      if (current.metadata?.whatsappLid === normalized) continue;
      const updatedMeta = { ...(current.metadata ?? {}), whatsappLid: normalized };
      await this.contacts.update({ id: current.id, tenantId }, { metadata: updatedMeta } as any);
    }
  }

  async getLinkedClientsForContact(
    tenantId: string,
    contactId: string,
  ): Promise<Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }>> {
    return this.getLinkedClientsForContactIds(tenantId, [contactId]);
  }

  private async getLinkedClientsForContactIds(
    tenantId: string,
    contactIds: string[],
  ): Promise<Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }>> {
    if (!contactIds.length) return [];

    return this.contacts.manager.query(
      `SELECT DISTINCT
              c.id,
              c.company_name AS "companyName",
              c.trade_name   AS "tradeName",
              c.cnpj
         FROM clients c
         JOIN (
                SELECT ct.client_id::text AS client_id
                  FROM contacts ct
                 WHERE ct.tenant_id::text = $1
                   AND ct.id::text = ANY($2::text[])
                   AND ct.client_id IS NOT NULL
                UNION
                SELECT cc.client_id::text AS client_id
                  FROM contact_customers cc
                 WHERE cc.tenant_id::text = $1
                   AND cc.contact_id::text = ANY($2::text[])
              ) links ON links.client_id = c.id::text
        WHERE c.status = 'active'
        ORDER BY c.company_name ASC`,
      [tenantId, contactIds],
    );
  }

  private async getRawLinkedClientIdsForContactIds(
    tenantId: string,
    contactIds: string[],
  ): Promise<string[]> {
    if (!contactIds.length) return [];

    const rows = await this.contacts.manager.query<{ client_id: string }[]>(
      `SELECT DISTINCT links.client_id
         FROM (
                SELECT ct.client_id::text AS client_id
                  FROM contacts ct
                 WHERE ct.tenant_id::text = $1
                   AND ct.id::text = ANY($2::text[])
                   AND ct.client_id IS NOT NULL
                UNION
                SELECT cc.client_id::text AS client_id
                  FROM contact_customers cc
                 WHERE cc.tenant_id::text = $1
                   AND cc.contact_id::text = ANY($2::text[])
                   AND cc.client_id IS NOT NULL
              ) links`,
      [tenantId, contactIds],
    );

    return rows
      .map((row) => String(row.client_id || '').trim())
      .filter((clientId) => Boolean(clientId));
  }

  private buildAmbiguousLinkedClients(
    rawLinkedClientIds: string[],
    linkedClients: Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }>,
  ): Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }> {
    if (linkedClients.length) return linkedClients;

    return rawLinkedClientIds.map((clientId) => ({
      id: clientId,
      companyName: 'Empresa vinculada',
      tradeName: null,
      cnpj: null,
    }));
  }

  async resolveClientForSupportContact(
    tenantId: string,
    contactId: string,
  ): Promise<
    | { mode: 'none' }
    | { mode: 'single'; clientId: string }
    | { mode: 'multiple'; clients: Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }> }
  > {
    const rawLinkedClientIds = await this.getRawLinkedClientIdsForContactIds(tenantId, [contactId]);
    const linked = await this.getLinkedClientsForContact(tenantId, contactId);

    if (rawLinkedClientIds.length > 1) {
      return { mode: 'multiple', clients: this.buildAmbiguousLinkedClients(rawLinkedClientIds, linked) };
    }

    if (linked.length === 1) {
      return { mode: 'single', clientId: linked[0].id };
    }

    if (linked.length > 1) {
      return { mode: 'multiple', clients: linked };
    }

    // fallback temporário para compatibilidade com cadastros antigos
    return { mode: 'none' };
  }

  async resolveClientForSupportIdentifier(
    tenantId: string,
    whatsapp: string,
  ): Promise<
    | { mode: 'none' }
    | { mode: 'single'; clientId: string }
    | { mode: 'multiple'; clients: Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }> }
  > {
    const normalized = normalizeWhatsappNumber(whatsapp) || whatsapp;
    const isTechnical = this.isTechnicalWhatsappIdentifier(normalized, whatsapp);

    if (isTechnical) {
      const canonical = await this.resolveCanonicalWhatsappContact(tenantId, {
        rawWhatsapp: whatsapp,
        normalizedWhatsapp: normalized,
        lid: normalized,
      });
      const technicalContactIds = Array.from(new Set([
        ...(canonical.candidates ?? []),
        canonical.contact?.id ?? null,
      ].filter((value): value is string => Boolean(value))));
      if (!technicalContactIds.length) return { mode: 'none' };

      const rawLinkedClientIds = await this.getRawLinkedClientIdsForContactIds(tenantId, technicalContactIds);
      const linkedClients = await this.getLinkedClientsForContactIds(tenantId, technicalContactIds);

      if (rawLinkedClientIds.length > 1) {
        return {
          mode: 'multiple',
          clients: this.buildAmbiguousLinkedClients(rawLinkedClientIds, linkedClients),
        };
      }

      if (linkedClients.length === 1) {
        return { mode: 'single', clientId: linkedClients[0].id };
      }

      if (linkedClients.length > 1) {
        return { mode: 'multiple', clients: linkedClients };
      }

      return { mode: 'none' };
    }

    const contacts = await this.findContactsByWhatsapp(tenantId, whatsapp);
    if (!contacts.length) return { mode: 'none' };

    const contactIds = contacts.map((contact) => contact.id);
    const rawLinkedClientIds = await this.getRawLinkedClientIdsForContactIds(tenantId, contactIds);
    const linkedClients = await this.getLinkedClientsForContactIds(
      tenantId,
      contactIds,
    );

    if (rawLinkedClientIds.length > 1) {
      return {
        mode: 'multiple',
        clients: this.buildAmbiguousLinkedClients(rawLinkedClientIds, linkedClients),
      };
    }

    if (linkedClients.length === 1) {
      return { mode: 'single', clientId: linkedClients[0].id };
    }

    if (linkedClients.length > 1) {
      return { mode: 'multiple', clients: linkedClients };
    }

    return { mode: 'none' };
  }

  async getWhatsappSessionIdentifiers(tenantId: string, whatsapp: string): Promise<string[]> {
    const normalized = normalizeWhatsappNumber(whatsapp) || whatsapp;
    const contacts = await this.findContactsByWhatsapp(tenantId, normalized);
    const identifiers = new Set<string>([normalized]);

    for (const contact of contacts) {
      if (contact.whatsapp) identifiers.add(String(contact.whatsapp));
      if (contact.metadata?.whatsappLid) identifiers.add(String(contact.metadata.whatsappLid));
    }

    return Array.from(identifiers);
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
    const linked = await this.contacts.manager.query(
      `SELECT 1
       FROM contact_customers
       WHERE tenant_id = $1 AND contact_id = $2 AND client_id = $3
       LIMIT 1`,
      [tenantId, contactId, clientId],
    );
    if (linked.length) return true;
    if (contact.isPrimary && contact.client?.networkId) {
      const targetClient = await this.clients.findOne({
        where: { id: clientId, tenantId, status: 'active' },
      });
      if (targetClient?.networkId === contact.client.networkId) return true;
    }
    return false;
  }

  /**
   * Resolve qual contato do portal deve representar o usuário para uma empresa.
   * Isso cobre:
   * - contato primário direto (contacts.client_id)
   * - vínculos N:N em contact_customers
   * - múltiplos contatos ativos com o mesmo e-mail
   * - empresas da mesma rede quando o contato é primary
   */
  async findPortalContactForClient(
    tenantId: string,
    email: string,
    clientId: string,
  ): Promise<Contact | null> {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return null;

    const contacts = await this.contacts.createQueryBuilder('c')
      .leftJoinAndSelect('c.client', 'cl')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere("LOWER(TRIM(c.email)) = :email", { email: normalized })
      .andWhere("c.status = 'active'")
      .andWhere('c.portal_password IS NOT NULL')
      .orderBy('c.is_primary', 'DESC')
      .addOrderBy('c.created_at', 'ASC')
      .getMany();

    for (const contact of contacts) {
      if (await this.canContactAccessClient(tenantId, contact.id, clientId)) {
        return contact;
      }
    }

    return null;
  }

  async canPortalEmailAccessClient(
    tenantId: string,
    email: string,
    clientId: string,
  ): Promise<boolean> {
    const contact = await this.findPortalContactForClient(tenantId, email, clientId);
    return !!contact;
  }

  /** Contato principal: pode ver ticket se tiver acesso ao cliente. Contato normal: só se o ticket for dele (ou mesmo email). */
  async canContactAccessTicket(
    tenantId: string,
    contactId: string,
    ticketClientId: string,
    ticketContactId: string | null,
    isPrimary: boolean,
  ): Promise<boolean> {
    let canAccessClient = await this.canContactAccessClient(tenantId, contactId, ticketClientId);
    if (!canAccessClient) {
      const currentContact = await this.contacts.findOne({ where: { id: contactId, tenantId } });
      if (currentContact?.email) {
        canAccessClient = await this.canPortalEmailAccessClient(tenantId, currentContact.email, ticketClientId);
      }
    }
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

  async findOrCreateByWhatsapp(
    tenantId: string,
    phone: string,
    displayName?: string,
    isLid = false,
    opts?: { direction?: 'inbound' | 'outbound'; clientId?: string | null; rawInput?: string },
  ) {
    const normalized = normalizeWhatsappNumber(phone) || phone;
    const snapshot = await this.getContactResolutionSnapshot(tenantId, normalized, opts?.clientId);
    this.logContactResolution({
      scope: 'contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      rawInput: opts?.rawInput ?? phone,
      normalizedWhatsapp: normalized,
      clientId: opts?.clientId ?? null,
      lid: isLid ? normalized : null,
      ...snapshot,
      chosenContactId: null,
      action: 'create',
      stage: 'before-findOrCreateByWhatsapp',
    });
    this.logContactCreateAudit({
      scope: 'contact-create',
      source: opts?.direction ?? 'inbound',
      whatsapp: normalized,
      isTechnical: isLid || this.isTechnicalWhatsappIdentifier(normalized, opts?.rawInput ?? phone),
      allowed: false,
      stage: 'before-findOrCreateByWhatsapp',
    });

    // 1. Nunca cria duplicado se já existir contato equivalente por telefone ou LID
    const existing = await this.findContactByWhatsappOrLid(tenantId, normalized);
    if (existing) {
      const sanitizedExisting = await this.sanitizeTechnicalContactIdentifiers(tenantId, existing);
      // Garante que metadata.whatsappLid está presente para contatos LID já existentes
      if (isLid && sanitizedExisting.metadata?.whatsappLid !== normalized) {
        const updatedMeta = { ...(sanitizedExisting.metadata ?? {}), whatsappLid: normalized };
        await this.contacts.update({ id: sanitizedExisting.id, tenantId }, { metadata: updatedMeta } as any);
        sanitizedExisting.metadata = updatedMeta;
      }
      // Reativa automaticamente contato arquivado que voltou a enviar mensagem.
      // Este é o caminho de fallback (resolveCanonicalWhatsappContact retornou null).
      // Contatos 'inactive' (removidos pelo sistema) NÃO são reativados.
      if (sanitizedExisting.status === 'archived') {
        const reactivatedMetadata = {
          ...(sanitizedExisting.metadata ?? {}),
          archivedAt: null,
          reactivatedAt: new Date().toISOString(),
        };
        await this.contacts.update(
          { id: sanitizedExisting.id, tenantId },
          { status: 'active', metadata: reactivatedMetadata } as any,
        );
        sanitizedExisting.status = 'active';
        sanitizedExisting.metadata = reactivatedMetadata;
        this.logger.log(JSON.stringify({
          scope: 'contact-reactivation',
          reason: 'inbound-whatsapp-message-fallback',
          tenantId,
          contactId: sanitizedExisting.id,
        }));
      }
      await this.consolidateWhatsappContactLinks(tenantId, sanitizedExisting.id, normalized);
      this.logContactResolution({
        scope: 'contact-resolution',
        direction: opts?.direction ?? 'inbound',
        tenantId,
        rawInput: opts?.rawInput ?? phone,
        normalizedWhatsapp: normalized,
        clientId: opts?.clientId ?? sanitizedExisting.clientId ?? null,
        lid: isLid ? normalized : null,
        ...snapshot,
        chosenContactId: sanitizedExisting.id,
        action: 'reuse',
        stage: 'after-findOrCreateByWhatsapp',
      });
      this.logContactCreateAudit({
        scope: 'contact-create',
        source: opts?.direction ?? 'inbound',
        whatsapp: normalized,
        isTechnical: isLid || this.isTechnicalWhatsappIdentifier(normalized, opts?.rawInput ?? phone),
        allowed: false,
        stage: 'reused-existing-contact',
      });
      return sanitizedExisting;
    }

    // LID é apenas identificador técnico do WhatsApp.
    // Sem match confiável, não deve virar contato novo nem telefone principal.
    if (isLid || this.isTechnicalWhatsappIdentifier(normalized, opts?.rawInput ?? phone)) {
      this.logWhatsappIdentityGuard({
        scope: 'whatsapp-identity-guard',
        direction: opts?.direction ?? 'inbound',
        tenantId,
        attemptedWhatsappValue: normalized,
        reason: opts?.direction === 'outbound'
          ? 'technical-identifier-blocked-outbound'
          : 'technical-identifier-blocked',
      });
      this.logContactResolution({
        scope: 'contact-resolution',
        direction: opts?.direction ?? 'inbound',
        tenantId,
        rawInput: opts?.rawInput ?? phone,
        normalizedWhatsapp: normalized,
        clientId: opts?.clientId ?? null,
        lid: normalized,
        ...snapshot,
        chosenContactId: null,
        action: 'create',
        stage: 'after-findOrCreateByWhatsapp',
      });
      this.logContactCreateAudit({
        scope: 'contact-create',
        source: opts?.direction ?? 'inbound',
        whatsapp: normalized,
        isTechnical: true,
        allowed: false,
        stage: 'blocked-technical-identifier',
      });
      return null;
    }

    // 2. Cria SOMENTE o contato — sem cliente temporário
    // Se for LID (@lid JID), NÃO armazena como phone (pois não é número de telefone real).
    // Mantemos whatsapp por compatibilidade no roteamento atual e também salvamos metadata.whatsappLid
    // para a UI/fluxos conseguirem distinguir identificador técnico de número real.
    // O agente vinculará ao cliente real durante o atendimento via ContactValidationBanner
    const contact = await this.contacts.save(
      this.contacts.create({
        tenantId,
        clientId: (opts?.clientId ?? null) as any,
        name: displayName || `+${normalized}`,
        whatsapp: normalized,
        phone: normalized,
        preferredChannel: 'whatsapp',
        canOpenTickets: true,
        status: 'active',
        metadata: {},
      }),
    );
    contact.client = null as any;
    this.logContactResolution({
      scope: 'contact-resolution',
      direction: opts?.direction ?? 'inbound',
      tenantId,
      rawInput: opts?.rawInput ?? phone,
      normalizedWhatsapp: normalized,
      clientId: opts?.clientId ?? null,
      lid: null,
      ...snapshot,
      chosenContactId: contact.id,
      action: 'create',
      stage: 'after-findOrCreateByWhatsapp',
    });
    this.logContactCreateAudit({
      scope: 'contact-create',
      source: opts?.direction ?? 'inbound',
      whatsapp: normalized,
      isTechnical: false,
      allowed: true,
      stage: 'created-contact',
    });
    return contact;
  }

  /**
   * Vincula um contato a um cliente existente e adiciona ao cadastro de contatos do cliente.
   * Usado quando o contato informa o CNPJ e o sistema identifica automaticamente.
   * Também insere no pivot contact_customers (vinculação automática, linked_by = null).
   */
  async linkContactToClient(tenantId: string, contactId: string, clientId: string): Promise<void> {
    const current = await this.contacts.findOne({ where: { id: contactId, tenantId } });
    const contact = current ? await this.sanitizeTechnicalContactIdentifiers(tenantId, current) : null;
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
