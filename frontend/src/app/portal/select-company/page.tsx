'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePortalStore } from '@/store/portal.store';
import { Building2, ChevronRight, Headphones, LogOut, Network } from 'lucide-react';

export default function SelectCompanyPage() {
  const router = useRouter();
  const { contact, clients, accessToken, selectClient, clearAuth } = usePortalStore();

  useEffect(() => {
    usePortalStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!accessToken) { router.replace('/portal/login'); return; }
    if (clients.length === 0) { router.replace('/portal/login'); return; }
    if (clients.length === 1) { selectClient(clients[0]); router.replace('/portal/dashboard'); }
  }, [accessToken, clients]);

  const handleSelect = (client: any) => {
    selectClient(client);
    router.push('/portal/dashboard');
  };

  const logout = () => { clearAuth(); router.push('/portal/login'); };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0F172A 0%,#1E1B4B 50%,#0F172A 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, fontFamily:'Inter,sans-serif' }}>
      <div style={{ position:'fixed', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        <div style={{ position:'absolute', top:'-20%', right:'-10%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,0.15) 0%,transparent 70%)' }} />
      </div>
      <div style={{ width:'100%', maxWidth:520, position:'relative' }}>
        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <div style={{ width:60, height:60, borderRadius:18, background:'linear-gradient(135deg,#4F46E5,#6366F1)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', boxShadow:'0 8px 32px rgba(99,102,241,0.4)' }}>
            <Headphones style={{ width:28, height:28, color:'#fff' }} />
          </div>
          <h1 style={{ color:'#fff', fontSize:24, fontWeight:800, margin:'0 0 8px' }}>Selecionar Empresa</h1>
          <p style={{ color:'#64748B', fontSize:14, margin:0 }}>
            Olá <span style={{ color:'#94A3B8', fontWeight:600 }}>{contact?.name}</span>! Escolha qual empresa deseja acessar.
          </p>
        </div>

        {/* Lista de empresas */}
        <div style={{ background:'rgba(255,255,255,0.05)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:20, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <Network style={{ width:15, height:15, color:'#6366F1' }} />
              <span style={{ color:'#94A3B8', fontSize:12, fontWeight:600 }}>{clients.length} empresa{clients.length!==1?'s':''} disponíve{clients.length!==1?'is':'l'}</span>
            </div>
          </div>

          {clients.map((client: any, i: number) => (
            <button key={client.id} onClick={() => handleSelect(client)}
              style={{ display:'flex', alignItems:'center', gap:14, width:'100%', padding:'16px 20px', background:'transparent', border:'none', borderBottom: i < clients.length-1 ? '1px solid rgba(255,255,255,0.06)' : 'none', cursor:'pointer', textAlign:'left' as const, transition:'background 0.15s' }}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(99,102,241,0.12)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{ width:44, height:44, borderRadius:12, background:'linear-gradient(135deg,#4F46E5,#6366F1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'#fff', flexShrink:0 }}>
                {(client.tradeName||client.companyName||'?')[0].toUpperCase()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ color:'#E2E8F0', fontWeight:700, fontSize:14, margin:'0 0 3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {client.tradeName || client.companyName}
                </p>
                {client.tradeName && client.companyName && (
                  <p style={{ color:'#475569', fontSize:12, margin:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{client.companyName}</p>
                )}
                {client.city && (
                  <p style={{ color:'#334155', fontSize:11, margin:'2px 0 0' }}>{client.city}/{client.state}</p>
                )}
              </div>
              <ChevronRight style={{ width:18, height:18, color:'#475569', flexShrink:0 }} />
            </button>
          ))}
        </div>

        {/* Logout */}
        <div style={{ textAlign:'center', marginTop:20 }}>
          <button onClick={logout} style={{ background:'none', border:'none', color:'#475569', fontSize:13, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
            <LogOut style={{ width:14, height:14 }} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}
