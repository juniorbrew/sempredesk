'use client';
import { useState, useEffect, useRef } from 'react';
import { usePortalStore } from '@/store/portal.store';
import { useRealtimeConversation } from '@/lib/realtime';
import { MessageCircle, X, Send, Lock, ArrowLeft, CheckCircle } from 'lucide-react';

const API_BASE = '/api/v1';

const errMsg = (e: any): string => {
  if (typeof e?.message === 'string') return e.message;
  if (e && typeof e === 'object' && e?.message) return String(e.message);
  return 'Erro inesperado';
};

type Step =
  | 'choice'
  | 'new-dept'
  | 'new-subject'
  | 'new-description'
  | 'new-confirm'
  | 'ticket-list'
  | 'chat';

const STATUS_LABELS: Record<string, string> = {
  open: 'Em aberto',
  in_progress: 'Em andamento',
  waiting_client: 'Aguardando',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  open: { bg: '#EAF3DE', color: '#3B6D11' },
  in_progress: { bg: '#EAF3DE', color: '#3B6D11' },
  waiting_client: { bg: '#FAEEDA', color: '#854F0B' },
  resolved: { bg: '#F1F5F9', color: '#64748B' },
  closed: { bg: '#F1F5F9', color: '#64748B' },
  cancelled: { bg: '#F1F5F9', color: '#64748B' },
};

