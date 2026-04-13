'use client';
import type { CSSProperties } from 'react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useRealtimeTicket, useRealtimeConversation } from '@/lib/realtime';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { ArrowLeft, RotateCw, Tag, Clock, AlertTriangle, Lock, Send, Paperclip, CheckCircle2, XCircle, X, ChevronDown, Save, RefreshCw, User, UserCircle, Headphones, Building2, MessageSquare, PhoneCall, ThumbsUp, ThumbsDown, ChevronUp, Ticket as TicketIcon, CalendarClock, CalendarCheck, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { TagMultiSelect } from '@/components/ui/TagMultiSelect';
import { getTicketPriorityDisplay } from '@/lib/ticket-priority-ui';
import AudioMessagePlayer from '@/components/chat/AudioMessagePlayer';
import { MediaLightbox } from '@/components/chat/InlineChatMedia';

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

/** MIME por vezes vem vazio ou genérico; usa extensão para lightbox (imagem/vídeo). */
function inferTicketReplyMediaKind(mime: string, filename: string): 'image' | 'video' | null {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  const ext = (filename || '').split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(ext)) return 'video';
  return null;
}

/** Resumo da conversa (bloco do ticket): UI compacta por tipo — sem alterar API. */
type ConversationTranscriptMediaUi =
  | { bucket: 'audio' }
  | { bucket: 'image' }
  | { bucket: 'video' }
  | { bucket: 'file'; typeLabel: string; downloadFilename: string };

function extForConversationFileMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'application/pdf' || m === 'application/x-pdf') return 'pdf';
  if (m.includes('wordprocessingml.document')) return 'docx';
  if (m === 'application/msword') return 'doc';
  if (m.includes('spreadsheetml.sheet')) return 'xlsx';
  if (m.includes('ms-excel')) return 'xls';
  if (m === 'text/csv' || m === 'application/csv') return 'csv';
  if (m === 'text/plain') return 'txt';
  return 'bin';
}

