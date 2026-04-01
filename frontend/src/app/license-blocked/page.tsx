'use client';

import { Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

function LicenseBlockedContent() {
  const searchParams = useSearchParams();
  const reason =
    searchParams.get('reason') ||
    'O acesso foi bloqueado: empresa suspensa ou licença inválida/expirada. Contacte o suporte SempreDesk.';

  const sair = useCallback(() => {
    try {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('portal-auth');
    } catch {
      /* ignore */
    }
    window.location.href = '/auth/login';
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--bg, #0f172a)',
        color: 'var(--text, #e2e8f0)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          padding: 32,
          borderRadius: 16,
          border: '1px solid rgba(148,163,184,0.25)',
          background: 'rgba(30,41,59,0.6)',
        }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 12px', fontWeight: 700 }}>Acesso indisponível</h1>
        <p style={{ margin: '0 0 24px', lineHeight: 1.55, color: '#94a3b8', fontSize: 15 }}>{reason}</p>
        <button
          type="button"
          onClick={sair}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            border: 'none',
            background: '#4f46e5',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 12,
          }}
        >
          Sair e ir ao login da equipa
        </button>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
          É cliente?{' '}
          <a href="/portal/login" style={{ color: '#818cf8' }}>
            Portal do cliente
          </a>
        </p>
      </div>
    </div>
  );
}

export default function LicenseBlockedPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>A carregar…</div>}>
      <LicenseBlockedContent />
    </Suspense>
  );
}
