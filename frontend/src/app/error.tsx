'use client';

import { useEffect } from 'react';

/**
 * Limite de erro da app (filhos do root layout).
 * Evita o ciclo "missing required error components, refreshing..." no dev.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        background: '#F1F5F9',
        color: '#0F172A',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Algo correu mal</h1>
      <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 20px', maxWidth: 420, textAlign: 'center' }}>
        {error.message || 'Ocorreu um erro inesperado. Pode tentar de novo.'}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          padding: '10px 20px',
          borderRadius: 10,
          border: 'none',
          fontWeight: 600,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: 'inherit',
          background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
          color: '#fff',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
