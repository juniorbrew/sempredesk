'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    useAuthStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const role = user?.role;
    if (role && !['admin', 'super_admin'].includes(role)) {
      router.replace('/dashboard');
    }
  }, [user?.role, router]);

  return <>{children}</>;
}
