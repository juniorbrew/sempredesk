import { BadRequestException } from '@nestjs/common';
import { TicketsService } from './tickets.service';

describe('TicketsService.assertContactBelongsToTenant', () => {
  function buildService(rows: any[]) {
    const manager = {
      query: jest.fn().mockResolvedValue(rows),
    };

    const service = new TicketsService(
      { manager } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findBestPolicy: jest.fn().mockResolvedValue(null) } as any,
    );

    return { service };
  }

  it('aceita contato vinculado diretamente ao cliente', async () => {
    const { service } = buildService([
      {
        id: 'contact-1',
        contact_client_id: 'client-1',
        contact_network_id: null,
        target_network_id: null,
        linked_to_target: false,
      },
    ]);

    await expect(
      (service as any).assertContactBelongsToTenant('tenant-1', 'client-1', 'contact-1'),
    ).resolves.toBeUndefined();
  });

  it('aceita contato multiempresa vinculado via pivot contact_customers', async () => {
    const { service } = buildService([
      {
        id: 'contact-1',
        contact_client_id: 'client-principal',
        contact_network_id: null,
        target_network_id: null,
        linked_to_target: true,
      },
    ]);

    await expect(
      (service as any).assertContactBelongsToTenant('tenant-1', 'client-destino', 'contact-1'),
    ).resolves.toBeUndefined();
  });

  it('mantem bloqueio para contato sem vinculo com o cliente informado', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'contact-1',
            contact_client_id: 'client-outra',
            contact_network_id: 'network-a',
            target_network_id: 'network-b',
            linked_to_target: false,
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const service = new TicketsService(
      { manager } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findBestPolicy: jest.fn().mockResolvedValue(null) } as any,
    );

    await expect(
      (service as any).assertContactBelongsToTenant('tenant-1', 'client-destino', 'contact-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
