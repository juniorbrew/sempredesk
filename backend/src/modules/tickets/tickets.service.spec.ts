import { BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';
import { TicketsService } from './tickets.service';
import { TicketClassificationHelper } from './ticket-classification.helper';
import { TicketPriority, TicketStatus } from './entities/ticket.entity';
import { SlaPriority } from '../sla/entities/sla-policy.entity';

describe('TicketsService.assertContactBelongsToTenant', () => {
  function criarServico(query: jest.Mock) {
    return new TicketsService(
      { manager: { query } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findBestPolicy: jest.fn().mockResolvedValue(null) } as any,
      {} as any, // classificationHelper
    );
  }

  it('aceita contato vinculado ao cliente pelo pivot contact_customers', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: 'contact-1',
        contact_client_id: 'client-origem',
        contact_network_id: null,
        target_network_id: null,
        linked_to_target: true,
      },
    ]);

    const service = criarServico(query);

    await expect(
      (service as any).assertContactBelongsToTenant('tenant-1', 'client-destino', 'contact-1'),
    ).resolves.toBeUndefined();
  });

  it('mantém bloqueio quando contato não pertence ao cliente, ao pivot nem à mesma rede', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'contact-1',
          contact_client_id: 'client-origem',
          contact_network_id: 'network-a',
          target_network_id: 'network-b',
          linked_to_target: false,
        },
      ])
      .mockResolvedValueOnce([]);

    const service = criarServico(query);

    await expect(
      (service as any).assertContactBelongsToTenant('tenant-1', 'client-destino', 'contact-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TicketsService.countOpenTicketsAssignedToAgent', () => {
  function servicoComCount(mockCount: jest.Mock) {
    return new TicketsService(
      { count: mockCount } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findBestPolicy: jest.fn().mockResolvedValue(null) } as any,
      {} as any, // classificationHelper
    );
  }

  it('delega ao repositório com tenant, assignedTo e status em aberto', async () => {
    const count = jest.fn().mockResolvedValue(4);
    const service = servicoComCount(count);
    const n = await service.countOpenTicketsAssignedToAgent('tenant-t1', 'agent-a1');
    expect(n).toBe(4);
    expect(count).toHaveBeenCalledTimes(1);
    const opts = count.mock.calls[0][0];
    expect(opts.where.tenantId).toBe('tenant-t1');
    expect(opts.where.assignedTo).toBe('agent-a1');
    expect(opts.where.status).toEqual(
      In([TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CLIENT]),
    );
  });
});

