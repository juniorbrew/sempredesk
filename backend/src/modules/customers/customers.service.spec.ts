import { CustomersService } from './customers.service';

describe('CustomersService multiempresa resolution', () => {
  const makeService = (queryResult: any[] = []) => {
    const contactsRepo: any = {
      manager: {
        query: jest.fn().mockResolvedValue(queryResult),
      },
    };

    const clientsRepo: any = {};

    const service = new CustomersService(clientsRepo, contactsRepo);
    return { service, contactsRepo };
  };

  it('resolveClientForSupportContact deve considerar client_id direto e pivot contact_customers', async () => {
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
      { id: 'client-b', companyName: 'Empresa B', tradeName: null, cnpj: '22222222000122' },
    ];
    const { service, contactsRepo } = makeService(linkedClients);

    const result = await service.resolveClientForSupportContact('tenant-1', 'contact-1');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
    expect(contactsRepo.manager.query).toHaveBeenCalledTimes(1);
  });

  it('resolveClientForSupportIdentifier deve retornar multiple quando o mesmo contato tem 1 vínculo direto e 1 via pivot', async () => {
    const linkedClients = [
      { id: 'client-a', companyName: 'Empresa A', tradeName: null, cnpj: '11111111000111' },
      { id: 'client-b', companyName: 'Empresa B', tradeName: null, cnpj: '22222222000122' },
    ];
    const { service, contactsRepo } = makeService(linkedClients);

    jest.spyOn(service, 'findContactsByWhatsapp').mockResolvedValue([
      { id: 'contact-1' } as any,
    ]);

    const result = await service.resolveClientForSupportIdentifier('tenant-1', '5493412770676');

    expect(result).toEqual({ mode: 'multiple', clients: linkedClients });
    expect(contactsRepo.manager.query).toHaveBeenCalledTimes(1);
  });
});
