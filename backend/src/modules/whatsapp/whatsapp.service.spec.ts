import { WhatsappService } from './whatsapp.service';

describe('WhatsappService LID handoff fallback', () => {
  it('deve materializar contato canônico quando houver LID técnico, clientId confiável e resolvedDigits', async () => {
    const customersService: any = {
      resolveCanonicalWhatsappContact: jest
        .fn()
        .mockResolvedValueOnce({
          contact: null,
          matchedBy: 'none',
          normalizedWhatsapp: '557799131959',
          lid: '194626526949611',
          candidates: [],
          canonicalReason: 'no-candidates,blocked-technical-only',
        }),
      findOrCreateByWhatsapp: jest.fn().mockResolvedValue({
        id: 'contact-1',
        name: 'Contato Novo',
        email: null,
        clientId: null,
        metadata: {},
      }),
      persistWhatsappLid: jest.fn().mockResolvedValue(undefined),
      persistWhatsappRuntimeIdentifiers: jest.fn().mockResolvedValue(undefined),
      linkContactToClient: jest.fn().mockResolvedValue(undefined),
    };

    const conversationsService: any = {
      getOrCreateForContact: jest.fn().mockResolvedValue({
        conversation: { id: 'conv-1' },
        ticket: { id: 'ticket-1' },
        ticketCreated: false,
      }),
      addMessage: jest.fn().mockResolvedValue(undefined),
    };

    const ticketsService: any = {
      markCustomerSelectedByCnpj: jest.fn().mockResolvedValue(undefined),
    };

    const service = new WhatsappService(
      {} as any,
      customersService,
      ticketsService,
      conversationsService,
      undefined as any,
      undefined as any,
      undefined as any,
      {} as any,
    );

    const result = await service.handleIncomingMessage(
      'tenant-1',
      {
        provider: 'generic',
        from: '194626526949611',
        text: 'Agora sim! Ficou show',
        senderName: 'Contato Novo',
        resolvedDigits: '557799131959',
      },
      'Suporte',
      'client-1',
    );

    // 1ª chamada: materialização com dígitos normalizados (restoreBrNinthDigit). 2ª: fallback LID.
    expect(customersService.findOrCreateByWhatsapp).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      '5577999131959',
      'Contato Novo',
      false,
      expect.objectContaining({
        clientId: 'client-1',
        direction: 'inbound',
        rawInput: '5577999131959',
      }),
    );
    expect(customersService.persistWhatsappRuntimeIdentifiers).toHaveBeenCalled();
    expect(customersService.linkContactToClient).toHaveBeenCalledWith('tenant-1', 'contact-1', 'client-1');
    expect(result).toEqual({ created: true, ticketId: 'ticket-1', conversationId: 'conv-1' });
  });
});
