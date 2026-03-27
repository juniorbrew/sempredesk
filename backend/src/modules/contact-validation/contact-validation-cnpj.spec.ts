import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ContactValidationService, LinkByCnpjResult } from './contact-validation.service';
import { Ticket } from '../tickets/entities/ticket.entity';
import { Contact } from '../customers/entities/customer.entity';
import { Client } from '../customers/entities/customer.entity';
import { ContactCustomer } from './entities/contact-customer.entity';
import { CustomersService } from '../customers/customers.service';

// ── CNPJs de teste ────────────────────────────────────────────────────────────
const CNPJ_VALIDO = '11444777000161';          // 11.444.777/0001-61 → válido
const CNPJ_VALIDO_FORMATADO = '11.444.777/0001-61';
const CNPJ_INVALIDO = '11444777000162';        // dígito verificador errado
const CNPJ_INVALIDO_FORMATADO = '11.444.777/0001-62';

// ── Mocks base ────────────────────────────────────────────────────────────────

const mockTicket = {
  id: 'ticket-uuid-001',
  tenantId: 'tenant-001',
  contactId: 'contact-uuid-001',
  clientId: null,
  customerSelectedAt: null,
  unlinkedContact: false,
};

const mockContact = {
  id: 'contact-uuid-001',
  tenantId: 'tenant-001',
  clientId: null,
  name: 'João Teste',
};

const mockClienteUnico = {
  id: 'client-uuid-001',
  companyName: 'Empresa Teste Ltda',
  tradeName: 'Empresa Teste',
  cnpj: '11.444.777/0001-61',
  city: 'São Paulo',
  state: 'SP',
};

const mockClienteA = {
  id: 'client-uuid-002',
  companyName: 'Empresa A Ltda',
  tradeName: 'Empresa A',
  cnpj: '11.444.777/0001-61',
  city: 'São Paulo',
  state: 'SP',
};

const mockClienteB = {
  id: 'client-uuid-003',
  companyName: 'Empresa B Ltda',
  tradeName: 'Empresa B',
  cnpj: '11.444.777/0002-42',
  city: 'Rio de Janeiro',
  state: 'RJ',
};

// ── Factory do módulo de teste ────────────────────────────────────────────────

async function buildModule(overrides: {
  searchByNameOrCnpj?: jest.Mock;
  findClientsByCnpjRoot?: jest.Mock;
  storePendingCnpj?: jest.Mock;
  linkContactToCustomer?: jest.Mock;
  ticketFindOne?: jest.Mock;
}) {
  const ticketRepo = {
    findOne: overrides.ticketFindOne ?? jest.fn().mockResolvedValue(mockTicket),
    manager: {
      query: jest.fn(),
      transaction: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    },
  };

  const contactRepo = { findOne: jest.fn().mockResolvedValue(mockContact) };
  const clientRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const contactCustomerRepo = { findOne: jest.fn() };

  const customersServiceMock: Partial<CustomersService> = {
    searchByNameOrCnpj: overrides.searchByNameOrCnpj ?? jest.fn().mockResolvedValue([]),
    findClientsByCnpjRoot: overrides.findClientsByCnpjRoot ?? jest.fn().mockResolvedValue([]),
    storePendingCnpj: overrides.storePendingCnpj ?? jest.fn().mockResolvedValue(undefined),
    linkContactToClient: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ContactValidationService,
      { provide: getRepositoryToken(Ticket), useValue: ticketRepo },
      { provide: getRepositoryToken(Contact), useValue: contactRepo },
      { provide: getRepositoryToken(Client), useValue: clientRepo },
      { provide: getRepositoryToken(ContactCustomer), useValue: contactCustomerRepo },
      { provide: CustomersService, useValue: customersServiceMock },
    ],
  }).compile();

  const service = module.get<ContactValidationService>(ContactValidationService);

  // Sobrescreve linkContactToCustomer se fornecido
  if (overrides.linkContactToCustomer) {
    (service as any).linkContactToCustomer = overrides.linkContactToCustomer;
  } else {
    (service as any).linkContactToCustomer = jest.fn().mockResolvedValue({
      ticketId: mockTicket.id,
      clientId: mockClienteUnico.id,
      contactCustomerId: 'cc-uuid-001',
    });
  }

  return { service, customersServiceMock };
}

// ── Testes ─────────────────────────────────────────────────────────────────────

