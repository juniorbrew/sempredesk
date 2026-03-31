import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  function createGateway() {
    const emitter = {
      setServer: jest.fn(),
      emitPresence: jest.fn(),
    } as any;

    const presence = {
      getOnlineIdsAndStatus: jest.fn().mockResolvedValue({ onlineIds: [], statusMap: {} }),
      getTenantIdsAsync: jest.fn().mockResolvedValue([]),
      add: jest.fn(),
      remove: jest.fn(),
      getSocketInfo: jest.fn(),
      heartbeatAsync: jest.fn(),
      setStatusAsync: jest.fn(),
    } as any;

    const ticketViewers = {
      addViewer: jest.fn().mockResolvedValue([]),
      removeViewer: jest.fn().mockResolvedValue([]),
      removeUserFromTickets: jest.fn().mockResolvedValue([]),
    } as any;

    const gateway = new RealtimeGateway(emitter, presence, ticketViewers);
    return { gateway, emitter, presence, ticketViewers };
  }

  it('troca o socket de empresa removendo a sala anterior', async () => {
    const { gateway, emitter, presence } = createGateway();
    const client = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as any;

    presence.getSocketInfo
      .mockReturnValueOnce({ tenantId: 'tenant-antigo', userId: 'user-1' })
      .mockReturnValueOnce({ tenantId: 'tenant-novo', userId: 'user-1' });

    await gateway.handleJoinTenant(client, {
      tenantId: 'tenant-novo',
      userId: 'user-1',
      userName: 'Usuário',
      userEmail: 'user@empresa.com',
      userRole: 'agent',
    });

    expect(client.leave).toHaveBeenCalledWith('tenant:tenant-antigo');
    expect(client.join).toHaveBeenCalledWith('tenant:tenant-novo');
    expect(presence.remove).toHaveBeenCalledWith('socket-1');
    expect(presence.add).toHaveBeenCalledWith('tenant-novo', 'user-1', 'socket-1');
    expect(emitter.emitPresence).toHaveBeenCalledWith('tenant-antigo', [], {});
    expect(emitter.emitPresence).toHaveBeenCalledWith('tenant-novo', [], {});
  });

  it('ignora leave antigo depois da troca de empresa', async () => {
    const { gateway, presence } = createGateway();
    const client = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    } as any;

    presence.getSocketInfo.mockReturnValue({ tenantId: 'tenant-novo', userId: 'user-1' });

    await gateway.handleLeaveTenant(client, {
      tenantId: 'tenant-antigo',
      userId: 'user-1',
    });

    expect(client.leave).not.toHaveBeenCalled();
    expect(presence.remove).not.toHaveBeenCalled();
  });
});
