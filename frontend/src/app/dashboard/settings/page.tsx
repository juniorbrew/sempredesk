'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  Building2, Mail, Clock, Palette, User, Save, RefreshCw, CheckCircle,
  Eye, EyeOff, Send, ChevronRight, Lock, Bell, Key, Plus,
  Trash2, Edit2, Copy, Shield, Globe, Inbox, Bot,
  ToggleLeft, ToggleRight, ChevronUp, ChevronDown, MessageSquare, Zap, Smartphone, Users,
} from 'lucide-react';

// ─── Chatbot types ────────────────────────────────────────────────────────────
interface ChatbotConfig {
  id?: string; name: string; welcomeMessage: string; menuTitle: string;
  enabled: boolean; channelWhatsapp: boolean; channelWeb: boolean; channelPortal: boolean;
  transferMessage: string; noAgentMessage: string; invalidOptionMessage: string;
  sessionTimeoutMinutes: number; menuItems?: ChatbotMenuItem[];
}
interface ChatbotMenuItem {
  id?: string; order: number; label: string; action: 'auto_reply' | 'transfer';
  autoReplyText?: string; department?: string; enabled: boolean;
}
const BOT_DEFAULT: ChatbotConfig = {
  name: 'Assistente Virtual', welcomeMessage: 'Olá! Seja bem-vindo. Como posso te ajudar hoje?',
  menuTitle: 'Escolha uma das opções abaixo:', enabled: false,
  channelWhatsapp: true, channelWeb: false, channelPortal: false,
  transferMessage: 'Aguarde, estou te conectando com um atendente...',
  noAgentMessage: 'Todos os atendentes estão ocupados. Entraremos em contato em breve.',
  invalidOptionMessage: 'Opção inválida. Por favor escolha uma opção do menu:',
  sessionTimeoutMinutes: 30,
};