describe('ContactValidationService.linkContactByCnpj', () => {
  it('deve retornar invalid_cnpj para CNPJ com dígito verificador errado', async () => {
    const { service } = await buildModule({});

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_INVALIDO,
      'agent-001',
    );

    expect(result.status).toBe('invalid_cnpj');
  });

  it('deve retornar invalid_cnpj para CNPJ formatado inválido', async () => {
    const { service } = await buildModule({});

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_INVALIDO_FORMATADO,
      'agent-001',
    );

    expect(result.status).toBe('invalid_cnpj');
  });

  it('deve retornar invalid_cnpj para string vazia', async () => {
    const { service } = await buildModule({});

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      '',
      'agent-001',
    );

    expect(result.status).toBe('invalid_cnpj');
  });

  it('deve retornar linked quando exatamente 1 cliente corresponde ao CNPJ', async () => {
    const linkContactToCustomerMock = jest.fn().mockResolvedValue({
      ticketId: mockTicket.id,
      clientId: mockClienteUnico.id,
      contactCustomerId: 'cc-uuid-001',
    });

    const { service } = await buildModule({
      searchByNameOrCnpj: jest.fn().mockResolvedValue([mockClienteUnico]),
      linkContactToCustomer: linkContactToCustomerMock,
    });

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_VALIDO_FORMATADO,
      'agent-001',
    );

    expect(result.status).toBe('linked');
    expect(result.clientId).toBe(mockClienteUnico.id);
    expect(linkContactToCustomerMock).toHaveBeenCalledWith(
      'tenant-001',
      'ticket-uuid-001',
      mockClienteUnico.id,
      'agent-001',
    );
  });

  it('deve retornar multiple_matches quando múltiplos clientes têm o mesmo CNPJ exato', async () => {
    const { service } = await buildModule({
      // Ambos retornam o mesmo CNPJ normalizado
      searchByNameOrCnpj: jest.fn().mockResolvedValue([mockClienteA, mockClienteB]),
    });

    // Para ter múltiplos matches exatos, ambos precisam ter o mesmo CNPJ normalizado
    // Ajustamos mockClienteB temporariamente para ter o mesmo CNPJ
    const clienteB_mesmoCnpj = { ...mockClienteB, cnpj: CNPJ_VALIDO_FORMATADO };
    const { service: service2 } = await buildModule({
      searchByNameOrCnpj: jest.fn().mockResolvedValue([mockClienteA, clienteB_mesmoCnpj]),
    });

    const result: LinkByCnpjResult = await service2.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_VALIDO_FORMATADO,
      'agent-001',
    );

    expect(result.status).toBe('multiple_matches');
    expect(result.candidates).toBeDefined();
    expect(result.candidates!.length).toBe(2);
  });

  it('deve retornar multiple_matches via raiz quando nenhum match exato mas há candidatos por raiz', async () => {
    const candidatosPorRaiz = [
      { id: 'client-uuid-002', companyName: 'Empresa A', tradeName: 'A', cnpj: '11.444.777/0001-61' },
      { id: 'client-uuid-003', companyName: 'Empresa B', tradeName: 'B', cnpj: '11.444.777/0002-42' },
    ];

    const { service } = await buildModule({
      // searchByNameOrCnpj retorna clientes mas nenhum com CNPJ exato
      searchByNameOrCnpj: jest.fn().mockResolvedValue([
        { ...mockClienteUnico, cnpj: '99.999.999/0001-00' },
      ]),
      findClientsByCnpjRoot: jest.fn().mockResolvedValue(candidatosPorRaiz),
    });

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_VALIDO,
      'agent-001',
    );

    expect(result.status).toBe('multiple_matches');
    expect(result.candidates).toEqual(candidatosPorRaiz);
  });

  it('deve retornar not_found e salvar CNPJ pendente quando nenhum cliente é encontrado', async () => {
    const storePendingCnpjMock = jest.fn().mockResolvedValue(undefined);

    const { service } = await buildModule({
      searchByNameOrCnpj: jest.fn().mockResolvedValue([]),
      findClientsByCnpjRoot: jest.fn().mockResolvedValue([]),
      storePendingCnpj: storePendingCnpjMock,
    });

    const result: LinkByCnpjResult = await service.linkContactByCnpj(
      'tenant-001',
      'ticket-uuid-001',
      CNPJ_VALIDO_FORMATADO,
      'agent-001',
    );

    expect(result.status).toBe('not_found');
    expect(storePendingCnpjMock).toHaveBeenCalledWith(
      'tenant-001',
      mockTicket.contactId,
      CNPJ_VALIDO,
    );
  });
});
