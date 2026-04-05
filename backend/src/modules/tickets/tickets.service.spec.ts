import { BadRequestException } from '@nestjs/common';
import { TicketsService } from './tickets.service';

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
