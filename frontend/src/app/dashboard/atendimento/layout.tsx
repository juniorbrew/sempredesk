import type { ReactNode } from 'react';
import { Suspense } from 'react';
import AtendimentoOpenTicketSubrouteRedirect from '@/components/atendimento/AtendimentoOpenTicketSubrouteRedirect';

export default function AtendimentoLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <AtendimentoOpenTicketSubrouteRedirect />
      </Suspense>
      {children}
    </>
  );
}
