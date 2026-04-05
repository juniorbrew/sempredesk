import type { ReactNode } from 'react';

/** Evita falhas de pré-render / cache agressivo nesta árvore (página muito pesada). */
export const dynamic = 'force-dynamic';

export default function RealtimeSectionLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
