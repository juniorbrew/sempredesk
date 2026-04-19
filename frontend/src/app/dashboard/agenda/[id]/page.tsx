'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CalendarDays, MapPin, FileText, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const STATUS_LABELS: Record<string,string> = { scheduled:'Agendado', confirmed:'Confirmado', cancelled:'Cancelado', completed:'Concluído', rescheduled:'Reagendado' };
const STATUS_STYLE: Record<string,{bg:string;color:string;dot:string}> = {
  scheduled:   { bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5' },
  confirmed:   { bg:'#F0FDF4', color:'#166534', dot:'#16A34A' },
  cancelled:   { bg:'#FEF2F2', color:'#991B1B', dot:'#EF4444' },
  completed:   { bg:'#F0F9FF', color:'#0369A1', dot:'#0284C7' },
  rescheduled: { bg:'#FFF7ED', color:'#9A3412', dot:'#F97316' },
};
const EVENT_TYPE_LABELS: Record<string,string> = { internal:'Interno', client_return:'Retorno', sla_reminder:'Lembrete SLA', meeting:'Reunião', sync_google:'Google', sync_outlook:'Outlook' };

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:8, padding:'10px 0', borderBottom:'1px solid #F1F5F9' }}>
      <span style={{ fontSize:12, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.06em', paddingTop:1 }}>{label}</span>
      <span style={{ fontSize:14, color:'#0F172A' }}>{value || '—'}</span>
    </div>
  );
}

