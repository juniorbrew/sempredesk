import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default function Home() {
  const headersList = headers();
  const host = headersList.get('host') ?? '';
  if (host.includes('cliente.')) redirect('/portal/login');
  // adminpanel.* → /auth/login; destino pós-login definido em auth/login (hostname)
  // IP e suporte: sempre exige login (não abre dashboard direto)
  redirect('/auth/login');
}
