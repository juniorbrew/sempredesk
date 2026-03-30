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
      .where('ct.tenant_id = :tenantId', { tenantId })
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
    if (target.status !== 'active') {
      updates.status = 'active';
    }
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

      const aPrimary = a.isPrimary ? 1 : 0;
      const bPrimary = b.isPrimary ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;

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
      chosen.isPrimary ? 'is-primary' : null,
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

    const [whatsappMatches, lidMatches, jidMatches, resolvedDigitsMatches] = await Promise.all([
      normalizedWhatsapp
        ? this.buildWhatsappContactsQuery(tenantId, normalizedWhatsapp, true).getMany()
        : Promise.resolve([] as Contact[]),
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
      normalizedWhatsapp
        ? this.contacts.createQueryBuilder('ct')
          .leftJoinAndSelect('ct.client', 'client')
          .where('ct.tenant_id = :tenantId', { tenantId })
          .andWhere("ct.metadata->>'whatsappResolvedDigits' = :normalizedWhatsapp", { normalizedWhatsapp })
          .orderBy("ct.status = 'active'", 'DESC')
          .addOrderBy('ct.is_primary', 'DESC')
          .addOrderBy('ct.created_at', 'ASC')
          .getMany()
        : Promise.resolve([] as Contact[]),
    ]);

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
    if (candidateClientIds.length) {
      const siblingMatches = await this.contacts.createQueryBuilder('ct')
        .leftJoinAndSelect('ct.client', 'client')
        .where('ct.tenant_id = :tenantId', { tenantId })
        .andWhere('ct.client_id::text IN (:...candidateClientIds)', { candidateClientIds })
        .andWhere("COALESCE(ct.whatsapp, '') <> ''")
        .orderBy("ct.status = 'active'", 'DESC')
        .addOrderBy('ct.is_primary', 'DESC')
        .addOrderBy('ct.created_at', 'ASC')
        .getMany();
      for (const contact of siblingMatches) {
        if (!candidateMap.has(contact.id)) candidateMap.set(contact.id, contact);
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
      contact.status === 'active' &&
      contact.isPrimary &&
      contact.metadata?.whatsappLid === lid,
    );

    const hasTrustedClientLinkedTechnicalContact = Boolean(
      contact &&
      !canonicalCandidates.length &&
      contact.status === 'active' &&
      opts.clientId &&
      await this.isContactLinkedToClient(tenantId, contact.id, opts.clientId),
    );

    const hasTrustedExplicitClientSelectionForSingleTechnicalCandidate = Boolean(
      contact &&
      !canonicalCandidates.length &&
      contact.status === 'active' &&
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

    let [contact] = await this.buildWhatsappContactsQuery(tenantId, normalized, true).getMany();
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

    contact = await this.contacts.createQueryBuilder('ct')
      .leftJoinAndSelect('ct.client', 'client')
      .where('ct.tenant_id = :tenantId', { tenantId })
      .andWhere(
        "(ct.whatsapp = :normalized OR ct.metadata->>'whatsappLid' = :normalized)",
        { normalized },
      )
      .orderBy("ct.status = 'active'", 'DESC')
      .addOrderBy('ct.is_primary', 'DESC')
      .addOrderBy('ct.created_at', 'ASC')
      .getOne();

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
        await this.contacts.update(
          { id: inactiveCandidate.id, tenantId },
          { status: 'active', isPrimary: inactiveCandidate.isPrimary || undefined } as any,
        );
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

  async resolveClientForSupportContact(
    tenantId: string,
    contactId: string,
  ): Promise<
    | { mode: 'none' }
    | { mode: 'single'; clientId: string }
    | { mode: 'multiple'; clients: Array<{ id: string; companyName: string; tradeName: string | null; cnpj: string | null }> }
  > {
    const linked = await this.getLinkedClientsForContact(tenantId, contactId);

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

    let contacts: Contact[] = [];
    if (isTechnical) {
      const canonical = await this.resolveCanonicalWhatsappContact(tenantId, {
        rawWhatsapp: whatsapp,
        normalizedWhatsapp: normalized,
        lid: normalized,
      });
      if (!canonical.contact) return { mode: 'none' };
      contacts = [canonical.contact];
    } else {
      contacts = await this.findContactsByWhatsapp(tenantId, whatsapp);
    }
    if (!contacts.length) return { mode: 'none' };

    const contactIds = contacts.map((contact) => contact.id);
    const linkedClients = await this.getLinkedClientsForContactIds(tenantId, contactIds);

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
        clientId: null as any,
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