export default function EventoDetailPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusField, setFocusField] = useState('');
  const [editForm, setEditForm] = useState({ title:'', startsAt:'', endsAt:'', description:'', location:'' });

  // Converte ISO UTC para string local no formato datetime-local (YYYY-MM-DDTHH:mm)
  const toLocalInput = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };

  // Converte datetime-local (sem fuso) para ISO com fuso do browser
  const toISO = (dtLocal: string) => dtLocal ? new Date(dtLocal).toISOString() : '';

  const load = async () => {
    setLoading(true);
    try {
      const raw: any = await api.getCalendarEvent(id);
      setEvent(raw);
      setEditForm({
        title: raw?.title || '',
        startsAt: raw?.startsAt ? toLocalInput(raw.startsAt) : '',
        endsAt:   raw?.endsAt   ? toLocalInput(raw.endsAt)   : '',
        description: raw?.description || '',
        location: raw?.location || '',
      });
    } catch { toast.error('Erro ao carregar evento'); }
    setLoading(false);
  };

  useEffect(() => { if (id) load(); }, [id]);

  if (!hasPermission(user, 'agenda.view')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para visualizar eventos.
        </div>
      </div>
    );
  }

  const handleConfirm = async () => {
    setActing(true);
    try {
      await api.updateCalendarEvent(id, { status: 'confirmed' });
      toast.success('Evento confirmado!');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao confirmar'); }
    setActing(false);
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancelar este evento?')) return;
    setActing(true);
    try {
      await api.cancelCalendarEvent(id);
      toast.success('Evento cancelado');
      router.push('/dashboard/agenda');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao cancelar'); }
    setActing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm('Excluir permanentemente este evento?')) return;
    setActing(true);
    try {
      await api.deleteCalendarEvent(id);
      toast.success('Evento excluído');
      router.push('/dashboard/agenda');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao excluir'); }
    setActing(false);
  };

  const handleSaveEdit = async () => {
    setActing(true);
    try {
      await api.updateCalendarEvent(id, {
        title: editForm.title,
        startsAt: editForm.startsAt ? toISO(editForm.startsAt) : undefined,
        endsAt:   editForm.endsAt   ? toISO(editForm.endsAt)   : undefined,
        description: editForm.description || undefined,
        location: editForm.location || undefined,
      });
      toast.success('Evento atualizado!');
      setEditing(false);
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao salvar'); }
    setActing(false);
  };

  const st = event ? (STATUS_STYLE[event.status] || { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8' }) : null;

  const formatDate = (d: string) => {
    try { return format(new Date(d), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return d; }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/agenda" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:36, height:36, borderRadius:10, background:'#F1F5F9', color:'#64748B', textDecoration:'none' }}>
            <ArrowLeft style={{ width:16, height:16 }} />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow:'0 4px 14px rgba(59,130,246,0.3)' }}>
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{loading ? 'Carregando...' : (event?.title || 'Evento')}</h1>
              {event && st && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:st.bg, color:st.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:st.dot }} />
                  {STATUS_LABELS[event.status] || event.status}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Carregando...</div>
      )}

      {!loading && event && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:20 }}>
          {/* Detalhes */}
          <div className="space-y-5">
            <div className="card p-5">
              <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', marginBottom:16, margin:'0 0 16px 0' }}>Detalhes do Evento</h2>
              <DetailRow label="Título" value={event.title} />
              <DetailRow label="Tipo" value={EVENT_TYPE_LABELS[event.eventType] || event.eventType} />
              <DetailRow label="Início" value={event.startsAt ? formatDate(event.startsAt) : '—'} />
              <DetailRow label="Fim" value={event.endsAt ? formatDate(event.endsAt) : '—'} />
              <DetailRow label="Dia inteiro" value={event.allDay ? 'Sim' : 'Não'} />
              <DetailRow label="Status" value={STATUS_LABELS[event.status] || event.status} />
              {event.location && <DetailRow label="Local" value={<span style={{ display:'inline-flex', alignItems:'center', gap:5 }}><MapPin style={{ width:13, height:13, color:'#64748B' }} />{event.location}</span>} />}
              {event.description && <DetailRow label="Descrição" value={<span style={{ whiteSpace:'pre-wrap' }}>{event.description}</span>} />}
              {event.notes && <DetailRow label="Notas" value={<span style={{ whiteSpace:'pre-wrap' }}>{event.notes}</span>} />}
              {event.assignedUser && <DetailRow label="Atribuído" value={event.assignedUser.name} />}
            </div>

            {/* Edição inline */}
            {hasPermission(user, 'agenda.edit') && editing && (
              <div className="card p-5">
                <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', marginBottom:16, margin:'0 0 16px 0' }}>Editar Evento</h2>
                <div style={{ display:'grid', gap:14 }}>
                  <div>
                    <label style={lbl}>Título</label>
                    <input style={inp(focusField==='et')} value={editForm.title} onFocus={() => setFocusField('et')} onBlur={() => setFocusField('')} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} />
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                    <div>
                      <label style={lbl}>Data início</label>
                      <input type="datetime-local" style={inp(focusField==='es')} value={editForm.startsAt} onFocus={() => setFocusField('es')} onBlur={() => setFocusField('')} onChange={e => setEditForm(p => ({ ...p, startsAt: e.target.value }))} />
                    </div>
                    <div>
                      <label style={lbl}>Data fim</label>
                      <input type="datetime-local" style={inp(focusField==='ee')} value={editForm.endsAt} onFocus={() => setFocusField('ee')} onBlur={() => setFocusField('')} onChange={e => setEditForm(p => ({ ...p, endsAt: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Descrição</label>
                    <textarea rows={3} style={{ ...inp(focusField==='ed'), resize:'vertical' as const }} value={editForm.description} onFocus={() => setFocusField('ed')} onBlur={() => setFocusField('')} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div>
                    <label style={lbl}>Local</label>
                    <input style={inp(focusField==='el')} value={editForm.location} onFocus={() => setFocusField('el')} onBlur={() => setFocusField('')} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} />
                  </div>
                  <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                    <button className="btn-secondary" onClick={() => setEditing(false)}>Cancelar</button>
                    <button className="btn-primary" disabled={acting} onClick={handleSaveEdit}>{acting ? 'Salvando...' : 'Salvar alterações'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Ações */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div className="card p-4">
              <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', marginBottom:14, margin:'0 0 14px 0' }}>Ações</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {hasPermission(user, 'agenda.edit') && !editing && (
                  <button className="btn-secondary" style={{ width:'100%', justifyContent:'center' }} onClick={() => setEditing(true)}>
                    Editar evento
                  </button>
                )}
                {hasPermission(user, 'agenda.edit') && event.status !== 'confirmed' && event.status !== 'cancelled' && (
                  <button className="btn-primary" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleConfirm}>
                    Confirmar
                  </button>
                )}
                {hasPermission(user, 'agenda.edit') && event.status !== 'cancelled' && (
                  <button className="btn-secondary" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleCancel}>
                    Cancelar evento
                  </button>
                )}
                {hasPermission(user, 'agenda.delete') && (
                  <button className="btn-danger" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleDelete}>
                    Excluir
                  </button>
                )}
              </div>
            </div>

            {/* Meta info */}
            <div className="card p-4">
              <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', marginBottom:12, margin:'0 0 12px 0' }}>Informações</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {event.createdAt && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#64748B' }}>
                    <Clock style={{ width:12, height:12 }} />
                    Criado em {format(new Date(event.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </div>
                )}
                {event.origin && (
                  <div style={{ fontSize:12, color:'#94A3B8' }}>Origem: {event.origin}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
