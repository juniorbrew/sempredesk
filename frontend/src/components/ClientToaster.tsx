'use client';

import { Toaster } from 'react-hot-toast';

/** Toaster só no cliente — evita erros de RSC/hidratação com react-hot-toast no layout raiz. */
export function ClientToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: { fontFamily: 'Inter, sans-serif', fontSize: 13, borderRadius: 10 },
        success: { style: { background: '#F0FDF4', color: '#15803D', border: '1px solid #86EFAC' } },
        error: { style: { background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5' } },
      }}
    />
  );
}
