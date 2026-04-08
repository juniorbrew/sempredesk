'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import {
  Smartphone, Wifi, WifiOff, RefreshCw, LogOut, CheckCircle,
  AlertCircle, Loader2, Save, Eye, EyeOff, Copy, Info, ExternalLink,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';
type ConnectionMode = 'idle' | 'user-initiated' | 'auto-reconnecting';
type ActiveTab = 'qr' | 'meta';

interface ConnectionInfo {
  status: ConnectionStatus;
  provider: 'baileys' | 'meta';
  phoneNumber?: string | null;
  reconnecting?: boolean;
  meta?: {
    metaPhoneNumberId: string | null;
    metaToken: string | null;
    metaVerifyToken: string | null;
    metaWebhookUrl: string | null;
    configured: boolean;
  } | null;
}

interface MetaForm {
  metaPhoneNumberId: string;
  metaToken: string;
  metaVerifyToken: string;
  metaWebhookUrl: string;
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

  // Meta tab state
  const [metaForm, setMetaForm] = useState<MetaForm>({
    metaPhoneNumberId: '',
    metaToken: '',
    metaVerifyToken: 'sempredesk-verify',
    metaWebhookUrl: '',
  });
  const [showToken, setShowToken] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);
  const [metaError, setMetaError] = useState('');
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
        if (data.meta) {
          const m = data.meta;
          setMetaForm(f => ({
            ...f,
            metaPhoneNumberId: m.metaPhoneNumberId || '',
            metaVerifyToken: m.metaVerifyToken || 'sempredesk-verify',
            metaWebhookUrl: m.metaWebhookUrl || '',
          }));
        }
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

  const handleSaveMeta = async () => {
    setMetaError('');
    if (!metaForm.metaPhoneNumberId.trim() || !metaForm.metaToken.trim()) {
      setMetaError('Phone Number ID e Token são obrigatórios.');
      return;
    }
    setSavingMeta(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const base = getApiBase();
      const res = await fetch(`${base}/webhooks/whatsapp/config/meta`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          metaPhoneNumberId: metaForm.metaPhoneNumberId.trim(),
          metaToken: metaForm.metaToken.trim(),
          metaVerifyToken: metaForm.metaVerifyToken.trim() || 'sempredesk-verify',
          metaWebhookUrl: metaForm.metaWebhookUrl.trim() || undefined,
        }),
      });
      if (res.ok) {
        setMetaSaved(true);
        setTimeout(() => setMetaSaved(false), 3000);
        await fetchConn();
      } else {
        const json = await res.json().catch(() => ({}));
        setMetaError(json?.message || 'Erro ao salvar configuração.');
      }
    } catch {
      setMetaError('Erro de conexão ao salvar configuração.');
    } finally {
      setSavingMeta(false);
    }
  };

  const copyWebhookUrl = () => {
    const base = getApiBase();
    const url = `${base}/webhooks/whatsapp`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
          { key: 'meta', label: 'API Oficial Meta' },
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

      {/* ── Tab: Meta API ── */}
      {tab === 'meta' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Meta config status */}
          {conn?.meta?.configured && (
            <div style={{
              background: '#EFF6FF', borderRadius: 14, border: '1.5px solid #BFDBFE',
              padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <CheckCircle size={18} color="#2563EB" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: '#1D4ED8', fontWeight: 500 }}>
                API Oficial Meta está configurada.
              </span>
            </div>
          )}

          {/* Webhook URL */}
          <div style={{
            background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0',
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 15, color: '#1E293B' }}>
              URL do Webhook
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748B' }}>
              Configure esta URL no Meta Developer Console como a Callback URL do seu webhook.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                flex: 1, padding: '9px 12px', borderRadius: 8,
                background: '#F1F5F9', border: '1.5px solid #E2E8F0',
                fontSize: 13, color: '#334155', wordBreak: 'break-all',
              }}>
                {webhookUrl}
              </code>
              <button
                onClick={copyWebhookUrl}
                title="Copiar URL"
                style={{
                  padding: '9px 12px', borderRadius: 8,
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

          {/* Meta config form */}
          <div style={{
            background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0',
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          }}>
            <p style={{ margin: '0 0 18px', fontWeight: 700, fontSize: 15, color: '#1E293B' }}>
              Credenciais Meta
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Phone Number ID" hint="Encontrado em: Meta Developer Console › Seu App › WhatsApp › Configuração">
                <input
                  style={INPUT_STYLE}
                  placeholder="Ex: 123456789012345"
                  value={metaForm.metaPhoneNumberId}
                  onChange={e => setMetaForm(f => ({ ...f, metaPhoneNumberId: e.target.value }))}
                />
              </Field>

              <Field label="Token de Acesso (Permanente)" hint="Use um token permanente gerado no Meta Business Suite">
                <div style={{ position: 'relative' }}>
                  <input
                    style={{ ...INPUT_STYLE, paddingRight: 42 }}
                    type={showToken ? 'text' : 'password'}
                    placeholder={conn?.meta?.metaToken ? conn.meta.metaToken : 'Cole o token aqui'}
                    value={metaForm.metaToken}
                    onChange={e => setMetaForm(f => ({ ...f, metaToken: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(v => !v)}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8',
                      display: 'flex', alignItems: 'center',
                    }}
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <Field label="Verify Token" hint="Token de verificação que você definir no Meta Developer Console">
                <input
                  style={INPUT_STYLE}
                  placeholder="Ex: sempredesk-verify"
                  value={metaForm.metaVerifyToken}
                  onChange={e => setMetaForm(f => ({ ...f, metaVerifyToken: e.target.value }))}
                />
              </Field>

              <Field label="Webhook URL (opcional)" hint="Deixe em branco para usar a URL padrão do sistema">
                <input
                  style={INPUT_STYLE}
                  placeholder={webhookUrl}
                  value={metaForm.metaWebhookUrl}
                  onChange={e => setMetaForm(f => ({ ...f, metaWebhookUrl: e.target.value }))}
                />
              </Field>
            </div>

            {metaError && (
              <div style={{
                marginTop: 14, padding: '10px 14px', borderRadius: 8,
                background: '#FEF2F2', border: '1.5px solid #FECACA',
                display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626', fontSize: 13,
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                {metaError}
              </div>
            )}

            {metaSaved && (
              <div style={{
                marginTop: 14, padding: '10px 14px', borderRadius: 8,
                background: '#ECFDF5', border: '1.5px solid #A7F3D0',
                display: 'flex', alignItems: 'center', gap: 8, color: '#059669', fontSize: 13,
              }}>
                <CheckCircle size={15} style={{ flexShrink: 0 }} />
                Configuração salva com sucesso!
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={handleSaveMeta}
                disabled={savingMeta}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 22px', borderRadius: 9,
                  background: savingMeta ? '#A5B4FC' : '#4F46E5',
                  color: '#fff', border: 'none',
                  fontWeight: 600, fontSize: 14,
                  cursor: savingMeta ? 'not-allowed' : 'pointer',
                  transition: 'background .15s',
                }}
              >
                {savingMeta
                  ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>
                  : <><Save size={15} /> Salvar Configuração</>
                }
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div style={{
            background: '#FFFBEB', borderRadius: 14, border: '1.5px solid #FDE68A',
            padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Info size={18} color="#D97706" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#92400E', fontSize: 14 }}>
                  Como configurar no Meta Developer Console
                </p>
                <ol style={{ margin: 0, paddingLeft: 18, color: '#78350F', fontSize: 13, lineHeight: 1.8 }}>
                  <li>Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" style={{ color: '#B45309' }}>developers.facebook.com <ExternalLink size={11} style={{ verticalAlign: 'middle' }} /></a></li>
                  <li>Crie ou selecione seu aplicativo e adicione o produto <strong>WhatsApp</strong></li>
                  <li>Em <strong>Configuração</strong>, copie o <strong>Phone Number ID</strong> e gere um <strong>Token Permanente</strong></li>
                  <li>Em <strong>Webhooks</strong>, defina a URL acima como <em>Callback URL</em></li>
                  <li>Use o mesmo <strong>Verify Token</strong> configurado aqui</li>
                  <li>Assine os eventos: <code>messages</code></li>
                </ol>
              </div>
            </div>
          </div>
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
