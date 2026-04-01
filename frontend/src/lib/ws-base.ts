'use client';

/** Base do Socket.IO; chamar em runtime (useEffect / handler), não em const de topo do módulo. */
export function resolveWsBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, '');
  if (configured) return configured;
  if (typeof window === 'undefined') return '';

  const { protocol, hostname, port, origin } = window.location;
  return port === '3000' ? `${protocol}//${hostname}:4000` : origin;
}
