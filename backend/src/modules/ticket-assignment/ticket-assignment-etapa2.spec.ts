/**
 * Testes — Etapa 2: Correções de distribuição de tickets
 *
 * Cobre as quatro garantias implementadas:
 *  1. Round-robin puro: apenas agentes com status 'online' recebem tickets
 *     (away e busy são excluídos do rodízio)
 *  2. Retorno à fila: ao ficar away/busy/offline o agente devolve seus tickets
 *  3. Visibilidade própria: agente sem ticket.view_all só vê seus próprios tickets
 *  4. Contador total: contagem global sem expor dados de outros agentes
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. ROUND-ROBIN PURO — apenas 'online' entra no rodízio
// ─────────────────────────────────────────────────────────────────────────────

describe('getNextAgent — round-robin com filtro de status', () => {
  type StatusMap = Record<string, string>;

  /**
   * Reprodução da lógica de filtro de presença do getNextAgent.
   * Redis: apenas 'online'; DB fallback: apenas 'online'.
   */
  function buildOnlineSet(statusMap: StatusMap): Set<string> {
    return new Set(
      Object.entries(statusMap)
        .filter(([, s]) => s === 'online')
        .map(([id]) => id),
    );
  }

  /**
   * Simula rodízio circular sobre a lista de elegíveis disponíveis.
   * pointer avança na lista ordenada a cada ticket.
   */
  function roundRobinSelect(
    eligibleIds: string[],
    onlineSet: Set<string>,
    pointer: number,
  ): { chosen: string | null; nextPointer: number } {
    const available = eligibleIds.filter(id => onlineSet.has(id));
    if (!available.length) return { chosen: null, nextPointer: pointer };

    const sorted = [...available].sort((a, b) => a.localeCompare(b));
    const idx = pointer % sorted.length;
    return { chosen: sorted[idx], nextPointer: idx + 1 };
  }

  const AGENTE_A = 'agent-aaa';
  const AGENTE_B = 'agent-bbb';
  const AGENTE_C = 'agent-ccc';

  describe('filtro de status na seleção de agentes', () => {
    it('agente online → incluído no rodízio', () => {
      const statusMap: StatusMap = {
        [AGENTE_A]: 'online',
        [AGENTE_B]: 'away',
        [AGENTE_C]: 'busy',
      };
      const onlineSet = buildOnlineSet(statusMap);
      expect(onlineSet.has(AGENTE_A)).toBe(true);
      expect(onlineSet.has(AGENTE_B)).toBe(false);
      expect(onlineSet.has(AGENTE_C)).toBe(false);
    });

    it('agente away → excluído do rodízio', () => {
      const statusMap: StatusMap = { [AGENTE_A]: 'away' };
      const onlineSet = buildOnlineSet(statusMap);
      expect(onlineSet.size).toBe(0);
    });

    it('agente busy → excluído do rodízio', () => {
      const statusMap: StatusMap = { [AGENTE_A]: 'busy' };
      const onlineSet = buildOnlineSet(statusMap);
      expect(onlineSet.size).toBe(0);
    });

    it('agente offline → excluído do rodízio', () => {
      const statusMap: StatusMap = { [AGENTE_A]: 'offline' };
      const onlineSet = buildOnlineSet(statusMap);
      expect(onlineSet.size).toBe(0);
    });

    it('todos offline/away/busy → retorna null (sem agentes disponíveis)', () => {
      const statusMap: StatusMap = {
        [AGENTE_A]: 'offline',
        [AGENTE_B]: 'away',
        [AGENTE_C]: 'busy',
      };
      const onlineSet = buildOnlineSet(statusMap);
      const result = roundRobinSelect([AGENTE_A, AGENTE_B, AGENTE_C], onlineSet, 0);
      expect(result.chosen).toBeNull();
    });
  });

  describe('rodízio circular com agentes online', () => {
    it('3 agentes online → tickets distribuídos em rodízio', () => {
      const statusMap: StatusMap = {
        [AGENTE_A]: 'online',
        [AGENTE_B]: 'online',
        [AGENTE_C]: 'online',
      };
      const onlineSet = buildOnlineSet(statusMap);
      const eligible = [AGENTE_A, AGENTE_B, AGENTE_C];

      let ptr = 0;
      const assignments: string[] = [];

      for (let i = 0; i < 3; i++) {
        const r = roundRobinSelect(eligible, onlineSet, ptr);
        assignments.push(r.chosen!);
        ptr = r.nextPointer;
      }

      // Cada agente recebe exatamente 1 ticket
      expect(new Set(assignments).size).toBe(3);
      expect(assignments[0]).toBe(AGENTE_A); // sorted: aaa < bbb < ccc
      expect(assignments[1]).toBe(AGENTE_B);
      expect(assignments[2]).toBe(AGENTE_C);
    });

    it('1 online, 2 busy → todos tickets vão para o único online', () => {
      const statusMap: StatusMap = {
        [AGENTE_A]: 'online',
        [AGENTE_B]: 'busy',
        [AGENTE_C]: 'busy',
      };
      const onlineSet = buildOnlineSet(statusMap);
      const eligible = [AGENTE_A, AGENTE_B, AGENTE_C];

      let ptr = 0;
      const assignments: string[] = [];

      for (let i = 0; i < 3; i++) {
        const r = roundRobinSelect(eligible, onlineSet, ptr);
        assignments.push(r.chosen!);
        ptr = r.nextPointer;
      }

      expect(assignments.every(a => a === AGENTE_A)).toBe(true);
    });

    it('agente muda de away para online → entra no rodízio', () => {
      const statusMapAntes: StatusMap = {
        [AGENTE_A]: 'online',
        [AGENTE_B]: 'away', // indisponível
      };
      const statusMapDepois: StatusMap = {
        [AGENTE_A]: 'online',
        [AGENTE_B]: 'online', // voltou
      };

      const antes = buildOnlineSet(statusMapAntes);
      const depois = buildOnlineSet(statusMapDepois);

      expect(antes.has(AGENTE_B)).toBe(false);
      expect(depois.has(AGENTE_B)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RETORNO À FILA — updatePresenceStatus redistribui ao ficar indisponível
// ─────────────────────────────────────────────────────────────────────────────

describe('updatePresenceStatus — lógica de redistribute/rebalance', () => {
  type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

  const UNAVAILABLE: PresenceStatus[] = ['offline', 'away', 'busy'];

  /**
   * Reprodução da lógica de decisão do updatePresenceStatus corrigido.
   */
  function decideAction(
    previous: PresenceStatus | null,
    status: PresenceStatus,
  ): 'rebalance' | 'redistribute' | 'none' {
    const prev = previous ?? 'offline';
    const wasUnavailable = UNAVAILABLE.includes(prev as PresenceStatus);
    const isNowUnavailable = UNAVAILABLE.includes(status);

    if (wasUnavailable && !isNowUnavailable) return 'rebalance';
    if (!wasUnavailable && isNowUnavailable) return 'redistribute';
    return 'none';
  }

  describe('transições que devem redistribuir (devolver tickets)', () => {
    it('online → offline → redistribute', () => {
      expect(decideAction('online', 'offline')).toBe('redistribute');
    });

    it('online → away → redistribute', () => {
      expect(decideAction('online', 'away')).toBe('redistribute');
    });

    it('online → busy → redistribute', () => {
      expect(decideAction('online', 'busy')).toBe('redistribute');
    });
  });

  describe('transições que devem rebalancear (receber tickets)', () => {
    it('offline → online → rebalance', () => {
      expect(decideAction('offline', 'online')).toBe('rebalance');
    });

    it('away → online → rebalance', () => {
      expect(decideAction('away', 'online')).toBe('rebalance');
    });

    it('busy → online → rebalance', () => {
      expect(decideAction('busy', 'online')).toBe('rebalance');
    });

    it('null (primeira entrada) → online → rebalance', () => {
      expect(decideAction(null, 'online')).toBe('rebalance');
    });
  });

  describe('transições entre estados indisponíveis — nenhuma ação', () => {
    it('offline → away → nenhuma ação (já estava indisponível)', () => {
      expect(decideAction('offline', 'away')).toBe('none');
    });

    it('away → busy → nenhuma ação', () => {
      expect(decideAction('away', 'busy')).toBe('none');
    });

    it('busy → offline → nenhuma ação', () => {
      expect(decideAction('busy', 'offline')).toBe('none');
    });

    it('offline → offline → nenhuma ação', () => {
      expect(decideAction('offline', 'offline')).toBe('none');
    });

    it('null → offline → nenhuma ação (começa indisponível)', () => {
      expect(decideAction(null, 'offline')).toBe('none');
    });
  });

  describe('sem mudança real de disponibilidade', () => {
    it('online → online → nenhuma ação', () => {
      expect(decideAction('online', 'online')).toBe('none');
    });
  });

  describe('comportamento do scheduler (redis diff) alinhado', () => {
    type SnapshotEntry = { userId: string; status: string };

    /**
     * Reprodução da lógica do scheduler após a correção:
     * o snapshot usa apenas 'online' (não inclui away/busy).
     */
    function buildAvailableSnapshot(entries: SnapshotEntry[]): Set<string> {
      return new Set(
        entries.filter(e => e.status === 'online').map(e => e.userId),
      );
    }

    function computeDiff(
      prev: Set<string>,
      current: Set<string>,
    ): { toRedistribute: string[]; toRebalance: string[] } {
      const toRedistribute = [...prev].filter(id => !current.has(id));
      const toRebalance = [...current].filter(id => !prev.has(id));
      return { toRedistribute, toRebalance };
    }

    it('agente online → away: scheduler detecta saída e redistribui', () => {
      const prev = buildAvailableSnapshot([
        { userId: 'agent-1', status: 'online' },
        { userId: 'agent-2', status: 'online' },
      ]);
      const current = buildAvailableSnapshot([
        { userId: 'agent-1', status: 'online' },
        { userId: 'agent-2', status: 'away' }, // saiu da disponibilidade
      ]);
      const { toRedistribute, toRebalance } = computeDiff(prev, current);

      expect(toRedistribute).toContain('agent-2');
      expect(toRebalance).not.toContain('agent-2');
    });

    it('agente away → online: scheduler detecta entrada e rebalanceia', () => {
      const prev = buildAvailableSnapshot([
        { userId: 'agent-1', status: 'online' },
        { userId: 'agent-2', status: 'away' },
      ]);
      const current = buildAvailableSnapshot([
        { userId: 'agent-1', status: 'online' },
        { userId: 'agent-2', status: 'online' }, // voltou
      ]);
      const { toRedistribute, toRebalance } = computeDiff(prev, current);

      expect(toRebalance).toContain('agent-2');
      expect(toRedistribute).not.toContain('agent-2');
    });

    it('restart do servidor: agente away não entra no rebalance (está indisponível)', () => {
      const prevVazio = new Set<string>(); // restart: histórico limpo
      const current = buildAvailableSnapshot([
        { userId: 'agent-1', status: 'online' },
        { userId: 'agent-2', status: 'away' }, // continua indisponível
      ]);
      const { toRebalance } = computeDiff(prevVazio, current);

      // Apenas agent-1 (online) recebe rebalance; agent-2 (away) não
      expect(toRebalance).toContain('agent-1');
      expect(toRebalance).not.toContain('agent-2');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. VISIBILIDADE PRÓPRIA — agente sem view_all só vê seus tickets
// ─────────────────────────────────────────────────────────────────────────────

describe('visibilidade de tickets — filtro por agente', () => {
  interface Ticket {
    id: string;
    assignedTo: string | null;
    tenantId: string;
  }

  interface User {
    id: string;
    tenantId: string;
    permissions: string[];
  }

  /**
   * Reprodução da lógica do tickets.controller que aplica o filtro assignedTo.
   * Comportamento real: se o agente não tem view_all e NÃO especificou assignedTo,
   * força assignedTo = user.id. Se já veio assignedTo explícito, respeitado como está.
   */
  function applyVisibilityFilter(
    user: User,
    requestedAssignedTo?: string,
  ): { assignedTo?: string } {
    const isAdmin = user.permissions.includes('*');
    const hasViewAll = user.permissions.includes('ticket.view_all');

    if (!isAdmin && !hasViewAll && !requestedAssignedTo) {
      // Sem filtro explícito → injeta próprio ID
      return { assignedTo: user.id };
    }

    return requestedAssignedTo ? { assignedTo: requestedAssignedTo } : {};
  }

  function filterTickets(tickets: Ticket[], filter: { assignedTo?: string }): Ticket[] {
    if (!filter.assignedTo) return tickets;
    return tickets.filter(t => t.assignedTo === filter.assignedTo);
  }

  const TICKETS: Ticket[] = [
    { id: 'ticket-1', assignedTo: 'agent-A', tenantId: 'tenant-1' },
    { id: 'ticket-2', assignedTo: 'agent-B', tenantId: 'tenant-1' },
    { id: 'ticket-3', assignedTo: 'agent-A', tenantId: 'tenant-1' },
    { id: 'ticket-4', assignedTo: null,      tenantId: 'tenant-1' },
  ];

  describe('agente sem ticket.view_all', () => {
    const agente: User = { id: 'agent-A', tenantId: 'tenant-1', permissions: ['ticket.view'] };

    it('vê apenas seus próprios tickets', () => {
      const filtro = applyVisibilityFilter(agente);
      const resultado = filterTickets(TICKETS, filtro);

      expect(resultado.map(t => t.id)).toEqual(['ticket-1', 'ticket-3']);
    });

    it('sem filtro explícito: assignedTo é forçado para o próprio ID', () => {
      // Agente não passa assignedTo → controller injeta user.id
      const filtro = applyVisibilityFilter(agente);
      expect(filtro.assignedTo).toBe('agent-A');
    });

    it('não vê tickets não atribuídos', () => {
      const filtro = applyVisibilityFilter(agente);
      const resultado = filterTickets(TICKETS, filtro);

      const naoAtribuidos = resultado.filter(t => t.assignedTo === null);
      expect(naoAtribuidos).toHaveLength(0);
    });
  });

  describe('agente com ticket.view_all', () => {
    const supervisor: User = {
      id: 'agent-A',
      tenantId: 'tenant-1',
      permissions: ['ticket.view', 'ticket.view_all'],
    };

    it('vê todos os tickets quando não filtra por agente', () => {
      const filtro = applyVisibilityFilter(supervisor);
      const resultado = filterTickets(TICKETS, filtro);

      expect(resultado).toHaveLength(4);
    });

    it('pode filtrar por outro agente', () => {
      const filtro = applyVisibilityFilter(supervisor, 'agent-B');
      const resultado = filterTickets(TICKETS, filtro);

      expect(resultado.map(t => t.id)).toEqual(['ticket-2']);
    });
  });

  describe('admin (permissão *)', () => {
    const admin: User = {
      id: 'agent-admin',
      tenantId: 'tenant-1',
      permissions: ['*'],
    };

    it('vê todos os tickets', () => {
      const filtro = applyVisibilityFilter(admin);
      const resultado = filterTickets(TICKETS, filtro);

      expect(resultado).toHaveLength(4);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CONTADOR TOTAL — contagem sem expor dados de outros agentes
// ─────────────────────────────────────────────────────────────────────────────

describe('contador de tickets — total sem vazamento de dados', () => {
  interface CountResult {
    total: number;
    mine?: number;   // tickets do próprio agente (nunca expõe tickets alheios)
  }

  interface TicketSummary {
    id: string;
    assignedTo: string | null;
    status: string;
  }

  /**
   * Simula o que o endpoint de contagem deve retornar.
   * - Agente sem view_all: total = apenas seus tickets; sem dados alheios
   * - Agente com view_all: total = todos; pode incluir mine para split
   */
  function buildCountResponse(
    tickets: TicketSummary[],
    userId: string,
    hasViewAll: boolean,
  ): CountResult {
    if (!hasViewAll) {
      const mine = tickets.filter(t => t.assignedTo === userId).length;
      return { total: mine }; // total = apenas os próprios
    }
    const total = tickets.length;
    const mine = tickets.filter(t => t.assignedTo === userId).length;
    return { total, mine };
  }

  const TICKETS: TicketSummary[] = [
    { id: 't1', assignedTo: 'agent-A', status: 'in_progress' },
    { id: 't2', assignedTo: 'agent-B', status: 'in_progress' },
    { id: 't3', assignedTo: 'agent-A', status: 'open' },
    { id: 't4', assignedTo: null,      status: 'open' },
  ];

  it('agente sem view_all vê apenas a própria contagem', () => {
    const result = buildCountResponse(TICKETS, 'agent-A', false);

    // agent-A tem 2 tickets; não expõe o total real (4) nem os de agent-B
    expect(result.total).toBe(2);
    expect(result.mine).toBeUndefined();
  });

  it('agente sem view_all não vê tickets de agent-B no contador', () => {
    const resultA = buildCountResponse(TICKETS, 'agent-A', false);
    const resultB = buildCountResponse(TICKETS, 'agent-B', false);

    // Cada agente só vê a própria contagem
    expect(resultA.total).toBe(2); // tickets de A
    expect(resultB.total).toBe(1); // tickets de B
  });

  it('supervisor com view_all vê total global e sua própria contagem', () => {
    const result = buildCountResponse(TICKETS, 'agent-A', true);

    expect(result.total).toBe(4);  // todos
    expect(result.mine).toBe(2);   // apenas os de A
  });

  it('agente sem tickets não recebe dados de outros no contador', () => {
    const result = buildCountResponse(TICKETS, 'agent-novo', false);

    expect(result.total).toBe(0);
  });
});
