'use client';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, MessageCircle, MessageSquare, Ticket,
  Users, Users2, FileText, Monitor, BookOpen, BarChart2,
  Settings, Smartphone, LogOut, Headphones, ChevronRight,
  Network, FolderTree, Tag, Layers, ShieldCheck, Database,
  Activity,
} from 'lucide-react';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import NavItem from './NavItem';

const MAIN_ITEMS = [
  { href: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard',             perm: 'dashboard.view' },
  { href: '/dashboard/atendimento',  icon: MessageCircle,   label: 'Atendimento',            perm: 'attendance.view', badge: true },
  { href: '/dashboard/supervisor',   icon: Activity,        label: 'Supervisor',             perm: 'settings.manage' },
  { href: '/dashboard/chat-interno', icon: MessageSquare,   label: 'Chat interno',           perm: 'chat.view' },
  { href: '/dashboard/tickets',      icon: Ticket,          label: 'Tickets',                perm: 'ticket.view' },
  { href: '/dashboard/contracts',    icon: FileText,        label: 'Contratos',              perm: 'contracts.view' },
  { href: '/dashboard/devices',      icon: Monitor,         label: 'Monitoramento PDV',      perm: 'devices.view' },
  { href: '/dashboard/knowledge',    icon: BookOpen,        label: 'Base de Conhecimento',   perm: 'knowledge.view' },
  { href: '/dashboard/reports',      icon: BarChart2,       label: 'Relatórios',             perm: 'reports.view' },
];

const CADASTROS_ITEMS = [
  { href: '/dashboard/customers',     icon: Users,       label: 'Clientes',          perm: 'customer.view' },
  { href: '/dashboard/networks',      icon: Network,     label: 'Redes',             perm: 'networks.view' },
  { href: '/dashboard/departments',   icon: FolderTree,  label: 'Departamentos',     perm: 'settings.manage' },
  { href: '/dashboard/categories',    icon: Tag,         label: 'Categorias',        perm: 'settings.manage' },
  { href: '/dashboard/subcategories', icon: Layers,      label: 'Sub-Categorias',    perm: 'settings.manage' },
  { href: '/dashboard/team',          icon: Users2,      label: 'Equipe e Usuários', perm: 'agent.view' },
  { href: '/dashboard/perfis',        icon: ShieldCheck, label: 'Perfis de Acesso',  perm: 'settings.manage' },
];

const BOTTOM_ITEMS = [
  { href: '/dashboard/whatsapp',  icon: Smartphone, label: 'WhatsApp',       perm: 'settings.manage' },
  { href: '/dashboard/settings',  icon: Settings,   label: 'Configurações',  perm: 'settings.manage' },
];

const CADASTROS_PATHS = CADASTROS_ITEMS.map(n => n.href);

function UserDot({ name, expanded }: { name: string; expanded: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: expanded ? 10 : 0, padding: expanded ? '0 12px' : 0, overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          title={name}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#4F46E5,#6366F1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'default',
          }}
        >
          {initials || '?'}
        </div>
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: '#22C55E',
            border: '2px solid #16133D',
          }}
        />
      </div>
      {expanded && (
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
      )}
    </div>
  );
}

interface NavSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export default function NavSidebar({ isOpen, onClose, expanded = false, onToggleExpand }: NavSidebarProps) {
  const { user, clearAuth } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [atendimentoCount, setAtendimentoCount] = useState(0);
  const isCadastrosActive = CADASTROS_PATHS.some(p => pathname.startsWith(p));
  const [cadastrosOpen, setCadastrosOpen] = useState(isCadastrosActive);

  useEffect(() => {
    if (typeof window === 'undefined' || !localStorage.getItem('accessToken')) return;
    const fetch = () =>
      api.getConversationsActiveCount()
        .then((r: any) => setAtendimentoCount((r?.total ?? r?.data?.total ?? 0) || 0))
        .catch(() => {});
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, []);

  // auto-open cadastros when navigating to a cadastros route
  useEffect(() => {
    if (isCadastrosActive) setCadastrosOpen(true);
  }, [isCadastrosActive]);

  const logout = () => { clearAuth(); router.push('/auth/login'); };

  const visibleMain      = MAIN_ITEMS.filter(n => hasPermission(user, n.perm));
  const visibleCadastros = CADASTROS_ITEMS.filter(n => hasPermission(user, n.perm));
  const visibleBottom    = BOTTOM_ITEMS.filter(n => hasPermission(user, n.perm));

  const sidebarWidth = expanded ? 220 : 68;

  return (
    <>
      <style>{`
        .nav-item-hover:hover {
          background: rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.85) !important;
        }
        .nav-toggle-btn:hover {
          background: rgba(255,255,255,0.1) !important;
        }
        .nav-cadastros-sub {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-left: 8px;
          margin-top: 2px;
          border-left: 1px solid rgba(255,255,255,0.1);
          margin-left: 12px;
        }
      `}</style>

      <aside
        className={`sidebar-mobile${isOpen ? ' open' : ''}`}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100%',
          width: sidebarWidth,
          background: 'var(--color-nav, #16133D)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: expanded ? 'stretch' : 'center',
          paddingTop: 12,
          paddingBottom: 12,
          gap: 0,
          zIndex: 30,
          transition: 'width 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Logo + toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'space-between' : 'center',
          padding: expanded ? '0 12px' : 0,
          marginBottom: 20,
          flexShrink: 0,
        }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg,#1D4ED8,#3B82F6)',
              boxShadow: '0 4px 12px rgba(29,78,216,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            title="SempreDesk"
          >
            <Headphones size={18} color="#fff" strokeWidth={1.8} />
          </div>
          {expanded && (
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              SempreDesk
            </span>
          )}
          <button
            onClick={onToggleExpand}
            className="nav-toggle-btn"
            title={expanded ? 'Recolher menu' : 'Expandir menu'}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255,255,255,0.4)',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            <ChevronRight
              size={15}
              strokeWidth={2}
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
            />
          </button>
        </div>

