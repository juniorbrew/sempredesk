import { RoutingRulesService } from './routing-rules.service';

describe('RoutingRulesService.applyRules', () => {
  const tenantId = 't1';

  function makeService(opts: {
    rules: any[];
    tenantSlug?: string | null;
  }) {
    const repo = {
      find: jest.fn().mockResolvedValue(opts.rules),
    };
    const tpRepo = {
      findOne: jest.fn().mockResolvedValue(
        opts.tenantSlug != null ? { slug: opts.tenantSlug } : null,
      ),
    };
    return new RoutingRulesService(repo as any, tpRepo as any);
  }

  it('condPriority casa com ticket.priority (legado)', async () => {
    const service = makeService({
      rules: [
        {
          condPriority: 'high',
          actionSetPriority: 'critical',
          active: true,
          priority: 0,
        },
      ],
    });
    const out = await service.applyRules(tenantId, {
      department: 'Suporte',
      category: null,
      priority: 'high',
      priorityId: null,
      origin: 'portal',
    });
    expect(out.priority).toBe('critical');
  });

  it('condPriority casa com slug da tenant_priority quando priority_id está preenchido', async () => {
    const service = makeService({
      rules: [
        {
          condPriority: 'vip',
          actionAssignTo: 'user-1',
          active: true,
          priority: 0,
        },
      ],
      tenantSlug: 'vip',
    });
    const out = await service.applyRules(tenantId, {
      department: 'Suporte',
      category: null,
      priority: 'medium',
      priorityId: 'tp-vip-uuid',
      origin: 'internal',
    });
    expect(out.assignTo).toBe('user-1');
  });

  it('não casa condPriority só com enum quando o ticket usa prioridade cadastrável (slug diferente)', async () => {
    const service = makeService({
      rules: [
        {
          condPriority: 'high',
          actionSetPriority: 'critical',
          active: true,
          priority: 0,
        },
      ],
      tenantSlug: 'vip',
    });
    const out = await service.applyRules(tenantId, {
      department: 'Suporte',
      category: null,
      priority: 'medium',
      priorityId: 'tp-vip-uuid',
      origin: 'portal',
    });
    expect(out.priority).toBeUndefined();
  });
});
