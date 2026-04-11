import { ConversationsService } from './conversations.service';

describe('ConversationsService schema compatibility', () => {
  it('garante colunas de midia em conversation_messages apenas quando faltarem', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ column_name: 'media_kind' }])
        .mockResolvedValueOnce(undefined),
    };

    const service = new ConversationsService(
      {} as any,
      {} as any,
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).ensureConversationMessageMediaSchemaReady();

    expect(dataSource.query).toHaveBeenCalledTimes(3);
    expect(String(dataSource.query.mock.calls[0][0])).toContain('information_schema.columns');
    expect(String(dataSource.query.mock.calls[1][0])).toContain('ALTER TABLE conversation_messages');
    expect(String(dataSource.query.mock.calls[2][0])).toContain('idx_conv_messages_reply_to');
  });

  it('nao executa alter table quando schema ja estiver completo', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        { column_name: 'media_kind' },
        { column_name: 'media_storage_key' },
        { column_name: 'media_mime' },
        { column_name: 'external_id' },
        { column_name: 'whatsapp_status' },
        { column_name: 'reply_to_id' },
      ]),
    };

    const service = new ConversationsService(
      {} as any,
      {} as any,
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await (service as any).ensureConversationMessageMediaSchemaReady();

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(String(dataSource.query.mock.calls[0][0])).toContain('information_schema.columns');
  });
});