function pickConversationDownloadFilename(content: string | null | undefined, ext: string): string {
  const line = String(content || '')
    .trim()
    .split('\n')
    .pop()
    ?.trim();
  if (
    line &&
    line.length <= 200 &&
    /\.[a-z0-9]{2,8}$/i.test(line) &&
    !/[\\/:*?"<>|\r\n]/.test(line)
  ) {
    return line;
  }
  return `anexo.${ext}`;
}

function conversationTranscriptMediaUi(cm: {
  hasMedia?: boolean;
  mediaKind?: string | null;
  mediaMime?: string | null;
  content?: string | null;
}): ConversationTranscriptMediaUi | null {
  const has = !!(cm.hasMedia || cm.mediaKind);
  if (!has) return null;
  const mk = String(cm.mediaKind || '').toLowerCase();
  const mimeRaw = String(cm.mediaMime || '').toLowerCase();
  const mime = mimeRaw.split(';')[0].trim();
  if (mk === 'audio' || mime.startsWith('audio/')) return { bucket: 'audio' };
  if (mk === 'image' || mime.startsWith('image/')) return { bucket: 'image' };
  if (mk === 'video' || mime.startsWith('video/')) return { bucket: 'video' };
  const typeLabel =
    mime === 'application/pdf' || mime === 'application/x-pdf'
      ? 'PDF'
      : mime.includes('wordprocessingml.document') || mime === 'application/msword'
        ? 'Documento'
        : mime.includes('spreadsheetml.sheet') ||
            mime.includes('ms-excel') ||
            mime === 'text/csv' ||
            mime === 'application/csv'
          ? 'Planilha'
          : mime === 'text/plain'
            ? 'Arquivo TXT'
            : 'Arquivo';
  const ext = extForConversationFileMime(mime);
  const downloadFilename = pickConversationDownloadFilename(cm.content, ext);
  return { bucket: 'file', typeLabel, downloadFilename };
}

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
  const [convMediaFailed, setConvMediaFailed] = useState<Record<string, boolean>>({});
  const [ticketReplyAttachUrls, setTicketReplyAttachUrls] = useState<Record<string, string>>({});
  const ticketReplyAttachUrlsRef = useRef<Record<string, string>>({});
  ticketReplyAttachUrlsRef.current = ticketReplyAttachUrls;
  const ticketReplyInflightRef = useRef<Set<string>>(new Set());
  const [ticketReplyAttachFailed, setTicketReplyAttachFailed] = useState<Record<string, boolean>>({});
  const [showConversation, setShowConversation] = useState(false);
  const [showConvFilter, setShowConvFilter] = useState(true);
  /** Mesmo modal do Atendimento: transcrição vinculada e anexos de resposta pública (imagem/vídeo). */
  const [convMediaLightbox, setConvMediaLightbox] = useState<null | { src: string; mediaKind: 'image' | 'video' }>(null);
  const [interactionExpanded, setInteractionExpanded] = useState(false);
  const [tenantPriorities, setTenantPriorities] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>({ priority:'medium', priorityId:'', assignedTo:'', department:'', category:'', subcategory:'', tags:[] as string[] });
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeForm, setCloseForm] = useState({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
  const [showContentModal, setShowContentModal] = useState(false);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentForm, setContentForm] = useState({ subject:'', description:'' });

  const load = async () => {
    setLoading(true);
    try {
      const ticketRes = await api.getTicket(id);
      const t: any = ticketRes;
      const [messageRes, teamRes, treeRes, customersRes, contractsRes, tagsRes, rootCausesRes, tpRes] = await Promise.all([
        api.getMessages(id, true), api.getTeam(),
        api.getTicketSettingsTree(), api.getCustomers({ perPage:200 }), api.getContracts(), api.getTags({ active: true }), api.getRootCauses({ active: true }).catch(() => []),
        api.getTenantPrioritiesForTickets(t?.priorityId || undefined).catch(() => []),
      ]);
      const rawMsgs: any = messageRes;
      const msgs: any[] = Array.isArray(rawMsgs) ? rawMsgs : (rawMsgs?.messages ?? []);
      // Filter out chat channel messages — they belong to the conversation transcript block
      const filteredMsgs = msgs.filter((m: any) =>
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
      const tpl = Array.isArray(tpRes) ? tpRes : (tpRes as any)?.data ?? [];
      setTenantPriorities(tpl);
      const defaultPid = tpl.find((p: any) => p.slug === 'medium')?.id || tpl[0]?.id || '';
      setEdit({
        priority: t.priority || 'medium',
        priorityId: t.priorityId || defaultPid,
        assignedTo: t.assignedTo || '',
        department: t.department || '',
        category: t.category || '',
        subcategory: t.subcategory || '',
        tags: Array.isArray(t.tags) ? t.tags : [],
      });
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
    setConvMediaFailed({});
    setTicketReplyAttachUrls({});
    setTicketReplyAttachFailed({});
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
        const ui = conversationTranscriptMediaUi(m);
        if (ui == null) continue;
        // Imagem/vídeo: sem pré-fetch — abre no lightbox ao clicar (UI compacta).
        if (ui.bucket === 'image' || ui.bucket === 'video') continue;
        const mid = String(m.id);
        if (convMediaUrlsRef.current[mid] || convMediaInFlightRef.current.has(mid)) continue;
        convMediaInFlightRef.current.add(mid);
        try {
          const blob = await api.getConversationMessageMediaBlob(mid);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setConvMediaUrls((prev) => {
            if (prev[mid]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [mid]: url };
          });
          setConvMediaFailed((prev) => {
            const n = { ...prev };
            delete n[mid];
            return n;
          });
        } catch {
          setConvMediaFailed((prev) => ({ ...prev, [mid]: true }));
        } finally {
          convMediaInFlightRef.current.delete(mid);
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
          if (inferTicketReplyMediaKind(String(a.mime || ''), String(a.filename || ''))) continue;
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
            setTicketReplyAttachFailed((prev) => {
              const n = { ...prev };
              delete n[aid];
              return n;
            });
          } catch {
            setTicketReplyAttachFailed((prev) => ({ ...prev, [aid]: true }));
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

  const loadTicketReplyAttachmentUrl = useCallback(
    async (attachmentId: string): Promise<string | null> => {
      const aid = String(attachmentId);
      if (!id) return null;
      const existing = ticketReplyAttachUrlsRef.current[aid];
      if (existing) return existing;
      try {
        const blob = await api.getTicketReplyAttachmentBlob(id, aid);
        const url = URL.createObjectURL(blob);
        setTicketReplyAttachUrls((prev) => ({ ...prev, [aid]: url }));
        setTicketReplyAttachFailed((prev) => {
          const n = { ...prev };
          delete n[aid];
          return n;
        });
        return url;
      } catch {
        toast.error('Não foi possível carregar o anexo.');
        setTicketReplyAttachFailed((prev) => ({ ...prev, [aid]: true }));
        return null;
      }
    },
    [id],
  );

  const openTicketReplyAttachment = useCallback(
    async (attachmentId: string, mediaKind: 'image' | 'video') => {
      const url = await loadTicketReplyAttachmentUrl(attachmentId);
      if (url) setConvMediaLightbox({ src: url, mediaKind });
    },
    [loadTicketReplyAttachmentUrl],
  );

  const loadConversationMessageMediaUrl = useCallback(async (messageId: string | number): Promise<string | null> => {
    const mid = String(messageId);
    const existing = convMediaUrlsRef.current[mid];
    if (existing) return existing;
    try {
      const blob = await api.getConversationMessageMediaBlob(mid);
      const url = URL.createObjectURL(blob);
      setConvMediaUrls((prev) => {
        if (prev[mid]) {
          URL.revokeObjectURL(url);
          return prev;
        }
        return { ...prev, [mid]: url };
      });
      setConvMediaFailed((prev) => {
        const n = { ...prev };
        delete n[mid];
        return n;
      });
      return url;
    } catch {
      toast.error('Não foi possível carregar a mídia.');
      setConvMediaFailed((prev) => ({ ...prev, [mid]: true }));
      return null;
    }
  }, []);

  const openConversationMessageMedia = useCallback(
    async (messageId: string | number, mediaKind: 'image' | 'video') => {
      const url = await loadConversationMessageMediaUrl(messageId);
      if (url) setConvMediaLightbox({ src: url, mediaKind });
    },
    [loadConversationMessageMediaUrl],
  );

  const openConversationFileInTab = useCallback(
    async (messageId: string | number) => {
      const url = await loadConversationMessageMediaUrl(messageId);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },
    [loadConversationMessageMediaUrl],
  );

  const downloadConversationMessageBlob = useCallback(
    async (messageId: string | number, filename: string) => {
      const mid = String(messageId);
      const u = convMediaUrlsRef.current[mid] || (await loadConversationMessageMediaUrl(messageId));
      if (!u) return;
      const a = document.createElement('a');
      a.href = u;
      a.download = filename || 'anexo';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [loadConversationMessageMediaUrl],
  );

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

  const customerName = (cid:string, clientName?:string) => { if (clientName) return clientName; const c = customers.find((c:any)=>c.id===cid); return c?(c.tradeName||c.companyName):'—'; };
  const customerObj = (cid:string, clientName?:string) => customers.find((c:any)=>c.id===cid) ?? (clientName ? { id: cid, tradeName: clientName, companyName: clientName } as any : undefined);
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
      const sel = tenantPriorities.find((p: any) => p.id === edit.priorityId);
      const body: any = {
        assignedTo: edit.assignedTo || undefined,
        department: edit.department || undefined,
        category: edit.category || undefined,
        subcategory: edit.subcategory || undefined,
        tags: edit.tags?.length ? edit.tags : undefined,
      };
      if (tenantPriorities.length > 0) {
        if (edit.priorityId) {
          body.priorityId = edit.priorityId;
          if (sel && ['low', 'medium', 'high', 'critical'].includes(sel.slug)) body.priority = sel.slug;
        }
      } else {
        body.priority = edit.priority;
      }
      await api.updateTicket(id, body);
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
  const priDisp = getTicketPriorityDisplay(ticket);
  const priority = {
    label: priDisp.label,
    bg: priDisp.bg,
    color: priDisp.color,
    dot: (priDisp.slug && PRIORITY_CONFIG[priDisp.slug]?.dot) || priDisp.color,
    inactive: !!priDisp.inactive,
  };
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
              {initials(customerName(ticket.clientId, ticket.clientName))}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:'#6366F1' }}>{ticket.ticketNumber}</span>
                <span style={{ fontSize:12, color:'#CBD5E1', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ticket.subject}</span>
              </div>
              <div style={{ fontSize:11, color:'#64748B' }}>{customerName(ticket.clientId, ticket.clientName)}{ticket.department ? ` · ${ticket.department}` : ''}</div>
            </div>
            <span style={{
              background: priDisp.bg,
              color: priDisp.color,
              padding:'2px 10px',
              borderRadius:20,
              fontSize:11,
              fontWeight:700,
              flexShrink:0,
              ...(priDisp.inactive ? { border: '1px dashed rgba(148,163,184,0.9)', boxSizing: 'border-box' as const } : {}),
            }}>
              {priDisp.label}
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
      <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'0 10px', display:'flex', alignItems:'center', gap:5, minHeight:36, flexShrink:0 }}>
        <button onClick={() => router.push('/dashboard/tickets')}
          style={{ width:28, height:28, borderRadius:7, border:`1px solid ${S.bd2}`, background:S.bg2, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <ArrowLeft style={{ width:13, height:13, color:S.txt2 }} />
        </button>
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, color:S.accent, background:S.accentL, border:`1px solid ${S.accentM}`, borderRadius:6, padding:'3px 8px' }}>
          {ticket.ticketNumber}
        </span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 8px', borderRadius:6, background:status.bg, color:status.color, border:`1px solid ${status.dot}33` }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:status.dot, flexShrink:0 }} />{status.label}
        </span>
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 8px', borderRadius:6, background:priority.bg, color:priority.color, border: priority.inactive ? '1px dashed rgba(148,163,184,0.85)' : `1px solid ${priority.dot}33`, boxSizing:'border-box' as const }}>
          {priority.label}
        </span>
        {isWhatsapp && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 8px', borderRadius:6, background:'#DCFCE7', color:'#15803D', border:'1px solid #BBF7D0' }}>
            <PhoneCall style={{ width:12, height:12 }} /> WhatsApp
          </span>
        )}
        {ticket.escalated && (
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:500, padding:'3px 8px', borderRadius:6, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FECACA' }}>
            <AlertTriangle style={{ width:12, height:12 }} /> Escalado
          </span>
        )}
        <div style={{ flex:1 }} />
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' as const, alignItems:'center' }}>
          {(ticket.status==='closed'||ticket.status==='resolved') && (
            <button onClick={reopenTicket}
              style={{ padding:'5px 11px', background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:7, fontSize:11, fontWeight:500, color:S.txt2, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontFamily:'inherit' }}>
              <RefreshCw style={{ width:12, height:12 }} /> Reabrir ticket
            </button>
          )}
          {!isFinished && (
            <button onClick={resolveTicket}
              style={{ padding:'5px 11px', background:'#10B981', border:'none', borderRadius:7, fontSize:11, fontWeight:600, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontFamily:'inherit' }}>
              <CheckCircle2 style={{ width:12, height:12 }} /> Resolver
            </button>
          )}
          {ticket.status!=='closed' && ticket.status!=='cancelled' && (
            <button onClick={closeTicket}
              style={{ padding:'5px 10px', background:S.bg2, border:`1px solid ${S.bd2}`, borderRadius:7, fontSize:11, fontWeight:500, color:S.txt2, cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontFamily:'inherit' }}>
              <X style={{ width:12, height:12 }} /> Fechar
            </button>
          )}
          {ticket.status!=='cancelled' && ticket.status!=='closed' && (
            <button onClick={cancelTicket}
              style={{ padding:'5px 10px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:7, fontSize:11, fontWeight:500, color:'#DC2626', cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontFamily:'inherit' }}>
              <XCircle style={{ width:12, height:12 }} /> Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Info card */}
      {!interactionExpanded && (
      <div style={{ background:S.bg, borderBottom:`1px solid ${S.bd}`, padding:'4px 12px 5px', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:4, marginBottom:4, fontSize:10, color:S.txt2, flexWrap:'wrap' as const }}>
          <CalendarClock style={{ width:12, height:12, color:S.txt3, flexShrink:0 }} />
          Abertura: <strong style={{ color:S.txt, fontWeight:500 }}>{format(new Date(ticket.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong>
          {ticket.closedAt && <><span style={{ color:S.txt3 }}>·</span><CalendarCheck style={{ width:12, height:12, color:S.txt3, flexShrink:0 }} />Fechamento: <strong style={{ color:S.txt, fontWeight:500 }}>{format(new Date(ticket.closedAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong></>}
          {ticket.resolvedAt && !ticket.closedAt && <><span style={{ color:S.txt3 }}>·</span><CalendarCheck style={{ width:12, height:12, color:'#16A34A', flexShrink:0 }} />Resolução: <strong style={{ color:'#16A34A', fontWeight:500 }}>{format(new Date(ticket.resolvedAt), "dd/MM/yyyy 'às' HH:mm", { locale:ptBR })}</strong></>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0, 0.95fr) minmax(0, 1.35fr)', gap:5 }}>
          <div className="min-w-0" style={{ padding:'5px 8px', border:`1px solid ${S.bd}`, borderRadius:8, background:'linear-gradient(180deg,#FFFFFF 0%,#FBFBFE 100%)', boxShadow:'0 2px 8px rgba(15,23,42,0.04)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:4, marginBottom:2 }}>
              <div style={{ fontSize:9, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.08em' }}>Assunto</div>
              {canEditContent && (
                <button onClick={() => setShowContentModal(true)} style={{ border:'none', background:'none', color:S.accent, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:700, fontFamily:'inherit', padding:0, flexShrink:0 }}>
                  <Pencil style={{ width:11, height:11 }} /> Editar
                </button>
              )}
            </div>
            <p className="truncate" title={String(ticket.subject || '')} style={{ margin:0, fontSize:12, fontWeight:700, color:S.txt, lineHeight:1.25 }}>{ticket.subject}</p>
          </div>
          <div className="min-w-0" style={{ padding:'5px 8px', border:`1px solid ${S.bd}`, borderRadius:8, background:'linear-gradient(180deg,#FFFFFF 0%,#FBFBFE 100%)', boxShadow:'0 2px 8px rgba(15,23,42,0.04)' }}>
            <div style={{ fontSize:9, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.08em', marginBottom:2 }}>Descricao</div>
            <p className="truncate" title={ticket.description?.trim() ? String(ticket.description) : 'Sem descricao informada.'} style={{ margin:0, fontSize:11, color:S.txt2, lineHeight:1.3 }}>{ticket.description || 'Sem descricao informada.'}</p>
          </div>
        </div>
      </div>
      )}

      {/* Body */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Messages */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', padding:'4px 10px 2px', gap:4, background:S.bg3 }}>
          <div style={{ padding:'3px 8px', borderBottom:`1px solid ${S.bd}`, background:S.bg, display:'flex', alignItems:'center', gap:5, flexShrink:0, justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' as any }}>
            <span style={{ fontSize:10, fontWeight:600, color:S.txt3, textTransform:'uppercase' as any, letterSpacing:'0.05em', marginRight:2 }}>Visualizar:</span>
            {([
              { key:'client',  active:showClient,  toggle:()=>setShowClient(v=>!v),  icon:User,        label:'Cliente' },
              { key:'agent',   active:showAgent,   toggle:()=>setShowAgent(v=>!v),   icon:Headphones,  label:'Agente' },
              { key:'updates', active:showUpdates, toggle:()=>setShowUpdates(v=>!v), icon:RefreshCw,   label:'Atualizações' },
              { key:'notes',   active:showNotes,   toggle:()=>setShowNotes(v=>!v),   icon:Lock,        label:'Notas internas' },
              ...(conversationMsgs.length > 0 ? [{ key:'conv', active:showConvFilter, toggle:()=>setShowConvFilter(v=>!v), icon:MessageSquare, label:'Conversa' }] : []),
            ] as any[]).map(({ key, active, toggle, icon:Icon, label }) => (
              <button key={key} onClick={toggle}
                style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:5, border:`1px solid ${active?S.bd2:S.bd}`, background:active?S.bg2:'transparent', fontSize:10, fontWeight:500, color:active?S.txt:S.txt2, cursor:'pointer', fontFamily:'inherit', transition:'all .1s' }}>
                <Icon style={{ width:11, height:11 }} /> {label}
              </button>
            ))}
            </div>
            <button
              onClick={() => setInteractionExpanded(v => !v)}
              style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 8px', borderRadius:6, border:`1px solid ${interactionExpanded ? S.accentM : S.bd}`, background:interactionExpanded ? S.accentL : '#fff', color:interactionExpanded ? S.accent : S.txt2, cursor:'pointer', fontSize:9, fontWeight:700, fontFamily:'inherit', flexShrink:0 }}
            >
              {interactionExpanded ? <ChevronDown style={{ width:12, height:12 }} /> : <ChevronUp style={{ width:12, height:12 }} />}
              {interactionExpanded ? 'Recolher interação' : 'Expandir interação'}
            </button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'3px 8px 6px', background:S.bg2, minHeight:0 }}>
            {/* Satisfaction banner */}
            {ticket.status === 'resolved' && ticket.satisfactionScore && (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 8px', borderRadius:6, marginBottom:4, background: ticket.satisfactionScore === 'approved' ? '#F0FDF4' : '#FEF2F2', border: `1.5px solid ${ticket.satisfactionScore === 'approved' ? '#86EFAC' : '#FCA5A5'}` }}>
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
                  <div key={ev.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'0 0 0 20px', position:'relative' }}>
                    <span style={{ position:'absolute', left:3, top:-8, bottom:-8, width:1, background:'rgba(148,163,184,0.18)' }} />
                    <div style={{ width:22, height:22, borderRadius:'50%', background:iconBg, border:'1px solid rgba(255,255,255,0.85)', boxShadow:'0 4px 10px rgba(15,23,42,0.06)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon style={{ width:9, height:9, color:iconColor }} />
                    </div>
                    <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'center', gap:6, padding:'5px 8px', borderRadius:8, background:'rgba(255,255,255,0.72)', border:'1px solid rgba(148,163,184,0.12)' }}>
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
                const shadow = isNt ? '0 6px 16px rgba(251,146,60,0.06)' : isCl ? '0 6px 16px rgba(15,23,42,0.05)' : '0 6px 16px rgba(79,70,229,0.06)';

                return (
                  <div key={m.id} style={{ display:'flex', gap:10, padding:'0 0 12px', position:'relative' }}>
                    <span style={{ position:'absolute', left:15, top:28, bottom:-6, width:1, background:'linear-gradient(180deg, rgba(148,163,184,0.22) 0%, rgba(148,163,184,0.06) 100%)' }} />
                    <div style={{ width:32, height:32, borderRadius:'50%', background:avatarBg, border:`1px solid ${cardBorder}`, boxShadow:'0 4px 12px rgba(15,23,42,0.06)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:avatarColor, fontSize:10, fontWeight:700, marginTop:2, position:'relative', zIndex:1 }}>
                      {isNt ? <Lock style={{width:11,height:11}}/> : ini}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:8, marginBottom:5 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' as const }}>
                            <span style={{ fontSize:12, fontWeight:700, color:S.txt }}>{m.authorName}</span>
                            <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:999, background:roleBg, color:roleColor, letterSpacing:'0.01em' }}>{roleLabel}</span>
                            {isWhatsappMsg && <span style={{ fontSize:9, fontWeight:700, padding:'2px 6px', borderRadius:999, background:'#DCFCE7', color:'#15803D', letterSpacing:'0.01em' }}>WhatsApp</span>}
                          </div>
                          <div style={{ marginTop:2, display:'flex', alignItems:'center', gap:6, color:S.txt3 }}>
                            <span style={{ fontSize:10 }}>{isNt ? 'Observacao privada da equipe' : isCl ? 'Mensagem recebida do cliente' : 'Interacao da equipe no ticket'}</span>
                          </div>
                        </div>
                        <div style={{ paddingTop:1, textAlign:'right' as const }}>
                          <span style={{ display:'block', fontSize:10, color:S.txt3, fontFamily:"'DM Mono',monospace" }}>{timeStr}</span>
                          <span style={{ display:'block', marginTop:2, fontSize:9, color:'#B4B4C4' }}>#{num}</span>
                        </div>
                      </div>
                      <div style={{ fontSize:12, color:S.txt, lineHeight:1.5, background:cardBg, borderRadius:12, padding:'10px 12px', border:`1px solid ${cardBorder}`, boxShadow:shadow }}>
                        <p style={{ margin:0, whiteSpace:'pre-wrap' }}>{resolveContent(m.content)}</p>
                        {Array.isArray(m.attachments) &&
                          m.attachments.filter((a: any) => a?.kind === 'ticket_reply_file' && a?.id).map((a: any) => {
                            const aid = String(a.id);
                            const src = ticketReplyAttachUrls[aid];
                            const failed = !!ticketReplyAttachFailed[aid];
                            const mime = String(a.mime || '').toLowerCase();
                            const fname = String(a.filename || '');
                            const mediaGuess = inferTicketReplyMediaKind(a.mime || '', fname);
                            return (
                              <div key={aid} style={{ marginTop: 8 }}>
                                {mediaGuess ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
                                      {mediaGuess === 'video' ? 'Vídeo' : 'Imagem'}
                                      {fname ? ` · ${fname}` : ''}
                                    </span>
                                    <span style={{ fontSize: 11, color: '#CBD5E1' }}>—</span>
                                    <button
                                      type="button"
                                      onClick={() => void openTicketReplyAttachment(a.id, mediaGuess)}
                                      style={{
                                        fontSize: 12,
                                        fontWeight: 700,
                                        color: S.accent,
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: 0,
                                        fontFamily: 'inherit',
                                      }}
                                    >
                                      Abrir
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    {!src && !failed && (
                                      <span style={{ fontSize: 11, color: S.txt3 }}>A carregar anexo…</span>
                                    )}
                                    {src && (
                                      <a
                                        href={src}
                                        target="_blank"
                                        rel="noreferrer"
                                        download={fname || 'anexo'}
                                        style={{ fontSize: 12, fontWeight: 600, color: S.accent, textDecoration: 'underline' }}
                                      >
                                        {mime.includes('pdf') ? 'Abrir PDF' : `Download: ${fname || 'anexo'}`}
                                      </a>
                                    )}
                                    {!src && failed && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void (async () => {
                                            const u = await loadTicketReplyAttachmentUrl(a.id);
                                            if (u) window.open(u, '_blank', 'noopener,noreferrer');
                                          })()
                                        }
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 700,
                                          color: S.accent,
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          padding: 0,
                                          fontFamily: 'inherit',
                                          textDecoration: 'underline',
                                        }}
                                      >
                                        Tentar abrir / descarregar
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                      </div>
                      {group.events.length > 0 && showUpdates && (
                        <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:5 }}>
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
                  <div style={{ position:'absolute', left:15, top:0, bottom:0, width:1, background:'linear-gradient(180deg, rgba(148,163,184,0.16) 0%, rgba(148,163,184,0.04) 100%)', pointerEvents:'none' }} />
                  {groups.map((group, i) => renderGroup(group, i + 1))}
                  {hasConv && showConvFilter && (
                    <div style={{ border:'1px solid rgba(45,212,191,0.28)', borderRadius:12, background:'linear-gradient(180deg, #F7FFFD 0%, #EFFCF8 100%)', boxShadow:'0 6px 18px rgba(13,148,136,0.06)', overflow:'hidden', marginBottom:3, marginLeft:44 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as const, padding:'7px 10px', borderBottom:'1px solid rgba(45,212,191,0.20)' }}>
                        <div style={{ width:28, height:28, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, background:'#CCFBF1', color:'#0D9488' }}>
                          <MessageSquare style={{ width:12, height:12 }} />
                        </div>
                        <div style={{ minWidth:0, flex:'1 1 120px' }}>
                          <div style={{ fontSize:12, fontWeight:700, color:'#0F766E', lineHeight:1.25 }}>{customerName(ticket.clientId, ticket.clientName)}</div>
                          <div style={{ fontSize:10, color:'#0F766E', opacity:0.75, marginTop:1, lineHeight:1.3 }}>Transcrição da conversa vinculada ao ticket</div>
                        </div>
                        <span style={{ fontSize:9, background:'#CCFBF1', color:'#0F766E', padding:'3px 8px', borderRadius:999, fontWeight:700, display:'inline-flex', alignItems:'center', gap:3 }}>
                          <MessageSquare style={{width:8,height:8}}/> Chat
                        </span>
                        <span style={{ fontSize:10, color:'#94A3B8', marginLeft:'auto', fontFamily:"'DM Mono',monospace" }}>{new Date(ticket.createdAt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                        <button type="button" onClick={() => setShowConversation(v=>!v)}
                          className="h-7 shrink-0 inline-flex items-center gap-1 px-2.5 rounded-full text-[10px] font-bold cursor-pointer font-inherit border"
                          style={{ background:'rgba(255,255,255,0.85)', borderColor:'#5EEAD4', color:'#0F766E' }}>
                          {showConversation ? <><ChevronUp style={{width:10,height:10}}/> Ocultar</> : <><ChevronDown style={{width:10,height:10}}/> Expandir</>}
                        </button>
                        <span style={{ minWidth:22, height:22, borderRadius:6, background:'#FFFFFF', color:'#64748B', border:'1px solid rgba(148,163,184,0.18)', fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'0 4px', flexShrink:0 }}>1</span>
                      </div>
                      {showConversation && (
                        <div style={{ padding:'8px 10px 6px', display:'flex', flexDirection:'column', gap:0 }}>
                          {conversationMsgs.map((cm:any, cmIdx:number)=>{
                            const isC = cm.authorType==='contact';
                            const tStr = new Date(cm.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
                            const mid = String(cm.id);
                            const src = convMediaUrls[mid];
                            const convFailed = !!convMediaFailed[mid];
                            const convUi = conversationTranscriptMediaUi(cm);
                            const hidePh =
                              (cm.content === '📷 Imagem' && convUi?.bucket === 'image') ||
                              (cm.content === '🎤 Áudio' && convUi?.bucket === 'audio') ||
                              (cm.content === '📹 Vídeo' && convUi?.bucket === 'video');
                            const showCap = !!(cm.content && !hidePh);
                            const bubbleBg = isC
                              ? { background:'#FFFFFF', border:'1px solid #E2E8F0', color:'#1E293B' as const }
                              : { background:'#EDE9FE', border:'1px solid #DDD6FE', color:'#1E293B' as const };
                            const linkColor = isC ? '#0D9488' : '#5B21B6';
                            const nameColor = isC ? '#64748B' : '#6D28D9';
                            const convActBtn: CSSProperties = {
                              fontSize: 12,
                              fontWeight: 700,
                              color: linkColor,
                              textDecoration: 'none',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              fontFamily: 'inherit',
                            };
                            return (
                              <div
                                key={cm.id}
                                style={{
                                  display:'flex',
                                  justifyContent:isC?'flex-start':'flex-end',
                                  gap:6,
                                  alignItems:'flex-end',
                                  marginTop: cmIdx === 0 ? 0 : 6,
                                }}
                              >
                                {isC && (
                                  <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background:'#E2E8F0', display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:9, fontWeight:700 }}>
                                    {cm.authorName?.charAt(0)?.toUpperCase()||'?'}
                                  </div>
                                )}
                                <div
                                  style={{
                                    maxWidth:'min(100%, 480px)',
                                    padding:'6px 10px',
                                    borderRadius:8,
                                    fontSize:13,
                                    lineHeight:1.3,
                                    boxShadow:'none',
                                    ...bubbleBg,
                                  }}
                                >
                                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8, marginBottom:2 }}>
                                    <span style={{ fontWeight:600, fontSize:10, color:nameColor, lineHeight:1.2 }}>{cm.authorName}</span>
                                    <span style={{ fontSize:10, color:'#94A3B8', fontFamily:"'DM Mono',monospace", flexShrink:0 }}>{tStr}</span>
                                  </div>
                                  {convUi?.bucket === 'audio' && !src && !convFailed && (
                                    <span style={{ display:'block', fontSize:11, color:'#64748B', marginBottom:showCap ? 4 : 0 }}>A carregar…</span>
                                  )}
                                  {convUi?.bucket === 'audio' && !src && convFailed && (
                                    <div style={{ marginBottom: showCap ? 4 : 0 }}>
                                      <button
                                        type="button"
                                        onClick={() => void loadConversationMessageMediaUrl(cm.id)}
                                        style={{
                                          fontSize:12,
                                          fontWeight:700,
                                          color:linkColor,
                                          textDecoration:'underline',
                                          background:'none',
                                          border:'none',
                                          cursor:'pointer',
                                          padding:0,
                                          fontFamily:'inherit',
                                        }}
                                      >
                                        Tentar carregar áudio
                                      </button>
                                    </div>
                                  )}
                                  {convUi?.bucket === 'audio' && src && (
                                    <div style={{ width:'100%', maxWidth:260, minWidth:0, marginBottom: showCap ? 4 : 0 }}>
                                      <AudioMessagePlayer src={src} variant={isC ? 'received' : 'sent'} density="compact" />
                                    </div>
                                  )}
                                  {convUi?.bucket === 'image' && (
                                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as const, marginBottom: showCap ? 4 : 0 }}>
                                      <span style={{ fontSize:12, fontWeight:600, color:'#475569' }}>Imagem</span>
                                      <span style={{ fontSize:11, color:'#CBD5E1' }}>—</span>
                                      <button
                                        type="button"
                                        onClick={() => void openConversationMessageMedia(cm.id, 'image')}
                                        style={convActBtn}
                                      >
                                        Abrir
                                      </button>
                                    </div>
                                  )}
                                  {convUi?.bucket === 'video' && (
                                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as const, marginBottom: showCap ? 4 : 0 }}>
                                      <span style={{ fontSize:12, fontWeight:600, color:'#475569' }}>Vídeo</span>
                                      <span style={{ fontSize:11, color:'#CBD5E1' }}>—</span>
                                      <button
                                        type="button"
                                        onClick={() => void openConversationMessageMedia(cm.id, 'video')}
                                        style={convActBtn}
                                      >
                                        Abrir
                                      </button>
                                    </div>
                                  )}
                                  {convUi?.bucket === 'file' && (
                                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' as const, marginBottom: showCap ? 4 : 0 }}>
                                      <span style={{ fontSize:12, fontWeight:600, color:'#475569' }}>{convUi.typeLabel}</span>
                                      <span style={{ fontSize:11, color:'#CBD5E1' }}>—</span>
                                      <button
                                        type="button"
                                        onClick={() => void openConversationFileInTab(cm.id)}
                                        style={convActBtn}
                                      >
                                        Abrir
                                      </button>
                                      <span style={{ fontSize:11, color:'#CBD5E1' }}>•</span>
                                      <button
                                        type="button"
                                        onClick={() => void downloadConversationMessageBlob(cm.id, convUi.downloadFilename)}
                                        style={convActBtn}
                                      >
                                        Baixar
                                      </button>
                                    </div>
                                  )}
                                  {showCap && (
                                    <p style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word' as const }}>{cm.content}</p>
                                  )}
                                </div>
                                {!isC && (
                                  <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background:'linear-gradient(135deg,#6366F1,#4F46E5)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:8, fontWeight:700 }}>
                                    {cm.authorName?.split(' ').map((n:string)=>n[0]).join('').slice(0,2).toUpperCase()||'?'}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ textAlign:'center', padding:'8px 0 2px' }}>
                            <button type="button" onClick={() => setShowConversation(false)}
                              className="h-8 px-3 rounded-full text-[11px] font-bold cursor-pointer font-inherit border"
                              style={{ borderColor:'#5EEAD4', background:'rgba(255,255,255,0.75)', color:'#0F766E' }}>
                              Ocultar transcrição
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
            <div className="p-2 pb-0" style={{ background:'linear-gradient(180deg, #FFFFFF 0%, #FBFBFE 100%)', border:`1px solid ${S.bd}`, borderRadius:14, flexShrink:0, overflow:'hidden', boxShadow:'0 8px 24px rgba(15,23,42,0.06)' }}>
              <div className="flex items-center justify-between gap-2 pb-1">
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:S.txt }}>Responder no ticket</div>
                  <div className="mt-0.5" style={{ fontSize:9, color:S.txt3, lineHeight:1.3 }}>Mantenha o contexto da conversa e escolha o tipo de interacao abaixo.</div>
                </div>
                <div style={{ fontSize:9, fontWeight:700, color:S.txt3, padding:'3px 7px', borderRadius:999, background:S.bg2, border:`1px solid ${S.bd}` }}>
                  {activeTab === 'note' ? 'Privado' : 'Publico'}
                </div>
              </div>
              <div className="flex items-end gap-1 pb-0 -mx-2 px-2" style={{ borderBottom:`1px solid ${S.bd}` }}>
                {(visibleReplyTabs as [string,string][]).map(([tab,label]) => (
                  <button key={tab} onClick={() => setActiveTab(tab as any)}
                    className="h-7 px-2.5 text-[11px] rounded-md font-bold cursor-pointer flex items-center gap-1 font-inherit border transition-all duration-150 -mb-px"
                    style={{ color:activeTab===tab?(tab==='note'?'#B45309':S.accent):S.txt2, borderColor:activeTab===tab?(tab==='note'?'#FCD34D':S.accentM):'transparent', borderBottomColor:activeTab===tab?(tab==='note'?'#FCD34D':S.accentM):'transparent', background:activeTab===tab?(tab==='note'?'#FFF7ED':'#EEF2FF'):'transparent' }}>
                    {tab==='note' && <Lock className="h-3 w-3 shrink-0" />}{label}
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
                <div className="pt-1.5 pb-1.5">
                  {activeTab === 'comment' && pendingFile && (
                    <div className="mb-1.5 flex items-center gap-2 text-[11px]" style={{ color: S.txt2 }}>
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
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
                  <textarea value={message} onChange={e => setMessage(e.target.value)}
                    placeholder={activeTab==='note'?'Nota interna (visível só para a equipe)...':activeTab==='update'?'Descreva a atualização do ticket...':'Digite sua resposta para o cliente...'}
                    className="min-h-[52px] max-h-[140px] w-full resize-none overflow-y-auto rounded-lg border box-border px-2.5 py-1.5 text-[12px] leading-snug outline-none"
                    style={{ background:'#FFFFFF', borderColor:activeTab==='note' ? '#FCD34D' : activeTab==='update' ? '#C7D2FE' : '#E2E8F0', borderWidth:1, borderStyle:'solid', color:S.txt, fontFamily:'inherit', boxShadow:activeTab==='note' ? 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(251,146,60,0.08)' : activeTab==='update' ? 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(99,102,241,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 24px rgba(15,23,42,0.05)' }} />
                </div>
                <div className="flex items-center gap-1.5 pb-2 pt-0.5">
                  {[
                    {
                      icon: <Paperclip style={{ width: 12, height: 12 }} />,
                      onClick: () => {
                        if (activeTab !== 'comment') {
                          toast.error('Use a aba «Resposta pública» para anexar ficheiro.');
                          return;
                        }
                        attachFileInputRef.current?.click();
                      },
                    },
                    { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg> },
                    { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> },
                    { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
                  ].map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={item.onClick}
                      title={i === 0 ? 'Anexar ficheiro ao ticket (imagem, PDF, Office…)' : undefined}
                      className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border bg-white cursor-pointer shadow-sm"
                      style={{
                        borderColor: S.bd,
                        color: S.txt2,
                        boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
                        opacity: i === 0 && activeTab !== 'comment' ? 0.45 : 1,
                      }}
                    >
                      {item.icon}
                    </button>
                  ))}
                  <div className="min-w-0 flex-1 pl-0.5">
                    <div className="text-[10px] leading-tight" style={{ color:S.txt3 }}>
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
                    className="h-8 shrink-0 px-3 text-xs font-bold flex items-center gap-1 rounded-md border-none cursor-pointer text-white font-inherit"
                    style={{
                      background:activeTab==='note' ? '#F59E0B' : S.accent,
                      opacity: (activeTab === 'comment' ? !message.trim() && !pendingFile : !message.trim()) || sending ? 0.5 : 1,
                      boxShadow:activeTab==='note' ? '0 4px 14px rgba(245,158,11,0.2)' : '0 4px 14px rgba(79,70,229,0.18)',
                      transition:'background .15s',
                    }}
                  >
                    <Send className="h-3.5 w-3.5 shrink-0" /> {sending?'Enviando...':'Enviar resposta'}
                  </button>
                </div>
              </form>
            </div>
            );
          })()}
        </div>

        {/* Right panel */}
        {(() => {
          const cli = customerObj(ticket.clientId, ticket.clientName);
          const cont = ticket.contactId ? contactObj(ticket.contactId) : null;
          const hasWa = cont?.whatsapp || cont?.phone;
          const secLabel = (txt: string, action?: React.ReactNode) => (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6, paddingBottom:4, borderBottom:`1px solid ${S.bd}` }}>
              <span style={{ fontSize:9, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.07em' }}>{txt}</span>
              {action}
            </div>
          );
          const row = (label: string, value: React.ReactNode) => (
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'2px 0', gap:6 }}>
              <span style={{ fontSize:10, color:S.txt2, flexShrink:0 }}>{label}</span>
              <span className="min-w-0 flex-1 text-right" style={{ fontSize:10, color:S.txt, fontWeight:500 }}>{value}</span>
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
        <div className="[html[data-theme=dark]_&]:bg-slate-900" style={{ width:interactionExpanded ? 0 : 272, borderLeft:interactionExpanded ? 'none' : `1px solid ${S.bd}`, overflowY:'auto', flexShrink:0, background:S.bg, display:interactionExpanded ? 'none' : 'flex', flexDirection:'column', transition:'width .2s ease', padding:'6px 8px 8px', gap:6 }}>

          {/* DETALHES */}
          <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] [html[data-theme=dark]_&]:bg-slate-900 [html[data-theme=dark]_&]:shadow-none [html[data-theme=dark]_&]:ring-1 [html[data-theme=dark]_&]:ring-slate-700/50" style={{ padding:'8px 10px', border:`1px solid ${S.bd}`, borderRadius:10 }}>
            {secLabel('Detalhes')}
            {row('Status',
              <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, fontWeight:500, padding:'3px 8px', borderRadius:5, background:status.bg, color:status.color }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:status.dot, flexShrink:0 }} />{status.label}
              </span>
            )}
            {row('Prioridade',
              <span style={{ fontSize:12, fontWeight:500, padding:'3px 8px', borderRadius:5, background:priority.bg, color:priority.color, ...(priority.inactive ? { border: '1px dashed rgba(148,163,184,0.85)', boxSizing: 'border-box' as const } : {}) }}>{priority.label}</span>
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
            {ticket.rootCause && row('Causa raiz', <span className="line-clamp-2 text-right" title={String(ticket.rootCause)} style={{ fontSize:11 }}>{ticket.rootCause}</span>)}
            {!!ticket.complexity && row('Complexidade', <span style={{ fontSize:11 }}>{COMPLEXITY_LABELS[ticket.complexity] || `${ticket.complexity}/5`}</span>)}
            {/* SLA inline */}
            {slaInfo && (
              <div style={{ marginTop:6, paddingTop:6, borderTop:`1px solid ${S.bd}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
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
            <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] [html[data-theme=dark]_&]:bg-slate-900 [html[data-theme=dark]_&]:shadow-none [html[data-theme=dark]_&]:ring-1 [html[data-theme=dark]_&]:ring-slate-700/50" style={{ padding:'8px 10px', border:`1px solid ${S.bd}`, borderRadius:10 }}>
              {secLabel('Dados do Cliente', <button onClick={() => setShowEditPanel(true)} style={{ fontSize:10, color:S.accent, cursor:'pointer', border:'none', background:'none', fontWeight:500, fontFamily:'inherit', padding:0 }}>Editar</button>)}
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background:'#DBEAFE', color:'#1E40AF', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>
                  {initials(customerName(ticket.clientId, ticket.clientName))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" title={customerName(ticket.clientId, ticket.clientName)} style={{ fontSize:12, color:S.txt }}>{customerName(ticket.clientId, ticket.clientName)}</div>
                  {cli?.cnpj && <div style={{ fontSize:11, color:S.txt2, fontFamily:"'DM Mono',monospace", marginTop:2 }}>{cli.cnpj}</div>}
                </div>
              </div>
              {cont && (
                <div style={{ borderTop:`1px solid ${S.bd}`, paddingTop:8 }}>
                  <div style={{ fontSize:10, fontWeight:700, color:S.txt3, textTransform:'uppercase' as const, letterSpacing:'0.06em', marginBottom:6 }}>Contato</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
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
            <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] [html[data-theme=dark]_&]:bg-slate-900 [html[data-theme=dark]_&]:shadow-none [html[data-theme=dark]_&]:ring-1 [html[data-theme=dark]_&]:ring-slate-700/50" style={{ padding:'8px 10px', border:`1px solid ${S.bd}`, borderRadius:10 }}>
              {secLabel('Histórico do Cliente',
                <button type="button" onClick={() => router.push(`/dashboard/tickets?clientId=${ticket.clientId}`)} style={{ fontSize:11, color:S.accent, fontWeight:500, textDecoration:'none', background:'none', border:'none', padding:0, cursor:'pointer' }}>Ver todos</button>
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
                      <button type="button" key={t.id} onClick={() => router.push(`/dashboard/tickets/${t.id}`)} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 0', borderBottom:`1px solid ${S.bd}`, textDecoration:'none', width:'100%', textAlign:'left' as const, background:'none', borderLeft:'none', borderRight:'none', borderTop:'none', cursor:'pointer' }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background:dot, flexShrink:0 }} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, color:S.txt3, fontFamily:"'DM Mono',monospace" }}>{t.ticketNumber}</div>
                          <div className="truncate" title={String(t.subject || '')} style={{ fontSize:11, color:S.txt, fontWeight:500 }}>{t.subject}</div>
                        </div>
                        <span style={{ fontSize:10, color:S.txt3, flexShrink:0 }}>{timeLabel}</span>
                      </button>
                    );
                  })
              }
            </div>
          )}

          {/* ATRIBUIÇÃO */}
          <div className="rounded-xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] [html[data-theme=dark]_&]:bg-slate-900 [html[data-theme=dark]_&]:shadow-none [html[data-theme=dark]_&]:ring-1 [html[data-theme=dark]_&]:ring-slate-700/50" style={{ padding:'8px 10px', border:`1px solid ${S.bd}`, borderRadius:10 }}>
            {secLabel('Atribuição')}
            <form onSubmit={saveEdit} style={{ display:'flex', flexDirection:'column', gap:6 }}>
              <div>
                <label style={{ fontSize:10, color:S.txt3, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' as const, display:'block', marginBottom:4 }}>Prioridade</label>
                {tenantPriorities.length > 0 ? (
                  <select
                    style={inp}
                    value={edit.priorityId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const p = tenantPriorities.find((x: any) => x.id === pid);
                      setEdit({
                        ...edit,
                        priorityId: pid,
                        priority:
                          p && ['low', 'medium', 'high', 'critical'].includes(p.slug) ? p.slug : edit.priority,
                      });
                    }}
                  >
                    {tenantPriorities.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.active === false ? ' (inativa)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select style={inp} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                    {[['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['critical', 'Crítico']].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
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
                style={{ width:'100%', padding:'9px 10px', background:S.accent, color:'#fff', border:'none', borderRadius:10, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                <Save style={{width:14,height:14}} /> {saving?'Salvando...':'Salvar alterações'}
              </button>
            </form>
          </div>
        </div>
          );
        })()}
      </div>

      <MediaLightbox
        open={!!convMediaLightbox}
        onClose={() => setConvMediaLightbox(null)}
        src={convMediaLightbox?.src ?? ''}
        mediaKind={convMediaLightbox?.mediaKind ?? 'image'}
      />
    </div>
  );
}
