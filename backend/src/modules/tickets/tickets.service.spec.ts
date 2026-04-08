import { BadRequestException } from '@nestjs/common';
import { In } from 'typeorm';
import { TicketsService } from './tickets.service';
import { TicketStatus } from './entities/ticket.entity';

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
