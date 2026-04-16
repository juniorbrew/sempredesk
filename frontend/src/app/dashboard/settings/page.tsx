'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { DEFAULT_PRIORITY, type SystemPriority } from '@/lib/priorities';
import {
  Building2, Mail, Clock, Palette, User, Save, RefreshCw, CheckCircle,
  Eye, EyeOff, Send, ChevronRight, Lock, Bell, Key, Plus,
  Trash2, Edit2, Copy, Shield, ShieldCheck, Globe, Inbox, Bot,
  ToggleLeft, ToggleRight, ChevronUp, ChevronDown, MessageSquare, Zap, Smartphone, Users,
} from 'lucide-react';
import PerfisPage from '../perfis/page';

// �"?�"?�"? Chatbot types �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
interface ChatbotConfig {
  id?: string; name: string; welcomeMessage: string; menuTitle: string;
  enabled: boolean; channelWhatsapp: boolean; channelWeb: boolean; channelPortal: boolean;
  transferMessage: string; noAgentMessage: string; invalidOptionMessage: string;
  sessionTimeoutMinutes: number; menuItems?: ChatbotMenuItem[];
  /** Prefixo *nome* nas respostas do atendente ao cliente no WhatsApp. */
  whatsappPrefixAgentName?: boolean;
  postTicketMessage?: string | null;
  postTicketMessageNoAgent?: string | null;
  ratingRequestMessage?: string | null;
  ratingCommentMessage?: string | null;
  ratingThanksMessage?: string | null;
}
interface ChatbotMenuItem {
  id?: string; order: number; label: string; action: 'auto_reply' | 'transfer';
  autoReplyText?: string; department?: string; enabled: boolean;
}
type SlaTimeUnit = 'minutes' | 'hours' | 'days';
type SlaDurationField = { value: string; unit: SlaTimeUnit };
type SlaFormState = {
  name: string;
  priority: SystemPriority;
  firstResponse: SlaDurationField;
  resolution: SlaDurationField;
  isDefault: boolean;
};
const BOT_DEFAULT: ChatbotConfig = {
  name: 'Assistente Virtual', welcomeMessage: 'Olá! Seja bem-vindo. Como posso te ajudar hoje?',
  menuTitle: 'Escolha uma das opções abaixo:', enabled: false,
  channelWhatsapp: true, channelWeb: false, channelPortal: false,
  transferMessage: 'Aguarde, estou te conectando com um atendente...',
  noAgentMessage: 'Todos os atendentes estão ocupados. Entraremos em contato em breve.',
  invalidOptionMessage: 'Opção inválida. Por favor escolha uma opção do menu:',
  sessionTimeoutMinutes: 30,
  whatsappPrefixAgentName: false,
};

interface Settings {
  companyName: string; companyEmail: string; companyPhone: string;
  companyAddress: string; companyCnpj: string; companyLogo: string;
  primaryColor: string; secondaryColor: string;
  smtpHost: string; smtpPort: string; smtpUser: string;
  smtpPass: string; smtpFrom: string; smtpSecure: string;
  ticketCreatedNotify: string; ticketResolvedNotify: string; slaWarningNotify: string;
  escalationEmail: string;
  businessHours: any;
}
const DEFAULT: Settings = {
  companyName:'', companyEmail:'', companyPhone:'', companyAddress:'', companyCnpj:'', companyLogo:'',
  primaryColor:'#6366F1', secondaryColor:'#4F46E5',
  smtpHost:'', smtpPort:'587', smtpUser:'', smtpPass:'', smtpFrom:'', smtpSecure:'false',
  ticketCreatedNotify:'false', ticketResolvedNotify:'true', slaWarningNotify:'true',
  escalationEmail:'',
  businessHours: { mon:{open:true,start:'08:00',end:'18:00'}, tue:{open:true,start:'08:00',end:'18:00'}, wed:{open:true,start:'08:00',end:'18:00'}, thu:{open:true,start:'08:00',end:'18:00'}, fri:{open:true,start:'08:00',end:'18:00'}, sat:{open:false,start:'08:00',end:'12:00'}, sun:{open:false,start:'08:00',end:'12:00'} },
};
const DAY_LABELS: Record<string,string> = { mon:'Segunda', tue:'Terça', wed:'Quarta', thu:'Quinta', fri:'Sexta', sat:'Sábado', sun:'Domingo' };

/** Garante strings nos campos de settings: a API pode enviar null e inputs controlados exigem string. */
function coalesceSettings(raw: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT, ...(raw || {}) } as Settings;
  (Object.keys(DEFAULT) as (keyof Settings)[]).forEach((key) => {
    if (key === 'businessHours') return;
    const v = merged[key] as unknown;
    (merged as any)[key] = v == null ? (DEFAULT[key] as string) : String(v);
  });
  const defBh = DEFAULT.businessHours as Record<string, { open: boolean; start: string; end: string }>;
  const rawBh =
    raw?.businessHours && typeof raw.businessHours === 'object'
      ? (raw.businessHours as Record<string, { open?: boolean; start?: string; end?: string }>)
      : {};
  const outBh: Record<string, { open: boolean; start: string; end: string }> = {};
  for (const day of Object.keys(defBh)) {
    const base = defBh[day];
    const d = rawBh[day];
    if (d && typeof d === 'object') {
      outBh[day] = {
        open: !!d.open,
        start: d.start != null && String(d.start) !== '' ? String(d.start) : base.start,
        end: d.end != null && String(d.end) !== '' ? String(d.end) : base.end,
      };
    } else {
      outBh[day] = { ...base };
    }
  }
  merged.businessHours = outBh;
  return merged;
}

function coalesceChatbot(raw: Partial<ChatbotConfig> | null | undefined): ChatbotConfig {
  const m = { ...BOT_DEFAULT, ...(raw || {}) } as ChatbotConfig;
  (['name', 'welcomeMessage', 'menuTitle', 'transferMessage', 'noAgentMessage', 'invalidOptionMessage'] as const).forEach((k) => {
    const v = m[k];
    (m as any)[k] = v == null ? BOT_DEFAULT[k] : String(v);
  });
  (['postTicketMessage', 'postTicketMessageNoAgent', 'ratingRequestMessage', 'ratingCommentMessage', 'ratingThanksMessage'] as const).forEach((k) => {
    const v = m[k];
    (m as any)[k] = v == null ? '' : String(v);
  });
  const n = m.sessionTimeoutMinutes;
  m.sessionTimeoutMinutes =
    typeof n === 'number' && !Number.isNaN(n) ? n : BOT_DEFAULT.sessionTimeoutMinutes;
  m.enabled = !!m.enabled;
  m.channelWhatsapp = !!m.channelWhatsapp;
  m.channelWeb = !!m.channelWeb;
  m.channelPortal = !!m.channelPortal;
  const rawAny = raw as { whatsappPrefixAgentName?: unknown; whatsapp_prefix_agent_name?: unknown } | null | undefined;
  const wpRaw = rawAny?.whatsappPrefixAgentName ?? rawAny?.whatsapp_prefix_agent_name;
  m.whatsappPrefixAgentName = wpRaw === true || wpRaw === 1 || wpRaw === 'true';
  return m;
}

function mapBotMenuFromApi(bot: any): ChatbotMenuItem[] {
  return (bot.menuItems || []).map((item: any) => ({
    ...item,
    label: item?.label == null ? '' : String(item.label),
    autoReplyText: item?.autoReplyText == null ? '' : String(item.autoReplyText),
    department: item?.department == null ? undefined : String(item.department),
    order: typeof item?.order === 'number' ? item.order : 0,
    enabled: !!item?.enabled,
    action: item?.action === 'transfer' ? 'transfer' : 'auto_reply',
  }));
}

