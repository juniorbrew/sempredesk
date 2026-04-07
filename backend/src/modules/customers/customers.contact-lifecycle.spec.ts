import { BadRequestException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ContactArchiveRolloutService } from './contact-archive-rollout.service';
import { Contact } from './entities/customer.entity';

function testConfig(getImpl?: (key: string) => unknown) {
  return { get: jest.fn((k: string) => (getImpl ? getImpl(k) : undefined)) } as any;
}

function makeCustomersService(clientsRepo: any, contactsRepo: any, cfg?: any) {
  const c = cfg ?? testConfig();
  return new CustomersService(clientsRepo, contactsRepo, new ContactArchiveRolloutService(c));
}

const TENANT = 'tenant-e2e-unit';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const CONTACT_ID = '22222222-2222-2222-2222-222222222222';

/** Número BR canônico (não-LID) para testes de WhatsApp */
const CANONICAL_WA = '5511987654321';

function baseContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: CONTACT_ID,
    tenantId: TENANT,
    clientId: CLIENT_ID,
    name: 'Contato Teste',
    status: 'active',
    whatsapp: CANONICAL_WA,
    metadata: { existingKey: 'keep' },
    isPrimary: true,
    createdAt: new Date('2022-06-01T12:00:00.000Z'),
    ...overrides,
  } as Contact;
}

function makeRepos() {
  const contactsRepo: any = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {
      query: jest.fn().mockResolvedValue(undefined),
    },
  };
  const clientsRepo: any = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  return { contactsRepo, clientsRepo };
}

