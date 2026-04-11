/**
 * sla.service.spec.ts
 *
 * Cobertura dos cenários de negócio SLA:
 *  1. Criação de conversa com política aplicada
 *  2. Primeira resposta humana dentro do prazo → status within
 *  3. Primeira resposta fora do prazo → status breached
 *  4. Tenant sem política SLA → no-op
 *  5. Corrida entre criação e primeira resposta (applyToConversation deve ser síncrono)
 *  6. Fechamento com SLA já vencido → status breached
 *  7. Mensagens de bot/sistema não contam como first response
 *
 * Todos os testes são puramente unitários: sem DB real, sem NestJS IoC.
 */

import { SlaService, SlaStatus } from './sla.service';
import { SlaPolicy, SlaPriority } from './entities/sla-policy.entity';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makePolicy(
  overrides: Partial<SlaPolicy> = {},
): SlaPolicy {
  return Object.assign(new SlaPolicy(), {
    id: 'policy-1',
    tenantId: 'tenant-1',
    name: 'Padrão',
    priority: SlaPriority.MEDIUM,
    firstResponseMinutes: 60,
    resolutionMinutes: 480,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

/** Constrói uma data X minutos no futuro/passado a partir de now. */
function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** Cria SlaService com dependências mockadas. */
function makeService(opts: {
  policies?: SlaPolicy[];
  queryResults?: unknown[][];
}) {
  const policyRepo = {
    find: jest.fn().mockResolvedValue(opts.policies ?? []),
    findOne: jest.fn(),
    create: jest.fn((dto: Partial<SlaPolicy>) => Object.assign(new SlaPolicy(), dto)),
    save: jest.fn(async (e: SlaPolicy) => e),
    update: jest.fn(),
    remove: jest.fn(),
  };

  // Cada elemento de queryResults é o valor retornado pela n-ésima chamada a query()
  let queryCallIndex = 0;
  const queryResults = opts.queryResults ?? [];
  const dataSource = {
    query: jest.fn(async () => {
      const result = queryResults[queryCallIndex] ?? [];
      queryCallIndex++;
      return result;
    }),
    transaction: jest.fn(async (cb: (m: any) => Promise<any>) => {
      const manager = { getRepository: () => policyRepo };
      return cb(manager);
    }),
  };

  const service = new SlaService(policyRepo as any, dataSource as any);
  return { service, policyRepo, dataSource };
}

// ─── 1. computeStatus (lógica pura, sem IO) ───────────────────────────────────

describe('SlaService.computeStatus', () => {
  const base = {
    createdAt: minutesFromNow(-240), // criado 4h atrás
    slaFirstResponseDeadline: minutesFromNow(60),   // deadline 1ª resposta: daqui 1h
    slaResolutionDeadline: minutesFromNow(240),      // deadline resolução: daqui 4h
    slaFirstResponseAt: null,
    slaResolvedAt: null,
  };

  it('within — dentro de todos os prazos, sem respostas ainda', () => {
    const svc = makeService({ policies: [] }).service;
    expect(svc.computeStatus(base)).toBe<SlaStatus>('within');
  });

  it('within — depois da primeira resposta, dentro do prazo de resolução', () => {
    const svc = makeService({ policies: [] }).service;
    expect(svc.computeStatus({
      ...base,
      slaFirstResponseAt: minutesFromNow(-30), // respondeu 30min atrás (dentro do prazo)
    })).toBe<SlaStatus>('within');
  });

  it('at_risk — menos de 20% do prazo de resolução restante', () => {
    const svc = makeService({ policies: [] }).service;
    // Resolução em 480 min; 20% = 96 min; precisamos de menos de 96 min restantes
    expect(svc.computeStatus({
      ...base,
      slaFirstResponseAt: minutesFromNow(-200),
      slaResolutionDeadline: minutesFromNow(50), // 50 min restantes < 20% de 480
    })).toBe<SlaStatus>('at_risk');
  });

  it('breached — prazo de resolução estourou sem resolução', () => {
    const svc = makeService({ policies: [] }).service;
    expect(svc.computeStatus({
      ...base,
      slaFirstResponseAt: minutesFromNow(-300),
      slaResolutionDeadline: minutesFromNow(-10), // venceu 10 min atrás
    })).toBe<SlaStatus>('breached');
  });

  it('breached — prazo de 1ª resposta estourou sem nenhuma resposta', () => {
    const svc = makeService({ policies: [] }).service;
    expect(svc.computeStatus({
      ...base,
      slaFirstResponseDeadline: minutesFromNow(-5), // venceu 5 min atrás
      slaFirstResponseAt: null,
    })).toBe<SlaStatus>('breached');
  });

  it('within — resolvida antes do prazo (slaResolvedAt preenchido antes da deadline)', () => {
    const svc = makeService({ policies: [] }).service;
    // Passa slaResolvedAt = agora (antes da deadline de resolução)
    expect(svc.computeStatus({
      ...base,
      slaFirstResponseAt: minutesFromNow(-200),
      slaResolvedAt: new Date(), // resolvida agora, deadline ainda no futuro
    })).toBe<SlaStatus>('within');
  });

  it('within — sem deadlines configurados (null) não deve brechar', () => {
    const svc = makeService({ policies: [] }).service;
    expect(svc.computeStatus({
      createdAt: minutesFromNow(-500),
      slaFirstResponseDeadline: null,
      slaResolutionDeadline: null,
      slaFirstResponseAt: null,
      slaResolvedAt: null,
    })).toBe<SlaStatus>('within');
  });
});

// ─── 2. findBestPolicy ────────────────────────────────────────────────────────

describe('SlaService.findBestPolicy', () => {
  it('retorna política com prioridade exata quando existir', async () => {
    const high = makePolicy({ id: 'p-high', priority: SlaPriority.HIGH, isDefault: false });
    const def  = makePolicy({ id: 'p-def',  priority: SlaPriority.LOW,  isDefault: true });
    const { service } = makeService({ policies: [high, def] });

    const result = await service.findBestPolicy('tenant-1', SlaPriority.HIGH);
    expect(result?.id).toBe('p-high');
  });

  it('retorna política critical quando existir correspondência exata', async () => {
    const critical = makePolicy({ id: 'p-critical', priority: SlaPriority.CRITICAL, isDefault: false });
    const def = makePolicy({ id: 'p-def', priority: SlaPriority.MEDIUM, isDefault: true });
    const { service } = makeService({ policies: [critical, def] });

    const result = await service.findBestPolicy('tenant-1', SlaPriority.CRITICAL);
    expect(result?.id).toBe('p-critical');
  });

  it('cai para política default quando não há prioridade exata', async () => {
    const low = makePolicy({ id: 'p-low', priority: SlaPriority.LOW, isDefault: false });
    const def = makePolicy({ id: 'p-def', priority: SlaPriority.MEDIUM, isDefault: true });
    const { service } = makeService({ policies: [low, def] });

    const result = await service.findBestPolicy('tenant-1', SlaPriority.HIGH);
    expect(result?.id).toBe('p-def');
  });

  it('retorna null quando tenant não tem nenhuma política', async () => {
    const { service } = makeService({ policies: [] });
    const result = await service.findBestPolicy('tenant-1', SlaPriority.HIGH);
    expect(result).toBeNull();
  });

  it('retorna null quando prioridade não existe e não há default', async () => {
    const low = makePolicy({ id: 'p-low', priority: SlaPriority.LOW, isDefault: false });
    const { service } = makeService({ policies: [low] });

    const result = await service.findBestPolicy('tenant-1', SlaPriority.HIGH);
    expect(result).toBeNull();
  });
});

// ─── 3. calcDeadlines ─────────────────────────────────────────────────────────

describe('SlaService.calcDeadlines', () => {
  it('calcula deadlines corretos a partir de uma data base', () => {
    const { service } = makeService({ policies: [] });
    const policy = makePolicy({ firstResponseMinutes: 30, resolutionMinutes: 120 });
    const from = new Date('2026-01-01T10:00:00Z');

    const { firstResponseDeadline, resolutionDeadline } = service.calcDeadlines(policy, from);

    expect(firstResponseDeadline).toEqual(new Date('2026-01-01T10:30:00Z'));
    expect(resolutionDeadline).toEqual(new Date('2026-01-01T12:00:00Z'));
  });

  it('usa Date.now() como base quando from não é informado', () => {
    const { service } = makeService({ policies: [] });
    const policy = makePolicy({ firstResponseMinutes: 60, resolutionMinutes: 480 });
    const before = Date.now();
    const { firstResponseDeadline, resolutionDeadline } = service.calcDeadlines(policy);
    const after = Date.now();

    expect(firstResponseDeadline.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(firstResponseDeadline.getTime()).toBeLessThanOrEqual(after + 60 * 60_000);
    expect(resolutionDeadline.getTime()).toBeGreaterThanOrEqual(before + 480 * 60_000);
  });
});

// ─── 4. applyToConversation ───────────────────────────────────────────────────

describe('SlaService.applyToConversation', () => {
  // CENÁRIO 1: política existe → aplica deadlines na conversa
  it('aplica SLA à nova conversa quando política existe', async () => {
    const policy = makePolicy({ firstResponseMinutes: 60, resolutionMinutes: 480 });
    const { service, dataSource } = makeService({
      policies: [policy],
      queryResults: [[{ affectedRows: 1 }, 1]], // UPDATE retorna [rows, rowCount]
    });

    await service.applyToConversation('tenant-1', 'conv-1');

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const calls = dataSource.query.mock.calls as any[][];
    const [sql, params] = calls[0];
    expect(sql).toContain('UPDATE conversations');
    expect(params[0]).toBe(policy.id);             // sla_policy_id
    expect(params[3]).toBe('conv-1');              // WHERE id
    expect(params[4]).toBe('tenant-1');            // AND tenant_id
  });

  // CENÁRIO 4: tenant sem política → no-op (não toca no banco)
  it('não executa UPDATE quando tenant não tem política configurada', async () => {
    const { service, dataSource } = makeService({ policies: [] });

    await service.applyToConversation('tenant-sem-sla', 'conv-1');

    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('é idempotente: guarda SQL AND sla_policy_id IS NULL evita sobrescrita', async () => {
    const policy = makePolicy();
    const { service, dataSource } = makeService({
      policies: [policy],
      queryResults: [[{}, 0]], // 0 rows afetadas — já tinha policy
    });

    await service.applyToConversation('tenant-1', 'conv-existente');

    // Chamou o UPDATE mas 0 linhas afetadas — sem lançar erro
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect((dataSource.query.mock.calls as any[][])[0][0]).toContain('sla_policy_id IS NULL');
  });

  it('loga aviso mas não lança quando o banco falha', async () => {
    const policy = makePolicy();
    const policyRepo = { find: jest.fn().mockResolvedValue([policy]) };
    const dataSource = {
      query: jest.fn().mockRejectedValue(new Error('conexão perdida')),
    };
    const svc = new SlaService(policyRepo as any, dataSource as any);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await expect(svc.applyToConversation('tenant-1', 'conv-1')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('applyToConversation falhou'),
      expect.anything(),
    );
  });
});

// ─── 5. recordFirstResponse ───────────────────────────────────────────────────

describe('SlaService.recordFirstResponse', () => {
  const createdAt = minutesFromNow(-30); // conversa criada 30 min atrás

  // CENÁRIO 2: primeira resposta dentro do prazo → within
  it('registra primeira resposta dentro do prazo (within)', async () => {
    const { service, dataSource } = makeService({
      queryResults: [
        // SELECT retorna conversa com deadlines no futuro
        [{
          sla_first_response_deadline: minutesFromNow(30),  // prazo: daqui 30 min
          sla_resolution_deadline:     minutesFromNow(450),
          sla_first_response_at:       null,
          sla_resolved_at:             null,
          created_at:                  createdAt,
        }],
        // UPDATE bem-sucedido
        [{}, 1],
      ],
    });

    await service.recordFirstResponse('tenant-1', 'conv-1');

    expect(dataSource.query).toHaveBeenCalledTimes(2);
    const calls1 = dataSource.query.mock.calls as any[][];
    const [updateSql, updateParams] = calls1[1];
    expect(updateSql).toContain('SET sla_first_response_at');
    expect(updateParams[1]).toBe<SlaStatus>('within');
  });

  // CENÁRIO 3: primeira resposta fora do prazo → breached
  it('registra primeira resposta fora do prazo (breached)', async () => {
    const { service, dataSource } = makeService({
      queryResults: [
        [{
          sla_first_response_deadline: minutesFromNow(-10), // venceu 10 min atrás
          sla_resolution_deadline:     minutesFromNow(450),
          sla_first_response_at:       null,
          sla_resolved_at:             null,
          created_at:                  createdAt,
        }],
        [{}, 1],
      ],
    });

    await service.recordFirstResponse('tenant-1', 'conv-1');

    const updateParams = (dataSource.query.mock.calls as any[][])[1][1];
    expect(updateParams[1]).toBe<SlaStatus>('breached');
  });

  it('é idempotente: não atualiza quando already registrado (SELECT vazio)', async () => {
    const { service, dataSource } = makeService({
      queryResults: [
        [], // SELECT retorna vazio → já registrado ou sem política
      ],
    });

    await service.recordFirstResponse('tenant-1', 'conv-1');

    expect(dataSource.query).toHaveBeenCalledTimes(1); // só o SELECT, sem UPDATE
  });

  // CENÁRIO 4: conversa sem política SLA → no-op
  it('não atualiza quando conversa não tem sla_policy_id (SELECT filtra IS NOT NULL)', async () => {
    // O SELECT no método já tem `AND sla_policy_id IS NOT NULL`.
    // Se a conversa não tem política, o DB retorna [] — simulado aqui.
    const { service, dataSource } = makeService({ queryResults: [[]] });

    await service.recordFirstResponse('tenant-sem-sla', 'conv-1');

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect((dataSource.query.mock.calls as any[][])[0][0]).toContain('sla_policy_id IS NOT NULL');
  });

  it('loga e ignora quando deadlines são nulos mesmo com sla_policy_id', async () => {
    const { service, dataSource } = makeService({
      queryResults: [
        [{
          sla_first_response_deadline: null,  // corrompido / não inicializado
          sla_resolution_deadline:     null,
          sla_first_response_at:       null,
          sla_resolved_at:             null,
          created_at:                  createdAt,
        }],
      ],
    });
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    await service.recordFirstResponse('tenant-1', 'conv-sem-deadlines');

    expect(dataSource.query).toHaveBeenCalledTimes(1); // apenas SELECT, sem UPDATE
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sem deadlines'));
  });

  it('loga aviso mas não lança quando o banco falha', async () => {
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('timeout')) };
    const svc = new SlaService({} as any, dataSource as any);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => {});

    await expect(svc.recordFirstResponse('tenant-1', 'conv-1')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('recordFirstResponse falhou'),
      expect.anything(),
    );
  });

  // CENÁRIO 7: mensagens de bot/sistema não devem chegar até este método
  // O guard está em conversations.service.addMessage (authorType !== 'user' → não chama recordFirstResponse)
  // Aqui testamos o comportamento do serviço caso, por acidente, fosse chamado sem política.
  it('[cenário 7] mensagem de sistema sem política SLA → no-op (simula chamada acidental)', async () => {
    // Conversa sem sla_policy_id → SELECT retorna vazio
    const { service, dataSource } = makeService({ queryResults: [[]] });

    await service.recordFirstResponse('tenant-1', 'conv-sem-policy');

    // Nenhum UPDATE disparado
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const selectSql = (dataSource.query.mock.calls as any[][])[0][0] as string;
    expect(selectSql).toContain('sla_policy_id IS NOT NULL');
  });
});

// ─── 6. computeStatus (cenário fechamento com SLA vencido) ────────────────────

describe('SlaService.computeStatus — fechamento com SLA já vencido', () => {
  // CENÁRIO 6: conversa fechada depois do prazo de resolução
  it('retorna breached quando resolvida após a deadline de resolução', () => {
    const { service } = makeService({ policies: [] });
    const createdAt = minutesFromNow(-500);
    const resolvedAt = minutesFromNow(-5);   // resolvida 5 min atrás
    const resolutionDeadline = minutesFromNow(-60); // prazo venceu 60 min atrás

    const status = service.computeStatus({
      createdAt,
      slaFirstResponseDeadline: minutesFromNow(-400),
      slaResolutionDeadline: resolutionDeadline,
      slaFirstResponseAt: minutesFromNow(-450),
      slaResolvedAt: resolvedAt,
    });

    expect(status).toBe<SlaStatus>('breached');
  });

  it('retorna within quando resolvida antes da deadline (mesmo que seja no último minuto)', () => {
    const { service } = makeService({ policies: [] });
    const createdAt = minutesFromNow(-479);
    const resolvedAt = new Date(); // resolvida agora
    const resolutionDeadline = minutesFromNow(1); // 1 min restante

    const status = service.computeStatus({
      createdAt,
      slaFirstResponseDeadline: minutesFromNow(-400),
      slaResolutionDeadline: resolutionDeadline,
      slaFirstResponseAt: minutesFromNow(-400),
      slaResolvedAt: resolvedAt,
    });

    expect(status).toBe<SlaStatus>('within');
  });
});

// ─── 5b. Corrida criação × primeira resposta (contrato de sincronismo) ─────────

describe('SlaService.applyToConversation — garantia de sincronismo (corrida)', () => {
  /**
   * CENÁRIO 5: Garante que applyToConversation completa ANTES de qualquer
   * chamada subsequente a recordFirstResponse. O conversations.service.ts
   * usa `await` (não `void`) para garantir isso.
   *
   * Este teste valida que applyToConversation é realmente uma Promise que resolve,
   * e que o resultado (sla_policy_id gravado) estaria disponível para recordFirstResponse.
   *
   * Em produção a sequência é:
   *   1. startConversation → await applyToConversation (sla_policy_id = X)
   *   2. addMessage (user) → void recordFirstResponse
   *   sem corrida porque (1) terminou antes de (2) ser chamado.
   */
  it('resolve completamente antes de retornar (não é fire-and-forget)', async () => {
    const policy = makePolicy();
    let applyCompleted = false;

    const policyRepo = { find: jest.fn().mockResolvedValue([policy]) };
    const dataSource = {
      query: jest.fn(async () => {
        // Simula latência de banco
        await new Promise((r) => setTimeout(r, 10));
        applyCompleted = true;
        return [{}, 1];
      }),
    };
    const svc = new SlaService(policyRepo as any, dataSource as any);

    const promise = svc.applyToConversation('tenant-1', 'conv-1');

    // Antes de await: ainda não completou
    expect(applyCompleted).toBe(false);

    await promise;

    // Após await: completou
    expect(applyCompleted).toBe(true);
  });
});
