'use client';
import { FormEvent, useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import type { EventTypeConfig } from '../page';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

// Types that can be created manually (excludes external sync types)
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

  // Load custom types from localStorage, filter to manual-only keys
  useEffect(() => {
    const all = loadTypes();
    // Only show types that the backend accepts manually (no sync_google/sync_outlook)
    const manual = all.filter(t => MANUAL_TYPES_KEYS.includes(t.key) || !t.key.startsWith('sync_'));
    setEventTypes(manual.length > 0 ? manual : DEFAULT_TYPES);
  }, []);

  // Pre-fill date from ?date= query param
  useEffect(() => {
    const dateParam = params.get('date');
    if (dateParam) {
      // Format as datetime-local value: "YYYY-MM-DDT09:00"
      const startsAt = `${dateParam}T09:00`;
      const endsAt   = `${dateParam}T10:00`;
      setForm(prev => ({ ...prev, startsAt, endsAt }));
    }
  }, [params]);

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

  const toISO = (dtLocal: string) => {
    if (!dtLocal) return '';
    return new Date(dtLocal).toISOString();
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
