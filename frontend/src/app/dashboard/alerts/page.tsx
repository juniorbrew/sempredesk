'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { Bell, Clock, FileText, Monitor, AlertTriangle, LogIn, LogOut, Users, CheckCircle, RefreshCw, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, differenceInMinutes } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AlertConfig {
  ticketsWithoutResponse: { enabled: boolean; thresholdHours: number };
  contractsExpiring: { enabled: boolean; thresholdDays: number };
  devicesOffline: { enabled: boolean };
  slaWarning: { enabled: boolean; thresholdPercent: number };
  emailRecipients: string;
}
interface AttendanceRecord { id: string; userId: string; userName: string; userEmail: string; clockIn: string; clockOut: string | null; notes: string | null; }

const DEFAULT_CONFIG: AlertConfig = {
  ticketsWithoutResponse: { enabled: true, thresholdHours: 24 },
  contractsExpiring: { enabled: true, thresholdDays: 30 },
  devicesOffline: { enabled: true },
  slaWarning: { enabled: true, thresholdPercent: 80 },
  emailRecipients: '',
};

function workDuration(clockIn: string, clockOut: string | null): string {
  const start = new Date(clockIn);
  const end = clockOut ? new Date(clockOut) : new Date();
  const mins = differenceInMinutes(end, start);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h + 'h ' + String(m).padStart(2,'0') + 'm';
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ width:44, height:24, borderRadius:12, border:'none', cursor:'pointer', background: checked ? 'linear-gradient(135deg,#6366F1,#4F46E5)' : '#E2E8F0', position:'relative', transition:'background .2s', flexShrink:0, boxShadow: checked ? '0 2px 8px rgba(99,102,241,.35)' : 'none' }}>
      <span style={{ position:'absolute', top:3, left: checked ? 23 : 3, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 4px rgba(0,0,0,.15)' }} />
    </button>
  );
}