describe('CustomersService — ciclo de arquivo / reativação / listagem (Etapa 8)', () => {
  describe('archiveContact', () => {
    it('deve mudar status para archived, preencher archivedAt e preservar metadata', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const active = baseContact({ status: 'active', metadata: { existingKey: 'keep', other: 1 } });
      let findCount = 0;
      contactsRepo.findOne.mockImplementation(async () => {
        findCount += 1;
        if (findCount === 1) return { ...active, client: null };
        return {
          ...active,
          status: 'archived',
          metadata: { ...active.metadata, archivedAt: 'fixed-in-second-call' },
        };
      });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      const result = await service.archiveContact(TENANT, CONTACT_ID);
      expect(contactsRepo.update).toHaveBeenCalledWith(
        { id: CONTACT_ID, tenantId: TENANT },
        expect.objectContaining({
          status: 'archived',
          metadata: expect.objectContaining({
            existingKey: 'keep',
            other: 1,
            archivedAt: expect.any(String),
          }),
        }),
      );
      expect(result.status).toBe('archived');
    });

    it('deve fechar conversas ativas e apagar sessão do chatbot quando há whatsapp', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const active = baseContact({ status: 'active', whatsapp: '5511999887766' });
      contactsRepo.findOne.mockResolvedValueOnce({ ...active, client: null }).mockResolvedValueOnce({
        ...active,
        status: 'archived',
      });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await service.archiveContact(TENANT, CONTACT_ID);
      expect(contactsRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE conversations"),
        expect.arrayContaining([TENANT, CONTACT_ID]),
      );
      expect(contactsRepo.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM chatbot_sessions'),
        [TENANT, active.whatsapp],
      );
    });

    it('deve lançar BadRequestException se status !== active (archived)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      contactsRepo.findOne.mockResolvedValue({ ...baseContact({ status: 'archived' }), client: null });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await expect(service.archiveContact(TENANT, CONTACT_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(contactsRepo.update).not.toHaveBeenCalled();
    });

    it('deve lançar BadRequestException se status !== active (inactive)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      contactsRepo.findOne.mockResolvedValue({ ...baseContact({ status: 'inactive' }), client: null });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await expect(service.archiveContact(TENANT, CONTACT_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deve bloquear arquivamento quando FEATURE_CONTACT_ARCHIVE=false', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const active = baseContact({ status: 'active' });
      contactsRepo.findOne.mockResolvedValue({ ...active, client: null });
      const cfg = testConfig((k) => (k === 'FEATURE_CONTACT_ARCHIVE' ? 'false' : undefined));
      const service = makeCustomersService(clientsRepo, contactsRepo, cfg);
      await expect(service.archiveContact(TENANT, CONTACT_ID)).rejects.toBeInstanceOf(BadRequestException);
      expect(contactsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('unarchiveContact', () => {
    it('deve mudar para active, limpar archivedAt e definir reactivatedAt', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const archived = baseContact({
        status: 'archived',
        metadata: { archivedAt: '2024-01-01T00:00:00.000Z', x: 1 },
      });
      contactsRepo.findOne
        .mockResolvedValueOnce({ ...archived, client: null })
        .mockResolvedValueOnce({
          ...archived,
          status: 'active',
          metadata: { ...archived.metadata, archivedAt: null, reactivatedAt: 'iso' },
        });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await service.unarchiveContact(TENANT, CONTACT_ID);
      expect(contactsRepo.update).toHaveBeenCalledWith(
        { id: CONTACT_ID, tenantId: TENANT },
        expect.objectContaining({
          status: 'active',
          metadata: expect.objectContaining({
            x: 1,
            archivedAt: null,
            reactivatedAt: expect.any(String),
          }),
        }),
      );
    });

    it('deve lançar BadRequestException se status !== archived (active)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      contactsRepo.findOne.mockResolvedValue({ ...baseContact({ status: 'active' }), client: null });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await expect(service.unarchiveContact(TENANT, CONTACT_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deve lançar BadRequestException se status !== archived (inactive)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      contactsRepo.findOne.mockResolvedValue({ ...baseContact({ status: 'inactive' }), client: null });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      await expect(service.unarchiveContact(TENANT, CONTACT_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resolveCanonicalWhatsappContact — reativação automática', () => {
    it('archived: reativa com metadata, loga e retorna contato ativo', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const archived = baseContact({
        id: 'c-arch',
        status: 'archived',
        metadata: { archivedAt: '2024-01-01T00:00:00.000Z' },
      });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service, 'persistWhatsappRuntimeIdentifiers').mockResolvedValue(undefined);

      const qbEmpty = makeQueryBuilderChain(() => Promise.resolve([]));
      contactsRepo.createQueryBuilder.mockImplementation(() => qbEmpty);

      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockImplementation(() => ({
        getMany: jest.fn().mockResolvedValue([archived]),
      }));

      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
      try {
        const res = await service.resolveCanonicalWhatsappContact(TENANT, {
          normalizedWhatsapp: CANONICAL_WA,
          direction: 'inbound',
        });

        expect(res.contact?.status).toBe('active');
        expect(res.contact?.metadata?.archivedAt).toBeNull();
        expect(res.contact?.metadata?.reactivatedAt).toEqual(expect.any(String));
        expect(contactsRepo.update).toHaveBeenCalledWith(
          { id: archived.id, tenantId: TENANT },
          expect.objectContaining({
            status: 'active',
            metadata: expect.objectContaining({ archivedAt: null, reactivatedAt: expect.any(String) }),
          }),
        );
        expect(logSpy.mock.calls.some((c) => String(c[0]).includes('contact-reactivation'))).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('inactive: não aplica bloco de reativação de archived (sem status active via esse bloco)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const inactive = baseContact({ id: 'c-inact', status: 'inactive' });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service, 'persistWhatsappRuntimeIdentifiers').mockResolvedValue(undefined);

      const qbEmpty = makeQueryBuilderChain(() => Promise.resolve([]));
      contactsRepo.createQueryBuilder.mockImplementation(() => qbEmpty);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockImplementation(() => ({
        getMany: jest.fn().mockResolvedValue([inactive]),
      }));

      const updateSpy = jest.spyOn(contactsRepo, 'update');
      await service.resolveCanonicalWhatsappContact(TENANT, {
        normalizedWhatsapp: CANONICAL_WA,
        direction: 'inbound',
      });

      const reactivationCalls = updateSpy.mock.calls.filter((args: unknown[]) => {
        const patch = args[1] as { status?: string; metadata?: { reactivatedAt?: string } } | undefined;
        return patch?.status === 'active' && !!patch?.metadata?.reactivatedAt;
      });
      expect(reactivationCalls.length).toBe(0);
    });
  });

  describe('findOrCreateByWhatsapp — fallback archived / inactive', () => {
    it('archived: reativa com metadata correto', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const archived = baseContact({
        status: 'archived',
        metadata: { archivedAt: '2024-01-01T00:00:00.000Z' },
      });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'getContactResolutionSnapshot').mockResolvedValue({});
      jest.spyOn(service, 'findContactByWhatsappOrLid').mockResolvedValue(archived as Contact);
      jest.spyOn(service as any, 'sanitizeTechnicalContactIdentifiers').mockImplementation(async (_t: string, c: Contact) => c);
      jest.spyOn(service as any, 'consolidateWhatsappContactLinks').mockResolvedValue(undefined);

      const out = await service.findOrCreateByWhatsapp(TENANT, CANONICAL_WA, 'Nome', false, {
        direction: 'inbound',
        rawInput: CANONICAL_WA,
      });

      expect(out?.status).toBe('active');
      expect(out?.metadata?.archivedAt).toBeNull();
      expect(out?.metadata?.reactivatedAt).toEqual(expect.any(String));
      expect(contactsRepo.update).toHaveBeenCalledWith(
        { id: archived.id, tenantId: TENANT },
        expect.objectContaining({
          status: 'active',
          metadata: expect.objectContaining({ archivedAt: null, reactivatedAt: expect.any(String) }),
        }),
      );
    });

    it('inactive: não reativa com metadata de arquivo (bloco archived não roda)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const inactive = baseContact({ status: 'inactive' });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'getContactResolutionSnapshot').mockResolvedValue({});
      jest.spyOn(service, 'findContactByWhatsappOrLid').mockResolvedValue(inactive as Contact);
      jest.spyOn(service as any, 'sanitizeTechnicalContactIdentifiers').mockImplementation(async (_t: string, c: Contact) => c);
      jest.spyOn(service as any, 'consolidateWhatsappContactLinks').mockResolvedValue(undefined);
      contactsRepo.update.mockClear();

      await service.findOrCreateByWhatsapp(TENANT, CANONICAL_WA, 'Nome', false, { direction: 'inbound' });

      const archivedFlow = contactsRepo.update.mock.calls.filter(
        (c) => c[1]?.metadata && 'archivedAt' in (c[1].metadata as object) && (c[1].metadata as any).archivedAt === null,
      );
      expect(archivedFlow.length).toBe(0);
    });
  });

  describe('findContactByWhatsapp — fallback (Etapa 5)', () => {
    it('inactive: reativa sem metadata de arquivo', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const inactive = baseContact({ status: 'inactive' });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'getContactResolutionSnapshot').mockResolvedValue({});
      jest.spyOn(service, 'findContactByWhatsappOrLid').mockResolvedValue(null);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockImplementation((_t: string, n: string, inc: boolean) => ({
        getMany: jest.fn().mockResolvedValue(inc && n === CANONICAL_WA ? [inactive] : []),
      }));
      jest.spyOn(service as any, 'consolidateWhatsappContactLinks').mockResolvedValue(undefined);
      contactsRepo.findOne.mockResolvedValue({ ...inactive, status: 'active', client: null });

      await service.findContactByWhatsapp(TENANT, CANONICAL_WA, { direction: 'inbound' });

      expect(contactsRepo.update).toHaveBeenCalledWith(
        { id: inactive.id, tenantId: TENANT },
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('archived: não reativa; loga warning', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const archived = baseContact({ status: 'archived' });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'getContactResolutionSnapshot').mockResolvedValue({});
      jest.spyOn(service, 'findContactByWhatsappOrLid').mockResolvedValue(null);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockImplementation((_t: string, n: string, inc: boolean) => ({
        getMany: jest.fn().mockResolvedValue(inc && n === CANONICAL_WA ? [archived] : []),
      }));
      jest.spyOn(service as any, 'consolidateWhatsappContactLinks').mockResolvedValue(undefined);
      contactsRepo.findOne.mockResolvedValue({ ...archived, client: null });
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
      contactsRepo.update.mockClear();

      await service.findContactByWhatsapp(TENANT, CANONICAL_WA, { direction: 'inbound' });

      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes('archived-contact-in-findContactByWhatsapp-fallback')),
      ).toBe(true);
      expect(contactsRepo.update).not.toHaveBeenCalledWith(
        { id: archived.id, tenantId: TENANT },
        expect.objectContaining({ status: 'active' }),
      );
      warnSpy.mockRestore();
    });
  });

  describe('consolidateWhatsappContactLinks (Etapa 5)', () => {
    it('inactive: reativa para active (sem trilha de arquivo)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const inactive = baseContact({ status: 'inactive', isPrimary: true });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockReturnValue({
        getMany: jest.fn().mockResolvedValue([inactive]),
      });
      contactsRepo.manager.query.mockResolvedValue([]);
      await (service as any).consolidateWhatsappContactLinks(TENANT, inactive.id, CANONICAL_WA);
      expect(contactsRepo.update).toHaveBeenCalledWith(
        { id: inactive.id, tenantId: TENANT },
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('archived: não altera status', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const archived = baseContact({ status: 'archived', isPrimary: true, metadata: { archivedAt: 'x' } });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockReturnValue({
        getMany: jest.fn().mockResolvedValue([archived]),
      });
      contactsRepo.manager.query.mockResolvedValue([]);
      contactsRepo.update.mockClear();
      await (service as any).consolidateWhatsappContactLinks(TENANT, archived.id, CANONICAL_WA);
      expect(contactsRepo.update).not.toHaveBeenCalled();
    });

    it('active: não altera quando não há diff de metadata / primary', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const active = baseContact({ status: 'active', isPrimary: true, metadata: {} });
      const service = makeCustomersService(clientsRepo, contactsRepo);
      jest.spyOn(service as any, 'buildWhatsappContactsQuery').mockReturnValue({
        getMany: jest.fn().mockResolvedValue([active]),
      });
      contactsRepo.manager.query.mockResolvedValue([]);
      contactsRepo.update.mockClear();
      await (service as any).consolidateWhatsappContactLinks(TENANT, active.id, CANONICAL_WA);
      expect(contactsRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('findContacts e filterVisibleContactsForClient (Etapa 7)', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('includeArchived=false: só retorna active (inactive filtrado no SQL)', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      clientsRepo.findOne.mockResolvedValue({ id: CLIENT_ID });
      const rows = [
        baseContact({ id: 'a1', name: 'A', status: 'active' }),
        baseContact({ id: 'a2', name: 'B', status: 'archived' }),
      ];
      stubFindContactsQuery(contactsRepo, rows);
      jest.spyOn(CustomersService.prototype as any, 'sanitizeTechnicalContactIdentifiers').mockImplementation(async (_t: string, c: Contact) => c);

      const service = makeCustomersService(clientsRepo, contactsRepo);
      const out = await service.findContacts(TENANT, CLIENT_ID, false);
      expect(out.map((c) => c.id)).toEqual(['a1']);
    });

    it('includeArchived=true: retorna active + archived', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      clientsRepo.findOne.mockResolvedValue({ id: CLIENT_ID });
      const rows = [
        baseContact({ id: 'a1', name: 'A', status: 'active' }),
        baseContact({ id: 'a2', name: 'B', status: 'archived' }),
      ];
      stubFindContactsQuery(contactsRepo, rows);
      jest.spyOn(CustomersService.prototype as any, 'sanitizeTechnicalContactIdentifiers').mockImplementation(async (_t: string, c: Contact) => c);

      const service = makeCustomersService(clientsRepo, contactsRepo);
      const out = await service.findContacts(TENANT, CLIENT_ID, true);
      expect(out.map((c) => c.id).sort()).toEqual(['a1', 'a2'].sort());
    });

    it('inactive nunca aparece mesmo com includeArchived=true', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      clientsRepo.findOne.mockResolvedValue({ id: CLIENT_ID });
      const rows = [baseContact({ id: 'i1', status: 'inactive' })];
      stubFindContactsQuery(contactsRepo, rows);
      jest.spyOn(CustomersService.prototype as any, 'sanitizeTechnicalContactIdentifiers').mockImplementation(async (_t: string, c: Contact) => c);
      const service = makeCustomersService(clientsRepo, contactsRepo);
      const out = await service.findContacts(TENANT, CLIENT_ID, true);
      expect(out).toHaveLength(0);
    });

    it('filterVisibleContactsForClient: espelha SQL para includeArchived', async () => {
      const { contactsRepo, clientsRepo } = makeRepos();
      const service = makeCustomersService(clientsRepo, contactsRepo);
      const list = [
        baseContact({ id: '1', status: 'active' }),
        baseContact({ id: '2', status: 'archived' }),
        baseContact({ id: '3', status: 'inactive' }),
      ];
      const onlyActive = (service as any).filterVisibleContactsForClient(list, false);
      expect(onlyActive.map((c: Contact) => c.id)).toEqual(['1']);
      const withArchived = (service as any).filterVisibleContactsForClient(list, true);
      expect(withArchived.map((c: Contact) => c.id).sort()).toEqual(['1', '2'].sort());
    });
  });
});

function makeQueryBuilderChain(getMany: () => Promise<any[]>) {
  const chain: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockImplementation(getMany),
    getOne: jest.fn().mockResolvedValue(null),
  };
  return chain;
}

function stubFindContactsQuery(contactsRepo: any, getManyRows: Contact[]) {
  const chain: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(getManyRows),
  };
  contactsRepo.createQueryBuilder.mockReturnValue(chain);
}
