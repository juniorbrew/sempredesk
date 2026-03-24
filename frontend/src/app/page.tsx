import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default function Home() {
  const headersList = headers();
  const host = headersList.get('host') ?? '';
  if (host.includes('cliente.')) redirect('/portal/login');
  // IP e suporte: sempre exige login (não abre dashboard direto)
  redirect('/auth/login');
}
