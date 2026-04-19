'use client';
/**
 * IntegracoesPage — /dashboard/agenda/integracoes
 * ────────────────────────────────────────────────
 * Interface de integrações de calendário externo (Fase 4.1.5).
 * Suporta: Google Calendar · Microsoft Outlook
 *
 * Funcionalidades:
 *   - Status dos providers configurados no servidor
 *   - Lista de contas conectadas do usuário
 *   - Conectar / Reconectar via OAuth (redireciona para provider)
 *   - Sincronizar eventos manualmente
 *   - Expandir integração → ver calendários + logs de sync
 *   - Desconectar conta (com confirmação)
 *   - Feedback de retorno do callback OAuth via query params
 *
 * Permissões:
 *   agenda.view  → ler dados
 *   agenda.edit  → sincronizar e desconectar
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ChevronDown, ChevronRight,
  Link2, RefreshCw, Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

// ─── Constantes visuais ─────────────────────────────────────────────────────

const lbl: React.CSSProperties = {
  display: 'block', color: '#64748B', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.07em', marginBottom: 5, textTransform: 'uppercase',
};

const PROVIDER_META: Record<string, { label: string; letter: string; color: string; bg: string; borderColor: string }> = {
  google: {
    label: 'Google Calendar',
    letter: 'G',
    color: '#1D4ED8',
    bg: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  outlook: {
    label: 'Microsoft Outlook',
    letter: 'O',
    color: '#7C3AED',
    bg: '#F5F3FF',
    borderColor: '#DDD6FE',
  },
};

const INTEGRATION_STATUS: Record<string, { bg: string; color: string; dot: string; label: string }> = {
  active:  { bg: '#F0FDF4', color: '#166534', dot: '#16A34A', label: 'Ativo' },
  expired: { bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444', label: 'Expirado' },
  error:   { bg: '#FEF2F2', color: '#991B1B', dot: '#EF4444', label: 'Erro' },
  paused:  { bg: '#FFF7ED', color: '#9A3412', dot: '#F97316', label: 'Pausado' },
};

const LOG_STATUS: Record<string, { bg: string; color: string; label: string }> = {
  success: { bg: '#F0FDF4', color: '#166534', label: 'Sucesso' },
  partial: { bg: '#FFF7ED', color: '#9A3412', label: 'Parcial' },
  error:   { bg: '#FEF2F2', color: '#991B1B', label: 'Erro' },
};

// ─── Componente auxiliar: lida com query params do callback OAuth ────────────

function OAuthFeedback({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const integration = searchParams.get('integration');
    const provider    = searchParams.get('provider');
    const msg         = searchParams.get('msg');

    if (!integration) return;

    if (integration === 'connected') {
      const label = PROVIDER_META[provider ?? '']?.label ?? provider ?? 'Provider';
      toast.success(`${label} conectado com sucesso!`);
    } else if (integration === 'denied') {
      const label = PROVIDER_META[provider ?? '']?.label ?? provider ?? 'Provider';
      toast.error(`Conexão com ${label} cancelada pelo usuário.`);
    } else if (integration === 'error') {
      toast.error(`Erro ao conectar: ${msg ?? 'Erro desconhecido'}`);
    }

    // Limpa os params da URL sem recarregar a página
    router.replace('/dashboard/agenda/integracoes');
    onDone();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const { user } = useAuthStore();

  const [providers, setProviders]         = useState<Record<string, { available: boolean; label: string }> | null>(null);
  const [integrations, setIntegrations]   = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);

  // Estados de ação por item
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [syncingId,          setSyncingId]          = useState<string | null>(null);
  const [disconnectingId,    setDisconnectingId]     = useState<string | null>(null);
  const [expandedId,         setExpandedId]          = useState<string | null>(null);

  // Dados expandidos (por ID de integração)
  const [calendars,     setCalendars]     = useState<Record<string, any[]>>({});
  const [logs,          setLogs]          = useState<Record<string, any[]>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // ── Carregamento inicial ──────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rawProviders, rawIntegrations] = await Promise.all([
        api.getCalendarProviders(),
        api.getCalendarIntegrations(),
      ]);

      // providers → objeto { google: {...}, outlook: {...} }
      setProviders(rawProviders as any);

      // integrations → array diretamente após interceptor
      const list = Array.isArray(rawIntegrations)
        ? rawIntegrations
        : ((rawIntegrations as any)?.data ?? []);
      setIntegrations(list);
    } catch (e) {
      console.error('[IntegracoesPage] load error:', e);
      toast.error('Erro ao carregar integrações');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Guarda de permissão ───────────────────────────────────────────────────

  if (!hasPermission(user, 'agenda.view')) {
    return (
      <div className="space-y-6">
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
          Acesso negado. Você não tem permissão para visualizar integrações.
        </div>
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleConnect = async (provider: 'google' | 'outlook') => {
    setConnectingProvider(provider);
    try {
      const raw: any = await api.getCalendarConnectUrl(provider);
      // raw = { url: '...' } após interceptor
      const url = raw?.url ?? (raw as any)?.data?.url;
      if (!url) throw new Error('URL de autorização não retornada pelo servidor');
      // Navega o browser para o provider OAuth — JWT foi enviado via Bearer na chamada
      window.location.href = url;
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? e?.message ?? 'Erro ao iniciar conexão';
      toast.error(msg);
      setConnectingProvider(null);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const result: any = await api.syncIntegration(id);
      const { imported = 0, updated = 0, cancelled = 0, errors = 0 } = result ?? {};
      const parts: string[] = [];
      if (imported)  parts.push(`${imported} importado${imported !== 1 ? 's' : ''}`);
      if (updated)   parts.push(`${updated} atualizado${updated !== 1 ? 's' : ''}`);
      if (cancelled) parts.push(`${cancelled} cancelado${cancelled !== 1 ? 's' : ''}`);
      if (errors)    parts.push(`${errors} erro${errors !== 1 ? 's' : ''}`);
      toast.success(`Sync concluído${parts.length ? ': ' + parts.join(', ') : ' (sem novidades)'}`);

      // Refresca logs e dados da integração
      await load();
      if (expandedId === id) await loadDetail(id, true);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? e?.message ?? 'Erro na sincronização';
      toast.error(msg);
    }
    setSyncingId(null);
  };

  const handleDisconnect = async (id: string, providerLabel: string) => {
    if (!confirm(`Desconectar ${providerLabel}?\n\nEventos já importados NÃO serão removidos.`)) return;
    setDisconnectingId(id);
    try {
      await api.disconnectIntegration(id);
      toast.success('Integração desconectada com sucesso');
      setIntegrations(prev => prev.filter(i => i.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? e?.message ?? 'Erro ao desconectar';
      toast.error(msg);
    }
    setDisconnectingId(null);
  };

  const loadDetail = async (id: string, forceRefresh = false) => {
    if (calendars[id] && !forceRefresh) return; // já carregado
    setLoadingDetail(id);
    try {
      const [rawCals, rawLogs] = await Promise.all([
        api.getIntegrationCalendars(id),
        api.getIntegrationLogs(id),
      ]);
      const calList  = Array.isArray(rawCals)  ? rawCals  : ((rawCals  as any)?.data ?? []);
      const logList  = Array.isArray(rawLogs)  ? rawLogs  : ((rawLogs  as any)?.data ?? []);
      setCalendars(prev => ({ ...prev, [id]: calList }));
      setLogs(prev      => ({ ...prev, [id]: logList }));
    } catch (e) {
      console.error('[IntegracoesPage] loadDetail error:', e);
    }
    setLoadingDetail(null);
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      loadDetail(id);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const providerIsConnected = (provider: string) =>
    integrations.some(i => i.provider === provider);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Lida com query params do callback OAuth sem quebrar SSR */}
      <Suspense fallback={null}>
        <OAuthFeedback onDone={() => load()} />
      </Suspense>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg,#7C3AED,#6366F1)',
              boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
            }}
          >
            <Link2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Integrações de Agenda</h1>
            <p className="page-subtitle">
              Google Calendar · Microsoft Outlook ·{' '}
              {integrations.length} conta{integrations.length !== 1 ? 's' : ''} conectada{integrations.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/agenda"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: '#64748B', fontSize: 13, textDecoration: 'none', fontWeight: 500,
          }}
        >
          <ArrowLeft style={{ width: 14, height: 14 }} /> Voltar à Agenda
        </Link>
      </div>

      {/* ── Conectar Conta ── */}
      <div className="card p-5">
        <h2 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
          Conectar Conta
        </h2>
        <p style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>
          Importe eventos do Google Calendar ou Outlook para a sua agenda. Somente leitura — nenhuma alteração é feita no provider.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {(['google', 'outlook'] as const).map(provider => {
            const meta         = PROVIDER_META[provider];
            const isAvailable  = providers?.[provider]?.available ?? false;
            const isConnected  = providerIsConnected(provider);
            const isConnecting = connectingProvider === provider;
            const canEdit      = hasPermission(user, 'agenda.edit');

            return (
              <div
                key={provider}
                style={{
                  border: `1.5px solid ${isConnected ? meta.borderColor : '#E2E8F0'}`,
                  borderRadius: 12,
                  padding: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: isConnected ? meta.bg : '#fff',
                  transition: 'border-color 0.15s',
                }}
              >
                {/* Ícone do provider */}
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: meta.bg,
                  border: `1.5px solid ${meta.borderColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 20, fontWeight: 900, color: meta.color, lineHeight: 1 }}>
                    {meta.letter}
                  </span>
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                    {meta.label}
                  </div>
                  {!isAvailable && (
                    <div style={{ fontSize: 12, color: '#94A3B8' }}>
                      Não configurado neste servidor
                    </div>
                  )}
                  {isAvailable && isConnected && (
                    <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 600 }}>
                      ✓ Conta conectada
                    </div>
                  )}
                  {isAvailable && !isConnected && (
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      Disponível — clique para conectar
                    </div>
                  )}
                </div>

                {/* Ação */}
                {isAvailable && canEdit ? (
                  <button
                    onClick={() => handleConnect(provider)}
                    disabled={isConnecting || !!connectingProvider}
                    style={{
                      padding: '7px 16px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 8,
                      border: `1.5px solid ${isConnected ? meta.borderColor : meta.color}`,
                      background: isConnected ? '#fff' : meta.bg,
                      color: meta.color,
                      cursor: (isConnecting || !!connectingProvider) ? 'not-allowed' : 'pointer',
                      opacity: (isConnecting || (!!connectingProvider && !isConnecting)) ? 0.6 : 1,
                      flexShrink: 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {isConnecting ? 'Abrindo...' : isConnected ? 'Reconectar' : 'Conectar'}
                  </button>
                ) : !isAvailable ? (
                  <span style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700,
                    borderRadius: 20, background: '#F1F5F9', color: '#94A3B8',
                    flexShrink: 0,
                  }}>
                    Inativo
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Contas Conectadas ── */}
      <div className="card overflow-hidden">
        {/* Cabeçalho da seção */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #F1F5F9',
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#FAFBFC',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: '#F5F3FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Link2 style={{ width: 15, height: 15, color: '#7C3AED' }} />
          </div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', margin: 0 }}>
            Contas Conectadas
          </h3>
          <span style={{
            background: '#F5F3FF', color: '#7C3AED',
            padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          }}>
            {integrations.length}
          </span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 14 }}>
            Carregando...
          </div>
        )}

        {/* Empty state */}
        {!loading && integrations.length === 0 && (
          <div style={{ padding: 52, textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: '#F5F3FF',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Link2 style={{ width: 26, height: 26, color: '#A78BFA' }} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#0F172A', marginBottom: 6 }}>
              Nenhuma conta conectada
            </p>
            <p style={{ fontSize: 13, color: '#94A3B8' }}>
              Conecte o Google Calendar ou Outlook acima para importar eventos automaticamente.
            </p>
          </div>
        )}

        {/* Lista de integrações */}
        {!loading && integrations.map((integration: any) => {
          const meta         = PROVIDER_META[integration.provider] ?? { label: integration.provider, letter: '?', color: '#64748B', bg: '#F1F5F9', borderColor: '#E2E8F0' };
          const st           = INTEGRATION_STATUS[integration.status] ?? { bg: '#F1F5F9', color: '#64748B', dot: '#94A3B8', label: integration.status };
          const isExpanded   = expandedId === integration.id;
          const isSyncing    = syncingId === integration.id;
          const isDisconn    = disconnectingId === integration.id;
          const isLoadDet    = loadingDetail === integration.id;
          const canEdit      = hasPermission(user, 'agenda.edit');

          return (
            <div key={integration.id} style={{ borderBottom: '1px solid #F1F5F9' }}>

              {/* ── Linha principal ── */}
              <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>

                {/* Ícone do provider */}
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  background: meta.bg, border: `1.5px solid ${meta.borderColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: meta.color, lineHeight: 1 }}>
                    {meta.letter}
                  </span>
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 3 }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>
                    {integration.providerAccount || 'Conta desconhecida'}
                    {integration.lastSyncedAt ? (
                      <> · Último sync: {format(new Date(integration.lastSyncedAt), "dd/MM/yy 'às' HH:mm", { locale: ptBR })}</>
                    ) : (
                      <> · Nunca sincronizado</>
                    )}
                  </div>
                </div>

                {/* Badge de status */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: st.bg, color: st.color,
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  flexShrink: 0,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />
                  {st.label}
                </span>

                {/* Botões de ação */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {canEdit && (
                    <button
                      onClick={() => handleSync(integration.id)}
                      disabled={isSyncing || !!syncingId}
                      title="Sincronizar agora"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: '1.5px solid #BFDBFE',
                        background: '#EFF6FF', color: '#1D4ED8',
                        cursor: (isSyncing || !!syncingId) ? 'not-allowed' : 'pointer',
                        opacity: isSyncing ? 0.7 : (!!syncingId && !isSyncing) ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <RefreshCw style={{ width: 13, height: 13 }} />
                      {isSyncing ? 'Sincronizando...' : 'Sync'}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => handleDisconnect(integration.id, meta.label)}
                      disabled={isDisconn || !!disconnectingId}
                      title="Desconectar conta"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', fontSize: 12, fontWeight: 600,
                        borderRadius: 8, border: '1.5px solid #FECACA',
                        background: '#FEF2F2', color: '#DC2626',
                        cursor: (isDisconn || !!disconnectingId) ? 'not-allowed' : 'pointer',
                        opacity: isDisconn ? 0.7 : (!!disconnectingId && !isDisconn) ? 0.4 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <Trash2 style={{ width: 13, height: 13 }} />
                      {isDisconn ? 'Removendo...' : 'Desconectar'}
                    </button>
                  )}
                  {/* Expandir / Recolher detalhes */}
                  <button
                    onClick={() => toggleExpand(integration.id)}
                    title={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: 8,
                      border: '1.5px solid #E2E8F0', background: '#fff',
                      color: '#64748B', cursor: 'pointer',
                    }}
                  >
                    {isExpanded
                      ? <ChevronDown  style={{ width: 15, height: 15 }} />
                      : <ChevronRight style={{ width: 15, height: 15 }} />
                    }
                  </button>
                </div>
              </div>

              {/* ── Painel expandido ── */}
              {isExpanded && (
                <div style={{
                  background: '#FAFBFC',
                  borderTop: '1px solid #F1F5F9',
                  padding: '20px 24px',
                }}>
                  {isLoadDet ? (
                    <div style={{ color: '#94A3B8', fontSize: 13 }}>Carregando detalhes...</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>

                      {/* Calendários */}
                      <div>
                        <div style={lbl}>Calendários da conta</div>
                        {(calendars[integration.id] ?? []).length === 0 && (
                          <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>
                            Nenhum calendário disponível
                          </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {(calendars[integration.id] ?? []).map((cal: any) => (
                            <div
                              key={cal.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 0',
                                borderBottom: '1px solid #F1F5F9',
                              }}
                            >
                              <span style={{
                                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                                background: cal.backgroundColor ?? cal.color ?? '#6366F1',
                              }} />
                              <span style={{ fontSize: 13, color: '#0F172A', flex: 1 }}>
                                {cal.summary ?? cal.name ?? cal.id}
                              </span>
                              {(cal.primary || cal.isDefault) && (
                                <span style={{
                                  fontSize: 10, fontWeight: 700, color: '#6366F1',
                                  background: '#EEF2FF', padding: '2px 7px', borderRadius: 10,
                                }}>
                                  Principal
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Histórico de sync */}
                      <div>
                        <div style={lbl}>Histórico de Sync</div>
                        {(logs[integration.id] ?? []).length === 0 && (
                          <div style={{ fontSize: 13, color: '#94A3B8', padding: '8px 0' }}>
                            Nenhuma sincronização realizada ainda.{' '}
                            {hasPermission(user, 'agenda.edit') && (
                              <button
                                onClick={() => handleSync(integration.id)}
                                style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}
                              >
                                Sincronizar agora
                              </button>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {(logs[integration.id] ?? []).slice(0, 6).map((log: any) => {
                            const ls = LOG_STATUS[log.status] ?? { bg: '#F1F5F9', color: '#64748B', label: log.status };
                            return (
                              <div
                                key={log.id}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 10,
                                  padding: '6px 0', borderBottom: '1px solid #F1F5F9',
                                  fontSize: 12,
                                }}
                              >
                                <span style={{
                                  padding: '2px 8px', borderRadius: 10,
                                  background: ls.bg, color: ls.color,
                                  fontWeight: 700, fontSize: 10, flexShrink: 0,
                                }}>
                                  {ls.label}
                                </span>
                                <span style={{ color: '#64748B', flex: 1 }}>
                                  {log.eventsSynced ?? 0} evento{(log.eventsSynced ?? 0) !== 1 ? 's' : ''} sincronizado{(log.eventsSynced ?? 0) !== 1 ? 's' : ''}
                                </span>
                                <span style={{ color: '#94A3B8', flexShrink: 0 }}>
                                  {log.startedAt
                                    ? format(new Date(log.startedAt), 'dd/MM HH:mm', { locale: ptBR })
                                    : '—'
                                  }
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {(logs[integration.id] ?? []).length > 6 && (
                          <div style={{ fontSize: 12, color: '#94A3B8', paddingTop: 6 }}>
                            Exibindo os 6 mais recentes de {(logs[integration.id] ?? []).length} registros
                          </div>
                        )}
                      </div>

                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Nota de rodapé ── */}
      <div style={{
        fontSize: 12, color: '#94A3B8', textAlign: 'center',
        padding: '4px 0 8px',
      }}>
        Somente leitura · Eventos importados aparecem na{' '}
        <Link href="/dashboard/agenda" style={{ color: '#6366F1', textDecoration: 'none' }}>
          Agenda
        </Link>{' '}
        com origem Google ou Outlook · Nenhuma alteração é feita no provider.
      </div>
    </div>
  );
}
