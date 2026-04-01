import { TENANT_LICENSE_BLOCKED_CODE } from './api-errors';

/**
 * fetch para o portal: em 403 com código de licença, redirecciona para /license-blocked.
 * Não usar no login público (portal-login).
 */
export async function portalFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 403 && typeof window !== 'undefined') {
    let data: { error?: { code?: string; message?: string } | string } | null = null;
    try {
      data = await res.clone().json();
    } catch {
      /* ignore */
    }
    const err = data?.error;
    const code = typeof err === 'object' && err && 'code' in err ? (err as { code?: string }).code : null;
    if (code === TENANT_LICENSE_BLOCKED_CODE && !window.location.pathname.startsWith('/license-blocked')) {
      const msg = typeof err === 'object' && err && typeof (err as { message?: string }).message === 'string'
        ? (err as { message: string }).message
        : '';
      const q = new URLSearchParams();
      if (msg) q.set('reason', msg);
      q.set('from', 'portal');
      window.location.replace(`/license-blocked?${q.toString()}`);
      throw new Error('PORTAL_LICENSE_BLOCKED');
    }
  }
  return res;
}
