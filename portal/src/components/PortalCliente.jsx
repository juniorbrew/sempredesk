import { useState, useRef, useEffect } from 'react';
import { usePortal } from '../hooks/usePortal';

// ── Helpers ───────────────────────────────────────────────────────────────────
const iniciais = (nome = '') => {
  const p = nome.trim().split(/\s+/);
  return p.length === 1
    ? (p[0][0] || '?').toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};
const corAvatar = (nome = '') => {
  const cores = ['#4f46e5','#0891b2','#16a34a','#d97706','#dc2626','#7c3aed','#be185d'];
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = nome.charCodeAt(i) + ((h << 5) - h);
  return cores[Math.abs(h) % cores.length];
};
const formatarData = (iso) => {
  const d = new Date(iso);
  const agora = new Date();
  const diff = agora - d;
  const min = Math.floor(diff / 60000);
  const h   = Math.floor(min / 60);
  const dia = Math.floor(h / 24);
  if (dia === 0 && h === 0) return `há ${min < 1 ? 1 : min} min`;
  if (dia === 0) return `há ${h}h`;
  if (dia === 1) return 'ontem';
  if (dia < 7)  return `há ${dia} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};
const formatarDataCompleta = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

// ── Constantes ────────────────────────────────────────────────────────────────
const ETAPAS = ['Aberto', 'Recebido', 'Em análise', 'Em atendimento', 'Resolvido'];

const COR_STATUS = {
  'Aberto':      { bg: 'var(--cor-info-c)',    txt: 'var(--cor-info)' },
  'Em andamento':{ bg: 'var(--cor-aviso-c)',   txt: 'var(--cor-aviso)' },
  'Resolvido':   { bg: 'var(--cor-sucesso-c)', txt: 'var(--cor-sucesso)' },
};
const COR_PRIO = {
  'Alta':  { bg: 'var(--cor-erro-c)',    txt: 'var(--cor-erro)' },
  'Média': { bg: 'var(--cor-aviso-c)',   txt: 'var(--cor-aviso)' },
  'Baixa': { bg: 'var(--cor-sucesso-c)', txt: 'var(--cor-sucesso)' },
};
const COR_NOTIF = {
  progresso: 'var(--cor-acento)',
  resolucao: 'var(--cor-sucesso)',
  recebido:  'var(--cor-info)',
};
const ICON_NOTIF = {
  progresso: '⚡',
  resolucao: '✅',
  recebido:  '📬',
};

// ── Subcomponentes ────────────────────────────────────────────────────────────

function Badge({ label, cores }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 9px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: cores.bg, color: cores.txt,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function CardStat({ label, valor, sub, cor, icone }) {
  return (
    <div style={{
      background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
      border: '1px solid var(--cor-borda)', padding: '18px 20px',
      display: 'flex', alignItems: 'center', gap: 16,
      boxShadow: 'var(--sombra-sm)',
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 'var(--raio-sm)',
        background: cor + '18', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 22, flexShrink: 0,
      }}>
        {icone}
      </div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color: cor, lineHeight: 1 }}>{valor}</div>
        <div style={{ fontSize: 11, color: 'var(--cor-texto2)', marginTop: 3, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--cor-texto3)', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function LinhaDoTempo({ ticket }) {
  const atual = ticket.progress;
  return (
    <div>
      {/* Barra horizontal de etapas */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, marginBottom: 24 }}>
        {ETAPAS.map((etapa, i) => {
          const concluido = i < atual;
          const ativo     = i === atual;
          const futuro    = i > atual;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Linha + círculo */}
              <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                {/* Linha esquerda */}
                <div style={{
                  flex: 1, height: 3,
                  background: concluido || ativo ? 'var(--cor-acento)' : 'var(--cor-borda2)',
                  visibility: i === 0 ? 'hidden' : 'visible',
                  transition: 'background .3s',
                }} />
                {/* Círculo */}
                <div style={{
                  width: ativo ? 32 : 24, height: ativo ? 32 : 24,
                  borderRadius: '50%', flexShrink: 0, zIndex: 1,
                  background: concluido ? 'var(--cor-acento)'
                    : ativo ? 'var(--cor-acento)'
                    : 'var(--cor-bg2)',
                  border: futuro
                    ? '2px solid var(--cor-borda2)'
                    : '2px solid var(--cor-acento)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all .3s',
                  boxShadow: ativo ? '0 0 0 4px var(--cor-acento-c)' : 'none',
                }}>
                  {concluido && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                  {ativo && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
                  )}
                </div>
                {/* Linha direita */}
                <div style={{
                  flex: 1, height: 3,
                  background: concluido ? 'var(--cor-acento)' : 'var(--cor-borda2)',
                  visibility: i === ETAPAS.length - 1 ? 'hidden' : 'visible',
                  transition: 'background .3s',
                }} />
              </div>
              {/* Label */}
              <div style={{
                marginTop: 8, fontSize: 10, fontWeight: ativo ? 700 : 500,
                color: ativo ? 'var(--cor-acento)'
                  : concluido ? 'var(--cor-texto2)'
                  : 'var(--cor-texto3)',
                textAlign: 'center', lineHeight: 1.3,
              }}>
                {etapa}
              </div>
            </div>
          );
        })}
      </div>

      {/* Histórico de eventos */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cor-texto3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 12 }}>
          Histórico de atualizações
        </div>
        {[...ticket.historico].reverse().map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 14, position: 'relative' }}>
            {/* Linha vertical */}
            {i < ticket.historico.length - 1 && (
              <div style={{
                position: 'absolute', left: 11, top: 24, bottom: 0, width: 2,
                background: 'var(--cor-borda)', zIndex: 0,
              }} />
            )}
            {/* Dot */}
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: i === 0 ? 'var(--cor-acento-c)' : 'var(--cor-bg3)',
              border: `2px solid ${i === 0 ? 'var(--cor-acento)' : 'var(--cor-borda2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: i === 0 ? 'var(--cor-acento)' : 'var(--cor-texto3)' }} />
            </div>
            {/* Texto */}
            <div style={{ paddingBottom: 16, flex: 1 }}>
              <div style={{ fontSize: 13, color: 'var(--cor-texto)', fontWeight: i === 0 ? 600 : 400 }}>
                {h.desc}
              </div>
              <div style={{ fontSize: 11, color: 'var(--cor-texto3)', marginTop: 2 }}>
                {formatarDataCompleta(h.data)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PainelDetalheTicket({ ticket, onFechar }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onFechar]);

  const statusCores = COR_STATUS[ticket.status] ?? COR_STATUS['Aberto'];
  const prioCores   = COR_PRIO[ticket.prioridade] ?? COR_PRIO['Média'];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    }} onClick={onFechar}>
      <div
        style={{
          width: '100%', maxWidth: 560, height: '100%',
          background: 'var(--cor-bg2)', overflowY: 'auto',
          boxShadow: 'var(--sombra-lg)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--cor-borda)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0, position: 'sticky', top: 0,
          background: 'var(--cor-bg2)', zIndex: 1,
        }}>
          <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--cor-acento)' }}>
                {ticket.numero}
              </span>
              <Badge label={ticket.status} cores={statusCores} />
              <Badge label={ticket.prioridade} cores={prioCores} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--cor-texto)', lineHeight: 1.3 }}>
              {ticket.assunto}
            </h2>
          </div>
          <button onClick={onFechar} style={{
            width: 32, height: 32, borderRadius: 8, border: '1px solid var(--cor-borda)',
            background: 'var(--cor-bg3)', color: 'var(--cor-texto2)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>✕</button>
        </div>

        {/* Conteúdo */}
        <div style={{ padding: '24px', flex: 1 }}>
          {/* Metadados */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
            padding: '16px', borderRadius: 'var(--raio-sm)',
            background: 'var(--cor-bg3)', marginBottom: 28,
          }}>
            {[
              { label: 'Categoria',    value: ticket.categoria },
              { label: 'Responsável',  value: ticket.responsavel ?? 'Aguardando atribuição' },
              { label: 'Aberto em',    value: formatarDataCompleta(ticket.criadoEm) },
              { label: 'Atualizado',   value: formatarDataCompleta(ticket.atualizadoEm) },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--cor-texto3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, color: 'var(--cor-texto)', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Linha do tempo */}
          <LinhaDoTempo ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

function PainelNotificacoes({ notificacoes, totalNaoLidas, marcarTodasLidas, marcarLida, onFechar }) {
  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 100, marginTop: 8,
      width: 340, background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
      border: '1px solid var(--cor-borda)', boxShadow: 'var(--sombra-lg)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--cor-borda)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cor-texto)' }}>Notificações</span>
          {totalNaoLidas > 0 && (
            <span style={{
              background: 'var(--cor-erro)', color: '#fff',
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
            }}>{totalNaoLidas}</span>
          )}
        </div>
        {totalNaoLidas > 0 && (
          <button onClick={marcarTodasLidas} style={{
            fontSize: 11, color: 'var(--cor-acento)', background: 'none', border: 'none',
            fontWeight: 600, cursor: 'pointer',
          }}>
            Marcar todas como lidas
          </button>
        )}
      </div>

      {/* Lista */}
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {notificacoes.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--cor-texto3)', fontSize: 13 }}>
            Nenhuma notificação
          </div>
        ) : (
          notificacoes.map((n) => (
            <div
              key={n.id}
              onClick={() => marcarLida(n.id)}
              style={{
                padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
                borderBottom: '1px solid var(--cor-borda)', cursor: 'pointer',
                background: n.lida ? 'transparent' : 'var(--cor-acento-c)',
                transition: 'background .15s',
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: COR_NOTIF[n.tipo] + '20',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}>
                {ICON_NOTIF[n.tipo]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--cor-texto)', lineHeight: 1.4, marginBottom: 3 }}>
                  {n.mensagem}
                </div>
                <div style={{ fontSize: 10, color: 'var(--cor-texto3)', fontWeight: 500 }}>
                  {n.ticketNum} · {formatarData(n.data)}
                </div>
              </div>
              {!n.lida && (
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cor-acento)', flexShrink: 0, marginTop: 4 }} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PortalCliente() {
  const portal = usePortal();
  const {
    usuario, empresas, empresaAtiva, trocarEmpresa,
    stats, todosTickets, ticketsFiltrados,
    filtroStatus, setFiltroStatus, busca, setBusca,
    notificacoes, totalNaoLidas, marcarTodasLidas, marcarLida,
    podeAbrir,
  } = portal;

  // ── UI local
  const [view, setView]                       = useState('dashboard');
  const [ticketSelecionado, setTicketSelecionado] = useState(null);
  const [empresaMenuAberto, setEmpresaMenuAberto] = useState(false);
  const [notifAberto, setNotifAberto]             = useState(false);
  const [modalNovoTicket, setModalNovoTicket]     = useState(false);
  const [novoTicketForm, setNovoTicketForm]       = useState({ assunto: '', descricao: '', prioridade: 'Média', categoria: '' });

  const empresaMenuRef = useRef(null);
  const notifRef       = useRef(null);

  // Fechar dropdowns ao clicar fora
  useEffect(() => {
    const handler = (e) => {
      if (empresaMenuRef.current && !empresaMenuRef.current.contains(e.target)) {
        setEmpresaMenuAberto(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifAberto(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Trocar empresa também fecha dropdowns
  const handleTrocarEmpresa = (id) => {
    trocarEmpresa(id);        // hook reseta filtros/busca
    setEmpresaMenuAberto(false); // fecha dropdown
    setView('dashboard');
  };

  // ── Tickets recentes (últimos 4) para o dashboard
  const ticketsRecentes = [...todosTickets]
    .sort((a, b) => new Date(b.atualizadoEm) - new Date(a.atualizadoEm))
    .slice(0, 4);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--cor-bg)' }}>

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════════ */}
      <aside style={{
        width: 240, flexShrink: 0, height: '100%',
        background: 'var(--cor-nav)', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg,#4f46e5,#6366f1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: '#fff', boxShadow: '0 4px 12px rgba(79,70,229,.4)',
            }}>🎧</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '-.01em' }}>SempreDesk</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>Portal do Cliente</div>
            </div>
          </div>
        </div>

        {/* Seletor de empresa */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }} ref={empresaMenuRef}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
            Empresa ativa
          </div>
          <button
            onClick={() => setEmpresaMenuAberto((v) => !v)}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 8,
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              color: '#fff', textAlign: 'left',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: empresaAtiva.cor, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', flexShrink: 0,
            }}>
              {empresaAtiva.logo}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {empresaAtiva.nome}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                {empresaAtiva.papel}
              </div>
            </div>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: .5, transform: empresaMenuAberto ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Dropdown de empresas */}
          {empresaMenuAberto && (
            <div style={{
              marginTop: 6, background: 'var(--cor-nav2)', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
              boxShadow: 'var(--sombra-lg)',
            }}>
              {empresas.map((emp) => (
                <button
                  key={emp.id}
                  onClick={() => handleTrocarEmpresa(emp.id)}
                  style={{
                    width: '100%', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10,
                    background: emp.id === empresaAtiva.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: 'none', cursor: 'pointer', color: '#fff', textAlign: 'left',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div style={{
                    width: 26, height: 26, borderRadius: 6, background: emp.cor,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 800, color: '#fff', flexShrink: 0,
                  }}>{emp.logo}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.nome}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{emp.papel}</div>
                  </div>
                  {emp.id === empresaAtiva.id && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Navegação */}
        <nav style={{ padding: '12px 8px', flex: 1 }}>
          {[
            { id: 'dashboard', label: 'Dashboard',      icone: '⊞' },
            { id: 'tickets',   label: 'Meus Chamados',  icone: '🎫' },
          ].map(({ id, label, icone }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2,
                background: view === id ? 'rgba(255,255,255,0.1)' : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                color: view === id ? '#fff' : 'rgba(255,255,255,0.5)',
                fontWeight: view === id ? 600 : 400, fontSize: 13,
                transition: 'background .1s, color .1s',
              }}
            >
              <span style={{ fontSize: 15 }}>{icone}</span>
              {label}
            </button>
          ))}
        </nav>

        {/* Usuário */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: corAvatar(usuario.nome), display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {iniciais(usuario.nome)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {usuario.nome}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {usuario.email}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ══ MAIN ══════════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Topbar */}
        <header style={{
          height: 52, flexShrink: 0, background: 'var(--cor-bg2)',
          borderBottom: '1px solid var(--cor-borda)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cor-texto)' }}>
            {view === 'dashboard' ? 'Dashboard' : 'Meus Chamados'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Botão novo chamado */}
            <button
              onClick={() => podeAbrir && setModalNovoTicket(true)}
              disabled={!podeAbrir}
              title={!podeAbrir ? 'Perfil Visualizador não pode abrir chamados' : 'Abrir novo chamado'}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                background: podeAbrir ? 'var(--cor-acento)' : 'var(--cor-bg3)',
                color: podeAbrir ? '#fff' : 'var(--cor-texto3)',
                border: 'none', fontSize: 12, fontWeight: 600,
                cursor: podeAbrir ? 'pointer' : 'not-allowed',
                opacity: podeAbrir ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 14 }}>+</span> Novo Chamado
            </button>

            {/* Sino de notificações */}
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button
                onClick={() => setNotifAberto((v) => !v)}
                style={{
                  width: 36, height: 36, borderRadius: 9,
                  background: notifAberto ? 'var(--cor-acento-c)' : 'var(--cor-bg3)',
                  border: '1px solid var(--cor-borda)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                }}
              >
                <span style={{ fontSize: 16 }}>🔔</span>
                {totalNaoLidas > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--cor-erro)', color: '#fff',
                    fontSize: 9, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--cor-bg2)',
                  }}>{totalNaoLidas}</span>
                )}
              </button>
              {notifAberto && (
                <PainelNotificacoes
                  notificacoes={notificacoes}
                  totalNaoLidas={totalNaoLidas}
                  marcarTodasLidas={marcarTodasLidas}
                  marcarLida={marcarLida}
                  onFechar={() => setNotifAberto(false)}
                />
              )}
            </div>
          </div>
        </header>

        {/* Conteúdo */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>

          {/* ── VIEW DASHBOARD ─────────────────────────────────────────────── */}
          {view === 'dashboard' && stats && (
            <div>
              {/* Cards de métricas */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
                <CardStat label="Total de Chamados"  valor={stats.total}        cor="var(--cor-acento)"  icone="🎫" />
                <CardStat label="Em Aberto"          valor={stats.abertos}      cor="var(--cor-info)"    icone="📂"
                  sub={stats.abertos > 0 ? `${Math.round(stats.abertos / stats.total * 100)}% do total` : undefined} />
                <CardStat label="Em Andamento"       valor={stats.emAndamento}  cor="var(--cor-aviso)"   icone="⚙️"
                  sub={stats.emAndamento > 0 ? `${Math.round(stats.emAndamento / stats.total * 100)}% do total` : undefined} />
                <CardStat label="Resolvidos"         valor={stats.resolvidos}   cor="var(--cor-sucesso)" icone="✅"
                  sub={stats.resolvidos > 0 ? `${Math.round(stats.resolvidos / stats.total * 100)}% do total` : undefined} />
              </div>

              {/* Métricas secundárias */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
                <div style={{
                  background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
                  border: '1px solid var(--cor-borda)', padding: '16px 20px',
                  boxShadow: 'var(--sombra-sm)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cor-texto3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Tempo médio de resolução
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--cor-acento)' }}>
                    {stats.tempoMedioH}h
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cor-texto2)', marginTop: 2 }}>por chamado resolvido</div>
                </div>
                <div style={{
                  background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
                  border: '1px solid var(--cor-borda)', padding: '16px 20px',
                  boxShadow: 'var(--sombra-sm)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cor-texto3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Satisfação média
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--cor-sucesso)' }}>
                      {stats.satisfacao.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 16, color: 'var(--cor-texto3)' }}>/5.0</div>
                  </div>
                  <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                    {[1,2,3,4,5].map((s) => (
                      <span key={s} style={{ fontSize: 14, color: s <= Math.round(stats.satisfacao) ? '#f59e0b' : 'var(--cor-borda2)' }}>★</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Atividade recente */}
              <div style={{
                background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
                border: '1px solid var(--cor-borda)', boxShadow: 'var(--sombra-sm)',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '14px 20px', borderBottom: '1px solid var(--cor-borda)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--cor-texto)' }}>Chamados recentes</span>
                  <button onClick={() => setView('tickets')} style={{
                    fontSize: 12, color: 'var(--cor-acento)', background: 'none', border: 'none',
                    cursor: 'pointer', fontWeight: 600,
                  }}>Ver todos →</button>
                </div>
                {ticketsRecentes.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--cor-texto3)', fontSize: 13 }}>
                    Nenhum chamado encontrado
                  </div>
                ) : (
                  ticketsRecentes.map((t) => (
                    <div
                      key={t.id}
                      onClick={() => setTicketSelecionado(t)}
                      style={{
                        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14,
                        borderBottom: '1px solid var(--cor-borda)', cursor: 'pointer',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--cor-bg3)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--cor-acento)' }}>{t.numero}</span>
                          <Badge label={t.status} cores={COR_STATUS[t.status] ?? COR_STATUS['Aberto']} />
                          <Badge label={t.prioridade} cores={COR_PRIO[t.prioridade] ?? COR_PRIO['Média']} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--cor-texto)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.assunto}
                        </div>
                      </div>
                      {/* Mini progresso */}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        {ETAPAS.map((_, i) => (
                          <div key={i} style={{
                            width: i === t.progress ? 16 : 8, height: 6, borderRadius: 3,
                            background: i <= t.progress ? 'var(--cor-acento)' : 'var(--cor-borda2)',
                            transition: 'width .2s',
                          }} />
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--cor-texto3)', flexShrink: 0 }}>
                        {formatarData(t.atualizadoEm)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ── VIEW TICKETS ──────────────────────────────────────────────── */}
          {view === 'tickets' && (
            <div>
              {/* Barra de busca + filtros */}
              <div style={{
                background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
                border: '1px solid var(--cor-borda)', padding: '14px 16px',
                marginBottom: 16, boxShadow: 'var(--sombra-sm)',
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                {/* Campo de busca */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 220px',
                  background: 'var(--cor-bg3)', borderRadius: 8, border: '1px solid var(--cor-borda)',
                  padding: '7px 12px',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--cor-texto3)' }}>🔍</span>
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar por número, assunto ou categoria..."
                    style={{
                      flex: 1, background: 'none', border: 'none', outline: 'none',
                      fontSize: 13, color: 'var(--cor-texto)',
                    }}
                  />
                  {busca && (
                    <button onClick={() => setBusca('')} style={{ background: 'none', border: 'none', color: 'var(--cor-texto3)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                  )}
                </div>

                {/* Filtros de status */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {['todos', 'Aberto', 'Em andamento', 'Resolvido'].map((s) => (
                    <button
                      key={s}
                      onClick={() => setFiltroStatus(s)}
                      style={{
                        padding: '6px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                        background: filtroStatus === s ? 'var(--cor-acento)' : 'var(--cor-bg3)',
                        color: filtroStatus === s ? '#fff' : 'var(--cor-texto2)',
                        border: `1px solid ${filtroStatus === s ? 'var(--cor-acento)' : 'var(--cor-borda)'}`,
                        cursor: 'pointer', transition: 'all .15s',
                      }}
                    >
                      {s === 'todos' ? 'Todos' : s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Contagem */}
              <div style={{ fontSize: 12, color: 'var(--cor-texto3)', marginBottom: 12, fontWeight: 500 }}>
                {ticketsFiltrados.length} chamado{ticketsFiltrados.length !== 1 ? 's' : ''} encontrado{ticketsFiltrados.length !== 1 ? 's' : ''}
                {(filtroStatus !== 'todos' || busca) && (
                  <button onClick={() => { setFiltroStatus('todos'); setBusca(''); }} style={{
                    marginLeft: 8, fontSize: 11, color: 'var(--cor-acento)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600,
                  }}>Limpar filtros</button>
                )}
              </div>

              {/* Lista de tickets */}
              <div style={{
                background: 'var(--cor-bg2)', borderRadius: 'var(--raio)',
                border: '1px solid var(--cor-borda)', overflow: 'hidden',
                boxShadow: 'var(--sombra-sm)',
              }}>
                {ticketsFiltrados.length === 0 ? (
                  <div style={{ padding: 60, textAlign: 'center', color: 'var(--cor-texto3)' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>🎫</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nenhum chamado encontrado</div>
                    <div style={{ fontSize: 12 }}>Tente ajustar os filtros ou a busca</div>
                  </div>
                ) : (
                  ticketsFiltrados.map((t, idx) => {
                    const statusCores = COR_STATUS[t.status] ?? COR_STATUS['Aberto'];
                    const prioCores   = COR_PRIO[t.prioridade] ?? COR_PRIO['Média'];
                    return (
                      <div
                        key={t.id}
                        onClick={() => setTicketSelecionado(t)}
                        style={{
                          padding: '16px 20px', cursor: 'pointer',
                          borderBottom: idx < ticketsFiltrados.length - 1 ? '1px solid var(--cor-borda)' : 'none',
                          transition: 'background .1s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--cor-bg3)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Linha 1: número + badges */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--cor-acento)' }}>{t.numero}</span>
                              <Badge label={t.status} cores={statusCores} />
                              <Badge label={t.prioridade} cores={prioCores} />
                              <span style={{ fontSize: 11, color: 'var(--cor-texto3)', background: 'var(--cor-bg3)', padding: '2px 7px', borderRadius: 5 }}>{t.categoria}</span>
                            </div>
                            {/* Linha 2: assunto */}
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cor-texto)', marginBottom: 10, lineHeight: 1.3 }}>
                              {t.assunto}
                            </div>
                            {/* Linha 3: mini linha do tempo */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              {ETAPAS.map((etapa, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <div style={{
                                    width: 7, height: 7, borderRadius: '50%',
                                    background: i < t.progress ? 'var(--cor-acento)'
                                      : i === t.progress ? 'var(--cor-acento)'
                                      : 'var(--cor-borda2)',
                                    border: i === t.progress ? '2px solid var(--cor-acento)' : 'none',
                                    boxShadow: i === t.progress ? '0 0 0 2px var(--cor-acento-c)' : 'none',
                                  }} />
                                  {i < ETAPAS.length - 1 && (
                                    <div style={{
                                      width: 16, height: 2, borderRadius: 1,
                                      background: i < t.progress ? 'var(--cor-acento)' : 'var(--cor-borda2)',
                                    }} />
                                  )}
                                </div>
                              ))}
                              <span style={{ fontSize: 11, color: 'var(--cor-texto2)', fontWeight: 600, marginLeft: 4 }}>
                                {ETAPAS[t.progress]}
                              </span>
                            </div>
                          </div>

                          {/* Meta direita */}
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            {t.responsavel ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, justifyContent: 'flex-end' }}>
                                <div style={{
                                  width: 22, height: 22, borderRadius: '50%',
                                  background: corAvatar(t.responsavel), color: '#fff',
                                  fontSize: 9, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  {iniciais(t.responsavel)}
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--cor-texto2)' }}>{t.responsavel}</span>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: 'var(--cor-texto3)', marginBottom: 4 }}>Sem responsável</div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--cor-texto3)' }}>
                              {formatarData(t.atualizadoEm)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ══ PAINEL DETALHE TICKET ══════════════════════════════════════════════ */}
      {ticketSelecionado && (
        <PainelDetalheTicket
          ticket={ticketSelecionado}
          onFechar={() => setTicketSelecionado(null)}
        />
      )}

      {/* ══ MODAL NOVO TICKET ══════════════════════════════════════════════════ */}
      {modalNovoTicket && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 300, padding: 16,
          }}
          onClick={() => setModalNovoTicket(false)}
        >
          <div
            style={{
              background: 'var(--cor-bg2)', borderRadius: 'var(--raio-lg)',
              width: '100%', maxWidth: 480, boxShadow: 'var(--sombra-lg)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '18px 22px', borderBottom: '1px solid var(--cor-borda)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--cor-texto)' }}>Abrir Novo Chamado</h3>
                <p style={{ fontSize: 12, color: 'var(--cor-texto3)', marginTop: 2 }}>{empresaAtiva.nome}</p>
              </div>
              <button onClick={() => setModalNovoTicket(false)} style={{
                width: 30, height: 30, borderRadius: 7, border: '1px solid var(--cor-borda)',
                background: 'var(--cor-bg3)', color: 'var(--cor-texto2)', fontSize: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}>✕</button>
            </div>

            {/* Formulário */}
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Assunto *', field: 'assunto', tipo: 'input', placeholder: 'Descreva brevemente o problema' },
                { label: 'Categoria', field: 'categoria', tipo: 'input', placeholder: 'Ex: Infraestrutura, Financeiro...' },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--cor-texto2)', marginBottom: 5 }}>{label}</label>
                  <input
                    value={novoTicketForm[field]}
                    onChange={(e) => setNovoTicketForm((p) => ({ ...p, [field]: e.target.value }))}
                    placeholder={placeholder}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--cor-borda)', background: 'var(--cor-bg3)',
                      color: 'var(--cor-texto)', fontSize: 13, outline: 'none',
                    }}
                  />
                </div>
              ))}

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--cor-texto2)', marginBottom: 5 }}>Prioridade</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['Alta', 'Média', 'Baixa'].map((p) => {
                    const c = COR_PRIO[p];
                    const ativo = novoTicketForm.prioridade === p;
                    return (
                      <button key={p} onClick={() => setNovoTicketForm((prev) => ({ ...prev, prioridade: p }))}
                        style={{
                          flex: 1, padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: ativo ? c.bg : 'var(--cor-bg3)',
                          color: ativo ? c.txt : 'var(--cor-texto2)',
                          border: `1.5px solid ${ativo ? c.txt : 'var(--cor-borda)'}`,
                          cursor: 'pointer',
                        }}>{p}</button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--cor-texto2)', marginBottom: 5 }}>Descrição</label>
                <textarea
                  value={novoTicketForm.descricao}
                  onChange={(e) => setNovoTicketForm((p) => ({ ...p, descricao: e.target.value }))}
                  placeholder="Descreva o problema com detalhes, incluindo mensagens de erro e passos para reproduzir..."
                  rows={4}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 8,
                    border: '1px solid var(--cor-borda)', background: 'var(--cor-bg3)',
                    color: 'var(--cor-texto)', fontSize: 13, resize: 'vertical', outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '14px 22px', borderTop: '1px solid var(--cor-borda)',
              display: 'flex', gap: 10, justifyContent: 'flex-end',
            }}>
              <button onClick={() => setModalNovoTicket(false)} style={{
                padding: '8px 18px', borderRadius: 8, border: '1.5px solid var(--cor-borda)',
                background: 'var(--cor-bg3)', color: 'var(--cor-texto2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancelar</button>
              <button
                disabled={!novoTicketForm.assunto.trim()}
                onClick={() => {
                  // TODO: integrar com POST /api/companies/:companyId/tickets
                  alert(`Chamado "${novoTicketForm.assunto}" enviado!\n(Integração com API a implementar)`);
                  setModalNovoTicket(false);
                  setNovoTicketForm({ assunto: '', descricao: '', prioridade: 'Média', categoria: '' });
                }}
                style={{
                  padding: '8px 20px', borderRadius: 8, border: 'none',
                  background: novoTicketForm.assunto.trim() ? 'var(--cor-acento)' : 'var(--cor-bg3)',
                  color: novoTicketForm.assunto.trim() ? '#fff' : 'var(--cor-texto3)',
                  fontSize: 13, fontWeight: 700, cursor: novoTicketForm.assunto.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Enviar Chamado
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
