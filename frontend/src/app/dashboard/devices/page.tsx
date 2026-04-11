'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Monitor, Wifi, WifiOff, AlertTriangle, RefreshCw, Plus, Edit2, X, Users, MapPin, Clock, Copy, List, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TYPE_LABELS: Record<string,string> = { pdv:'PDV', server:'Servidor', printer:'Impressora', router:'Roteador', other:'Outro' };
const TYPE_ICONS: Record<string,string> = { pdv:'🖥️', server:'🗄️', printer:'🖨️', router:'📡', other:'📦' };
const EMPTY = { name:'', deviceType:'pdv', clientId:'', ipAddress:'', systemVersion:'', notes:'' };


const STATUS_CONF: Record<string,{ label:string; dot:string; bg:string; border:string; color:string }> = {
  online:  { label:'Online',       dot:'#10B981', bg:'#F0FDF4', border:'#BBF7D0', color:'#15803D' },
  offline: { label:'Offline',      dot:'#EF4444', bg:'#FEF2F2', border:'#FECACA', color:'#DC2626' },
  warning: { label:'Atenção',      dot:'#F59E0B', bg:'#FFFBEB', border:'#FDE68A', color:'#D97706' },
  unknown: { label:'Desconhecido', dot:'#94A3B8', bg:'#F8FAFC', border:'#E2E8F0', color:'#64748B' },
};

