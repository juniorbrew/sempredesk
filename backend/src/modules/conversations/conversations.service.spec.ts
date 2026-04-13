import { ConversationsService } from './conversations.service';

describe('ConversationsService schema compatibility', () => {
  it('nao consulta nem altera schema em runtime ao carregar mensagens', async () => {
    const convRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'conv-1', tenantId: 'tenant-1' }),
    };
    const msgRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      query: jest.fn(),
      getRepository: jest.fn(),
    };

    const service = new ConversationsService(
      convRepo as any,
      msgRepo as any,
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await service.getMessages('tenant-1', 'conv-1');

    expect(convRepo.findOne).toHaveBeenCalledWith({ where: { id: 'conv-1', tenantId: 'tenant-1' } });
    expect(msgRepo.find).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', tenantId: 'tenant-1' },
      order: { createdAt: 'ASC' },
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