        {/* Separator */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 12, marginLeft: expanded ? 12 : 18, marginRight: expanded ? 12 : 18 }} />

        {/* Main nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', alignItems: expanded ? 'stretch' : 'center', gap: 4, flex: 1, padding: expanded ? '0 8px' : 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {visibleMain.map(({ href, icon: Icon, label, badge }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              icon={<Icon size={18} strokeWidth={1.6} />}
              badge={badge ? atendimentoCount : undefined}
              onClick={onClose}
              expanded={expanded}
            />
          ))}

          {/* Cadastros group */}
          {visibleCadastros.length > 0 && (
            <>
              {/* Separator */}
              <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0', marginLeft: expanded ? 4 : 10, marginRight: expanded ? 4 : 10 }} />

              {expanded ? (
                /* Expanded: collapsible group */
                <div>
                  <button
                    onClick={() => setCadastrosOpen(v => !v)}
                    className="nav-item-hover"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      height: 40,
                      borderRadius: 10,
                      background: isCadastrosActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: isCadastrosActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)',
                      padding: '0 12px',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                      transition: 'background 0.1s, color 0.1s',
                    }}
                  >
                    <Database size={18} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 500, flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>Cadastros</span>
                    <ChevronRight
                      size={13}
                      strokeWidth={2}
                      style={{ transform: cadastrosOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0, opacity: 0.5 }}
                    />
                  </button>

                  {cadastrosOpen && (
                    <div className="nav-cadastros-sub">
                      {visibleCadastros.map(({ href, icon: Icon, label }) => (
                        <NavItem
                          key={href}
                          href={href}
                          label={label}
                          icon={<Icon size={16} strokeWidth={1.6} />}
                          onClick={onClose}
                          expanded={expanded}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Collapsed: icon-only items */
                visibleCadastros.map(({ href, icon: Icon, label }) => (
                  <NavItem
                    key={href}
                    href={href}
                    label={label}
                    icon={<Icon size={18} strokeWidth={1.6} />}
                    onClick={onClose}
                    expanded={false}
                  />
                ))
              )}
            </>
          )}
        </nav>

        {/* Bottom section */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: expanded ? 'stretch' : 'center', gap: 4, padding: expanded ? '0 8px' : 0 }}>
          {/* Separator */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', marginBottom: 8, marginLeft: expanded ? 4 : 10, marginRight: expanded ? 4 : 10 }} />

          {visibleBottom.map(({ href, icon: Icon, label }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              icon={<Icon size={18} strokeWidth={1.6} />}
              onClick={onClose}
              expanded={expanded}
            />
          ))}

          {/* Logout */}
          <button
            title={expanded ? undefined : 'Sair'}
            aria-label="Sair"
            onClick={logout}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: expanded ? 'flex-start' : 'center',
              gap: expanded ? 10 : 0,
              width: expanded ? '100%' : 44,
              height: 44,
              borderRadius: 10,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(255,255,255,0.35)',
              transition: 'background 0.1s, color 0.1s',
              marginTop: 4,
              padding: expanded ? '0 12px' : 0,
              boxSizing: 'border-box',
              whiteSpace: 'nowrap',
            }}
            className="nav-item-hover"
          >
            <LogOut size={18} strokeWidth={1.6} style={{ flexShrink: 0 }} />
            {expanded && <span style={{ fontSize: 13, fontWeight: 500 }}>Sair</span>}
          </button>

          {/* Separator */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '8px 0', marginLeft: expanded ? 4 : 10, marginRight: expanded ? 4 : 10 }} />

          {/* User avatar */}
          <div style={{ display: 'flex', justifyContent: expanded ? 'flex-start' : 'center', paddingBottom: 4 }}>
            <UserDot name={user?.name ?? '?'} expanded={expanded} />
          </div>
        </div>
      </aside>
    </>
  );
}