export default function ChatWidget() {
  const { client, contact, accessToken, activeCompanyId, chatTicketId, chatConversationId, chatStep, chatClientId, setChatState } = usePortalStore();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choice');

  // Form state
  const [departments, setDepartments] = useState<{ id: string; name: string; color: string }[]>([]);
  const [form, setForm] = useState({ departmentId: '', departmentName: '', subject: '', description: '' });

  // Active chat state
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<{ id: string; ticketNumber: string; estimatedResponse: string } | null>(null);
  const [activeTicketNumber, setActiveTicketNumber] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [ticketStatus, setTicketStatus] = useState<string | null>(null);
  const [transcriptAttached, setTranscriptAttached] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);

  // Messages
  const [messages, setMessages] = useState<any[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Ticket list
  const [tickets, setTickets] = useState<any[]>([]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const lastSendRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  // ─── Restore active chat on mount ────────────────────────────────────────
  useEffect(() => {
    usePortalStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!open || !accessToken || !client || (!chatTicketId && !chatConversationId) || chatStep !== 'chat' || chatClientId !== (activeCompanyId || client.id)) return;
    setTicketId(chatTicketId);
    setConversationId(chatConversationId ?? null);
    setStep('chat');
    setClosed(false);
    if (chatConversationId) loadMessages(chatConversationId);
    if (chatTicketId) checkTicketStatus(chatTicketId);
  }, [open, accessToken, client?.id, activeCompanyId, chatTicketId, chatConversationId, chatStep, chatClientId]);

  // ─── Navigation helpers ──────────────────────────────────────────────────
  const resetToChoice = () => {
    setStep('choice');
    setTicketId(null);
    setConversationId(null);
    setMessages([]);
    setCreatedTicket(null);
    setActiveTicketNumber(null);
    setError(null);
    setClosed(false);
    setTranscriptAttached(false);
    setForm({ departmentId: '', departmentName: '', subject: '', description: '' });
    setChatState(null, null, 'form');
  };

  const goToChat = async (tId: string, convId: string | null = null, ticketNum?: string, fromNewTicket = false) => {
    setTicketId(tId);
    if (ticketNum) setActiveTicketNumber(ticketNum);
    setStep('chat');
    setClosed(false);
    setTranscriptAttached(false);
    setError(null);
    setTicketStatus(null);
    setChatState(tId, convId, 'chat', activeCompanyId || client?.id);
    if (fromNewTicket && convId) {
      setConversationId(convId);
      loadMessages(convId);
    } else {
      try {
        const res = await fetch(`${API_BASE}/conversations/resume-for-ticket`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          credentials: 'include',
          body: JSON.stringify({ ticketId: tId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(typeof data?.message === 'string' ? data.message : data?.error?.message || 'Erro ao abrir conversa');
        const conv = data?.conversation ?? data?.data?.conversation ?? data;
        const newConvId = conv?.id ?? convId;
        setConversationId(newConvId);
        setChatState(tId, newConvId, 'chat', activeCompanyId || client?.id);
        if (newConvId) loadMessages(newConvId);
      } catch (e: any) {
        setError(errMsg(e));
        setConversationId(convId);
        if (convId) loadMessages(convId);
      }
    }
    checkTicketStatus(tId);
  };

  // ─── API calls ───────────────────────────────────────────────────────────
  const loadDepartments = async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/ticket-settings/departments`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Não foi possível carregar os departamentos.');
      const list = data?.departments ?? data?.data?.departments ?? data?.data ?? [];
      setDepartments(Array.isArray(list) ? list : []);
      if ((Array.isArray(list) ? list : []).length === 0) setError('Nenhum departamento cadastrado.');
    } catch (e: any) {
      setError(e?.message || 'Não foi possível carregar os departamentos.');
    }
    setLoading(false);
  };

  const loadTicketsList = async () => {
    if (!accessToken || (!client?.id && !contact?.id)) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: 'open,waiting_client,in_progress', perPage: '15' });
      if (client?.id) params.append('clientId', client.id);
      if (contact?.id) params.append('contactId', contact.id);
      const res = await fetch(
        `${API_BASE}/tickets?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' },
      );
      const data = await res.json();
      if (!res.ok) {
        console.error('[ChatWidget] ticket list error', res.status, data);
        const msg = typeof data?.message === 'string' ? data.message : (typeof data?.error === 'string' ? data.error : data?.error?.message) || `Erro ${res.status} ao carregar chamados`;
        throw new Error(msg);
      }
      const list = data?.data?.data ?? data?.data ?? data ?? [];
      setTickets(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setError(errMsg(e));
      setTickets([]);
    }
    setLoading(false);
  };

  const startConversation = async () => {
    if (!client?.id || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/conversations/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
        body: JSON.stringify({
          clientId: client.id,
          contactId: contact?.id,
          name: contact?.name || 'Cliente',
          email: contact?.email || '',
          phone: contact?.phone || contact?.whatsapp || undefined,
          subject: form.subject.trim(),
          description: form.description.trim(),
          departmentId: form.departmentId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data?.message === 'string' ? data.message : (typeof data?.error === 'string' ? data.error : data?.error?.message) || 'Erro ao abrir o chamado.';
        throw new Error(msg);
      }
      const result = data?.data ?? data;
      const conv = result?.conversation;
      if (!conv?.id) throw new Error('Resposta invalida do servidor.');
      setCreatedTicket(null);
      setTicketId(null);
      setConversationId(conv.id);
      setChatState(null, conv.id, 'chat', activeCompanyId || client?.id);
      setMessages([]);
      await loadMessages(conv.id);
      setStep('chat');
    } catch (e: any) {
      setError(errMsg(e));
    }
    setLoading(false);
  };

  const CHAT_PAGE_LIMIT = 50;

  const loadMessages = async (convId: string, preservePending = false) => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/conversations/${convId}/messages?limit=${CHAT_PAGE_LIMIT}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      // Suporte a resposta paginada { messages, hasMore } e array/{ data }
      const list = data?.messages ?? data?.data ?? (Array.isArray(data) ? data : data?.items) ?? [];
      const serverList = Array.isArray(list) ? list : [];
      setHasMoreMessages(data?.hasMore ?? false);
      setMessages((prev) => {
        if (!preservePending) return serverList;
        const pending = prev.filter((m: any) => String(m.id).startsWith('temp-'));
        if (pending.length === 0) return serverList;
        const serverKeys = new Set(serverList.map((m: any) => `${m.authorType}||${m.content}`));
        const toKeep = pending.filter((m: any) => !serverKeys.has(`${m.authorType}||${m.content}`));
        if (toKeep.length === 0) return serverList;
        const merged = [...serverList, ...toKeep];
        merged.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        return merged;
      });
    } catch {}
  };

  const loadMoreMessages = async () => {
    if (!conversationId || !accessToken || loadingMoreMessages || !hasMoreMessages) return;
    const body = chatBodyRef.current;
    const prevScrollHeight = body?.scrollHeight ?? 0;
    setLoadingMoreMessages(true);
    try {
      const oldest = messages[0];
      const url = `${API_BASE}/conversations/${conversationId}/messages?limit=${CHAT_PAGE_LIMIT}${oldest?.id ? `&before=${oldest.id}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, credentials: 'include' });
      const data = await res.json();
      const older = data?.messages ?? data?.data ?? (Array.isArray(data) ? data : []);
      setHasMoreMessages(data?.hasMore ?? false);
      if (Array.isArray(older) && older.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map((m: any) => m.id));
          const newOnes = older.filter((m: any) => !existingIds.has(m.id));
          const merged = [...newOnes, ...prev];
          merged.sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
          return merged;
        });
        requestAnimationFrame(() => {
          if (body) body.scrollTop = body.scrollHeight - prevScrollHeight;
        });
      }
    } catch {}
    setLoadingMoreMessages(false);
  };

  const checkTicketStatus = async (id: string) => {
    if (!accessToken) return;
    try {
      const res = await fetch(`${API_BASE}/tickets/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
      });
      const data = await res.json();
      const ticket = data?.data ?? data;
      setTicketStatus(ticket?.status ?? null);
      if (['closed', 'resolved', 'cancelled'].includes(ticket?.status)) {
        setClosed(true);
      }
    } catch {}
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!conversationId || !input.trim() || !accessToken || closed) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    lastSendRef.current = Date.now();
    const tempId = `temp-${Date.now()}`;
    const newMsg = {
      id: tempId,
      content: text,
      authorType: 'contact',
      authorName: contact?.name || 'Você',
      messageType: 'comment',
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, newMsg]);
    scrollToBottom();
    try {
      const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        credentials: 'include',
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = typeof data?.message === 'string' ? data.message : (typeof data?.error === 'string' ? data.error : data?.error?.message) || 'Erro ao enviar';
        throw new Error(msg);
      }
      const created = data?.data ?? data;
      if (created?.id) {
        setMessages((m) => {
          // Socket may have already added the real message before API responded
          const hasReal = m.some((x) => String(x.id) === String(created.id));
          if (hasReal) return m.filter((x) => x.id !== tempId);
          return m.map((x) => (x.id === tempId ? { ...x, id: created.id, createdAt: created.createdAt } : x));
        });
      }
    } catch (err: any) {
      setMessages((m) => m.filter((x: any) => x.id !== tempId));
      setInput(text);
      setError(errMsg(err));
    }
    setSending(false);
  };

  const closeConversation = async () => {
    if (closed) return;
    setCloseConfirm(false);
    // Just close the chat widget — ticket remains open for the agent to handle
    setClosed(true);
  };

  const canSendInConversation = !!conversationId && !closed;

  // ─── Effects ─────────────────────────────────────────────────────────────

  // Reset chat state when client changes (user switched company)
  const prevClientIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = activeCompanyId || client?.id || null;
    if (prevClientIdRef.current !== null && prevClientIdRef.current !== currentId) {
      // Client changed — close widget and reset everything
      setOpen(false);
      setStep('choice');
      setTicketId(null);
      setConversationId(null);
      setMessages([]);
      setCreatedTicket(null);
      setActiveTicketNumber(null);
      setClosed(false);
      setTranscriptAttached(false);
      setCloseConfirm(false);
      setTickets([]);
      setUnreadCount(0);
      setError(null);
      setForm({ departmentId: '', departmentName: '', subject: '', description: '' });
      setChatState(null, null, 'form');
    }
    prevClientIdRef.current = currentId;
  }, [client?.id, activeCompanyId]);

  useEffect(() => {
    if (step === 'new-dept') loadDepartments();
    if (step === 'ticket-list') loadTicketsList();
  }, [step, client?.id]);

  useEffect(() => {
    if (step === 'chat' && messages.length > 0) scrollToBottom();
  }, [step, messages.length]);

  useEffect(() => {
    if (step === 'chat' && conversationId && !closed) {
      const t = setInterval(() => {
        const preservePending = Date.now() - lastSendRef.current < 5000;
        loadMessages(conversationId, preservePending);
        if (ticketId) checkTicketStatus(ticketId);
      }, 15000);
      return () => clearInterval(t);
    }
  }, [step, conversationId, ticketId, closed]);

  // Realtime: listen on conversation room for new messages
  useRealtimeConversation(step === 'chat' ? conversationId : null, (msg) => {
    if (!msg) return;
    const authorType = msg?.authorType ?? msg?.author_type;
    // Own messages are added optimistically via sendMessage — skip to avoid duplicates
    if (authorType === 'contact') return;
    const n = {
      id: msg?.id,
      content: msg?.content,
      authorType,
      authorName: msg?.authorName ?? msg?.author_name,
      messageType: msg?.messageType ?? 'comment',
      createdAt: msg?.createdAt ?? msg?.created_at,
    };
    if (!n.id) return;
    setMessages((m) => {
      const exists = m.some((x) => String(x.id) === String(n.id));
      const next = exists ? m.map((x) => (String(x.id) === String(n.id) ? n : x)) : [...m, n];
      setTimeout(scrollToBottom, 50);
      return next;
    });
  });

  // ─── Styles ──────────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: '1.5px solid #E2E8F0',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };
  const btnPrimary: React.CSSProperties = {
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '10px 14px',
    background: '#F1F5F9',
    border: '1.5px solid #E2E8F0',
    borderRadius: 10,
    color: '#475569',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };

  if (!client) return null;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 16,
          border: 'none',
          background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(29,78,216,0.4)',
          zIndex: 9998,
          transform: open ? 'rotate(45deg)' : 'none',
          transition: 'transform 0.2s',
        }}
      >
        <MessageCircle style={{ width: 28, height: 28 }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              background: '#EF4444',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 6px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Widget panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 88,
            right: 24,
            width: 420,
            maxWidth: 'calc(100vw - 48px)',
            height: 560,
            maxHeight: 'calc(100vh - 120px)',
            background: '#fff',
            borderRadius: 20,
            boxShadow: '0 12px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9999,
            overflow: 'hidden',
            animation: 'fadeUp 0.25s ease-out',
          }}
        >
          <style>{`
            @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
            .chat-input:focus { border-color: #3B82F6 !important; }
            .dept-btn:hover { border-color: #3B82F6 !important; background: #EFF6FF !important; }
            .ticket-row:hover { background: #F8FAFC !important; border-color: #CBD5E1 !important; }
          `}</style>

          {/* Header */}
          <div
            style={{
              background: 'linear-gradient(135deg, #1D4ED8, #3B82F6)',
              color: '#fff',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div>
              <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>Atendimento</span>
              {step === 'chat' && ticketId && (createdTicket?.ticketNumber || activeTicketNumber) && (
                <span style={{ display: 'block', fontSize: 11, opacity: 0.85, fontFamily: 'monospace' }}>
                  {createdTicket?.ticketNumber ?? activeTicketNumber}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'rgba(255,255,255,0.25)',
                border: 'none',
                borderRadius: 10,
                padding: 8,
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>

          {/* Error bar */}
          {error && (
            <div style={{ padding: '10px 16px', background: '#FEE2E2', color: '#DC2626', fontSize: 12, flexShrink: 0 }}>
              {typeof error === 'string' ? error : errMsg(error)}
              <button
                onClick={() => setError(null)}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Fechar
              </button>
            </div>
          )}

          {/* ── STEP: choice ── */}
          {step === 'choice' && (
            <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
              {/* Contact card */}
              {contact && (
                <div style={{
                  background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 12,
                  padding: '12px 16px', marginBottom: 4,
                }}>
                  <p style={{ margin: '0 0 2px', fontSize: 13, color: '#64748B' }}>Atendimento para</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0F172A' }}>{contact.name}</p>
                  {contact.email && <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>{contact.email}</p>}
                  {(client?.tradeName || client?.companyName) && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#3B82F6', fontWeight: 600 }}>{client.tradeName || client.companyName}</p>
                  )}
                </div>
              )}
              <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#0F172A', textAlign: 'center' }}>
                {contact?.name ? `Olá, ${contact.name.split(' ')[0]}! Como posso ajudar?` : 'Como posso ajudar?'}
              </p>
              <button
                onClick={() => {
                  setForm({ departmentId: '', departmentName: '', subject: '', description: '' });
                  setError(null);
                  setStep('new-dept');
                }}
                style={{ ...btnPrimary, width: '100%', textAlign: 'center' }}
              >
                Abrir novo chamado
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setStep('ticket-list');
                }}
                style={{ ...btnPrimary, width: '100%', background: 'linear-gradient(135deg, #0D9488, #14B8A6)', textAlign: 'center' }}
              >
                Consultar chamado existente
              </button>
            </div>
          )}

          {/* ── STEP: new-dept ── */}
          {step === 'new-dept' && (
            <div style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              <button
                onClick={() => setStep('choice')}
                style={{ ...btnSecondary, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px' }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Voltar
              </button>
              {/* Contact badge */}
              {contact && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                    {contact.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#1D4ED8' }}>{contact.name}</p>
                    {(client?.tradeName || client?.companyName) && <p style={{ margin: 0, fontSize: 11, color: '#3B82F6' }}>{client.tradeName || client.companyName}</p>}
                  </div>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Selecione o departamento</p>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>Carregando...</div>
              ) : departments.length === 0 && !error ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>Nenhum departamento disponível.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {departments.map((d) => (
                    <button
                      key={d.id}
                      className="dept-btn"
                      onClick={() => {
                        setForm((f) => ({ ...f, departmentId: d.id, departmentName: d.name }));
                        setStep('new-subject');
                      }}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 10,
                        border: `2px solid ${form.departmentId === d.id ? d.color : '#E2E8F0'}`,
                        background: form.departmentId === d.id ? `${d.color}18` : '#fff',
                        color: '#0F172A',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s',
                      }}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STEP: new-subject ── */}
          {step === 'new-subject' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (form.subject.trim().length >= 3) setStep('new-description');
              }}
              style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <button
                type="button"
                onClick={() => setStep('new-dept')}
                style={{ ...btnSecondary, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px' }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Voltar
              </button>
              {form.departmentName && (
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '3px 10px',
                    borderRadius: 20,
                    background: '#EFF6FF',
                    color: '#1D4ED8',
                    alignSelf: 'flex-start',
                  }}
                >
                  {form.departmentName}
                </span>
              )}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>
                  ASSUNTO <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input
                  className="chat-input"
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Ex: Problema com relatório de vendas"
                  minLength={3}
                  maxLength={120}
                  required
                  style={inputStyle}
                  autoFocus
                />
                <span style={{ fontSize: 11, color: '#94A3B8', marginTop: 4, display: 'block' }}>
                  {form.subject.length}/120
                </span>
              </div>
              <button
                type="submit"
                disabled={form.subject.trim().length < 3}
                style={{ ...btnPrimary, width: '100%', opacity: form.subject.trim().length >= 3 ? 1 : 0.5 }}
              >
                Continuar
              </button>
            </form>
          )}

          {/* ── STEP: new-description ── */}
          {step === 'new-description' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (form.description.trim().length >= 10) startConversation();
              }}
              style={{ padding: 20, flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              <button
                type="button"
                onClick={() => setStep('new-subject')}
                style={{ ...btnSecondary, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px' }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Voltar
              </button>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#475569' }}>
                <span style={{ fontWeight: 600 }}>Assunto:</span> {form.subject}
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>
                  DESCREVA O PROBLEMA <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <textarea
                  className="chat-input"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 600) }))}
                  rows={5}
                  placeholder="Descreva detalhadamente o que está ocorrendo..."
                  minLength={10}
                  maxLength={600}
                  required
                  style={{ ...inputStyle, resize: 'vertical', flex: 1 }}
                  autoFocus
                />
                <span style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{form.description.length}/600</span>
              </div>
              <button
                type="submit"
                disabled={loading || form.description.trim().length < 10}
                style={{ ...btnPrimary, width: '100%', opacity: form.description.trim().length >= 10 && !loading ? 1 : 0.5 }}
              >
                {loading ? 'Abrindo chamado...' : 'Abrir chamado'}
              </button>
            </form>
          )}

          {/* ── STEP: new-confirm ── */}
          {step === 'new-confirm' && createdTicket && (
            <div
              style={{
                padding: 24,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                textAlign: 'center',
              }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 16, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle style={{ width: 28, height: 28, color: '#16A34A' }} />
              </div>
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Chamado aberto!</p>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1D4ED8', fontFamily: 'monospace', letterSpacing: '0.02em' }}>
                  {createdTicket.ticketNumber}
                </p>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#64748B', lineHeight: 1.5 }}>
                Tempo estimado de resposta:{' '}
                <strong style={{ color: '#0F172A' }}>{createdTicket.estimatedResponse}</strong>
              </p>
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button
                  onClick={() => goToChat(createdTicket.id, conversationId ?? null, createdTicket.ticketNumber, true)}
                  style={{ ...btnPrimary, flex: 1, textAlign: 'center' }}
                >
                  Ir para o chat
                </button>
                <button onClick={resetToChoice} style={{ ...btnSecondary, flex: 1, textAlign: 'center' }}>
                  Início
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: ticket-list ── */}
          {step === 'ticket-list' && (
            <div style={{ padding: 20, flex: 1, overflowY: 'auto' }}>
              <button
                onClick={() => setStep('choice')}
                style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', marginBottom: 16 }}
              >
                <ArrowLeft style={{ width: 14, height: 14 }} /> Voltar
              </button>
              <p style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: '#0F172A' }}>Chamados em aberto</p>
              {loading && tickets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>Carregando...</div>
              ) : tickets.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
                  <p style={{ margin: '0 0 12px' }}>Nenhum chamado em aberto no momento.</p>
                  <button onClick={() => setStep('choice')} style={{ ...btnPrimary, fontSize: 13, padding: '10px 20px' }}>
                    Abrir novo chamado
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tickets.map((t) => {
                    const sc = STATUS_COLORS[t.status] || { bg: '#F1F5F9', color: '#64748B' };
                    return (
                      <button
                        key={t.id}
                        className="ticket-row"
                        onClick={() => goToChat(t.id, t.conversationId ?? null, t.ticketNumber)}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: '1.5px solid #E2E8F0',
                          background: '#fff',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: 13,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#4F46E5', fontSize: 13 }}>
                            {t.ticketNumber}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: '2px 8px',
                              borderRadius: 20,
                              background: sc.bg,
                              color: sc.color,
                              fontWeight: 700,
                            }}
                          >
                            {STATUS_LABELS[t.status] || t.status}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontWeight: 600, color: '#0F172A', fontSize: 13 }}>{t.subject}</p>
                        {t.department && (
                          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#94A3B8' }}>{t.department}</p>
                        )}
                        {t.lastAgentMessage && (
                          <p
                            style={{
                              margin: '6px 0 0',
                              fontSize: 11,
                              color: '#64748B',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {t.lastAgentMessage.content}...
                          </p>
                        )}
                        <p style={{ margin: '4px 0 0', fontSize: 10, color: '#CBD5E1' }}>
                          {t.updatedAt ? new Date(t.updatedAt).toLocaleString('pt-BR') : ''}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── STEP: chat ── */}
          {step === 'chat' && (
            <>
              {/* Chat toolbar */}
              {!closed && (
                <div
                  style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid #E2E8F0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexShrink: 0,
                    background: '#FAFAFA',
                  }}
                >
                  <button
                    onClick={resetToChoice}
                    style={{ ...btnSecondary, padding: '6px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <ArrowLeft style={{ width: 12, height: 12 }} /> Voltar
                  </button>
                  <button
                    onClick={() => setCloseConfirm(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      background: '#FEE2E2',
                      color: '#DC2626',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Lock style={{ width: 13, height: 13 }} /> Encerrar
                  </button>
                </div>
              )}

              {/* Closed banner */}
              {closed && (
                <div style={{ padding: '14px 20px', background: '#FEF3C7', color: '#92400E', fontSize: 13, flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Lock style={{ width: 15, height: 15 }} /> Conversa encerrada
                  </div>
                  {transcriptAttached && (
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: '#78350F' }}>
                      Transcrição do chat anexada ao chamado.
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['open', 'in_progress', 'waiting_client'].includes(ticketStatus || '') && ticketId && (
                      <button
                        onClick={async () => {
                          setError(null);
                          try {
                            const res = await fetch(`${API_BASE}/conversations/resume-for-ticket`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                              credentials: 'include',
                              body: JSON.stringify({ ticketId }),
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data?.message || 'Erro ao continuar');
                            const conv = data?.conversation ?? data?.data?.conversation ?? data;
                            const convId = conv?.id ?? conversationId;
                            setConversationId(convId);
                            setChatState(ticketId, convId, 'chat', activeCompanyId || client?.id);
                            setClosed(false);
                            if (convId) loadMessages(convId);
                          } catch (e: any) {
                            setError(errMsg(e));
                          }
                        }}
                        style={{ ...btnPrimary, padding: '9px 16px', fontSize: 13, background: 'linear-gradient(135deg, #059669, #10B981)' }}
                      >
                        Continuar conversa
                      </button>
                    )}
                    <button onClick={resetToChoice} style={{ ...btnPrimary, padding: '9px 16px', fontSize: 13 }}>
                      Nova conversa
                    </button>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div
                ref={chatBodyRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: 0,
                }}
              >
                {/* Botão "Carregar mensagens anteriores" */}
                {hasMoreMessages && (
                  <div style={{ textAlign: 'center', paddingBottom: 8 }}>
                    <button
                      onClick={loadMoreMessages}
                      disabled={loadingMoreMessages}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '5px 14px', background: '#F1F5F9', border: '1px solid #E2E8F0',
                        borderRadius: 20, color: '#475569', fontSize: 11, fontWeight: 600,
                        cursor: loadingMoreMessages ? 'wait' : 'pointer', opacity: loadingMoreMessages ? 0.6 : 1,
                      }}
                    >
                      {loadingMoreMessages ? 'Carregando...' : '↑ Mensagens anteriores'}
                    </button>
                  </div>
                )}
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 32, margin: 'auto' }}>
                    Nenhuma mensagem ainda.
                  </div>
                ) : (
                  messages
                    .filter((m: any) => m.messageType !== 'internal')
                    .map((m: any) => {
                      const isSystem = m.messageType === 'system' || m.messageType === 'status_change';
                      const isMe = !isSystem && m.authorType === 'contact';

                      if (isSystem) {
                        const isTranscript = String(m.content || '').includes('Transcrição do Chat');
                        return (
                          <div
                            key={m.id}
                            style={{
                              textAlign: 'center',
                              fontSize: isTranscript ? 11 : 11,
                              color: '#94A3B8',
                              padding: isTranscript ? '8px 12px' : '4px 8px',
                              background: isTranscript ? '#F8FAFC' : 'transparent',
                              borderRadius: isTranscript ? 8 : 0,
                              border: isTranscript ? '1px solid #E2E8F0' : 'none',
                              whiteSpace: 'pre-wrap',
                              fontFamily: isTranscript ? 'monospace' : 'inherit',
                              textAlign: isTranscript ? 'left' : 'center',
                            } as any}
                          >
                            {m.content}
                          </div>
                        );
                      }

                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                          {!isMe && (
                            <div
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 10,
                                background: '#E2E8F0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#475569',
                                flexShrink: 0,
                                marginRight: 8,
                                alignSelf: 'flex-end',
                              }}
                            >
                              {(m.authorName || 'S').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div
                            style={{
                              maxWidth: '78%',
                              padding: '10px 14px',
                              borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                              background: isMe ? 'linear-gradient(135deg, #2563EB, #3B82F6)' : '#F1F5F9',
                              color: isMe ? '#fff' : '#1E293B',
                              fontSize: 14,
                              lineHeight: 1.45,
                              boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                            }}
                          >
                            {!isMe && (
                              <span style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748B', marginBottom: 3 }}>
                                {m.authorName}
                              </span>
                            )}
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</p>
                            <span style={{ fontSize: 10, opacity: 0.75, marginTop: 4, display: 'block', textAlign: isMe ? 'right' : 'left' }}>
                              {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              {!closed && (
                <form
                  onSubmit={sendMessage}
                  style={{
                    padding: '12px 16px',
                    borderTop: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      className="chat-input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Digite sua mensagem..."
                      disabled={!canSendInConversation}
                      style={{ flex: 1, ...inputStyle, borderRadius: 12, padding: '11px 16px' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (input.trim() && !sending && canSendInConversation) sendMessage(e as any);
                        }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={sending || !input.trim() || !canSendInConversation}
                      style={{
                        ...btnPrimary,
                        padding: '11px 16px',
                        borderRadius: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: input.trim() && !sending && canSendInConversation ? 1 : 0.5,
                        flexShrink: 0,
                      }}
                    >
                      <Send style={{ width: 20, height: 20 }} />
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Close confirmation modal ── */}
      {closeConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setCloseConfirm(false)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: 28,
              maxWidth: 340,
              width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Lock style={{ width: 18, height: 18, color: '#DC2626' }} />
              </div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#0F172A' }}>Encerrar conversa</p>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              Deseja encerrar esta conversa? O chamado continuará aberto e será tratado pela equipe de suporte.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => closeConversation()}
                style={{
                  padding: '11px 16px',
                  background: '#FEF2F2',
                  border: '1.5px solid #FECACA',
                  borderRadius: 10,
                  color: '#DC2626',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Sim, encerrar conversa
              </button>
              <button
                onClick={() => setCloseConfirm(false)}
                style={{ padding: '9px 16px', background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 12, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
