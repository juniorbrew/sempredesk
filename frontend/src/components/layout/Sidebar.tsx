'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Network, LayoutDashboard, Ticket, Users, FileText, Monitor,
  Users2, BookOpen, Bell, Settings, LogOut, Headphones,
  FolderTree, Tag, Layers, ChevronDown, Database, MessageCircle, BarChart2, AlertTriangle,
  Sun, Moon, MessageSquare, Smartphone,
} from 'lucide-react';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import { useTheme } from '@/components/ThemeProvider';
import { api } from '@/lib/api';
import clsx from 'clsx';

const MAIN_NAV = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Dashboard', perm: 'dashboard.view' },
  { href: '/dashboard/atendimento', icon: MessageCircle,   label: 'Atendimento', perm: 'attendance.view' },
  { href: '/dashboard/chat-interno', icon: MessageSquare,   label: 'Chat interno', perm: 'chat.view' },
  { href: '/dashboard/tickets',     icon: Ticket,          label: 'Tickets', perm: 'ticket.view' },
  { href: '/dashboard/contracts',   icon: FileText,        label: 'Contratos', perm: 'contracts.view' },
  { href: '/dashboard/devices',     icon: Monitor,         label: 'Monitoramento PDV', perm: 'devices.view' },
  { href: '/dashboard/knowledge',   icon: BookOpen,        label: 'Base de Conhecimento', perm: 'knowledge.view' },
  { href: '/dashboard/reports',     icon: BarChart2,       label: 'Relatórios', perm: 'reports.view' },
];

const CADASTROS_NAV = [
  { href: '/dashboard/customers',     icon: Users,      label: 'Clientes', perm: 'customer.view' },
  { href: '/dashboard/networks',      icon: Network,    label: 'Redes', perm: 'networks.view' },
  { href: '/dashboard/departments',   icon: FolderTree, label: 'Departamentos', perm: 'settings.manage' },
  { href: '/dashboard/tags',          icon: Tag,        label: 'Tags', perm: 'settings.manage' },
  { href: '/dashboard/root-causes',   icon: AlertTriangle, label: 'Causa Raiz', perm: 'settings.manage' },
  { href: '/dashboard/categories',    icon: Tag,        label: 'Categorias', perm: 'settings.manage' },
  { href: '/dashboard/subcategories', icon: Layers,     label: 'Sub-Categorias', perm: 'settings.manage' },
  { href: '/dashboard/team',          icon: Users2,     label: 'Equipe e Usuários', perm: 'agent.view' },
];

const BOTTOM_NAV = [
  { href: '/dashboard/alerts',   icon: Bell,       label: 'Alertas', perm: 'alerts.view' },
  { href: '/dashboard/whatsapp', icon: Smartphone, label: 'WhatsApp', perm: 'settings.manage' },
  { href: '/dashboard/settings', icon: Settings,   label: 'Configurações', perm: 'settings.manage' },
];

const CADASTROS_PATHS = CADASTROS_NAV.map(n => n.href);

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const { theme, toggle } = useTheme();
  const isCadastrosActive = CADASTROS_PATHS.some(p => pathname.startsWith(p));
  const [cadastrosOpen, setCadastrosOpen] = useState(isCadastrosActive);
  const visibleCadastros = CADASTROS_NAV.filter((n) => hasPermission(user, n.perm));
  const [atendimentoCount, setAtendimentoCount] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !localStorage.getItem('accessToken')) return;
    api.getConversationsActiveCount()
      .then((r: any) => setAtendimentoCount((r?.total ?? r?.data?.total ?? 0) || 0))
      .catch(() => {});
    const interval = setInterval(() => {
      api.getConversationsActiveCount()
        .then((r: any) => setAtendimentoCount((r?.total ?? r?.data?.total ?? 0) || 0))
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const logout = async () => {
    try { await api.logout(); } catch {}
    clearAuth();
    router.push('/auth/login');
  };
  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <aside
      className={clsx('sidebar-mobile fixed left-0 top-0 h-full z-30 flex flex-col', isOpen && 'open')}
      style={{ width: 'var(--sidebar-width)', background: '#0F172A', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg,#1D4ED8,#3B82F6)', boxShadow: '0 4px 12px rgba(29,78,216,0.4)' }}>
          <Headphones className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-bold text-sm truncate">SempreDesk</p>
          <p className="text-xs truncate" style={{ color: '#64748B' }}>Sistema de Gestão</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest px-3 mb-2" style={{ color: '#334155' }}>Menu</p>

        {MAIN_NAV.filter((n) => hasPermission(user, n.perm)).map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} onClick={onClose}
            className={clsx('sidebar-item', isActive(href) && 'active')}
            style={{ position: 'relative' }}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1">{label}</span>
            {href === '/dashboard/atendimento' && atendimentoCount > 0 && (
              <span style={{
                minWidth: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#10B981', color: '#fff', fontSize: 10, fontWeight: 700, padding: '0 5px', flexShrink: 0,
              }}>
                {atendimentoCount > 99 ? '99+' : atendimentoCount}
              </span>
            )}
          </Link>
        ))}

        {/* Cadastros group — só aparece se o usuário tiver acesso a pelo menos 1 item */}
        {visibleCadastros.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setCadastrosOpen(p => !p)}
              className="sidebar-item w-full"
              style={{ color: isCadastrosActive ? '#E2E8F0' : '#64748B', background: isCadastrosActive ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
              <Database className="w-4 h-4 shrink-0" />
              <span className="truncate flex-1 text-left">Cadastros</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
                style={{ transform: cadastrosOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: '#475569' }} />
            </button>

            {cadastrosOpen && (
              <div style={{ marginLeft: 12, marginTop: 2, paddingLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.08)' }}>
                {visibleCadastros.map(({ href, icon: Icon, label }) => (
                  <Link key={href} href={href} onClick={onClose}
                    className={clsx('sidebar-item', isActive(href) && 'active')}
                    style={{ fontSize: 12, padding: '7px 10px' }}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

      </nav>

      {/* Bottom */}
      <div className="px-3 pb-3 space-y-0.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
        <p className="text-xs font-semibold uppercase tracking-widest px-3 mb-2" style={{ color: '#334155' }}>Sistema</p>

        {/* Theme toggle */}
        <button onClick={toggle} className="sidebar-item w-full text-left"
          title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}>
          {theme === 'dark'
            ? <Sun className="w-4 h-4 shrink-0" />
            : <Moon className="w-4 h-4 shrink-0" />}
          <span>{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
        </button>

        {BOTTOM_NAV.filter((n) => hasPermission(user, n.perm)).map(({ href, icon: Icon, label }) => (
          <Link key={href} href={href} onClick={onClose}
            className={clsx('sidebar-item', isActive(href) && 'active')}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{label}</span>
          </Link>
        ))}
        <button onClick={logout} className="sidebar-item w-full text-left" style={{ color: '#64748B' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; (e.currentTarget as HTMLElement).style.color = '#F87171'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.color = '#64748B'; }}>
          <LogOut className="w-4 h-4 shrink-0" />
          <span>Sair</span>
        </button>
      </div>

      {/* User */}
      <div className="px-4 py-3 mx-3 mb-3 rounded-xl"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ background: 'linear-gradient(135deg,#4F46E5,#6366F1)' }}>
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs font-semibold truncate">{user?.name}</p>
            <p className="text-xs capitalize truncate" style={{ color: '#64748B' }}>{user?.role}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
