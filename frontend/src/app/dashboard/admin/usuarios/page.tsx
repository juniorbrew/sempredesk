'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminUsuariosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/team');
  }, [router]);
  return (
    <div className="min-h-[200px] flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
    </div>
  );
}
