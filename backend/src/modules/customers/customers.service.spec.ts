import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';

describe('CustomersService multiempresa resolution', () => {
  const makeService = (queryResults: any[] = []) => {
    const contactsRepo: any = {
      manager: {
        query: jest.fn().mockImplementation(async () => {
          if (!queryResults.length) return [];
          return queryResults.shift();
        }),
      },
    };

    const clientsRepo: any = {};

    const service = new CustomersService(clientsRepo, contactsRepo);
    return { service, contactsRepo };
  };

  it('resolveClientForSupportContact deve considerar client_id direto e pivot contact_customers', async () => {
    const rawLinkedClientIds = [{ client_id: 'client-a' }, { client_id: 'client-b' }];
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
      { id: 'client-b', companyName: 'Empresa B', tradeName: null, cnpj: '22222222000122' },
    ];
    const { service, contactsRepo } = makeService([rawLinkedClientIds, linkedClients]);

    const result = await service.resolveClientForSupportContact('tenant-1', 'contact-1');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
    expect(contactsRepo.manager.query).toHaveBeenCalledTimes(2);
  });

  it('resolveClientForSupportIdentifier deve retornar multiple quando o mesmo contato tem 1 vinculo direto e 1 via pivot', async () => {
    const rawLinkedClientIds = [{ client_id: 'client-a' }, { client_id: 'client-b' }];
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
      { id: 'client-b', companyName: 'Empresa B', tradeName: null, cnpj: '22222222000122' },
    ];
    const { service, contactsRepo } = makeService([rawLinkedClientIds, linkedClients]);

    jest.spyOn(service, 'findContactsByWhatsapp').mockResolvedValue([
      { id: 'contact-1' } as any,
    ]);

    const result = await service.resolveClientForSupportIdentifier('tenant-1', '5493412770676');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
    expect(contactsRepo.manager.query).toHaveBeenCalledTimes(2);
  });

  it('resolveClientForSupportIdentifier deve considerar todos os candidatos do mesmo LID tecnico', async () => {
    const rawLinkedClientIds = [{ client_id: 'client-a' }, { client_id: 'client-b' }];
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
      { id: 'client-b', companyName: 'Empresa B', tradeName: null, cnpj: '22222222000122' },
    ];
    const { service, contactsRepo } = makeService([rawLinkedClientIds, linkedClients]);

    jest.spyOn(service, 'resolveCanonicalWhatsappContact').mockResolvedValue({
      contact: { id: 'contact-primary' } as any,
      matchedBy: 'lid',
      normalizedWhatsapp: '131245778460786',
      lid: '131245778460786',
      candidates: ['contact-primary', 'contact-b', 'contact-c'],
      canonicalReason: 'matched-lid,is-primary,active,oldest',
    });

    const result = await service.resolveClientForSupportIdentifier('tenant-1', '131245778460786');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
    expect(contactsRepo.manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT DISTINCT links.client_id'),
      ['tenant-1', ['contact-primary', 'contact-b', 'contact-c']],
    );
    expect(contactsRepo.manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('SELECT DISTINCT'),
      ['tenant-1', ['contact-primary', 'contact-b', 'contact-c']],
    );
  });

  it('resolveClientForSupportIdentifier deve forcar multiple quando os vinculos brutos sao ambiguos mesmo com um unico cliente ativo resolvido', async () => {
    const rawLinkedClientIds = [{ client_id: 'client-a' }, { client_id: 'client-b' }];
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
    ];
    const { service } = makeService([rawLinkedClientIds, linkedClients]);

    jest.spyOn(service, 'resolveCanonicalWhatsappContact').mockResolvedValue({
      contact: { id: 'contact-primary' } as any,
      matchedBy: 'lid',
      normalizedWhatsapp: '131245778460786',
      lid: '131245778460786',
      candidates: ['contact-primary', 'contact-b'],
      canonicalReason: 'matched-lid,is-primary,active,oldest',
    });

    const result = await service.resolveClientForSupportIdentifier('tenant-1', '131245778460786');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
  });
});

describe('CustomersService updateContact', () => {
  it('deve retornar conflito amigavel quando outro contato ativo ja usa o mesmo whatsapp', async () => {
    const contactsRepo: any = {
      findOne: jest.fn().mockResolvedValue({
        id: 'contact-a',
        tenantId: 'tenant-1',
        email: 'edson@demo.com',
        metadata: {},
      }),
      update: jest.fn(),
      manager: {
        query: jest.fn().mockResolvedValue([{ id: 'contact-b' }]),
      },
    };

    const service = new CustomersService({} as any, contactsRepo);

    await expect(
      service.updateContact('tenant-1', 'contact-a', {
        whatsapp: '5573981168008',
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(contactsRepo.update).not.toHaveBeenCalled();
  });
});