describe('TicketsService SLA', () => {
  function criarServicoComSla(slaService: {
    resolvePolicyForTicket?: jest.Mock;
    findBestPolicy?: jest.Mock;
    calcDeadlines: jest.Mock;
    reapplyConversationPolicy?: jest.Mock;
    applyConversationSlaFromTenantPriorityId?: jest.Mock;
  }, tenantPriorityRepo?: { findOne: jest.Mock }) {
    const managerQuery = jest.fn().mockResolvedValue(undefined);
    return new TicketsService(
      { save: jest.fn(), manager: { query: managerQuery } } as any,
      {} as any,
      {} as any,
      tenantPriorityRepo ?? { findOne: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      slaService as any,
      {} as any, // classificationHelper
    );
  }

  it('recalcula deadlines quando a prioridade do ticket muda', async () => {
    const createdAt = new Date('2026-04-11T10:00:00.000Z');
    const firstResponseDeadline = new Date('2026-04-11T11:30:00.000Z');
    const resolutionDeadline = new Date('2026-04-11T18:00:00.000Z');
    const resolvePolicyForTicket = jest.fn().mockResolvedValue({
      id: 'policy-high',
      priority: SlaPriority.HIGH,
      firstResponseMinutes: 90,
      resolutionMinutes: 480,
    });
    const calcDeadlines = jest.fn().mockReturnValue({
      firstResponseDeadline,
      resolutionDeadline,
    });
    const service = criarServicoComSla({ resolvePolicyForTicket, calcDeadlines });
    const ticket = {
      tenantId: 'tenant-1',
      priority: TicketPriority.HIGH,
      priorityId: null,
      createdAt,
      slaResponseAt: null,
      slaResolveAt: null,
    } as any;

    await (service as any).applyConfiguredSlaToTicket(ticket);

    expect(resolvePolicyForTicket).toHaveBeenCalledWith('tenant-1', null, SlaPriority.HIGH);
    expect(calcDeadlines).toHaveBeenCalledWith(
      expect.objectContaining({
        firstResponseMinutes: 90,
        resolutionMinutes: 480,
      }),
      createdAt,
    );
    expect(ticket.slaResponseAt).toBe(firstResponseDeadline);
    expect(ticket.slaResolveAt).toBe(resolutionDeadline);
  });

  it('limpa deadlines quando não existe policy para a prioridade atual', async () => {
    const service = criarServicoComSla({
      resolvePolicyForTicket: jest.fn().mockResolvedValue(null),
      calcDeadlines: jest.fn(),
    });
    const ticket = {
      tenantId: 'tenant-1',
      priority: TicketPriority.MEDIUM,
      priorityId: null,
      createdAt: new Date('2026-04-11T10:00:00.000Z'),
      slaResponseAt: new Date('2026-04-11T11:00:00.000Z'),
      slaResolveAt: new Date('2026-04-11T18:00:00.000Z'),
    } as any;

    await (service as any).applyConfiguredSlaToTicket(ticket);

    expect(ticket.slaResponseAt).toBeNull();
    expect(ticket.slaResolveAt).toBeNull();
  });

  it('sincroniza a conversa vinculada com a policy derivada da prioridade legada do ticket', async () => {
    const reapplyConversationPolicy = jest.fn().mockResolvedValue(undefined);
    const applyConversationSlaFromTenantPriorityId = jest.fn().mockResolvedValue(undefined);
    const service = criarServicoComSla({
      findBestPolicy: jest.fn(),
      calcDeadlines: jest.fn(),
      reapplyConversationPolicy,
      applyConversationSlaFromTenantPriorityId,
    });

    await (service as any).syncConversationSlaWithTicket({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      priority: TicketPriority.CRITICAL,
      priorityId: null,
    });

    expect(reapplyConversationPolicy).toHaveBeenCalledWith(
      'tenant-1',
      'conv-1',
      SlaPriority.CRITICAL,
    );
    expect(applyConversationSlaFromTenantPriorityId).not.toHaveBeenCalled();
  });

  it('sincroniza conversa via tenant_priorities quando o ticket tem priority_id', async () => {
    const reapplyConversationPolicy = jest.fn().mockResolvedValue(undefined);
    const applyConversationSlaFromTenantPriorityId = jest.fn().mockResolvedValue(undefined);
    const service = criarServicoComSla({
      findBestPolicy: jest.fn(),
      calcDeadlines: jest.fn(),
      reapplyConversationPolicy,
      applyConversationSlaFromTenantPriorityId,
    });

    await (service as any).syncConversationSlaWithTicket({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      priority: TicketPriority.HIGH,
      priorityId: 'tp-uuid-1',
    });

    expect(applyConversationSlaFromTenantPriorityId).toHaveBeenCalledWith(
      'tenant-1',
      'conv-1',
      'tp-uuid-1',
    );
    expect(reapplyConversationPolicy).not.toHaveBeenCalled();
  });

  it('resolve prioridade herdada pela classificacao com precedencia da mais especifica', async () => {
    const ticketSettingsService = {
      resolveDefaultPriorityIdForClassification: jest.fn().mockResolvedValue('priority-sub'),
    };
    const helper = new TicketClassificationHelper(
      { createQueryBuilder: jest.fn(), query: jest.fn() } as any,
      ticketSettingsService as any,
    );

    await expect(
      (helper as any).resolveInheritedPriorityIdForClassification('tenant-1', {
        department: 'Pista',
        category: 'Erro ao entrar',
        subcategory: 'Senha',
      }),
    ).resolves.toBe('priority-sub');
  });
});
