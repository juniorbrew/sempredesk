'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import NavSidebar from '@/components/shared/NavSidebar';
import { ThemeProvider } from '@/components/ThemeProvider';
import NotificationBell from '@/components/NotificationBell';
import GlobalSearch from '@/components/GlobalSearch';
import { StatusSelector } from '@/components/StatusSelector';
import { Menu, X } from 'lucide-react';
import { PresenceProvider } from '@/components/PresenceProvider';
import { api } from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem('sidebar_expanded') === 'true'; } catch { return false; }
  });
  const [authChecked, setAuthChecked] = useState(false);

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
          <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.07)', padding: '6px 24px 6px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, height: 44, flexShrink: 0 }}>
            <GlobalSearch />
            <StatusSelector />
            <NotificationBell />
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
