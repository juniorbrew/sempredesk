'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Ticket, BookOpen, User, LogOut } from 'lucide-react';
import { usePortalStore } from '@/store/portal.store';

const NAV = [
  { href: '/portal/dashboard',           icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/portal/dashboard/tickets',   icon: Ticket,          label: 'Meus Tickets' },
  { href: '/portal/dashboard/knowledge', icon: BookOpen,         label: 'Base de Conhecimento' },
  { href: '/portal/dashboard/profile',   icon: User,             label: 'Minha Conta' },
];

const S = {
  accent: '#4F46E5', accentL: '#EEF2FF', accentM: '#C7D2FE',
  txt: '#111118', txt2: '#6B6B80', txt3: '#A8A8BE',
  bd: 'rgba(0,0,0,0.07)',
};

export default function PortalSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { contact, client, clearAuth } = usePortalStore();

  const logout = () => { clearAuth(); router.push('/portal/login'); };

  const initials = (name: string) =>
    name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  const isActive = (href: string) =>
    href === '/portal/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <aside style={{
      width: 220, flexShrink: 0, background: '#fff', borderRight: `1px solid ${S.bd}`,
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Logo / Brand */}
      <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${S.bd}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: S.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Ticket style={{ width: 16, height: 16, color: '#fff' }} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: S.txt }}>SempreDesk</div>
            <div style={{ fontSize: 10, color: S.txt3 }}>Portal do Cliente</div>
          </div>
        </div>
      </div>

      {/* User info */}
      {(contact || client) && (
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${S.bd}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: S.accentL, color: S.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {initials(contact?.name || client?.tradeName || client?.companyName || '?')}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: S.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contact?.name || 'Cliente'}
              </div>
              <div style={{ fontSize: 11, color: S.txt3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {client?.tradeName || client?.companyName || ''}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: active ? 600 : 400,
                color: active ? S.accent : S.txt2,
                background: active ? S.accentL : 'transparent',
                borderLeft: active ? `2px solid ${S.accent}` : '2px solid transparent',
                transition: 'all .1s',
              }}>
              <Icon style={{ width: 16, height: 16, flexShrink: 0 }} strokeWidth={active ? 2 : 1.6} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div style={{ padding: '10px 10px 16px', borderTop: `1px solid ${S.bd}` }}>
        <button onClick={logout}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, border: 'none', background: 'transparent', fontSize: 13, color: S.txt3, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' as const }}>
          <LogOut style={{ width: 16, height: 16, flexShrink: 0 }} strokeWidth={1.6} />
          Sair
        </button>
      </div>
    </aside>
  );
}
