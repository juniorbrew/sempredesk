'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import {
  Smartphone, Wifi, WifiOff, RefreshCw, LogOut, CheckCircle,
  AlertCircle, Loader2, Save, Eye, EyeOff, Copy, Info,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
type ConnectionMode = 'idle' | 'user-initiated' | 'auto-reconnecting';
type ActiveTab = 'qr' | 'channels';

interface ConnectionInfo {
  status: ConnectionStatus;
  provider: 'baileys' | 'meta';
  phoneNumber?: string | null;
  reconnecting?: boolean;
}

interface ChannelInfo {
  id: string;
  label: string;
  provider: 'baileys' | 'meta';
  isDefault: boolean;
  status: string | null;
  metaPhoneNumberId: string | null;
  metaToken: string | null;
  metaVerifyToken: string | null;
  metaWebhookUrl: string | null;
  metaWabaId: string | null;
  configured: boolean;
  createdAt: string;
}

interface ChannelForm {
  label: string;
  metaPhoneNumberId: string;
  metaToken: string;
  metaVerifyToken: string;
  metaWebhookUrl: string;
  metaWabaId: string;
  isDefault: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin + '/api/v1';
  }
  return 'http://localhost:4000/api/v1';
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; bg: string; color: string; dot: string }> = {
    disconnected: { label: 'Desconectado', bg: '#FEF2F2', color: '#EF4444', dot: '#EF4444' },
    connecting:   { label: 'Conectando…',  bg: '#FFFBEB', color: '#D97706', dot: '#F59E0B' },
    connected:    { label: 'Conectado',    bg: '#ECFDF5', color: '#059669', dot: '#10B981' },
  };
  const s = map[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 20,
      background: s.bg, color: s.color,
      fontSize: 13, fontWeight: 600,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: s.dot,
        boxShadow: status === 'connecting' ? '0 0 0 2px rgba(245,158,11,.3)' : undefined,
      }} />
      {s.label}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: '#94A3B8', margin: 0 }}>{hint}</p>}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #E2E8F0', background: '#F8FAFC',
  fontSize: 14, color: '#1E293B', outline: 'none',
};

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WhatsappPage() {
  const [tab, setTab] = useState<ActiveTab>('qr');
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [loadingConn, setLoadingConn] = useState(true);

  // QR tab state
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('idle');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Channels tab state
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelsError, setChannelsError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [channelForm, setChannelForm] = useState<ChannelForm>({
    label: '', metaPhoneNumberId: '', metaToken: '',
    metaVerifyToken: 'sempredesk-verify', metaWebhookUrl: '', metaWabaId: '', isDefault: false,
  });
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelFormError, setChannelFormError] = useState('');
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [showChannelToken, setShowChannelToken] = useState(false);

  const [copied, setCopied] = useState(false);

  // ── Fetch connection info ───────────────────────────────────────────────

  const fetchConn = useCallback(async (): Promise<ConnectionInfo | null> => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/connection`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const json = await res.json();
      const data: ConnectionInfo = json?.data ?? json;
      if (data) {
        setConn(data);
      }
      return data ?? null;
    } catch {
      return null;
    } finally {
      setLoadingConn(false);
    }
  }, []);

  // ── Poll QR image ───────────────────────────────────────────────────────

  const fetchQr = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/qr`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        const qr = json?.data?.qr ?? json?.qr ?? null;
        if (qr) setQrImage(qr);
      }
    } catch {
      // silent
    }
  }, []);

  const fetchConnStatus = useCallback(async (): Promise<ConnectionStatus | null> => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/connection`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const json = await res.json();
        const d = json?.data ?? json;
        setConn(d);
        return d?.status ?? null;
      }
    } catch {
      // silent
    }
    return null;
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const status = await fetchConnStatus();
      if (status === 'connecting') {
        await fetchQr();
      } else if (status === 'connected' || status === 'disconnected') {
        // Stop polling once we reach a terminal state
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setQrImage(null);
        setConnecting(false);
        setConnectionMode('idle');
      }
    }, 3000);
  }, [fetchConnStatus, fetchQr]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    fetchConn().then((data) => {
      // If the backend is already reconnecting when the page opens,
      // start polling automatically — no user action needed
      if (data?.status === 'connecting') {
        setConnectionMode('auto-reconnecting');
        startPolling();
      }
    });
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    setConnecting(true);
    setConnectionMode('user-initiated');
    setQrImage(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      await fetch(`${base}/webhooks/whatsapp/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      setConn(c => c ? { ...c, status: 'connecting' } : { status: 'connecting', provider: 'baileys' });
      // Start polling immediately for QR and status updates
      startPolling();
    } catch {
      setConnecting(false);
      setConnectionMode('idle');
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    stopPolling();
    setQrImage(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      await fetch(`${base}/webhooks/whatsapp/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      await fetchConn();
    } catch {
      // silent
    } finally {
      setDisconnecting(false);
      setConnecting(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Channels actions ────────────────────────────────────────────────────

  const fetchChannels = useCallback(async () => {
    setLoadingChannels(true);
    setChannelsError('');
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/channels`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Erro ao carregar canais');
      const json = await res.json();
      setChannels(json?.data ?? json ?? []);
    } catch {
      setChannelsError('Não foi possível carregar os canais. Verifique a conexão.');
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const handleAddChannel = async () => {
    setChannelFormError('');
    if (!channelForm.metaPhoneNumberId.trim() || !channelForm.metaToken.trim()) {
      setChannelFormError('Phone Number ID e Token são obrigatórios.');
      return;
    }
    setSavingChannel(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/channels`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          label: channelForm.label.trim() || undefined,
          metaPhoneNumberId: channelForm.metaPhoneNumberId.trim(),
          metaToken: channelForm.metaToken.trim(),
          metaVerifyToken: channelForm.metaVerifyToken.trim() || 'sempredesk-verify',
          metaWebhookUrl: channelForm.metaWebhookUrl.trim() || undefined,
          metaWabaId: channelForm.metaWabaId.trim() || undefined,
          isDefault: channelForm.isDefault,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setChannelFormError(json?.message || 'Erro ao adicionar canal.');
        return;
      }
      setShowAddForm(false);
      setChannelForm({ label: '', metaPhoneNumberId: '', metaToken: '', metaVerifyToken: 'sempredesk-verify', metaWebhookUrl: '', metaWabaId: '', isDefault: false });
      setShowChannelToken(false);
      await fetchChannels();
    } catch {
      setChannelFormError('Erro de conexão ao salvar canal.');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    setSettingDefaultId(id);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      await fetch(`${base}/webhooks/whatsapp/channels/${id}/default`, {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      await fetchChannels();
    } catch {
      // silent — user verá a lista inalterada
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDeleteChannel = async (id: string, label: string) => {
    if (!window.confirm(`Remover o canal "${label}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingChannelId(id);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/channels/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json?.message || 'Não foi possível remover o canal.');
        return;
      }
      await fetchChannels();
    } catch {
      alert('Erro de conexão ao remover canal.');
    } finally {
      setDeletingChannelId(null);
    }
  };

  // useEffect de channels — declarado APÓS fetchChannels para evitar TDZ
  useEffect(() => {
    if (tab === 'channels') fetchChannels();
  }, [tab, fetchChannels]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const status: ConnectionStatus = conn?.status ?? 'disconnected';
  const webhookUrl = `${getApiBase()}/webhooks/whatsapp`;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Smartphone size={22} color="#fff" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1E293B' }}>
            WhatsApp
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: '#64748B' }}>
            Gerencie a integração do WhatsApp com o SempreDesk
          </p>
        </div>
        {!loadingConn && conn && (
          <div style={{ marginLeft: 'auto' }}>
            <StatusBadge status={status} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1.5px solid #E2E8F0', paddingBottom: 0 }}>
        {([
          { key: 'qr', label: 'Conexão QR Code' },
          { key: 'channels', label: 'Canais WhatsApp' },
        ] as { key: ActiveTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 18px', border: 'none', cursor: 'pointer',
              background: 'none', fontSize: 14, fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? '#4F46E5' : '#64748B',
              borderBottom: tab === t.key ? '2.5px solid #4F46E5' : '2.5px solid transparent',
              marginBottom: -1.5, transition: 'all .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: QR Code ── */}
      {tab === 'qr' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Status card */}
          <div style={{
            background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0',
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: '#64748B', fontWeight: 500 }}>Status da conexão</p>
                {loadingConn
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: '#F1F5F9', color: '#94A3B8', fontSize: 13, fontWeight: 600 }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Verificando…
                    </span>
                  : <StatusBadge status={status} />
                }
                {!loadingConn && status === 'connected' && conn?.phoneNumber && (
                  <p style={{ margin: '8px 0 0', fontSize: 14, color: '#1E293B', fontWeight: 600 }}>
                    Número: +{conn.phoneNumber}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                {!loadingConn && status === 'disconnected' && (
                  <button
                    onClick={handleConnect}
                    disabled={connecting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '9px 18px', borderRadius: 9,
                      background: '#25D366', color: '#fff', border: 'none',
                      fontWeight: 600, fontSize: 14, cursor: connecting ? 'not-allowed' : 'pointer',
                      opacity: connecting ? 0.7 : 1,
                    }}
                  >
                    {connecting
                      ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Iniciando…</>
                      : <><Wifi size={16} /> Conectar via QR Code</>
                    }
                  </button>
                )}

                {/* Only show "Gerar novo QR" when user explicitly started the process */}
                {!loadingConn && status === 'connecting' && connectionMode === 'user-initiated' && !connecting && (
                  <button
                    onClick={handleConnect}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '9px 18px', borderRadius: 9,
                      background: '#F1F5F9', color: '#475569', border: '1.5px solid #E2E8F0',
                      fontWeight: 600, fontSize: 14, cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={15} /> Gerar novo QR
                  </button>
                )}

                {!loadingConn && (status === 'connected' || status === 'connecting') && (
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '9px 18px', borderRadius: 9,
                      background: '#FEF2F2', color: '#EF4444',
                      border: '1.5px solid #FECACA',
                      fontWeight: 600, fontSize: 14, cursor: disconnecting ? 'not-allowed' : 'pointer',
                      opacity: disconnecting ? 0.7 : 1,
                    }}
                  >
                    {disconnecting
                      ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Desconectando…</>
                      : <><LogOut size={15} /> Desconectar</>
                    }
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Auto-reconnecting notice — shown when backend is reconnecting in background */}
          {status === 'connecting' && connectionMode === 'auto-reconnecting' && (
            <div style={{
              background: '#FFFBEB', borderRadius: 14, border: '1.5px solid #FDE68A',
              padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <Loader2 size={22} color="#D97706" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: '#92400E', fontSize: 14 }}>
                  Reconectando ao WhatsApp…
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#78350F' }}>
                  A sessão está sendo restaurada automaticamente. Aguarde alguns segundos.
                </p>
              </div>
            </div>
          )}

          {/* QR Code display — only shown when user explicitly clicked "Connect" */}
          {(connectionMode === 'user-initiated' || qrImage) && (
            <div style={{
              background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0',
              padding: '28px 24px', textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,.06)',
            }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#1E293B' }}>
                Escaneie o QR Code
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#64748B' }}>
                Abra o WhatsApp no celular &rarr; Dispositivos conectados &rarr; Conectar um dispositivo
              </p>

              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 280, height: 280, borderRadius: 16,
                border: '2px solid #E2E8F0', background: '#F8FAFC',
                margin: '0 auto',
              }}>
                {qrImage ? (
                  <img
                    src={qrImage}
                    alt="QR Code WhatsApp"
                    style={{ width: 256, height: 256, borderRadius: 12 }}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: '#94A3B8' }}>
                    <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#25D366' }} />
                    <span style={{ fontSize: 13 }}>Aguardando QR Code…</span>
                  </div>
                )}
              </div>

              {qrImage && (
                <p style={{ margin: '16px 0 0', fontSize: 12, color: '#94A3B8' }}>
                  O QR Code é atualizado automaticamente a cada 60 segundos
                </p>
              )}
            </div>
          )}

          {/* Connected info */}
          {status === 'connected' && (
            <div style={{
              background: '#ECFDF5', borderRadius: 14, border: '1.5px solid #A7F3D0',
              padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <CheckCircle size={28} color="#059669" style={{ flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: '#065F46', fontSize: 15 }}>WhatsApp conectado com sucesso!</p>
                <p style={{ margin: '4px 0 0', color: '#047857', fontSize: 13 }}>
                  As mensagens recebidas serão automaticamente convertidas em tickets no SempreDesk.
                </p>
              </div>
            </div>
          )}

          {/* Disconnected info */}
          {status === 'disconnected' && !connecting && (
            <div style={{
              background: '#F8FAFC', borderRadius: 14, border: '1.5px solid #E2E8F0',
              padding: '20px 24px',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Info size={18} color="#64748B" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ margin: '0 0 8px', fontWeight: 600, color: '#1E293B', fontSize: 14 }}>
                    Como funciona a conexão via QR Code
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#475569', fontSize: 13, lineHeight: 1.7 }}>
                    <li>Clique em &quot;Conectar via QR Code&quot; para gerar o QR</li>
                    <li>Abra o WhatsApp no seu celular</li>
                    <li>Acesse <strong>Configurações &rarr; Dispositivos conectados &rarr; Conectar um dispositivo</strong></li>
                    <li>Escaneie o QR Code exibido na tela</li>
                    <li>Aguarde a confirmação de conexão</li>
                  </ul>
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: '#94A3B8' }}>
                    Nota: Esta integração usa a biblioteca Baileys (não oficial). Para produção em larga escala, considere a API Oficial Meta.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Canais WhatsApp ── */}
      {tab === 'channels' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Status de conexão Meta — resumo dos canais configurados */}
          {channels.length > 0 && (
            <div style={{
              background: channels.some(c => c.configured) ? '#ECFDF5' : '#FEF2F2',
              borderRadius: 14,
              border: `1.5px solid ${channels.some(c => c.configured) ? '#A7F3D0' : '#FECACA'}`,
              padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              {channels.some(c => c.configured)
                ? <CheckCircle size={18} color="#059669" style={{ flexShrink: 0 }} />
                : <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0 }} />
              }
              <span style={{
                fontSize: 13, fontWeight: 500,
                color: channels.some(c => c.configured) ? '#065F46' : '#991B1B',
              }}>
                {channels.some(c => c.configured)
                  ? `${channels.filter(c => c.configured).length} canal(is) Meta configurado(s) e pronto(s) para receber mensagens.`
                  : 'Nenhum canal está totalmente configurado. Verifique o Phone Number ID e o Token.'
                }
              </span>
            </div>
          )}

          {/* URL do Webhook */}
          <div style={{
            background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0',
            padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 14, color: '#1E293B' }}>
              URL do Webhook
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#64748B' }}>
              Configure esta URL no Meta Developer Console como <em>Callback URL</em>. Use o <strong>Verify Token</strong> configurado em cada canal.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                background: '#F1F5F9', border: '1.5px solid #E2E8F0',
                fontSize: 13, color: '#334155', wordBreak: 'break-all',
              }}>
                {webhookUrl}
              </code>
              <button
                onClick={copyWebhookUrl}
                title="Copiar URL"
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: copied ? '#ECFDF5' : '#F1F5F9',
                  border: `1.5px solid ${copied ? '#A7F3D0' : '#E2E8F0'}`,
                  color: copied ? '#059669' : '#475569',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 13, fontWeight: 600, flexShrink: 0,
                }}
              >
                <Copy size={14} />
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          {/* Header da aba */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 14, color: '#64748B' }}>
                Gerencie múltiplos números da API Oficial Meta. O canal <strong>padrão</strong> é usado como fallback quando a conversa não tem canal definido.
              </p>
            </div>
            <button
              onClick={() => { setShowAddForm(v => !v); setChannelFormError(''); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 18px', borderRadius: 9,
                background: showAddForm ? '#F1F5F9' : '#4F46E5',
                color: showAddForm ? '#475569' : '#fff',
                border: showAddForm ? '1.5px solid #E2E8F0' : 'none',
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
              }}
            >
              {showAddForm ? '✕ Cancelar' : '+ Adicionar Canal'}
            </button>
          </div>

          {/* Formulário de adição */}
          {showAddForm && (
            <div style={{
              background: '#fff', borderRadius: 14, border: '1.5px solid #C7D2FE',
              padding: '22px 24px', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
            }}>
              <p style={{ margin: '0 0 18px', fontWeight: 700, fontSize: 15, color: '#1E293B' }}>
                Novo Canal Meta
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Nome / Rótulo" hint="Ex: Suporte, Vendas, Número Principal">
                  <input
                    style={INPUT_STYLE}
                    placeholder="Ex: Suporte"
                    value={channelForm.label}
                    onChange={e => setChannelForm(f => ({ ...f, label: e.target.value }))}
                  />
                </Field>
                <Field label="Phone Number ID *" hint="Encontrado no Meta Developer Console › WhatsApp › Configuração">
                  <input
                    style={INPUT_STYLE}
                    placeholder="Ex: 123456789012345"
                    value={channelForm.metaPhoneNumberId}
                    onChange={e => setChannelForm(f => ({ ...f, metaPhoneNumberId: e.target.value }))}
                  />
                </Field>
                <Field label="WABA ID" hint="WhatsApp Business Account ID (opcional, para templates)">
                  <input
                    style={INPUT_STYLE}
                    placeholder="Ex: 123456789012345"
                    value={channelForm.metaWabaId}
                    onChange={e => setChannelForm(f => ({ ...f, metaWabaId: e.target.value }))}
                  />
                </Field>
                <Field label="Token de Acesso *" hint="Token permanente gerado no Meta Business Suite">
                  <div style={{ position: 'relative' }}>
                    <input
                      style={{ ...INPUT_STYLE, paddingRight: 42 }}
                      type={showChannelToken ? 'text' : 'password'}
                      placeholder="Cole o token aqui"
                      value={channelForm.metaToken}
                      onChange={e => setChannelForm(f => ({ ...f, metaToken: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => setShowChannelToken(v => !v)}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {showChannelToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </Field>
                <Field label="Verify Token" hint="Token de verificação configurado no Meta">
                  <input
                    style={INPUT_STYLE}
                    placeholder="sempredesk-verify"
                    value={channelForm.metaVerifyToken}
                    onChange={e => setChannelForm(f => ({ ...f, metaVerifyToken: e.target.value }))}
                  />
                </Field>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    id="channel-is-default"
                    type="checkbox"
                    checked={channelForm.isDefault}
                    onChange={e => setChannelForm(f => ({ ...f, isDefault: e.target.checked }))}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <label htmlFor="channel-is-default" style={{ fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                    Definir como canal padrão
                  </label>
                </div>
              </div>

              {channelFormError && (
                <div style={{
                  marginTop: 14, padding: '10px 14px', borderRadius: 8,
                  background: '#FEF2F2', border: '1.5px solid #FECACA',
                  display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626', fontSize: 13,
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  {channelFormError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, gap: 10 }}>
                <button
                  onClick={() => { setShowAddForm(false); setChannelFormError(''); }}
                  style={{
                    padding: '9px 18px', borderRadius: 9, background: '#F1F5F9',
                    color: '#475569', border: '1.5px solid #E2E8F0',
                    fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddChannel}
                  disabled={savingChannel}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '9px 20px', borderRadius: 9,
                    background: savingChannel ? '#A5B4FC' : '#4F46E5',
                    color: '#fff', border: 'none',
                    fontWeight: 600, fontSize: 14, cursor: savingChannel ? 'not-allowed' : 'pointer',
                  }}
                >
                  {savingChannel
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>
                    : <><Save size={14} /> Adicionar Canal</>
                  }
                </button>
              </div>
            </div>
          )}

          {/* Erro ao carregar */}
          {channelsError && (
            <div style={{
              padding: '14px 18px', borderRadius: 10,
              background: '#FEF2F2', border: '1.5px solid #FECACA',
              display: 'flex', alignItems: 'center', gap: 10, color: '#DC2626', fontSize: 13,
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              {channelsError}
              <button onClick={fetchChannels} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                Tentar novamente
              </button>
            </div>
          )}

          {/* Loading */}
          {loadingChannels && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: '#94A3B8', gap: 10 }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 14 }}>Carregando canais…</span>
            </div>
          )}

          {/* Lista de canais */}
          {!loadingChannels && !channelsError && channels.length === 0 && (
            <div style={{
              background: '#F8FAFC', borderRadius: 14, border: '1.5px dashed #CBD5E1',
              padding: '36px 24px', textAlign: 'center',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: '#64748B' }}>
                Nenhum canal configurado
              </p>
              <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>
                Clique em &ldquo;Adicionar Canal&rdquo; para configurar o primeiro número WhatsApp via API Oficial Meta.
              </p>
            </div>
          )}

          {!loadingChannels && channels.map(ch => (
            <div
              key={ch.id}
              style={{
                background: '#fff', borderRadius: 14,
                border: ch.isDefault ? '1.5px solid #C7D2FE' : '1.5px solid #E2E8F0',
                padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#1E293B' }}>{ch.label}</span>
                    {ch.isDefault && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: '#EEF2FF', color: '#4F46E5',
                      }}>
                        PADRÃO
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                      background: ch.configured ? '#ECFDF5' : '#FEF2F2',
                      color: ch.configured ? '#059669' : '#DC2626',
                    }}>
                      {ch.configured ? 'Configurado' : 'Incompleto'}
                    </span>
                  </div>
                  {ch.metaPhoneNumberId && (
                    <p style={{ margin: '0 0 2px', fontSize: 12, color: '#64748B' }}>
                      Phone Number ID: <code style={{ fontSize: 12, color: '#334155' }}>{ch.metaPhoneNumberId}</code>
                    </p>
                  )}
                  {ch.metaToken && (
                    <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>
                      Token: {ch.metaToken}
                    </p>
                  )}
                </div>

                {/* Ações */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {!ch.isDefault && (
                    <button
                      onClick={() => handleSetDefault(ch.id)}
                      disabled={settingDefaultId === ch.id}
                      title="Definir como padrão"
                      style={{
                        padding: '7px 14px', borderRadius: 8,
                        background: '#EEF2FF', color: '#4F46E5',
                        border: '1.5px solid #C7D2FE',
                        fontWeight: 600, fontSize: 12, cursor: settingDefaultId === ch.id ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', gap: 5,
                        opacity: settingDefaultId === ch.id ? 0.6 : 1,
                      }}
                    >
                      {settingDefaultId === ch.id
                        ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        : <CheckCircle size={12} />
                      }
                      Definir padrão
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteChannel(ch.id, ch.label)}
                    disabled={deletingChannelId === ch.id}
                    title="Remover canal"
                    style={{
                      padding: '7px 14px', borderRadius: 8,
                      background: '#FEF2F2', color: '#EF4444',
                      border: '1.5px solid #FECACA',
                      fontWeight: 600, fontSize: 12, cursor: deletingChannelId === ch.id ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                      opacity: deletingChannelId === ch.id ? 0.6 : 1,
                    }}
                  >
                    {deletingChannelId === ch.id
                      ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      : <WifiOff size={12} />
                    }
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
