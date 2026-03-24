'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Plus, Search, ChevronLeft, ChevronRight, AlertTriangle, Ticket, Clock, CheckCircle, XCircle, RotateCw, LayoutList, Columns, CheckCircle2, X, Download, ChevronsUpDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_LABELS: Record<string,string> = { open:'Aberto', in_progress:'Em andamento', waiting_client:'Aguardando', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado' };
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };

const STATUS_STYLE: Record<string,{ bg:string; color:string; dot:string; header:string; headerText:string }> = {
  open:           { bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5', header:'#4F46E5', headerText:'#fff' },
  in_progress:    { bg:'#FEF3C7', color:'#92400E', dot:'#D97706', header:'#D97706', headerText:'#fff' },
  waiting_client: { bg:'#F0F9FF', color:'#0369A1', dot:'#0284C7', header:'#0284C7', headerText:'#fff' },
  resolved:       { bg:'#F0FDF4', color:'#166534', dot:'#16A34A', header:'#16A34A', headerText:'#fff' },
  closed:         { bg:'#F9FAFB', color:'#374151', dot:'#374151', header:'#64748B', headerText:'#fff' },
  cancelled:      { bg:'#FEF2F2', color:'#991B1B', dot:'#EF4444', header:'#DC2626', headerText:'#fff' },
};

const PRIORITY_STYLE: Record<string,{ bg:string; color:string }> = {
  low:      { bg:'#F0FDF4', color:'#166534' },
  medium:   { bg:'#FEF3C7', color:'#92400E' },
  high:     { bg:'#FFF7ED', color:'#C2410C' },
  critical: { bg:'#FDF2F8', color:'#86198F' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] || { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8', header:'#64748B', headerText:'#fff' };
  return (
    <span style={{ background:s.bg, color:s.color, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:s.dot, flexShrink:0 }} />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = PRIORITY_STYLE[priority] || { bg:'#F1F5F9', color:'#64748B' };
  return (
    <span style={{ background:p.bg, color:p.color, padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, whiteSpace:'nowrap' }}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

function SlaIndicator({ ticket }: { ticket: any }) {
  if (!ticket.slaResolveAt || ['resolved','closed','cancelled'].includes(ticket.status)) return null;
  const diff = new Date(ticket.slaResolveAt).getTime() - Date.now();
  if (diff < 0) return <span style={{ fontSize:10, color:'#DC2626', fontWeight:700 }}>SLA VIOLADO</span>;
  const hours = Math.floor(diff/3600000);
  const mins = Math.floor((diff%3600000)/60000);
  const urgent = diff < 4*3600000;
  return <span style={{ fontSize:10, fontWeight:600, color:urgent?'#F97316':'#94A3B8' }}>{hours>0?`${hours}h ${mins}m`:`${mins}m`}</span>;
}

const KANBAN_COLS = ['open','in_progress','waiting_client','resolved','closed','cancelled'];

const TIME_OPTIONS = [
  { v:'15', l:'15 minutos' }, { v:'30', l:'30 minutos' }, { v:'45', l:'45 minutos' },
  { v:'60', l:'1 hora' }, { v:'90', l:'1h30' }, { v:'120', l:'2 horas' },
  { v:'180', l:'3 horas' }, { v:'240', l:'4 horas' }, { v:'480', l:'8 horas' },
];
const ROOT_CAUSE_OPTIONS = ['Erro de configuração','Falha de hardware','Erro de software','Problema de rede','Falta de treinamento','Erro do usuário','Problema de integração','Atualização/deploy','Outro'];
const COMPLEXITY_LABELS = ['','Muito Simples','Simples','Moderado','Complexo','Muito Complexo'];

type CloseForm = { solution: string; rootCause: string; timeSpent: string; internalNote: string; complexity: number };

function KanbanCloseModal({ ticket, customers, onConfirm, onCancel }: {
  ticket: any; customers: any[];
  onConfirm: (form: CloseForm) => void;
  onCancel: () => void;
}) {
  const customerName = (cid:string) => { const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):'—'; };
  const [form, setForm] = useState<CloseForm>({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
  const handleSubmit = () => {
    if (!form.solution.trim()) { toast.error('Solução aplicada é obrigatória'); return; }
    onConfirm(form);
  };
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:520, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', overflow:'hidden' }}>
        {/* Header */}
        <div style={{ background:'linear-gradient(135deg,#1E293B,#0F172A)', padding:'18px 22px', display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ width:40, height:40, borderRadius:10, background:'#334155', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <CheckCircle2 style={{ width:20, height:20, color:'#94A3B8' }} />
          </div>
          <div>
            <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:'#F1F5F9' }}>Encerrar Atendimento</h2>
            <p style={{ margin:'3px 0 0', fontSize:12, color:'#94A3B8' }}>Preencha as informações. O ticket vinculado também será fechado.</p>
          </div>
          <button onClick={onCancel} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#64748B', padding:4 }}>
            <X style={{ width:18, height:18 }} />
          </button>
        </div>
        {/* Ticket info */}
        <div style={{ background:'#1E293B', padding:'10px 22px', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:'#334155', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#94A3B8', flexShrink:0 }}>
            {customerName(ticket.clientId).slice(0,2).toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#6366F1' }}>{ticket.ticketNumber}</span>
              <span style={{ fontSize:12, color:'#CBD5E1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ticket.subject}</span>
            </div>
            <div style={{ fontSize:11, color:'#64748B' }}>{customerName(ticket.clientId)}{ticket.department ? ` · ${ticket.department}` : ''}</div>
          </div>
          <span style={{ background: PRIORITY_STYLE[ticket.priority]?.bg, color: PRIORITY_STYLE[ticket.priority]?.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, flexShrink:0 }}>
            {(PRIORITY_LABELS[ticket.priority]||ticket.priority)}
          </span>
        </div>
        {/* Form */}
        <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:14, maxHeight:'55vh', overflowY:'auto' }}>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>
              Solução Aplicada <span style={{ color:'#EF4444' }}>OBRIGATÓRIO</span>
            </label>
            <textarea value={form.solution} onChange={e => setForm(f=>({...f,solution:e.target.value}))}
              placeholder="Descreva o que foi feito para resolver..." rows={3} autoFocus
              style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${form.solution.trim()?'#E2E8F0':'#EF4444'}`, borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Causa Raiz</label>
              <select value={form.rootCause} onChange={e => setForm(f=>({...f,rootCause:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', outline:'none', background:'#fff' }}>
                <option value="">Selecione...</option>
                {ROOT_CAUSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Tempo de Atendimento</label>
              <select value={form.timeSpent} onChange={e => setForm(f=>({...f,timeSpent:e.target.value}))}
                style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', outline:'none', background:'#fff' }}>
                <option value="">Selecione...</option>
                {TIME_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Nota Interna</label>
            <textarea value={form.internalNote} onChange={e => setForm(f=>({...f,internalNote:e.target.value}))}
              placeholder="Observações para a equipe..." rows={2}
              style={{ width:'100%', padding:'10px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }} />
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>Complexidade</label>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} type="button" onClick={() => setForm(f=>({...f,complexity:n}))}
                  style={{ width:44, height:36, borderRadius:8, border:`2px solid ${form.complexity>=n?'#D97706':'#E2E8F0'}`, background:form.complexity>=n?'#FEF3C7':'#F8FAFC', color:form.complexity>=n?'#D97706':'#94A3B8', fontSize:16, fontWeight:700, cursor:'pointer' }}>
                  {form.complexity>=n?'★':'☆'}
                </button>
              ))}
              {form.complexity > 0 && <span style={{ fontSize:12, color:'#D97706', fontWeight:600, marginLeft:4 }}>{COMPLEXITY_LABELS[form.complexity]}</span>}
            </div>
          </div>
          <div style={{ background:'#FFF7ED', border:'1.5px solid #FED7AA', borderRadius:8, padding:'10px 14px', display:'flex', gap:10, alignItems:'flex-start' }}>
            <AlertTriangle style={{ width:15, height:15, color:'#EA580C', flexShrink:0, marginTop:1 }} />
            <p style={{ margin:0, fontSize:12, color:'#9A3412', lineHeight:1.5 }}>
              Após encerrar, a conversa e o ticket serão marcados como <strong>Fechado</strong>. Esta ação não pode ser desfeita.
            </p>
          </div>
        </div>
        <div style={{ padding:'14px 22px', borderTop:'1px solid #F1F5F9', display:'flex', gap:10, justifyContent:'flex-end' }}>
          <button onClick={onCancel} style={{ padding:'9px 20px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSubmit} style={{ padding:'9px 22px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#1E293B,#0F172A)', color:'#F1F5F9', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
            <CheckCircle2 style={{ width:14, height:14 }} /> Encerrar Atendimento
          </button>
        </div>
      </div>
    </div>
  );
}

function KanbanView({ tickets, customers, team, onMove }: {
  tickets: any[]; customers: any[]; team: any[];
  onMove: (ticketId: string, newStatus: string, oldStatus: string) => void;
}) {
  const customerName = (cid:string) => { const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):'—'; };
  const techName = (uid:string) => { const u = team.find((u:any)=>u.id===uid); return u?(u.name||u.email):''; };

  const [draggingId, setDraggingId] = useState<string|null>(null);
  const [draggingStatus, setDraggingStatus] = useState<string|null>(null);
  const [overCol, setOverCol] = useState<string|null>(null);
  const [pendingMove, setPendingMove] = useState<{ticket:any; newStatus:string; oldStatus:string}|null>(null);
  const [pendingReopen, setPendingReopen] = useState<{ticket:any; newStatus:string; oldStatus:string}|null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const byStatus = useMemo(() => {
    const map: Record<string, any[]> = {};
    KANBAN_COLS.forEach(s => { map[s] = []; });
    tickets.forEach(t => { if (map[t.status]) map[t.status].push(t); });
    return map;
  }, [tickets]);

  const handleDragStart = (e: React.DragEvent, t: any) => {
    setDraggingId(t.id);
    setDraggingStatus(t.status);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('ticketId', t.id);
    e.dataTransfer.setData('ticketStatus', t.status);
  };

  const handleDragEnd = () => { setDraggingId(null); setDraggingStatus(null); setOverCol(null); };

  const handleDragOver = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverCol(col);
  };

  const handleDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    const oldStatus = e.dataTransfer.getData('ticketStatus');
    setOverCol(null);
    setDraggingId(null);
    setDraggingStatus(null);
    if (!ticketId || col === oldStatus) return;
    const t = tickets.find(t => t.id === ticketId);
    if (!t) return;
    if (col === 'resolved' || col === 'closed') {
      setPendingMove({ ticket: t, newStatus: col, oldStatus }); return;
    }
    if (oldStatus === 'resolved' || oldStatus === 'closed') {
      setReopenReason('');
      setPendingReopen({ ticket: t, newStatus: col, oldStatus }); return;
    }
    onMove(ticketId, col, oldStatus);
  };

  const confirmKanbanReopen = async () => {
    if (!pendingReopen) return;
    if (!reopenReason.trim()) { toast.error('Informe o motivo da reabertura'); return; }
    const { ticket, newStatus, oldStatus } = pendingReopen;
    try {
      await api.updateTicket(ticket.id, { status: newStatus });
      await api.addMessage(ticket.id, { content: `Ticket reaberto. Motivo: ${reopenReason}`, messageType: 'system' });
      setPendingReopen(null);
      onMove(ticket.id, newStatus, oldStatus);
    } catch(e:any) { toast.error(e?.response?.data?.message || 'Erro ao reabrir'); }
  };

  const confirmKanbanClose = async (form: CloseForm) => {
    if (!pendingMove) return;
    const { ticket, newStatus, oldStatus } = pendingMove;
    try {
      if (newStatus === 'resolved') {
        await api.resolveTicket(ticket.id, { resolutionSummary: form.solution || undefined, timeSpentMin: form.timeSpent ? Number(form.timeSpent) : 0 });
      } else {
        await api.closeTicket(ticket.id);
      }
      if (form.internalNote?.trim()) {
        await api.addMessage(ticket.id, { content: form.internalNote, messageType: 'internal' });
      }
      setPendingMove(null);
      onMove(ticket.id, newStatus, oldStatus);
    } catch(e:any) { toast.error(e?.response?.data?.message || 'Erro ao encerrar'); }
  };

  return (
    <>
    {pendingMove && (
      <KanbanCloseModal
        ticket={pendingMove.ticket}
        customers={customers}
        onConfirm={confirmKanbanClose}
        onCancel={() => setPendingMove(null)}
      />
    )}
    {pendingReopen && (
      <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
        <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 16px 48px rgba(0,0,0,0.2)', overflow:'hidden' }}>
          <div style={{ padding:'18px 22px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:'#EFF6FF', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <RotateCw style={{ width:17, height:17, color:'#2563EB' }} />
            </div>
            <div style={{ flex:1 }}>
              <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'#0F172A' }}>Reabrir Ticket</h2>
              <p style={{ margin:0, fontSize:12, color:'#94A3B8' }}>
                <span style={{ fontFamily:'monospace', color:'#6366F1' }}>{pendingReopen.ticket.ticketNumber}</span>
                {' · '}{pendingReopen.ticket.subject}
              </p>
            </div>
            <button onClick={() => setPendingReopen(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}>
              <X style={{ width:18, height:18 }} />
            </button>
          </div>
          <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:6 }}>
                Motivo da Reabertura <span style={{ color:'#EF4444' }}>*</span>
              </label>
              <textarea value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                placeholder="Descreva o motivo pelo qual este ticket está sendo reaberto..."
                rows={3} autoFocus
                style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${reopenReason.trim()?'#E2E8F0':'#EF4444'}`, borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }} />
            </div>
            <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:'9px 12px', display:'flex', gap:8, alignItems:'flex-start' }}>
              <RotateCw style={{ width:13, height:13, color:'#2563EB', flexShrink:0, marginTop:1 }} />
              <p style={{ margin:0, fontSize:11, color:'#1D4ED8' }}>
                O ticket voltará para <strong>{STATUS_LABELS[pendingReopen.newStatus]||pendingReopen.newStatus}</strong> e o motivo será registrado.
              </p>
            </div>
          </div>
          <div style={{ padding:'12px 22px', borderTop:'1px solid #F1F5F9', display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={() => setPendingReopen(null)} style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Cancelar
            </button>
            <button onClick={confirmKanbanReopen} style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'#2563EB', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <RotateCw style={{ width:13, height:13 }} /> Reabrir Ticket
            </button>
          </div>
        </div>
      </div>
    )}
    <div style={{ display:'flex', gap:10, overflowX:'auto', alignItems:'flex-start', paddingBottom:8, userSelect:'none' }}>
      {KANBAN_COLS.map(col => {
        const s = STATUS_STYLE[col];
        const cards = byStatus[col] || [];
        const isOver = overCol === col;
        return (
          <div key={col}
            onDragOver={e => handleDragOver(e, col)}
            onDragLeave={() => setOverCol(null)}
            onDrop={e => handleDrop(e, col)}
            style={{
              minWidth:250, width:250, flexShrink:0,
              background: isOver ? '#EFF6FF' : '#EBECF0',
              borderRadius:12,
              border: isOver ? '2px dashed '+s.header : '2px solid transparent',
              display:'flex', flexDirection:'column',
              maxHeight:'calc(100vh - 340px)',
              transition:'background .15s, border .15s',
            }}>
            {/* Column header — Trello style */}
            <div style={{ background:s.header, borderRadius:'10px 10px 0 0', padding:'10px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <span style={{ color:s.headerText, fontWeight:700, fontSize:13 }}>{STATUS_LABELS[col]}</span>
              <span style={{ background:'rgba(255,255,255,.25)', color:s.headerText, borderRadius:20, padding:'1px 9px', fontSize:12, fontWeight:700 }}>{cards.length}</span>
            </div>

            {/* Cards scroll area */}
            <div style={{ overflowY:'auto', padding:'8px 8px', display:'flex', flexDirection:'column', gap:8, flex:1, minHeight:80 }}>
              {cards.length === 0 && !isOver && (
                <div style={{ padding:'18px 0', textAlign:'center', color:'#A0AEC0', fontSize:12 }}>Sem tickets</div>
              )}
              {cards.map(t => {
                const isDragging = draggingId === t.id;
                return (
                  <div key={t.id}
                    draggable
                    onDragStart={e => handleDragStart(e, t)}
                    onDragEnd={handleDragEnd}
                    style={{
                      background: isDragging ? '#E0E7FF' : '#fff',
                      borderRadius:8,
                      boxShadow: isDragging ? '0 4px 12px rgba(79,70,229,.2)' : '0 1px 3px rgba(0,0,0,.1)',
                      padding:'10px 12px',
                      cursor:'grab',
                      opacity: isDragging ? 0.6 : 1,
                      transition:'box-shadow .15s, opacity .15s',
                      border:'1px solid #E2E8F0',
                    }}
                    onMouseEnter={e => { if (!isDragging) e.currentTarget.style.boxShadow='0 3px 8px rgba(0,0,0,.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,.1)'; }}>

                    {/* Card top: number + priority */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                      <Link href={`/dashboard/tickets/${t.id}`} onClick={e => e.stopPropagation()}
                        style={{ fontFamily:'monospace', color:'#4F46E5', fontWeight:700, fontSize:11, background:'#EEF2FF', padding:'2px 7px', borderRadius:5, textDecoration:'none' }}>
                        {t.ticketNumber}
                      </Link>
                      <PriorityBadge priority={t.priority} />
                    </div>

                    {/* Subject */}
                    <Link href={`/dashboard/tickets/${t.id}`} onClick={e => e.stopPropagation()} style={{ textDecoration:'none' }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'#172B4D', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' as any }}>
                        {t.escalated && <AlertTriangle style={{ width:11, height:11, color:'#EF4444', marginRight:3, verticalAlign:'middle' }} />}
                        {t.subject}
                      </div>
                    </Link>

                    {/* Client */}
                    <div style={{ fontSize:11, color:'#5E6C84', marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{customerName(t.clientId)}</div>

                    {/* Dept/category */}
                    {(t.department || t.category) && (
                      <div style={{ fontSize:10, color:'#97A0AF', marginBottom:5 }}>
                        {[t.department, t.category].filter(Boolean).join(' · ')}
                      </div>
                    )}

                    {/* Footer: tech + SLA */}
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid #F4F5F7', paddingTop:6, marginTop:4 }}>
                      {t.assignedTo ? (
                        <div style={{ fontSize:10, color:'#5E6C84', display:'flex', alignItems:'center', gap:4 }}>
                          <div style={{ width:18, height:18, borderRadius:'50%', background:'#DDD6FE', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#5B21B6', flexShrink:0 }}>
                            {techName(t.assignedTo)?.[0]?.toUpperCase()||'?'}
                          </div>
                          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:90 }}>{techName(t.assignedTo)}</span>
                        </div>
                      ) : (
                        <span style={{ fontSize:10, color:'#DFE1E6' }}>Sem técnico</span>
                      )}
                      <SlaIndicator ticket={t} />
                    </div>
                  </div>
                );
              })}
              {/* Drop placeholder */}
              {isOver && draggingStatus !== col && (
                <div style={{ border:'2px dashed #93C5FD', borderRadius:8, padding:'20px 0', textAlign:'center', color:'#93C5FD', fontSize:12 }}>
                  Soltar aqui
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </>
  );
}

export default function TicketsPage() {
  const [data, setData] = useState<any>({ data:[], total:0, totalPages:1 });
  const [stats, setStats] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [department, setDepartment] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list'|'kanban'>('list');
  const [sortField, setSortField] = useState<'ticketNumber'|'subject'|'createdAt'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');

  const filters = useMemo(() => ({
    page,
    perPage: viewMode === 'kanban' ? 500 : 25,
    search: search||undefined,
    status: status||undefined,
    priority: priority||undefined,
    department: department||undefined,
    assignedTo: assignedTo||undefined,
    sort: `${sortField}:${sortDir}`,
  }), [page, search, status, priority, department, assignedTo, viewMode, sortField, sortDir]);

  const load = async () => {
    setLoading(true);
    try {
      const [ticketsRes, statsRes, teamRes, customersRes, treeRes] = await Promise.all([
        api.getTickets(filters), api.ticketStats(), api.getTeam(),
        api.getCustomers({ perPage:200 }), api.getTicketSettingsTree().catch(() => null),
      ]);
      setData(ticketsRes as any); setStats(statsRes); setTeam((teamRes as any)||[]); setCustomers((customersRes as any)?.data||(customersRes as any)||[]);
      const depts: any[] = (treeRes as any)?.departments ?? (Array.isArray(treeRes) ? treeRes : []);
      setDepartments(depts.map((d: any) => d.name).filter(Boolean));
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, status, priority, department, assignedTo, viewMode, sortField, sortDir]);
  useEffect(() => { const t = setTimeout(()=>{ setPage(1); load(); }, 400); return () => clearTimeout(t); }, [search]);

  const exportCSV = async () => {
    try {
      const cName = (id:string) => { const c=customers.find((c:any)=>c.id===id); return c?(c.tradeName||c.companyName):'—'; };
      const tName = (id:string) => { const u=team.find((u:any)=>u.id===id); return u?(u.name||u.email):'Não atribuído'; };
      const fmtDt = (d:string|null) => d ? new Date(d).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      const res:any = await api.getTickets({ perPage:9999, search:search||undefined, status:status||undefined, priority:priority||undefined, department:department||undefined });
      const all = Array.isArray(res)?res:res?.data??res?.items??[];
      const rows = [['Nº','Assunto','Cliente','Status','Prioridade','Técnico','Departamento','Categoria','SLA','Abertura','Resolução','Fechamento']];
      all.forEach((t:any) => rows.push([
        t.ticketNumber, t.subject, cName(t.clientId),
        STATUS_LABELS[t.status]||t.status, PRIORITY_LABELS[t.priority]||t.priority,
        tName(t.assignedTo), t.department||'', t.category||'',
        t.slaResolveAt?fmtDt(t.slaResolveAt):'', fmtDt(t.createdAt), fmtDt(t.resolvedAt), fmtDt(t.closedAt),
      ]));
      const csv = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `tickets-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    } catch { toast.error('Erro ao exportar CSV'); }
  };

  const handleKanbanMove = async (ticketId: string, newStatus: string, oldStatus: string) => {
    // Optimistic update — evita reload completo, preserva filtros e paginação
    setData((prev: any) => ({
      ...prev,
      data: prev.data.map((t: any) => t.id === ticketId ? { ...t, status: newStatus } : t),
    }));
    try {
      if (['resolved','closed'].includes(oldStatus) && !['resolved','closed'].includes(newStatus)) {
        // reopen — já tratado em confirmKanbanReopen; optimistic update já aplicado
      } else if (newStatus === 'cancelled') {
        const reason = window.prompt('Motivo do cancelamento:') || '';
        await api.cancelTicket(ticketId, { cancelReason: reason || undefined });
      } else if (!['resolved','closed'].includes(newStatus)) {
        await api.updateTicket(ticketId, { status: newStatus });
      }
      // Atualiza stats em background sem setLoading (evita flicker)
      api.ticketStats().then((s: any) => setStats(s)).catch(() => {});
    } catch(e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao mover ticket');
      setData((prev: any) => ({
        ...prev,
        data: prev.data.map((t: any) => t.id === ticketId ? { ...t, status: oldStatus } : t),
      }));
    }
  };

  const customerName = (cid:string) => { const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):'—'; };
  const techName = (uid:string) => { const u = team.find((u:any)=>u.id===uid); return u?(u.name||u.email):'—'; };

  const STAT_CARDS = [
    { label:'Abertos',      value:stats?.open||0,          iconBg:'#EEF2FF', iconColor:'#4F46E5', numColor:'#4F46E5', labelColor:'#6366F1', activeColor:'#4F46E5', icon:Ticket,      status:'open' },
    { label:'Em andamento', value:stats?.inProgress||0,    iconBg:'#FFFBEB', iconColor:'#D97706', numColor:'#D97706', labelColor:'#92400E', activeColor:'#D97706', icon:RotateCw,    status:'in_progress' },
    { label:'Aguardando',   value:stats?.waitingClient||0, iconBg:'#F0F9FF', iconColor:'#0284C7', numColor:'#0284C7', labelColor:'#0369A1', activeColor:'#0284C7', icon:Clock,       status:'waiting_client' },
    { label:'Resolvidos',   value:stats?.resolved||0,      iconBg:'#F0FDF4', iconColor:'#16A34A', numColor:'#16A34A', labelColor:'#166534', activeColor:'#16A34A', icon:CheckCircle, status:'resolved' },
    { label:'Fechados',     value:stats?.closed||0,        iconBg:'#F9FAFB', iconColor:'#6B7280', numColor:'#374151', labelColor:'#6B7280', activeColor:'#64748B', icon:XCircle,     status:'closed' },
    { label:'Cancelados',   value:stats?.cancelled||0,     iconBg:'#FEF2F2', iconColor:'#DC2626', numColor:'#DC2626', labelColor:'#991B1B', activeColor:'#DC2626', icon:XCircle,     status:'cancelled' },
  ];

  const S = {
    bg: '#fff', bg2: '#F8F8FB', bg3: '#F1F1F6',
    bd: 'rgba(0,0,0,0.07)', bd2: 'rgba(0,0,0,0.12)',
    txt: '#111118', txt2: '#6B6B80', txt3: '#A8A8BE',
    accent: '#4F46E5', accentL: '#EEF2FF',
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 44px)', overflow:'hidden', background:'#F1F1F6', fontFamily:"'DM Sans',system-ui,sans-serif" }}>
      {/* Topbar */}
      <div style={{ background:'#fff', borderBottom:'1px solid rgba(0,0,0,.07)', padding:'0 28px', display:'flex', alignItems:'center', gap:16, height:56, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flex:1 }}>
          <div style={{ width:36, height:36, background:S.accentL, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Ticket style={{ width:18, height:18, color:S.accent }} strokeWidth={1.8} />
          </div>
          <div>
            <h1 style={{ margin:0, fontSize:16, fontWeight:600, color:S.txt }}>Tickets</h1>
            <p style={{ margin:0, fontSize:11, color:S.txt2, marginTop:1 }}>{data.total||0} ticket{data.total!==1?'s':''} encontrado{data.total!==1?'s':''}</p>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ display:'flex', border:`1px solid ${S.bd2}`, borderRadius:9, overflow:'hidden' }}>
            <button onClick={() => setViewMode('list')}
              style={{ padding:'6px 14px', background:viewMode==='list'?S.accent:'transparent', color:viewMode==='list'?'#fff':S.txt2, border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, fontFamily:"inherit", transition:'all .1s' }}>
              <LayoutList style={{ width:13, height:13 }} /> Lista
            </button>
            <button onClick={() => setViewMode('kanban')}
              style={{ padding:'6px 14px', background:viewMode==='kanban'?S.accent:'transparent', color:viewMode==='kanban'?'#fff':S.txt2, border:'none', borderLeft:`1px solid ${S.bd2}`, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, fontFamily:"inherit", transition:'all .1s' }}>
              <Columns style={{ width:13, height:13 }} /> Kanban
            </button>
          </div>
          <button onClick={exportCSV}
            style={{ padding:'6px 12px', background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, fontWeight:500, color:S.txt2, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontFamily:'inherit' }}>
            <Download style={{ width:13, height:13 }} /> CSV
          </button>
          <Link href="/dashboard/tickets/new"
            style={{ padding:'7px 16px', background:S.accent, color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, textDecoration:'none' }}>
            <Plus style={{ width:14, height:14 }} /> Novo Ticket
          </Link>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', display:'flex', flexDirection:'column', padding:'20px 28px', gap:16 }}>
        {/* Stats */}
        {stats && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, flexShrink:0 }}>
            {STAT_CARDS.map(({ label, value, iconBg, iconColor, numColor, labelColor, activeColor, icon:Icon, status:cardStatus }) => {
              const isActive = status === cardStatus;
              return (
              <button key={label} type="button"
                onClick={() => { setStatus(s => s===cardStatus?'':cardStatus); setPage(1); }}
                style={{
                  display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
                  borderRadius:12, cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                  background: isActive ? activeColor : S.bg,
                  border: `1px solid ${isActive ? activeColor : S.bd}`,
                  transition:'background .15s, border-color .15s',
                  boxShadow: isActive ? `0 4px 12px ${activeColor}40` : 'none',
                }}>
                <div style={{ width:34, height:34, borderRadius:9, background: isActive ? 'rgba(255,255,255,0.2)' : iconBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Icon style={{ width:16, height:16, color: isActive ? '#fff' : iconColor }} strokeWidth={1.8} />
                </div>
                <div>
                  <div style={{ fontSize:20, fontWeight:700, lineHeight:1.1, color: isActive ? '#fff' : numColor }}>{value}</div>
                  <div style={{ fontSize:10, fontWeight:500, marginTop:1, color: isActive ? 'rgba(255,255,255,0.8)' : labelColor }}>{label}</div>
                </div>
              </button>
              );
            })}
          </div>
        )}

        {/* Filtros */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, flexWrap:'wrap' as any }}>
          <div style={{ flex:1, minWidth:200, maxWidth:380, display:'flex', alignItems:'center', gap:8, background:S.bg, border:`1px solid ${S.bd2}`, borderRadius:9, padding:'7px 12px' }}>
            <Search style={{ width:13, height:13, color:S.txt3, flexShrink:0 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por número, assunto, cliente..."
              style={{ border:'none', outline:'none', background:'none', fontSize:12, color:S.txt, fontFamily:'inherit', width:'100%' }} />
          </div>
          {[
            { value: status,     onChange: (v:string) => { setStatus(v);     setPage(1); }, placeholder: 'Todos os status',      options: Object.entries(STATUS_LABELS) },
            { value: priority,   onChange: (v:string) => { setPriority(v);   setPage(1); }, placeholder: 'Todas as prioridades', options: Object.entries(PRIORITY_LABELS) },
          ].map((f, i) => (
            <select key={i} value={f.value} onChange={e => f.onChange(e.target.value)}
              style={{ padding:'7px 28px 7px 11px', background:`${S.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23A8A8BE' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center`, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, color:S.txt, fontFamily:'inherit', cursor:'pointer', outline:'none', appearance:'none' as any }}>
              <option value="">{f.placeholder}</option>
              {f.options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          <select value={department} onChange={e => { setDepartment(e.target.value); setPage(1); }}
            style={{ padding:'7px 28px 7px 11px', background:`${S.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23A8A8BE' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center`, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, color:S.txt, fontFamily:'inherit', cursor:'pointer', outline:'none', appearance:'none' as any }}>
            <option value="">Departamento</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={assignedTo} onChange={e => { setAssignedTo(e.target.value); setPage(1); }}
            style={{ padding:'7px 28px 7px 11px', background:`${S.bg} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23A8A8BE' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 10px center`, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, color:S.txt, fontFamily:'inherit', cursor:'pointer', outline:'none', appearance:'none' as any }}>
            <option value="">Técnico</option>
            {team.map((u:any) => <option key={u.id} value={u.id}>{u.name||u.email}</option>)}
          </select>
        </div>

        {/* Kanban */}
        {viewMode === 'kanban' && (
          <div style={{ flex:1, overflow:'hidden', background:S.bg, border:`1px solid ${S.bd}`, borderRadius:12, padding:12, overflowX:'hidden' }}>
            {loading ? (
              <div style={{ padding:48, textAlign:'center', color:S.txt3 }}>
                <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                Carregando...
              </div>
            ) : (
              <KanbanView tickets={data.data} customers={customers} team={team} onMove={handleKanbanMove} />
            )}
          </div>
        )}

        {/* Lista */}
        {viewMode === 'list' && (
          <div style={{ flex:1, overflow:'hidden', background:S.bg, border:`1px solid ${S.bd}`, borderRadius:12, display:'flex', flexDirection:'column' }}>
            {/* Table header */}
            <div style={{ display:'grid', gridTemplateColumns:'90px 1fr 140px 130px 110px 100px 110px 80px 110px', padding:'0 16px', borderBottom:`1px solid ${S.bd}`, flexShrink:0 }}>
              {[
                { label:'Nº', field:'ticketNumber' as const },
                { label:'Assunto', field:'subject' as const },
                { label:'Cliente', field:null },
                { label:'Depto / Categoria', field:null },
                { label:'Status', field:null },
                { label:'Prioridade', field:null },
                { label:'Técnico', field:null },
                { label:'SLA', field:null },
                { label:'Abertura', field:'createdAt' as const },
              ].map(h => (
                <div key={h.label}
                  onClick={() => {
                    if (!h.field) return;
                    if (sortField === h.field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                    else { setSortField(h.field); setSortDir('asc'); }
                    setPage(1);
                  }}
                  style={{ padding:'10px 8px', fontSize:10, fontWeight:700, color: h.field && sortField===h.field ? S.accent : S.txt3, textTransform:'uppercase' as any, letterSpacing:'0.06em', whiteSpace:'nowrap' as any, display:'flex', alignItems:'center', gap:4, cursor: h.field ? 'pointer' : 'default', userSelect:'none' as any }}>
                  {h.label}
                  {h.field && (
                    sortField === h.field
                      ? <span style={{ fontSize:9, color:S.accent }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                      : <ChevronsUpDown style={{ width:10, height:10, opacity:0.4 }} />
                  )}
                </div>
              ))}
            </div>

            {/* Table body */}
            <div style={{ flex:1, overflowY:'auto' }}>
              {loading ? (
                <div style={{ padding:48, textAlign:'center', color:S.txt3 }}>
                  <div className="w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Carregando...
                </div>
              ) : data.data.length === 0 ? (
                <div style={{ padding:48, textAlign:'center', color:S.txt3 }}>
                  <Ticket style={{ width:36, height:36, margin:'0 auto 12px', opacity:0.2 }} />
                  <p>Nenhum ticket encontrado</p>
                </div>
              ) : data.data.map((t:any) => (
                <div key={t.id}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background=S.bg2}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background=t.escalated?'#FFF8F8':'transparent'}
                  style={{ display:'grid', gridTemplateColumns:'90px 1fr 140px 130px 110px 100px 110px 80px 110px', padding:'0 16px', borderBottom:`1px solid ${S.bd}`, cursor:'pointer', transition:'background .1s', alignItems:'center', background:t.escalated?'#FFF8F8':'transparent' }}>
                  <div style={{ padding:'11px 8px' }}>
                    <Link href={`/dashboard/tickets/${t.id}`}
                      style={{ fontFamily:"'DM Mono', monospace", color:S.accent, fontWeight:600, fontSize:11, textDecoration:'none' }}
                      onClick={e => e.stopPropagation()}>
                      {t.ticketNumber}
                    </Link>
                  </div>
                  <div style={{ padding:'11px 8px', minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      {t.escalated && <AlertTriangle style={{ width:13, height:13, color:'#EF4444', flexShrink:0 }} />}
                      <Link href={`/dashboard/tickets/${t.id}`}
                        style={{ fontSize:12, fontWeight:500, color:S.txt, textDecoration:'none', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                        {t.subject}
                      </Link>
                    </div>
                    {t.subcategory && <div style={{ fontSize:11, color:S.txt3, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.subcategory}</div>}
                  </div>
                  <div style={{ padding:'11px 8px', fontSize:11, color:S.txt2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{customerName(t.clientId)}</div>
                  <div style={{ padding:'11px 8px' }}>
                    {t.department && <div style={{ fontSize:11, fontWeight:500, color:S.txt }}>{t.department}</div>}
                    {t.category && <div style={{ fontSize:10, color:S.txt3 }}>{t.category}</div>}
                    {!t.department && !t.category && <span style={{ color:S.txt3 }}>—</span>}
                  </div>
                  <div style={{ padding:'11px 8px' }}><StatusBadge status={t.status} /></div>
                  <div style={{ padding:'11px 8px' }}><PriorityBadge priority={t.priority} /></div>
                  <div style={{ padding:'11px 8px', fontSize:11, color:S.txt2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{techName(t.assignedTo)||'—'}</div>
                  <div style={{ padding:'11px 8px', whiteSpace:'nowrap' }}>
                    {(() => {
                      if (!t.slaResolveAt || ['resolved','closed','cancelled'].includes(t.status)) return null;
                      const diff = new Date(t.slaResolveAt).getTime() - Date.now();
                      if (diff < 0) return <span style={{ fontSize:11, color:'#DC2626', fontWeight:700, fontFamily:"'DM Mono',monospace" }}>VIOLADO</span>;
                      const hours = Math.floor(diff/3600000);
                      const mins = Math.floor((diff%3600000)/60000);
                      return <span style={{ fontSize:11, color:diff<4*3600000?'#F97316':S.txt2, fontFamily:"'DM Mono',monospace" }}>{hours>0?`${hours}h ${mins}m`:`${mins}m`}</span>;
                    })()}
                  </div>
                  <div style={{ padding:'11px 8px', fontSize:11, color:S.txt2, fontFamily:"'DM Mono',monospace", whiteSpace:'nowrap' }}>
                    {format(new Date(t.createdAt), 'dd/MM/yy HH:mm', { locale:ptBR })}
                  </div>
                </div>
              ))}
            </div>

            {data.totalPages > 1 && (() => {
              const tp = data.totalPages;
              // build page numbers: always show first, last, current ±1, with ellipsis
              const pages: (number|'...')[] = [];
              const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
              add(1);
              if (page - 2 > 2) pages.push('...');
              for (let i = Math.max(2, page-1); i <= Math.min(tp-1, page+1); i++) add(i);
              if (page + 2 < tp - 1) pages.push('...');
              if (tp > 1) add(tp);
              const btnBase: React.CSSProperties = { minWidth:28, height:28, borderRadius:7, border:`1px solid ${S.bd2}`, background:S.bg2, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:500, color:S.txt2, padding:'0 6px', fontFamily:'inherit' };
              return (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:`1px solid ${S.bd}`, flexShrink:0, background:S.bg }}>
                  <span style={{ fontSize:11, color:S.txt2 }}>Página {page} de {tp} · {data.total} tickets</span>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                      style={{ ...btnBase, opacity:page===1?0.4:1 }}>
                      <ChevronLeft style={{ width:12, height:12 }} />
                    </button>
                    {pages.map((p, i) => p === '...'
                      ? <span key={`e${i}`} style={{ fontSize:11, color:S.txt3, padding:'0 2px' }}>…</span>
                      : <button key={p} onClick={() => setPage(p as number)}
                          style={{ ...btnBase, background: page===p ? S.accent : S.bg2, color: page===p ? '#fff' : S.txt2, border: `1px solid ${page===p ? S.accent : S.bd2}`, fontWeight: page===p ? 700 : 500 }}>
                          {p}
                        </button>
                    )}
                    <button onClick={() => setPage(p=>Math.min(tp,p+1))} disabled={page===tp}
                      style={{ ...btnBase, opacity:page===tp?0.4:1 }}>
                      <ChevronRight style={{ width:12, height:12 }} />
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
