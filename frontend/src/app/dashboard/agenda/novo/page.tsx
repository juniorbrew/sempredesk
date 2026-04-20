'use client';
import { FormEvent, useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarDays, Building2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import type { EventTypeConfig } from '../page';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const MANUAL_TYPES_KEYS = ['internal','client_return','sla_reminder','meeting'];

const DEFAULT_TYPES: EventTypeConfig[] = [
  { key:'meeting',       label:'Reunião',      color:'#3B82F6' },
  { key:'internal',      label:'Interno',      color:'#8B5CF6' },
  { key:'client_return', label:'Retorno',       color:'#10B981' },
  { key:'sla_reminder',  label:'Lembrete SLA', color:'#F59E0B' },
];

function loadTypes(): EventTypeConfig[] {
  try {
    const s = localStorage.getItem('agenda_event_types');
    if (s) return JSON.parse(s);
  } catch {}
  return DEFAULT_TYPES;
}

interface StaffUser { id: string; name: string; email: string; avatar?: string }
interface ClientOption { id: string; companyName: string; tradeName?: string | null; cnpj?: string | null }

function NovoEventoForm() {
  const { user } = useAuthStore();
  const router   = useRouter();
  const params   = useSearchParams();

  const [eventTypes, setEventTypes] = useState<EventTypeConfig[]>(DEFAULT_TYPES);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [focusField, setFocusField] = useState('');
  const [form,       setForm]       = useState({
    title: '', eventType: 'internal', startsAt: '', endsAt: '',
    reminderAt: '', allDay: false, description: '', location: '', status: 'scheduled',
  });

  // Cliente vinculado
  const [clientSearch,   setClientSearch]   = useState('');
  const [clientResults,  setClientResults]  = useState<ClientOption[]>([]);
  const [clientSearching,setClientSearching]= useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
  const [showClientDrop, setShowClientDrop] = useState(false);
  const clientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Usuários vinculados
  const [staffUsers,    setStaffUsers]    = useState<StaffUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  useEffect(() => {
    const all = loadTypes();
    const manual = all.filter(t => MANUAL_TYPES_KEYS.includes(t.key) || !t.key.startsWith('sync_'));
    setEventTypes(manual.length > 0 ? manual : DEFAULT_TYPES);
    api.getStaffUsers().then((data: any) => {
      const list = Array.isArray(data) ? data : (data?.data ?? []);
      setStaffUsers(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const dateParam = params.get('date');
    if (dateParam) {
      setForm(prev => ({ ...prev, startsAt: `${dateParam}T09:00`, endsAt: `${dateParam}T10:00` }));
    }
  }, [params]);

  // Busca de clientes com debounce
  useEffect(() => {
    if (clientTimer.current) clearTimeout(clientTimer.current);
    if (!clientSearch.trim() || clientSearch.length < 2) { setClientResults([]); return; }
    clientTimer.current = setTimeout(async () => {
      setClientSearching(true);
      try {
        const data: any = await api.searchCustomers(clientSearch);
        const list = Array.isArray(data) ? data : (data?.data ?? []);
        setClientResults(list.slice(0, 8));
        setShowClientDrop(true);
      } catch {}
      setClientSearching(false);
    }, 300);
  }, [clientSearch]);

  if (!hasPermission(user, 'agenda.create')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para criar eventos.
        </div>
      </div>
    );
  }

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));
  const toISO = (dtLocal: string) => dtLocal ? new Date(dtLocal).toISOString() : '';

  const toggleUser = (uid: string) => {
    setSelectedUserIds(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('O título é obrigatório.'); return; }
    if (!form.startsAt)     { setError('A data de início é obrigatória.'); return; }
    setError('');
    setSaving(true);
    try {
      await api.createCalendarEvent({
        title:       form.title,
        eventType:   form.eventType || 'internal',
        startsAt:    toISO(form.startsAt),
        endsAt:      toISO(form.endsAt || form.startsAt),
        reminderAt:  form.reminderAt ? toISO(form.reminderAt) : undefined,
        allDay:      form.allDay,
        description: form.description || undefined,
        location:    form.location    || undefined,
        status:      form.status      || 'scheduled',
        origin:      'manual',
        clientId:    selectedClient?.id ?? undefined,
        userIds:     selectedUserIds.length ? selectedUserIds : undefined,
      });
      toast.success('Evento criado com sucesso!');
      router.push('/dashboard/agenda');
    } catch (err: any) {
      const raw = err?.response?.data?.message;
      const msg = Array.isArray(raw) ? raw.join(' · ') : (raw || 'Erro ao criar evento');
      setError(msg);
      toast.error(msg);
    }
    setSaving(false);
  };

  const selectedType = eventTypes.find(t => t.key === form.eventType);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/agenda" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:36, height:36, borderRadius:10, background:'#F1F5F9', color:'#64748B', textDecoration:'none' }}>
          <ArrowLeft style={{ width:16, height:16 }}/>
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow:'0 4px 14px rgba(59,130,246,0.3)' }}>
            <CalendarDays className="w-5 h-5 text-white"/>
          </div>
          <div>
            <h1 className="page-title">Novo Evento</h1>
            <p className="page-subtitle">Preencha as informações do evento</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card p-5">
          <div style={{ display:'grid', gap:18 }}>

            {/* Título */}
            <div>
              <label style={lbl}>Título *</label>
              <input
                style={inp(focusField==='title')}
                value={form.title}
                required
                placeholder="Ex: Reunião de alinhamento, Retorno ao cliente..."
                onFocus={() => setFocusField('title')}
                onBlur={() => setFocusField('')}
                onChange={e => set('title', e.target.value)}
              />
            </div>

            {/* Tipo + Status */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div>
                <label style={lbl}>Tipo</label>
                <div style={{ position:'relative' }}>
                  {selectedType && (
                    <div style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', width:10, height:10, borderRadius:3, background: selectedType.color, pointerEvents:'none' }} />
                  )}
                  <select
                    style={{ ...inp(), paddingLeft: selectedType ? 28 : 12 }}
                    value={form.eventType}
                    onChange={e => set('eventType', e.target.value)}
                  >
                    {eventTypes.map(t => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label style={lbl}>Status</label>
                <select style={inp()} value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="scheduled">Agendado</option>
                  <option value="confirmed">Confirmado</option>
                </select>
              </div>
            </div>

            {/* Datas */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div>
                <label style={lbl}>Data início *</label>
                <input
                  type="datetime-local"
                  style={inp(focusField==='startsAt')}
                  value={form.startsAt}
                  required
                  onFocus={() => setFocusField('startsAt')}
                  onBlur={() => setFocusField('')}
                  onChange={e => set('startsAt', e.target.value)}
                />
              </div>
              <div>
                <label style={lbl}>Data fim</label>
                <input
                  type="datetime-local"
                  style={inp(focusField==='endsAt')}
                  value={form.endsAt}
                  onFocus={() => setFocusField('endsAt')}
                  onBlur={() => setFocusField('')}
                  onChange={e => set('endsAt', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label style={lbl}>Lembrete interno</label>
              <input
                type="datetime-local"
                style={inp(focusField==='reminderAt')}
                value={form.reminderAt}
                onFocus={() => setFocusField('reminderAt')}
                onBlur={() => setFocusField('')}
                onChange={e => set('reminderAt', e.target.value)}
              />
            </div>

            {/* Dia inteiro */}
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <input type="checkbox" id="allDay" checked={form.allDay} onChange={e => set('allDay', e.target.checked)} style={{ width:16, height:16, cursor:'pointer' }}/>
              <label htmlFor="allDay" style={{ fontSize:14, color:'#0F172A', cursor:'pointer' }}>Dia inteiro</label>
            </div>

            {/* Descrição */}
            <div>
              <label style={lbl}>Descrição</label>
              <textarea
                rows={3}
                style={{ ...inp(focusField==='desc'), resize:'vertical' as const }}
                value={form.description}
                placeholder="Descrição do evento (opcional)"
                onFocus={() => setFocusField('desc')}
                onBlur={() => setFocusField('')}
                onChange={e => set('description', e.target.value)}
              />
            </div>

            {/* Local */}
            <div>
              <label style={lbl}>Local</label>
              <input
                style={inp(focusField==='location')}
                value={form.location}
                placeholder="Ex: Sala de reunião, Google Meet..."
                onFocus={() => setFocusField('location')}
                onBlur={() => setFocusField('')}
                onChange={e => set('location', e.target.value)}
              />
            </div>

            {/* ── Cliente vinculado ─────────────────────────────────────── */}
            <div>
              <label style={lbl}>Cliente (opcional)</label>
              {selectedClient ? (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#EEF2FF', border:'1.5px solid #C7D2FE', borderRadius:10 }}>
                  <Building2 style={{ width:14, height:14, color:'#4F46E5', flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:14, color:'#1E1B4B', fontWeight:500 }}>{selectedClient.companyName}{selectedClient.tradeName ? ` · ${selectedClient.tradeName}` : ''}</span>
                  <button type="button" onClick={() => { setSelectedClient(null); setClientSearch(''); }} style={{ background:'none', border:'none', cursor:'pointer', padding:2, color:'#6366F1', display:'flex' }}>
                    <X style={{ width:14, height:14 }} />
                  </button>
                </div>
              ) : (
                <div style={{ position:'relative' }}>
                  <input
                    style={inp(focusField==='clientSearch')}
                    value={clientSearch}
                    placeholder="Buscar cliente por nome ou CNPJ..."
                    onFocus={() => setFocusField('clientSearch')}
                    onBlur={() => { setFocusField(''); setTimeout(() => setShowClientDrop(false), 200); }}
                    onChange={e => { setClientSearch(e.target.value); setShowClientDrop(true); }}
                  />
                  {clientSearching && (
                    <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', fontSize:11, color:'#94A3B8' }}>buscando…</div>
                  )}
                  {showClientDrop && clientResults.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:20, background:'#fff', border:'1px solid #E2E8F0', borderRadius:10, boxShadow:'0 4px 16px rgba(0,0,0,0.08)', marginTop:4, maxHeight:220, overflowY:'auto' }}>
                      {clientResults.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => { setSelectedClient(c); setClientSearch(''); setShowClientDrop(false); }}
                          style={{ width:'100%', textAlign:'left', padding:'9px 14px', background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', gap:2, borderBottom:'1px solid #F1F5F9' }}
                        >
                          <span style={{ fontSize:13, fontWeight:600, color:'#0F172A' }}>{c.companyName}</span>
                          {(c.tradeName || c.cnpj) && (
                            <span style={{ fontSize:11, color:'#94A3B8' }}>{[c.tradeName, c.cnpj].filter(Boolean).join(' · ')}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Usuários vinculados ───────────────────────────────────── */}
            {staffUsers.length > 0 && (
              <div>
                <label style={lbl}>Usuários vinculados (opcional)</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8, padding:'10px 12px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:10, minHeight:44 }}>
                  {staffUsers.map(u => {
                    const selected = selectedUserIds.includes(u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUser(u.id)}
                        style={{
                          padding:'4px 10px', borderRadius:20, fontSize:12, fontWeight:500, cursor:'pointer',
                          border: selected ? '1.5px solid #6366F1' : '1.5px solid #E2E8F0',
                          background: selected ? '#EEF2FF' : '#fff',
                          color: selected ? '#4F46E5' : '#64748B',
                          transition:'all 0.12s',
                        }}
                      >
                        {u.name}
                      </button>
                    );
                  })}
                </div>
                {selectedUserIds.length > 0 && (
                  <div style={{ fontSize:11, color:'#6366F1', marginTop:4 }}>
                    {selectedUserIds.length} usuário{selectedUserIds.length > 1 ? 's' : ''} selecionado{selectedUserIds.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )}

            {error && (
              <div style={{ padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, color:'#991B1B', fontSize:13 }}>
                {error}
              </div>
            )}

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <Link href="/dashboard/agenda" className="btn-secondary" style={{ textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
                Cancelar
              </Link>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Criar Evento'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function NovoEventoPage() {
  return (
    <Suspense fallback={<div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Carregando...</div>}>
      <NovoEventoForm />
    </Suspense>
  );
}