interface Settings {
  companyName: string; companyEmail: string; companyPhone: string;
  companyAddress: string; companyCnpj: string; companyLogo: string;
  primaryColor: string; secondaryColor: string;
  smtpHost: string; smtpPort: string; smtpUser: string;
  smtpPass: string; smtpFrom: string; smtpSecure: string;
  slaLowHours: string; slaMediumHours: string; slaHighHours: string; slaCriticalHours: string;
  ticketCreatedNotify: string; ticketResolvedNotify: string; slaWarningNotify: string;
  escalationEmail: string;
  businessHours: any;
}
const DEFAULT: Settings = {
  companyName:'', companyEmail:'', companyPhone:'', companyAddress:'', companyCnpj:'', companyLogo:'',
  primaryColor:'#6366F1', secondaryColor:'#4F46E5',
  smtpHost:'', smtpPort:'587', smtpUser:'', smtpPass:'', smtpFrom:'', smtpSecure:'false',
  slaLowHours:'72', slaMediumHours:'48', slaHighHours:'24', slaCriticalHours:'4',
  ticketCreatedNotify:'false', ticketResolvedNotify:'true', slaWarningNotify:'true',
  escalationEmail:'',
  businessHours: { mon:{open:true,start:'08:00',end:'18:00'}, tue:{open:true,start:'08:00',end:'18:00'}, wed:{open:true,start:'08:00',end:'18:00'}, thu:{open:true,start:'08:00',end:'18:00'}, fri:{open:true,start:'08:00',end:'18:00'}, sat:{open:false,start:'08:00',end:'12:00'}, sun:{open:false,start:'08:00',end:'12:00'} },
};
const DAY_LABELS: Record<string,string> = { mon:'Segunda', tue:'Terça', wed:'Quarta', thu:'Quinta', fri:'Sexta', sat:'Sábado', sun:'Domingo' };

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label style={{ fontSize:12, fontWeight:600, color:'#64748B', display:'block' }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize:11, color:'#CBD5E1' }}>{hint}</p>}
    </div>
  );
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:0 }}>
      <div style={{ width:40, height:22, borderRadius:11, background: checked ? '#4F46E5' : '#E2E8F0', position:'relative', transition:'background .2s' }}>
        <div style={{ position:'absolute', top:2, left: checked ? 20 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }} />
      </div>
      {label && <span style={{ fontSize:13, color:'#475569', fontWeight:500 }}>{label}</span>}
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [profile, setProfile] = useState({ name:'', email:'', phone:'', currentPassword:'', newPassword:'', confirmPassword:'' });
  const [tab, setTab] = useState<'company'|'smtp'|'sla'|'visual'|'profile'|'notifications'|'business_hours'|'routing'|'webhooks'|'apikeys'|'inbound_email'|'chatbot'>('company');
  // Perfis (roles & permissions)
  const [allPerms, setAllPerms] = useState<Record<string, any[]>>({});
  const [roles, setRoles] = useState<any[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<string|null>(null);
  const [rolePermsDraft, setRolePermsDraft] = useState<string[]>([]);
  const [rolesSaving, setRolesSaving] = useState(false);
  const [rolesSaved, setRolesSaved] = useState(false);
  // Chatbot
  const [botConfig, setBotConfig] = useState<ChatbotConfig>(BOT_DEFAULT);
  const [botMenu, setBotMenu] = useState<ChatbotMenuItem[]>([]);
  const [botStats, setBotStats] = useState<any>(null);
  const [botSaving, setBotSaving] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpResult, setSmtpResult] = useState<{success:boolean;message:string}|null>(null);
  const [profileError, setProfileError] = useState('');
  // Routing Rules
  const [rules, setRules] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState<any>({ name:'', condDepartment:'', condCategory:'', condPriority:'', condOrigin:'', actionAssignTo:'', actionSetPriority:'', actionNotifyEmail:'', priority:0 });
  const [editingRule, setEditingRule] = useState<string|null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [team, setTeam] = useState<any[]>([]);
  // Webhooks
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [whForm, setWhForm] = useState<any>({ name:'', url:'', secret:'', events:['ticket.created','ticket.updated','ticket.resolved'] });
  const [showWhForm, setShowWhForm] = useState(false);
  const [editingWh, setEditingWh] = useState<string|null>(null);
  // API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [keyForm, setKeyForm] = useState<any>({ name:'', permissions:['read'], expiresAt:'' });
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string|null>(null);

  const load = useCallback(async () => {
    try {
      const [s, me, t, r, wh, ak, bot, bst, depts, permsData, rolesData] = await Promise.all([
        (api as any).getSettings(), api.me(), api.getTeam(),
        (api as any).getRoutingRules(), (api as any).getWebhooks(), (api as any).getApiKeys(),
        (api as any).getChatbotConfig().catch(() => null),
        (api as any).getChatbotStats().catch(() => null),
        (api as any).getTicketSettings({ type: 'department', perPage: 200 }).catch(() => null),
        (api as any).getAllPermissions().catch(() => null),
        (api as any).getRoles().catch(() => null),
      ]);
      if (s) setSettings({ ...DEFAULT, ...s });
      if (me) setProfile((p:any) => ({ ...p, name:(me as any).name||'', email:(me as any).email||'' }));
      setTeam(t || []);
      setRules(Array.isArray(r) ? r : r?.data || []);
      setWebhooks(Array.isArray(wh) ? wh : wh?.data || []);
      setApiKeys(Array.isArray(ak) ? ak : ak?.data || []);
      if (bot) { setBotConfig({ ...BOT_DEFAULT, ...bot }); setBotMenu((bot.menuItems || []).map((m: any) => ({ ...m }))); }
      if (bst) setBotStats(bst);
      if (depts) {
        const list = (Array.isArray(depts) ? depts : depts?.data || []);
        setDepartments(list.map((d: any) => d.name).filter(Boolean).sort());
      }
      if (permsData) setAllPerms(permsData);
      if (rolesData) setRoles(Array.isArray(rolesData) ? rolesData : rolesData?.data || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const upd = (key: keyof Settings, value: string) => setSettings(p => ({ ...p, [key]: value }));
  const updBH = (day: string, field: string, value: any) => setSettings(p => ({
    ...p, businessHours: { ...p.businessHours, [day]: { ...p.businessHours[day], [field]: value } }
  }));

  const handleSave = async () => {
    setSaving(true);
    try { await (api as any).updateSettings(settings); setSaved(true); setTimeout(() => setSaved(false), 2500); } catch {}
    setSaving(false);
  };

  const handleSaveProfile = async () => {
    setProfileError('');
    if (profile.newPassword && profile.newPassword !== profile.confirmPassword) { setProfileError('As senhas não coincidem'); return; }
    setSaving(true);
    try {
      const payload: any = { name: profile.name, phone: profile.phone };
      if (profile.newPassword) { payload.currentPassword = profile.currentPassword; payload.password = profile.newPassword; }
      await api.updateTeamMember('me', payload);
      setSaved(true); setProfile(p => ({ ...p, currentPassword:'', newPassword:'', confirmPassword:'' }));
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { setProfileError(e?.response?.data?.message || 'Erro ao salvar'); }
    setSaving(false);
  };

  // Routing Rules
  const saveRule = async () => {
    try {
      if (editingRule) { await (api as any).updateRoutingRule(editingRule, ruleForm); }
      else { await (api as any).createRoutingRule(ruleForm); }
      setShowRuleForm(false); setEditingRule(null); setRuleForm({ name:'', condDepartment:'', condCategory:'', condPriority:'', condOrigin:'', actionAssignTo:'', actionSetPriority:'', actionNotifyEmail:'', priority:0 });
      const r = await (api as any).getRoutingRules();
      setRules(Array.isArray(r) ? r : r?.data || []);
    } catch {}
  };
  const deleteRule = async (id: string) => {
    if (!confirm('Excluir regra?')) return;
    await (api as any).deleteRoutingRule(id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  // Webhooks
  const saveWebhook = async () => {
    try {
      if (editingWh) { await (api as any).updateWebhook(editingWh, whForm); }
      else { await (api as any).createWebhook(whForm); }
      setShowWhForm(false); setEditingWh(null); setWhForm({ name:'', url:'', secret:'', events:['ticket.created','ticket.updated','ticket.resolved'] });
      const wh = await (api as any).getWebhooks();
      setWebhooks(Array.isArray(wh) ? wh : wh?.data || []);
    } catch {}
  };
  const deleteWebhook = async (id: string) => {
    if (!confirm('Excluir webhook?')) return;
    await (api as any).deleteWebhook(id);
    setWebhooks(prev => prev.filter(w => w.id !== id));
  };
  const toggleWhEvent = (ev: string) => {
    setWhForm((p: any) => ({ ...p, events: p.events.includes(ev) ? p.events.filter((e: string) => e !== ev) : [...p.events, ev] }));
  };

  // API Keys
  const createKey = async () => {
    try {
      const res: any = await (api as any).createApiKey(keyForm);
      setNewKeyValue(res.rawKey || res.key);
      setShowKeyForm(false);
      setKeyForm({ name:'', permissions:['read'], expiresAt:'' });
      const ak = await (api as any).getApiKeys();
      setApiKeys(Array.isArray(ak) ? ak : ak?.data || []);
    } catch {}
  };
  const revokeKey = async (id: string) => {
    if (!confirm('Revogar chave?')) return;
    await (api as any).revokeApiKey(id);
    const ak = await (api as any).getApiKeys();
    setApiKeys(Array.isArray(ak) ? ak : ak?.data || []);
  };

  // ── Chatbot helpers ──────────────────────────────────────────────────────
  const saveBotConfig = async () => {
    setBotSaving(true);
    try {
      const { menuItems, id, ...dto } = botConfig as any;
      await (api as any).updateChatbotConfig(dto);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { alert('Erro ao salvar chatbot'); }
    setBotSaving(false);
  };
  const saveBotMenu = async () => {
    setBotSaving(true);
    try {
      await (api as any).updateChatbotMenu({ items: botMenu });
      const bot = await (api as any).getChatbotConfig().catch(() => null);
      if (bot) { setBotConfig({ ...BOT_DEFAULT, ...bot }); setBotMenu((bot.menuItems || []).map((m: any) => ({ ...m }))); }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { alert('Erro ao salvar menu'); }
    setBotSaving(false);
  };
  const addBotItem = () => {
    const next = botMenu.length > 0 ? Math.max(...botMenu.map(m => m.order)) + 1 : 1;
    setBotMenu(m => [...m, { order: next, label: 'Nova opção', action: 'transfer', enabled: true }]);
  };
  const removeBotItem = (i: number) => setBotMenu(m => m.filter((_,j) => j !== i).map((x,j) => ({ ...x, order: j+1 })));
  const moveBotItem = (i: number, dir: -1|1) => {
    const a = [...botMenu]; const b = i+dir;
    if (b < 0 || b >= a.length) return;
    [a[i], a[b]] = [a[b], a[i]]; a.forEach((x,j) => { x.order = j+1; }); setBotMenu(a);
  };
  const updBotItem = (i: number, p: Partial<ChatbotMenuItem>) => setBotMenu(m => m.map((x,j) => j===i ? { ...x, ...p } : x));

  const TABS = [
    { key:'company', label:'Empresa', icon:Building2 },
    { key:'smtp', label:'E-mail (SMTP)', icon:Mail },
    { key:'notifications', label:'Notificações', icon:Bell },
    { key:'sla', label:'SLA / Prazos', icon:Clock },
    { key:'business_hours', label:'Horário Comercial', icon:Clock },
    { key:'visual', label:'Personalização', icon:Palette },
    { key:'routing', label:'Regras de Encaminh.', icon:Globe },
    { key:'webhooks', label:'Webhooks', icon:Globe },
    { key:'apikeys', label:'Chaves de API', icon:Key },
    { key:'inbound_email', label:'E-mail Recebido', icon:Inbox },
    { key:'chatbot', label:'Chatbot', icon:Bot },
    { key:'profile', label:'Meu perfil', icon:User },
  ] as const;

  const WH_EVENTS = ['ticket.created','ticket.updated','ticket.resolved','ticket.closed','sla.warning'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Configurações</h1>
          <p className="page-subtitle">Gerencie as configurações do sistema</p>
        </div>
        {!['profile','routing','webhooks','apikeys','inbound_email','chatbot'].includes(tab) && (
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Salvo!' : 'Salvar alterações'}
          </button>
        )}
      </div>

      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="card p-2 lg:w-56 shrink-0 h-fit">
          {TABS.map(({ key, label, icon:Icon }) => (
            <button key={key} onClick={() => { setTab(key as any); setSaved(false); setProfileError(''); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:10, border:'none', cursor:'pointer', background: tab===key ? '#EEF2FF' : 'transparent', color: tab===key ? '#4F46E5' : '#64748B', fontWeight: tab===key ? 700 : 500, fontSize:12, marginBottom:2 }}>
              <Icon className="w-4 h-4 shrink-0" /><span className="truncate flex-1 text-left">{label}</span>
              {tab===key && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 card p-6 min-w-0">

          {/* Company */}
          {tab === 'company' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Dados da empresa</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Informações do seu negócio exibidas no sistema</p></div>
              {/* Zona de Perigo */}
              <DangerZone />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nome da empresa"><input value={settings.companyName} onChange={e=>upd('companyName',e.target.value)} className="input" placeholder="Empresa Ltda." /></Field>
                <Field label="CNPJ"><input value={settings.companyCnpj} onChange={e=>upd('companyCnpj',e.target.value)} className="input" placeholder="00.000.000/0001-00" /></Field>
                <Field label="E-mail"><input value={settings.companyEmail} onChange={e=>upd('companyEmail',e.target.value)} className="input" placeholder="contato@empresa.com" /></Field>
                <Field label="Telefone"><input value={settings.companyPhone} onChange={e=>upd('companyPhone',e.target.value)} className="input" placeholder="(00) 0000-0000" /></Field>
                <Field label="Endereço"><input value={settings.companyAddress} onChange={e=>upd('companyAddress',e.target.value)} className="input" placeholder="Rua, número, cidade - UF" /></Field>
                <Field label="URL do logotipo"><input value={settings.companyLogo} onChange={e=>upd('companyLogo',e.target.value)} className="input" placeholder="https://..." /></Field>
              </div>
            </div>
          )}

          {/* SMTP */}
          {tab === 'smtp' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Configurações de e-mail</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Servidor SMTP para envio de notificações</p></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Servidor SMTP"><input value={settings.smtpHost} onChange={e=>upd('smtpHost',e.target.value)} className="input" placeholder="smtp.gmail.com" /></Field>
                <Field label="Porta">
                  <select value={settings.smtpPort} onChange={e=>upd('smtpPort',e.target.value)} className="input">
                    <option value="587">587 (TLS)</option><option value="465">465 (SSL)</option><option value="25">25</option>
                  </select>
                </Field>
                <Field label="Usuário SMTP"><input value={settings.smtpUser} onChange={e=>upd('smtpUser',e.target.value)} className="input" placeholder="seu@email.com" /></Field>
                <Field label="Senha SMTP">
                  <div style={{ position:'relative' }}>
                    <input type={showPass?'text':'password'} value={settings.smtpPass} onChange={e=>upd('smtpPass',e.target.value)} className="input" placeholder="••••••••" style={{ paddingRight:40 }} />
                    <button type="button" onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94A3B8' }}>
                      {showPass?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                    </button>
                  </div>
                </Field>
                <Field label="Remetente (From)"><input value={settings.smtpFrom} onChange={e=>upd('smtpFrom',e.target.value)} className="input" placeholder="Sistema <no-reply@empresa.com>" /></Field>
                <Field label="Segurança">
                  <select value={settings.smtpSecure} onChange={e=>upd('smtpSecure',e.target.value)} className="input">
                    <option value="false">STARTTLS (587)</option><option value="true">SSL/TLS (465)</option>
                  </select>
                </Field>
              </div>
              <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',paddingTop:4,borderTop:'1px solid #F1F5F9' }}>
                <button onClick={async()=>{ setSmtpTesting(true);setSmtpResult(null);try{const r=await(api as any).testSmtp();setSmtpResult(r);}catch{setSmtpResult({success:false,message:'Erro ao testar'});}setSmtpTesting(false);}} disabled={smtpTesting||!settings.smtpHost} className="btn-secondary">
                  {smtpTesting?<RefreshCw className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>} Testar SMTP
                </button>
                {smtpResult && <span style={{ fontSize:13,fontWeight:600,color:smtpResult.success?'#16A34A':'#DC2626' }}>{smtpResult.success?'✓':'✗'} {smtpResult.message}</span>}
              </div>
            </div>
          )}

          {/* Notifications */}
          {tab === 'notifications' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Notificações por e-mail</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Configure quando enviar e-mails automáticos</p></div>
              <div className="space-y-4">
                {[
                  { key:'ticketCreatedNotify', label:'Ticket criado', desc:'Enviar e-mail ao cliente quando um ticket é aberto' },
                  { key:'ticketResolvedNotify', label:'Ticket resolvido', desc:'Enviar e-mail ao cliente quando o ticket é resolvido (com link de avaliação)' },
                  { key:'slaWarningNotify', label:'SLA em risco', desc:'Notificar por e-mail quando um ticket estiver próximo do vencimento do SLA' },
                ].map(({ key, label, desc }) => (
                  <div key={key} style={{ display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',background:'#F8FAFC',borderRadius:12,border:'1.5px solid #E2E8F0' }}>
                    <div>
                      <p style={{ fontSize:14,fontWeight:600,color:'#0F172A' }}>{label}</p>
                      <p style={{ fontSize:12,color:'#94A3B8',marginTop:2 }}>{desc}</p>
                    </div>
                    <Toggle checked={settings[key as keyof Settings]==='true'} onChange={v=>upd(key as keyof Settings, String(v))} />
                  </div>
                ))}
                <Field label="E-mail para alertas de SLA" hint="Endereço que receberá os alertas de SLA em risco (ex: supervisor@empresa.com)">
                  <input value={settings.escalationEmail} onChange={e=>upd('escalationEmail',e.target.value)} className="input" placeholder="supervisor@empresa.com" />
                </Field>
              </div>
              <div style={{ background:'#EEF2FF',borderRadius:12,padding:'12px 16px',border:'1.5px solid #C7D2FE' }}>
                <p style={{ fontSize:12,color:'#4338CA' }}>💡 As notificações por e-mail requerem configuração de SMTP válida na aba "E-mail (SMTP)".</p>
              </div>
            </div>
          )}

          {/* SLA */}
          {tab === 'sla' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Configurações de SLA</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Tempo máximo de resolução por prioridade (em horas)</p></div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {([['slaLowHours','Baixa','#64748B','#F8FAFC'],['slaMediumHours','Média','#1D4ED8','#DBEAFE'],['slaHighHours','Alta','#C2410C','#FFEDD5'],['slaCriticalHours','Crítica','#DC2626','#FEE2E2']] as const).map(([key,label,color,bg])=>(
                  <div key={key} style={{ background:bg,borderRadius:14,padding:'14px 16px',border:'1.5px solid '+color+'22' }}>
                    <p style={{ fontSize:11,fontWeight:700,color,textTransform:'uppercase',letterSpacing:1,marginBottom:8 }}>{label}</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={720} value={settings[key]} onChange={e=>upd(key,e.target.value)} className="input" style={{ width:80,textAlign:'center',fontWeight:700,fontSize:18,color,background:'#fff',padding:'8px 6px' }} />
                      <span style={{ fontSize:13,fontWeight:600,color:'#94A3B8' }}>horas</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Business Hours */}
          {tab === 'business_hours' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Horário Comercial</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Configure os horários de atendimento por dia da semana</p></div>
              <div className="space-y-3">
                {Object.entries(DAY_LABELS).map(([day,label])=>{
                  const bh = settings.businessHours?.[day] || { open:false,start:'08:00',end:'18:00' };
                  return (
                    <div key={day} style={{ display:'flex',alignItems:'center',gap:16,padding:'12px 16px',background:'#F8FAFC',borderRadius:12,border:'1.5px solid #E2E8F0',flexWrap:'wrap' }}>
                      <Toggle checked={!!bh.open} onChange={v=>updBH(day,'open',v)} />
                      <span style={{ fontSize:13,fontWeight:600,color:'#0F172A',minWidth:80 }}>{label}</span>
                      {bh.open ? (
                        <div className="flex items-center gap-2">
                          <input type="time" value={bh.start||'08:00'} onChange={e=>updBH(day,'start',e.target.value)} className="input" style={{ width:110 }} />
                          <span style={{ color:'#94A3B8',fontSize:13 }}>até</span>
                          <input type="time" value={bh.end||'18:00'} onChange={e=>updBH(day,'end',e.target.value)} className="input" style={{ width:110 }} />
                        </div>
                      ) : <span style={{ fontSize:12,color:'#94A3B8' }}>Fechado</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Visual */}
          {tab === 'visual' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Personalização visual</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Cores do sistema e identidade visual</p></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {([['primaryColor','Cor primária','Botões e destaques'],['secondaryColor','Cor secundária','Gradientes e apoio']] as const).map(([key,label,hint])=>(
                  <Field key={key} label={label} hint={hint}>
                    <div style={{ display:'flex',alignItems:'center',gap:12 }}>
                      <input type="color" value={settings[key]} onChange={e=>upd(key,e.target.value)} style={{ width:48,height:48,borderRadius:10,border:'2px solid #E2E8F0',cursor:'pointer',padding:2 }} />
                      <input value={settings[key]} onChange={e=>upd(key,e.target.value)} className="input" style={{ flex:1,fontFamily:'monospace',fontWeight:700 }} />
                    </div>
                  </Field>
                ))}
              </div>
            </div>
          )}

          {/* Routing Rules */}
          {tab === 'routing' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Regras de Encaminhamento</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Auto-atribuir tickets com base em condições (primeira regra que combinar é aplicada)</p></div>
                <button onClick={()=>{setEditingRule(null);setRuleForm({ name:'',condDepartment:'',condCategory:'',condPriority:'',condOrigin:'',actionAssignTo:'',actionSetPriority:'',actionNotifyEmail:'',priority:0,active:true });setShowRuleForm(true);}} className="btn-primary"><Plus className="w-4 h-4"/>Nova regra</button>
              </div>
              {showRuleForm && (
                <div style={{ background:'#F8FAFC',borderRadius:14,padding:20,border:'1.5px solid #E2E8F0' }}>
                  <h3 style={{ fontSize:14,fontWeight:700,color:'#0F172A',marginBottom:16 }}>{editingRule?'Editar regra':'Nova regra'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Nome da regra"><input value={ruleForm.name} onChange={e=>setRuleForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex: Alta prioridade → João" /></Field>
                    <Field label="Ordem de prioridade"><input type="number" value={ruleForm.priority} onChange={e=>setRuleForm((p:any)=>({...p,priority:parseInt(e.target.value)||0}))} className="input" placeholder="0 = maior prioridade" /></Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:10 }}>Condições (deixe vazio para ignorar)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Departamento"><input value={ruleForm.condDepartment} onChange={e=>setRuleForm((p:any)=>({...p,condDepartment:e.target.value}))} className="input" placeholder="Nome exato do departamento" /></Field>
                    <Field label="Categoria"><input value={ruleForm.condCategory} onChange={e=>setRuleForm((p:any)=>({...p,condCategory:e.target.value}))} className="input" placeholder="Nome exato da categoria" /></Field>
                    <Field label="Prioridade">
                      <select value={ruleForm.condPriority} onChange={e=>setRuleForm((p:any)=>({...p,condPriority:e.target.value}))} className="input">
                        <option value="">Qualquer</option><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option>
                      </select>
                    </Field>
                    <Field label="Origem">
                      <select value={ruleForm.condOrigin} onChange={e=>setRuleForm((p:any)=>({...p,condOrigin:e.target.value}))} className="input">
                        <option value="">Qualquer</option><option value="portal">Portal</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="internal">Interno</option>
                      </select>
                    </Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:10 }}>Ações</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <Field label="Atribuir ao técnico">
                      <select value={ruleForm.actionAssignTo} onChange={e=>setRuleForm((p:any)=>({...p,actionAssignTo:e.target.value}))} className="input">
                        <option value="">Não atribuir</option>
                        {team.map((u:any)=><option key={u.id} value={u.id}>{u.name||u.email}</option>)}
                      </select>
                    </Field>
                    <Field label="Definir prioridade">
                      <select value={ruleForm.actionSetPriority} onChange={e=>setRuleForm((p:any)=>({...p,actionSetPriority:e.target.value}))} className="input">
                        <option value="">Não alterar</option><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option>
                      </select>
                    </Field>
                    <Field label="Notificar e-mail"><input value={ruleForm.actionNotifyEmail} onChange={e=>setRuleForm((p:any)=>({...p,actionNotifyEmail:e.target.value}))} className="input" placeholder="email@empresa.com" /></Field>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveRule} className="btn-primary"><Save className="w-4 h-4"/>Salvar regra</button>
                    <button onClick={()=>{setShowRuleForm(false);setEditingRule(null);}} className="btn-secondary">Cancelar</button>
                  </div>
                </div>
              )}
              {rules.length === 0 && !showRuleForm ? (
                <div style={{ textAlign:'center',padding:'32px 0',color:'#94A3B8' }}>
                  <Globe className="w-10 h-10 mx-auto mb-3" style={{ opacity:0.3 }} />
                  <p style={{ fontSize:13 }}>Nenhuma regra configurada. Tickets serão atribuídos manualmente.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule:any)=>(
                    <div key={rule.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'#fff',borderRadius:12,border:'1.5px solid #E2E8F0',flexWrap:'wrap' }}>
                      <div style={{ width:24,height:24,borderRadius:6,background:'#EEF2FF',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
                        <span style={{ fontSize:11,fontWeight:700,color:'#4F46E5' }}>{rule.priority}</span>
                      </div>
                      <div style={{ flex:1,minWidth:0 }}>
                        <p style={{ fontSize:13,fontWeight:700,color:'#0F172A' }}>{rule.name}</p>
                        <p style={{ fontSize:11,color:'#94A3B8' }}>
                          {[rule.condDepartment&&`Dept: ${rule.condDepartment}`,rule.condPriority&&`Prior: ${rule.condPriority}`,rule.condOrigin&&`Origem: ${rule.condOrigin}`].filter(Boolean).join(' · ')||'Sempre'}
                          {' → '}
                          {[rule.actionAssignTo&&`Atribuir: ${team.find((u:any)=>u.id===rule.actionAssignTo)?.name||rule.actionAssignTo}`,rule.actionSetPriority&&`Prioridade: ${rule.actionSetPriority}`,rule.actionNotifyEmail&&`Notif: ${rule.actionNotifyEmail}`].filter(Boolean).join(' · ')||'Sem ação'}
                        </p>
                      </div>
                      <div style={{ width:8,height:8,borderRadius:'50%',background:rule.active?'#10B981':'#94A3B8',flexShrink:0 }} />
                      <div className="flex gap-1">
                        <button onClick={()=>{setRuleForm({...rule});setEditingRule(rule.id);setShowRuleForm(true);}} className="btn-secondary" style={{ padding:'5px 8px' }}><Edit2 className="w-3.5 h-3.5"/></button>
                        <button onClick={()=>deleteRule(rule.id)} className="btn-danger" style={{ padding:'5px 8px' }}><Trash2 className="w-3.5 h-3.5"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Webhooks */}
          {tab === 'webhooks' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Webhooks</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Dispare eventos HTTP para sistemas externos quando tickets forem alterados</p></div>
                <button onClick={()=>{setEditingWh(null);setWhForm({name:'',url:'',secret:'',events:['ticket.created','ticket.updated','ticket.resolved']});setShowWhForm(true);}} className="btn-primary"><Plus className="w-4 h-4"/>Novo webhook</button>
              </div>
              {showWhForm && (
                <div style={{ background:'#F8FAFC',borderRadius:14,padding:20,border:'1.5px solid #E2E8F0' }}>
                  <h3 style={{ fontSize:14,fontWeight:700,color:'#0F172A',marginBottom:16 }}>{editingWh?'Editar webhook':'Novo webhook'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Nome"><input value={whForm.name} onChange={e=>setWhForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Meu sistema externo" /></Field>
                    <Field label="URL do endpoint"><input value={whForm.url} onChange={e=>setWhForm((p:any)=>({...p,url:e.target.value}))} className="input" placeholder="https://meusite.com/webhook" /></Field>
                    <Field label="Segredo HMAC" hint="Usado para validar assinatura X-Signature-256 (opcional)">
                      <input value={whForm.secret} onChange={e=>setWhForm((p:any)=>({...p,secret:e.target.value}))} className="input" placeholder="meu_segredo_secreto" />
                    </Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:10 }}>Eventos</p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {WH_EVENTS.map(ev=>(
                      <button key={ev} type="button" onClick={()=>toggleWhEvent(ev)}
                        style={{ padding:'4px 12px',borderRadius:20,border:'1.5px solid',fontSize:12,fontWeight:600,cursor:'pointer', background:whForm.events.includes(ev)?'#4F46E5':'transparent', color:whForm.events.includes(ev)?'#fff':'#64748B', borderColor:whForm.events.includes(ev)?'#4F46E5':'#E2E8F0' }}>
                        {ev}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveWebhook} className="btn-primary"><Save className="w-4 h-4"/>Salvar</button>
                    <button onClick={()=>{setShowWhForm(false);setEditingWh(null);}} className="btn-secondary">Cancelar</button>
                  </div>
                </div>
              )}
              {webhooks.length === 0 && !showWhForm ? (
                <div style={{ textAlign:'center',padding:'32px 0',color:'#94A3B8' }}>
                  <Globe className="w-10 h-10 mx-auto mb-3" style={{ opacity:0.3 }} />
                  <p style={{ fontSize:13 }}>Nenhum webhook configurado</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {webhooks.map((wh:any)=>(
                    <div key={wh.id} style={{ padding:'12px 16px',background:'#fff',borderRadius:12,border:'1.5px solid #E2E8F0' }}>
                      <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:6 }}>
                        <div style={{ flex:1,minWidth:0 }}>
                          <div className="flex items-center gap-2">
                            <p style={{ fontSize:13,fontWeight:700,color:'#0F172A' }}>{wh.name}</p>
                            <div style={{ width:7,height:7,borderRadius:'50%',background:wh.active?'#10B981':'#94A3B8' }} />
                          </div>
                          <p style={{ fontSize:11,color:'#4F46E5',fontFamily:'monospace',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{wh.url}</p>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={()=>{setWhForm({...wh,events:wh.events||[]});setEditingWh(wh.id);setShowWhForm(true);}} className="btn-secondary" style={{ padding:'5px 8px' }}><Edit2 className="w-3.5 h-3.5"/></button>
                          <button onClick={()=>deleteWebhook(wh.id)} className="btn-danger" style={{ padding:'5px 8px' }}><Trash2 className="w-3.5 h-3.5"/></button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {(wh.events||[]).map((ev:string)=><span key={ev} style={{ fontSize:10,padding:'2px 8px',borderRadius:20,background:'#EEF2FF',color:'#4F46E5',fontWeight:600 }}>{ev}</span>)}
                        {wh.lastStatus && <span style={{ fontSize:10,padding:'2px 8px',borderRadius:20,background:'#F1F5F9',color:'#64748B',marginLeft:'auto' }}>Último: {wh.lastStatus}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background:'#F8FAFC',borderRadius:12,padding:14,border:'1.5px solid #E2E8F0',fontSize:12,color:'#64748B' }}>
                <strong>Payload de exemplo:</strong>
                <pre style={{ fontFamily:'monospace',fontSize:11,color:'#475569',marginTop:6,overflow:'auto' }}>{JSON.stringify({event:'ticket.created',timestamp:'2024-01-01T12:00:00Z',data:{id:'uuid',ticketNumber:'#000001',subject:'Problema',status:'open',priority:'high'}},null,2)}</pre>
              </div>
            </div>
          )}

          {/* API Keys */}
          {tab === 'apikeys' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Chaves de API</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Chaves para acesso à API pública. A chave é exibida apenas uma vez na criação.</p></div>
                <button onClick={()=>setShowKeyForm(true)} className="btn-primary"><Plus className="w-4 h-4"/>Nova chave</button>
              </div>
              {newKeyValue && (
                <div style={{ background:'#DCFCE7',borderRadius:12,padding:16,border:'1.5px solid #86EFAC' }}>
                  <p style={{ fontSize:13,fontWeight:700,color:'#166534',marginBottom:8 }}>✅ Chave criada! Copie agora — não será exibida novamente.</p>
                  <div style={{ display:'flex',alignItems:'center',gap:8,background:'#fff',borderRadius:8,padding:'8px 12px',border:'1px solid #86EFAC' }}>
                    <code style={{ flex:1,fontSize:12,fontFamily:'monospace',color:'#166534',wordBreak:'break-all' }}>{newKeyValue}</code>
                    <button onClick={()=>{navigator.clipboard.writeText(newKeyValue);}} style={{ background:'none',border:'none',cursor:'pointer',color:'#166534',flexShrink:0 }} title="Copiar"><Copy className="w-4 h-4"/></button>
                  </div>
                  <button onClick={()=>setNewKeyValue(null)} style={{ marginTop:8,fontSize:12,color:'#166534',background:'none',border:'none',cursor:'pointer',textDecoration:'underline' }}>Fechar</button>
                </div>
              )}
              {showKeyForm && (
                <div style={{ background:'#F8FAFC',borderRadius:14,padding:20,border:'1.5px solid #E2E8F0' }}>
                  <h3 style={{ fontSize:14,fontWeight:700,color:'#0F172A',marginBottom:16 }}>Nova chave de API</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Nome / Descrição"><input value={keyForm.name} onChange={e=>setKeyForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex: Integração ERP" /></Field>
                    <Field label="Expira em (opcional)"><input type="date" value={keyForm.expiresAt} onChange={e=>setKeyForm((p:any)=>({...p,expiresAt:e.target.value}))} className="input" /></Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:10 }}>Permissões</p>
                  <div className="flex gap-2 mb-4">
                    {['read','write','admin'].map(perm=>(
                      <button key={perm} type="button" onClick={()=>setKeyForm((p:any)=>({...p,permissions:p.permissions.includes(perm)?p.permissions.filter((x:string)=>x!==perm):[...p.permissions,perm]}))}
                        style={{ padding:'4px 12px',borderRadius:20,border:'1.5px solid',fontSize:12,fontWeight:600,cursor:'pointer',background:keyForm.permissions.includes(perm)?'#4F46E5':'transparent',color:keyForm.permissions.includes(perm)?'#fff':'#64748B',borderColor:keyForm.permissions.includes(perm)?'#4F46E5':'#E2E8F0' }}>
                        {perm}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createKey} className="btn-primary"><Key className="w-4 h-4"/>Gerar chave</button>
                    <button onClick={()=>setShowKeyForm(false)} className="btn-secondary">Cancelar</button>
                  </div>
                </div>
              )}
              {apiKeys.length === 0 && !showKeyForm ? (
                <div style={{ textAlign:'center',padding:'32px 0',color:'#94A3B8' }}>
                  <Key className="w-10 h-10 mx-auto mb-3" style={{ opacity:0.3 }} />
                  <p style={{ fontSize:13 }}>Nenhuma chave de API criada</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((k:any)=>(
                    <div key={k.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'#fff',borderRadius:12,border:'1.5px solid '+(k.active?'#E2E8F0':'#FECACA'),flexWrap:'wrap' }}>
                      <Shield className="w-5 h-5 shrink-0" style={{ color:k.active?'#10B981':'#EF4444' }} />
                      <div style={{ flex:1,minWidth:0 }}>
                        <p style={{ fontSize:13,fontWeight:700,color:'#0F172A' }}>{k.name}</p>
                        <p style={{ fontSize:11,color:'#94A3B8' }}>
                          {(k.permissions||[]).join(', ')}
                          {k.expiresAt&&` · Expira: ${new Date(k.expiresAt).toLocaleDateString('pt-BR')}`}
                          {k.lastUsedAt&&` · Último uso: ${new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}`}
                        </p>
                      </div>
                      <span style={{ fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:20,background:k.active?'#DCFCE7':'#FEE2E2',color:k.active?'#166534':'#DC2626' }}>{k.active?'Ativa':'Revogada'}</span>
                      {k.active && <button onClick={()=>revokeKey(k.id)} style={{ background:'none',border:'none',cursor:'pointer',fontSize:12,color:'#EF4444',fontWeight:600 }}>Revogar</button>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ background:'#F8FAFC',borderRadius:12,padding:14,border:'1.5px solid #E2E8F0',fontSize:12,color:'#64748B' }}>
                <strong>Como usar:</strong> Inclua o header <code style={{ fontFamily:'monospace',background:'#E2E8F0',padding:'1px 6px',borderRadius:4 }}>X-API-Key: sk_...</code> nas requisições à API.
                <br/>A API pública está documentada em: <code style={{ fontFamily:'monospace' }}>/api/docs</code>
              </div>
            </div>
          )}

          {/* Inbound Email */}
          {tab === 'inbound_email' && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A' }}>E-mail Recebido</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:2 }}>Configure seu provedor de e-mail para criar tickets automaticamente quando receber mensagens</p>
              </div>
              <div style={{ background:'#F8FAFC', borderRadius:14, padding:20, border:'1.5px solid #E2E8F0' }}>
                <p style={{ fontSize:14, fontWeight:700, color:'#0F172A', marginBottom:12 }}>📨 URL do Webhook de Entrada</p>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff', borderRadius:10, padding:'10px 14px', border:'1.5px solid #E2E8F0', marginBottom:12 }}>
                  <code style={{ flex:1, fontSize:12, fontFamily:'monospace', color:'#4F46E5', wordBreak:'break-all' }}>
                    {typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':4000') : 'https://seu-servidor'}/api/v1/email/inbound
                  </code>
                  <button onClick={() => navigator.clipboard.writeText((typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':4000') : '') + '/api/v1/email/inbound')}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', flexShrink:0 }} title="Copiar">
                    📋
                  </button>
                </div>
                <p style={{ fontSize:13, fontWeight:600, color:'#475569', marginBottom:8 }}>Headers obrigatórios:</p>
                <div style={{ background:'#1E293B', borderRadius:8, padding:14, marginBottom:16 }}>
                  <pre style={{ margin:0, fontSize:11, color:'#94A3B8', fontFamily:'monospace' }}>{`X-Tenant-Id: {seu-tenant-id}
X-Api-Secret: {INBOUND_EMAIL_SECRET}`}</pre>
                </div>
                <p style={{ fontSize:13, fontWeight:600, color:'#475569', marginBottom:8 }}>Provedores suportados:</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Mailgun', 'Configure em Receiving → Routes → Forward to URL'],
                    ['SendGrid', 'Configure em Settings → Inbound Parse → Add Host & URL'],
                    ['Postmark', 'Configure em Inbound → Webhooks → Add webhook URL'],
                    ['Forwardemail.net', 'Configure um forward para o webhook via API'],
                  ].map(([name, desc]) => (
                    <div key={name} style={{ background:'#fff', borderRadius:10, padding:12, border:'1.5px solid #E2E8F0' }}>
                      <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', marginBottom:4 }}>{name}</p>
                      <p style={{ fontSize:11, color:'#94A3B8' }}>{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ background:'#EEF2FF', borderRadius:12, padding:'12px 16px', border:'1.5px solid #C7D2FE', fontSize:12, color:'#4338CA' }}>
                💡 Configure a variável de ambiente <code style={{ fontFamily:'monospace', background:'rgba(0,0,0,0.05)', padding:'1px 4px', borderRadius:4 }}>INBOUND_EMAIL_SECRET</code> no servidor para validar as requisições. O campo "De" do e-mail será usado como remetente e o assunto como título do ticket.
              </div>
            </div>
          )}

          {/* Chatbot */}
          {tab === 'chatbot' && (
            <div className="space-y-6">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Chatbot</h2>
                  <p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Assistente virtual para atender clientes automaticamente</p>
                </div>
                <button onClick={() => setBotConfig(c => ({ ...c, enabled: !c.enabled }))}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:`1.5px solid ${botConfig.enabled ? '#10B981' : '#E2E8F0'}`, background: botConfig.enabled ? '#ECFDF5' : '#fff', cursor:'pointer', fontSize:13, fontWeight:700, color: botConfig.enabled ? '#10B981' : '#94A3B8' }}>
                  {botConfig.enabled ? <ToggleRight size={18}/> : <ToggleLeft size={18}/>}
                  {botConfig.enabled ? 'Ativo' : 'Inativo'}
                </button>
              </div>

              {/* Stats */}
              {botStats && (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
                  {[{ l:'Sessões totais', v:botStats.totalSessions, c:'#4F46E5' }, { l:'Sessões ativas', v:botStats.activeSessions, c:'#10B981' }, { l:'Transferidos', v:botStats.transferred, c:'#F59E0B' }].map(s => (
                    <div key={s.l} style={{ background:'#F8FAFC', borderRadius:10, padding:'12px 14px', border:'1px solid #E2E8F0' }}>
                      <div style={{ fontSize:22,fontWeight:800,color:s.c }}>{s.v}</div>
                      <div style={{ fontSize:11,color:'#94A3B8',marginTop:2 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Mensagens */}
              <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                <p style={{ fontSize:13,fontWeight:700,color:'#374151',marginBottom:14 }}>Mensagens do bot</p>
                <div className="space-y-4">
                  <Field label="Nome do bot"><input value={botConfig.name} onChange={e=>setBotConfig(c=>({...c,name:e.target.value}))} className="input" /></Field>
                  <Field label="Boas-vindas"><textarea value={botConfig.welcomeMessage} onChange={e=>setBotConfig(c=>({...c,welcomeMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} /></Field>
                  <Field label="Título do menu"><input value={botConfig.menuTitle} onChange={e=>setBotConfig(c=>({...c,menuTitle:e.target.value}))} className="input" /></Field>
                  <Field label="Ao transferir para atendente"><textarea value={botConfig.transferMessage} onChange={e=>setBotConfig(c=>({...c,transferMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} /></Field>
                  <Field label="Sem atendente disponível"><textarea value={botConfig.noAgentMessage} onChange={e=>setBotConfig(c=>({...c,noAgentMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} /></Field>
                  <Field label="Opção inválida"><input value={botConfig.invalidOptionMessage} onChange={e=>setBotConfig(c=>({...c,invalidOptionMessage:e.target.value}))} className="input" /></Field>
                  <Field label="Timeout de sessão (min)"><input type="number" min={5} max={240} value={botConfig.sessionTimeoutMinutes} onChange={e=>setBotConfig(c=>({...c,sessionTimeoutMinutes:parseInt(e.target.value)||30}))} className="input" style={{ width:90 }} /></Field>
                </div>
              </div>

              {/* Canais */}
              <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                <p style={{ fontSize:13,fontWeight:700,color:'#374151',marginBottom:14 }}>Canais ativos</p>
                <div className="space-y-2">
                  {([
                    { key:'channelWhatsapp', label:'WhatsApp', icon:<Smartphone size={16} color="#25D366"/> },
                    { key:'channelWeb',      label:'Chat Web (Widget)', icon:<Globe size={16} color="#4F46E5"/> },
                    { key:'channelPortal',   label:'Portal do Cliente', icon:<Users size={16} color="#F59E0B"/> },
                  ] as const).map(ch => (
                    <div key={ch.key} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', border:`1.5px solid ${botConfig[ch.key]?'#10B981':'#E2E8F0'}`, borderRadius:8, background: botConfig[ch.key]?'#ECFDF5':'#fff' }}>
                      {ch.icon}
                      <span style={{ flex:1, fontSize:13, fontWeight:600, color:'#0F172A' }}>{ch.label}</span>
                      <Toggle checked={botConfig[ch.key]} onChange={v=>setBotConfig(c=>({...c,[ch.key]:v}))} />
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveBotConfig} disabled={botSaving} className="btn-primary">
                {botSaving ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                Salvar configurações do bot
              </button>

              {/* Menu */}
              <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                  <p style={{ fontSize:13,fontWeight:700,color:'#374151' }}>Opções do menu</p>
                  <button onClick={addBotItem} disabled={botMenu.length >= 9}
                    style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, border:'none', background:'#4F46E5', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', opacity:botMenu.length>=9?.5:1 }}>
                    <Plus size={13}/> Adicionar
                  </button>
                </div>
                <div className="space-y-2">
                  {botMenu.map((item, i) => (
                    <div key={i} style={{ border:`1.5px solid ${item.enabled?'#E2E8F0':'#F1F5F9'}`, borderRadius:9, padding:'12px 14px', background:item.enabled?'#fff':'#FAFBFC' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <span style={{ width:22, height:22, borderRadius:5, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:12, color:'#4F46E5', flexShrink:0 }}>{item.order}</span>
                        <input value={item.label} onChange={e=>updBotItem(i,{label:e.target.value})} placeholder="Texto da opção" className="input" style={{ flex:1 }} />
                        <button onClick={()=>updBotItem(i,{enabled:!item.enabled})} style={{ background:'none', border:'none', cursor:'pointer', color:item.enabled?'#10B981':'#CBD5E1', padding:2 }}>
                          {item.enabled ? <ToggleRight size={18}/> : <ToggleLeft size={18}/>}
                        </button>
                        <button onClick={()=>moveBotItem(i,-1)} disabled={i===0} style={{ background:'none', border:'none', cursor:'pointer', color:'#CBD5E1', padding:2, opacity:i===0?.3:1 }}><ChevronUp size={14}/></button>
                        <button onClick={()=>moveBotItem(i,1)} disabled={i===botMenu.length-1} style={{ background:'none', border:'none', cursor:'pointer', color:'#CBD5E1', padding:2, opacity:i===botMenu.length-1?.3:1 }}><ChevronDown size={14}/></button>
                        <button onClick={()=>removeBotItem(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'#EF4444', padding:2 }}><Trash2 size={13}/></button>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        <Field label="Ação">
                          <select value={item.action} onChange={e=>updBotItem(i,{action:e.target.value as any})} className="input">
                            <option value="transfer">Transferir para atendente</option>
                            <option value="auto_reply">Resposta automática</option>
                          </select>
                        </Field>
                        {item.action === 'transfer' ? (
                          <Field label="Departamento">
                            <select value={item.department||''} onChange={e=>updBotItem(i,{department:e.target.value||undefined})} className="input">
                              <option value="">— Qualquer atendente —</option>
                              {departments.map(d => <option key={d} value={d}>{d}</option>)}
                              {/* fallback: se departamento salvo não existe mais na lista */}
                              {item.department && !departments.includes(item.department) && (
                                <option value={item.department}>{item.department} (removido)</option>
                              )}
                            </select>
                          </Field>
                        ) : (
                          <Field label="Texto da resposta"><input value={item.autoReplyText||''} onChange={e=>updBotItem(i,{autoReplyText:e.target.value})} placeholder="Resposta automática..." className="input" /></Field>
                        )}
                      </div>
                    </div>
                  ))}
                  {botMenu.length === 0 && <p style={{ textAlign:'center', padding:'20px 0', color:'#CBD5E1', fontSize:13 }}>Nenhuma opção. Clique em "Adicionar" para criar.</p>}
                </div>
                <button onClick={saveBotMenu} disabled={botSaving} className="btn-primary" style={{ marginTop:14 }}>
                  {botSaving ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                  Salvar menu
                </button>
              </div>

              {/* Widget embed */}
              {botConfig.channelWeb && (
                <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                  <p style={{ fontSize:13,fontWeight:700,color:'#374151',marginBottom:10 }}>Código do widget para seu site</p>
                  <div style={{ background:'#1E293B', borderRadius:8, padding:'12px 14px', position:'relative' }}>
                    <code style={{ color:'#7DD3FC', fontSize:11, display:'block', wordBreak:'break-all' }}>
                      {`<script src="${typeof window!=='undefined'?window.location.origin:''}/api/v1/chatbot/widget.js?tenantId=SEU_TENANT_ID"></script>`}
                    </code>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Perfis e Permissões — acessível via menu lateral Configurações → /dashboard/perfis */}

          {/* Profile */}
          {tab === 'profile' && (
            <div className="space-y-5">
              <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Meu perfil</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Seus dados pessoais e senha de acesso</p></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Nome completo"><input value={profile.name} onChange={e=>setProfile(p=>({...p,name:e.target.value}))} className="input" placeholder="Seu nome" /></Field>
                <Field label="E-mail" hint="Não pode ser alterado aqui"><input value={profile.email} disabled className="input" /></Field>
                <Field label="Telefone"><input value={(profile as any).phone||''} onChange={e=>setProfile(p=>({...p,phone:e.target.value} as any))} className="input" placeholder="(00) 90000-0000" /></Field>
              </div>
              <div style={{ borderTop:'1px solid #F1F5F9',paddingTop:20 }}>
                <div className="flex items-center gap-2 mb-4">
                  <Lock className="w-4 h-4" style={{ color:'#6366F1' }} />
                  <p style={{ fontSize:14,fontWeight:700,color:'#0F172A' }}>Alterar senha</p>
                  <span style={{ fontSize:12,color:'#94A3B8' }}>(deixe vazio para manter)</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label="Senha atual"><input type="password" value={profile.currentPassword} onChange={e=>setProfile(p=>({...p,currentPassword:e.target.value}))} className="input" placeholder="••••••••" /></Field>
                  <Field label="Nova senha"><input type="password" value={profile.newPassword} onChange={e=>setProfile(p=>({...p,newPassword:e.target.value}))} className="input" placeholder="••••••••" /></Field>
                  <Field label="Confirmar senha"><input type="password" value={profile.confirmPassword} onChange={e=>setProfile(p=>({...p,confirmPassword:e.target.value}))} className="input" placeholder="••••••••" /></Field>
                </div>
              </div>
              {profileError && <div style={{ background:'#FEE2E2',color:'#DC2626',padding:'10px 16px',borderRadius:10,fontSize:13,fontWeight:600 }}>{profileError}</div>}
              <button onClick={handleSaveProfile} disabled={saving} className="btn-primary">
                {saving?<RefreshCw className="w-4 h-4 animate-spin"/>:saved?<CheckCircle className="w-4 h-4"/>:<Save className="w-4 h-4"/>}
                {saved?'Salvo!':'Salvar perfil'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Zona de Perigo ───────────────────────────────────────────────────────────

function DangerZone() {
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const doReset = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res: any = await (api as any).resetTestData();
      setResult({ ok: true, data: res.deleted });
      setConfirm(false);
      // Recarrega a página após 2s para limpar o estado da UI
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: any) {
      setResult({ ok: false, msg: e?.response?.data?.message || 'Erro ao resetar dados' });
    }
    setLoading(false);
  };

  return (
    <div style={{ border: '1.5px solid #FCA5A5', borderRadius: 12, padding: '16px 20px', background: '#FFF5F5', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', marginBottom: 4 }}>⚠️ Zona de Perigo</p>
          <p style={{ fontSize: 12, color: '#991B1B', lineHeight: 1.5 }}>
            Apaga <strong>todos os tickets, conversas e sessões do chatbot</strong> do sistema. Use apenas para testes.
            Esta ação <strong>não pode ser desfeita</strong>.
          </p>
        </div>
        {!confirm && (
          <button onClick={() => setConfirm(true)}
            style={{ flexShrink: 0, padding: '8px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Zerar dados
          </button>
        )}
      </div>
      {confirm && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: '#fff', borderRadius: 8, border: '1.5px solid #FCA5A5' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', marginBottom: 12 }}>
            Tem certeza? Isso apagará todos os tickets e conversas permanentemente.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={doReset} disabled={loading}
              style={{ padding: '8px 18px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Apagando...' : 'Sim, apagar tudo'}
            </button>
            <button onClick={() => { setConfirm(false); setResult(null); }}
              style={{ padding: '8px 14px', background: '#fff', color: '#64748B', border: '1.5px solid #E2E8F0', borderRadius: 7, fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {result && (
        <div style={{ marginTop: 10, padding: '10px 14px', background: result.ok ? '#F0FDF4' : '#FEF2F2', borderRadius: 8, border: `1px solid ${result.ok ? '#86EFAC' : '#FCA5A5'}` }}>
          {result.ok ? (
            <div style={{ fontSize: 12, color: '#15803D' }}>
              ✅ Dados apagados com sucesso!
              <span style={{ marginLeft: 8, color: '#166534' }}>
                {Object.entries(result.data).map(([k, v]: any) => `${k}: ${v}`).join(' | ')}
              </span>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#DC2626' }}>❌ {result.msg}</p>
          )}
        </div>
      )}
    </div>
  );
}
