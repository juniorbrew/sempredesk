import { useState, useMemo, useCallback } from 'react';
import {
  mockUsuario,
  mockEmpresas,
  mockTickets,
  mockStats,
  mockNotificacoes,
} from '../data/mockData';

// ── Hook principal do portal ─────────────────────────────────────────────────
// activeCompanyId é a fonte de verdade da empresa ativa.
// Ao trocar de empresa, filtros, busca e dropdowns são resetados.
export function usePortal() {
  // ── Estado central
  const [activeCompanyId, setActiveCompanyId] = useState(mockEmpresas[0].id);
  const [filtroStatus, setFiltroStatus]       = useState('todos');
  const [busca, setBusca]                     = useState('');
  const [notificacoes, setNotificacoes]       = useState(mockNotificacoes);

  // ── Trocar empresa — SEMPRE reseta filtros e busca
  const trocarEmpresa = useCallback((id) => {
    if (id === activeCompanyId) return;
    setActiveCompanyId(id);
    setFiltroStatus('todos'); // reset obrigatório
    setBusca('');             // reset obrigatório
  }, [activeCompanyId]);

  // ── Empresa ativa
  const empresaAtiva = useMemo(
    () => mockEmpresas.find((e) => e.id === activeCompanyId) ?? mockEmpresas[0],
    [activeCompanyId]
  );

  // ── Papel do usuário na empresa ativa (controla permissões)
  const podeAbrir = empresaAtiva.papel !== 'Visualizador';
  const podeGerenciar = empresaAtiva.papel === 'Administrador';

  // ── Estatísticas da empresa ativa (nunca mistura com outras empresas)
  const stats = useMemo(() => mockStats[activeCompanyId] ?? null, [activeCompanyId]);

  // ── Todos os tickets da empresa ativa
  const todosTickets = useMemo(
    () => mockTickets[activeCompanyId] ?? [],
    [activeCompanyId]
  );

  // ── Tickets filtrados por status e busca
  const ticketsFiltrados = useMemo(() => {
    let lista = todosTickets;
    if (filtroStatus !== 'todos') {
      lista = lista.filter((t) => t.status === filtroStatus);
    }
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(
        (t) =>
          t.numero.toLowerCase().includes(q) ||
          t.assunto.toLowerCase().includes(q) ||
          t.categoria.toLowerCase().includes(q)
      );
    }
    return lista;
  }, [todosTickets, filtroStatus, busca]);

  // ── Notificações da empresa ativa (isoladas por empresa)
  const notificacoesEmpresa = useMemo(
    () => notificacoes[activeCompanyId] ?? [],
    [notificacoes, activeCompanyId]
  );

  const totalNaoLidas = useMemo(
    () => notificacoesEmpresa.filter((n) => !n.lida).length,
    [notificacoesEmpresa]
  );

  const marcarTodasLidas = useCallback(() => {
    setNotificacoes((prev) => ({
      ...prev,
      [activeCompanyId]: (prev[activeCompanyId] ?? []).map((n) => ({
        ...n,
        lida: true,
      })),
    }));
  }, [activeCompanyId]);

  const marcarLida = useCallback((id) => {
    setNotificacoes((prev) => ({
      ...prev,
      [activeCompanyId]: (prev[activeCompanyId] ?? []).map((n) =>
        n.id === id ? { ...n, lida: true } : n
      ),
    }));
  }, [activeCompanyId]);

  return {
    // usuário
    usuario: mockUsuario,

    // empresas
    empresas:       mockEmpresas,
    empresaAtiva,
    activeCompanyId,
    trocarEmpresa,

    // permissões
    podeAbrir,
    podeGerenciar,

    // stats (empresa ativa)
    stats,

    // tickets
    todosTickets,
    ticketsFiltrados,

    // filtros
    filtroStatus,
    setFiltroStatus,
    busca,
    setBusca,

    // notificações (empresa ativa)
    notificacoes:   notificacoesEmpresa,
    totalNaoLidas,
    marcarTodasLidas,
    marcarLida,
  };
}
