'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useRealtimeConversation, useRealtimeTicket } from '@/lib/realtime';
import {
  MessageSquare, Send, Phone, RefreshCw, Lock, ExternalLink, Plus, Link2, Globe,
  Check, Search, X, CheckCircle2, User, Mail, MapPin, Building2, Hash,
} from 'lucide-react';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import ContactValidationBanner, { type ResolvedData } from '@/components/atendimento/ContactValidationBanner';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Formata número de WhatsApp para exibição: remove prefixo 55 e aplica máscara BR */
function formatWhatsApp(raw?: string | null): string {
  if (!raw) return '';
  // Remove tudo que não é dígito
  const digits = raw.replace(/\D/g, '');
  // LID: identificador interno do WhatsApp (14+ dígitos) — não é número de telefone real
  if (digits.length >= 14) return '';
  // Remove prefixo do país (55) se presente e resultar em 10-11 dígitos BR
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  // Celular BR: (XX) 9 XXXX-XXXX
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,3)} ${local.slice(3,7)}-${local.slice(7)}`;
  // Fixo BR:   (XX) XXXX-XXXX
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`;
  return digits;
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

// ── main component ────────────────────────────────────────────────────────────
export default function AtendimentoPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'no_ticket' | 'linked' | 'closed'>(() => {
    try { return (localStorage.getItem('atend_filter') as any) || 'all'; } catch { return 'all'; }
  });
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'portal'>(() => {
    try { return (localStorage.getItem('atend_channel') as any) || 'all'; } catch { return 'all'; }
  });
  const [input, setInput] = useState('');
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
  const [startClientId, setStartClientId] = useState('');
  const [startClientName, setStartClientName] = useState('');
  const [startContactId, setStartContactId] = useState('');
  const [startContacts, setStartContacts] = useState<any[]>([]);
  const [startContactSearch, setStartContactSearch] = useState('');
  const [startingConv, setStartingConv] = useState(false);
  const [loadingStartContacts, setLoadingStartContacts] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [networks, setNetworks] = useState<any[]>([]);
  const [createCustomers, setCreateCustomers] = useState<any[]>([]);
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

  const selectedRef = useRef<any>(null);
  selectedRef.current = selected;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── helpers ──
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

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
        (channelFilter === 'portal' || channelFilter === 'all')
          ? api.getTicketConversations({ origin: channelFilter === 'portal' ? 'portal' : undefined, status: filter === 'closed' ? 'closed' : 'active', perPage: 50 }).catch(() => [] as any)
          : Promise.resolve([]),
      ]);
      const convArr = Array.isArray(convList) ? convList : convList?.data ?? [];
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
    setLoadingChat(true);
    setCurrentTicket(null);
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      const [customersRes, ticketRes, teamRes] = await Promise.all([
        api.getCustomers({ perPage: 200 }),
        (ticketId || conv.ticketId) ? api.getTicket(ticketId || conv.ticketId).catch(() => null) : null,
        api.getTeam().catch(() => null),
      ]);
      const customersArr: any[] = customersRes?.data || customersRes || [];
      // Se o cliente da conversa não está na lista paginada, busca individualmente
      if (conv.clientId && !customersArr.find((c: any) => c.id === conv.clientId)) {
        try { const r: any = await api.getCustomer(conv.clientId); if (r) customersArr.push(r?.data ?? r); } catch {}
      }
      setCustomers(customersArr);
      if (ticketRes) setCurrentTicket(ticketRes);
      // Monta lista de agentes e garante que o responsável do ticket esteja nela
      let teamArr: any[] = teamRes ? (Array.isArray(teamRes) ? teamRes : teamRes?.data ?? []) : [];
      if (ticketRes?.assignedTo && !teamArr.find((u: any) => String(u.id) === String(ticketRes.assignedTo))) {
        try {
          const m: any = await api.getTeamMember(ticketRes.assignedTo);
          const member = m?.data ?? m;
          if (member?.id) teamArr = [...teamArr, member];
        } catch {}
      }
      if (teamArr.length > 0) setTeam(teamArr);
      const msgs = isTicket && ticketId
        ? (await api.getMessages(ticketId, false) || [])
        : (await api.getConversationMessages(conv.id) || []);
      setMessages(Array.isArray(msgs) ? msgs : msgs?.data ?? []);
      if (conv.clientId) {
        try { const ct = await api.getContacts(conv.clientId); setContacts(Array.isArray(ct) ? ct : (ct as any)?.data ?? []); } catch { setContacts([]); }
      }
    } catch (e) { console.error(e); }
    setLoadingChat(false);
  };

  const reloadMessages = async (conv: any) => {
    if (!conv) return;
    try {
      const isTicket = conv.type === 'ticket' || conv.id?.startsWith?.('ticket:');
      const ticketId = isTicket ? (conv.ticketId || conv.id?.replace?.(/^ticket:/, '')) : conv.ticketId;
      const msgs = isTicket && ticketId
        ? (await api.getMessages(ticketId, false) || [])
        : (await api.getConversationMessages(conv.id) || []);
      setMessages(Array.isArray(msgs) ? msgs : msgs?.data ?? []);
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
  const openEndFlow = () => { setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 }); setShowEndModal(true); };
  const handleKeepOpen = () => { setShowEndModal(false); setKeepOpenReason(''); setShowKeepOpenModal(true); };
  const handleCloseTicket = () => { setShowEndModal(false); setCloseForm({ solution:'', rootCause:'', timeSpent:'', internalNote:'', complexity:0 }); setShowCloseForm(true); };

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
    if (!closeForm.solution.trim()) { showToast('Solução aplicada é obrigatória', 'error'); return; }
    const tid = selected?.ticketId || (isTicketType ? selected?.id?.replace?.(/^ticket:/, '') : null);
    try {
      const timeSpentMin = closeForm.timeSpent ? parseInt(closeForm.timeSpent) : 0;
      if (!isTicketType && selected?.id) {
        await api.closeConversation(selected.id, { keepTicketOpen: false, solution: closeForm.solution, rootCause: closeForm.rootCause || undefined, timeSpentMin: timeSpentMin || undefined, internalNote: closeForm.internalNote?.trim() || undefined, complexity: closeForm.complexity || undefined });
      } else if (tid) {
        await api.resolveTicket(tid, { resolutionSummary: closeForm.solution, timeSpentMin, rootCause: closeForm.rootCause || undefined, complexity: closeForm.complexity || undefined });
        if (closeForm.internalNote.trim()) await api.addMessage(tid, { content: closeForm.internalNote, messageType: 'internal' });
        await api.closeTicket(tid);
      } else { showToast('Ticket não encontrado', 'error'); return; }
      setShowCloseForm(false);
      showToast('Atendimento encerrado com sucesso!');
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
    setStartClientId(''); setStartClientName(''); setStartContactId(''); setStartContacts([]); setStartContactSearch('');
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
    if (!input.trim() || !selected?.id) return;
    const ticketId = isTicketType ? (selected.ticketId || selected.id?.replace?.(/^ticket:/, '')) : selected?.ticketId;
    const isPortalNoTicket = selected?.channel === 'portal' && !ticketId && !isTicketType;
    if (!isPortalNoTicket && !ticketId && !isTicketType) return;
    setSending(true);
    try {
      const channel = selected?.channel || 'whatsapp';
      if (isTicketType && ticketId) await api.addMessage(ticketId, { content: input, messageType: 'comment' });
      else if (channel === 'whatsapp' && ticketId) await api.sendWhatsappFromTicket(ticketId, input);
      else await api.addConversationMessage(selected.id, { content: input });
      setInput('');
      await reloadMessages(selected);
      inputRef.current?.focus();
    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao enviar', 'error'); }
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
  const canSend = hasTicket || isPortalNoTicket;
  const ticketIdForRealtime = isTicketType ? (selected?.ticketId || selected?.id?.replace?.(/^ticket:/, '')) : null;
  const conversationIdForRealtime = !isTicketType ? selected?.id : null;

  const filteredConversations = conversations.filter(c => {
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
    if (!selected?.clientId) { setClientTickets([]); return; }
    api.getTickets({ clientId: selected.clientId, perPage: 20 })
      .then((r: any) => setClientTickets(r?.data ?? r ?? []))
      .catch(() => setClientTickets([]));
  }, [selected?.clientId]);
  useEffect(() => { api.getCustomers({ perPage: 200 }).then((r: any) => setCustomers(r?.data ?? r ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (showLinkModal && (selected?.clientId || selected?.contactId)) searchTicketsForLink(); }, [showLinkModal, selected?.clientId, selected?.contactId, searchTicketsForLink]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  // ── realtime ──
  useRealtimeConversation(conversationIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      return [...m, msg];
    });
  });

  useRealtimeTicket(ticketIdForRealtime ?? null, (msg) => {
    if (!msg || !selected) return;
    setMessages((m) => {
      const exists = m.some((x: any) => String(x.id) === String(msg.id));
      if (exists) return m.map((x: any) => (String(x.id) === String(msg.id) ? { ...x, ...msg } : x));
      return [...m, msg];
    });
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
            {([['all','Todos'],['whatsapp','WhatsApp'],['portal','Portal']] as const).map(([ch, label]) => (
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
          <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: S.border, flexShrink: 0 }}>
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
                  <button key={c.id} onClick={() => setSelected(c)}
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
                        {c.unreadCount > 0 && (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 9, fontWeight: 600, background: S.accent, color: '#fff', minWidth: 18, textAlign: 'center' }}>{c.unreadCount}</span>
                        )}
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
          ) : loadingChat ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div style={{ padding: '14px 20px', borderBottom: S.border, background: S.bg, flexShrink: 0 }}>
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
                      <button onClick={openEndFlow}
                        style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
                        Encerrar
                      </button>
                    )}
                  </div>
                </div>

                {/* Warning banners */}
                {!hasTicket && !isPortalNoTicket && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12, color: '#92400E' }}>
                    Sem ticket vinculado. Crie ou vincule um ticket para enviar mensagens e registrar o atendimento.
                  </div>
                )}

                {/* Contact validation banner — exibido apenas quando há ticket */}
                {currentTicket?.id && (
                  <ContactValidationBanner
                    key={currentTicket.id}
                    ticketId={currentTicket.id}
                    initialCustomerSelectedAt={currentTicket.customerSelectedAt ?? null}
                    initialUnlinkedContact={currentTicket.unlinkedContact ?? false}
                    initialCustomerName={customerName(selected?.clientId) !== '—' ? customerName(selected?.clientId) : null}
                    onResolved={(data: ResolvedData) => {
                      setCurrentTicket((prev: any) => prev ? { ...prev, ...data } : prev);
                    }}
                  />
                )}
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16, background: S.bg2 }}>
                {messages.length === 0 ? (
                  <div style={{ margin: 'auto', textAlign: 'center', color: S.txt3, fontSize: 13 }}>
                    <MessageSquare size={32} style={{ margin: '0 auto 10px', opacity: 0.25 }} />
                    <p style={{ margin: 0 }}>Nenhuma mensagem ainda</p>
                  </div>
                ) : (
                  messages.filter((m: any) => m.messageType !== 'internal').map((m: any) => {
                    const isContact = m.authorType === 'contact';
                    const isSystem = m.messageType === 'system';
                    const t = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    const col = avatarColor(m.authorName || '?');

                    if (isSystem) {
                      return (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                          <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '5px 14px', fontSize: 11, color: '#4338CA', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4338CA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z"/></svg>
                            {m.content}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: isContact ? 'flex-start' : 'flex-end' }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: S.txt2, paddingLeft: isContact ? 40 : 0, paddingRight: isContact ? 0 : 40 }}>
                          {m.authorName}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexDirection: isContact ? 'row' : 'row-reverse' }}>
                          <div style={{ width: 30, height: 30, borderRadius: '50%', background: isContact ? col : S.accentLight, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isContact ? '#fff' : S.accent, fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                            {initials(m.authorName || '?')}
                          </div>
                          <div style={{
                            maxWidth: 420, padding: '11px 16px', fontSize: 13, lineHeight: 1.6, position: 'relative',
                            background: isContact ? S.bg : S.accent,
                            color: isContact ? S.txt : '#fff',
                            border: isContact ? `1px solid rgba(0,0,0,.09)` : 'none',
                            borderRadius: isContact ? '18px 18px 18px 4px' : '18px 18px 4px 18px',
                            boxShadow: isContact ? '0 1px 3px rgba(0,0,0,.06)' : '0 2px 8px rgba(79,70,229,.25)',
                          }}>
                            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                              <span style={{ fontSize: 10, color: isContact ? S.txt3 : 'rgba(255,255,255,.6)' }}>{t}</span>
                              {!isContact && <CheckCircle2 size={11} style={{ color: 'rgba(255,255,255,.6)' }} />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              {!isClosed && (
                <div style={{ borderTop: S.border, background: S.bg, padding: 0, flexShrink: 0 }}>
                  {/* Toolbar */}
                  <div style={{ display: 'flex', gap: 2, padding: '10px 16px 8px', borderBottom: S.border }}>
                    {[
                      { label: 'Arquivo', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> },
                      { label: 'Imagem', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
                      { label: 'Resposta rápida', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
                      { label: 'Nota interna', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> },
                      { label: 'Macro', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
                    ].map(({ label, icon }) => (
                      <button key={label} type="button"
                        style={{ padding: '5px 10px', borderRadius: 7, background: 'transparent', border: 'none', fontSize: 12, color: S.txt2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', transition: 'background .1s' }}>
                        {icon}{label}
                      </button>
                    ))}
                    {/* Emoji picker real */}
                    <EmojiPicker onSelect={insertEmoji} position="top" />
                  </div>
                  <form onSubmit={sendMessage}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '12px 16px' }}>
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any); } }}
                        placeholder={canSend ? (isWhatsapp ? 'Mensagem WhatsApp... (Enter para enviar)' : 'Digite sua mensagem...') : 'Vincule um ticket para enviar mensagens...'}
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
                      <button type="submit" disabled={sending || !canSend || !input.trim()}
                        style={{
                          width: 40, height: 40, borderRadius: 11, border: 'none',
                          background: sending || !canSend || !input.trim() ? '#E2E8F0' : S.accent,
                          cursor: sending || !canSend || !input.trim() ? 'not-allowed' : 'pointer',
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
            const contact = contacts.find((c: any) => c.id === selected?.contactId) || contacts[0];
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
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 500, background: '#FEF3C7', color: '#92400E' }}>Premium</span>
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 500, background: isWhatsapp ? '#DCFCE7' : S.accentLight, color: isWhatsapp ? '#15803D' : S.accent }}>
                      {isWhatsapp ? 'WhatsApp' : 'Portal'}
                    </span>
                    <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 500, background: '#D1FAE5', color: '#065F46' }}>Ativo</span>
                  </div>
                </div>

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

      {/* ══════════ MODAL: Nova Conversa ══════════ */}
      {showStartModal && (() => {
        const existingConv = startContactId ? conversations.find((c: any) => c.contactId === startContactId && c.status === 'active') : null;
        const filteredContacts = startContacts.filter((c: any) => {
          if (!startContactSearch.trim()) return true;
          const q = startContactSearch.toLowerCase();
          return c.name?.toLowerCase().includes(q) || c.whatsapp?.includes(q) || c.phone?.includes(q);
        });
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setShowStartModal(false)}>
            <div style={{ background: '#fff', borderRadius: 16, width: 480, maxWidth: 'calc(100vw - 32px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Nova conversa</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>Selecione o cliente e o contato para iniciar uma conversa no WhatsApp.</p>
                </div>
                <button onClick={() => setShowStartModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cliente</label>
                  <select value={startClientId} onChange={(e) => { const opt = e.target.options[e.target.selectedIndex]; handleStartClientChange(e.target.value, opt.text); }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #E2E8F0', fontSize: 14, color: '#0F172A', background: '#fff', outline: 'none' }}>
                    <option value="">Selecione um cliente...</option>
                    {customers.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.companyName || c.name}</option>)}
                  </select>
                </div>
                {startClientId && (
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Contato <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(com WhatsApp ou telefone)</span>
                    </label>
                    <div style={{ position: 'relative', marginBottom: 10 }}>
                      <Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: '#94A3B8' }} />
                      <input value={startContactSearch} onChange={e => setStartContactSearch(e.target.value)} placeholder="Buscar por nome ou telefone..." autoFocus
                        style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const }} />
                    </div>
                    {loadingStartContacts ? (
                      <div style={{ textAlign: 'center', padding: 24, color: '#94A3B8', fontSize: 13 }}>Carregando contatos...</div>
                    ) : filteredContacts.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8', fontSize: 13 }}>
                        {startContacts.length === 0 ? 'Nenhum contato com WhatsApp cadastrado.' : 'Nenhum contato encontrado.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                        {filteredContacts.map((c: any) => {
                          const isSel = startContactId === c.id;
                          const phone = c.whatsapp || c.phone || '';
                          return (
                            <button key={c.id} onClick={() => setStartContactId(isSel ? '' : c.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${isSel ? '#4F46E5' : '#E2E8F0'}`, background: isSel ? '#EEF2FF' : '#fff', cursor: 'pointer', textAlign: 'left', transition: 'all 0.12s' }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: isSel ? '#4F46E5' : '#E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSel ? '#fff' : '#64748B', fontSize: 13, fontWeight: 700 }}>
                                {c.name?.charAt(0)?.toUpperCase() || '?'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                                {phone && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} />{phone}</p>}
                              </div>
                              {isSel && <Check size={18} color="#4F46E5" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ padding: '16px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
                <button onClick={() => setShowStartModal(false)} style={{ padding: '10px 18px', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                <button disabled={!startContactId || startingConv}
                  onClick={async () => {
                    if (!startClientId || !startContactId) return;
                    setStartingConv(true);
                    try {
                      if (existingConv) {
                        setShowStartModal(false); setFilter('all'); setChannelFilter('all');
                        const [cl, tc] = await Promise.all([api.getConversations({ status: 'active', hasTicket: 'all' }), api.getTicketConversations({ status: 'active', perPage: 50 }).catch(() => [])]);
                        const ca = Array.isArray(cl) ? cl : cl?.data ?? [];
                        const ta = Array.isArray(tc) ? tc : tc?.data ?? [];
                        const merged = [...ca.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ta].sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
                        setConversations(merged);
                        setSelected(merged.find((c: any) => sameItem(c, existingConv)) || existingConv);
                        showToast('Conversa aberta!');
                      } else {
                        const res: any = await api.startAgentConversation({ clientId: startClientId, contactId: startContactId, channel: 'whatsapp' });
                        const conv = res?.data ?? res;
                        setShowStartModal(false); setFilter('all'); setChannelFilter('all');
                        const [cl, tc] = await Promise.all([api.getConversations({ status: 'active', hasTicket: 'all' }), api.getTicketConversations({ status: 'active', perPage: 50 }).catch(() => [])]);
                        const ca = Array.isArray(cl) ? cl : cl?.data ?? [];
                        const ta = Array.isArray(tc) ? tc : tc?.data ?? [];
                        const merged = [...ca.map((c: any) => ({ ...c, type: c.type || 'conversation' })), ...ta].sort((a: any, b: any) => new Date(b.lastMessageAt || b.createdAt).getTime() - new Date(a.lastMessageAt || a.createdAt).getTime());
                        setConversations(merged);
                        setSelected(merged.find((c: any) => sameItem(c, conv)) || conv || null);
                        showToast('Nova conversa iniciada!');
                      }
                    } catch (e: any) { showToast(e?.response?.data?.message || 'Erro ao iniciar conversa', 'error'); }
                    setStartingConv(false);
                  }}
                  style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: !startContactId ? '#E2E8F0' : existingConv ? '#4F46E5' : 'linear-gradient(135deg,#4F46E5,#6366F1)', color: !startContactId ? '#94A3B8' : '#fff', fontSize: 13, fontWeight: 700, cursor: !startContactId ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={14} />
                  {startingConv ? 'Aguarde...' : existingConv ? 'Abrir conversa' : 'Iniciar conversa'}
                </button>
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
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 5 }}>Cliente <span style={{ color: '#EF4444' }}>*</span></label>
                  <select value={createForm.clientId} onChange={e => setCreateForm(f => ({ ...f, clientId: e.target.value }))}
                    style={{ width: '100%', padding: '9px 10px', border: `1.5px solid ${createForm.clientId ? '#E2E8F0' : '#FCA5A5'}`, borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}>
                    <option value=''>Selecione o cliente...</option>
                    {createCustomers.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.companyName}</option>)}
                  </select>
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
              <button onClick={handleCloseTicket} style={{ padding: '14px 16px', border: '1.5px solid #FED7AA', borderRadius: 10, background: '#FFF7ED', color: '#C2410C', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }}>
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
                    <option value="human_error">Erro humano</option>
                    <option value="system_failure">Falha de sistema</option>
                    <option value="configuration">Configuração</option>
                    <option value="network">Rede/Conectividade</option>
                    <option value="third_party">Terceiro/Fornecedor</option>
                    <option value="user_training">Treinamento do usuário</option>
                    <option value="unknown">Desconhecida</option>
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
              <button onClick={confirmCloseTicket}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#EA580C', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
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
