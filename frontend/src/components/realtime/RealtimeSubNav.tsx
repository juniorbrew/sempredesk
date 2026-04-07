'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

type TabDef = {
  key: string;
  label: string;
  href: string;
  hash?: string;
};

const TABS: TabDef[] = [
  { key: 'realtime', label: 'Real-Time', href: '/dashboard/atendimento/realtime' },
  { key: 'produtividade', label: 'Produtividade', href: '/dashboard/atendimento/realtime/produtividade' },
  { key: 'sla', label: 'SLA', href: '/dashboard/atendimento/realtime#sla-indicadores', hash: 'sla-indicadores' },
  {
    key: 'operadores',
    label: 'Operadores',
    href: '/dashboard/atendimento/realtime#secao-operadores',
    hash: 'secao-operadores',
  },
];

function tabActive(pathname: string, hash: string, tab: TabDef): boolean {
  if (tab.key === 'produtividade') {
    return pathname.startsWith('/dashboard/atendimento/realtime/produtividade');
  }
  if (tab.key === 'realtime') {
    return pathname === '/dashboard/atendimento/realtime' && (!hash || hash === '');
  }
  if (tab.hash) {
    return pathname === '/dashboard/atendimento/realtime' && hash === tab.hash;
  }
  return false;
}

export function RealtimeSubNav({ tvMode = false }: { tvMode?: boolean }) {
  const pathname = usePathname() || '';
  const [hash, setHash] = useState('');

  useEffect(() => {
    const read = () => setHash(typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '');
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  return (
    <nav
      className={clsx(
        'flex flex-wrap gap-1 rounded-xl border p-1',
        tvMode
          ? 'border-slate-600 bg-slate-900/80 text-slate-200'
          : 'border-slate-200 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-900/50',
      )}
      aria-label="Secções do painel real-time"
    >
      {TABS.map((tab) => {
        const active = tabActive(pathname, hash, tab);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={!tab.hash}
            className={clsx(
              'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              tvMode ? 'md:px-5 md:py-3 md:text-base' : '',
              active
                ? tvMode
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300'
                : tvMode
                  ? 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  : 'text-slate-600 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-800/80',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
