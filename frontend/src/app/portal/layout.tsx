'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePortalStore } from '@/store/portal.store';
import PortalSidebar from '@/components/portal/PortalSidebar';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, client } = usePortalStore();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!accessToken) { router.replace('/portal/login'); return; }
    if (!client) { router.replace('/portal/select-company'); return; }
    setChecked(true);
  }, [accessToken, client, router]);

  if (!checked) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F1F6' }}>
      <div style={{ width: 32, height: 32, border: '2px solid #4F46E5', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F8F8FB', overflow: 'hidden' }}>
      <PortalSidebar />
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        {children}
      </main>
    </div>
  );
}
