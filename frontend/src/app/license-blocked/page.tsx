'use client';

import { Suspense, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';

const btnPrimary: CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  borderRadius: 10,
  border: 'none',
  background: '#4f46e5',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  marginBottom: 10,
  textDecoration: 'none',
  display: 'block',
  textAlign: 'center',
  boxSizing: 'border-box',
};

const btnGhost: CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 10,
  border: '1px solid rgba(148,163,184,0.35)',
  background: 'transparent',
  color: '#cbd5e1',
  fontWeight: 500,
  cursor: 'pointer',
  marginBottom: 8,
  fontSize: 14,
};

function clearSession() {
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('portal-auth');
  } catch {
    /* ignore */
  }
}

function LicenseBlockedContent() {
  const searchParams = useSearchParams();
  const fromPortal = searchParams.get('from') === 'portal';
  const fromStaff = searchParams.get('from') === 'staff';

  const reason = useMemo(
    () =>
      searchParams.get('reason') ||
      'O acesso foi bloqueado: a licença da empresa pode estar expirada ou a conta suspensa. Contacte o suporte SempreDesk ou a sua empresa.',
    [searchParams],
  );

  const irPortalLogin = useCallback(() => {
    clearSession();
    window.location.href = '/portal/login';
  }, []);

  const irStaffLogin = useCallback(() => {
    clearSession();
    window.location.href = '/auth/login';
  }, []);

  const titulo = fromPortal ? 'Portal do cliente indisponível' : 'Acesso ao painel indisponível';
  const subtitulo = fromPortal
    ? 'A empresa associada a esta conta não pode usar o portal neste momento (licença ou estado da conta).'
    : 'A sua sessão ou a empresa não pode aceder ao sistema neste momento.';

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
          maxWidth: 520,
          padding: 32,
          borderRadius: 16,
          border: '1px solid rgba(148,163,184,0.25)',
          background: 'rgba(30,41,59,0.75)',
        }}
      >
        <h1 style={{ fontSize: 22, margin: '0 0 8px', fontWeight: 700 }}>{titulo}</h1>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: '#94a3b8', lineHeight: 1.45 }}>{subtitulo}</p>
        <p style={{ margin: '0 0 24px', lineHeight: 1.55, color: '#cbd5e1', fontSize: 15 }}>{reason}</p>

        {fromPortal ? (
          <>
            <button type="button" onClick={irPortalLogin} style={btnPrimary}>
              Limpar sessão e ir ao login do portal
            </button>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              Trabalha na equipa de suporte desta empresa?
            </p>
            <button type="button" onClick={irStaffLogin} style={btnGhost}>
              Ir ao login da equipa (suporte interno)
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={irStaffLogin} style={btnPrimary}>
              Limpar sessão e ir ao login da equipa
            </button>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
              É contacto do cliente e usa o portal?
            </p>
            <button type="button" onClick={irPortalLogin} style={btnGhost}>
              Ir ao portal do cliente
            </button>
          </>
        )}

        {!fromPortal && !fromStaff && (
          <p style={{ margin: '16px 0 0', fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            Se chegou aqui por engano, escolha o login correcto acima.
          </p>
        )}
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