export default function AlertsPage() {
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clockedIn, setClockedIn] = useState(false);
  const [openRecord, setOpenRecord] = useState<AttendanceRecord | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockNotes, setClockNotes] = useState('');
  const [today, setToday] = useState<any>(null);
  const [history, setHistory] = useState<any>({ data:[], total:0, totalPages:1 });
  const [histPage, setHistPage] = useState(1);
  const [filterUser, setFilterUser] = useState('');
  const [team, setTeam] = useState<any[]>([]);
  const [tab, setTab] = useState<'alerts'|'attendance'>('alerts');
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await (api as any).getSettings();
      if (s?.alertSettings && Object.keys(s.alertSettings).length > 0) setConfig({ ...DEFAULT_CONFIG, ...s.alertSettings });
    } catch {}
  }, []);

  const loadAttendanceStatus = useCallback(async () => {
    try {
      const r = await (api as any).attendanceStatus();
      if (r?.id) { setClockedIn(true); setOpenRecord(r); } else { setClockedIn(false); setOpenRecord(null); }
    } catch { setClockedIn(false); }
  }, []);

  const loadToday = useCallback(async () => {
    try { const r = await (api as any).attendanceToday(); setToday(r); } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const r = await (api as any).getAttendance({ page: histPage, perPage: 20, userId: filterUser || undefined });
      setHistory(r || { data:[], total:0, totalPages:1 });
    } catch {}
    setLoadingHistory(false);
  }, [histPage, filterUser]);

  useEffect(() => { loadSettings(); loadAttendanceStatus(); loadToday(); api.getTeam().then((r:any) => setTeam(r||[])); }, []);
  useEffect(() => { if (tab === 'attendance') loadHistory(); }, [tab, histPage, filterUser]);

  const handleClockIn = async () => {
    setClockLoading(true);
    try { await (api as any).clockIn(); await loadAttendanceStatus(); await loadToday(); } catch {}
    setClockLoading(false);
  };

  const handleClockOut = async () => {
    setClockLoading(true);
    try { await (api as any).clockOut({ notes: clockNotes }); setClockedIn(false); setOpenRecord(null); setClockNotes(''); await loadToday(); } catch {}
    setClockLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try { await (api as any).updateSettings({ alertSettings: config }); setSaved(true); setTimeout(() => setSaved(false), 2500); } catch {}
    setSaving(false);
  };

  const updateConfig = (path: string[], value: any) => {
    setConfig(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      let cur: any = next;
      for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
      cur[path[path.length - 1]] = value;
      return next;
    });
  };

  const TABS = [
    { key: 'alerts', label: 'Configurar Alertas', icon: Bell },
    { key: 'attendance', label: 'Ponto dos Agentes', icon: Clock },
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Alertas</h1>
          <p className="page-subtitle">Configure notificações e registre o ponto da equipe</p>
        </div>
        {tab === 'alerts' && (
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
            {saved ? 'Salvo!' : 'Salvar configurações'}
          </button>
        )}
      </div>

      <div className="card p-1 flex gap-1" style={{ width:'fit-content' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)} style={{ padding:'8px 18px', borderRadius:12, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', gap:6, background: tab===key ? 'linear-gradient(135deg,#6366F1,#4F46E5)' : 'transparent', color: tab===key ? '#fff' : '#64748B', transition:'all .15s' }}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ width:40, height:40, borderRadius:12, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center' }}><AlertTriangle className="w-5 h-5" style={{ color:'#6366F1' }} /></div>
                <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Tickets sem resposta</p><p style={{ fontSize:12, color:'#94A3B8' }}>Notificar quando ticket ficar sem resposta</p></div>
              </div>
              <Toggle checked={config.ticketsWithoutResponse.enabled} onChange={v => updateConfig(['ticketsWithoutResponse','enabled'], v)} />
            </div>
            {config.ticketsWithoutResponse.enabled && (
              <div><label style={{ fontSize:12, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>Alertar após (horas sem resposta)</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="range" min={1} max={72} value={config.ticketsWithoutResponse.thresholdHours} onChange={e => updateConfig(['ticketsWithoutResponse','thresholdHours'], Number(e.target.value))} style={{ flex:1, accentColor:'#6366F1' }} />
                  <span style={{ fontSize:14, fontWeight:700, color:'#4F46E5', minWidth:40, textAlign:'right' }}>{config.ticketsWithoutResponse.thresholdHours}h</span>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ width:40, height:40, borderRadius:12, background:'#FEF9C3', display:'flex', alignItems:'center', justifyContent:'center' }}><FileText className="w-5 h-5" style={{ color:'#D97706' }} /></div>
                <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Contratos vencendo</p><p style={{ fontSize:12, color:'#94A3B8' }}>Alertar sobre contratos próximos do vencimento</p></div>
              </div>
              <Toggle checked={config.contractsExpiring.enabled} onChange={v => updateConfig(['contractsExpiring','enabled'], v)} />
            </div>
            {config.contractsExpiring.enabled && (
              <div><label style={{ fontSize:12, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>Alertar com antecedência de (dias)</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="range" min={7} max={90} value={config.contractsExpiring.thresholdDays} onChange={e => updateConfig(['contractsExpiring','thresholdDays'], Number(e.target.value))} style={{ flex:1, accentColor:'#6366F1' }} />
                  <span style={{ fontSize:14, fontWeight:700, color:'#4F46E5', minWidth:40, textAlign:'right' }}>{config.contractsExpiring.thresholdDays}d</span>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ width:40, height:40, borderRadius:12, background:'#FEE2E2', display:'flex', alignItems:'center', justifyContent:'center' }}><Monitor className="w-5 h-5" style={{ color:'#DC2626' }} /></div>
                <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Dispositivos PDV offline</p><p style={{ fontSize:12, color:'#94A3B8' }}>Notificar quando um terminal ficar offline</p></div>
              </div>
              <Toggle checked={config.devicesOffline.enabled} onChange={v => updateConfig(['devicesOffline','enabled'], v)} />
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div style={{ width:40, height:40, borderRadius:12, background:'#FFEDD5', display:'flex', alignItems:'center', justifyContent:'center' }}><Clock className="w-5 h-5" style={{ color:'#EA580C' }} /></div>
                <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>SLA em risco</p><p style={{ fontSize:12, color:'#94A3B8' }}>Alertar quando SLA atingir % do prazo</p></div>
              </div>
              <Toggle checked={config.slaWarning.enabled} onChange={v => updateConfig(['slaWarning','enabled'], v)} />
            </div>
            {config.slaWarning.enabled && (
              <div><label style={{ fontSize:12, fontWeight:600, color:'#64748B', display:'block', marginBottom:6 }}>Alertar quando atingir {config.slaWarning.thresholdPercent}% do prazo</label>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="range" min={50} max={95} value={config.slaWarning.thresholdPercent} onChange={e => updateConfig(['slaWarning','thresholdPercent'], Number(e.target.value))} style={{ flex:1, accentColor:'#6366F1' }} />
                  <span style={{ fontSize:14, fontWeight:700, color:'#4F46E5', minWidth:40, textAlign:'right' }}>{config.slaWarning.thresholdPercent}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 lg:col-span-2 space-y-3">
            <div className="flex items-center gap-3">
              <div style={{ width:40, height:40, borderRadius:12, background:'#DCFCE7', display:'flex', alignItems:'center', justifyContent:'center' }}><Bell className="w-5 h-5" style={{ color:'#16A34A' }} /></div>
              <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Destinatários dos alertas</p><p style={{ fontSize:12, color:'#94A3B8' }}>E-mails que receberão as notificações (separar por vírgula)</p></div>
            </div>
            <input value={config.emailRecipients} onChange={e => setConfig(p => ({ ...p, emailRecipients: e.target.value }))} placeholder="admin@empresa.com, suporte@empresa.com" className="input" />
            <p style={{ fontSize:11, color:'#CBD5E1' }}>💡 Configure o servidor SMTP em Configurações para que os e-mails sejam enviados.</p>
          </div>
        </div>
      )}

      {tab === 'attendance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div style={{ width:40, height:40, borderRadius:12, background: clockedIn ? '#DCFCE7' : '#F1F5F9', display:'flex', alignItems:'center', justifyContent:'center' }}><Clock className="w-5 h-5" style={{ color: clockedIn ? '#16A34A' : '#94A3B8' }} /></div>
                <div><p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Meu ponto</p><p style={{ fontSize:12, color: clockedIn ? '#16A34A' : '#94A3B8', fontWeight:600 }}>{clockedIn ? '● Trabalhando — ' + workDuration(openRecord!.clockIn, null) : '○ Fora do expediente'}</p></div>
              </div>
              {clockedIn && (<>
                <p style={{ fontSize:11, color:'#94A3B8' }}>Entrada: {format(new Date(openRecord!.clockIn), "HH:mm 'de' dd/MM", { locale:ptBR })}</p>
                <textarea value={clockNotes} onChange={e => setClockNotes(e.target.value)} placeholder="Observações (opcional)" className="input" rows={2} style={{ resize:'none', fontSize:12 }} />
                <button onClick={handleClockOut} disabled={clockLoading} className="btn-danger w-full" style={{ justifyContent:'center' }}>
                  {clockLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} Registrar saída
                </button>
              </>)}
              {!clockedIn && (
                <button onClick={handleClockIn} disabled={clockLoading} className="btn-success w-full" style={{ justifyContent:'center' }}>
                  {clockLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Registrar entrada
                </button>
              )}
            </div>

            <div className="card p-5 md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4" style={{ color:'#6366F1' }} />
                <p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Resumo de hoje</p>
                <span style={{ fontSize:11, color:'#94A3B8', marginLeft:4 }}>{format(new Date(), "dd 'de' MMMM", { locale:ptBR })}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label:'Online agora', value: today?.online||0, color:'#16A34A', bg:'#DCFCE7' },
                  { label:'Já saíram',    value: today?.offline||0, color:'#64748B', bg:'#F1F5F9' },
                  { label:'Total hoje',   value: today?.total||0,   color:'#4F46E5', bg:'#EEF2FF' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} style={{ background:bg, borderRadius:12, padding:'12px 16px', textAlign:'center' }}>
                    <p style={{ fontSize:24, fontWeight:800, color, lineHeight:1 }}>{value}</p>
                    <p style={{ fontSize:11, color:'#94A3B8', marginTop:4 }}>{label}</p>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {today?.records?.filter((r:any) => !r.clockOut).map((r:any) => (
                  <div key={r.id} style={{ display:'flex', alignItems:'center', gap:6, background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:20, padding:'4px 12px' }}>
                    <span style={{ width:7, height:7, borderRadius:'50%', background:'#10B981', flexShrink:0 }} />
                    <span style={{ fontSize:12, fontWeight:600, color:'#0F172A' }}>{r.userName||r.userEmail}</span>
                    <span style={{ fontSize:11, color:'#94A3B8' }}>{workDuration(r.clockIn, null)}</span>
                  </div>
                ))}
                {!today?.records?.filter((r:any) => !r.clockOut).length && <p style={{ fontSize:12, color:'#CBD5E1' }}>Nenhum agente online agora</p>}
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" style={{ color:'#6366F1' }} />
                <p style={{ fontWeight:700, color:'#0F172A', fontSize:14 }}>Histórico de ponto</p>
                <span style={{ fontSize:12, color:'#94A3B8' }}>({history.total} registros)</span>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <select value={filterUser} onChange={e => { setFilterUser(e.target.value); setHistPage(1); }} className="input" style={{ width:'auto', minWidth:160, fontSize:12 }}>
                  <option value="">Todos os agentes</option>
                  {team.map((u:any) => <option key={u.id} value={u.id}>{u.name||u.email}</option>)}
                </select>
                <button onClick={loadHistory} className="btn-secondary" style={{ padding:'6px 10px' }}><RefreshCw className="w-4 h-4" /></button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom:'1px solid #F1F5F9', background:'#FAFBFC' }}>
                  {['Agente','Data','Entrada','Saída','Duração','Observações'].map(h => (
                    <th key={h} className="table-header" style={{ padding:'10px 16px', textAlign:'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr><td colSpan={6} style={{ padding:48, textAlign:'center', color:'#94A3B8' }}>
                    <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />Carregando...
                  </td></tr>
                ) : history.data.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding:48, textAlign:'center', color:'#94A3B8' }}>
                    <Clock style={{ width:32, height:32, margin:'0 auto 12px', opacity:0.2 }} /><p>Nenhum registro encontrado</p>
                  </td></tr>
                ) : history.data.map((r:any) => (
                  <tr key={r.id} className="table-row" onMouseEnter={e => (e.currentTarget.style.background='#FAFBFC')} onMouseLeave={e => (e.currentTarget.style.background='transparent')}>
                    <td style={{ padding:'10px 16px' }}><p style={{ fontSize:13, fontWeight:600, color:'#0F172A' }}>{r.userName||'—'}</p><p style={{ fontSize:11, color:'#94A3B8' }}>{r.userEmail}</p></td>
                    <td style={{ padding:'10px 16px', fontSize:12, color:'#475569' }}>{format(new Date(r.clockIn), 'dd/MM/yyyy', { locale:ptBR })}</td>
                    <td style={{ padding:'10px 16px', fontSize:12, fontWeight:600, color:'#16A34A' }}>{format(new Date(r.clockIn), 'HH:mm')}</td>
                    <td style={{ padding:'10px 16px' }}>{r.clockOut ? <span style={{ fontSize:12, fontWeight:600, color:'#64748B' }}>{format(new Date(r.clockOut), 'HH:mm')}</span> : <span style={{ fontSize:11, background:'#DCFCE7', color:'#16A34A', padding:'2px 8px', borderRadius:20, fontWeight:700 }}>● Online</span>}</td>
                    <td style={{ padding:'10px 16px', fontSize:12, fontWeight:600, color:'#4F46E5' }}>{workDuration(r.clockIn, r.clockOut)}</td>
                    <td style={{ padding:'10px 16px', fontSize:12, color:'#94A3B8', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.notes||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.totalPages > 1 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid #F1F5F9' }}>
                <span style={{ fontSize:13, color:'#94A3B8' }}>Página {histPage} de {history.totalPages}</span>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={() => setHistPage(p => Math.max(1,p-1))} disabled={histPage===1} className="btn-secondary" style={{ padding:'6px 8px' }}><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setHistPage(p => Math.min(history.totalPages,p+1))} disabled={histPage===history.totalPages} className="btn-secondary" style={{ padding:'6px 8px' }}><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
