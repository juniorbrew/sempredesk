'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Remove `realtime-tv-mode` de <html> quando o utilizador não está nas rotas que
 * usam useTvMode. Evita sidebar / top bar escondidas por CSS global (globals.css)
 * após navegação ou estado inconsistente.
 */
export function RealtimeTvModeClassGuard() {
  const pathname = usePathname() || '';

  useEffect(() => {
    const p = pathname.replace(/\/$/, '') || '';
    const onRealtimeTvCompactRoutes =
      p === '/dashboard/atendimento/realtime' ||
      p.startsWith('/dashboard/atendimento/realtime/produtividade');
    if (!onRealtimeTvCompactRoutes) {
      document.documentElement.classList.remove('realtime-tv-mode');
    }
  }, [pathname]);

  return null;
}
