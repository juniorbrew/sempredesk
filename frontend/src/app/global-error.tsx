'use client';

/**
 * Erro na raiz (inclui falhas no root layout). Obrigatório incluir html e body.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "'DM Sans', system-ui, sans-serif", background: '#F1F5F9', color: '#0F172A' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>SempreDesk — erro crítico</h1>
          <p style={{ fontSize: 14, color: '#64748B', margin: '0 0 20px', maxWidth: 420, textAlign: 'center' }}>
            {error.message || 'Não foi possível carregar a aplicação.'}
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
      </body>
    </html>
  );
}
