'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { Bot, Save, Plus, Trash2, ChevronUp, ChevronDown, ToggleLeft, ToggleRight, MessageSquare, Zap, Users, Globe, Smartphone, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id?: string;
  order: number;
  label: string;
  action: 'auto_reply' | 'transfer';
  autoReplyText?: string;
  department?: string;
  enabled: boolean;
}

interface ChatbotConfig {
  id?: string;
  name: string;
  welcomeMessage: string;
  menuTitle: string;
  enabled: boolean;
  channelWhatsapp: boolean;
  channelWeb: boolean;
  channelPortal: boolean;
  transferMessage: string;
  noAgentMessage: string;
  invalidOptionMessage: string;
  sessionTimeoutMinutes: number;
  collectName: boolean;
  nameRequestMessage: string;
  /** Respostas do atendente ao cliente no WhatsApp com *nome* em negrito (formato do app). */
  whatsappPrefixAgentName?: boolean;
  menuItems?: MenuItem[];
}

interface Stats { totalSessions: number; activeSessions: number; transferred: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const S = {
  bg: '#F8FAFC', card: '#FFFFFF', border: '1px solid #E2E8F0',
  txt: '#0F172A', txt2: '#64748B', txt3: '#94A3B8',
  accent: '#4F46E5', accentL: '#EEF2FF',
  green: '#10B981', greenL: '#ECFDF5',
  red: '#EF4444', redL: '#FEF2F2',
};

const toast = (msg: string, ok = true) => {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:24px;right:24px;background:${ok ? S.green : S.red};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.18)`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatbotConfigPage() {
  const [config, setConfig] = useState<ChatbotConfig | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'general' | 'menu' | 'channels' | 'widget'>('general');
  const [tenantId, setTenantId] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, st, me]: any[] = await Promise.all([
        (api as any).getChatbotConfig(),
        (api as any).getChatbotStats().catch(() => null),
        api.me(),
      ]);
      setConfig(cfg);
      setMenu((cfg?.menuItems || []).map((m: any) => ({ ...m })));
      setStats(st);
      setTenantId(me?.tenantId || me?.data?.tenantId || '');
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const { menuItems, id, ...dto } = config as any;
      await (api as any).updateChatbotConfig(dto);
      toast('Configurações salvas!');
    } catch (e: any) { toast(e?.response?.data?.message || 'Erro ao salvar', false); }
    setSaving(false);
  };

  const saveMenu = async () => {
    setSaving(true);
    try {
      await (api as any).updateChatbotMenu({ items: menu });
      toast('Menu salvo!');
      load();
    } catch (e: any) { toast(e?.response?.data?.message || 'Erro ao salvar menu', false); }
    setSaving(false);
  };

  const addMenuItem = () => {
    const nextOrder = menu.length > 0 ? Math.max(...menu.map(m => m.order)) + 1 : 1;
    setMenu(m => [...m, { order: nextOrder, label: 'Nova opção', action: 'transfer', enabled: true }]);
  };

  const removeMenuItem = (idx: number) => setMenu(m => m.filter((_, i) => i !== idx).map((item, i) => ({ ...item, order: i + 1 })));
  const moveItem = (idx: number, dir: -1 | 1) => {
    const newMenu = [...menu];
    const target = idx + dir;
    if (target < 0 || target >= newMenu.length) return;
    [newMenu[idx], newMenu[target]] = [newMenu[target], newMenu[idx]];
    newMenu.forEach((m, i) => { m.order = i + 1; });
    setMenu(newMenu);
  };

  const updateMenuItem = (idx: number, patch: Partial<MenuItem>) =>
    setMenu(m => m.map((item, i) => i === idx ? { ...item, ...patch } : item));

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, color: S.txt2 }}>
      <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} /> Carregando...
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!config) return <div style={{ padding: 32, color: S.red }}>Erro ao carregar configurações do chatbot.</div>;

  const embedCode = `<script src="https://${typeof window !== 'undefined' ? window.location.host : ''}/api/v1/chatbot/widget.js?tenantId=${tenantId}"></script>`;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: S.accentL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={24} color={S.accent} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: S.txt }}>Chatbot</h1>
          <p style={{ margin: 0, fontSize: 13, color: S.txt2 }}>Configure o assistente virtual para atender seus clientes</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* ON/OFF toggle */}
          <button onClick={() => setConfig(c => c ? { ...c, enabled: !c.enabled } : c)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${config.enabled ? S.green : '#E2E8F0'}`, background: config.enabled ? S.greenL : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: config.enabled ? S.green : S.txt2 }}>
            {config.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            {config.enabled ? 'Ativo' : 'Inativo'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'Total de sessões', value: stats.totalSessions, color: S.accent },
            { label: 'Sessões ativas', value: stats.activeSessions, color: S.green },
            { label: 'Transferidos', value: stats.transferred, color: '#F59E0B' },
          ].map(s => (
            <div key={s.label} style={{ background: S.card, border: S.border, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: S.txt2, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#F1F5F9', borderRadius: 10, padding: 4 }}>
        {([
          { k: 'general', label: 'Geral', icon: <Bot size={14} /> },
          { k: 'menu', label: 'Menu', icon: <MessageSquare size={14} /> },
          { k: 'channels', label: 'Canais', icon: <Globe size={14} /> },
          { k: 'widget', label: 'Widget Web', icon: <Zap size={14} /> },
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600,
              background: tab === t.k ? S.card : 'transparent',
              color: tab === t.k ? S.accent : S.txt2,
              boxShadow: tab === t.k ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
            }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: GERAL ── */}
      {tab === 'general' && (
        <div style={{ background: S.card, border: S.border, borderRadius: 14, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field label="Nome do bot">
            <input value={config.name} onChange={e => setConfig(c => c ? { ...c, name: e.target.value } : c)}
              style={inp} />
          </Field>
          <Field label="Mensagem de boas-vindas">
            <textarea value={config.welcomeMessage} onChange={e => setConfig(c => c ? { ...c, welcomeMessage: e.target.value } : c)}
              rows={3} style={{ ...inp, resize: 'vertical' }} />
          </Field>
          <Field label="Título do menu">
            <input value={config.menuTitle} onChange={e => setConfig(c => c ? { ...c, menuTitle: e.target.value } : c)}
              style={inp} />
          </Field>
          <Field label="Mensagem ao transferir para atendente">
            <textarea value={config.transferMessage} onChange={e => setConfig(c => c ? { ...c, transferMessage: e.target.value } : c)}
              rows={2} style={{ ...inp, resize: 'vertical' }} />
          </Field>
          <Field label="Mensagem quando nenhum agente disponível">
            <textarea value={config.noAgentMessage} onChange={e => setConfig(c => c ? { ...c, noAgentMessage: e.target.value } : c)}
              rows={2} style={{ ...inp, resize: 'vertical' }} />
          </Field>
          <Field label="Mensagem de opção inválida">
            <input value={config.invalidOptionMessage} onChange={e => setConfig(c => c ? { ...c, invalidOptionMessage: e.target.value } : c)}
              style={inp} />
          </Field>
          <Field label="Timeout de sessão (minutos)">
            <input type="number" min={5} max={240} value={config.sessionTimeoutMinutes}
              onChange={e => setConfig(c => c ? { ...c, sessionTimeoutMinutes: parseInt(e.target.value) || 30 } : c)}
              style={{ ...inp, width: 100 }} />
          </Field>
          <Field label="Solicitar nome do contato (WhatsApp)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setConfig(c => c ? { ...c, collectName: !c.collectName } : c)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${config.collectName ? S.green : '#E2E8F0'}`, background: config.collectName ? S.greenL : '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: config.collectName ? S.green : S.txt2 }}>
                {config.collectName ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                {config.collectName ? 'Ativado' : 'Desativado'}
              </button>
              <span style={{ fontSize: 12, color: S.txt2 }}>Pede o nome antes de exibir o menu quando o contato não está cadastrado</span>
            </div>
          </Field>
          {config.collectName && (
            <Field label="Mensagem para solicitar o nome">
              <textarea value={config.nameRequestMessage} onChange={e => setConfig(c => c ? { ...c, nameRequestMessage: e.target.value } : c)}
                rows={2} style={{ ...inp, resize: 'vertical' }} />
            </Field>
          )}
          <SaveBtn saving={saving} onClick={saveConfig} />
        </div>
      )}

      {/* ── TAB: MENU ── */}
      {tab === 'menu' && (
        <div style={{ background: S.card, border: S.border, borderRadius: 14, padding: '22px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, color: S.txt, fontSize: 15 }}>Opções do Menu</div>
              <div style={{ fontSize: 12, color: S.txt2, marginTop: 2 }}>Configure até 9 opções. O cliente digita o número correspondente.</div>
            </div>
            <button onClick={addMenuItem} disabled={menu.length >= 9}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: S.accent, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: menu.length >= 9 ? 0.5 : 1 }}>
              <Plus size={15} /> Adicionar
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {menu.map((item, idx) => (
              <div key={idx} style={{ border: `1.5px solid ${item.enabled ? '#E2E8F0' : '#F1F5F9'}`, borderRadius: 10, padding: '14px 16px', background: item.enabled ? '#fff' : '#FAFBFC' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: S.accentL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: S.accent, flexShrink: 0 }}>
                    {item.order}
                  </div>
                  <input value={item.label} onChange={e => updateMenuItem(idx, { label: e.target.value })}
                    placeholder="Texto da opção" style={{ ...inp, flex: 1, margin: 0 }} />
                  <button onClick={() => updateMenuItem(idx, { enabled: !item.enabled })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: item.enabled ? S.green : S.txt3, padding: 4 }}>
                    {item.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.txt3, padding: 4, opacity: idx === 0 ? 0.3 : 1 }}>
                    <ChevronUp size={16} />
                  </button>
                  <button onClick={() => moveItem(idx, 1)} disabled={idx === menu.length - 1}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.txt3, padding: 4, opacity: idx === menu.length - 1 ? 0.3 : 1 }}>
                    <ChevronDown size={16} />
                  </button>
                  <button onClick={() => removeMenuItem(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.red, padding: 4 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>Ação</label>
                    <select value={item.action} onChange={e => updateMenuItem(idx, { action: e.target.value as any })}
                      style={{ ...inp, margin: 0 }}>
                      <option value="transfer">Transferir para atendente</option>
                      <option value="auto_reply">Resposta automática</option>
                    </select>
                  </div>
                  {item.action === 'transfer' ? (
                    <div>
                      <label style={lbl}>Departamento (opcional)</label>
                      <input value={item.department || ''} onChange={e => updateMenuItem(idx, { department: e.target.value })}
                        placeholder="Ex: Suporte, Financeiro..." style={{ ...inp, margin: 0 }} />
                    </div>
                  ) : (
                    <div>
                      <label style={lbl}>Texto da resposta automática</label>
                      <input value={item.autoReplyText || ''} onChange={e => updateMenuItem(idx, { autoReplyText: e.target.value })}
                        placeholder="Resposta enviada ao cliente..." style={{ ...inp, margin: 0 }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
            {menu.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: S.txt3, fontSize: 14 }}>
                Nenhuma opção configurada. Clique em &quot;Adicionar&quot; para começar.
              </div>
            )}
          </div>
          <div style={{ marginTop: 18 }}>
            <SaveBtn saving={saving} onClick={saveMenu} label="Salvar Menu" />
          </div>
        </div>
      )}

      {/* ── TAB: CANAIS ── */}
      {tab === 'channels' && (
        <div style={{ background: S.card, border: S.border, borderRadius: 14, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, color: S.txt2, marginBottom: 4 }}>
            Selecione os canais onde o chatbot deve atuar. Desativado = mensagens chegam direto ao atendimento humano.
          </div>
          {([
            { key: 'channelWhatsapp', label: 'WhatsApp', desc: 'Mensagens recebidas via QR Code (Baileys) ou API Meta', icon: <Smartphone size={20} color="#25D366" /> },
            { key: 'channelWeb', label: 'Chat Web (Widget)', desc: 'Widget flutuante incorporado em sites externos', icon: <Globe size={20} color={S.accent} /> },
            { key: 'channelPortal', label: 'Portal do Cliente', desc: 'Chat iniciado pelos clientes no portal web', icon: <Users size={20} color="#F59E0B" /> },
          ] as const).map(ch => (
            <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: `1.5px solid ${config[ch.key] ? S.green : '#E2E8F0'}`, borderRadius: 10, background: config[ch.key] ? S.greenL : '#fff' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', border: '1.5px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {ch.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: S.txt, fontSize: 14 }}>{ch.label}</div>
                <div style={{ fontSize: 12, color: S.txt2 }}>{ch.desc}</div>
              </div>
              <button onClick={() => setConfig(c => c ? { ...c, [ch.key]: !c[ch.key] } : c)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: config[ch.key] ? S.green : S.txt3 }}>
                {config[ch.key] ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
              </button>
            </div>
          ))}

          <div style={{ marginTop: 8, padding: '16px 18px', borderRadius: 12, border: `1.5px solid ${config.whatsappPrefixAgentName ? S.accent : '#E2E8F0'}`, background: config.whatsappPrefixAgentName ? S.accentL : '#FAFAFA' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', border: '1.5px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Smartphone size={20} color="#25D366" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: S.txt, fontSize: 14, marginBottom: 4 }}>Nome do agente nas respostas (WhatsApp)</div>
                <div style={{ fontSize: 12, color: S.txt2, lineHeight: 1.55, marginBottom: 10 }}>
                  Quando <strong>ativado</strong>, cada mensagem do atendente enviada ao cliente pelo WhatsApp começa com o nome em negrito, no formato do próprio WhatsApp (<code style={{ background: '#EEF2FF', padding: '1px 5px', borderRadius: 4 }}>*Nome Sobrenome*</code>), seguido do texto. O histórico no painel continua <strong>sem</strong> esse prefixo — só o cliente vê no aplicativo.
                </div>
                <button
                  type="button"
                  onClick={() => setConfig(c => (c ? { ...c, whatsappPrefixAgentName: !c.whatsappPrefixAgentName } : c))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: config.whatsappPrefixAgentName ? S.accent : S.txt3, display: 'flex', alignItems: 'center', gap: 8, padding: 0, fontSize: 13, fontWeight: 600 }}
                >
                  {config.whatsappPrefixAgentName ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  {config.whatsappPrefixAgentName ? 'Ativado: mostrar nome do agente' : 'Desativado'}
                </button>
              </div>
            </div>
          </div>

          <SaveBtn saving={saving} onClick={saveConfig} />
        </div>
      )}

      {/* ── TAB: WIDGET ── */}
      {tab === 'widget' && (
        <div style={{ background: S.card, border: S.border, borderRadius: 14, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div style={{ fontWeight: 700, color: S.txt, fontSize: 15, marginBottom: 6 }}>Incorporar Widget no seu Site</div>
            <div style={{ fontSize: 13, color: S.txt2, lineHeight: 1.6 }}>
              Cole o código abaixo antes do fechamento da tag <code style={{ background: '#F1F5F9', padding: '1px 6px', borderRadius: 4 }}>&lt;/body&gt;</code> no HTML do seu site.
            </div>
          </div>
          <div style={{ background: '#1E293B', borderRadius: 10, padding: '14px 16px', position: 'relative' }}>
            <code style={{ color: '#7DD3FC', fontSize: 12, whiteSpace: 'pre-wrap', display: 'block', lineHeight: 1.7 }}>
              {embedCode}
            </code>
            <button onClick={() => { navigator.clipboard.writeText(embedCode); toast('Código copiado!'); }}
              style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              Copiar
            </button>
          </div>

          <div style={{ background: S.accentL, borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 10 }}>
            <Zap size={18} color={S.accent} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: S.accent, lineHeight: 1.6 }}>
              <strong>Para ativar o widget:</strong> habilite o canal &quot;Chat Web&quot; na aba Canais e certifique-se que o chatbot está ativo. O widget aparecerá automaticamente no canto inferior direito do seu site.
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, color: S.txt, fontSize: 14, marginBottom: 10 }}>Pré-visualização</div>
            <div style={{ position: 'relative', height: 180, background: '#F1F5F9', borderRadius: 10, overflow: 'hidden', border: S.border }}>
              <div style={{ position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <div style={{ background: '#fff', borderRadius: 12, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.12)', maxWidth: 200, fontSize: 12, color: S.txt, border: S.border }}>
                  {config.welcomeMessage.slice(0, 60)}{config.welcomeMessage.length > 60 ? '...' : ''}
                </div>
                <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg,#4F46E5,#6366F1)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(79,70,229,.4)' }}>
                  <MessageSquare size={22} color="#fff" />
                </div>
              </div>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: S.txt3, fontSize: 13, textAlign: 'center' }}>
                Seu site aqui
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

function SaveBtn({ saving, onClick, label = 'Salvar Configurações' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} disabled={saving}
      style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 7, padding: '10px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#4F46E5,#6366F1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
      <Save size={15} />{saving ? 'Salvando...' : label}
    </button>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8,
  fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase',
  letterSpacing: '0.06em', display: 'block', marginBottom: 5,
};