function MetricBar({ label, value, warn, danger }: { label:string; value:number; warn:number; danger:number }) {
  const color = value >= danger ? '#EF4444' : value >= warn ? '#F59E0B' : '#10B981';
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
        <span style={{ fontSize:11, color:'#94A3B8' }}>{label}</span>
        <span style={{ fontSize:11, fontWeight:700, color }}>{value}%</span>
      </div>
      <div style={{ height:5, background:'#F1F5F9', borderRadius:99 }}>
        <div style={{ height:'100%', width:`${value}%`, background:color, borderRadius:99, transition:'width 0.5s' }} />
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [customers, setCustomers] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [devs, sum, cust] = await Promise.all([api.getDevices(), api.deviceSummary(), api.getCustomers({ limit:200 })]);
      const deviceList = Array.isArray(devs) ? devs : Array.isArray((devs as any)?.data) ? (devs as any).data : [];
      setDevices(deviceList);
      setSummary((sum as any) || {});
      const customerList = Array.isArray(cust) ? cust : Array.isArray((cust as any)?.data) ? (cust as any).data : [];
      setCustomers(customerList);
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, []);

  const filtered = filter ? devices.filter((d:any) => d.status===filter) : devices;

  const openModal = (d?:any) => {
    setEditing(d||null);
    setForm(d ? { name:d.name, deviceType:d.deviceType, clientId:d.clientId||'', ipAddress:d.ipAddress||'', systemVersion:d.systemVersion||'', notes:d.notes||'' } : { ...EMPTY });
    setShowModal(true);
  };

  const openDetails = async (d:any) => {
    setSelected(d);
    setDetailsOpen(true);
    setLoadingEvents(true);
    try {
      const ev = await api.deviceEvents(d.id);
      const evList = Array.isArray(ev) ? ev : Array.isArray((ev as any)?.data) ? (ev as any).data : [];
      setEvents(evList);
    } catch (e) {
      console.error(e);
      setEvents([]);
    }
    setLoadingEvents(false);
  };

  const copy = async (text:string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const data = { ...form, clientId:form.clientId||undefined };
      if (editing) {
        const updated = (await api.updateDevice(editing.id, data)) as Record<string, unknown>;
        setDevices((prev) => prev.map((d) => (d.id === editing.id ? { ...d, ...updated } : d)));
      } else {
        const created = await api.createDevice(data);
        const full = Array.isArray(created) ? created[0] : (created as { id?: string } | null);
        if (full?.id) setDevices((prev) => [full, ...prev]);
      }
      setShowModal(false);
      api.deviceSummary().then((s: any) => setSummary(s)).catch(() => {});
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro ao salvar'); }
    setSaving(false);
  };

  const f = (k:string) => (e:any) => setForm((p:any)=>({...p,[k]:e.target.value}));
  const customerName = (cid:string) => { const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):null; };

  const STAT_CARDS = [
    { label:'Total',        value:summary.total,   icon:Monitor,        gradient:'stat-indigo', status:'' },
    { label:'Online',       value:summary.online,  icon:Wifi,           gradient:'stat-green',  status:'online' },
    { label:'Offline',      value:summary.offline, icon:WifiOff,        gradient:'stat-red',    status:'offline' },
    { label:'Atenção',      value:summary.warning, icon:AlertTriangle,  gradient:'stat-orange', status:'warning' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#14B8A6,#0D9488)', boxShadow:'0 4px 14px rgba(20,184,166,0.35)' }}>
            <Monitor className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Monitoramento PDV</h1>
            <p className="page-subtitle">Atualiza a cada 30 segundos · {devices.length} dispositivo{devices.length!==1?'s':''}</p>
          </div>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={load} className="btn-secondary" style={{ padding:'9px 11px' }}>
            <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} />
          </button>
          <button onClick={() => openModal()} className="btn-primary">
            <Plus className="w-4 h-4" /> Cadastrar Dispositivo
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ label, value, icon:Icon, gradient, status }) => (
          <button key={label} onClick={() => setFilter(filter===status?'':status)}
            className="card p-4 flex items-center gap-3 text-left transition-all"
            style={{ cursor:'pointer', outline:'none', border:filter===status?'2px solid #6366F1':'1px solid #E2E8F0', boxShadow:filter===status?'0 0 0 3px rgba(99,102,241,0.1)':'var(--card-shadow)' }}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${gradient}`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-2xl font-extrabold" style={{ color:'#0F172A', lineHeight:1 }}>{value??0}</p>
              <p className="text-xs mt-0.5" style={{ color:'#94A3B8' }}>{label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading && devices.length===0 ? (
        <div className="text-center py-16" style={{ color:'#94A3B8' }}>
          <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Carregando dispositivos...
        </div>
      ) : filtered.length===0 ? (
        <div className="card p-16 text-center">
          <Monitor className="w-12 h-12 mx-auto mb-3" style={{ color:'#E2E8F0' }} />
          <p className="font-medium mb-1" style={{ color:'#475569' }}>Nenhum dispositivo encontrado</p>
          <button onClick={() => openModal()} className="btn-primary mt-4"><Plus className="w-4 h-4" /> Cadastrar</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((d:any) => {
            const conf = STATUS_CONF[d.status]||STATUS_CONF.unknown;
            const metrics = d.lastMetrics;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => openDetails(d)}
                className="card p-4 text-left hover:shadow-md transition-shadow"
                style={{ border:`1.5px solid ${conf.border}`, background:conf.bg, cursor:'pointer' }}
              >
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
                      {TYPE_ICONS[d.deviceType]||'📦'}
                    </div>
                    <div>
                      <p style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:0 }}>{d.name}</p>
                      <p style={{ fontSize:11, color:'#94A3B8', margin:0 }}>{TYPE_LABELS[d.deviceType]||d.deviceType}</p>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:conf.dot, boxShadow:`0 0 6px ${conf.dot}` }} />
                    <span style={{ fontSize:11, fontWeight:700, color:conf.color }}>{conf.label}</span>
                  </div>
                </div>

                <div style={{ fontSize:11, color:'#64748B', marginBottom:10, display:'flex', flexDirection:'column', gap:4 }}>
                  {d.ipAddress && <div style={{ display:'flex', alignItems:'center', gap:5 }}><MapPin style={{width:11,height:11,color:'#CBD5E1'}} />{d.ipAddress}</div>}
                  {customerName(d.clientId) && <div style={{ display:'flex', alignItems:'center', gap:5 }}><Users style={{width:11,height:11,color:'#CBD5E1'}} />{customerName(d.clientId)}</div>}
                  <div style={{ color:'#94A3B8' }}>
                    {d.lastHeartbeat ? formatDistanceToNow(new Date(d.lastHeartbeat),{locale:ptBR,addSuffix:true}) : 'Nunca conectou'}
                  </div>
                </div>

                {metrics && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:12 }}>
                    {metrics.cpu!==undefined && <MetricBar label="CPU" value={metrics.cpu} warn={70} danger={90} />}
                    {metrics.memory!==undefined && <MetricBar label="RAM" value={metrics.memory} warn={80} danger={95} />}
                    {metrics.disk!==undefined && <div style={{ fontSize:11, color:'#94A3B8' }}>Disco livre: {metrics.disk} GB</div>}
                  </div>
                )}

                <button onClick={() => openModal(d)} className="btn-secondary" style={{ width:'100%', justifyContent:'center', fontSize:12, padding:'7px 0' }}>
                  <Edit2 className="w-3.5 h-3.5" /> Editar
                </button>
              </button>
            );
          })}
        </div>
      )}

      {/* Details modal */}
      {detailsOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)' }}>
          <div className="card animate-fade-up" style={{ width:'100%', maxWidth:672, borderRadius:16, padding:0 }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom:'1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#14B8A6,#0D9488)' }}>
                  <Monitor className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold" style={{ color:'#0F172A', fontSize:15, margin:0 }}>{selected.name}</h2>
                  <p className="text-xs" style={{ color:'#94A3B8', margin:0 }}>{TYPE_LABELS[selected.deviceType] || selected.deviceType} · {customerName(selected.clientId) || 'Sem cliente'}</p>
                </div>
              </div>
              <button onClick={()=>{ setDetailsOpen(false); setSelected(null); }} style={{ background:'#F1F5F9', border:'none', borderRadius:8, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>

            <div style={{ padding:20, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div className="card p-4" style={{ background:'#FAFBFC' }}>
                <p style={{ fontSize:10, fontWeight:800, color:'#94A3B8', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }}>Conexão</p>
                <div style={{ display:'flex', flexDirection:'column', gap:8, fontSize:12, color:'#475569' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}><MapPin style={{width:14,height:14,color:'#CBD5E1'}} /> {selected.ipAddress || 'IP não informado'}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}><Clock style={{width:14,height:14,color:'#CBD5E1'}} /> {selected.lastHeartbeat ? formatDistanceToNow(new Date(selected.lastHeartbeat),{locale:ptBR,addSuffix:true}) : 'Nunca conectou'}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}><AlertTriangle style={{width:14,height:14,color:'#CBD5E1'}} /> Status: <span style={{ fontWeight:800 }}>{STATUS_CONF[selected.status]?.label || selected.status}</span></div>
                </div>
              </div>

              <div className="card p-4" style={{ background:'#FAFBFC' }}>
                <p style={{ fontSize:10, fontWeight:800, color:'#94A3B8', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10 }}>Agente</p>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                    <span style={{ fontSize:12, color:'#475569' }}>Token do heartbeat</span>
                    {selected.heartbeatToken ? (
                      <button onClick={() => copy(selected.heartbeatToken)} className="btn-secondary" style={{ padding:'6px 10px', fontSize:12 }}>
                        <Copy className="w-3.5 h-3.5" /> Copiar
                      </button>
                    ) : (
                      <span style={{ fontSize:12, color:'#94A3B8' }}>—</span>
                    )}
                  </div>
                  <div style={{ fontFamily:'monospace', fontSize:12, background:'#fff', border:'1px solid #E2E8F0', borderRadius:10, padding:'10px 12px', color:'#0F172A', wordBreak:'break-all' }}>
                    {selected.heartbeatToken || 'Token não disponível (reabra este modal após recarregar)'}
                  </div>
                  <p style={{ fontSize:11, color:'#94A3B8', margin:0 }}>
                    O agente deve enviar `POST /api/v1/devices/{'{device_id}'}/heartbeat` com header `x-device-token`.
                  </p>
                </div>
              </div>

              <div className="card p-4" style={{ gridColumn:'1 / -1', background:'#FAFBFC' }}>
                <p style={{ fontSize:10, fontWeight:800, color:'#94A3B8', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
                  <List style={{ width:14, height:14 }} /> Eventos recentes
                </p>
                {loadingEvents ? (
                  <div style={{ padding:'20px 0', textAlign:'center', color:'#94A3B8' }}>
                    <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Carregando eventos...
                  </div>
                ) : events.length === 0 ? (
                  <div style={{ padding:'10px 0', color:'#94A3B8', fontSize:12 }}>Nenhum evento registrado.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {events.slice(0, 12).map((ev:any) => (
                      <div key={ev.id} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:12, padding:'10px 12px', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:'#0F172A' }}>{ev.eventType}</div>
                          <div style={{ fontSize:12, color:'#475569', marginTop:2 }}>{ev.message}</div>
                          {ev.ticketId && (
                            <button
                              type="button"
                              onClick={() => window.open(`/dashboard/tickets/${ev.ticketId}`, '_blank')}
                              className="btn-secondary"
                              style={{ marginTop:8, padding:'6px 10px', fontSize:12 }}
                            >
                              <ExternalLink className="w-3.5 h-3.5" /> Abrir ticket
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize:11, color:'#94A3B8', whiteSpace:'nowrap' }}>
                          {ev.createdAt ? formatDistanceToNow(new Date(ev.createdAt), { locale:ptBR, addSuffix:true }) : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'14px 20px', borderTop:'1px solid #F1F5F9' }}>
              <button onClick={() => { setDetailsOpen(false); setSelected(null); }} className="btn-secondary">Fechar</button>
              <button onClick={() => { setDetailsOpen(false); setSelected(null); openModal(selected); }} className="btn-primary">
                <Edit2 className="w-4 h-4" /> Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(15,23,42,0.55)', backdropFilter:'blur(4px)' }}>
          <div className="card animate-fade-up" style={{ width:'100%', maxWidth:448, borderRadius:16, padding:0 }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom:'1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#14B8A6,#0D9488)' }}>
                  <Monitor className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold" style={{ color:'#0F172A', fontSize:15 }}>{editing?'Editar Dispositivo':'Novo Dispositivo'}</h2>
                  <p className="text-xs" style={{ color:'#94A3B8' }}>Preencha os dados do dispositivo</p>
                </div>
              </div>
              <button onClick={()=>setShowModal(false)} style={{ background:'#F1F5F9', border:'none', borderRadius:8, width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B', fontSize:18 }}>×</button>
            </div>
            <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label className="label">Nome <span style={{color:'#6366F1'}}>*</span></label>
                <input value={form.name} onChange={f('name')} placeholder="Ex: PDV Caixa 1" className="input" />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label className="label">Tipo</label>
                  <select value={form.deviceType} onChange={f('deviceType')} className="input" style={{ appearance:'none' as const }}>
                    {Object.entries(TYPE_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">IP</label>
                  <input value={form.ipAddress} onChange={f('ipAddress')} placeholder="192.168.1.100" className="input" />
                </div>
              </div>
              <div>
                <label className="label">Cliente</label>
                <select value={form.clientId} onChange={f('clientId')} className="input" style={{ appearance:'none' as const }}>
                  <option value="">Nenhum</option>
                  {customers.map((c:any)=><option key={c.id} value={c.id}>{c.tradeName||c.companyName}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Versão do sistema</label>
                <input value={form.systemVersion} onChange={f('systemVersion')} placeholder="Ex: 3.5.2" className="input" />
              </div>
              <div>
                <label className="label">Observações</label>
                <textarea value={form.notes} onChange={f('notes')} rows={2} className="input" style={{ resize:'vertical' as const }} />
              </div>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'14px 20px', borderTop:'1px solid #F1F5F9' }}>
              <button onClick={()=>setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={handleSave} disabled={saving||!form.name.trim()} className="btn-primary" style={{ minWidth:110, justifyContent:'center', opacity:!form.name.trim()?0.5:1 }}>
                {saving?'Salvando...':'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
