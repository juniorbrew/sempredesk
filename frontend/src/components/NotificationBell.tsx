'use client';
import { useEffect, useRef, useState } from 'react';
import { Bell, X, Ticket, MessageSquare, AlertTriangle, CheckCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { resolveWsBase } from '@/lib/ws-base';

const STORAGE_KEY = 'app_notifications';
const MAX = 50;

export interface AppNotification {
  id: string;
  type: 'ticket_created' | 'ticket_message' | 'sla_warning' | 'ticket_resolved';
  title: string;
  body: string;
  href?: string;
  read: boolean;
  createdAt: string;
}

function loadStored(): AppNotification[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveStored(ns: AppNotification[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ns.slice(0, MAX))); } catch {}
}

export default function NotificationBell() {
  const [notifs, setNotifs] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => { setNotifs(loadStored()); }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Socket listener
  useEffect(() => {
    let socket: any;
    let mounted = true;
    (async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      const base = resolveWsBase();
      if (!base) return;
      const { io } = await import('socket.io-client');
      socket = io(`${base}/realtime`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        auth: { token },
      });

      const addNotif = (n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => {
        if (!mounted) return;
        const notif: AppNotification = { ...n, id: Date.now().toString(), read: false, createdAt: new Date().toISOString() };
        setNotifs(prev => {
          const next = [notif, ...prev].slice(0, MAX);
          saveStored(next);
          return next;
        });
      };

      socket.on('ticket:created', (data: any) => addNotif({
        type: 'ticket_created',
        title: 'Novo ticket aberto',
        body: `${data.ticketNumber} — ${data.subject}`,
        href: `/dashboard/tickets/${data.id}`,
      }));

      socket.on('ticket:message', (data: any) => addNotif({
        type: 'ticket_message',
        title: 'Nova mensagem no ticket',
        body: `${data.ticketNumber}: ${data.content?.slice(0, 60)}`,
        href: `/dashboard/tickets/${data.ticketId}`,
      }));

      socket.on('sla:warning', (data: any) => addNotif({
        type: 'sla_warning',
        title: 'SLA em risco',
        body: `${data.ticketNumber} — ${data.subject}`,
        href: `/dashboard/tickets/${data.id}`,
      }));

      socket.on('ticket:resolved', (data: any) => addNotif({
        type: 'ticket_resolved',
        title: 'Ticket resolvido',
        body: `${data.ticketNumber} — ${data.subject}`,
        href: `/dashboard/tickets/${data.id}`,
      }));
    })();
    return () => { mounted = false; if (socket) socket.disconnect(); };
  }, []);

  const unread = notifs.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifs(prev => { const next = prev.map(n => ({ ...n, read: true })); saveStored(next); return next; });
  };

  const markRead = (id: string) => {
    setNotifs(prev => { const next = prev.map(n => n.id === id ? { ...n, read: true } : n); saveStored(next); return next; });
  };

  const clear = () => { setNotifs([]); saveStored([]); };

  const handleClick = (n: AppNotification) => {
    markRead(n.id);
    setOpen(false);
    if (n.href) router.push(n.href);
  };

  const iconFor = (type: AppNotification['type']) => {
    if (type === 'ticket_created') return <Ticket style={{ width: 14, height: 14, color: '#4F46E5' }} />;
    if (type === 'ticket_message') return <MessageSquare style={{ width: 14, height: 14, color: '#0D9488' }} />;
    if (type === 'sla_warning') return <AlertTriangle style={{ width: 14, height: 14, color: '#EF4444' }} />;
    return <CheckCircle style={{ width: 14, height: 14, color: '#10B981' }} />;
  };

  const bgFor = (type: AppNotification['type']) => {
    if (type === 'ticket_created') return '#EEF2FF';
    if (type === 'ticket_message') return '#ECFEFF';
    if (type === 'sla_warning') return '#FEE2E2';
    return '#DCFCE7';
  };

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `${m}min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button onClick={() => { setOpen(p => !p); if (!open) markAllRead(); }}
        style={{ position: 'relative', width: 36, height: 36, borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        title="Notificações">
        <Bell style={{ width: 16, height: 16, color: '#94A3B8' }} />
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 99, background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 44, right: 0, width: 340, maxHeight: 480, background: '#fff', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.18)', border: '1px solid #E2E8F0', zIndex: 9999, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Notificações</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {notifs.length > 0 && (
                <button onClick={clear} style={{ fontSize: 11, color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Limpar</button>
              )}
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94A3B8' }}>
                <Bell style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.3 }} />
                <p style={{ fontSize: 13, margin: 0 }}>Nenhuma notificação</p>
              </div>
            ) : notifs.map(n => (
              <button key={n.id} onClick={() => handleClick(n)}
                style={{ width: '100%', padding: '10px 16px', border: 'none', borderBottom: '1px solid #F8FAFC', background: n.read ? '#fff' : '#F8FAFF', cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: bgFor(n.type), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  {iconFor(n.type)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: n.read ? 500 : 700, color: '#0F172A', lineHeight: 1.3 }}>{n.title}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</p>
                </div>
                <span style={{ fontSize: 10, color: '#94A3B8', flexShrink: 0, marginTop: 2 }}>{timeAgo(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
