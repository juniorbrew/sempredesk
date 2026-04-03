'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useRealtimeTicket, useRealtimeConversation } from '@/lib/realtime';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { ArrowLeft, RotateCw, Tag, Clock, AlertTriangle, Lock, Send, Paperclip, CheckCircle2, XCircle, X, ChevronDown, Save, RefreshCw, User, UserCircle, Headphones, Building2, MessageSquare, PhoneCall, ThumbsUp, ThumbsDown, ChevronUp, Ticket as TicketIcon, CalendarClock, CalendarCheck, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TagMultiSelect } from '@/components/ui/TagMultiSelect';

const STATUS_CONFIG: Record<string,{ label:string; bg:string; color:string; dot:string }> = {
  open:           { label:'Aberto',             bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5' },
  in_progress:    { label:'Em Andamento',        bg:'#FEF3C7', color:'#92400E', dot:'#D97706' },
  waiting_client: { label:'Aguardando Cliente',  bg:'#F0F9FF', color:'#0369A1', dot:'#0284C7' },
  resolved:       { label:'Resolvido',           bg:'#F0FDF4', color:'#166534', dot:'#16A34A' },
  closed:         { label:'Fechado',             bg:'#F9FAFB', color:'#374151', dot:'#374151' },
  cancelled:      { label:'Cancelado',           bg:'#FEF2F2', color:'#991B1B', dot:'#EF4444' },
};

const PRIORITY_CONFIG: Record<string,{ label:string; color:string; bg:string; dot:string }> = {
  low:      { label:'Baixa',    color:'#166534', bg:'#F0FDF4', dot:'#16A34A' },
  medium:   { label:'Média',    color:'#92400E', bg:'#FEF3C7', dot:'#D97706' },
  high:     { label:'Alta',     color:'#C2410C', bg:'#FFF7ED', dot:'#F97316' },
  critical: { label:'Crítico',  color:'#86198F', bg:'#FDF2F8', dot:'#A855F7' },
};

const MESSAGE_TYPE_LABELS: Record<string,string> = {
  comment:'Comentário', system:'Sistema', status_change:'Sistema',
  assignment:'Sistema', resolution:'Resolução', escalation:'Escalonamento', internal:'Nota Interna',
};

const inp = { width:'100%', padding:'8px 12px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:8, color:'#0F172A', fontSize:13, outline:'none', boxSizing:'border-box' as const };

/** Alinhado ao backend: imagem/PDF/Office/ZIP/texto; sem áudio/vídeo (isso continua na conversa / WhatsApp). */
const TICKET_REPLY_FILE_ACCEPT =
  'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,application/pdf,text/plain,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default function TicketDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const id = String(params?.id || '');

  const [ticket, setTicket] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [tree, setTree] = useState<any>({ departments: [] });
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [rootCauseOptions, setRootCauseOptions] = useState<string[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'comment'|'note'|'update'>('comment');
  const [message, setMessage] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [showClient, setShowClient] = useState(true);
  const [showAgent, setShowAgent] = useState(true);
  const [showUpdates, setShowUpdates] = useState(true);
  const [showNotes, setShowNotes] = useState(true);
  const [conversationMsgs, setConversationMsgs] = useState<any[]>([]);
  const [convMediaUrls, setConvMediaUrls] = useState<Record<string, string>>({});
  const convMediaUrlsRef = useRef<Record<string, string>>({});
  convMediaUrlsRef.current = convMediaUrls;
  const convMediaInFlightRef = useRef<Set<string>>(new Set());
  const [ticketReplyAttachUrls, setTicketReplyAttachUrls] = useState<Record<string, string>>({});
  const ticketReplyAttachUrlsRef = useRef<Record<string, string>>({});
  ticketReplyAttachUrlsRef.current = ticketReplyAttachUrls;
  const ticketReplyInflightRef = useRef<Set<string>>(new Set());
  const [showConversation, setShowConversation] = useState(false);
  const [showConvFilter, setShowConvFilter] = useState(true);
  const [interactionExpanded, setInteractionExpanded] = useState(false);
  const [edit, setEdit] = useState<any>({ priority:'medium', assignedTo:'', department:'', category:'', subcategory:'', tags:[] as string[] });
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeForm, setCloseForm] = useState({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
  const [showContentModal, setShowContentModal] = useState(false);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentForm, setContentForm] = useState({ subject:'', description:'' });

  const load = async () => {
    setLoading(true);
    try {
      const [ticketRes, messageRes, teamRes, treeRes, customersRes, contractsRes, tagsRes, rootCausesRes] = await Promise.all([
        api.getTicket(id), api.getMessages(id, true), api.getTeam(),
        api.getTicketSettingsTree(), api.getCustomers({ perPage:200 }), api.getContracts(), api.getTags({ active: true }), api.getRootCauses({ active: true }).catch(() => []),
      ]);
      const t: any = ticketRes;
      const msgs: any = messageRes;
      // Filter out chat channel messages — they belong to the conversation transcript block
      const filteredMsgs = (Array.isArray(msgs) ? msgs : []).filter((m: any) =>
        !t.conversationId || (m.channel !== 'portal' && m.channel !== 'whatsapp')
      );
      setTicket(t); setMessages(filteredMsgs); setTeam((teamRes as any) || []);
      setTree((treeRes as any) || { departments:[] });
      setCustomers((customersRes as any)?.data || (customersRes as any) || []);
      setAvailableTags(Array.isArray(tagsRes) ? tagsRes : (tagsRes as any)?.data ?? []);
      setRootCauseOptions((Array.isArray(rootCausesRes) ? rootCausesRes : (rootCausesRes as any)?.data ?? []).map((item: any) => item.name).filter(Boolean));
      if (t.clientId) {
        try { const ct = await api.getContacts(t.clientId); setContacts(Array.isArray(ct) ? ct : (ct as any)?.data ?? []); } catch { setContacts([]); }
        try { const hist: any = await api.getTickets({ clientId: t.clientId, perPage: 6, sort: 'createdAt:desc' }); const hList = Array.isArray(hist) ? hist : hist?.data ?? hist?.items ?? []; setClientHistory(hList.filter((x: any) => x.id !== id)); } catch { setClientHistory([]); }
      }
      if (t.conversationId) {
        try {
          const cMsgs: any = await api.getConversationMessages(t.conversationId, { limit: 100 });
          const list = cMsgs?.messages ?? (Array.isArray(cMsgs) ? cMsgs : cMsgs?.data ?? []);
          setConversationMsgs(Array.isArray(list) ? list : []);
        } catch {
          setConversationMsgs([]);
        }
      } else {
        setConversationMsgs([]);
      }
      setEdit({ priority:t.priority||'medium', assignedTo:t.assignedTo||'', department:t.department||'', category:t.category||'', subcategory:t.subcategory||'', tags:Array.isArray(t.tags)?t.tags:[] });
      setContentForm({ subject:t.subject || '', description:t.description || '' });
    } catch(e){ console.error(e); }
    setLoading(false);
  };

  useEffect(() => { if (id) load(); }, [id]);

  useEffect(() => {
    if (activeTab !== 'comment') {
      setPendingFile(null);
      if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    }
  }, [activeTab]);

  useEffect(() => {
    const toRevoke = { ...convMediaUrlsRef.current };
    const toRevokeTicket = { ...ticketReplyAttachUrlsRef.current };
    setConvMediaUrls({});
    setTicketReplyAttachUrls({});
    convMediaInFlightRef.current.clear();
    ticketReplyInflightRef.current.clear();
    Object.values(toRevoke).forEach((u) => URL.revokeObjectURL(u));
    Object.values(toRevokeTicket).forEach((u) => URL.revokeObjectURL(u));
  }, [id]);

  useEffect(() => {
    if (!ticket?.conversationId || conversationMsgs.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const m of conversationMsgs) {
        if (!m?.id) continue;
        if (!(m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio' || m.mediaKind === 'video')) continue;
        if (convMediaUrlsRef.current[m.id] || convMediaInFlightRef.current.has(String(m.id))) continue;
        convMediaInFlightRef.current.add(String(m.id));
        try {
          const blob = await api.getConversationMessageMediaBlob(m.id);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setConvMediaUrls((prev) => {
            if (prev[m.id]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [m.id]: url };
          });
        } catch {
          /* sem ficheiro ou sem permissão */
        } finally {
          convMediaInFlightRef.current.delete(String(m.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationMsgs, ticket?.conversationId]);

  /** Anexos de resposta pública (ticket_reply_file) — GET /tickets/.../reply-attachments/.../media */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      for (const m of messages) {
        const atts = Array.isArray(m?.attachments) ? m.attachments : [];
        for (const a of atts) {
          if (a?.kind !== 'ticket_reply_file' || !a?.id) continue;
          const aid = String(a.id);
          if (ticketReplyAttachUrlsRef.current[aid] || ticketReplyInflightRef.current.has(aid)) continue;
          ticketReplyInflightRef.current.add(aid);
          try {
            const blob = await api.getTicketReplyAttachmentBlob(id, aid);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            setTicketReplyAttachUrls((prev) => {
              if (prev[aid]) {
                URL.revokeObjectURL(url);
                return prev;
              }
              return { ...prev, [aid]: url };
            });
          } catch {
            /* sem ficheiro ou sem permissão */
          } finally {
            ticketReplyInflightRef.current.delete(aid);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages, id]);

  const linkedConvIdRef = useRef<string | null>(null);
  linkedConvIdRef.current = ticket?.conversationId ?? null;

  // ── realtime: fio do ticket (sem duplicar mensagens da conversa vinculada) ──
  useRealtimeTicket(id || null, (msg: any) => {
    if (!msg) return;
    const linked = linkedConvIdRef.current;
    if (linked && msg.conversationId != null && String(msg.conversationId) === String(linked)) {
      return;
    }
    setMessages((prev) => {
      const exists = prev.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return prev.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      if (msg.channel === 'portal' || msg.channel === 'whatsapp') return prev;
      return [...prev, msg];
    });
  });

  // ── realtime: transcrição da conversa (incl. mídia e status WhatsApp) ──
  useRealtimeConversation(ticket?.conversationId ?? null, (msg: any) => {
    if (!msg?.id) return;
    const linked = linkedConvIdRef.current;
    if (!linked || msg.conversationId == null || String(msg.conversationId) !== String(linked)) return;
    setConversationMsgs((prev) => {
      const n = {
        id: msg.id,
        authorId: msg.authorId,
        authorType: msg.authorType,
        authorName: msg.authorName,
        content: msg.content,
        createdAt: msg.createdAt,
        externalId: msg.externalId ?? null,
        whatsappStatus: msg.whatsappStatus ?? null,
        mediaKind: msg.mediaKind ?? null,
        mediaMime: msg.mediaMime ?? null,
        hasMedia: !!(msg.hasMedia ?? msg.mediaKind),
      };
      const exists = prev.some((x: any) => String(x.id) === String(n.id));
      if (exists) {
        return prev.map((x: any) => (String(x.id) === String(n.id) ? { ...x, ...n } : x));
      }
      return [...prev, n].sort(
        (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  });

  const departments = tree?.departments || [];
  const selectedDept = useMemo(() => departments.find((d:any) => d.name===edit.department), [departments, edit.department]);
  const categories = selectedDept?.categories || [];
  const selectedCat = useMemo(() => categories.find((c:any) => c.name===edit.category), [categories, edit.category]);
  const subcategories = selectedCat?.subcategories || [];

  const customerName = (cid:string) => { const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):'—'; };
  const customerObj = (cid:string) => customers.find((c:any)=>c.id===cid);
  const techName = (uid:string) => { const u = team.find((u:any)=>u.id===uid); return u?(u.name||u.email):'—'; };
  const initials = (name:string) => name==='—'?'?':name.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase();
  const contactName = (cid:string) => { const c = contacts.find((c:any)=>c.id===cid); return c?c.name:null; };
  const contactObj = (cid:string) => contacts.find((c:any)=>c.id===cid);

  const startWhatsAppFromTicket = async () => {
    if (!ticket.clientId || !ticket.contactId) return;
    try {
      const res: any = await api.startAgentConversation({ clientId: ticket.clientId, contactId: ticket.contactId, channel: 'whatsapp' });
      router.push('/dashboard/atendimento');
    } catch(e:any) {
      toast.error(e?.response?.data?.message || 'Erro ao iniciar conversa');
    }
  };

  const translateStatus = (text:string) => {
    const map:Record<string,string> = { open:'Aberto', in_progress:'Em Andamento', waiting_client:'Aguardando Cliente', resolved:'Resolvido', closed:'Fechado', cancelled:'Cancelado', low:'Baixa', medium:'Média', high:'Alta', critical:'Crítico' };
    return text.replace(/\b(open|in_progress|waiting_client|resolved|closed|cancelled|low|medium|high|critical)\b/g, m=>map[m]||m);
  };

  const resolveContent = (content:string) => content.replace(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi, (uuid:string) => {
    const member = team.find((u:any)=>u.id===uuid); return member?(member.name||member.email):uuid;
  });

  const saveEdit = async (e:FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.updateTicket(id, { priority:edit.priority, assignedTo:edit.assignedTo||undefined, department:edit.department||undefined, category:edit.category||undefined, subcategory:edit.subcategory||undefined, tags:edit.tags?.length ? edit.tags : undefined });
      toast.success('Ticket atualizado'); await load(); setShowEditPanel(false);
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro ao atualizar'); }
    setSaving(false);
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    const file = pendingFile;
    if (!text && !file) return;
    if (file && activeTab !== 'comment') {
      toast.error('Anexos só na resposta pública.');
      return;
    }
    setSending(true);
    try {
      if (file && activeTab === 'comment') {
        await api.addTicketPublicReplyAttachment(id, { content: text || undefined, file });
      } else {
        await api.addMessage(id, { content: text, messageType: activeTab === 'note' ? 'internal' : 'comment' });
      }
      await load();
      setMessage('');
      setPendingFile(null);
      if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao enviar');
    }
    setSending(false);
  };

  const resolveTicket = () => {
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowCloseModal(true);
  };

  const confirmClose = async () => {
    if (!closeForm.solution.trim()) { toast.error('Solução aplicada é obrigatória'); return; }
    const timeSpentMin = closeForm.timeSpent ? parseInt(closeForm.timeSpent) : 0;
    try {
      await api.resolveTicket(id, {
        resolutionSummary: closeForm.solution,
        timeSpentMin,
        rootCause: closeForm.rootCause || undefined,
        complexity: closeForm.complexity || undefined,
      });
      if (closeForm.internalNote.trim()) {
        await api.addMessage(id, { content: closeForm.internalNote, messageType: 'internal' });
      }
      setShowCloseModal(false);
      router.push('/dashboard/tickets');
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro'); }
  };

  const closeTicket = () => {
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowCloseModal(true);
  };
  const cancelTicket = async () => { const r=window.prompt('Motivo:')||''; if (!window.confirm('Cancelar?')) return; try { await api.cancelTicket(id,{cancelReason:r}); router.push('/dashboard/tickets'); } catch(e:any){ toast.error(e?.response?.data?.message||'Erro'); } };
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [clientHistory, setClientHistory] = useState<any[]>([]);
  const loadClientHistory = async (clientId: string) => {
    try {
      const res: any = await api.getTickets({ clientId, perPage: 6, sort: 'createdAt:desc' });
      const list = Array.isArray(res) ? res : res?.data ?? res?.items ?? [];
      setClientHistory(list.filter((t: any) => t.id !== id));
    } catch {}
  };
  const reopenTicket = () => { setReopenReason(''); setShowReopenModal(true); };

  // ── keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEditPanel(false);
        setShowCloseModal(false);
        setShowReopenModal(false);
        setShowHistory(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const confirmReopen = async () => {
    if (!reopenReason.trim()) { toast.error('Informe o motivo da reabertura'); return; }
    try {
      await api.updateTicket(id, { status:'open' });
      await api.addMessage(id, { content:`Ticket reaberto. Motivo: ${reopenReason}`, messageType:'system' });
      setShowReopenModal(false);
      await load();
    } catch(e:any){ toast.error(e?.response?.data?.message||'Erro'); }
  };

  const saveTicketContent = async (e: FormEvent) => {
    e.preventDefault();
    if (!contentForm.subject.trim()) {
      toast.error('Informe o assunto do ticket');
      return;
    }
    setContentSaving(true);
    try {
      const updated: any = await (api as any).updateTicketContent(id, {
        subject: contentForm.subject.trim(),
        description: contentForm.description.trim() || undefined,
      });
      setTicket((prev: any) => prev ? { ...prev, subject: updated.subject, description: updated.description } : updated);
      setShowContentModal(false);
      toast.success('Assunto e descrição atualizados');
    } catch (e:any) {
      toast.error(e?.response?.data?.message || 'Erro ao atualizar conteúdo do ticket');
    }
    setContentSaving(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-96">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!ticket) return <div className="text-center py-20" style={{color:'#EF4444'}}>Ticket não encontrado</div>;

  const status = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
  const priority = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.medium;
  const isFinished = ['resolved','closed','cancelled'].includes(ticket.status);
  const isWhatsapp = ticket.origin === 'whatsapp';
  const canEditContent = hasPermission(user, 'ticket.edit_content');

  const slaInfo = ticket.slaResolveAt && !isFinished ? (() => {
    const diff = new Date(ticket.slaResolveAt).getTime() - Date.now();
    const total = new Date(ticket.slaResolveAt).getTime() - new Date(ticket.createdAt).getTime();
    const pct = Math.min(100, Math.round(((total-diff)/total)*100));
    const violated = diff < 0;
    const hours = Math.floor(Math.abs(diff)/3600000);
    const mins = Math.floor((Math.abs(diff)%3600000)/60000);
    return { diff, violated, hours, mins, pct };
  })() : null;

  const TIME_OPTIONS = [
    { v:'15', l:'15 minutos' }, { v:'30', l:'30 minutos' }, { v:'45', l:'45 minutos' },
    { v:'60', l:'1 hora' }, { v:'90', l:'1h30' }, { v:'120', l:'2 horas' },
    { v:'180', l:'3 horas' }, { v:'240', l:'4 horas' }, { v:'480', l:'8 horas' },
  ];
  const COMPLEXITY_LABELS = ['','Muito Simples','Simples','Moderado','Complexo','Muito Complexo'];

  const S = {
    bg:'#fff', bg2:'#F8F8FB', bg3:'#F1F1F6',
    bd:'rgba(0,0,0,0.07)', bd2:'rgba(0,0,0,0.12)',
    txt:'#111118', txt2:'#6B6B80', txt3:'#A8A8BE',
    accent:'#4F46E5', accentL:'#EEF2FF', accentM:'#C7D2FE',
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', margin:0, height:'calc(100vh - 44px)', overflow:'hidden', background:S.bg3 }}>

    {showContentModal && (
      <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
        <div style={{ width:'100%', maxWidth:720, background:'#fff', borderRadius:18, boxShadow:'0 24px 60px rgba(15,23,42,0.28)', overflow:'hidden' }}>
          <div style={{ padding:'18px 22px', borderBottom:`1px solid ${S.bd}`, display:'flex', alignItems:'flex-start', gap:14 }}>
            <div style={{ width:40, height:40, borderRadius:12, background:S.accentL, color:S.accent, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Pencil style={{ width:18, height:18 }} />
            </div>
            <div>
              <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:S.txt }}>Editar assunto e descrição</h2>
              <p style={{ margin:'4px 0 0', fontSize:12, color:S.txt2 }}>Essas informações aparecem na abertura do ticket e ajudam a contextualizar a conversa.</p>
            </div>
            <button onClick={() => setShowContentModal(false)} style={{ marginLeft:'auto', border:'none', background:'none', cursor:'pointer', color:S.txt3, padding:4 }}>
              <X style={{ width:18, height:18 }} />
            </button>
          </div>
          <form onSubmit={saveTicketContent}>
            <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Assunto</label>
                <input
                  value={contentForm.subject}
                  onChange={e => setContentForm(f => ({ ...f, subject: e.target.value }))}
                  style={{ ...inp, background:'#fff' }}
                  maxLength={160}
                />
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.06em', display:'block', marginBottom:6 }}>Descrição</label>
                <textarea
                  value={contentForm.description}
                  onChange={e => setContentForm(f => ({ ...f, description: e.target.value }))}
                  rows={6}
                  style={{ ...inp, background:'#fff', minHeight:140, resize:'vertical' as const, lineHeight:1.6 }}
                  maxLength={600}
                />
              </div>
            </div>
            <div style={{ padding:'16px 22px', borderTop:`1px solid ${S.bd}`, display:'flex', justifyContent:'flex-end', gap:10 }}>
              <button type="button" onClick={() => setShowContentModal(false)} style={{ padding:'9px 14px', borderRadius:10, border:`1px solid ${S.bd2}`, background:'#fff', color:S.txt2, cursor:'pointer', fontWeight:600, fontFamily:'inherit' }}>
                Cancelar
              </button>
              <button type="submit" disabled={contentSaving} style={{ padding:'9px 16px', borderRadius:10, border:'none', background:S.accent, color:'#fff', cursor:'pointer', fontWeight:700, fontFamily:'inherit', display:'inline-flex', alignItems:'center', gap:8 }}>
                <Save style={{ width:14, height:14 }} /> {contentSaving ? 'Salvando...' : 'Salvar conteúdo'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Close/Resolve Modal */}
    {showCloseModal && (
      <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
        <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:520, boxShadow:'0 20px 60px rgba(0,0,0,0.3)', overflow:'hidden' }}>
          {/* Modal header */}
          <div style={{ background:'linear-gradient(135deg,#1E293B,#0F172A)', padding:'18px 22px', display:'flex', alignItems:'flex-start', gap:14 }}>
            <div style={{ width:40, height:40, borderRadius:10, background:'#334155', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <CheckCircle2 style={{ width:20, height:20, color:'#94A3B8' }} />
            </div>
            <div>
              <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:'#F1F5F9' }}>Encerrar Atendimento</h2>
              <p style={{ margin:'3px 0 0', fontSize:12, color:'#94A3B8' }}>Preencha as informações. O ticket vinculado também será fechado.</p>
            </div>
            <button onClick={() => setShowCloseModal(false)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#64748B', padding:4 }}>
              <X style={{ width:18, height:18 }} />
            </button>
          </div>

          {/* Ticket info */}
          <div style={{ background:'#1E293B', padding:'10px 22px', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:'#334155', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'#94A3B8', flexShrink:0 }}>
              {initials(customerName(ticket.clientId))}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#6366F1' }}>{ticket.ticketNumber}</span>
                <span style={{ fontSize:12, color:'#CBD5E1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ticket.subject}</span>
              </div>
              <div style={{ fontSize:11, color:'#64748B' }}>{customerName(ticket.clientId)}{ticket.department ? ` · ${ticket.department}` : ''}</div>
            </div>
            <span style={{ background: PRIORITY_CONFIG[ticket.priority]?.bg, color: PRIORITY_CONFIG[ticket.priority]?.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, flexShrink:0 }}>
              {PRIORITY_CONFIG[ticket.priority]?.label}
            </span>
          </div>

          {/* Form body */}
          <div style={{ padding:'18px 22px', display:'flex', flexDirection:'column', gap:14, maxHeight:'60vh', overflowY:'auto' }}>
            {/* Solução Aplicada */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>
                Solução Aplicada <span style={{ color:'#EF4444' }}>OBRIGATÓRIO</span>
              </label>
              <textarea value={closeForm.solution} onChange={e => setCloseForm(f => ({...f, solution: e.target.value}))}
                placeholder="Descreva o que foi feito para resolver..."
                rows={3}
                style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${closeForm.solution.trim() ? '#E2E8F0' : '#EF4444'}`, borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }}
              />
            </div>

            {/* Causa Raiz + Tempo */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Causa Raiz</label>
                <select value={closeForm.rootCause} onChange={e => setCloseForm(f => ({...f, rootCause: e.target.value}))}
                  style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', outline:'none', background:'#fff' }}>
                  <option value="">Selecione...</option>
                  {rootCauseOptions.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Tempo de Atendimento</label>
                <select value={closeForm.timeSpent} onChange={e => setCloseForm(f => ({...f, timeSpent: e.target.value}))}
                  style={{ width:'100%', padding:'8px 10px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', outline:'none', background:'#fff' }}>
                  <option value="">Selecione...</option>
                  {TIME_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
            </div>

            {/* Nota Interna */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:5 }}>Nota Interna</label>
              <textarea value={closeForm.internalNote} onChange={e => setCloseForm(f => ({...f, internalNote: e.target.value}))}
                placeholder="Observações para a equipe..."
                rows={2}
                style={{ width:'100%', padding:'10px 12px', border:'1.5px solid #E2E8F0', borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }}
              />
            </div>

            {/* Complexidade */}
            <div>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.06em', display:'block', marginBottom:8 }}>Complexidade</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button"
                    onClick={() => setCloseForm(f => ({...f, complexity: n}))}
                    style={{ width:44, height:36, borderRadius:8, border:`2px solid ${closeForm.complexity >= n ? '#D97706' : '#E2E8F0'}`, background: closeForm.complexity >= n ? '#FEF3C7' : '#F8FAFC', color: closeForm.complexity >= n ? '#D97706' : '#94A3B8', fontSize:16, fontWeight:700, cursor:'pointer', transition:'all .15s' }}>
                    {closeForm.complexity >= n ? '★' : '☆'}
                  </button>
                ))}
                {closeForm.complexity > 0 && (
                  <span style={{ fontSize:12, color:'#D97706', fontWeight:600, marginLeft:4 }}>{COMPLEXITY_LABELS[closeForm.complexity]}</span>
                )}
              </div>
            </div>

            {/* Warning */}
            <div style={{ background:'#FFF7ED', border:'1.5px solid #FED7AA', borderRadius:8, padding:'10px 14px', display:'flex', gap:10, alignItems:'flex-start' }}>
              <AlertTriangle style={{ width:15, height:15, color:'#EA580C', flexShrink:0, marginTop:1 }} />
              <p style={{ margin:0, fontSize:12, color:'#9A3412', lineHeight:1.5 }}>
                Após encerrar, a conversa e o ticket serão marcados como <strong>Fechado</strong>. Esta ação não pode ser desfeita.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding:'14px 22px', borderTop:'1px solid #F1F5F9', display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={() => setShowCloseModal(false)}
              style={{ padding:'9px 20px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Cancelar
            </button>
            <button onClick={confirmClose}
              style={{ padding:'9px 22px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#1E293B,#0F172A)', color:'#F1F5F9', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
              <CheckCircle2 style={{ width:14, height:14 }} /> Encerrar Atendimento
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Reopen Reason Modal */}
    {showReopenModal && (
      <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
        <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 16px 48px rgba(0,0,0,0.2)', overflow:'hidden' }}>
          <div style={{ padding:'18px 22px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:'#EFF6FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <RefreshCw style={{ width:17, height:17, color:'#2563EB' }} />
              </div>
              <div>
                <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'#0F172A' }}>Reabrir Ticket</h2>
                <p style={{ margin:0, fontSize:12, color:'#94A3B8' }}>Informe o motivo da reabertura</p>
              </div>
            </div>
            <button onClick={() => setShowReopenModal(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#94A3B8' }}>
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
                style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${reopenReason.trim() ? '#E2E8F0' : '#EF4444'}`, borderRadius:8, fontSize:13, color:'#0F172A', resize:'vertical', outline:'none', boxSizing:'border-box' as const }}
              />
            </div>
            <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:8, padding:'9px 12px', display:'flex', gap:8 }}>
              <RefreshCw style={{ width:13, height:13, color:'#2563EB', flexShrink:0, marginTop:1 }} />
              <p style={{ margin:0, fontSize:11, color:'#1D4ED8' }}>O ticket voltará ao status <strong>Aberto</strong> e o motivo será registrado como nota do sistema.</p>
            </div>
          </div>
          <div style={{ padding:'12px 22px', borderTop:'1px solid #F1F5F9', display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={() => setShowReopenModal(false)} style={{ padding:'8px 18px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#fff', color:'#475569', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              Cancelar
            </button>
            <button onClick={confirmReopen} style={{ padding:'8px 18px', borderRadius:8, border:'none', background:'#2563EB', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <RefreshCw style={{ width:13, height:13 }} /> Reabrir Ticket
            </button>
          </div>
        </div>
      </div>
    )}

      {/* Header bar */}
      <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'0 24px', display:'flex', alignItems:'center', gap:12, height:54, flexShrink:0 }}>
        <button onClick={() => router.push('/dashboard/tickets')}
          style={{ width:30, height:30, borderRadius:8, border:`1px solid ${S.bd2}`, background:S.bg2, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <ArrowLeft style={{ width:14, height:14, color:S.txt2 }} />
        </button>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:500, color:S.accent, background:S.accentL, border:`1px solid ${S.accentM}`, borderRadius:7, padding:'4px 10px' }}>
          {ticket.ticketNumber}
        </span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'4px 10px', borderRadius:7, background:status.bg, color:status.color, border:`1px solid ${status.dot}33` }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:status.dot, flexShrink:0 }} />{status.label}
        </span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'4px 10px', borderRadius:7, background:priority.bg, color:priority.color, border:`1px solid ${priority.dot}33` }}>
          {priority.label}
        </span>
        {isWhatsapp && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'4px 10px', borderRadius:7, background:'#DCFCE7', color:'#15803D', border:'1px solid #BBF7D0' }}>
            <PhoneCall style={{ width:13, height:13 }} /> WhatsApp
          </span>
        )}
        {ticket.escalated && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'4px 10px', borderRadius:7, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA' }}>
            <AlertTriangle style={{ width:13, height:13 }} /> Escalado
          </span>
        )}
        <div style={{ flex:1 }} />
        <div style={{ display:'flex', gap:8 }}>
          {(ticket.status==='closed'||ticket.status==='resolved') && (
            <button onClick={reopenTicket}
              style={{ padding:'6px 14px', background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, fontWeight:500, color:S.txt2, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit' }}>
              <RefreshCw style={{ width:13, height:13 }} /> Reabrir ticket
            </button>
          )}
          {!isFinished && (
            <button onClick={resolveTicket}
              style={{ padding:'6px 14px', background:'#10B981', border:'none', borderRadius:8, fontSize:12, fontWeight:600, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit' }}>
              <CheckCircle2 style={{ width:13, height:13 }} /> Resolver
            </button>
          )}
          {ticket.status!=='closed' && ticket.status!=='cancelled' && (
            <button onClick={closeTicket}
              style={{ padding:'6px 12px', background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:8, fontSize:12, fontWeight:500, color:S.txt2, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit' }}>
              <X style={{ width:13, height:13 }} /> Fechar
            </button>
          )}
          {ticket.status!=='cancelled' && ticket.status!=='closed' && (
            <button onClick={cancelTicket}
              style={{ padding:'6px 12px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, fontSize:12, fontWeight:500, color:'#DC2626', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit' }}>
              <XCircle style={{ width:13, height:13 }} /> Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Info card */}
      {!interactionExpanded && (
      <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'14px 24px 18px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, fontSize:11, color:S.txt2 }}>
          <CalendarClock style={{ width:13, height:13, color:S.txt3 }} />
          Abertura: <strong style={{ color:S.txt, fontWeight:500 }}>{format(new Date(ticket.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong>
          {ticket.closedAt && <><span style={{ color:S.txt3 }}>·</span><CalendarCheck style={{ width:13, height:13, color:S.txt3 }} />Fechamento: <strong style={{ color:S.txt, fontWeight:500 }}>{format(new Date(ticket.closedAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong></>}
          {ticket.resolvedAt && !ticket.closedAt && <><span style={{ color:S.txt3 }}>·</span><CalendarCheck style={{ width:13, height:13, color:'#16A34A' }} />Resolução: <strong style={{ color:'#16A34A', fontWeight:500 }}>{format(new Date(ticket.resolvedAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong></>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 0.95fr) minmax(0, 1.35fr)', gap:14 }}>
          <div style={{ padding:'14px 16px', border:`1px solid ${S.bd}`, borderRadius:16, background:'linear-gradient(180deg,#FFFFFF 0%,#FBFBFE 100%)', boxShadow:'0 10px 24px rgba(15,23,42,0.04)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
              <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.08em' }}>Assunto</div>
              {canEditContent && (
                <button onClick={() => setShowContentModal(true)} style={{ border:'none', background:'none', color:S.accent, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700, fontFamily:'inherit', padding:0 }}>
                  <Pencil style={{ width:12, height:12 }} /> Editar
                </button>
              )}
            </div>
            <p style={{ margin:0, fontSize:16, fontWeight:700, color:S.txt, lineHeight:1.4 }}>{ticket.subject}</p>
          </div>
          <div style={{ padding:'14px 16px', border:`1px solid ${S.bd}`, borderRadius:16, background:'linear-gradient(180deg,#FFFFFF 0%,#FBFBFE 100%)', boxShadow:'0 10px 24px rgba(15,23,42,0.04)' }}>
            <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.08em', marginBottom:8 }}>Descricao</div>
            <p style={{ margin:0, fontSize:13, color:S.txt2, lineHeight:1.7 }}>{ticket.description || 'Sem descricao informada.'}</p>
          </div>
        </div>
      </div>
      )}

      {/* Body */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Messages */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', padding:'20px 24px 20px', gap:14, background:S.bg3 }}>
          <div style={{ padding:'10px 20px', borderBottom:`1px solid ${S.bd}`, background:S.bg, display:'flex', alignItems:'center', gap:10, flexShrink:0, justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as any }}>
            <span style={{ fontSize:11, fontWeight:600, color:S.txt3, textTransform:'uppercase' as any, letterSpacing:'0.05em', marginRight:4 }}>Visualizar:</span>
            {([
              { key:'client',  active:showClient,  toggle:()=>setShowClient(v=>!v),  icon:User,        label:'Cliente' },
              { key:'agent',   active:showAgent,   toggle:()=>setShowAgent(v=>!v),   icon:Headphones,  label:'Agente' },
              { key:'updates', active:showUpdates, toggle:()=>setShowUpdates(v=>!v), icon:RefreshCw,   label:'Atualizações' },
              { key:'notes',   active:showNotes,   toggle:()=>setShowNotes(v=>!v),   icon:Lock,        label:'Notas internas' },
              ...(conversationMsgs.length > 0 ? [{ key:'conv', active:showConvFilter, toggle:()=>setShowConvFilter(v=>!v), icon:MessageSquare, label:'Conversa' }] : []),
            ] as any[]).map(({ key, active, toggle, icon:Icon, label }) => (
              <button key={key} onClick={toggle}
                style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:6, border:`1px solid ${active?S.bd2:S.bd}`, background:active?S.bg2:'transparent', fontSize:11, fontWeight:500, color:active?S.txt:S.txt2, cursor:'pointer', fontFamily:'inherit', transition:'all .1s' }}>
                <Icon style={{ width:11, height:11 }} /> {label}
              </button>
            ))}
            </div>
            <button
              onClick={() => setInteractionExpanded(v => !v)}
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:8, border:`1px solid ${interactionExpanded ? S.accentM : S.bd}`, background:interactionExpanded ? S.accentL : '#fff', color:interactionExpanded ? S.accent : S.txt2, cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit', flexShrink:0 }}
            >
              {interactionExpanded ? <ChevronDown style={{ width:12, height:12 }} /> : <ChevronUp style={{ width:12, height:12 }} />}
              {interactionExpanded ? 'Recolher interação' : 'Expandir interação'}
            </button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', background:S.bg2 }}>
            {/* Satisfaction banner */}
            {ticket.status === 'resolved' && ticket.satisfactionScore && (
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderRadius:10, marginBottom:12, background: ticket.satisfactionScore === 'approved' ? '#F0FDF4' : '#FEF2F2', border: `1.5px solid ${ticket.satisfactionScore === 'approved' ? '#86EFAC' : '#FCA5A5'}` }}>
                {ticket.satisfactionScore === 'approved' ? <ThumbsUp style={{ width:16, height:16, color:'#16A34A', flexShrink:0 }} /> : <ThumbsDown style={{ width:16, height:16, color:'#DC2626', flexShrink:0 }} />}
                <p style={{ margin:0, fontSize:12, fontWeight:700, color: ticket.satisfactionScore === 'approved' ? '#15803D' : '#DC2626' }}>
                  Avaliação do cliente: {ticket.satisfactionScore === 'approved' ? 'Solução aceita (SIM)' : 'Solução rejeitada (NÃO)'}
                  {ticket.satisfactionAt && <span style={{ fontWeight:400, color:'#94A3B8', marginLeft:8 }}>{new Date(ticket.satisfactionAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>}
                </p>
              </div>
            )}

            {messages.length === 0 && conversationMsgs.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 0', color:'#94A3B8' }}>
                <MessageSquare style={{ width:36, height:36, margin:'0 auto 12px', opacity:0.3 }} />
                <p style={{ fontSize:14 }}>Nenhuma mensagem ainda</p>
              </div>
            ) : (()=>{
              const isUpdate = (m:any)=>['system','status_change','assignment','escalation'].includes(m.messageType);
              const isClient = (m:any)=>m.authorType==='contact' || m.author_type==='contact';
              const isNote = (m:any)=>m.messageType==='internal';

              const openingContent = (ticket.description || '').trim();
              const allMsgs = messages
                .filter((m:any)=>{
                  if (isNote(m)) return showNotes;
                  if (isUpdate(m)) return showUpdates;
                  if (isClient(m)) return showClient;
                  return showAgent;
                })
                .filter((m:any)=>{
                  const content = resolveContent(m.content || '').trim();
                  if (!openingContent || content !== openingContent) return true;
                  return Boolean(isClient(m));
                })
                .sort((a:any,b:any)=>new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime());

              // Group: each main message + system events that follow it
              type MsgGroup = { main: any; events: any[] };
              const groups: MsgGroup[] = [];
              for (const m of allMsgs) {
                if (isUpdate(m)) {
                  if (groups.length > 0) groups[groups.length-1].events.push(m);
                } else {
                  groups.push({ main: m, events: [] });
                }
              }

              const hasConv = conversationMsgs.length > 0;
              const totalNum = groups.length + (hasConv ? 1 : 0);

              if (groups.length === 0 && !hasConv)
                return (
                  <div style={{ textAlign:'center', padding:'60px 0', color:'#334155' }}>
                    <MessageSquare style={{ width:36, height:36, margin:'0 auto 12px', opacity:0.3 }} />
                    <p style={{ fontSize:14 }}>Nenhuma mensagem com os filtros atuais</p>
                  </div>
                );

              const renderEventRow = (ev: any) => {
                const Icon = ev.messageType==='escalation'?AlertTriangle:ev.messageType==='assignment'?UserCircle:ev.messageType==='sla'?Clock:RefreshCw;
                const iconBg = ev.messageType==='escalation'?'#FEE2E2':ev.messageType==='sla'?'#FFEDD5':'#EEF2FF';
                const iconColor = ev.messageType==='escalation'?'#DC2626':ev.messageType==='sla'?'#F97316':'#6366F1';
                const evTime = new Date(ev.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
                return (
                  <div key={ev.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'0 0 0 22px', position:'relative' }}>
                    <span style={{ position:'absolute', left:3, top:-10, bottom:-10, width:1, background:'rgba(148,163,184,0.18)' }} />
                    <div style={{ width:24, height:24, borderRadius:'50%', background:iconBg, border:'1px solid rgba(255,255,255,0.85)', boxShadow:'0 6px 16px rgba(15,23,42,0.08)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon style={{ width:10, height:10, color:iconColor }} />
                    </div>
                    <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:12, background:'rgba(255,255,255,0.72)', border:'1px solid rgba(148,163,184,0.12)' }}>
                      <span style={{ fontSize:11, color:'#64748B', flex:1, lineHeight:1.5 }}>{translateStatus(resolveContent(ev.content))}</span>
                      <span style={{ fontSize:10, color:'#94A3B8', fontWeight:600, fontFamily:"'DM Mono',monospace", flexShrink:0 }}>{evTime}</span>
                    </div>
                  </div>
                );
              };

              const renderGroup = (group: MsgGroup, num: number) => {
                const m = group.main;
                const isCl = isClient(m);
                const isNt = isNote(m);
                const isWhatsappMsg = m.channel === 'whatsapp';
                const ini = m.authorName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()||'?';
                const timeStr = new Date(m.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});

                const avatarBg = isNt ? '#FFF7ED' : isCl ? '#DCFCE7' : '#EEF2FF';
                const avatarColor = isNt ? '#9A3412' : isCl ? '#166534' : '#4338CA';
                const cardBg = isNt ? '#FFFDF7' : isCl ? '#FFFFFF' : '#FCFCFF';
                const cardBorder = isNt ? '#FED7AA' : isCl ? 'rgba(22,163,74,0.16)' : 'rgba(79,70,229,0.12)';
                const roleLabel = isNt ? 'Nota Interna' : isCl ? 'Cliente' : 'Agente';
                const roleBg = isNt ? '#FFF7ED' : isCl ? '#DCFCE7' : '#EEF2FF';
                const roleColor = isNt ? '#9A3412' : isCl ? '#166534' : '#4338CA';
                const shadow = isNt ? '0 14px 30px rgba(251,146,60,0.08)' : isCl ? '0 18px 36px rgba(15,23,42,0.06)' : '0 18px 36px rgba(79,70,229,0.08)';

                return (
                  <div key={m.id} style={{ display:'flex', gap:14, padding:'0 0 20px', position:'relative' }}>
                    <span style={{ position:'absolute', left:17, top:32, bottom:-8, width:1, background:'linear-gradient(180deg, rgba(148,163,184,0.22) 0%, rgba(148,163,184,0.06) 100%)' }} />
                    <div style={{ width:36, height:36, borderRadius:'50%', background:avatarBg, border:`1px solid ${cardBorder}`, boxShadow:'0 10px 24px rgba(15,23,42,0.08)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:avatarColor, fontSize:11, fontWeight:700, marginTop:4, position:'relative', zIndex:1 }}>
                      {isNt ? <Lock style={{width:12,height:12}}/> : ini}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as const }}>
                            <span style={{ fontSize:13, fontWeight:700, color:S.txt }}>{m.authorName}</span>
                            <span style={{ fontSize:10, fontWeight:700, padding:'4px 8px', borderRadius:999, background:roleBg, color:roleColor, letterSpacing:'0.01em' }}>{roleLabel}</span>
                            {isWhatsappMsg && <span style={{ fontSize:10, fontWeight:700, padding:'4px 8px', borderRadius:999, background:'#DCFCE7', color:'#15803D', letterSpacing:'0.01em' }}>WhatsApp</span>}
                          </div>
                          <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:8, color:S.txt3 }}>
                            <span style={{ fontSize:11 }}>{isNt ? 'Observacao privada da equipe' : isCl ? 'Mensagem recebida do cliente' : 'Interacao da equipe no ticket'}</span>
                          </div>
                        </div>
                        <div style={{ paddingTop:2, textAlign:'right' as const }}>
                          <span style={{ display:'block', fontSize:11, color:S.txt3, fontFamily:"'DM Mono',monospace" }}>{timeStr}</span>
                          <span style={{ display:'block', marginTop:3, fontSize:10, color:'#B4B4C4' }}>#{num}</span>
                        </div>
                      </div>
                      <div style={{ fontSize:13, color:S.txt, lineHeight:1.75, background:cardBg, borderRadius:18, padding:'14px 16px', border:`1px solid ${cardBorder}`, boxShadow:shadow }}>
                        <p style={{ margin:0, whiteSpace:'pre-wrap' }}>{resolveContent(m.content)}</p>
                        {Array.isArray(m.attachments) &&
                          m.attachments.filter((a: any) => a?.kind === 'ticket_reply_file' && a?.id).map((a: any) => {
                            const src = ticketReplyAttachUrls[String(a.id)];
                            const mime = String(a.mime || '').toLowerCase();
                            return (
                              <div key={String(a.id)} style={{ marginTop: 10 }}>
                                {!src && (
                                  <span style={{ fontSize: 11, color: S.txt3 }}>A carregar anexo…</span>
                                )}
                                {src && mime.startsWith('image/') && (
                                  <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, display: 'block', objectFit: 'cover' }} />
                                )}
                                {src && !mime.startsWith('image/') && (
                                  <a
                                    href={src}
                                    target="_blank"
                                    rel="noreferrer"
                                    download={a.filename || 'anexo'}
                                    style={{ fontSize: 12, fontWeight: 600, color: S.accent, textDecoration: 'underline' }}
                                  >
                                    {mime.includes('pdf') ? 'Abrir PDF' : `Download: ${a.filename || 'anexo'}`}
                                  </a>
                                )}
                              </div>
                            );
                          })}
                      </div>
                      {group.events.length > 0 && showUpdates && (
                        <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:8 }}>
                          {group.events.map(ev => renderEventRow(ev))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              };

              // Render groups ASC (oldest first) + conversation in chronological flow
              return (
                <div style={{ position:'relative' }}>
                  <div style={{ position:'absolute', left:17, top:0, bottom:0, width:1, background:'linear-gradient(180deg, rgba(148,163,184,0.16) 0%, rgba(148,163,184,0.04) 100%)', pointerEvents:'none' }} />
                  {groups.map((group, i) => renderGroup(group, i + 1))}
                  {hasConv && showConvFilter && (
                    <div style={{ border:'1px solid rgba(45,212,191,0.28)', borderRadius:22, background:'linear-gradient(180deg, #F7FFFD 0%, #EFFCF8 100%)', boxShadow:'0 20px 45px rgba(13,148,136,0.08)', overflow:'hidden', marginBottom:6, marginLeft:50 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', borderBottom:'1px solid rgba(45,212,191,0.20)' }}>
                        <div style={{ width:36, height:36, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, background:'#CCFBF1', color:'#0D9488', boxShadow:'0 10px 24px rgba(13,148,136,0.12)' }}>
                          <MessageSquare style={{ width:15, height:15 }} />
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'#0F766E' }}>{customerName(ticket.clientId)}</div>
                          <div style={{ fontSize:11, color:'#0F766E', opacity:0.72, marginTop:2 }}>Transcricao da conversa vinculada ao ticket</div>
                        </div>
                        <span style={{ fontSize:10, background:'#CCFBF1', color:'#0F766E', padding:'4px 9px', borderRadius:999, fontWeight:700, display:'inline-flex', alignItems:'center', gap:4 }}>
                          <MessageSquare style={{width:9,height:9}}/> Chat
                        </span>
                        <span style={{ fontSize:11, color:'#94A3B8', marginLeft:'auto', fontFamily:"'DM Mono',monospace" }}>{new Date(ticket.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                        <button onClick={() => setShowConversation(v=>!v)}
                          style={{ display:'flex', alignItems:'center', gap:5, padding:'7px 12px', background:'rgba(255,255,255,0.75)', border:'1px solid #5EEAD4', borderRadius:999, color:'#0F766E', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          {showConversation ? <><ChevronUp style={{width:11,height:11}}/> ESCONDER</> : <><ChevronDown style={{width:11,height:11}}/> CARREGAR MAIS</>}
                        </button>
                        <span style={{ minWidth:28, height:28, borderRadius:10, background:'#FFFFFF', color:'#64748B', border:'1px solid rgba(148,163,184,0.18)', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 6px', flexShrink:0 }}>1</span>
                      </div>
                      {showConversation && (
                        <div style={{ padding:'16px 18px 10px', display:'flex', flexDirection:'column', gap:10 }}>
                          {conversationMsgs.map((cm:any)=>{
                            const isC = cm.authorType==='contact';
                            const t = new Date(cm.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
                            const src = convMediaUrls[cm.id];
                            const hidePh =
                              !!src &&
                              (cm.content === '📷 Imagem' || cm.content === '🎤 Áudio' || cm.content === '📹 Vídeo');
                            const showCap = !!(cm.content && !hidePh);
                            const showMedia =
                              !!(cm.hasMedia || cm.mediaKind === 'image' || cm.mediaKind === 'audio' || cm.mediaKind === 'video') &&
                              (cm.mediaKind === 'image' || cm.mediaKind === 'audio' || cm.mediaKind === 'video');
                            const mediaLoading = showMedia && !src;
                            return (
                              <div key={cm.id} style={{ display:'flex', justifyContent:isC?'flex-start':'flex-end', gap:8, alignItems:'flex-end' }}>
                                {isC && (
                                  <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0, background:'#CCFBF1', display:'flex', alignItems:'center', justifyContent:'center', color:'#0D9488', fontSize:10, fontWeight:700 }}>
                                    {cm.authorName?.charAt(0)?.toUpperCase()||'?'}
                                  </div>
                                )}
                                <div style={{ maxWidth:'72%', padding:'10px 12px', borderRadius:isC?'6px 18px 18px 18px':'18px 6px 18px 18px', background:isC?'rgba(255,255,255,0.88)':'#E0E7FF', border:`1px solid ${isC?'rgba(148,163,184,0.14)':'rgba(99,102,241,0.18)'}`, boxShadow:'0 10px 24px rgba(15,23,42,0.06)', fontSize:12, color:'#0F172A' }}>
                                  <p style={{ margin:'0 0 4px', fontWeight:700, fontSize:10, color:isC?'#475569':'#4338CA' }}>{cm.authorName}</p>
                                  {cm.mediaKind === 'image' && src && (
                                    <img src={src} alt="" style={{ maxWidth:'100%', maxHeight:200, borderRadius:10, display:'block', marginBottom: showCap ? 8 : 0, objectFit:'cover' }} />
                                  )}
                                  {cm.mediaKind === 'audio' && src && (
                                    <audio src={src} controls style={{ width:'100%', maxWidth:240, minHeight:36, marginBottom: showCap ? 8 : 0 }} />
                                  )}
                                  {cm.mediaKind === 'video' && src && (
                                    <video
                                      src={src}
                                      controls
                                      playsInline
                                      style={{
                                        width: '100%',
                                        maxWidth: 280,
                                        maxHeight: 200,
                                        borderRadius: 10,
                                        display: 'block',
                                        marginBottom: showCap ? 8 : 0,
                                        objectFit: 'contain',
                                        background: '#000',
                                      }}
                                    />
                                  )}
                                  {mediaLoading && (
                                    <span style={{ display:'block', fontSize:10, opacity:0.75, marginBottom:6 }}>A carregar…</span>
                                  )}
                                  {showCap && (
                                    <p style={{ margin:0, whiteSpace:'pre-wrap', lineHeight:1.4 }}>{cm.content}</p>
                                  )}
                                  <span style={{ fontSize:9, opacity:0.55, display:'block', textAlign:isC?'left':'right', marginTop:6, fontFamily:"'DM Mono',monospace" }}>{t}</span>
                                </div>
                                {!isC && (
                                  <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0, background:'linear-gradient(135deg,#6366F1,#4F46E5)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:700 }}>
                                    {cm.authorName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()||'?'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ textAlign:'center', padding:'6px 0 2px' }}>
                            <button onClick={() => setShowConversation(false)}
                              style={{ padding:'6px 14px', border:'1px solid #5EEAD4', borderRadius:999, background:'rgba(255,255,255,0.7)', color:'#0F766E', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                              ESCONDER
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Reply box */}
          {(() => {
            const replyTabs: [string,string][] = isFinished
              ? [['note','Nota interna'],['update','Atualização']]
              : [['comment','Resposta pública'],['note','Nota interna'],['update','Atualização']];
            // if current tab became unavailable, auto-switch
            if (isFinished && activeTab === 'comment') {
              setTimeout(() => setActiveTab('note'), 0);
            }
            const visibleReplyTabs = replyTabs.filter(([tab]) => tab !== 'update');
            if (activeTab === 'update') {
              setTimeout(() => setActiveTab(isFinished ? 'note' : 'comment'), 0);
            }
            return (
            <div style={{ background:'linear-gradient(180deg, #FFFFFF 0%, #FBFBFE 100%)', border:`1px solid ${S.bd}`, borderRadius:20, flexShrink:0, overflow:'hidden', boxShadow:'0 20px 45px rgba(15,23,42,0.08)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'14px 16px 0' }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:S.txt }}>Responder no ticket</div>
                  <div style={{ fontSize:11, color:S.txt3, marginTop:4 }}>Mantenha o contexto da conversa e escolha o tipo de interacao abaixo.</div>
                </div>
                <div style={{ fontSize:10, fontWeight:700, color:S.txt3, padding:'5px 9px', borderRadius:999, background:S.bg2, border:`1px solid ${S.bd}` }}>
                  {activeTab === 'note' ? 'Privado' : 'Publico'}
                </div>
              </div>
              <div style={{ display:'flex', gap:8, padding:'14px 16px 0', borderBottom:`1px solid ${S.bd}` }}>
                {(visibleReplyTabs as [string,string][]).map(([tab,label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab as any)}
                    style={{ padding:'10px 14px', fontSize:12, fontWeight:700, cursor:'pointer', color:activeTab===tab?(tab==='note'?'#B45309':S.accent):S.txt2, border:'1px solid', borderColor:activeTab===tab?(tab==='note'?'#FCD34D':S.accentM):'transparent', borderBottomColor:activeTab===tab?(tab==='note'?'#FCD34D':S.accentM):'transparent', marginBottom:-1, background:activeTab===tab?(tab==='note'?'#FFF7ED':'#EEF2FF'):'transparent', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit', borderTopLeftRadius:12, borderTopRightRadius:12, transition:'all .15s' }}>
                    {tab==='note' && <Lock style={{width:12,height:12}}/>}{label}
                  </button>
                ))}
              </div>
              <form onSubmit={sendMessage}>
                <input
                  ref={attachFileInputRef}
                  type="file"
                  accept={TICKET_REPLY_FILE_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.type.startsWith('audio/') || f.type.startsWith('video/')) {
                      toast.error('Anexo do ticket não aceita áudio nem vídeo. Use a conversa vinculada (transcrição) ou o Atendimento para mídia WhatsApp.');
                      e.target.value = '';
                      return;
                    }
                    setPendingFile(f);
                  }}
                />
                <div style={{ padding:'16px' }}>
                  {activeTab === 'comment' && pendingFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 12, color: S.txt2 }}>
                      <Paperclip style={{ width: 14, height: 14, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: S.txt }}>{pendingFile.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingFile(null);
                          if (attachFileInputRef.current) attachFileInputRef.current.value = '';
                        }}
                        style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: 0 }}
                      >
                        remover
                      </button>
                    </div>
                  )}
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
                    placeholder={activeTab==='note'?'Nota interna (visível só para a equipe)...':activeTab==='update'?'Descreva a atualização do ticket...':'Digite sua resposta para o cliente...'}
                    style={{ width:'100%', background:'#FFFFFF', border:`1px solid ${activeTab==='note' ? '#FCD34D' : activeTab==='update' ? '#C7D2FE' : '#E2E8F0'}`, outline:'none', fontSize:13, color:S.txt, fontFamily:'inherit', lineHeight:1.7, resize:'none' as const, boxSizing:'border-box' as const, minHeight:108, borderRadius:18, padding:'14px 16px', boxShadow:activeTab==='note' ? 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(251,146,60,0.08)' : activeTab==='update' ? 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(99,102,241,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(15,23,42,0.05)' }} />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 16px 16px' }}>
                  {[
                    {
                      icon: <Paperclip style={{ width: 14, height: 14 }} />,
                      onClick: () => {
                        if (activeTab !== 'comment') {
                          toast.error('Use a aba «Resposta pública» para anexar ficheiro.');
                          return;
                        }
                        attachFileInputRef.current?.click();
                      },
                    },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg> },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> },
                    { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
                  ].map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={item.onClick}
                      title={i === 0 ? 'Anexar ficheiro ao ticket (imagem, PDF, Office…)' : undefined}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        background: '#FFFFFF',
                        border: `1px solid ${S.bd}`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: S.txt2,
                        boxShadow: '0 6px 16px rgba(15,23,42,0.04)',
                        opacity: i === 0 && activeTab !== 'comment' ? 0.45 : 1,
                      }}
                    >
                      {item.icon}
                    </button>
                  ))}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:S.txt3 }}>
                      {activeTab==='note'
                        ? 'Visivel apenas para a equipe interna.'
                        : activeTab==='update'
                          ? 'Use para registrar uma atualizacao do atendimento.'
                          : 'Resposta pública: texto no histórico do ticket; clip envia anexo (imagem, PDF, Office, ZIP). Imagem, áudio e vídeo MP4 na conversa WhatsApp ficam na secção «Conversa» ou no Atendimento.'}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={sending || (activeTab === 'comment' ? !message.trim() && !pendingFile : !message.trim())}
                    style={{
                      padding:'10px 18px',
                      background:activeTab==='note' ? '#F59E0B' : S.accent,
                      color:'#fff',
                      border:'none',
                      borderRadius:12,
                      fontSize:12,
                      fontWeight:700,
                      cursor:'pointer',
                      fontFamily:'inherit',
                      display:'flex',
                      alignItems:'center',
                      gap:7,
                      opacity: (activeTab === 'comment' ? !message.trim() && !pendingFile : !message.trim()) || sending ? 0.5 : 1,
                      boxShadow:activeTab==='note' ? '0 14px 30px rgba(245,158,11,0.25)' : '0 14px 30px rgba(79,70,229,0.22)',
                      transition:'background .15s',
                    }}
                  >
                    <Send style={{width:13,height:13}}/> {sending?'Enviando...':'Enviar resposta'}
                  </button>
                </div>
              </form>
            </div>
            );
          })()}
        </div>

        {/* Right panel */}
        {(() => {
          const cli = customerObj(ticket.clientId);
          const cont = ticket.contactId ? contactObj(ticket.contactId) : null;
          const hasWa = cont?.whatsapp || cont?.phone;
          const secLabel = (txt: string, action?: React.ReactNode) => (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.07em' }}>{txt}</span>
              {action}
            </div>
          );
          const row = (label: string, value: React.ReactNode) => (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'5px 0', gap:8 }}>
              <span style={{ fontSize:12, color:S.txt2, flexShrink:0 }}>{label}</span>
              <span style={{ fontSize:12, color:S.txt, fontWeight:500, textAlign:'right' as const }}>{value}</span>
            </div>
          );
          // total time
          const totalTime = (() => {
            const start = new Date(ticket.createdAt).getTime();
            const end = ticket.closedAt ? new Date(ticket.closedAt).getTime() : ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : Date.now();
            const diff = end - start;
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            if (d > 0) return `${d} dia${d>1?'s':''}, ${h}h ${m}m`;
            if (h > 0) return `${h}h ${m}m`;
            return `${m}m`;
          })();
          return (
        <div style={{ width:interactionExpanded ? 0 : 280, borderLeft:interactionExpanded ? 'none' : `1px solid ${S.bd}`, overflowY:'auto', flexShrink:0, background:S.bg, display:interactionExpanded ? 'none' : 'flex', flexDirection:'column', transition:'width .2s ease' }}>

          {/* DETALHES */}
          <div style={{ padding:'14px 16px', borderBottom:`1px solid ${S.bd}` }}>
            {secLabel('Detalhes')}
            {row('Status',
              <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'3px 8px', borderRadius:5, background:status.bg, color:status.color }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:status.dot, flexShrink:0 }} />{status.label}
              </span>
            )}
            {row('Prioridade',
              <span style={{ fontSize:12, fontWeight:500, padding:'3px 8px', borderRadius:5, background:priority.bg, color:priority.color }}>{priority.label}</span>
            )}
            {row('Abertura', <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{format(new Date(ticket.createdAt),"dd/MM/yy HH:mm",{locale:ptBR})}</span>)}
            {ticket.resolvedAt && row('Resolução', <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, color:'#16A34A', fontWeight:600 }}>{format(new Date(ticket.resolvedAt),"dd/MM/yy HH:mm",{locale:ptBR})}</span>)}
            {ticket.closedAt && row('Fechamento', <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{format(new Date(ticket.closedAt),"dd/MM/yy HH:mm",{locale:ptBR})}</span>)}
            {row('Tempo total', <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11 }}>{totalTime}</span>)}
            {ticket.satisfactionScore && row('Avaliação',
              <span style={{ fontSize:11, fontWeight:700, color: ticket.satisfactionScore==='approved'?'#16A34A':'#DC2626', display:'flex', alignItems:'center', gap:4 }}>
                {ticket.satisfactionScore==='approved' ? <><ThumbsUp style={{width:11,height:11}}/> SIM</> : <><ThumbsDown style={{width:11,height:11}}/> NÃO</>}
              </span>
            )}
            {ticket.rootCause && row('Causa raiz', <span style={{ fontSize:11 }}>{ticket.rootCause}</span>)}
            {!!ticket.complexity && row('Complexidade', <span style={{ fontSize:11 }}>{COMPLEXITY_LABELS[ticket.complexity] || `${ticket.complexity}/5`}</span>)}
            {/* SLA inline */}
            {slaInfo && (
              <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${S.bd}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                  <span style={{ fontSize:11, color:slaInfo.violated?'#DC2626':'#D97706', fontWeight:700 }}>{slaInfo.violated?'SLA Violado':`${slaInfo.hours}h ${slaInfo.mins}min restantes`}</span>
                </div>
                <div style={{ height:4, background:S.bg3, borderRadius:99, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${slaInfo.pct}%`, background:slaInfo.violated?'#EF4444':slaInfo.pct>80?'#F97316':'#10B981', borderRadius:99 }} />
                </div>
              </div>
            )}
          </div>

          {/* DADOS DO CLIENTE */}
          {ticket.clientId && (
            <div style={{ padding:'14px 16px', borderBottom:`1px solid ${S.bd}` }}>
              {secLabel('Dados do Cliente', <button onClick={() => setShowEditPanel(true)} style={{ fontSize:11, color:S.accent, cursor:'pointer', border:'none', background:'none', fontWeight:500, fontFamily:'inherit', padding:0 }}>Editar</button>)}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <div style={{ width:38, height:38, borderRadius:'50%', background:'#DBEAFE', color:'#1E40AF', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>
                  {initials(customerName(ticket.clientId))}
                </div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:S.txt }}>{customerName(ticket.clientId)}</div>
                  {cli?.cnpj && <div style={{ fontSize:11, color:S.txt2, fontFamily:"'DM Mono',monospace", marginTop:2 }}>{cli.cnpj}</div>}
                </div>
              </div>
              {cont && (
                <div style={{ borderTop:`1px solid ${S.bd}`, paddingTop:10 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.06em', marginBottom:8 }}>Contato</div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', background:'#10B981', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>
                      {initials(cont.name||'?')}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:S.txt }}>{cont.name}</div>
                      {cont.email && <div style={{ fontSize:11, color:S.txt2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cont.email}</div>}
                      {(cont.whatsapp||cont.phone) && <div style={{ fontSize:11, color:S.txt2 }}>{cont.whatsapp||cont.phone}</div>}
                    </div>
                    {hasWa && (
                      <button onClick={startWhatsAppFromTicket} title="Iniciar conversa WhatsApp"
                        style={{ width:28, height:28, borderRadius:'50%', background:'#25D366', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* HISTÓRICO DO CLIENTE */}
          {ticket.clientId && (
            <div style={{ padding:'14px 16px', borderBottom:`1px solid ${S.bd}` }}>
              {secLabel('Histórico do Cliente',
                <a href={`/dashboard/tickets?clientId=${ticket.clientId}`} style={{ fontSize:11, color:S.accent, fontWeight:500, textDecoration:'none' }}>Ver todos</a>
              )}
              {clientHistory.length === 0
                ? <p style={{ fontSize:12, color:S.txt3, margin:0 }}>Nenhum ticket anterior</p>
                : clientHistory.slice(0,5).map((t:any) => {
                    const isOpen = ['open','in_progress','waiting_client'].includes(t.status);
                    const isRes = t.status==='resolved';
                    const dot = isOpen ? S.accent : isRes ? '#10B981' : '#A8A8BE';
                    const diffMs = Date.now() - new Date(t.createdAt).getTime();
                    const diffDays = Math.floor(diffMs / 86400000);
                    const timeLabel = t.id===id ? 'Atual' : diffDays===0 ? 'hoje' : diffDays < 7 ? `${diffDays}d` : `${Math.floor(diffDays/7)} sem`;
                    return (
                      <a key={t.id} href={`/dashboard/tickets/${t.id}`} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom:`1px solid ${S.bd}`, textDecoration:'none' }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background:dot, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:S.txt3, fontFamily:"'DM Mono',monospace" }}>{t.ticketNumber}</div>
                          <div style={{ fontSize:12, color:S.txt, fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.subject}</div>
                        </div>
                        <span style={{ fontSize:10, color:S.txt3, flexShrink:0 }}>{timeLabel}</span>
                      </a>
                    );
                  })
              }
            </div>
          )}

          {/* ATRIBUIÇÃO */}
          <div style={{ padding:'14px 16px' }}>
            {secLabel('Atribuição')}
            <form onSubmit={saveEdit} style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Prioridade</label>
                <select style={inp} value={edit.priority} onChange={e => setEdit({...edit,priority:e.target.value})}>
                  {[['low','Baixa'],['medium','Média'],['high','Alta'],['critical','Crítico']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Técnico</label>
                <select style={inp} value={edit.assignedTo} onChange={e => setEdit({...edit,assignedTo:e.target.value})}>
                  <option value="">Não atribuído</option>
                  {team.map((u:any) => <option key={u.id} value={u.id}>{u.name||u.email}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Departamento</label>
                <select style={inp} value={edit.department} onChange={e => setEdit({...edit,department:e.target.value,category:'',subcategory:''})}>
                  <option value="">Selecione</option>
                  {departments.map((d:any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Categoria</label>
                <select style={inp} value={edit.category} disabled={!edit.department} onChange={e => setEdit({...edit,category:e.target.value,subcategory:''})}>
                  <option value="">Selecione</option>
                  {categories.map((c:any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Subcategoria</label>
                <select style={inp} value={edit.subcategory} disabled={!edit.category} onChange={e => setEdit({...edit,subcategory:e.target.value})}>
                  <option value="">Selecione</option>
                  {subcategories.map((s:any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Tags</label>
                <TagMultiSelect
                  options={availableTags}
                  value={edit.tags}
                  onChange={(tags) => setEdit({ ...edit, tags })}
                  placeholder="Selecione as tags do ticket"
                  emptyText="Nenhuma tag cadastrada"
                />
              </div>
              <button type="submit" disabled={saving}
                style={{ width:'100%', padding:'10px', background:S.accent, color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Save style={{width:14,height:14}} /> {saving?'Salvando...':'Salvar alterações'}
              </button>
            </form>
          </div>
        </div>
          );
        })()}
      </div>
    </div>
  );
}
