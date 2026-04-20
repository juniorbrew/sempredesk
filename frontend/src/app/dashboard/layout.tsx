'use client';
import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import NavSidebar from '@/components/shared/NavSidebar';
import { ThemeProvider } from '@/components/ThemeProvider';
import NotificationBell from '@/components/NotificationBell';
import GlobalSearch from '@/components/GlobalSearch';
import { StatusSelector } from '@/components/StatusSelector';
import { getAppVersionLabel } from '@/lib/app-version';
import { Menu, X } from 'lucide-react';
import { PresenceProvider } from '@/components/PresenceProvider';
import { RealtimeTvModeClassGuard } from '@/components/RealtimeTvModeClassGuard';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

const TOAST_ID = 'pause-approval-alert';

function PausePendingBanner({ count, onGo }: { count: number; onGo: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '10px 16px',
      background: '#FFFBEB', border: '1px solid #FCD34D',
      borderLeft: '4px solid #D97706', borderRadius: 10,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      minWidth: 320, maxWidth: 400,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>☕</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>
          {count === 1
            ? '1 solicitação de pausa pendente'
            : `${count} solicitações de pausa pendentes`}
        </span>
      </div>
      <button
        onClick={onGo}
        style={{
          padding: '5px 12px', borderRadius: 7,
          border: '1px solid #F59E0B', background: '#FEF3C7',
          color: '#92400E', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
          flexShrink: 0,
        }}
      >
        Ver agora →
      </button>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const appVersionLabel = getAppVersionLabel();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem('sidebar_expanded') === 'true'; } catch { return false; }
  });
  const [authChecked, setAuthChecked] = useState(false);
  const pendingCountRef = useRef(0);

  const toggleSidebar = () => setSidebarExpanded(v => {
    const next = !v;
    try { localStorage.setItem('sidebar_expanded', String(next)); } catch {}
    return next;
  });

  useEffect(() => { useAuthStore.persist.rehydrate(); }, []);
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    setAuthChecked(true);
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;
    api.me()
      .then((me: any) => {
        const u = useAuthStore.getState().user;
        if (u && me?.id === u.id && me?.permissions) {
          useAuthStore.setState({ user: { ...u, permissions: me.permissions } });
        }
      })
      .catch(() => {});
  }, [authChecked]);

  // ── Alerta global de pausas pendentes ──────────────────────────────────────
  const updatePauseToast = useCallback((count: number) => {
    pendingCountRef.current = count;
    if (count === 0) {
      toast.remove(TOAST_ID);
      return;
    }
    toast.custom(
      (t) => (
        <PausePendingBanner
          count={count}
          onGo={() => {
            toast.dismiss(TOAST_ID);
            router.push('/dashboard/supervisor');
          }}
        />
      ),
      { id: TOAST_ID, duration: Infinity, position: 'top-right' },
    );
  }, [router]);

  useEffect(() => {
    if (!authChecked) return;

    const checkPermission = () => {
      const u = useAuthStore.getState().user;
      return hasPermission(u, 'attendance.view_all');
    };

    const fetchCount = async () => {
      if (!checkPermission()) return;
      try {
        const data = await api.getPendingPauseRequests() as any[];
        const count = Array.isArray(data) ? data.length : 0;
        updatePauseToast(count);
      } catch {}
    };

    fetchCount();
    const interval = setInterval(fetchCount, 20_000);

    // WebSocket para atualizações instantâneas
    let socket: any = null;
    (async () => {
      try {
        const { getSharedRealtimeSocket } = await import('@/lib/realtime');
        socket = await getSharedRealtimeSocket();
        if (!socket) return;

        // Re-busca da API a cada evento — mais confiável que decrementar manualmente
        socket.on('pause:requested', () => fetchCount());
        socket.on('pause:approved',  () => fetchCount());
        socket.on('pause:rejected',  () => fetchCount());
        socket.on('pause:cancelled', () => fetchCount());
      } catch {}
    })();

    return () => {
      clearInterval(interval);
      toast.remove(TOAST_ID);
      if (socket) {
        socket.off('pause:requested');
        socket.off('pause:approved');
        socket.off('pause:rejected');
        socket.off('pause:cancelled');
      }
    };
  }, [authChecked, updatePauseToast]);
  // ───────────────────────────────────────────────────────────────────────────

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0F172A' }}>
        <div className="animate-spin w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <ThemeProvider>
      <PresenceProvider>
        <Suspense fallback={null}>
          <RealtimeTvModeClassGuard />
        </Suspense>
        <div className="min-h-screen theme-bg">
        {/* Mobile overlay */}
        <div
          className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />

        {/* Hamburger button — shown only on mobile via CSS */}
        <button
          className="hamburger-btn fixed top-4 left-4 z-40 flex items-center justify-center w-10 h-10 rounded-xl shadow-sm"
          style={{ display: 'none', background: '#1E293B', border: '1px solid rgba(255,255,255,0.08)' }}
          onClick={() => setSidebarOpen(p => !p)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
        </button>

        <NavSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} expanded={sidebarExpanded} onToggleExpand={toggleSidebar} />

        <main
          className="dashboard-main"
          style={{ marginLeft: sidebarExpanded ? 220 : 68, flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', transition: 'margin-left 0.2s ease' }}
        >
          {/* Thin global top bar */}
          <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.07)', padding: '6px 24px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44, flexShrink: 0, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#1E293B', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Versao ativa
              </span>
              <span
                title={`Build em uso: ${appVersionLabel}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: '#EEF2FF',
                  border: '1px solid #C7D2FE',
                  color: '#3730A3',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: '.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                {appVersionLabel}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <GlobalSearch />
            <StatusSelector />
            <NotificationBell />
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            {children}
          </div>
        </main>
        </div>
      </PresenceProvider>
    </ThemeProvider>
  );
}
