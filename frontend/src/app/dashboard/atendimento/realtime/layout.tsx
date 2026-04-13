import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

/** Evita falhas de pré-render / cache agressivo nesta árvore (página muito pesada). */
export const dynamic = 'force-dynamic';

export default function RealtimeSectionLayout({ children }: { children: ReactNode }) {
  void children;
  redirect('/dashboard/atendimento');
  return <>{children}</>;
}
