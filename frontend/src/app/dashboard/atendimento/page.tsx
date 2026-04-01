'use client';
import { useEffect, useLayoutEffect, useState, useCallback, useRef, memo, type ReactNode } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useRealtimeConversation, useRealtimeTicket, useRealtimeTenantNewMessages, useRealtimeConversationClosed, useRealtimeTicketAssigned, useRealtimeContactTyping, emitTypingPresence, subscribeContactPresence } from '@/lib/realtime';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import {
  MessageSquare, Send, Phone, RefreshCw, Lock, ExternalLink, Plus, Link2, Globe,
  Check, Search, X, CheckCircle2, User, Mail, MapPin, Building2, Hash, Tag,
} from 'lucide-react';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import ContactValidationBanner, { type ResolvedData } from '@/components/atendimento/ContactValidationBanner';
import { TagMultiSelect } from '@/components/ui/TagMultiSelect';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Formata número de WhatsApp para exibição: remove prefixo 55 e aplica máscara BR */
function formatWhatsApp(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  // LID: identificador interno do WhatsApp (14+ dígitos) — não é número de telefone real
  if (digits.length >= 14) return '';
  // Brasil: remove prefixo 55 e formata com DDI
  if (digits.startsWith('55') && digits.length >= 12) {
    const local = digits.slice(2);
    if (local.length === 11) return `+55 (${local.slice(0,2)}) ${local.slice(2,3)} ${local.slice(3,7)}-${local.slice(7)}`;
    if (local.length === 10) return `+55 (${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  }
  // Número local BR sem DDI (10-11 dígitos)
  if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,3)} ${digits.slice(3,7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
  // Outro: retorna com + se parece internacional
  return digits.length > 11 ? `+${digits}` : digits;
}

function timeAgo(date: string | Date) {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const dy = Math.floor(h / 24);
  if (dy > 0) return `${dy}d`;
  if (h > 0) return `${h}h`;
  return m < 1 ? 'agora' : `${m}min`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name: string) {
  const COLORS = ['#16A34A','#2563EB','#EA580C','#7C3AED','#E11D48','#0891B2','#4F46E5','#B45309'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

// ── sub-components ────────────────────────────────────────────────────────────
function ChannelDot({ channel }: { channel: string }) {
  const isWa = channel === 'whatsapp';
  return (
    <span style={{
      position: 'absolute', bottom: -2, right: -2,
      width: 15, height: 15, borderRadius: '50%',
      background: isWa ? '#25D366' : '#4F46E5',
      border: '2px solid #fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {isWa
        ? <svg width="8" height="8" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        : <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2 2"/></svg>
      }
    </span>
  );
}

// ── MessageStatusIcon ─────────────────────────────────────────────────────────
/** Ícone de status de mensagem estilo WhatsApp */
function MessageStatusIcon({ status, isWhatsapp }: { status?: string | null; isWhatsapp?: boolean }) {
  // Canal não-WhatsApp: check simples
  if (!isWhatsapp) return <CheckCircle2 size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
  // Pendente / enviando (otimista)
  if (!status || status === 'pending' || status === 'sending' || status === 'queued') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    );
  }
  // Erro
  if (status === 'failed' || status === 'error') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    );
  }
  // Enviado (✓ cinza)
  if (status === 'sent') {
    return <Check size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
  }
  // Entregue (✓✓ cinza)
  if (status === 'delivered') {
    return (
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,.5)', letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>
    );
  }
  // Lido (✓✓ azul)
  if (status === 'read') {
    return (
      <span style={{ fontSize: 10, color: '#93C5FD', letterSpacing: '-2px', lineHeight: 1 }}>✓✓</span>
    );
  }
  return <Check size={11} style={{ color: 'rgba(255,255,255,.5)' }} />;
}

// ── MessageSkeleton ───────────────────────────────────────────────────────────
/** Placeholder animado enquanto carrega mensagens pela primeira vez */
function MessageSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 0' }}>
      {([false, true, false] as boolean[]).map((right, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexDirection: right ? 'row-reverse' : 'row' }}>
          <div className="animate-pulse" style={{ width: 30, height: 30, borderRadius: '50%', background: '#E2E8F0', flexShrink: 0 }} />
          <div className="animate-pulse" style={{ width: `${38 + i * 12}%`, height: 56, borderRadius: 12, background: '#E2E8F0' }} />
        </div>
      ))}
    </div>
  );
}

// ── HighlightText ─────────────────────────────────────────────────────────────
/** Destaca ocorrências de `query` dentro de `text` com fundo amarelo */
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} style={{ background: '#FEF08A', color: '#0F172A', borderRadius: 2, padding: '0 2px' }}>{part}</mark>
          : part,
      )}
    </>
  );
}

// ── MessageItem (memoizado) ───────────────────────────────────────────────────
/** Item individual de mensagem — memoizado para evitar re-render ao digitar */
const MessageItem = memo(function MessageItem({
  m,
  isWhatsapp,
  highlight,
  mediaUrl,
}: {
  m: any;
  isWhatsapp: boolean;
  highlight?: string;
  mediaUrl?: string | null;
}) {
  const isContact = m.authorType === 'contact';
  const isSystem  = m.messageType === 'system';
  const t = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const col = avatarColor(m.authorName || '?');
  const localPreview = m._localPreviewUrl as string | undefined;
  const resolvedMediaSrc = mediaUrl || localPreview || null;
  const showMedia =
    (m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio') &&
    (m.mediaKind === 'image' || m.mediaKind === 'audio');
  const mediaLoading =
    showMedia && !resolvedMediaSrc && !m._optimistic;
  const hidePlaceholderCaption =
    !!resolvedMediaSrc && (m.content === '📷 Imagem' || m.content === '🎤 Áudio');
  const showCaption = !!(m.content && !hidePlaceholderCaption);

  // Constantes de estilo (idênticas ao S da tela pai)
  const accent = '#4F46E5';
  const accentLight = '#EEF2FF';
  const bg = '#FFFFFF';
  const txt = '#111118';
  const txt2 = '#6B6B80';
  const txt3 = '#A8A8BE';

  if (isSystem) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '5px 14px', fontSize: 11, color: '#4338CA', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4338CA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/></svg>
          {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: isContact ? 'flex-start' : 'flex-end' }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: txt2, paddingLeft: isContact ? 40 : 0, paddingRight: isContact ? 0 : 40 }}>
        {m.authorName}
      </span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexDirection: isContact ? 'row' : 'row-reverse' }}>
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: isContact ? col : accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isContact ? '#fff' : accent, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
          {initials(m.authorName || '?')}
        </div>
        <div style={{
          maxWidth: 420, padding: '11px 16px', fontSize: 13, lineHeight: 1.6, position: 'relative',
          background: isContact ? bg : accent,
          color: isContact ? txt : '#fff',
          border: isContact ? '1px solid rgba(0,0,0,.09)' : 'none',
          borderRadius: isContact ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
          boxShadow: isContact ? '0 1px 3px rgba(0,0,0,.06)' : '0 2px 8px rgba(79,70,229,.25)',
          opacity: m._optimistic ? 0.75 : 1,
          transition: 'opacity 0.2s',
        }}>
          {m.mediaKind === 'image' && resolvedMediaSrc && (
            <img
              src={resolvedMediaSrc}
              alt=""
              style={{
                maxWidth: '100%',
                maxHeight: 280,
                borderRadius: 12,
                display: 'block',
                marginBottom: showCaption ? 8 : 0,
                objectFit: 'cover',
              }}
            />
          )}
          {m.mediaKind === 'audio' && resolvedMediaSrc && (
            <audio
              src={resolvedMediaSrc}
              controls
              style={{
                width: '100%',
                maxWidth: 280,
                minHeight: 40,
                marginBottom: showCaption ? 8 : 0,
              }}
            />
          )}
          {mediaLoading && (
            <p style={{ margin: '0 0 8px', fontSize: 12, opacity: 0.85 }}>A carregar…</p>
          )}
          {showCaption && (
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {highlight ? <HighlightText text={m.content || ''} query={highlight} /> : m.content}
            </p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
            <span style={{ fontSize: 10, color: isContact ? txt3 : 'rgba(255,255,255,.6)' }}>{t}</span>
            {!isContact && <MessageStatusIcon status={m.whatsappStatus} isWhatsapp={isWhatsapp} />}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── main component ────────────────────────────────────────────────────────────
export default function AtendimentoPage() {
  const { user } = useAuthStore();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [rootCauseOptions, setRootCauseOptions] = useState<string[]>([]);
  const [conversationTags, setConversationTags] = useState<string[]>([]);
  const [savingConversationTags, setSavingConversationTags] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'no_ticket' | 'linked' | 'closed'>(() => {
    try { return (localStorage.getItem('atend_filter') as any) || 'all'; } catch { return 'all'; }
  });
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp'>(() => {
    try {
      const saved = localStorage.getItem('atend_channel');
      return saved === 'whatsapp' ? 'whatsapp' : 'all';
    } catch { return 'all'; }
  });
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement>(null);
  const [messageMediaUrls, setMessageMediaUrls] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkTicketSearch, setLinkTicketSearch] = useState('');
  const [linkTickets, setLinkTickets] = useState<any[]>([]);
  const [linkSelectedId, setLinkSelectedId] = useState<string | null>(null);
  const [linkReason, setLinkReason] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ subject:'', description:'', priority:'medium', department:'', category:'', subcategory:'', assignedTo:'', networkId:'', clientId:'' });
  const [createLoading, setCreateLoading] = useState(false);
  const [ticketSettingsTree, setTicketSettingsTree] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [startMode, setStartMode] = useState<'contact' | 'phone'>('contact');
  const [startClientId, setStartClientId] = useState('');
  const [startClientName, setStartClientName] = useState('');
  const [startContactId, setStartContactId] = useState('');
  const [startContacts, setStartContacts] = useState<any[]>([]);
  const [startContactSearch, setStartContactSearch] = useState('');
  const [startingConv, setStartingConv] = useState(false);
  const [loadingStartContacts, setLoadingStartContacts] = useState(false);
  // Modo "Por número"
  const [startPhone, setStartPhone] = useState('');
  const [startPhoneChecking, setStartPhoneChecking] = useState(false);
  const [startPhoneResult, setStartPhoneResult] = useState<{ exists: boolean; jid: string | null; normalized: string } | null>(null);
  // Mensagem inicial (ambos os modos)
  const [startFirstMessage, setStartFirstMessage] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [createCustomers, setCreateCustomers] = useState<any[]>([]);
  const [createClientSearch, setCreateClientSearch] = useState('');
  const [createClientName, setCreateClientName] = useState('');
  const [createClientResults, setCreateClientResults] = useState<any[]>([]);
  const [createClientLoading, setCreateClientLoading] = useState(false);
  const [showCreateClientDropdown, setShowCreateClientDropdown] = useState(false);
  const createClientSearchTimer = useRef<any>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showKeepOpenModal, setShowKeepOpenModal] = useState(false);
  const [keepOpenReason, setKeepOpenReason] = useState('');
  const [showCloseForm, setShowCloseForm] = useState(false);
  const COMPLEXITY_LABELS: Record<number,string> = { 1:'Muito simples', 2:'Simples', 3:'Moderado', 4:'Complexo', 5:'Muito complexo' };
  const [closeForm, setCloseForm] = useState({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const [clientTickets, setClientTickets] = useState<any[]>([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);

  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [hasMoreMsgs, setHasMoreMsgs] = useState(false);
  const [loadingMoreMsgs, setLoadingMoreMsgs] = useState(false);
  const [isContactTyping, setIsContactTyping] = useState(false);
  const contactTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentIsTypingRef = useRef(false);
  // ── busca dentro da conversa ──
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [msgSearchIdx, setMsgSearchIdx] = useState(0);
  const msgSearchInputRef = useRef<HTMLInputElement>(null);

  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const selectedRef = useRef<any>(null);
  selectedRef.current = selected;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageMediaUrlsRef = useRef<Record<string, string>>({});
  messageMediaUrlsRef.current = messageMediaUrls;
  const mediaInFlightRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // true = usuário está perto do fim da lista

  // ── paginação de mensagens ──
  const hasMoreMsgsRef = useRef(false);      // espelho de hasMoreMsgs para uso em callbacks
  const loadingMoreMsgsRef = useRef(false);  // espelho de loadingMoreMsgs para uso em callbacks
  const oldestMsgIdRef = useRef<string | null>(null); // cursor: ID da mensagem mais antiga carregada
  const prevScrollHeightRef = useRef(0);     // scrollHeight antes de prepend (para restaurar posição)
  const shouldRestoreScrollRef = useRef(false);
  hasMoreMsgsRef.current = hasMoreMsgs;
  loadingMoreMsgsRef.current = loadingMoreMsgs;

  // ── cache de dados estáveis + guard de race condition ──
  const loadIdRef = useRef(0);          // incrementado a cada loadChat; respostas velhas são descartadas
  const customersRef = useRef<any[]>([]); // cache de clientes — não rebusca a cada troca de conversa
  const teamRef = useRef<any[]>([]);      // cache de equipe — idem
  const customersCachedAtRef = useRef<number>(0);      // timestamp do último fetch completo de customers
  const teamCachedAtRef = useRef<number>(0);           // timestamp do último fetch completo de team
  // cache de contatos por clientId → evita refetch a cada troca de contato
  const contactsCacheRef = useRef<Record<string, { data: any[]; ts: number }>>({});
  // cache de contato individual por contactId (convs sem clientId)
  const singleContactCacheRef = useRef<Record<string, { data: any; ts: number }>>({});
  const PHASE2_CACHE_TTL = 2 * 60 * 1000; // 2 minutos

  // ── helpers ──
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    atBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = nearBottom;
    if (nearBottom) setShowScrollBtn(false);
    // Próximo do topo → carrega mensagens mais antigas
    if (el.scrollTop < 80 && hasMoreMsgsRef.current && !loadingMoreMsgsRef.current) {
      loadMoreMsgsRef.current();
    }
  }, []);

  // Carrega mensagens mais antigas (scroll para cima). Preserva posição de scroll via useLayoutEffect.
  const loadMoreMsgsRef = useRef<() => void>(() => {});
  const loadMoreMessages = useCallback(async () => {
    const conv = selectedRef.current;
    if (!conv || !oldestMsgIdRef.current || loadingMoreMsgsRef.current || !hasMoreMsgsRef.current) return;
    const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
    if (isTicket) return; // tickets carregam tudo de uma vez
    setLoadingMoreMsgs(true);
    loadingMoreMsgsRef.current = true;
    try {
      const paged: any = await api.getConversationMessages(conv.id, {
        limit: 50,
        before: oldestMsgIdRef.current,
      });
      const older: any[] = paged?.messages ?? [];
      if (older.length > 0) {
        const el = scrollContainerRef.current;
        if (el) prevScrollHeightRef.current = el.scrollHeight;
        shouldRestoreScrollRef.current = true;
        oldestMsgIdRef.current = older[0]?.id ?? oldestMsgIdRef.current;
        setMessages((m) => [...older, ...m]);
      }
      setHasMoreMsgs(paged?.hasMore === true);
    } catch {}
    setLoadingMoreMsgs(false);
    loadingMoreMsgsRef.current = false;
  }, []);
  loadMoreMsgsRef.current = loadMoreMessages;

  // Restaura posição de scroll após prepend de mensagens antigas (sem pular)
  useLayoutEffect(() => {
    if (shouldRestoreScrollRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTop = el.scrollTop + (el.scrollHeight - prevScrollHeightRef.current);
      shouldRestoreScrollRef.current = false;
    }
  });

  const sameItem = (a: any, b: any) => {
    if (!a || !b) return false;
    if (String(a.id) === String(b.id)) return true;
    if (a.ticketId && b.ticketId && String(a.ticketId) === String(b.ticketId)) return true;
    return false;
  };

  const customerName = (cid: string) => {
    const c = customers.find((x: any) => x.id === cid);
    return c ? (c.tradeName || c.companyName) : '—';
  };

  const contactName = (cid: string) => {
    const c = contacts.find((x: any) => x.id === cid);
    return c?.name || '—';
  };

  const canEditConversationTags = hasPermission(user, 'ticket.edit');
  const canManageCustomerLink = hasPermission(user, 'customer.edit');
  const canCloseTicket = hasPermission(user, 'ticket.close');
  const [customerLinkRequired, setCustomerLinkRequired] = useState(false);

  useEffect(() => {
    setCustomerLinkRequired(false);
  }, [currentTicket?.id]);

  // ── data loading ──
  const loadConversations = useCallback(async (resetSelection = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (channelFilter !== 'all') params.channel = channelFilter;
      if (filter === 'no_ticket') { params.hasTicket = 'no'; params.status = 'active'; }
      else if (filter === 'linked') { params.hasTicket = 'yes'; params.status = 'active'; }
      else if (filter === 'closed') { params.status = 'closed'; params.hasTicket = 'all'; }
      else { params.status = 'active'; params.hasTicket = 'all'; }
      const [convList, ticketConvList] = await Promise.all([
        api.getConversations(params),
        (channelFilter === 'whatsapp' || channelFilter === 'all')
          ? api.getTicketConversations({ origin: 'whatsapp', status: filter === 'closed' ? 'closed' : 'active', perPage: 50 }).catch(() => [] as any)
          : Promise.resolve([]),
      ]);
      const convArr = (Array.isArray(convList) ? convList : convList?.data ?? []).filter((c: any) => c?.channel !== 'portal');
      const ticketArr = Array.isArray(ticketConvList) ? ticketConvList : ticketConvList?.data ?? [];
      const sorted = [...convArr.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ticketArr]
        .sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
      // Deduplica por contactId — 1 chat ativo por contato (mantém o mais recente)
      const seenContacts = new Set<string>();
      const merged = sorted.filter((c: any) => {
        if (!c.contactId) return true;
        if (seenContacts.has(c.contactId)) return false;
        seenContacts.add(c.contactId);
        return true;
      });
      setConversations(merged);
      const currentSelected = selectedRef.current;
      if (resetSelection) {
        setSelected(merged.length ? merged[0] : null);
      } else if (!currentSelected) {
        setSelected(merged.length ? merged[0] : null);
      } else {
        const found = merged.find((c: any) => sameItem(c, currentSelected));
        // Mantém seleção atual se ainda existe; só atualiza o objeto (dados frescos)
        if (found) setSelected(found);
        // else: conversa não encontrada na lista (filtro mudou) → não força primeiro item
      }
    } catch (e) { console.error(e); setConversations([]); }
    setLoading(false);
  }, [filter, channelFilter]);

  const loadChat = async (conv: any) => {
    if (!conv) return;
    const myId = ++loadIdRef.current; // guard de race condition
    setLoadingChat(true);
    setCurrentTicket(null);
    setConversationTags(Array.isArray(conv?.tags) ? conv.tags : []);
    atBottomRef.current = true; // sempre vai para o fim ao trocar de conversa
    setShowScrollBtn(false);
    setHasMoreMsgs(false);
    oldestMsgIdRef.current = null;
    // Limpa estado de "digitando..." ao trocar de conversa
    setIsContactTyping(false);
    if (contactTypingTimeoutRef.current) { clearTimeout(contactTypingTimeoutRef.current); contactTypingTimeoutRef.current = null; }
    // Cancela "agente digitando" pendente
    if (agentIsTypingRef.current && conv?.channel === 'whatsapp') {
      agentIsTypingRef.current = false;
    }
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      const tid = ticketId || conv.ticketId;

      // ── FASE 1: essencial — ticket + mensagens em paralelo ──────────────
      // Spinner some assim que estes dois chegarem (~150ms vs ~700ms antes)
      const [ticketRes, msgsRaw] = await Promise.all([
        tid ? api.getTicket(tid).catch(() => null) : Promise.resolve(null),
        isTicket && ticketId
          ? api.getMessages(ticketId, false).catch(() => [])
          : api.getConversationMessages(conv.id, { limit: 50 }).catch(() => ({ messages: [], hasMore: false })),
      ]);

      if (myId !== loadIdRef.current) return; // conversa já mudou, descarta

      if (ticketRes) setCurrentTicket(ticketRes);
      // Conversa: resposta paginada { messages, hasMore }; ticket: array direto
      if (isTicket) {
        const arr = Array.isArray(msgsRaw) ? msgsRaw : (msgsRaw as any)?.data ?? [];
        setMessages(arr);
        setHasMoreMsgs(false);
        oldestMsgIdRef.current = arr[0]?.id ?? null;
      } else {
        const paged = msgsRaw as any;
        const arr: any[] = paged?.messages ?? (Array.isArray(paged) ? paged : []);
        setMessages(arr);
        setHasMoreMsgs(paged?.hasMore === true);
        oldestMsgIdRef.current = arr[0]?.id ?? null;
      }
      setLoadingChat(false); // ← conteúdo visível aqui; fase 2 roda em background

      // Envia read receipts para mensagens do contato via Baileys (best-effort, não bloqueia)
      if (!isTicket && conv.channel === 'whatsapp' && conv.id) {
        api.markConversationRead(conv.id).catch(() => {});
      }

      // ── FASE 2: dados de suporte — sem bloquear a UI ─────────────────────
      const clientId = conv.clientId;
      const contactId = conv.contactId || (ticketRes as any)?.contactId;
      const now = Date.now();

      const needCustomers = customersRef.current.length === 0 || (now - customersCachedAtRef.current) > PHASE2_CACHE_TTL;
      const needTeam = teamRef.current.length === 0 || (now - teamCachedAtRef.current) > PHASE2_CACHE_TTL;

      // Verifica cache de contatos — evita refetch a cada troca de contato
      const cachedClientContacts = clientId ? contactsCacheRef.current[clientId] : null;
      const cachedSingleContact = (!clientId && contactId) ? singleContactCacheRef.current[contactId] : null;
      const needContacts = clientId
        ? !cachedClientContacts || (now - cachedClientContacts.ts) > PHASE2_CACHE_TTL
        : (!clientId && contactId)
          ? !cachedSingleContact || (now - cachedSingleContact.ts) > PHASE2_CACHE_TTL
          : false;

      // Customers + team + contacts todos em paralelo (somente o que não está cacheado)
      const [customersRes, teamRes, contactsRaw] = await Promise.all([
        needCustomers ? api.getCustomers({ perPage: 200 }).catch(() => null) : Promise.resolve(null),
        needTeam ? api.getTeam().catch(() => null) : Promise.resolve(null),
        needContacts
          ? (clientId
              ? api.getContacts(clientId).catch(() => null)
              : contactId ? api.getContactById(contactId).catch(() => null) : Promise.resolve(null))
          : Promise.resolve(null),
      ]);

      if (myId !== loadIdRef.current) return;

      // Customers — atualiza cache e estado
      if (customersRes) {
        const arr: any[] = customersRes?.data || customersRes || [];
        // Cliente desta conversa fora da lista paginada → busca individual
        if (clientId && !arr.find((c: any) => c.id === clientId)) {
          try { const r: any = await api.getCustomer(clientId); if (r) arr.push(r?.data ?? r); } catch {}
        }
        customersRef.current = arr;
        customersCachedAtRef.current = now;
        if (myId === loadIdRef.current) setCustomers(arr);
      } else if (clientId && !customersRef.current.find((c: any) => c.id === clientId)) {
        // Cache existente mas sem este cliente específico → busca individual
        try {
          const r: any = await api.getCustomer(clientId);
          if (r && myId === loadIdRef.current) {
            const arr = [...customersRef.current, r?.data ?? r];
            customersRef.current = arr;
            setCustomers(arr);
          }
        } catch {}
      }

      // Team — atualiza cache e estado
      if (teamRes) {
        let arr: any[] = Array.isArray(teamRes) ? teamRes : teamRes?.data ?? [];
        teamRef.current = arr;
        teamCachedAtRef.current = now;
        if (myId === loadIdRef.current) setTeam(arr);
      }
      // Garante que o agente responsável pelo ticket esteja na lista
      if (ticketRes?.assignedTo) {
        const cur = teamRef.current;
        if (!cur.find((u: any) => String(u.id) === String(ticketRes.assignedTo))) {
          try {
            const m: any = await api.getTeamMember(ticketRes.assignedTo);
            const member = m?.data ?? m;
            if (member?.id && myId === loadIdRef.current) {
              const arr = [...teamRef.current, member];
              teamRef.current = arr;
              teamCachedAtRef.current = now;
              setTeam(arr);
            }
          } catch {}
        }
      }

      if (myId !== loadIdRef.current) return;

      // Contacts — usa cache quando disponível, evita refetch a cada troca
      if (clientId) {
        let ctArr: any[];
        if (contactsRaw) {
          // Dados frescos da API — popula cache
          ctArr = Array.isArray(contactsRaw) ? contactsRaw : (contactsRaw as any)?.data ?? [];
          // Contato específico fora da lista do cliente → busca individual (com cache)
          if (contactId && !ctArr.find((c: any) => c.id === contactId)) {
            const cachedInd = singleContactCacheRef.current[contactId];
            if (cachedInd && (now - cachedInd.ts) < PHASE2_CACHE_TTL) {
              ctArr = [...ctArr, cachedInd.data];
            } else {
              try {
                const ind: any = await api.getContactById(contactId);
                if (ind) {
                  const ct = ind?.data ?? ind;
                  singleContactCacheRef.current[contactId] = { data: ct, ts: now };
                  ctArr = [...ctArr, ct];
                }
              } catch {}
            }
          }
          contactsCacheRef.current[clientId] = { data: ctArr, ts: now };
        } else {
          // Cache válido — reutiliza sem nenhuma requisição
          ctArr = cachedClientContacts?.data ?? [];
        }
        if (myId === loadIdRef.current) {
          setContacts(ctArr);
          // Assina presença do contato WhatsApp para receber "digitando..."
          if (conv.channel === 'whatsapp') {
            const phone = ctArr.find((c: any) => c.whatsapp)?.whatsapp;
            if (phone && user?.tenantId) {
              const digits = phone.replace(/\D/g, '');
              const jid = digits.length >= 14 ? `${digits}@lid` : `${digits}@s.whatsapp.net`;
              subscribeContactPresence(jid, user.tenantId);
            }
          }
        }
      } else if (!clientId && contactId) {
        let ct: any;
        if (contactsRaw) {
          // Dados frescos da API — popula cache
          ct = (contactsRaw as any)?.data ?? contactsRaw;
          if (ct) singleContactCacheRef.current[contactId] = { data: ct, ts: now };
        } else if (cachedSingleContact) {
          // Cache válido — reutiliza
          ct = cachedSingleContact.data;
        } else {
          ct = null;
        }
        if (myId === loadIdRef.current) setContacts(ct ? [ct] : []);
      }

    } catch (e) {
      console.error(e);
      if (myId === loadIdRef.current) setLoadingChat(false);
    }
  };

  const reloadMessages = async (conv: any) => {
    if (!conv) return;
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      if (isTicket && ticketId) {
        const msgs = await api.getMessages(ticketId, false).catch(() => []);
        const arr = Array.isArray(msgs) ? msgs : (msgs as any)?.data ?? [];
        setMessages(arr);
        setHasMoreMsgs(false);
        oldestMsgIdRef.current = arr[0]?.id ?? null;
      } else {
        const paged: any = await api.getConversationMessages(conv.id, { limit: 50 }).catch(() => ({ messages: [], hasMore: false }));
        const arr: any[] = paged?.messages ?? (Array.isArray(paged) ? paged : []);
        setMessages(arr);
        setHasMoreMsgs(paged?.hasMore === true);
        oldestMsgIdRef.current = arr[0]?.id ?? null;
      }
    } catch {}
  };

  const searchTicketsForLink = useCallback(async () => {
    const clientId = selected?.clientId;
    const contactId = selected?.contactId;
    try {
      const params: any = { perPage: 100 };
      if (linkTicketSearch?.trim()) params.search = linkTicketSearch.trim();
      if (clientId) params.clientId = clientId;
      else if (contactId) params.contactId = contactId;
      const res: any = await api.getTickets(params);
      const inner = res?.data ?? res;
      const data = Array.isArray(inner) ? inner : inner?.data ?? [];
      setLinkTickets(data);
    } catch { setLinkTickets([]); }
  }, [selected?.clientId, selected?.contactId, linkTicketSearch]);

  // ── end flow ──
  const openEndFlow = () => {
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowEndModal(true);
  };
  const handleKeepOpen = () => { setShowEndModal(false); setKeepOpenReason(''); setShowKeepOpenModal(true); };
  const handleCloseTicket = () => {
    if (customerLinkRequired) {
      showToast(
        canManageCustomerLink
          ? 'Defina a empresa deste atendimento antes de encerrar o ticket.'
          : 'Este atendimento ainda precisa de uma empresa vinculada antes do encerramento.',
        'error',
      );
      return;
    }
    setShowEndModal(false);
    setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 });
    setShowCloseForm(true);
  };

  const confirmKeepOpen = async () => {
    if (!keepOpenReason.trim()) { showToast('Informe o motivo para manter o ticket aberto', 'error'); return; }
    try {
      const isTicket = selected?.type === 'ticket' || selected?.id?.startsWith?.('ticket:');
      const tid = isTicket ? (selected.ticketId || selected.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
      if (isTicket && tid) {
        await api.addMessage(tid, { content: `Atendimento encerrado. Ticket mantido em aberto. Motivo: ${keepOpenReason}`, messageType: 'system' });
      } else if (selected?.id && !isTicket) {
        await api.closeConversation(selected.id, { keepTicketOpen: true });
        if (tid) await api.addMessage(tid, { content: `Conversa encerrada. Ticket mantido em aberto. Motivo: ${keepOpenReason}`, messageType: 'system' });
      }
      setShowKeepOpenModal(false);
      setKeepOpenReason('');
      showToast('Atendimento encerrado. Ticket mantido aberto.');
      loadConversations(true, true);
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao encerrar', 'error'); }
  };

  const isTicketType = selected?.type === 'ticket' || selected?.id?.startsWith?.('ticket:');

  const confirmCloseTicket = async () => {
    if (customerLinkRequired) {
      showToast(
        canManageCustomerLink
          ? 'Defina a empresa deste atendimento antes de encerrar o ticket.'
          : 'Este atendimento ainda precisa de uma empresa vinculada antes do encerramento.',
        'error',
      );
      return;
    }
    if (!closeForm.solution.trim()) { showToast('Solução aplicada é obrigatória', 'error'); return; }
    const tid = selected?.ticketId || (isTicketType ? selected?.id?.replace?.(/^ticket:/, '') : null);
    try {
      const timeSpentMin = closeForm.timeSpent ? parseInt(closeForm.timeSpent) : 0;
      if (!isTicketType && selected?.id) {
        await api.closeConversation(selected.id, { keepTicketOpen: false, solution: closeForm.solution, rootCause: closeForm.rootCause || undefined, timeSpentMin: timeSpentMin || undefined, internalNote: closeForm.internalNote?.trim() || undefined, complexity: closeForm.complexity || undefined });
      } else if (tid) {
        await api.resolveTicket(tid, { resolutionSummary: closeForm.solution, timeSpentMin, rootCause: closeForm.rootCause || undefined, complexity: closeForm.complexity || undefined });
        if (closeForm.internalNote.trim()) await api.addMessage(tid, { content: closeForm.internalNote, messageType: 'internal' });
        // Ticket permanece como "Resolvido" — cliente tem 7 dias para confirmar no portal
      } else { showToast('Ticket não encontrado', 'error'); return; }
      setShowCloseForm(false);
      showToast('Chamado marcado como resolvido! O cliente será notificado para confirmar.');
      loadConversations(true, true);
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao encerrar', 'error'); }
  };

  // ── assign agent ──
  // ── transfer ──
  const openTransferModal = async () => {
    if (team.length === 0) { try { const r: any = await api.getTeam(); setTeam(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    setTransferAgentId('');
    setShowTransferModal(true);
  };

  const confirmTransfer = async () => {
    const tid = isTicketType ? (selected?.ticketId || selected?.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
    if (!tid || !transferAgentId) { showToast('Selecione um agente', 'error'); return; }
    setTransferLoading(true);
    try {
      await api.assignTicket(tid, transferAgentId);
      const agent = team.find((u: any) => u.id === transferAgentId);
      await api.addMessage(tid, { content: `Atendimento transferido para ${agent?.name || agent?.email || 'outro agente'}.`, messageType: 'system' }).catch(() => {});
      setCurrentTicket((t: any) => ({ ...t, assignedTo: transferAgentId }));
      setShowTransferModal(false);
      showToast('Atendimento transferido!');
      await reloadMessages(selected);
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao transferir', 'error'); }
    setTransferLoading(false);
  };

  // ── start conversation ──
  const openStartModal = () => {
    setStartMode('contact');
    setStartClientId(''); setStartClientName(''); setStartContactId(''); setStartContacts([]); setStartContactSearch('');
    setStartPhone(''); setStartPhoneResult(null); setStartPhoneChecking(false);
    setStartFirstMessage('');
    if (customers.length === 0) api.getCustomers({ perPage: 200 }).then((r: any) => setCustomers(r?.data || r || [])).catch(() => {});
    setShowStartModal(true);
  };

  const handleStartClientChange = async (clientId: string, clientName: string) => {
    setStartClientId(clientId); setStartClientName(clientName); setStartContactId(''); setStartContactSearch('');
    if (!clientId) { setStartContacts([]); return; }
    setLoadingStartContacts(true);
    try {
      const r: any = await api.getContacts(clientId);
      const list = Array.isArray(r) ? r : r?.data ?? [];
      setStartContacts(list.filter((c: any) => c.whatsapp?.trim() || c.phone?.trim()));
    } catch { setStartContacts([]); }
    setLoadingStartContacts(false);
  };

  const handleCheckPhone = async () => {
    if (!startPhone.trim()) return;
    setStartPhoneChecking(true);
    setStartPhoneResult(null);
    try {
      const r: any = await api.checkWhatsappNumber(startPhone.trim());
      const d = r?.data ?? r;
      setStartPhoneResult({ exists: d.exists, jid: d.jid, normalized: d.normalized });
    } catch { setStartPhoneResult({ exists: false, jid: null, normalized: startPhone }); }
    setStartPhoneChecking(false);
  };

  // Após criar conversa (qualquer modo), recarrega lista e seleciona
  const afterConvCreated = async (conv: any) => {
    setShowStartModal(false); setFilter('all'); setChannelFilter('all');
    const [cl, tc] = await Promise.all([
      api.getConversations({ status: 'active', hasTicket: 'all' }),
      api.getTicketConversations({ status: 'active', perPage: 50 }).catch(() => []),
    ]);
    const ca = Array.isArray(cl) ? cl : (cl as any)?.data ?? [];
    const ta = Array.isArray(tc) ? tc : (tc as any)?.data ?? [];
    const merged = [...ca.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ta]
      .sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
    setConversations(merged);
    setSelected(merged.find((c: any) => sameItem(c, conv)) || conv || null);
  };

  // ── create ticket ──
  const handleCreateTicket = async () => {
    if (!selected?.id) return;
    if (team.length === 0) { try { const r: any = await api.getTeam(); setTeam(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    if (ticketSettingsTree.length === 0) {
      try {
        const r: any = await api.getTicketSettingsTree();
        const depts = Array.isArray(r) ? r : r?.departments ?? r?.data?.departments ?? [];
        setTicketSettingsTree(depts);
      } catch {}
    }
    if (networks.length === 0) { try { const r: any = await api.getNetworks(); setNetworks(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
    const contactN = selected.contactName || messages.find((m: any) => m.authorType === 'contact')?.authorName || '';
    const preClientId = selected?.clientId || '';
    const preNetworkId = preClientId ? (customers.find((c: any) => c.id === preClientId)?.networkId || '') : '';
    let currentUserId = '';
    try { const me: any = await api.me(); currentUserId = me?.id ?? me?.data?.id ?? ''; } catch {}
    setCreateForm({ subject: contactN ? `Atendimento - ${contactN}` : '', description:'', priority:'medium', department:'', category:'', subcategory:'', assignedTo: currentUserId, networkId: preNetworkId, clientId: preClientId });
    if (preNetworkId) {
      setCreateCustomers([]);
      try { const r: any = await api.getCustomers({ networkId: preNetworkId, perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
    } else {
      // No network (e.g. auto-created WhatsApp client): show the full customers list so the pre-selected client is visible
      setCreateCustomers(customers.length > 0 ? customers : []);
      if (customers.length === 0) {
        try { const r: any = await api.getCustomers({ perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
      }
    }
    setCreateClientSearch('');
    // Resolve display name for pre-selected client
    const preClient = preClientId ? customers.find((c: any) => c.id === preClientId) : null;
    setCreateClientName(preClient ? (preClient.tradeName || preClient.companyName || '') : '');
    setCreateClientResults([]);
    setShowCreateClientDropdown(false);
    setShowCreateModal(true);
  };

  const confirmCreateTicket = async () => {
    if (!createForm.subject.trim()) { showToast('Assunto é obrigatório', 'error'); return; }
    if (!createForm.clientId) { showToast('Selecione o cliente', 'error'); return; }
    if (!selected?.id) return;
    setCreateLoading(true);
    try {
      // Only send contactId when the selected client is the same as the conversation's client
      // (if the agent picks a different client, the contact won't belong to that client → 400)
      const contactId = (createForm.clientId && createForm.clientId === selected?.clientId)
        ? selected.contactId
        : undefined;
      const payload: any = { subject: createForm.subject, description: createForm.description || undefined, priority: createForm.priority, department: createForm.department || undefined, category: createForm.category || undefined, subcategory: createForm.subcategory || undefined, assignedTo: createForm.assignedTo || undefined, clientId: createForm.clientId, contactId, conversationId: selected.id, origin: selected.channel === 'whatsapp' ? 'whatsapp' : 'portal' };
      const res: any = await api.createTicket(payload);
      const ticketId = res?.id ?? res?.data?.id;
      if (ticketId) {
        await api.linkTicketToConversation(selected.id, ticketId).catch(() => {});
        setSelected({ ...selected, ticketId });
        await loadConversations(false, true);
        loadChat({ ...selected, ticketId });
      }
      setShowCreateModal(false);
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao criar ticket', 'error'); }
    setCreateLoading(false);
  };

  // ── link ticket ──
  const handleLinkTicket = (ticketId: string) => { setLinkSelectedId(ticketId); setLinkReason(''); };

  const confirmLinkTicket = async () => {
    if (!linkSelectedId || !selected?.id) return;
    if (!linkReason.trim()) { showToast('Informe o motivo da vinculação', 'error'); return; }
    try {
      await api.linkTicketToConversation(selected.id, linkSelectedId);
      if (linkReason.trim()) await api.addMessage(linkSelectedId, { content: `Conversa vinculada ao ticket. Motivo: ${linkReason}`, messageType: 'system' }).catch(() => {});
      setSelected({ ...selected, ticketId: linkSelectedId });
      setShowLinkModal(false); setLinkSelectedId(null); setLinkReason('');
      await loadConversations(false, true);
      loadChat({ ...selected, ticketId: linkSelectedId });
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao vincular', 'error'); }
  };

  // ── send message ──
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    const file = pendingFile;
    if ((!text && !file) || !selected?.id) return;
    const ticketId = isTicketType ? (selected.ticketId || selected.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
    const channel = selected?.channel || 'whatsapp';
    const isPortalNoTicket = channel === 'portal' && !ticketId && !isTicketType;
    const isConvNoTicket = !isTicketType && !ticketId && !!selected?.id;
    if (!isPortalNoTicket && !isConvNoTicket && !ticketId && !isTicketType) return;

    const whatsappConvId = !isTicketType
      ? selected.id
      : (currentTicket?.conversationId ?? selected?.conversationId ?? null);

    // Mensagem otimista: aparece imediatamente antes da resposta da API
    const tempId = `_opt_${Date.now()}`;
    const previewKind = file
      ? (file.type.startsWith('audio/') ? 'audio' : 'image')
      : null;
    const localPreviewUrl = file ? URL.createObjectURL(file) : null;
    setMessages(m => [...m, {
      id: tempId,
      authorType: 'user',
      authorName: 'Você',
      content: text || (previewKind === 'image' ? '📷 Imagem' : previewKind === 'audio' ? '🎤 Áudio' : ''),
      createdAt: new Date().toISOString(),
      whatsappStatus: channel === 'whatsapp' ? 'sending' : null,
      _optimistic: true,
      mediaKind: previewKind,
      hasMedia: !!file,
      _localPreviewUrl: localPreviewUrl,
    }]);
    setInput('');
    setPendingFile(null);
    if (attachFileInputRef.current) attachFileInputRef.current.value = '';
    setSending(true);

    // Cancela "agente digitando" ao enviar
    if (agentIsTypingRef.current && contacts[0]?.whatsapp && user?.tenantId) {
      agentIsTypingRef.current = false;
      if (agentTypingTimeoutRef.current) { clearTimeout(agentTypingTimeoutRef.current); agentTypingTimeoutRef.current = null; }
      emitTypingPresence(contacts[0].whatsapp, user.tenantId, false);
    }

    try {
      let res: any;
      if (file) {
        // Sempre POST em /conversations/:conversationId/messages — precisamos do UUID da conversa.
        // Linha "ticket" no inbox: id pode ser ticket:...; usar conversationId do ticket carregado.
        const convTarget = !isTicketType
          ? selected.id
          : (currentTicket?.conversationId ?? selected?.conversationId ?? null);
        if (!convTarget) {
          throw new Error('Conversa não encontrada para enviar ficheiro. Vincule ou abra a conversa do ticket.');
        }
        res = await api.addConversationMessage(convTarget, { content: text || undefined, file });
      } else if (isTicketType && ticketId) {
        res = await api.addMessage(ticketId, { content: text, messageType: 'comment' });
      } else if (channel === 'whatsapp' && whatsappConvId) {
        res = await api.addConversationMessage(whatsappConvId, { content: text });
      } else if (channel === 'whatsapp' && ticketId) {
        res = await api.sendWhatsappFromTicket(ticketId, text);
      } else {
        res = await api.addConversationMessage(selected.id, { content: text });
      }

      // Extrai objeto de mensagem da resposta da API (vários formatos possíveis)
      // sendWhatsappFromTicket agora retorna { success, message: { id, ... } }
      const real = res?.message?.id ? res.message
        : res?.id ? res
        : res?.data?.id ? res.data
        : null;

      if (real?.id) {
        // Substitui otimista pelo objeto real em-place — sem flash, sem reload
        setMessages(m => m.map(msg => {
          if (msg.id !== tempId) return msg;
          if (msg._localPreviewUrl) URL.revokeObjectURL(msg._localPreviewUrl);
          return { ...real };
        }));
        // Socket também entrega via ticket:message / conversation:message; dedup por ID evita duplicar
      } else {
        // API não retornou objeto (caso raro: ticket sem conversationId ou meta API pura).
        // Aguarda socket substituir o otimista; reload de segurança após 1.5s.
        setTimeout(async () => {
          setMessages(m => {
            if (!m.some((x: any) => x.id === tempId)) return m; // socket já substituiu
            return m.filter((x: any) => x.id !== tempId); // remove otimista pendente
          });
          const fresh = isTicketType && ticketId
            ? await api.getMessages(ticketId, false).catch(() => null)
            : await api.getConversationMessages(selected.id).catch(() => null);
          if (fresh) {
            const arr = Array.isArray(fresh) ? fresh : (fresh as any)?.data ?? [];
            setMessages(m => m.some((x: any) => x._optimistic) ? m : arr);
          }
        }, 1500);
      }
    } catch (e: any) {
      // Marca mensagem otimista como erro em vez de removê-la
      setMessages(m => m.map(msg => {
        if (msg.id !== tempId) return msg;
        if (msg._localPreviewUrl) URL.revokeObjectURL(msg._localPreviewUrl);
        return { ...msg, whatsappStatus: 'error', _optimistic: false, _localPreviewUrl: undefined };
      }));
      showToast((e as any)?.response?.data?.message || (e as Error)?.message || 'Erro ao enviar', 'error');
    }
    setSending(false);
    inputRef.current?.focus();
  };

  // Insere emoji na posição do cursor no textarea
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { setInput(v => v + emoji); return; }
    const start = el.selectionStart ?? input.length;
    const end = el.selectionEnd ?? input.length;
    const next = input.slice(0, start) + emoji + input.slice(end);
    setInput(next);
    // Reposiciona cursor após o emoji
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  // ── derived ──
  const hasTicket = !!selected?.ticketId || isTicketType;
  const isClosed = selected?.status === 'closed';
  const isWhatsapp = selected?.channel === 'whatsapp';
  const isPortalNoTicket = selected?.channel === 'portal' && !hasTicket && selected?.status !== 'closed';
  // Conversa WhatsApp/canal sem ticket — ainda sem ticket vinculado (usado para exibição de estado)
  const isConvNoTicket = !isTicketType && !hasTicket && !!selected?.id && selected?.status !== 'closed';
  // Conversas ativas podem continuar trocando mensagens mesmo sem ticket vinculado.
  const canSend = hasTicket || isPortalNoTicket || isConvNoTicket;
  const ticketIdForRealtime = isTicketType ? (selected?.ticketId || selected?.id?.replace?.(/^ticket:/, '')) : null;
  const conversationIdForRealtime = !isTicketType ? selected?.id : null;

  // IDs das mensagens que contêm a query de busca (excluindo internas e de sistema)
  const msgMatchIds: string[] = (() => {
    const q = msgSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter((m: any) => m.messageType !== 'internal' && String(m.content || '').toLowerCase().includes(q))
      .map((m: any) => m.id);
  })();

  const filteredConversations = conversations.filter(c => {
    // Filtro por tags: conversa precisa ter pelo menos uma das tags selecionadas
    if (filterTags.length > 0) {
      const cTags: string[] = Array.isArray(c.tags) ? c.tags : [];
      const hasTag = filterTags.some(ft =>
        cTags.some(ct => String(ct).toLowerCase() === String(ft).toLowerCase()),
      );
      if (!hasTag) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = (c.contactName || customerName(c.clientId) || '').toLowerCase();
    const num = (c.ticketNumber || '').toLowerCase();
    return name.includes(q) || num.includes(q);
  });

  // ── effects ──
  useEffect(() => {
    try { localStorage.setItem('atend_filter', filter); localStorage.setItem('atend_channel', channelFilter); } catch {}
    loadConversations(true, false);
  }, [filter, channelFilter, loadConversations]);

  useEffect(() => {
    const interval = setInterval(() => loadConversations(false, true), 10_000);
    return () => clearInterval(interval);
  }, [loadConversations]);


  useEffect(() => { if (selected) loadChat(selected); else setMessages([]); }, [selected?.id]);

  useEffect(() => {
    const toRevoke = { ...messageMediaUrlsRef.current };
    setMessageMediaUrls({});
    mediaInFlightRef.current.clear();
    Object.values(toRevoke).forEach((u) => URL.revokeObjectURL(u));
  }, [selected?.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const m of messages) {
        if (!m?.id || m._optimistic || String(m.id).startsWith('_opt')) continue;
        if (!(m.hasMedia || m.mediaKind === 'image' || m.mediaKind === 'audio')) continue;
        if (messageMediaUrlsRef.current[m.id] || mediaInFlightRef.current.has(String(m.id))) continue;
        mediaInFlightRef.current.add(String(m.id));
        try {
          const blob = await api.getConversationMessageMediaBlob(m.id);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          setMessageMediaUrls((prev) => {
            if (prev[m.id]) {
              URL.revokeObjectURL(url);
              return prev;
            }
            return { ...prev, [m.id]: url };
          });
        } catch {
          /* ignora — mensagem antiga ou sem ficheiro */
        } finally {
          mediaInFlightRef.current.delete(String(m.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messages]);
  useEffect(() => { api.getTags({ active: true }).then((r: any) => setAvailableTags(r?.data ?? r ?? [])).catch(() => setAvailableTags([])); }, []);
  useEffect(() => {
    api.getRootCauses({ active: true })
      .then((r: any) => setRootCauseOptions((r?.data ?? r ?? []).map((item: any) => item.name).filter(Boolean)))
      .catch(() => setRootCauseOptions([]));
  }, []);
  // Foca o input de busca ao abrir
  useEffect(() => { if (msgSearchOpen) setTimeout(() => msgSearchInputRef.current?.focus(), 50); }, [msgSearchOpen]);
  // Fecha busca ao trocar de conversa
  useEffect(() => { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }, [selected?.id]);
  // Scrolla para o resultado atual
  useEffect(() => {
    if (!msgMatchIds.length) return;
    const safeIdx = Math.min(msgSearchIdx, msgMatchIds.length - 1);
    const el = document.getElementById(`msg-${msgMatchIds[safeIdx]}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [msgSearchIdx, msgMatchIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showTagDropdown) return;
    const handler = (e: MouseEvent) => {
      if (!tagDropdownRef.current?.contains(e.target as Node)) setShowTagDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTagDropdown]);
  useEffect(() => { setConversationTags(Array.isArray(selected?.tags) ? selected.tags : []); }, [selected?.id, selected?.tags]);
  useEffect(() => {
    if (!selected?.clientId) { setClientTickets([]); return; }
    api.getTickets({ clientId: selected.clientId, perPage: 20 })
      .then((r: any) => setClientTickets(r?.data ?? r ?? []))
      .catch(() => setClientTickets([]));
  }, [selected?.clientId]);
  useEffect(() => {
    api.getCustomers({ perPage: 200 })
      .then((r: any) => { const arr = r?.data ?? r ?? []; customersRef.current = arr; setCustomers(arr); })
      .catch(() => {});
  }, []);
  useEffect(() => { if (showLinkModal && (selected?.clientId || selected?.contactId)) searchTicketsForLink(); }, [showLinkModal, selected?.clientId, selected?.contactId, searchTicketsForLink]);
  useEffect(() => {
    if (messages.length === 0) return;
    if (atBottomRef.current) {
      scrollToBottom(true);
    } else {
      // Usuário está lendo o histórico — mostra botão em vez de pular
      const last = messages[messages.length - 1];
      if (last && !last._optimistic) setShowScrollBtn(true);
    }
  }, [messages.length, scrollToBottom]);

  // ── realtime: contato digitando ──
  const contactPhone = contacts[0]?.whatsapp ?? null;
  useRealtimeContactTyping(
    selected?.channel === 'whatsapp' ? contactPhone : null,
    (isTyping) => {
      setIsContactTyping(isTyping);
      // Auto-limpa após 6s caso o backend não envie "paused"
      if (contactTypingTimeoutRef.current) clearTimeout(contactTypingTimeoutRef.current);
      if (isTyping) {
        contactTypingTimeoutRef.current = setTimeout(() => setIsContactTyping(false), 6000);
      }
    },
  );

  // ── realtime ──
  useRealtimeConversation(conversationIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      // 1. Já existe → atualiza em-place (ex: atualização de status)
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      // 2. Mensagem do agente chegou via socket enquanto otimista ainda está na lista
      //    → substitui o primeiro otimista em vez de duplicar
      if (msg.authorType === 'user') {
        const optIdx = m.findIndex((x: any) => x._optimistic === true);
        if (optIdx >= 0) {
          const next = [...m];
          next[optIdx] = { ...msg };
          return next;
        }
      }
      // 3. Mensagem nova do contato (ou sem otimista) → adiciona ao final
      return [...m, msg];
    });
  });

  useRealtimeTicket(ticketIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      if (msg.authorType === 'user') {
        const optIdx = m.findIndex((x: any) => x._optimistic === true);
        if (optIdx >= 0) {
          const next = [...m];
          next[optIdx] = { ...msg };
          return next;
        }
      }
      return [...m, msg];
    });
  });

  const saveConversationTags = async () => {
    if (!selected?.id || isTicketType) return;
    setSavingConversationTags(true);
    try {
      const saved = await api.updateConversationTags(selected.id, conversationTags);
      const nextTags = Array.isArray(saved?.tags) ? saved.tags : conversationTags;
      setConversationTags(nextTags);
      setSelected((prev: any) => prev ? { ...prev, tags: nextTags } : prev);
      setConversations((prev: any[]) => prev.map((conv: any) => sameItem(conv, selected) ? { ...conv, tags: nextTags } : conv));
      showToast('Tags da conversa atualizadas');
    } catch (e: any) {
      showToast(e?.response?.data?.message || 'Erro ao salvar tags da conversa', 'error');
    }
    setSavingConversationTags(false);
  };

  // ── notificações de nova mensagem (conversas não selecionadas) ──
  useRealtimeTenantNewMessages((msg) => {
    const currentSelected = selectedRef.current;
    // Ignora mensagens da conversa atualmente selecionada (já renderizadas em tempo real)
    if (currentSelected && String(currentSelected.id) === String(msg.conversationId)) return;

    // Incrementa badge
    setUnreadCounts(p => ({ ...p, [msg.conversationId]: (p[msg.conversationId] || 0) + 1 }));

    // Sobe conversa para o topo da lista e atualiza prévia
    setConversations(prev => {
      const idx = prev.findIndex((c: any) => String(c.id) === String(msg.conversationId));
      if (idx < 0) return prev;
      const updated = { ...prev[idx], lastMessage: msg.preview, lastMessageAt: new Date().toISOString() };
      return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });

    // Som de notificação via Web Audio API (sem arquivos externos)
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  });

  // ── ticket transferido em tempo real ──────────────────────────────────────────
  useRealtimeTicketAssigned((payload) => {
    const myId = user?.id;
    if (!myId) return;

    // 1. Ticket foi atribuído a MIM → toast + reload silencioso para aparecer no inbox
    if (String(payload.assignedTo) === String(myId) && String(payload.assignedBy) !== String(myId)) {
      const label = payload.ticketNumber ? `#${payload.ticketNumber}` : 'ticket';
      const byName = payload.assignedByName || 'outro agente';
      showToast(`🎯 ${label} transferido para você por ${byName}`, 'success');
      loadConversations(false, true);
    }

    // 2. Ticket foi tirado de mim (transferido para outro) → atualiza silenciosamente
    if (String(payload.prevAssignedTo) === String(myId) && String(payload.assignedTo) !== String(myId)) {
      loadConversations(false, true);
    }
  });

  // ── conversa fechada remotamente (ticket resolvido/encerrado por outro agente ou pela própria ação) ──
  useRealtimeConversationClosed((conversationId) => {
    const currentSelected = selectedRef.current;
    // Remove da lista de conversas ativas
    setConversations(prev => prev.filter((c: any) => String(c.id) !== String(conversationId)));
    // Se era a conversa selecionada, limpa a seleção
    if (currentSelected && String(currentSelected.id) === String(conversationId)) {
      setSelected(null);
      setMessages([]);
    }
    // Remove badge de não lidas
    setUnreadCounts(p => { const next = { ...p }; delete next[conversationId]; return next; });
  });

  // ── styles (shared) ──
  const S = {
    border: '1px solid rgba(0,0,0,.07)',
    border2: '1px solid rgba(0,0,0,.12)',
    txt: '#111118',
    txt2: '#6B6B80',
    txt3: '#A8A8BE',
    bg: '#FFFFFF',
    bg2: '#F8F8FB',
    bg3: '#F1F1F6',
    accent: '#4F46E5',
    accentLight: '#EEF2FF',
    accentMid: '#C7D2FE',
  } as const;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>

      {/* ── Main layout ── */}
      <div style={{ margin: 0, height: 'calc(100vh - 44px)', display: 'flex', overflow: 'hidden', background: S.bg3 }}>

        {/* ══════════ CONVERSATION LIST (310px) ══════════ */}
        <div style={{ width: 310, background: S.bg, borderRight: S.border, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>

          {/* Header */}
          <div style={{ padding: '16px 16px 12px', borderBottom: S.border, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: S.txt }}>Atendimento</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={openStartModal} title="Nova conversa"
                  style={{ width: 30, height: 30, borderRadius: 8, border: S.border2, background: S.bg2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Plus size={14} color={S.txt2} strokeWidth={1.6} />
                </button>
                <button onClick={() => loadConversations(false, true)} title="Atualizar"
                  style={{ width: 30, height: 30, borderRadius: 8, border: S.border2, background: S.bg2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RefreshCw size={14} color={S.txt2} strokeWidth={1.6} />
                </button>
              </div>
            </div>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.bg2, border: S.border, borderRadius: 9, padding: '7px 11px' }}>
              <Search size={13} color={S.txt3} strokeWidth={1.6} style={{ flexShrink: 0 }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar conversa..."
                style={{ background: 'none', border: 'none', outline: 'none', fontSize: 12, color: S.txt, width: '100%', fontFamily: 'inherit' }}
              />
            </div>
          </div>

          {/* Channel tabs */}
          <div style={{ display: 'flex', gap: 0, padding: '10px 12px 0', borderBottom: S.border, flexShrink: 0 }}>
            {([['all','Todos'],['whatsapp','WhatsApp']] as const).map(([ch, label]) => (
              <button key={ch} onClick={() => { setChannelFilter(ch); if (filter === 'no_ticket') setFilter('all'); }}
                style={{
                  padding: '6px 12px 8px', borderRadius: 0, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  color: channelFilter === ch && filter !== 'no_ticket' ? S.accent : S.txt2,
                  background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${channelFilter === ch && filter !== 'no_ticket' ? S.accent : 'transparent'}`,
                  marginBottom: -1, whiteSpace: 'nowrap', transition: 'color .15s', fontFamily: 'inherit',
                }}>
                {label}
              </button>
            ))}
            <button onClick={() => { setFilter('no_ticket'); setChannelFilter('all'); }}
              style={{
                padding: '6px 12px 8px', borderRadius: 0, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                color: filter === 'no_ticket' ? S.accent : S.txt2,
                background: 'transparent', border: 'none',
                borderBottom: `2px solid ${filter === 'no_ticket' ? S.accent : 'transparent'}`,
                marginBottom: -1, whiteSpace: 'nowrap', transition: 'color .15s', fontFamily: 'inherit',
              }}>
              Sem ticket
            </button>
          </div>

          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: availableTags.length > 0 ? 'none' : S.border, flexShrink: 0 }}>
            {([['all','Em aberto'],['closed','Encerradas'],['linked','Vinculadas']] as const).map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  color: filter === f ? S.accent : S.txt2,
                  background: filter === f ? S.accentLight : 'transparent',
                  border: `1px solid ${filter === f ? S.accentMid : 'rgba(0,0,0,.12)'}`,
                  transition: 'all .12s', fontFamily: 'inherit',
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Tag filter (só aparece se há tags cadastradas) */}
          {availableTags.length > 0 && (
            <div ref={tagDropdownRef} style={{ padding: '8px 12px 10px', borderBottom: S.border, flexShrink: 0, position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {/* Botão abre/fecha dropdown */}
                <button
                  onClick={() => setShowTagDropdown(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px',
                    borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    background: filterTags.length > 0 ? S.accentLight : 'transparent',
                    color: filterTags.length > 0 ? S.accent : S.txt2,
                    border: `1px solid ${filterTags.length > 0 ? S.accentMid : 'rgba(0,0,0,.12)'}`,
                    transition: 'all .12s',
                  }}
                >
                  <Tag size={11} strokeWidth={1.8} />
                  {filterTags.length > 0 ? `Tags (${filterTags.length})` : 'Tags'}
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ transform: showTagDropdown ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M2 3.5l3 3 3-3"/></svg>
                </button>
                {/* Chips das tags selecionadas */}
                {filterTags.map(tagName => {
                  const t = availableTags.find((x: any) => String(x.name).toLowerCase() === String(tagName).toLowerCase());
                  return (
                    <span key={tagName} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px',
                      borderRadius: 999, fontSize: 10, fontWeight: 700, lineHeight: 1,
                      background: t?.color ? `${t.color}18` : S.accentLight,
                      color: t?.color || S.accent,
                      border: `1px solid ${t?.color ? `${t.color}35` : S.accentMid}`,
                    }}>
                      {tagName}
                      <button onClick={() => setFilterTags(prev => prev.filter(x => x !== tagName))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: 'inherit', opacity: 0.7 }}>
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
                {filterTags.length > 0 && (
                  <button onClick={() => setFilterTags([])}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 10, color: S.txt3, fontFamily: 'inherit' }}>
                    limpar
                  </button>
                )}
              </div>

              {/* Dropdown de seleção de tags */}
              {showTagDropdown && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 2px)', left: 12, right: 12, zIndex: 50,
                  background: '#fff', border: S.border2, borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden',
                }}>
                  <div style={{ maxHeight: 220, overflowY: 'auto', padding: '6px 6px' }}>
                    {availableTags.map((tag: any) => {
                      const active = filterTags.some(ft => String(ft).toLowerCase() === String(tag.name).toLowerCase());
                      return (
                        <button key={tag.id || tag.name}
                          onClick={() => {
                            setFilterTags(prev =>
                              active ? prev.filter(x => String(x).toLowerCase() !== String(tag.name).toLowerCase()) : [...prev, tag.name],
                            );
                          }}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            background: active ? S.accentLight : 'transparent', gap: 10, textAlign: 'left',
                          }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color || S.accent, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 500, color: S.txt }}>{tag.name}</span>
                          </span>
                          {active && <Check size={13} color={tag.color || S.accent} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: S.txt3, fontSize: 13 }}>
                <div className="animate-spin w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" style={{ margin: '0 auto 10px' }} />
                Carregando...
              </div>
            ) : filteredConversations.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: S.txt3, fontSize: 13 }}>
                <MessageSquare style={{ width: 28, height: 28, margin: '0 auto 10px', opacity: 0.3 }} />
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {filter === 'no_ticket' ? 'Nenhuma sem ticket' : filter === 'linked' ? 'Nenhuma vinculada' : filter === 'closed' ? 'Nenhuma encerrada' : 'Nenhuma conversa ativa'}
                </p>
                {filter !== 'closed' && (
                  <button onClick={openStartModal} style={{ marginTop: 14, padding: '7px 14px', borderRadius: 8, border: 'none', background: S.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                    <Plus size={12} /> Nova conversa
                  </button>
                )}
              </div>
            ) : (() => {
              const open = filteredConversations.filter((c: any) => c.status !== 'closed');
              const closed = filteredConversations.filter((c: any) => c.status === 'closed');
              const renderItem = (c: any) => {
                const isSelected = sameItem(c, selected);
                const noTicket = !c.ticketId;
                const isClo = c.status === 'closed';
                const ch = c.channel || 'whatsapp';
                const dispName = c.contactName || customerName(c.clientId) || '—';
                const compName = c.clientName || (c.contactName ? customerName(c.clientId) : null) || (customerName(c.clientId) !== '—' ? customerName(c.clientId) : null);
                const col = avatarColor(dispName);
                return (
                  <button key={c.id} onClick={() => { setSelected(c); if (c?.id) setUnreadCounts(p => { const n = { ...p }; delete n[c.id]; return n; }); }}
                    style={{
                      width: '100%', padding: 10, borderRadius: 10, border: 'none',
                      background: isSelected ? S.accentLight : 'transparent',
                      cursor: 'pointer', textAlign: 'left', transition: 'background .1s',
                      display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 2, fontFamily: 'inherit',
                    }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: isClo ? '#E2E8F0' : col, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 600 }}>
                        {dispName !== '—' ? initials(dispName) : <MessageSquare size={14} />}
                      </div>
                      <ChannelDot channel={ch} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: isClo ? S.txt3 : S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {dispName}
                        </span>
                        <span style={{ fontSize: 10, color: S.txt3, flexShrink: 0, paddingTop: 1 }}>{timeAgo(c.lastMessageAt || c.createdAt)}</span>
                      </div>
                      {c.lastMessage && (
                        <p style={{ fontSize: 12, color: S.txt2, margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>
                          {c.lastMessage}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                        {!noTicket && c.ticketNumber && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#EEF2FF', color: '#4338CA' }}>{c.ticketNumber}</span>
                        )}
                        {compName && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#F0FDF4', color: '#166534' }}>{compName}</span>
                        )}
                        {c.escalated && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: '#FEF2F2', color: '#DC2626' }}>● Urgente</span>
                        )}
                        {c.slaCritical && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: '#FFF1F0', color: '#CF1322' }}>⚠ SLA</span>
                        )}
                        {noTicket && !isClo && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#FEF3C7', color: '#D97706' }}>Sem ticket</span>
                        )}
                        {(() => { const badge = (unreadCounts[c.id] || 0) + (c.unreadCount || 0); return badge > 0 ? (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9, fontWeight: 600, background: S.accent, color: '#fff', minWidth: 18, textAlign: 'center', lineHeight: 1.4 }}>{badge > 99 ? '99+' : badge}</span>
                        ) : null; })()}
                        {!isClo && c.awaitingResponse && (
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 500, background: '#EEF2FF', color: '#4338CA' }}>Aguardando</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              };
              return (
                <>
                  {open.length > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 8px 4px', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Em aberto</span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: S.txt3, background: S.bg2, borderRadius: 10, padding: '1px 7px' }}>{open.length}</span>
                      </div>
                      {open.map(renderItem)}
                    </>
                  )}
                  {closed.length > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 8px 4px', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Encerradas hoje</span>
                        <span style={{ fontSize: 10, fontWeight: 500, color: S.txt3, background: S.bg2, borderRadius: 10, padding: '1px 7px' }}>{closed.length}</span>
                      </div>
                      {closed.map(renderItem)}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* ══════════ CHAT AREA (flex-1) ══════════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: S.bg, minWidth: 0 }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: S.txt3 }}>
              <MessageSquare size={40} strokeWidth={1.2} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: S.txt2, margin: 0 }}>Selecione uma conversa</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ position: 'relative', padding: '14px 20px', borderBottom: S.border, background: S.bg, flexShrink: 0 }}>
                {/* Barra de progresso discreta ao trocar de conversa */}
                {loadingChat && (
                  <div className="animate-pulse" style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: `linear-gradient(90deg, ${S.accent} 0%, #818CF8 60%, ${S.accent} 100%)`,
                    backgroundSize: '200% 100%',
                  }} />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {/* Avatar */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarColor(selected.contactName || customerName(selected.clientId) || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                      {initials(selected.contactName || customerName(selected.clientId) || '?')}
                    </div>
                    <ChannelDot channel={selected.channel || 'whatsapp'} />
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: S.txt }}>
                      {contactName(selected.contactId) !== '—' ? contactName(selected.contactId) : messages.find((m: any) => m.authorType === 'contact')?.authorName || selected.contactName || '—'}
                    </div>
                    <div style={{ fontSize: 11, color: S.txt2, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 5, background: isWhatsapp ? '#DCFCE7' : '#EEF2FF', color: isWhatsapp ? '#15803D' : S.accent }}>
                        {isWhatsapp ? <Phone size={9} /> : <Globe size={9} />}
                        {isWhatsapp ? 'WhatsApp' : 'Portal'}
                      </span>
                      <span style={{ color: S.txt3 }}>·</span>
                      <span>{customerName(selected.clientId)}</span>
                      {/* Número do contato visível no cabeçalho */}
                      {contacts[0]?.whatsapp && isWhatsapp && (
                        <>
                          <span style={{ color: S.txt3 }}>·</span>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{formatWhatsApp(contacts[0].whatsapp)}</span>
                        </>
                      )}
                      {selected.lastMessageAt && (
                        <>
                          <span style={{ color: S.txt3 }}>·</span>
                          <span style={{ color: S.txt3 }}>Visto {timeAgo(selected.lastMessageAt)} atrás</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    {/* Busca dentro da conversa */}
                    <button
                      onClick={() => { setMsgSearchOpen(v => !v); if (msgSearchOpen) { setMsgSearchQuery(''); setMsgSearchIdx(0); } }}
                      title="Buscar na conversa (Ctrl+F)"
                      style={{ width: 30, height: 30, borderRadius: 8, border: S.border2, background: msgSearchOpen ? S.accentLight : S.bg2, color: msgSearchOpen ? S.accent : S.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Search size={14} strokeWidth={1.8} />
                    </button>
                    {hasTicket && (
                      <Link href={`/dashboard/tickets/${selected.ticketId}`} target="_blank"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, background: S.accentLight, border: `1px solid ${S.accentMid}`, color: S.accent, fontSize: 12, fontWeight: 600, textDecoration: 'none', fontFamily: "'DM Mono', monospace" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/></svg>
                        {currentTicket?.ticketNumber ?? selected?.ticketNumber ?? '—'}
                      </Link>
                    )}
                    {!hasTicket && !isPortalNoTicket && (
                      <button onClick={handleCreateTicket} disabled={creatingTicket}
                        style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: S.accent, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                        <Plus size={13} /> Criar Ticket
                      </button>
                    )}
                    <button onClick={() => { setShowLinkModal(true); setLinkTicketSearch(''); setLinkTickets([]); }}
                      style={{ padding: '6px 14px', borderRadius: 8, border: S.border2, background: S.bg2, color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                      <Link2 size={13} /> Vincular ticket
                    </button>
                    <button onClick={openTransferModal}
                      style={{ padding: '6px 14px', borderRadius: 8, border: S.border2, background: S.bg2, color: S.txt, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                      Transferir
                    </button>
                    {!isClosed && (hasTicket || isPortalNoTicket) && (
                      <button onClick={openEndFlow} disabled={!canCloseTicket || customerLinkRequired}
                        title={customerLinkRequired ? 'Defina a empresa antes de encerrar' : undefined}
                        style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FECACA', background: customerLinkRequired ? '#FFF1F2' : '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: (!canCloseTicket || customerLinkRequired) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', opacity: (!canCloseTicket || customerLinkRequired) ? 0.6 : 1 }}>
                        Encerrar
                      </button>
                    )}
                  </div>
                </div>

                {/* Warning banners */}
                {!hasTicket && !isPortalNoTicket && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                    Sem ticket vinculado. Você ainda pode conversar normalmente e vincular o ticket depois, se necessário.
                  </div>
                )}

                {/* Contact validation banner — exibido apenas quando há ticket */}
                {currentTicket?.id && (
                  <ContactValidationBanner
                    key={currentTicket.id}
                    ticketId={currentTicket.id}
                    initialCustomerSelectedAt={currentTicket.customerSelectedAt ?? null}
                    initialUnlinkedContact={currentTicket.unlinkedContact ?? false}
                    canManageCustomerLink={canManageCustomerLink}
                    initialCustomerName={customerName(selected?.clientId) !== '—' ? customerName(selected?.clientId) : null}
                    onResolved={(data: ResolvedData) => {
                      setCurrentTicket((prev: any) => prev ? { ...prev, ...data } : prev);
                    }}
                    onRequirementChange={setCustomerLinkRequired}
                  />
                )}
              </div>

              {/* Barra de busca dentro da conversa */}
              {msgSearchOpen && (
                <div style={{ padding: '8px 16px', borderBottom: S.border, background: S.bg, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Search size={13} color={S.txt3} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                  <input
                    ref={msgSearchInputRef}
                    value={msgSearchQuery}
                    onChange={e => { setMsgSearchQuery(e.target.value); setMsgSearchIdx(0); }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }
                      else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (msgMatchIds.length > 0) setMsgSearchIdx(i => e.shiftKey ? (i - 1 + msgMatchIds.length) % msgMatchIds.length : (i + 1) % msgMatchIds.length);
                      }
                    }}
                    placeholder="Buscar na conversa..."
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 13, color: S.txt, fontFamily: 'inherit' }}
                  />
                  {msgSearchQuery.trim() && (
                    <span style={{ fontSize: 11, color: S.txt3, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {msgMatchIds.length > 0 ? `${Math.min(msgSearchIdx + 1, msgMatchIds.length)} de ${msgMatchIds.length}` : 'Sem resultados'}
                    </span>
                  )}
                  <button
                    onClick={() => { if (msgMatchIds.length > 0) setMsgSearchIdx(i => (i - 1 + msgMatchIds.length) % msgMatchIds.length); }}
                    disabled={msgMatchIds.length === 0}
                    title="Resultado anterior (Shift+Enter)"
                    style={{ background: 'none', border: S.border2, borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: msgMatchIds.length > 0 ? 'pointer' : 'default', opacity: msgMatchIds.length > 0 ? 1 : 0.35 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke={S.txt2} strokeWidth="1.6"><path d="M2 6.5l3-3 3 3"/></svg>
                  </button>
                  <button
                    onClick={() => { if (msgMatchIds.length > 0) setMsgSearchIdx(i => (i + 1) % msgMatchIds.length); }}
                    disabled={msgMatchIds.length === 0}
                    title="Próximo resultado (Enter)"
                    style={{ background: 'none', border: S.border2, borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: msgMatchIds.length > 0 ? 'pointer' : 'default', opacity: msgMatchIds.length > 0 ? 1 : 0.35 }}>
                    <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke={S.txt2} strokeWidth="1.6"><path d="M2 3.5l3 3 3-3"/></svg>
                  </button>
                  <button
                    onClick={() => { setMsgSearchOpen(false); setMsgSearchQuery(''); setMsgSearchIdx(0); }}
                    title="Fechar busca (Esc)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: S.txt3, display: 'flex', alignItems: 'center' }}>
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Messages — wrapper com position:relative para o botão flutuante */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: S.bg2 }}>
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  style={{ height: '100%', overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  {loadingChat && messages.length === 0 ? (
                    // Primeira carga: skeleton animado em vez de spinner bloqueante
                    <MessageSkeleton />
                  ) : messages.length === 0 ? (
                    <div style={{ margin: 'auto', textAlign: 'center', color: S.txt3, fontSize: 13 }}>
                      <MessageSquare size={32} style={{ margin: '0 auto 10px', opacity: 0.25 }} />
                      <p style={{ margin: 0 }}>Nenhuma mensagem ainda</p>
                    </div>
                  ) : (
                    // Mensagens ficam visíveis durante troca; opacidade reduzida enquanto carrega
                    <div style={{ display: 'contents', opacity: loadingChat ? 0.55 : 1, transition: 'opacity 0.18s' }}>
                      {/* Indicador de histórico no topo */}
                      {loadingMoreMsgs && (
                        <div style={{ textAlign: 'center', padding: '8px 0', color: S.txt3, fontSize: 12 }}>
                          Carregando histórico...
                        </div>
                      )}
                      {!loadingMoreMsgs && hasMoreMsgs && (
                        <div style={{ textAlign: 'center', padding: '4px 0' }}>
                          <button
                            onClick={loadMoreMessages}
                            style={{ background: 'none', border: S.border2, borderRadius: 12, padding: '4px 14px', fontSize: 12, color: S.txt3, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            Carregar mensagens anteriores
                          </button>
                        </div>
                      )}
                      {messages.filter((m: any) => m.messageType !== 'internal').map((m: any, _i: number) => {
                        const isCurrentMatch = msgSearchQuery.trim() !== '' && msgMatchIds[Math.min(msgSearchIdx, msgMatchIds.length - 1)] === m.id && msgMatchIds.length > 0;
                        return (
                          <div
                            key={m.id}
                            id={`msg-${m.id}`}
                            style={isCurrentMatch ? { borderRadius: 14, outline: '2px solid #FDE68A', outlineOffset: 3 } : undefined}
                          >
                            <MessageItem m={m} isWhatsapp={isWhatsapp} highlight={msgSearchQuery.trim() || undefined} mediaUrl={messageMediaUrls[m.id] ?? null} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Indicador "contato digitando..." */}
                  {isContactTyping && isWhatsapp && (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 4 }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarColor(selected?.contactName || '?'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                        {initials(selected?.contactName || '?')}
                      </div>
                      <div style={{ background: '#FFFFFF', border: '1px solid rgba(0,0,0,.09)', borderRadius: '18px 18px 18px 4px', padding: '10px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                          {[0,1,2].map(i => (
                            <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#A8A8BE', display: 'inline-block', animation: `typingDot 1.2s ${i * 0.2}s infinite ease-in-out` }} />
                          ))}
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Botão flutuante: nova mensagem enquanto usuário lê histórico */}
                {showScrollBtn && (
                  <button
                    onClick={() => scrollToBottom(true)}
                    style={{
                      position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
                      background: S.accent, color: '#fff', border: 'none', borderRadius: 20,
                      padding: '7px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                      boxShadow: '0 4px 14px rgba(79,70,229,.45)', zIndex: 10,
                      fontFamily: 'inherit', transition: 'opacity .15s',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
                    Nova mensagem
                  </button>
                )}
              </div>

              {/* Input */}
              {!isClosed && (
                <div style={{ borderTop: S.border, background: S.bg, padding: 0, flexShrink: 0 }}>
                  {/* Toolbar */}
                  <div style={{ display: 'flex', gap: 2, padding: '10px 16px 8px', borderBottom: S.border, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      ref={attachFileInputRef}
                      type="file"
                      accept="image/*,audio/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (!f.type.startsWith('image/') && !f.type.startsWith('audio/')) {
                          showToast('Envie apenas imagem ou áudio.', 'error');
                          e.target.value = '';
                          return;
                        }
                        setPendingFile(f);
                      }}
                    />
                    {[
                      { label: 'Arquivo', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> },
                      { label: 'Imagem / áudio', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>, onClick: () => attachFileInputRef.current?.click() },
                      { label: 'Resposta rápida', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
                      { label: 'Nota interna', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
                      { label: 'Macro', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
                    ].map(({ label, icon, onClick }: { label: string; icon: ReactNode; onClick?: () => void }) => (
                      <button key={label} type="button" onClick={onClick}
                        style={{ padding: '5px 10px', borderRadius: 7, background: 'transparent', border: 'none', fontSize: 12, color: S.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', transition: 'background .1s' }}>
                        {icon}{label}
                      </button>
                    ))}
                    {/* Emoji picker real */}
                    <EmojiPicker onSelect={insertEmoji} position="top" />
                  </div>
                  {pendingFile && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px 8px', fontSize: 12, color: S.txt2 }}>
                      <span style={{ fontWeight: 500, color: S.txt }}>{pendingFile.name}</span>
                      <span>({(pendingFile.size / 1024).toFixed(0)} KB)</span>
                      <button
                        type="button"
                        onClick={() => { setPendingFile(null); if (attachFileInputRef.current) attachFileInputRef.current.value = ''; }}
                        style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', padding: '0 4px' }}
                      >
                        remover
                      </button>
                    </div>
                  )}
                  <form onSubmit={sendMessage}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '12px 16px' }}>
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => {
                          setInput(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                          // Indicador "agente digitando" para conversas WhatsApp
                          if (isWhatsapp && contacts[0]?.whatsapp && user?.tenantId) {
                            if (!agentIsTypingRef.current) {
                              agentIsTypingRef.current = true;
                              emitTypingPresence(contacts[0].whatsapp, user.tenantId, true);
                            }
                            // Auto-stop após 4s sem digitar
                            if (agentTypingTimeoutRef.current) clearTimeout(agentTypingTimeoutRef.current);
                            agentTypingTimeoutRef.current = setTimeout(() => {
                              agentIsTypingRef.current = false;
                              emitTypingPresence(contacts[0].whatsapp, user.tenantId, false);
                            }, 4000);
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any); } }}
                        placeholder={canSend ? (isWhatsapp ? 'Mensagem WhatsApp... (Enter para enviar)' : 'Digite sua mensagem...') : 'Conversa indisponível para envio'}
                        disabled={!canSend}
                        rows={1}
                        style={{
                          flex: 1, background: canSend ? S.bg2 : '#F8F8FB', border: `1px solid rgba(0,0,0,.12)`,
                          borderRadius: 12, padding: '10px 14px', fontSize: 13, color: S.txt,
                          outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
                          minHeight: 44, maxHeight: 120, opacity: canSend ? 1 : 0.6,
                          transition: 'border-color .15s',
                        }}
                      />
                      <button type="submit" disabled={sending || !canSend || (!input.trim() && !pendingFile)}
                        style={{
                          width: 40, height: 40, borderRadius: 11, border: 'none',
                          background: sending || !canSend || (!input.trim() && !pendingFile) ? '#E2E8F0' : S.accent,
                          cursor: sending || !canSend || (!input.trim() && !pendingFile) ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'background .15s',
                        }}>
                        <Send size={16} color="#fff" strokeWidth={2} />
                      </button>
                    </div>
                  </form>
                </div>
              )}
              {isClosed && (
                <div style={{ borderTop: S.border, background: S.bg2, padding: '12px 20px', flexShrink: 0, textAlign: 'center', fontSize: 12, color: S.txt3 }}>
                  Esta conversa está encerrada
                </div>
              )}
            </>
          )}
        </div>

        {/* ══════════ CLIENT PANEL (290px) ══════════ */}
        <div style={{ width: 290, borderLeft: S.border, background: S.bg, display: 'flex', flexDirection: 'column', overflowY: 'auto', flexShrink: 0 }}>
          {selected ? (() => {
            const customer = customers.find((c: any) => c.id === selected?.clientId);
            const contact = contacts.find((c: any) => c.id === (selected?.contactId || currentTicket?.contactId)) || null;
            // Usa assignedUser embutido no ticket (retornado pelo backend) ou faz fallback na lista de equipe
            const assignedUser = currentTicket?.assignedUser
              || team.find((u: any) => String(u.id) === String(currentTicket?.assignedTo));
            // SLA calc
            const slaInfo = (() => {
              if (!currentTicket?.slaResolveAt || ['resolved','closed','cancelled'].includes(currentTicket?.status)) return null;
              const diff = new Date(currentTicket.slaResolveAt).getTime() - Date.now();
              if (diff < 0) return { violated: true, label: 'VIOLADO', pct: 100 };
              const h = Math.floor(diff / 3600000);
              const m = Math.floor((diff % 3600000) / 60000);
              const total = new Date(currentTicket.slaResolveAt).getTime() - new Date(currentTicket.createdAt || Date.now()).getTime();
              const pct = Math.max(0, Math.min(100, 100 - (diff / Math.max(total, 1)) * 100));
              return { violated: false, label: h > 0 ? `${h}h ${m}m restantes` : `${m}m restantes`, pct };
            })();
            // Client stats from clientTickets
            const total = clientTickets.length;
            const resolved = clientTickets.filter((t: any) => ['resolved','closed'].includes(t.status)).length;
            const resRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
            const urgent = clientTickets.filter((t: any) => t.priority === 'critical' && !['closed','resolved','cancelled'].includes(t.status)).length;
            const recentTickets = [...clientTickets].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4);
            const secTitle = (txt: string, action?: React.ReactNode) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: S.txt3, textTransform: 'uppercase' as const, letterSpacing: '.07em' }}>{txt}</span>
                {action}
              </div>
            );
            const field = (label: string, value: React.ReactNode) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '5px 0', gap: 8 }}>
                <span style={{ fontSize: 12, color: S.txt2, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 12, color: S.txt, fontWeight: 500, textAlign: 'right' as const }}>{value}</span>
              </div>
            );
            const dispName = contactName(selected.contactId) !== '—' ? contactName(selected.contactId) : selected.contactName || '—';
            return (
              <>
                {/* Top: client avatar + name + tags */}
                <div style={{ padding: '16px 16px 14px', borderBottom: S.border }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarColor(dispName), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 700, flexShrink: 0 }}>
                      {initials(dispName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dispName}</div>
                      <div style={{ fontSize: 12, color: S.txt2, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerName(selected.clientId)}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {conversationTags.map((tagName) => {
                      const found = availableTags.find((tag: any) => String(tag.name).toLowerCase() === String(tagName).toLowerCase());
                      return (
                        <span
                          key={tagName}
                          style={{
                            fontSize: 10,
                            padding: '3px 8px',
                            borderRadius: 5,
                            fontWeight: 600,
                            background: found?.color ? `${found.color}18` : '#EEF2FF',
                            color: found?.color || '#4F46E5',
                            border: `1px solid ${found?.color ? `${found.color}33` : '#C7D2FE'}`,
                          }}
                        >
                          {tagName}
                        </span>
                      );
                    })}
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 500, background: isWhatsapp ? '#DCFCE7' : S.accentLight, color: isWhatsapp ? '#15803D' : S.accent }}>
                      {isWhatsapp ? 'WhatsApp' : 'Portal'}
                    </span>
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 500, background: '#D1FAE5', color: '#065F46' }}>Ativo</span>
                  </div>
                </div>

                {!isTicketType && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('Tags da conversa', canEditConversationTags ? (
                      <button
                        type="button"
                        onClick={saveConversationTags}
                        disabled={savingConversationTags}
                        style={{ fontSize: 11, color: S.accent, fontWeight: 700, border: 'none', background: 'transparent', cursor: savingConversationTags ? 'wait' : 'pointer' }}
                      >
                        {savingConversationTags ? 'Salvando...' : 'Salvar'}
                      </button>
                    ) : undefined)}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Tag size={14} color="#4F46E5" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TagMultiSelect
                          options={availableTags}
                          value={conversationTags}
                          onChange={setConversationTags}
                          disabled={!canEditConversationTags || selected?.status === 'closed'}
                          placeholder="Selecione as tags da conversa"
                          emptyText="Nenhuma tag cadastrada"
                        />
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: S.txt3 }}>
                          Use tags para organizar chats do cliente e facilitar filtros futuros.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* RESPONSÁVEL */}
                {currentTicket && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('Responsável')}
                    {assignedUser ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: S.accent, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {initials(assignedUser.name || assignedUser.email || 'U')}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, color: S.txt }}>
                          {assignedUser.name || assignedUser.email}
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span style={{ fontSize: 11, color: '#92400E', fontWeight: 500 }}>Aguardando distribuição automática</span>
                      </div>
                    )}
                  </div>
                )}

                {/* SLA DO TICKET */}
                {slaInfo && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('SLA do Ticket')}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: slaInfo.violated ? '#DC2626' : slaInfo.pct > 80 ? '#EA580C' : '#16A34A',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {slaInfo.violated && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#DC2626' }} />}
                        {slaInfo.label}
                      </span>
                      <span style={{ fontSize: 10, color: S.txt3, fontWeight: 500 }}>{Math.round(slaInfo.pct)}%</span>
                    </div>
                    <div style={{ height: 8, background: S.bg3, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4, transition: 'width .4s',
                        width: `${slaInfo.pct}%`,
                        background: slaInfo.violated
                          ? '#EF4444'
                          : slaInfo.pct > 80
                          ? 'linear-gradient(90deg,#F97316,#EF4444)'
                          : slaInfo.pct > 50
                          ? '#EAB308'
                          : '#22C55E',
                      }} />
                    </div>
                  </div>
                )}

                {/* INFORMAÇÕES */}
                {customer && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('Informações')}
                    {field('Empresa', <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140, display: 'block' }}>{customer.tradeName || customer.companyName || '—'}</span>)}
                    {customer.networkName && field('Rede', customer.networkName)}
                    {customer.cnpj && field('CNPJ', <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{customer.cnpj}</span>)}
                    {contact?.whatsapp && field('WhatsApp', <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{formatWhatsApp(contact.whatsapp)}</span>)}
                    {contact?.email && field('E-mail', <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140, display: 'block', color: S.accent }}>{contact.email}</span>)}
                    {customer.city && field('Cidade', `${customer.city}${customer.state ? `, ${customer.state}` : ''}`)}
                    {customer.createdAt && field('Cliente desde', new Date(customer.createdAt).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }))}
                  </div>
                )}

                {/* ATIVIDADE */}
                {clientTickets.length > 0 && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('Atividade')}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {[
                        { val: total, label: 'Tickets total', sub: `+${clientTickets.filter((t: any) => { const d = new Date(t.createdAt); const now = new Date(); return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear(); }).length} este mês` },
                        { val: `${resRate}%`, label: 'Resolução', sub: null },
                        { val: '—', label: 'Tempo médio', sub: null },
                        { val: urgent, label: 'Urgentes abertos', sub: null },
                      ].map(({ val, label, sub }) => (
                        <div key={label} style={{ background: S.bg2, borderRadius: 10, padding: '10px 12px' }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: S.txt, lineHeight: 1.1 }}>{val}</div>
                          <div style={{ fontSize: 10, color: S.txt2, marginTop: 3, fontWeight: 500 }}>{label}</div>
                          {sub && <div style={{ fontSize: 10, color: '#10B981', marginTop: 2, fontWeight: 500 }}>{sub}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TICKETS RECENTES */}
                {recentTickets.length > 0 && (
                  <div style={{ padding: '14px 16px', borderBottom: S.border }}>
                    {secTitle('Tickets recentes', <Link href={`/dashboard/tickets?clientId=${selected.clientId}`} style={{ fontSize: 11, color: S.accent, fontWeight: 500, textDecoration: 'none' }}>Ver todos</Link>)}
                    {recentTickets.map((t: any) => {
                      const isOpen = ['open','in_progress','waiting_client'].includes(t.status);
                      const isResolved = t.status === 'resolved';
                      const dot = isOpen ? S.accent : isResolved ? '#10B981' : '#A8A8BE';
                      const badge = t.priority === 'critical' ? { bg: '#FEF2F2', color: '#DC2626', label: 'Urgente' } :
                                    t.status === 'resolved' ? { bg: '#F0FDF4', color: '#166534', label: 'Resolvido' } :
                                    isOpen ? { bg: S.accentLight, color: S.accent, label: 'Aberto' } : null;
                      return (
                        <Link key={t.id} href={`/dashboard/tickets/${t.id}`} style={{ textDecoration: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: S.border }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 10, color: S.txt3, fontFamily: "'DM Mono', monospace" }}>{t.ticketNumber}</div>
                              <div style={{ fontSize: 12, color: S.txt, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              {badge && <div style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 600, background: badge.bg, color: badge.color }}>{badge.label}</div>}
                              <div style={{ fontSize: 10, color: S.txt3, marginTop: 2 }}>{timeAgo(t.createdAt)}</div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })() : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.txt3 }}>
              <div style={{ textAlign: 'center' }}>
                <User size={28} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                <p style={{ fontSize: 12, margin: 0 }}>Nenhuma conversa selecionada</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══════════ TOAST ══════════ */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'success' ? '#16A34A' : '#DC2626', color: '#fff', padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.2)', zIndex: 10002, whiteSpace: 'nowrap', animation: 'fadeUp 0.2s ease-out' }}>
          {toast.type === 'success' ? '✓ ' : '✗ '}{toast.msg}
        </div>
      )}

      {/* ══════════ MODAL: Nova Conversa WhatsApp ══════════ */}
      {showStartModal && (() => {
        const existingConv = startContactId
          ? conversations.find((c: any) => c.contactId === startContactId && c.status === 'active')
          : null;
        const filteredContacts = startContacts.filter((c: any) => {
          if (!startContactSearch.trim()) return true;
          const q = startContactSearch.toLowerCase();
          return c.name?.toLowerCase().includes(q) || c.whatsapp?.includes(q) || c.phone?.includes(q);
        });
        // Modo "Por contato": só mostra contatos que têm whatsapp (não apenas phone)
        const contactsWithWa = filteredContacts.filter((c: any) => c.whatsapp?.trim());
        const contactsPhoneOnly = filteredContacts.filter((c: any) => !c.whatsapp?.trim() && c.phone?.trim());

        const canStartByContact = !!startContactId && !startingConv;
        const canStartByPhone = startPhoneResult?.exists !== false && startPhone.trim().replace(/\D/g,'').length >= 8 && !startingConv;

        const S_TAB = (active: boolean) => ({
          flex: 1, padding: '8px 0', fontSize: 13, fontWeight: active ? 700 : 500,
          background: active ? '#4F46E5' : 'transparent',
          color: active ? '#fff' : '#64748B',
          border: 'none', borderRadius: 8, cursor: 'pointer', transition: 'all 0.15s',
        });

        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setShowStartModal(false)}>
            <div style={{ background: '#fff', borderRadius: 16, width: 500, maxWidth: 'calc(100vw - 32px)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Phone size={17} color="#25D366" /> Nova conversa WhatsApp
                  </h3>
                  <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>Inicie uma conversa outbound com um contato</p>
                </div>
                <button onClick={() => setShowStartModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}><X size={18} /></button>
              </div>

              {/* Tabs */}
              <div style={{ padding: '12px 24px 0', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: 4, background: '#F1F5F9', borderRadius: 10, padding: 4 }}>
                  <button style={S_TAB(startMode === 'contact')} onClick={() => { setStartMode('contact'); setStartPhoneResult(null); }}>
                    👤 Por contato existente
                  </button>
                  <button style={S_TAB(startMode === 'phone')} onClick={() => { setStartMode('phone'); setStartContactId(''); }}>
                    📱 Por número direto
                  </button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>

                {/* ── Modo: Por contato ── */}
                {startMode === 'contact' && (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cliente</label>
                      <select value={startClientId} onChange={(e) => { const opt = e.target.options[e.target.selectedIndex]; handleStartClientChange(e.target.value, opt.text); }}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E2E8F0', fontSize: 14, color: '#0F172A', background: '#fff', outline: 'none' }}>
                        <option value="">Selecione um cliente...</option>
                        {customers.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.companyName || c.name}</option>)}
                      </select>
                    </div>
                    {startClientId && (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                          Contato <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>(com WhatsApp cadastrado)</span>
                        </label>
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94A3B8' }} />
                          <input value={startContactSearch} onChange={e => setStartContactSearch(e.target.value)} placeholder="Buscar por nome ou número..."
                            style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                        </div>
                        {loadingStartContacts ? (
                          <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>Carregando contatos...</div>
                        ) : contactsWithWa.length === 0 && contactsPhoneOnly.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: 16, color: '#94A3B8', fontSize: 13, background: '#F8FAFC', borderRadius: 10 }}>
                            {startContacts.length === 0 ? 'Nenhum contato cadastrado neste cliente.' : 'Nenhum contato encontrado.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                            {contactsWithWa.map((c: any) => {
                              const isSel = startContactId === c.id;
                              return (
                                <button key={c.id} onClick={() => setStartContactId(isSel ? '' : c.id)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderRadius: 10, border: `1.5px solid ${isSel ? '#4F46E5' : '#E2E8F0'}`, background: isSel ? '#EEF2FF' : '#fff', cursor: 'pointer', textAlign: 'left' }}>
                                  <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: isSel ? '#4F46E5' : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSel ? '#fff' : '#64748B', fontSize: 12, fontWeight: 700 }}>
                                    {c.name?.charAt(0)?.toUpperCase() || '?'}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#25D366', display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <Phone size={10} />{formatWhatsApp(c.whatsapp) || c.whatsapp}
                                    </p>
                                  </div>
                                  {isSel && <Check size={16} color="#4F46E5" />}
                                </button>
                              );
                            })}
                            {contactsPhoneOnly.length > 0 && (
                              <div style={{ fontSize: 11, color: '#94A3B8', padding: '6px 4px 2px', borderTop: '1px solid #F1F5F9', marginTop: 4 }}>
                                Contatos abaixo têm apenas telefone (sem WhatsApp cadastrado — use &quot;Por número direto&quot;):
                              </div>
                            )}
                            {contactsPhoneOnly.map((c: any) => (
                              <button key={c.id} disabled style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', borderRadius: 10, border: '1.5px solid #F1F5F9', background: '#FAFAFA', cursor: 'not-allowed', textAlign: 'left', opacity: 0.6 }}>
                                <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12, fontWeight: 700 }}>
                                  {c.name?.charAt(0)?.toUpperCase() || '?'}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#CBD5E1', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} />{c.phone}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ── Modo: Por número direto ── */}
                {startMode === 'phone' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Número do WhatsApp
                    </label>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        value={startPhone}
                        onChange={e => { setStartPhone(e.target.value); setStartPhoneResult(null); }}
                        onKeyDown={e => { if (e.key === 'Enter') handleCheckPhone(); }}
                        placeholder="Ex: 55 11 99999-9999"
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${startPhoneResult ? (startPhoneResult.exists ? '#22C55E' : '#EF4444') : '#E2E8F0'}`, fontSize: 14, outline: 'none' }}
                      />
                      <button
                        onClick={handleCheckPhone}
                        disabled={!startPhone.trim() || startPhoneChecking}
                        style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: !startPhone.trim() ? '#E2E8F0' : '#4F46E5', color: !startPhone.trim() ? '#94A3B8' : '#fff', fontWeight: 700, fontSize: 13, cursor: !startPhone.trim() ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
                        {startPhoneChecking ? '...' : 'Verificar'}
                      </button>
                    </div>
                    <p style={{ margin: '0 0 12px', fontSize: 11, color: '#94A3B8' }}>
                      Informe com DDI (ex: 55 para Brasil). O sistema verifica se o número está ativo no WhatsApp.
                    </p>
                    {startPhoneResult && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: startPhoneResult.exists ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${startPhoneResult.exists ? '#BBF7D0' : '#FECACA'}`, marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                        {startPhoneResult.exists ? (
                          <>
                            <CheckCircle2 size={16} color="#16A34A" style={{ flexShrink: 0 }} />
                            <div>
                              <span style={{ fontWeight: 700, color: '#15803D' }}>Número encontrado no WhatsApp!</span>
                              {startPhoneResult.jid && (
                                <span style={{ color: '#64748B', marginLeft: 6, fontSize: 11 }}>JID: {startPhoneResult.jid}</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <X size={16} color="#DC2626" style={{ flexShrink: 0 }} />
                            <div>
                              <span style={{ fontWeight: 700, color: '#DC2626' }}>Número não encontrado no WhatsApp.</span>
                              <span style={{ color: '#94A3B8', marginLeft: 6, fontSize: 11 }}>Verifique o número e tente novamente, ou prossiga mesmo assim.</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cliente (opcional)</label>
                      <select value={startClientId} onChange={(e) => setStartClientId(e.target.value)}
                        style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1.5px solid #E2E8F0', fontSize: 13, color: '#0F172A', background: '#fff', outline: 'none' }}>
                        <option value="">Sem cliente (vincular depois)</option>
                        {customers.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.companyName || c.name}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {/* ── Mensagem inicial (ambos os modos) ── */}
                {(startMode === 'phone' || (startMode === 'contact' && startContactId)) && (
                  <div style={{ marginTop: 4 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Mensagem inicial <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#94A3B8' }}>(opcional)</span>
                    </label>
                    <textarea
                      value={startFirstMessage}
                      onChange={e => setStartFirstMessage(e.target.value)}
                      placeholder="Olá! Entramos em contato para..."
                      rows={3}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E2E8F0', fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box' as const, fontFamily: 'inherit' }}
                    />
                    <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94A3B8' }}>Se preenchida, a mensagem será enviada imediatamente ao criar a conversa.</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button onClick={() => setShowStartModal(false)} style={{ padding: '10px 18px', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>

                {/* Botão modo "Por contato" */}
                {startMode === 'contact' && (
                  <button disabled={!canStartByContact}
                    onClick={async () => {
                      if (!startClientId || !startContactId) return;
                      setStartingConv(true);
                      try {
                        if (existingConv && !startFirstMessage.trim()) {
                          await afterConvCreated(existingConv);
                          showToast('Conversa aberta!');
                        } else {
                          // Usa startOutbound para criar conversa + enviar mensagem inicial (sem ticket — atendente vincula depois)
                          const selectedContact = startContacts.find((c: any) => c.id === startContactId);
                          const res: any = await api.startOutboundConversation({
                            contactId: startContactId,
                            clientId: startClientId,
                            subject: selectedContact?.name ? `WhatsApp - ${selectedContact.name}` : undefined,
                            firstMessage: startFirstMessage.trim() || undefined,
                          });
                          const d = res?.data ?? res;
                          await afterConvCreated(d.conversation);
                          showToast(d.firstMessageSent ? 'Conversa iniciada e mensagem enviada!' : 'Nova conversa iniciada!');
                        }
                      } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao iniciar conversa', 'error'); }
                      setStartingConv(false);
                    }}
                    style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: !canStartByContact ? '#E2E8F0' : existingConv ? '#4F46E5' : 'linear-gradient(135deg,#4F46E5,#6366F1)', color: !canStartByContact ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !canStartByContact ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} />
                    {startingConv ? 'Aguarde...' : existingConv ? 'Abrir conversa' : 'Iniciar conversa'}
                  </button>
                )}

                {/* Botão modo "Por número" */}
                {startMode === 'phone' && (
                  <button
                    disabled={!canStartByPhone}
                    onClick={async () => {
                      if (!startPhone.trim()) return;
                      setStartingConv(true);
                      try {
                        const res: any = await api.startOutboundConversation({
                          phone: startPhone.trim(),
                          clientId: startClientId || undefined,
                          firstMessage: startFirstMessage.trim() || undefined,
                        });
                        const d = res?.data ?? res;
                        await afterConvCreated(d.conversation);
                        showToast(d.firstMessageSent ? 'Conversa iniciada e mensagem enviada!' : 'Conversa iniciada!');
                      } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao iniciar conversa', 'error'); }
                      setStartingConv(false);
                    }}
                    style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: !canStartByPhone ? '#E2E8F0' : 'linear-gradient(135deg,#25D366,#16A34A)', color: !canStartByPhone ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !canStartByPhone ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Phone size={14} />
                    {startingConv ? 'Aguarde...' : startPhoneResult?.exists === false ? 'Enviar mesmo assim' : 'Iniciar conversa'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ MODAL: Vincular Ticket ══════════ */}
      {showLinkModal && selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 }} onClick={() => { setShowLinkModal(false); setLinkSelectedId(null); }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Vincular Ticket</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Selecione o ticket e informe o motivo</p>
              </div>
              <button onClick={() => { setShowLinkModal(false); setLinkSelectedId(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            {!linkSelectedId ? (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', padding: '16px 20px', gap: 10 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={linkTicketSearch} onChange={e => setLinkTicketSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchTicketsForLink()}
                    placeholder="Buscar por número ou assunto..." style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none' }} />
                  <button onClick={searchTicketsForLink} style={{ padding: '9px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#F8FAFC', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Buscar</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {linkTickets.filter((t: any) => !['closed', 'cancelled'].includes(t.status)).map((t: any) => {
                    const ST: Record<string,{bg:string;color:string;label:string}> = {
                      open:           { bg:'#EEF2FF', color:'#3730A3', label:'Aberto' },
                      in_progress:    { bg:'#FEF3C7', color:'#92400E', label:'Em Andamento' },
                      waiting_client: { bg:'#F0F9FF', color:'#0369A1', label:'Aguardando' },
                      resolved:       { bg:'#F0FDF4', color:'#166534', label:'Resolvido' },
                      closed:         { bg:'#F9FAFB', color:'#374151', label:'Fechado' },
                    };
                    const st = ST[t.status] || ST.closed;
                    return (
                      <button key={t.id} onClick={() => handleLinkTicket(t.id)}
                        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 8, textAlign: 'left', cursor: 'pointer', background: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4F46E5', fontSize: 12, flexShrink: 0 }}>{t.ticketNumber}</span>
                        <span style={{ fontSize: 13, color: '#0F172A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600, background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                      </button>
                    );
                  })}
                  {linkTickets.filter((t: any) => !['closed', 'cancelled'].includes(t.status)).length === 0 && (
                    <p style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: '24px 0' }}>
                      {linkTickets.length === 0 ? 'Nenhum ticket encontrado. Use a busca acima.' : 'Nenhum ticket disponível para vincular.'}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE', borderRadius: 8, padding: '10px 14px' }}>
                  <p style={{ margin: 0, fontSize: 12, color: '#4338CA', fontWeight: 600 }}>Ticket selecionado</p>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#0F172A', fontWeight: 700 }}>
                    {linkTickets.find(t => t.id === linkSelectedId)?.ticketNumber} — {linkTickets.find(t => t.id === linkSelectedId)?.subject}
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                    Motivo da Vinculação <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <textarea value={linkReason} onChange={e => setLinkReason(e.target.value)} rows={3} autoFocus
                    placeholder="Ex: Cliente abriu via WhatsApp, ticket já existia no sistema..."
                    style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${linkReason.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setLinkSelectedId(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Voltar</button>
                  <button onClick={confirmLinkTicket} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Vincular</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Criar Ticket ══════════ */}
      {showCreateModal && selected && (() => {
        const selDept = ticketSettingsTree.find((d: any) => d.name === createForm.department);
        const cats = selDept?.categories || [];
        const selCat = cats.find((c: any) => c.name === createForm.category);
        const subs = selCat?.subcategories || [];
        const PRIORITY_OPTS = [{ v:'low',l:'Baixa'},{v:'medium',l:'Média'},{v:'high',l:'Alta'},{v:'critical',l:'Crítico'}];
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 540, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Plus size={18} color="#4F46E5" />
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Criar Ticket</h2>
                  <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Preencha as informações do chamado</p>
                </div>
                <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 20 }}>×</button>
              </div>
              <div style={{ overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Rede</label>
                  <select value={createForm.networkId} onChange={async e => {
                    const nid = e.target.value;
                    setCreateForm(f => ({ ...f, networkId: nid, clientId: '' }));
                    setCreateClientSearch(''); setCreateClientName(''); setCreateClientResults([]); setShowCreateClientDropdown(false);
                    if (nid) {
                      setCreateCustomers([]);
                      try { const r: any = await api.getCustomers({ networkId: nid, perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {}
                    } else {
                      // Cleared network: show all customers
                      setCreateCustomers(customers.length > 0 ? customers : []);
                      if (customers.length === 0) { try { const r: any = await api.getCustomers({ perPage: 200 }); setCreateCustomers(Array.isArray(r) ? r : r?.data ?? []); } catch {} }
                    }
                  }} style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value=''>Todas as redes</option>
                    {networks.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                </div>
                <div style={{ position: 'relative' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Cliente <span style={{ color: '#EF4444' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94A3B8', pointerEvents: 'none' }} />
                    <input
                      value={createForm.clientId ? createClientName : createClientSearch}
                      readOnly={!!createForm.clientId}
                      onChange={e => {
                        if (createForm.clientId) return; // readonly quando selecionado
                        const q = e.target.value;
                        setCreateClientSearch(q);
                        setShowCreateClientDropdown(true);
                        if (createClientSearchTimer.current) clearTimeout(createClientSearchTimer.current);
                        if (!q.trim()) {
                          setCreateClientResults(createCustomers.slice(0, 20));
                          setCreateClientLoading(false);
                          return;
                        }
                        setCreateClientLoading(true);
                        createClientSearchTimer.current = setTimeout(async () => {
                          try {
                            const params: any = { search: q, perPage: 20 };
                            if (createForm.networkId) params.networkId = createForm.networkId;
                            const r: any = await api.getCustomers(params);
                            setCreateClientResults(Array.isArray(r) ? r : r?.data ?? []);
                          } catch { setCreateClientResults([]); }
                          setCreateClientLoading(false);
                        }, 300);
                      }}
                      onFocus={() => {
                        if (createForm.clientId) return;
                        setShowCreateClientDropdown(true);
                        if (!createClientSearch.trim()) setCreateClientResults(createCustomers.slice(0, 20));
                      }}
                      onBlur={() => setTimeout(() => setShowCreateClientDropdown(false), 200)}
                      placeholder="Buscar cliente..."
                      style={{ width: '100%', padding: '9px 12px 9px 32px', border: `1.5px solid ${createForm.clientId ? '#BBF7D0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, background: createForm.clientId ? '#F0FDF4' : '#fff', cursor: createForm.clientId ? 'default' : 'text' }}
                    />
                    {createClientLoading && (
                      <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid #6366F1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                    )}
                    {createForm.clientId && !createClientLoading && (
                      <button type="button" onClick={() => { setCreateForm(f => ({ ...f, clientId: '' })); setCreateClientName(''); setCreateClientSearch(''); setCreateClientResults(createCustomers.slice(0, 20)); setShowCreateClientDropdown(false); }}
                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', display: 'flex', padding: 2 }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {showCreateClientDropdown && createClientResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto', marginTop: 2 }}>
                      {createClientResults.map((c: any) => (
                        <button key={c.id} type="button"
                          onMouseDown={() => {
                            setCreateForm(f => ({ ...f, clientId: c.id }));
                            setCreateClientName(c.tradeName || c.companyName || '');
                            setCreateClientSearch('');
                            setShowCreateClientDropdown(false);
                          }}
                          style={{ display: 'block', width: '100%', padding: '9px 12px', textAlign: 'left', border: 'none', background: createForm.clientId === c.id ? '#EEF2FF' : 'transparent', cursor: 'pointer', fontSize: 13, color: '#0F172A', borderBottom: '1px solid #F1F5F9' }}>
                          <span style={{ fontWeight: 600 }}>{c.tradeName || c.companyName}</span>
                          {c.tradeName && c.companyName && <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 6 }}>{c.companyName}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {showCreateClientDropdown && createClientResults.length === 0 && createClientSearch.trim() && !createClientLoading && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '10px 12px', marginTop: 2 }}>
                      <span style={{ fontSize: 13, color: '#94A3B8' }}>Nenhum cliente encontrado</span>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Assunto <span style={{ color: '#EF4444' }}>*</span></label>
                  <input value={createForm.subject} onChange={e => setCreateForm(f => ({ ...f, subject: e.target.value }))} autoFocus
                    style={{ width: '100%', padding: '9px 12px', border: `1.5px solid ${createForm.subject.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Descrição</label>
                  <textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={2}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Prioridade</label>
                    <select value={createForm.priority} onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      {PRIORITY_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Técnico</label>
                    <select value={createForm.assignedTo} onChange={e => setCreateForm(f => ({ ...f, assignedTo: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Não atribuído</option>
                      {team.map((u: any) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Departamento</label>
                  <select value={createForm.department} onChange={e => setCreateForm(f => ({ ...f, department: e.target.value, category: '', subcategory: '' }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value=''>Selecione...</option>
                    {ticketSettingsTree.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                {cats.length > 0 && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Categoria</label>
                    <select value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Selecione...</option>
                      {cats.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {subs.length > 0 && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Subcategoria</label>
                    <select value={createForm.subcategory} onChange={e => setCreateForm(f => ({ ...f, subcategory: e.target.value }))}
                      style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                      <option value=''>Selecione...</option>
                      {subs.map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreateModal(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={confirmCreateTicket} disabled={createLoading}
                  style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#4F46E5,#6366F1)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: createLoading ? 0.7 : 1 }}>
                  <Plus size={14} />{createLoading ? 'Criando...' : 'Criar Ticket'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════ MODAL: Encerrar — step 1 ══════════ */}
      {showEndModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Encerrar Atendimento</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>O que deseja fazer com o ticket vinculado?</p>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={handleKeepOpen} style={{ padding: '14px 16px', border: '1.5px solid #BFDBFE', borderRadius: 10, background: '#EFF6FF', color: '#1D4ED8', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }}>
                <RefreshCw size={18} style={{ flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>Manter ticket aberto</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#3B82F6', fontWeight: 400 }}>A conversa é encerrada mas o ticket continua em aberto</p>
                </div>
              </button>
              <button onClick={handleCloseTicket} disabled={customerLinkRequired} style={{ padding: '14px 16px', border: '1.5px solid #FED7AA', borderRadius: 10, background: '#FFF7ED', color: '#C2410C', fontSize: 13, fontWeight: 600, cursor: customerLinkRequired ? 'not-allowed' : 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', opacity: customerLinkRequired ? 0.6 : 1 }}>
                <Lock size={18} style={{ flexShrink: 0 }} />
                <div>
                  <p style={{ margin: 0, fontWeight: 700 }}>Encerrar e fechar o ticket</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#EA580C', fontWeight: 400 }}>Preencher solução, causa raiz, tempo e encerrar tudo</p>
                </div>
              </button>
            </div>
            <div style={{ padding: '12px 22px', borderTop: '1px solid #F1F5F9', textAlign: 'right' }}>
              <button onClick={() => setShowEndModal(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Manter aberto ══════════ */}
      {showKeepOpenModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9' }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Manter Ticket Aberto</h2>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>Informe o motivo pelo qual o ticket ficará em aberto</p>
            </div>
            <div style={{ padding: '18px 22px' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Motivo <span style={{ color: '#EF4444' }}>*</span></label>
              <textarea value={keepOpenReason} onChange={e => setKeepOpenReason(e.target.value)} placeholder="Ex: Aguardando retorno do fornecedor..." rows={3} autoFocus
                style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${keepOpenReason.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
            </div>
            <div style={{ padding: '12px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowKeepOpenModal(false)} style={{ padding: '8px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmKeepOpen} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: Encerrar (formulário completo) ══════════ */}
      {showCloseForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lock size={18} color="#EA580C" />
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Encerrar Atendimento</h2>
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Preencha as informações. O ticket vinculado também será fechado.</p>
              </div>
              <button onClick={() => setShowCloseForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Solução Aplicada <span style={{ color: '#EF4444' }}>OBRIGATÓRIO</span></label>
                <textarea value={closeForm.solution} onChange={e => setCloseForm(f => ({ ...f, solution: e.target.value }))} placeholder="Descreva o que foi feito para resolver..." rows={3}
                  style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${closeForm.solution.trim() ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Causa Raiz</label>
                  <select value={closeForm.rootCause} onChange={e => setCloseForm(f => ({ ...f, rootCause: e.target.value }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', outline: 'none' }}>
                    <option value="">Selecione...</option>
                    {rootCauseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Tempo de Atendimento</label>
                  <select value={closeForm.timeSpent} onChange={e => setCloseForm(f => ({ ...f, timeSpent: e.target.value }))}
                    style={{ width: '100%', padding: '9px 10px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', background: '#fff', outline: 'none' }}>
                    <option value="">Selecione...</option>
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="60">1 hora</option>
                    <option value="120">2 horas</option>
                    <option value="240">4 horas</option>
                    <option value="480">8 horas</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Nota Interna</label>
                <textarea value={closeForm.internalNote} onChange={e => setCloseForm(f => ({ ...f, internalNote: e.target.value }))} rows={2} placeholder="Observações internas (não enviadas ao cliente)..."
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, color: '#0F172A', resize: 'vertical' as const, outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Complexidade</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => setCloseForm(f => ({ ...f, complexity: f.complexity === n ? 0 : n }))}
                      title={COMPLEXITY_LABELS[n]}
                      style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: `1.5px solid ${closeForm.complexity === n ? '#4F46E5' : '#E2E8F0'}`, background: closeForm.complexity === n ? '#EEF2FF' : '#fff', color: closeForm.complexity === n ? '#4F46E5' : '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                      {n}
                    </button>
                  ))}
                </div>
                {closeForm.complexity > 0 && <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748B' }}>{COMPLEXITY_LABELS[closeForm.complexity]}</p>}
              </div>
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCloseForm(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmCloseTicket} disabled={customerLinkRequired}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#EA580C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: customerLinkRequired ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: customerLinkRequired ? 0.6 : 1 }}>
                <Lock size={14} /> Encerrar Atendimento
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ══════════ MODAL: Atribuir Responsável ══════════ */}

      {/* ══════════ MODAL: Transferir ══════════ */}
      {showTransferModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowTransferModal(false)}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Transferir Atendimento</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94A3B8' }}>Selecione o agente para transferir este atendimento</p>
              </div>
              <button onClick={() => setShowTransferModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
            </div>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {team.filter((u: any) => u.id !== currentTicket?.assignedTo).map((u: any) => (
                <button key={u.id} onClick={() => setTransferAgentId(u.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${transferAgentId === u.id ? S.accent : '#E2E8F0'}`, background: transferAgentId === u.id ? S.accentLight : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all .12s' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: transferAgentId === u.id ? S.accent : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: transferAgentId === u.id ? '#fff' : '#64748B', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {initials(u.name || u.email || 'U')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email}</p>
                    {u.name && u.email && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B' }}>{u.email}</p>}
                  </div>
                  {transferAgentId === u.id && <Check size={16} color={S.accent} />}
                </button>
              ))}
              {team.length === 0 && <p style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: '16px 0' }}>Nenhum agente disponível</p>}
            </div>
            <div style={{ padding: '14px 22px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowTransferModal(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmTransfer} disabled={transferLoading || !transferAgentId}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: !transferAgentId ? '#E2E8F0' : S.accent, color: !transferAgentId ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !transferAgentId ? 'not-allowed' : 'pointer', opacity: transferLoading ? 0.7 : 1 }}>
                {transferLoading ? 'Transferindo...' : 'Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
