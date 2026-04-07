/**
 * Integração com Postgres real (mesmo host/credenciais do .env / docker-compose).
 * Ative com: E2E_CUSTOMERS=1 npm run test:e2e
 *
 * Cobre os fluxos HTTP-equivalentes do CustomersService (arquivo, listagem, reativação).
 * Sem alterar código de produção; remove dados criados ao final de cada bloco.
 */
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Client, Contact } from '../src/modules/customers/entities/customer.entity';
import { CustomersService } from '../src/modules/customers/customers.service';
import { ContactArchiveRolloutService } from '../src/modules/customers/contact-archive-rollout.service';

const run = process.env.E2E_CUSTOMERS === '1';

const describeE2e = run ? describe : describe.skip;

describeE2e('Customers — contatos: arquivo, listagem e reativação (E2E serviço)', () => {
  let dataSource: DataSource;
  let service: CustomersService;
  const tenantId = '00000000-0000-0000-0000-000000000099';
  let clientId: string;
  let contactId: string;
  const phone = '551197777' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'suporte',
      password: process.env.DB_PASSWORD || 'suporte123',
      database: process.env.DB_NAME || 'suporte_tecnico',
      entities: [Client, Contact],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    const cfg = { get: (key: string) => process.env[key] } as any;
    service = new CustomersService(
      dataSource.getRepository(Client),
      dataSource.getRepository(Contact),
      new ContactArchiveRolloutService(cfg),
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(() => {
    clientId = randomUUID();
    contactId = randomUUID();
  });

  afterEach(async () => {
    if (!dataSource?.isInitialized) return;
    await dataSource.query(`DELETE FROM contact_customers WHERE contact_id::text = $1`, [contactId]);
    await dataSource.query(`DELETE FROM conversations WHERE contact_id::text = $1`, [contactId]);
    await dataSource.query(`DELETE FROM chatbot_sessions WHERE tenant_id = $1 AND identifier = $2`, [tenantId, phone]);
    await dataSource.query(`DELETE FROM contacts WHERE id::text = $1`, [contactId]);
    await dataSource.query(`DELETE FROM clients WHERE id::text = $1`, [clientId]);
  });

  async function seedActiveContact() {
    const clientRepo = dataSource.getRepository(Client);
    const contactRepo = dataSource.getRepository(Contact);
    await clientRepo.save(
      clientRepo.create({
        id: clientId,
        tenantId,
        companyName: `E2E ${clientId.slice(0, 8)}`,
        personType: 'juridica',
        status: 'active',
        metadata: {},
      }),
    );
    await contactRepo.save(
      contactRepo.create({
        id: contactId,
        tenantId,
        clientId,
        name: 'E2E Contato',
        status: 'active',
        whatsapp: phone,
        preferredChannel: 'whatsapp',
        canOpenTickets: true,
        isPrimary: true,
        metadata: {},
      }),
    );
  }

  it('1) Arquivar → some da listagem padrão; includeArchived=true lista de novo', async () => {
    await seedActiveContact();
    await service.archiveContact(tenantId, contactId);

    const onlyActive = await service.findContacts(tenantId, clientId, false);
    expect(onlyActive.find((c) => c.id === contactId)).toBeUndefined();

    const withArchived = await service.findContacts(tenantId, clientId, true);
    const found = withArchived.find((c) => c.id === contactId);
    expect(found).toBeDefined();
    expect(found?.status).toBe('archived');
  });

  it('2) Reativação automática via resolveCanonicalWhatsappContact após arquivo', async () => {
    await seedActiveContact();
    await service.archiveContact(tenantId, contactId);

    const res = await service.resolveCanonicalWhatsappContact(tenantId, {
      normalizedWhatsapp: phone,
      direction: 'inbound',
      rawInput: phone,
    });

    expect(res.contact?.id).toBe(contactId);
    expect(res.contact?.status).toBe('active');
    const meta = res.contact?.metadata ?? {};
    expect(meta.archivedAt == null).toBe(true);
    expect(typeof meta.reactivatedAt === 'string' && meta.reactivatedAt.length > 0).toBe(true);

    const row = await dataSource.query(`SELECT status, metadata FROM contacts WHERE id::text = $1`, [contactId]);
    expect(row[0]?.status).toBe('active');
  });

  it('3) Reativação manual: unarchive → aparece na listagem padrão', async () => {
    await seedActiveContact();
    await service.archiveContact(tenantId, contactId);
    await service.unarchiveContact(tenantId, contactId);

    const onlyActive = await service.findContacts(tenantId, clientId, false);
    expect(onlyActive.find((c) => c.id === contactId)).toBeDefined();
  });

  it('4) inactive nunca aparece (nem com includeArchived=true)', async () => {
    await seedActiveContact();
    await dataSource.query(`UPDATE contacts SET status = 'inactive' WHERE id::text = $1`, [contactId]);

    const a = await service.findContacts(tenantId, clientId, false);
    const b = await service.findContacts(tenantId, clientId, true);
    expect(a.find((c) => c.id === contactId)).toBeUndefined();
    expect(b.find((c) => c.id === contactId)).toBeUndefined();
  });
});