function pickSlaUnit(totalMinutes: number): SlaDurationField {
  if (totalMinutes > 0 && totalMinutes % 1440 === 0) {
    return { value: String(totalMinutes / 1440), unit: 'days' };
  }
  if (totalMinutes > 0 && totalMinutes % 60 === 0) {
    return { value: String(totalMinutes / 60), unit: 'hours' };
  }
  return { value: String(totalMinutes || 0), unit: 'minutes' };
}

function toMinutes(duration: SlaDurationField, fallbackMinutes: number): number {
  const rawValue = Number(duration.value);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return fallbackMinutes;
  if (duration.unit === 'days') return Math.round(rawValue * 1440);
  if (duration.unit === 'hours') return Math.round(rawValue * 60);
  return Math.round(rawValue);
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes > 0 && totalMinutes % 1440 === 0) {
    const days = totalMinutes / 1440;
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  if (totalMinutes > 0 && totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }
  return `${totalMinutes} min`;
}

function createEmptySlaForm(): SlaFormState {
  return {
    name: '',
    priority: DEFAULT_PRIORITY,
    firstResponse: pickSlaUnit(60),
    resolution: pickSlaUnit(480),
    isDefault: false,
  };
}

function mapSlaPolicyToForm(policy: any): SlaFormState {
  return {
    name: policy.name,
    priority: policy.priority,
    firstResponse: pickSlaUnit(Number(policy.firstResponseMinutes) || 60),
    resolution: pickSlaUnit(Number(policy.resolutionMinutes) || 480),
    isDefault: !!policy.isDefault,
  };
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label style={{ fontSize:12, fontWeight:600, color:'#64748B', display:'flex', alignItems:'center', gap:3 }}>
        {label}
        {required && <span style={{ color:'#EF4444', fontSize:12, lineHeight:1 }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize:11, color:'#94A3B8', marginTop:2, lineHeight:1.5 }}>{hint}</p>}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [profile, setProfile] = useState({ name:'', email:'', phone:'', currentPassword:'', newPassword:'', confirmPassword:'' });
  const [tab, setTab] = useState<'company'|'smtp'|'sla'|'visual'|'profile'|'perfis'|'notifications'|'business_hours'|'routing'|'webhooks'|'apikeys'|'inbound_email'|'chatbot'>('company');
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
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
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
  // SLA Policies
  const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
  const [slaForm, setSlaForm] = useState<SlaFormState>(createEmptySlaForm());
  const [showSlaForm, setShowSlaForm] = useState(false);
  const [editingSlaId, setEditingSlaId] = useState<string|null>(null);
  const [slaSaving, setSlaSaving] = useState(false);
  const [slaReport, setSlaReport] = useState<{ breached: any[]; atRisk: any[]; conversations: { breached: any[]; atRisk: any[] } } | null>(null);
  const tabKeys = ['company','smtp','sla','visual','profile','perfis','notifications','business_hours','routing','webhooks','apikeys','inbound_email','chatbot'] as const;

  const load = useCallback(async () => {
    try {
      const [s, me, t, r, wh, ak, bot, bst, depts, permsData, rolesData, slaData, slaRep] = await Promise.all([
        (api as any).getSettings(), api.me(), api.getTeam(),
        (api as any).getRoutingRules(), (api as any).getWebhooks(), (api as any).getApiKeys(),
        (api as any).getChatbotConfig().catch(() => null),
        (api as any).getChatbotStats().catch(() => null),
        (api as any).getTicketSettings({ type: 'department', perPage: 200 }).catch(() => null),
        (api as any).getAllPermissions().catch(() => null),
        (api as any).getRoles().catch(() => null),
        (api as any).getSlaPolicies().catch(() => null),
        (api as any).slaReport().catch(() => null),
      ]);
      if (s) setSettings(coalesceSettings(s));
      if (me) {
        const u = me as any;
        setProfile((p: any) => ({
          ...p,
          name: u.name != null ? String(u.name) : '',
          email: u.email != null ? String(u.email) : '',
          phone: u.phone != null ? String(u.phone) : '',
        }));
      }
      setTeam((t as any[]) || []);
      const rulesList = Array.isArray(r) ? r : Array.isArray((r as any)?.data) ? (r as any).data : [];
      setRules(rulesList);
      const whList = Array.isArray(wh) ? wh : Array.isArray((wh as any)?.data) ? (wh as any).data : [];
      setWebhooks(whList);
      const akList = Array.isArray(ak) ? ak : Array.isArray((ak as any)?.data) ? (ak as any).data : [];
      setApiKeys(akList);
      if (bot) {
        setBotConfig(coalesceChatbot(bot));
        setBotMenu(mapBotMenuFromApi(bot));
      }
      if (bst) setBotStats(bst);
      if (depts) {
        const list = Array.isArray(depts) ? depts : Array.isArray((depts as any)?.data) ? (depts as any).data : [];
        setDepartments(list.map((d: any) => d.name).filter(Boolean).sort());
      }
      if (permsData) setAllPerms(permsData);
      if (rolesData) {
        const rolesList = Array.isArray(rolesData) ? rolesData : Array.isArray((rolesData as any)?.data) ? (rolesData as any).data : [];
        setRoles(rolesList);
      }
      if (slaData) {
        const slaList = Array.isArray(slaData) ? slaData : Array.isArray((slaData as any)?.data) ? (slaData as any).data : [];
        setSlaPolicies(slaList);
      }
      if (slaRep) setSlaReport(slaRep);
    } catch {
      setLoadError('Falha ao carregar configurações. Verifique a conexão.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (!requestedTab) return;
    if ((tabKeys as readonly string[]).includes(requestedTab) && requestedTab !== tab) {
      setTab(requestedTab as typeof tab);
      setSaved(false);
      setProfileError('');
    }
  }, [searchParams, tab]);

  const upd = (key: keyof Settings, value: string) => setSettings(p => ({ ...p, [key]: value }));
  const updBH = (day: string, field: string, value: any) => setSettings(p => ({
    ...p, businessHours: { ...p.businessHours, [day]: { ...p.businessHours[day], [field]: value } }
  }));

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await (api as any).updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setSaveError(e?.response?.data?.message || 'Erro ao salvar. Verifique a conexão.');
      setTimeout(() => setSaveError(''), 4000);
    }
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
      setRules(Array.isArray(r) ? r : Array.isArray((r as any)?.data) ? (r as any).data : []);
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
      setWebhooks(Array.isArray(wh) ? wh : Array.isArray((wh as any)?.data) ? (wh as any).data : []);
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
      setApiKeys(Array.isArray(ak) ? ak : Array.isArray((ak as any)?.data) ? (ak as any).data : []);
    } catch {}
  };
  const revokeKey = async (id: string) => {
    if (!confirm('Revogar chave?')) return;
    await (api as any).revokeApiKey(id);
    const ak = await (api as any).getApiKeys();
    setApiKeys(Array.isArray(ak) ? ak : Array.isArray((ak as any)?.data) ? (ak as any).data : []);
  };

  // SLA Policies
  const saveSlaPolicy = async () => {
    setSlaSaving(true);
    try {
      const payload = {
        name: slaForm.name,
        priority: slaForm.priority,
        isDefault: slaForm.isDefault,
        firstResponseMinutes: toMinutes(slaForm.firstResponse, 60),
        resolutionMinutes: toMinutes(slaForm.resolution, 480),
      };
      if (editingSlaId) { await (api as any).updateSlaPolicy(editingSlaId, payload); }
      else { await (api as any).createSlaPolicy(payload); }
      setShowSlaForm(false); setEditingSlaId(null);
      setSlaForm(createEmptySlaForm());
      const fresh = await (api as any).getSlaPolicies();
      setSlaPolicies(Array.isArray(fresh) ? fresh : Array.isArray((fresh as any)?.data) ? (fresh as any).data : []);
    } catch (e: any) { alert(e?.response?.data?.message || 'Erro ao salvar política SLA'); }
    setSlaSaving(false);
  };
  const deleteSlaPolicy = async (id: string) => {
    if (!confirm('Excluir política SLA?')) return;
    await (api as any).deleteSlaPolicy(id);
    setSlaPolicies(prev => prev.filter(p => p.id !== id));
  };
  const editSlaPolicy = (p: any) => {
    setSlaForm(mapSlaPolicyToForm(p));
    setEditingSlaId(p.id); setShowSlaForm(true);
  };

  // �"?�"? Chatbot helpers �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
  const saveBotConfig = async () => {
    setBotSaving(true);
    try {
      const { menuItems, id, ...rest } = botConfig as any;
      const dto = { ...rest, whatsappPrefixAgentName: !!rest.whatsappPrefixAgentName };
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
      if (bot) {
        setBotConfig(coalesceChatbot(bot));
        setBotMenu(mapBotMenuFromApi(bot));
      }
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
    { key:'perfis', label:'Perfis e Permissões', icon:ShieldCheck },
    { key:'profile', label:'Meu perfil', icon:User },
  ] as const;

  const WH_EVENTS = ['ticket.created','ticket.updated','ticket.resolved','ticket.closed','sla.warning'];

  return (
    <div className="bg-slate-50 min-h-full">
      <style>{`.settings-scope .input { padding-top: 7px !important; padding-bottom: 7px !important; }`}</style>
      <div className="settings-scope max-w-5xl mx-auto px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-slate-200">
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, color:'#0F172A', letterSpacing:'-0.015em', margin:0 }}>Configurações</h1>
          <p style={{ fontSize:12, color:'#94A3B8', marginTop:3 }}>Configure os parâmetros globais do sistema de suporte</p>
        </div>
        {!['profile','perfis','routing','webhooks','apikeys','inbound_email','chatbot','sla'].includes(tab) && (
          <div className="flex items-center gap-3">
            {saveError && <span style={{ fontSize:12, fontWeight:600, color:'#DC2626' }}>{saveError}</span>}
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Salvo!' : 'Salvar alterações'}
            </button>
          </div>
        )}
      </div>

      {loadError && (
        <div style={{ background:'#FEE2E2', color:'#DC2626', padding:'10px 16px', borderRadius:10, fontSize:13, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <span>{loadError}</span>
          <button onClick={() => { setLoadError(''); load(); }} style={{ background:'none', border:'1.5px solid #DC2626', borderRadius:6, padding:'4px 10px', fontSize:12, fontWeight:700, color:'#DC2626', cursor:'pointer' }}>
            Tentar novamente
          </button>
        </div>
      )}

      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Sidebar */}
        <div className="card p-1.5 lg:w-52 shrink-0 h-fit" style={{ borderColor:'#C9D3E0' }}>
          {TABS.map(({ key, label, icon:Icon }) => (
            <button key={key} onClick={() => { setTab(key as any); router.replace(`/dashboard/settings?tab=${key}`, { scroll: false }); setSaved(false); setProfileError(''); }}
              style={{ width:'100%', display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:8, border:'none', cursor:'pointer', background: tab===key ? '#EEF2FF' : 'transparent', color: tab===key ? '#4F46E5' : '#64748B', fontWeight: tab===key ? 600 : 400, fontSize:12, marginBottom:1 }}>
              <Icon className="w-3.5 h-3.5 shrink-0" /><span className="truncate flex-1 text-left">{label}</span>
              {tab===key && <ChevronRight className="w-3 h-3" />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 card p-5 min-w-0" style={{ borderColor:'#C9D3E0' }}>

          {/* Company */}
          {tab === 'company' && (
            <div className="space-y-5">

              {/* Cabeçalho da seção */}
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Empresa cadastrada</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                  Essas informações são exibidas nos e-mails enviados aos clientes e no portal de atendimento.
                  Campos marcados com <span style={{ color:'#EF4444' }}>*</span> são obrigatórios.
                </p>
              </div>

              {/* �"?�"? Seção 1: Identificação �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Building2 className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Identificação</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Nome legal e CNPJ da empresa</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'16px' }}>
                  <Field label="Nome da empresa" required hint="Exibido no cabeçalho dos e-mails e no portal do cliente">
                    <input value={settings.companyName} onChange={e=>upd('companyName',e.target.value)} className="input" placeholder="Ex.: SempreDesk Tecnologia Ltda." />
                  </Field>
                  <Field label="CNPJ" hint="Apenas para controle interno — não é exibido aos clientes">
                    <input value={settings.companyCnpj} onChange={e=>upd('companyCnpj',e.target.value)} className="input" placeholder="Ex.: 00.000.000/0001-00" />
                  </Field>
                </div>
              </div>

              {/* �"?�"? Seção 2: Contato �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Mail className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Contato</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Canal de comunicação da empresa com os clientes</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'16px' }}>
                  <Field label="E-mail de contato" required hint="Usado como remetente padrão nas notificações automáticas">
                    <input value={settings.companyEmail} onChange={e=>upd('companyEmail',e.target.value)} className="input" placeholder="Ex.: contato@empresa.com.br" />
                  </Field>
                  <Field label="Telefone comercial" hint="Opcional — aparece no rodapé dos e-mails se preenchido">
                    <input value={settings.companyPhone} onChange={e=>upd('companyPhone',e.target.value)} className="input" placeholder="Ex.: (47) 99999-9999" />
                  </Field>
                </div>
              </div>

              {/* �"?�"? Seção 3: Localização �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Globe className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Localização</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Endereço físico — opcional, aparece no rodapé dos e-mails</p>
                  </div>
                </div>
                <div style={{ padding:'16px' }}>
                  <Field label="Endereço da sede" hint="Formato livre — ex.: Av. Paulista, 1000, São Paulo - SP">
                    <input value={settings.companyAddress} onChange={e=>upd('companyAddress',e.target.value)} className="input" placeholder="Ex.: Av. Paulista, 1000 — São Paulo, SP" />
                  </Field>
                </div>
              </div>

              {/* �"?�"? Seção 4: Marca e exibição �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Palette className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Marca e exibição</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Logotipo exibido no portal e nos e-mails enviados aos clientes</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'16px' }}>
                  <Field label="URL do logotipo" hint="Link público para imagem PNG, SVG ou JPEG — mínimo 200 x 60 px recomendado">
                    <input value={settings.companyLogo} onChange={e=>upd('companyLogo',e.target.value)} className="input" placeholder="Ex.: https://empresa.com/logo.png" />
                  </Field>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', background:'#F8FAFC', border:'1.5px dashed #E2E8F0', borderRadius:10, padding:'12px', minHeight:62 }}>
                    {settings.companyLogo
                      ? <img src={settings.companyLogo} alt="Pré-visualização do logotipo" style={{ maxHeight:50, maxWidth:'100%', objectFit:'contain' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <span style={{ fontSize:11, color:'#CBD5E1', textAlign:'center' }}>Pré-visualização aparece aqui após informar a URL</span>
                    }
                  </div>
                </div>
              </div>

              {/* �"?�"? Zona de Perigo �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderTop:'1.5px solid #FEE2E2', paddingTop:16 }}>
                <p style={{ fontSize:11, fontWeight:700, color:'#DC2626', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Zona de perigo</p>
                <DangerZone />
              </div>

            </div>
          )}

          {/* SMTP */}
          {tab === 'smtp' && (
            <div className="space-y-4">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>E-mail (SMTP)</h2>
                <p style={{ fontSize:12, color:'#94A3B8', marginTop:2 }}>Servidor de saída para notificações e alertas automáticos.</p>
              </div>

              {/* �"?�"? Servidor �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'9px 14px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:8 }}>
                  <Globe className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Servidor</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Endereço, porta e criptografia</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ padding:'14px 16px' }}>
                  <Field label="Endereço do servidor" required hint="Ex.: smtp.gmail.com, smtp.sendgrid.net">
                    <input value={settings.smtpHost} onChange={e=>upd('smtpHost',e.target.value)} className="input" placeholder="Ex.: smtp.gmail.com" />
                  </Field>
                  <Field label="Porta" hint="587 (TLS recomendado) ou 465 (SSL)">
                    <select value={settings.smtpPort} onChange={e=>upd('smtpPort',e.target.value)} className="input">
                      <option value="587">587 - TLS (recomendado)</option>
                      <option value="465">465 - SSL/TLS</option>
                      <option value="25">25 - Sem criptografia</option>
                    </select>
                  </Field>
                  <Field label="Criptografia" hint="Deve coincidir com a porta escolhida">
                    <select value={settings.smtpSecure} onChange={e=>upd('smtpSecure',e.target.value)} className="input">
                      <option value="false">STARTTLS (porta 587)</option>
                      <option value="true">SSL/TLS (porta 465)</option>
                    </select>
                  </Field>
                </div>
              </div>

              {/* �"?�"? Autenticação e remetente �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'9px 14px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:8 }}>
                  <Lock className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Autenticação e remetente</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Credenciais de acesso e endereço de envio</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'14px 16px' }}>
                  <Field label="Usuário SMTP" hint="Geralmente o e-mail da conta de envio">
                    <input value={settings.smtpUser} onChange={e=>upd('smtpUser',e.target.value)} className="input" placeholder="Ex.: noreply@empresa.com" />
                  </Field>
                  <Field label="Senha SMTP" hint="Gmail: &quot;Senha de app&quot; · SendGrid: API key">
                    <div style={{ position:'relative' }}>
                      <input type={showPass?'text':'password'} value={settings.smtpPass} onChange={e=>upd('smtpPass',e.target.value)} className="input" placeholder="Digite a senha SMTP" style={{ paddingRight:40 }} />
                      <button type="button" onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94A3B8' }}>
                        {showPass?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
                      </button>
                    </div>
                  </Field>
                  <Field label="Remetente (From)" required hint="Nome e e-mail visíveis no recebimento - ex.: Suporte &lt;no-reply@empresa.com&gt;">
                    <input value={settings.smtpFrom} onChange={e=>upd('smtpFrom',e.target.value)} className="input" placeholder="Ex.: Suporte <no-reply@empresa.com>" />
                  </Field>
                </div>
              </div>

              {/* �"?�"? Testar conexão �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'10px 14px', background:'#F8FAFC', borderRadius:10, border:'1.5px solid #E2E8F0' }}>
                <button onClick={async()=>{ setSmtpTesting(true);setSmtpResult(null);try{const r=await(api as any).testSmtp();setSmtpResult(r);}catch{setSmtpResult({success:false,message:'Erro ao testar'});}setSmtpTesting(false);}} disabled={smtpTesting||!settings.smtpHost} className="btn-secondary">
                  {smtpTesting?<RefreshCw className="w-4 h-4 animate-spin"/>:<Send className="w-4 h-4"/>} Testar conexão SMTP
                </button>
                {smtpResult
                  ? <span style={{ fontSize:13, fontWeight:600, color:smtpResult.success?'#16A34A':'#DC2626' }}>{smtpResult.success ? 'Sucesso:' : 'Erro:'} {smtpResult.message}</span>
                  : <span style={{ fontSize:12, color:'#94A3B8' }}>Envia um e-mail de teste para validar as configurações</span>
                }
              </div>
            </div>
          )}

          {/* Notifications */}
          {tab === 'notifications' && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Notificações por e-mail</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                  Controle quais eventos disparam e-mails automáticos para os clientes e para a equipe de suporte.
                </p>
              </div>

              {/* �"?�"? E-mails para o cliente �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Mail className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>E-mails para o cliente</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Disparados automaticamente conforme o ciclo de vida do ticket</p>
                  </div>
                </div>
                <div className="space-y-0">
                  {[
                    { key:'ticketCreatedNotify',  label:'Ticket aberto',   desc:'Envia confirmação ao cliente quando um novo ticket é criado' },
                    { key:'ticketResolvedNotify', label:'Ticket resolvido', desc:'Envia e-mail de encerramento com link para avaliação do atendimento' },
                  ].map(({ key, label, desc }, idx, arr) => (
                    <div key={key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', background:'#fff', borderBottom: idx < arr.length-1 ? '1px solid #F1F5F9' : 'none' }}>
                      <div>
                        <p style={{ fontSize:13, fontWeight:600, color:'#0F172A', margin:0 }}>{label}</p>
                        <p style={{ fontSize:11, color:'#94A3B8', marginTop:2 }}>{desc}</p>
                      </div>
                      <Toggle checked={settings[key as keyof Settings]==='true'} onChange={v=>upd(key as keyof Settings, String(v))} />
                    </div>
                  ))}
                </div>
              </div>

              {/* �"?�"? Alertas internos da equipe �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Bell className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Alertas da equipe</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Notificações enviadas aos responsáveis internos</p>
                  </div>
                </div>
                <div style={{ padding:'13px 16px', borderBottom:'1px solid #F1F5F9' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div>
                      <p style={{ fontSize:13, fontWeight:600, color:'#0F172A', margin:0 }}>SLA em risco</p>
                      <p style={{ fontSize:11, color:'#94A3B8', marginTop:2 }}>Alerta quando um ticket se aproxima do prazo máximo de resolução</p>
                    </div>
                    <Toggle checked={settings.slaWarningNotify==='true'} onChange={v=>upd('slaWarningNotify', String(v))} />
                  </div>
                </div>
                <div style={{ padding:'16px' }}>
                  <Field label="E-mail de destino dos alertas de SLA" hint="Endereço que recebe os avisos de SLA em risco - ex.: supervisor@empresa.com ou uma lista de distribuição">
                    <input value={settings.escalationEmail} onChange={e=>upd('escalationEmail',e.target.value)} className="input" placeholder="Ex.: supervisor@empresa.com" />
                  </Field>
                </div>
              </div>

              <div style={{ background:'#EEF2FF', borderRadius:10, padding:'11px 16px', border:'1.5px solid #C7D2FE' }}>
                <p style={{ fontSize:12, color:'#4338CA' }}>As notificações por e-mail exigem um servidor SMTP configurado na aba <strong>E-mail (SMTP)</strong>.</p>
              </div>
            </div>
          )}

          {/* SLA */}
          {tab === 'sla' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Políticas de prazo</h2>
                  <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                    Configure os prazos de primeira resposta e resolução. O vínculo entre prioridade e SLA é feito em Cadastros &gt; Prioridades, e o sistema continua salvando tudo internamente em minutos.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href="/dashboard/priorities" className="btn-secondary">
                    Gerenciar prioridades
                  </Link>
                  <button onClick={() => { setShowSlaForm(true); setEditingSlaId(null); setSlaForm(createEmptySlaForm()); }} className="btn-primary" style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <Plus className="w-4 h-4" /> Nova política de prazo
                </button>
                </div>
              </div>

              {showSlaForm && (
                <div style={{ background:'#F8FAFC', borderRadius:12, border:'1.5px solid #E2E8F0', padding:'20px' }}>
                  <h3 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:'0 0 16px' }}>{editingSlaId ? 'Editar política de prazo' : 'Nova política de prazo'}</h3>
                  <div style={{ marginBottom:16, padding:'10px 12px', borderRadius:10, background:'#EFF6FF', border:'1px solid #BFDBFE', color:'#1D4ED8', fontSize:12, lineHeight:1.5 }}>
                    Esta tela define apenas os prazos. A prioridade que usa esta política é escolhida em <strong>Cadastros &gt; Prioridades</strong>.
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field label="Nome" required>
                      <input value={slaForm.name} onChange={e=>setSlaForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex.: Padrão, Urgente, VIP..." />
                    </Field>
                    <Field label="1ª resposta" hint={`Tempo máximo para o agente responder pela primeira vez. Equivale a ${toMinutes(slaForm.firstResponse, 60)} min.`}>
                      <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                        <input type="number" min={1} value={slaForm.firstResponse.value} onChange={e=>setSlaForm((p)=>({...p,firstResponse:{...p.firstResponse,value:e.target.value}}))} className="input" />
                        <select value={slaForm.firstResponse.unit} onChange={e=>setSlaForm((p)=>({...p,firstResponse:{...p.firstResponse,unit:e.target.value as SlaTimeUnit}}))} className="input">
                          <option value="minutes">Minutos</option>
                          <option value="hours">Horas</option>
                          <option value="days">Dias</option>
                        </select>
                      </div>
                    </Field>
                    <Field label="Resolução" hint={`Tempo máximo para encerrar o atendimento. Equivale a ${toMinutes(slaForm.resolution, 480)} min.`}>
                      <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
                        <input type="number" min={1} value={slaForm.resolution.value} onChange={e=>setSlaForm((p)=>({...p,resolution:{...p.resolution,value:e.target.value}}))} className="input" />
                        <select value={slaForm.resolution.unit} onChange={e=>setSlaForm((p)=>({...p,resolution:{...p.resolution,unit:e.target.value as SlaTimeUnit}}))} className="input">
                          <option value="minutes">Minutos</option>
                          <option value="hours">Horas</option>
                          <option value="days">Dias</option>
                        </select>
                      </div>
                    </Field>
                  </div>
                  <div className="flex items-center gap-3" style={{ marginTop:16 }}>
                    <Toggle checked={slaForm.isDefault} onChange={v=>setSlaForm((p:any)=>({...p,isDefault:v}))} label="Política padrão (usada quando nenhuma prioridade corresponder)" />
                  </div>
                  <div className="flex items-center gap-3" style={{ marginTop:16 }}>
                    <button onClick={saveSlaPolicy} disabled={slaSaving || !slaForm.name.trim()} className="btn-primary">
                      {slaSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {editingSlaId ? 'Salvar alterações' : 'Criar política de prazo'}
                    </button>
                    <button onClick={() => { setShowSlaForm(false); setEditingSlaId(null); }} style={{ fontSize:13, color:'#64748B', background:'none', border:'none', cursor:'pointer', padding:'7px 12px' }}>Cancelar</button>
                  </div>
                </div>
              )}

              {slaPolicies.length === 0 && !showSlaForm && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'#94A3B8', fontSize:13 }}>
                  Nenhuma política de prazo configurada. Clique em <strong>Nova política de prazo</strong> para começar.
                </div>
              )}

              {slaPolicies.length > 0 && (
                <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                  {slaPolicies.map((p: any, idx: number) => {
                    return (
                      <div key={p.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', background:'#fff', borderBottom: idx < slaPolicies.length-1 ? '1px solid #F1F5F9' : 'none', flexWrap:'wrap' }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="flex items-center gap-2" style={{ flexWrap:'wrap' }}>
                            <span style={{ fontSize:14, fontWeight:700, color:'#0F172A' }}>{p.name}</span>
                            {p.isDefault && <span style={{ fontSize:10, fontWeight:700, background:'#EEF2FF', color:'#4338CA', borderRadius:6, padding:'2px 7px' }}>PADRÃO</span>}
                          </div>
                          <p style={{ fontSize:12, color:'#64748B', margin:'3px 0 0' }}>
                            1ª resposta: <strong>{formatDuration(p.firstResponseMinutes)}</strong> <span style={{ color:'#94A3B8' }}>({p.firstResponseMinutes} min)</span> &nbsp;·&nbsp; Resolução: <strong>{formatDuration(p.resolutionMinutes)}</strong> <span style={{ color:'#94A3B8' }}>({p.resolutionMinutes} min)</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => editSlaPolicy(p)} style={{ background:'none', border:'1px solid #E2E8F0', borderRadius:8, padding:'5px 10px', cursor:'pointer', color:'#475569', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
                            <Edit2 className="w-3 h-3" /> Editar
                          </button>
                          <button onClick={() => deleteSlaPolicy(p.id)} style={{ background:'none', border:'1px solid #FCA5A5', borderRadius:8, padding:'5px 10px', cursor:'pointer', color:'#DC2626', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
                            <Trash2 className="w-3 h-3" /> Excluir
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ background:'#EEF2FF', borderRadius:10, padding:'11px 16px', border:'1.5px solid #C7D2FE', fontSize:12, color:'#4338CA' }}>
                As políticas de prazo são aplicadas automaticamente a novas conversas e tickets conforme o vínculo definido em Cadastros &gt; Prioridades. O alerta de risco é disparado quando restar menos de 20% do prazo de resolução.
              </div>

              {slaReport && (slaReport.breached.length > 0 || slaReport.atRisk.length > 0 || slaReport.conversations.breached.length > 0 || slaReport.conversations.atRisk.length > 0) && (
                <div>
                  <h3 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:'0 0 12px' }}>Situação atual</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label:'Tickets violados', value: slaReport.breached.length, color:'#DC2626', bg:'#FEF2F2' },
                      { label:'Tickets em risco', value: slaReport.atRisk.length, color:'#F97316', bg:'#FFF7ED' },
                      { label:'Conversas violadas', value: slaReport.conversations.breached.length, color:'#DC2626', bg:'#FEF2F2' },
                      { label:'Conversas em risco', value: slaReport.conversations.atRisk.length, color:'#F97316', bg:'#FFF7ED' },
                    ].map(({ label, value, color, bg }) => (
                      <div key={label} style={{ background: bg, borderRadius: 10, padding: '14px 16px', border: `1.5px solid ${color}22` }}>
                        <p style={{ fontSize: 22, fontWeight: 800, color, margin: 0 }}>{value}</p>
                        <p style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>{label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Business Hours */}
          {tab === 'business_hours' && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Horário Comercial</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                  Define os dias e horários em que a equipe está disponível. Usado para cálculo de SLA e roteamento do chatbot.
                </p>
              </div>
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0' }}>
                  <p style={{ fontSize:12, color:'#64748B', margin:0 }}>Ative o dia e defina o intervalo de atendimento. Dias desativados são tratados como <strong>fechado</strong>.</p>
                </div>
                <div>
                  {Object.entries(DAY_LABELS).map(([day, label], idx, arr) => {
                    const bh = settings.businessHours?.[day] || { open:false, start:'08:00', end:'18:00' };
                    return (
                      <div key={day} style={{ display:'flex', alignItems:'center', gap:16, padding:'11px 16px', background:'#fff', borderBottom: idx < arr.length-1 ? '1px solid #F1F5F9' : 'none', flexWrap:'wrap' }}>
                        <Toggle checked={!!bh.open} onChange={v=>updBH(day,'open',v)} />
                        <span style={{ fontSize:13, fontWeight:600, color: bh.open ? '#0F172A' : '#94A3B8', minWidth:72 }}>{label}</span>
                        {bh.open ? (
                          <div className="flex items-center gap-2">
                            <input type="time" value={bh.start||'08:00'} onChange={e=>updBH(day,'start',e.target.value)} className="input" style={{ width:110 }} />
                            <span style={{ color:'#CBD5E1', fontSize:13 }}>até</span>
                            <input type="time" value={bh.end||'18:00'} onChange={e=>updBH(day,'end',e.target.value)} className="input" style={{ width:110 }} />
                          </div>
                        ) : <span style={{ fontSize:12, color:'#CBD5E1' }}>Fechado</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ background:'#F8FAFC', borderRadius:10, padding:'11px 16px', border:'1.5px solid #E2E8F0', fontSize:12, color:'#64748B' }}>
                Os horários são interpretados no fuso horário do servidor. Tickets abertos fora do horário comercial ainda são registrados normalmente.
              </div>
            </div>
          )}

          {/* Visual */}
          {tab === 'visual' && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Personalização visual</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                  Cores da identidade visual aplicadas em botões, destaques e elementos de navegação do portal.
                </p>
              </div>
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Palette className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Paleta de cores</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Clique no seletor ou digite o código hexadecimal da cor</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'16px' }}>
                  <Field label="Cor primária" hint="Usada em botões de ação, links ativos e badges de status">
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <input type="color" value={settings.primaryColor} onChange={e=>upd('primaryColor',e.target.value)} style={{ width:48, height:36, borderRadius:8, border:'2px solid #E2E8F0', cursor:'pointer', padding:2 }} />
                      <input value={settings.primaryColor} onChange={e=>upd('primaryColor',e.target.value)} className="input" style={{ flex:1, fontFamily:'monospace', fontWeight:700 }} />
                    </div>
                  </Field>
                  <Field label="Cor secundária" hint="Usada em gradientes do sidebar, gráficos e elementos de apoio">
                    <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                      <input type="color" value={settings.secondaryColor} onChange={e=>upd('secondaryColor',e.target.value)} style={{ width:48, height:36, borderRadius:8, border:'2px solid #E2E8F0', cursor:'pointer', padding:2 }} />
                      <input value={settings.secondaryColor} onChange={e=>upd('secondaryColor',e.target.value)} className="input" style={{ flex:1, fontFamily:'monospace', fontWeight:700 }} />
                    </div>
                  </Field>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'#F8FAFC', borderRadius:10, border:'1.5px solid #E2E8F0' }}>
                <div style={{ width:32, height:32, borderRadius:8, background:`linear-gradient(135deg, ${settings.primaryColor}, ${settings.secondaryColor})`, flexShrink:0 }} />
                <div>
                  <p style={{ fontSize:12, fontWeight:600, color:'#0F172A', margin:0 }}>Pré-visualização do gradiente</p>
                  <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Combinação das duas cores aplicada no sidebar e em elementos destacados</p>
                </div>
              </div>
            </div>
          )}

          {/* Routing Rules */}
          {tab === 'routing' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Regras de Encaminhamento</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Auto-atribuir tickets com base em condições (primeira regra que combinar é aplicada)</p></div>
                <button onClick={()=>{setEditingRule(null);setRuleForm({ name:'',condDepartment:'',condCategory:'',condPriority:'',condOrigin:'',actionAssignTo:'',actionSetPriority:'',actionNotifyEmail:'',priority:0,active:true });setShowRuleForm(true);}} className="btn-primary"><Plus className="w-4 h-4"/>Nova regra</button>
              </div>
              {showRuleForm && (
                <div style={{ background:'#F8FAFC',borderRadius:14,padding:20,border:'1.5px solid #E2E8F0' }}>
                  <h3 style={{ fontSize:14,fontWeight:700,color:'#0F172A',marginBottom:16 }}>{editingRule?'Editar regra':'Nova regra'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Nome da regra" hint="Descreva a intenção da regra - ex.: Alta prioridade para suporte crítico">
                      <input value={ruleForm.name} onChange={e=>setRuleForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex.: Alta prioridade - João" />
                    </Field>
                    <Field label="Ordem de execução" hint="Número menor = maior prioridade. Regras são aplicadas em ordem crescente.">
                      <input type="number" value={ruleForm.priority} onChange={e=>setRuleForm((p:any)=>({...p,priority:parseInt(e.target.value)||0}))} className="input" placeholder="Ex.: 1" />
                    </Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:10 }}>Condições - deixe vazio para ignorar o campo</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Departamento" hint="Nome exato do departamento cadastrado no sistema">
                      <input value={ruleForm.condDepartment} onChange={e=>setRuleForm((p:any)=>({...p,condDepartment:e.target.value}))} className="input" placeholder="Ex.: Suporte Técnico" />
                    </Field>
                    <Field label="Categoria" hint="Nome exato da categoria do ticket">
                      <input value={ruleForm.condCategory} onChange={e=>setRuleForm((p:any)=>({...p,condCategory:e.target.value}))} className="input" placeholder="Ex.: Falha de sistema" />
                    </Field>
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
                          {' - '}
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
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Webhooks</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Dispare eventos HTTP para sistemas externos quando tickets forem alterados</p></div>
                <button onClick={()=>{setEditingWh(null);setWhForm({name:'',url:'',secret:'',events:['ticket.created','ticket.updated','ticket.resolved']});setShowWhForm(true);}} className="btn-primary"><Plus className="w-4 h-4"/>Novo webhook</button>
              </div>
              {showWhForm && (
                <div style={{ background:'#F8FAFC',borderRadius:14,padding:20,border:'1.5px solid #E2E8F0' }}>
                  <h3 style={{ fontSize:14,fontWeight:700,color:'#0F172A',marginBottom:16 }}>{editingWh?'Editar webhook':'Novo webhook'}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <Field label="Nome do webhook" hint="Identificação interna - ex.: ERP Interno, Slack #suporte">
                      <input value={whForm.name} onChange={e=>setWhForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex.: ERP Interno" />
                    </Field>
                    <Field label="URL do endpoint" hint="Endpoint HTTPS público que receberá o payload JSON">
                      <input value={whForm.url} onChange={e=>setWhForm((p:any)=>({...p,url:e.target.value}))} className="input" placeholder="Ex.: https://meusite.com/webhook" />
                    </Field>
                    <Field label="Segredo HMAC" hint="Opcional - usado para validar a assinatura do header X-Signature-256">
                      <input value={whForm.secret} onChange={e=>setWhForm((p:any)=>({...p,secret:e.target.value}))} className="input" placeholder="Ex.: meu_segredo_secreto" />
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
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><h2 style={{ fontSize:16,fontWeight:700,color:'#0F172A' }}>Chaves de API</h2><p style={{ fontSize:13,color:'#94A3B8',marginTop:2 }}>Chaves para acesso à API pública. A chave é exibida apenas uma vez na criação.</p></div>
                <button onClick={()=>setShowKeyForm(true)} className="btn-primary"><Plus className="w-4 h-4"/>Nova chave</button>
              </div>
              {newKeyValue && (
                <div style={{ background:'#DCFCE7',borderRadius:12,padding:16,border:'1.5px solid #86EFAC' }}>
                  <p style={{ fontSize:13,fontWeight:700,color:'#166534',marginBottom:8 }}>Chave criada! Copie agora - ela não será exibida novamente.</p>
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
                    <Field label="Identificação da chave" hint="Nome para identificar onde esta chave será usada - ex.: Integração ERP, App Mobile">
                      <input value={keyForm.name} onChange={e=>setKeyForm((p:any)=>({...p,name:e.target.value}))} className="input" placeholder="Ex.: Integração ERP" />
                    </Field>
                    <Field label="Data de expiração" hint="Opcional - deixe em branco para chave sem expiração">
                      <input type="date" value={keyForm.expiresAt} onChange={e=>setKeyForm((p:any)=>({...p,expiresAt:e.target.value}))} className="input" />
                    </Field>
                  </div>
                  <p style={{ fontSize:12,fontWeight:700,color:'#64748B',textTransform:'uppercase',letterSpacing:1,marginBottom:6 }}>Nível de acesso</p>
                  <p style={{ fontSize:11,color:'#94A3B8',marginBottom:10 }}>read = somente leitura · write = leitura e escrita · admin = acesso total</p>
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
            <div className="space-y-4">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A' }}>E-mail Recebido</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:2 }}>Configure seu provedor de e-mail para criar tickets automaticamente quando receber mensagens</p>
              </div>
              <div style={{ background:'#F8FAFC', borderRadius:14, padding:20, border:'1.5px solid #E2E8F0' }}>
                <p style={{ fontSize:14, fontWeight:700, color:'#0F172A', marginBottom:12 }}>URL do webhook de entrada</p>
                <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff', borderRadius:10, padding:'10px 14px', border:'1.5px solid #E2E8F0', marginBottom:12 }}>
                  <code style={{ flex:1, fontSize:12, fontFamily:'monospace', color:'#4F46E5', wordBreak:'break-all' }}>
                    {typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':4000') : 'https://seu-servidor'}/api/v1/email/inbound
                  </code>
                  <button onClick={() => navigator.clipboard.writeText((typeof window !== 'undefined' ? window.location.origin.replace(':3000', ':4000') : '') + '/api/v1/email/inbound')}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'#64748B', flexShrink:0 }} title="Copiar">
                    <Copy className="w-4 h-4" />
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
                    ['Mailgun', 'Configure em Receiving -> Routes -> Forward to URL'],
                    ['SendGrid', 'Configure em Settings -> Inbound Parse -> Add Host & URL'],
                    ['Postmark', 'Configure em Inbound -> Webhooks -> Add webhook URL'],
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
                Configure a variável de ambiente <code style={{ fontFamily:'monospace', background:'rgba(0,0,0,0.05)', padding:'1px 4px', borderRadius:4 }}>INBOUND_EMAIL_SECRET</code> no servidor para validar as requisições. O campo &quot;De&quot; do e-mail será usado como remetente e o assunto como título do ticket.
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

              {/* Mesma opção que em /dashboard/configuracoes/chatbot �?" aqui é onde a maioria entra (Configurações �?' Chatbot) */}
              <div style={{ background:'#F8FAFC', borderRadius:12, border:'1.5px solid #A5B4FC', padding:'16px 18px' }}>
                <p style={{ fontSize:11, fontWeight:800, color:'#4F46E5', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>WhatsApp · nome do agente nas respostas</p>
                <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', marginBottom:8 }}>Mostrar nome do atendente na primeira linha (negrito) nas mensagens ao cliente</p>
                <p style={{ fontSize:12, color:'#64748B', lineHeight:1.55, marginBottom:14 }}>
                  O texto usa o <strong>nome do utilizador com sessão iniciada no painel</strong>, no formato{' '}
                  <code style={{ fontFamily:'monospace', background:'#EEF2FF', padding:'2px 6px', borderRadius:4 }}>*Nome*</code>.
                  O histórico interno do atendimento não leva este prefixo. Depois de mudar o interruptor, clique em{' '}
                  <strong>Salvar configurações do bot</strong> (botão mais abaixo, após os canais).
                </p>
                <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:14 }}>
                  <Toggle
                    checked={!!botConfig.whatsappPrefixAgentName}
                    onChange={(v) => setBotConfig((c) => ({ ...c, whatsappPrefixAgentName: v }))}
                    label={botConfig.whatsappPrefixAgentName ? 'Ativado' : 'Desativado'}
                  />
                  <button type="button" onClick={saveBotConfig} disabled={botSaving} className="btn-primary">
                    {botSaving ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
                    Salvar nome no WhatsApp
                  </button>
                </div>
              </div>

              {/* Mensagens */}
              <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                <p style={{ fontSize:13, fontWeight:700, color:'#374151', marginBottom:4 }}>Mensagens do bot</p>
                <p style={{ fontSize:12, color:'#94A3B8', marginBottom:14 }}>Textos exibidos ao cliente durante a interação com o assistente virtual</p>
                <div className="space-y-4">
                  <Field label="Nome do assistente" hint="Exibido para o cliente como identificação do bot - ex.: Assistente SempreDesk">
                    <input value={botConfig.name} onChange={e=>setBotConfig(c=>({...c,name:e.target.value}))} className="input" placeholder="Ex.: Assistente Virtual" />
                  </Field>
                  <Field label="Mensagem de boas-vindas" hint="Primeira mensagem enviada ao cliente ao iniciar uma conversa">
                    <textarea value={botConfig.welcomeMessage} onChange={e=>setBotConfig(c=>({...c,welcomeMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} />
                  </Field>
                  <Field label="Título do menu de opções" hint="Texto exibido logo acima das opções do menu">
                    <input value={botConfig.menuTitle} onChange={e=>setBotConfig(c=>({...c,menuTitle:e.target.value}))} className="input" />
                  </Field>
                  <Field label="Mensagem ao transferir para atendente" hint="Enviada enquanto o cliente aguarda um agente humano">
                    <textarea value={botConfig.transferMessage} onChange={e=>setBotConfig(c=>({...c,transferMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} />
                  </Field>
                  <Field label="Mensagem sem atendente disponível" hint="Exibida quando todos os agentes estão ocupados ou fora do horário comercial">
                    <textarea value={botConfig.noAgentMessage} onChange={e=>setBotConfig(c=>({...c,noAgentMessage:e.target.value}))} className="input" rows={2} style={{ resize:'vertical' }} />
                  </Field>
                  <Field label="Mensagem de opção inválida" hint="Exibida quando o cliente digita uma opção que não existe no menu">
                    <input value={botConfig.invalidOptionMessage} onChange={e=>setBotConfig(c=>({...c,invalidOptionMessage:e.target.value}))} className="input" />
                  </Field>
                  <Field label="Tempo limite de sessão (minutos)" hint="Inatividade máxima antes de encerrar a conversa automaticamente - entre 5 e 240 min">
                    <input type="number" min={5} max={240} value={botConfig.sessionTimeoutMinutes} onChange={e=>setBotConfig(c=>({...c,sessionTimeoutMinutes:parseInt(e.target.value)||30}))} className="input" style={{ width:90 }} />
                  </Field>
                  <Field label="Mensagem após abertura do ticket (com agente)" hint="Variáveis: {contato}, {empresa_atendente}, {agente}, {numero_ticket}">
                    <textarea
                      value={botConfig.postTicketMessage ?? ''}
                      onChange={e=>setBotConfig(c=>({...c,postTicketMessage:e.target.value||null}))}
                      className="input" rows={5} style={{ resize:'vertical' }}
                      placeholder={'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nMeu nome é {agente} e estarei à disposição para ajudar.\n\nO número do seu ticket é #{numero_ticket}.\n\nComo posso te auxiliar?'}
                    />
                  </Field>
                  <Field label="Mensagem após abertura do ticket (sem agente)" hint="Variáveis: {contato}, {empresa_atendente}, {numero_ticket}">
                    <textarea
                      value={botConfig.postTicketMessageNoAgent ?? ''}
                      onChange={e=>setBotConfig(c=>({...c,postTicketMessageNoAgent:e.target.value||null}))}
                      className="input" rows={5} style={{ resize:'vertical' }}
                      placeholder={'Olá, {contato}.\n\nBem-vindo(a) ao suporte da {empresa_atendente}.\n\nSeu atendimento foi iniciado com sucesso.\n\nO número do seu ticket é #{numero_ticket}.\n\nEm instantes um atendente dará continuidade.'}
                    />
                  </Field>
                </div>
              </div>

              {/* Avaliação */}
              <div style={{ borderTop:'1px solid #F1F5F9', paddingTop:20 }}>
                <p style={{ fontSize:13,fontWeight:700,color:'#374151',marginBottom:4 }}>Avaliação do atendimento</p>
                <p style={{ fontSize:12,color:'#94A3B8',marginBottom:14 }}>Mensagens enviadas ao cliente após o encerramento do atendimento via WhatsApp</p>
                <div className="space-y-4">
                  <Field label="Solicitação de avaliação (nota 1-5)">
                    <textarea
                      value={botConfig.ratingRequestMessage ?? ''}
                      onChange={e=>setBotConfig(c=>({...c,ratingRequestMessage:e.target.value||null}))}
                      className="input" rows={6} style={{ resize:'vertical' }}
                      placeholder={'Seu atendimento foi encerrado! Como você avalia nosso suporte?\n\n1 - ⭐ Muito ruim\n2 - ⭐⭐ Ruim\n3 - ⭐⭐⭐ Regular\n4 - ⭐⭐⭐⭐ Bom\n5 - ⭐⭐⭐⭐⭐ Excelente'}
                    />
                  </Field>
                  <Field label="Pedido de comentário opcional" hint='Palavras como "pular" encerram sem comentário'>
                    <textarea
                      value={botConfig.ratingCommentMessage ?? ''}
                      onChange={e=>setBotConfig(c=>({...c,ratingCommentMessage:e.target.value||null}))}
                      className="input" rows={3} style={{ resize:'vertical' }}
                      placeholder={'Obrigado pela nota! Gostaria de deixar um comentário? (Responda com o texto ou envie *pular* para finalizar.)'}
                    />
                  </Field>
                  <Field label="Mensagem de agradecimento final">
                    <textarea
                      value={botConfig.ratingThanksMessage ?? ''}
                      onChange={e=>setBotConfig(c=>({...c,ratingThanksMessage:e.target.value||null}))}
                      className="input" rows={2} style={{ resize:'vertical' }}
                      placeholder={'Obrigado pela avaliação! Até a próxima.'}
                    />
                  </Field>
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
                              <option value="">- Qualquer atendente -</option>
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
                  {botMenu.length === 0 && <p style={{ textAlign:'center', padding:'20px 0', color:'#CBD5E1', fontSize:13 }}>Nenhuma opção. Clique em &quot;Adicionar&quot; para criar.</p>}
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

          {/* Perfis e Permissões */}
          {tab === 'perfis' && <PerfisPage />}

          {/* Profile */}
          {tab === 'profile' && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontSize:16, fontWeight:700, color:'#0F172A', margin:0 }}>Meu perfil</h2>
                <p style={{ fontSize:13, color:'#94A3B8', marginTop:3 }}>
                  Dados pessoais exibidos no sistema e credenciais de acesso à sua conta.
                </p>
              </div>

              {/* �"?�"? Dados pessoais �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <User className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Dados pessoais</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Informações exibidas nos tickets e nas notificações internas</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ padding:'16px' }}>
                  <Field label="Nome completo" required hint="Exibido nos tickets atribuídos e nas mensagens internas">
                    <input value={profile.name} onChange={e=>setProfile(p=>({...p,name:e.target.value}))} className="input" placeholder="Ex.: João da Silva" />
                  </Field>
                  <Field label="E-mail" hint="Identificador único da conta - entre em contato com o administrador para alterar">
                    <input value={profile.email} disabled className="input" />
                  </Field>
                  <Field label="Telefone" hint="Opcional - visível para a equipe interna">
                    <input value={(profile as any).phone||''} onChange={e=>setProfile(p=>({...p,phone:e.target.value} as any))} className="input" placeholder="Ex.: (47) 99999-9999" />
                  </Field>
                </div>
              </div>

              {/* �"?�"? Segurança da conta �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div style={{ borderRadius:12, border:'1.5px solid #E2E8F0', overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:'#F8FAFC', borderBottom:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', gap:9 }}>
                  <Lock className="w-4 h-4 shrink-0" style={{ color:'#6366F1' }} />
                  <div>
                    <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>Segurança da conta</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>Deixe os campos de senha em branco para manter a senha atual</p>
                  </div>
                </div>
                <form onSubmit={(e) => e.preventDefault()} style={{ padding:'16px' }}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="Senha atual" hint="Necessária para confirmar a alteração">
                      <input type="password" value={profile.currentPassword} onChange={e=>setProfile(p=>({...p,currentPassword:e.target.value}))} className="input" placeholder="Digite sua senha atual" />
                    </Field>
                    <Field label="Nova senha" hint="Mínimo de 8 caracteres recomendado">
                      <input type="password" value={profile.newPassword} onChange={e=>setProfile(p=>({...p,newPassword:e.target.value}))} className="input" placeholder="Digite a nova senha" />
                    </Field>
                    <Field label="Confirmar nova senha" hint="Deve ser idêntica à nova senha">
                      <input type="password" value={profile.confirmPassword} onChange={e=>setProfile(p=>({...p,confirmPassword:e.target.value}))} className="input" placeholder="Confirme a nova senha" />
                    </Field>
                  </div>
                </form>
              </div>

              {profileError && <div style={{ background:'#FEE2E2', color:'#DC2626', padding:'10px 16px', borderRadius:10, fontSize:13, fontWeight:600 }}>{profileError}</div>}
              <button onClick={handleSaveProfile} disabled={saving} className="btn-primary">
                {saving?<RefreshCw className="w-4 h-4 animate-spin"/>:saved?<CheckCircle className="w-4 h-4"/>:<Save className="w-4 h-4"/>}
                {saved?'Salvo!':'Salvar perfil'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  </div>
  );
}

// �"?�"?�"? Zona de Perigo �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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
    <div style={{ border: '1.5px solid #FCA5A5', borderRadius: 10, padding: '12px 14px', background: '#FFF5F5', marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', marginBottom: 2 }}>Zona de perigo</p>
          <p style={{ fontSize: 11, color: '#991B1B', lineHeight: 1.5 }}>
            Apaga <strong>todos os tickets, conversas e sessões do chatbot</strong> do sistema. Use apenas para testes.
            Esta ação <strong>não pode ser desfeita</strong>.
          </p>
        </div>
        {!confirm && (
          <button onClick={() => setConfirm(true)}
            style={{ flexShrink: 0, padding: '6px 12px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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
              Dados apagados com sucesso!
              <span style={{ marginLeft: 8, color: '#166534' }}>
                {Object.entries(result.data).map(([k, v]: any) => `${k}: ${v}`).join(' | ')}
              </span>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: '#DC2626' }}>Erro: {result.msg}</p>
          )}
        </div>
      )}
    </div>
  );
}




