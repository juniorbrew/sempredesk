import { ConflictException, BadRequestException } from '@nestjs/common';
import { TenantPrioritiesService } from './tenant-priorities.service';
import { SlaPolicy } from '../sla/entities/sla-policy.entity';

describe('TenantPrioritiesService', () => {
  const tenantId = 'tenant-1';

  function makeService(overrides: {
    exist?: boolean;
    slaPolicy?: SlaPolicy | null;
  }) {
    const repo = {
      exist: jest.fn().mockResolvedValue(overrides.exist ?? false),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: x.id || 'new-id' })),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    const slaRepo = {
      findOne: jest.fn().mockResolvedValue(overrides.slaPolicy ?? null),
    };
    const service = new TenantPrioritiesService(
      repo as any,
      slaRepo as any,
    );
    return { service, repo, slaRepo };
  }

  it('create lança ConflictException se slug já existe', async () => {
    const { service } = makeService({ exist: true });
    await expect(
      service.create(tenantId, {
        name: 'X',
        slug: 'dup',
        color: '#000',
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('create rejeita sla_policy_id de outro tenant', async () => {
    const { service } = makeService({ exist: false, slaPolicy: null });
    await expect(
      service.create(tenantId, {
        name: 'X',
        slug: 'nova',
        color: '#000',
        sortOrder: 0,
        slaPolicyId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findAllForTicketUi lista apenas prioridades ativas do tenant', async () => {
    const rows = [{ id: 'p1', tenantId, active: true, name: 'Alta', slug: 'high' }];
    const repo = {
      exist: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue(rows),
    };
    const slaRepo = { findOne: jest.fn() };
    const service = new TenantPrioritiesService(repo as any, slaRepo as any);
    const out = await service.findAllForTicketUi(tenantId);
    expect(out).toEqual(rows);
    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId, active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  });

  it('findAllForTicketUi inclui prioridade inativa quando é a currentPriorityId', async () => {
    const active = [{ id: 'p1', tenantId, active: true, name: 'Média', slug: 'medium' }];
    const inactive = { id: 'p-old', tenantId, active: false, name: 'VIP antigo', slug: 'vip' };
    const repo = {
      exist: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn().mockResolvedValue(active),
      findOne: jest.fn().mockResolvedValue(inactive),
    };
    const slaRepo = { findOne: jest.fn() };
    const service = new TenantPrioritiesService(repo as any, slaRepo as any);
    const out = await service.findAllForTicketUi(tenantId, 'p-old');
    expect(out).toEqual([...active, inactive]);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'p-old', tenantId } });
  });
});
