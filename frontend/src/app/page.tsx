import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

/** Subdomínios reservados da plataforma — não tratados como tenant. */
const RESERVED_SUBDOMAINS = ['suporte', 'cliente', 'adminpanel', 'www', 'api', 'mail', 'smtp', 'pop', 'imap', 'ftp', 'cpanel', 'webmail'];

export default function Home() {
  const headersList = headers();
  const host = (headersList.get('host') ?? '').split(':')[0]; // remove porta se houver

  // Portal do cliente
  if (host.includes('cliente.')) redirect('/portal/login');

  // Detecção de subdomínio de tenant: {slug}.sempredesk.com.br
  // Parts: ['slug', 'sempredesk', 'com', 'br'] → length 4
  const parts = host.split('.');
  if (
    parts.length === 4 &&
    parts[1] === 'sempredesk' &&
    parts[2] === 'com' &&
    parts[3] === 'br' &&
    !RESERVED_SUBDOMAINS.includes(parts[0])
  ) {
    // Redireciona para login com contexto do tenant
    redirect(`/auth/login?tenant=${encodeURIComponent(parts[0])}`);
  }

  // adminpanel.* → /auth/login; destino pós-login definido em auth/login (hostname)
  // IP e suporte: sempre exige login (não abre dashboard direto)
  redirect('/auth/login');
}
