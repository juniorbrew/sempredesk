'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItemProps {
  icon: ReactNode;
  label: string;
  href: string;
  badge?: number;
  onClick?: () => void;
  expanded?: boolean;
}

export default function NavItem({ icon, label, href, badge, onClick, expanded }: NavItemProps) {
  const pathname = usePathname();
  // Atendimento principal não fica ativo em /dashboard/atendimento/realtime (sub-rota).
  const isActive =
    href === '/dashboard'
      ? pathname === href
      : href === '/dashboard/atendimento'
        ? pathname === '/dashboard/atendimento'
        : pathname.startsWith(href);

  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: expanded ? 'flex-start' : 'center',
        gap: expanded ? 10 : 0,
        width: expanded ? '100%' : 44,
        height: 44,
        borderRadius: 10,
        position: 'relative',
        flexShrink: 0,
        color: isActive ? '#fff' : 'rgba(255,255,255,0.45)',
        background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
        transition: 'background 0.1s, color 0.1s',
        textDecoration: 'none',
        padding: expanded ? '0 12px' : '0',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
      }}
      className="nav-item-hover"
    >
      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {expanded && (
        <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      )}
      {badge != null && badge > 0 && (
        <span
          style={{
            position: expanded ? 'static' : 'absolute',
            top: expanded ? undefined : 6,
            right: expanded ? undefined : 6,
            marginLeft: expanded ? 'auto' : undefined,
            minWidth: 16,
            height: 16,
            borderRadius: 99,
            background: '#EF4444',
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
