'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePortalStore } from '@/store/portal.store';
import { Headphones, Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function PortalLoginPage() {
  useEffect(() => {
    document.documentElement.classList.remove('realtime-tv-mode');
  }, []);
  const router = useRouter();
  const { setAuth } = usePortalStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/v1/auth/portal-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Credenciais inválidas');
      const payload = data?.data ?? data;
      if (!payload?.accessToken) throw new Error('Resposta inválida do servidor');
      const { accessToken, contact, clients } = payload;
      setAuth({ contact, clients, accessToken });
      // Se só tem 1 empresa vai direto, senão vai para seletor
      if ((clients?.length ?? 0) <= 1) {
        router.push('/portal/dashboard');
      } else {
        router.push('/portal/select-company');
      }
    } catch(e: any) { setError(e?.message || 'Erro ao fazer login'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0F172A 0%,#1E1B4B 50%,#0F172A 100%)', display:'flex', alignItems:'center', justifyContent:'center', padding:16, fontFamily:'Inter,sans-serif' }}>
      <div style={{ position:'fixed', inset:0, overflow:'hidden', pointerEvents:'none' }}>
        <div style={{ position:'absolute', top:'-20%', right:'-10%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle,rgba(99,102,241,0.15) 0%,transparent 70%)' }} />
        <div style={{ position:'absolute', bottom:'-20%', left:'-10%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(59,130,246,0.12) 0%,transparent 70%)' }} />
      </div>
      <div style={{ width:'100%', maxWidth:420, position:'relative' }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <div style={{ width:64, height:64, borderRadius:20, background:'linear-gradient(135deg,#4F46E5,#6366F1)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px', boxShadow:'0 8px 32px rgba(99,102,241,0.4)' }}>
            <Headphones style={{ width:32, height:32, color:'#fff' }} />
          </div>
          <h1 style={{ color:'#fff', fontSize:28, fontWeight:800, margin:'0 0 8px' }}>Portal do Cliente</h1>
          <p style={{ color:'#64748B', fontSize:15 }}>Acompanhe seus tickets e contratos</p>
        </div>
        <div style={{ background:'rgba(255,255,255,0.05)', backdropFilter:'blur(20px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:20, padding:32, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
          {error && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:'10px 14px', marginBottom:20 }}>
              <AlertCircle style={{ width:15, height:15, color:'#F87171', flexShrink:0 }} />
              <span style={{ color:'#F87171', fontSize:13 }}>{error}</span>
            </div>
          )}
          <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div>
              <label style={{ display:'block', color:'#94A3B8', fontSize:11, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>E-mail</label>
              <div style={{ position:'relative' }}>
                <Mail style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', width:15, height:15, color:'#475569' }} />
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus placeholder="seu@email.com"
                  style={{ width:'100%', padding:'12px 14px 12px 40px', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#E2E8F0', fontSize:14, outline:'none', boxSizing:'border-box' as const }}
                  onFocus={e=>e.target.style.borderColor='#6366F1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
              </div>
            </div>
            <div>
              <label style={{ display:'block', color:'#94A3B8', fontSize:11, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:6 }}>Senha</label>
              <div style={{ position:'relative' }}>
                <Lock style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', width:15, height:15, color:'#475569' }} />
                <input type={showPass?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="••••••••"
                  style={{ width:'100%', padding:'12px 40px', background:'rgba(255,255,255,0.06)', border:'1.5px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#E2E8F0', fontSize:14, outline:'none', boxSizing:'border-box' as const }}
                  onFocus={e=>e.target.style.borderColor='#6366F1'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
                <button type="button" onClick={()=>setShowPass(p=>!p)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#475569', display:'flex' }}>
                  {showPass?<EyeOff style={{width:15,height:15}}/>:<Eye style={{width:15,height:15}}/>}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'13px 0', background:'linear-gradient(135deg,#4F46E5,#6366F1)', border:'none', borderRadius:10, color:'#fff', fontSize:15, fontWeight:700, cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1, boxShadow:'0 4px 20px rgba(99,102,241,0.4)', marginTop:8 }}>
              {loading ? 'Entrando...' : 'Entrar no Portal'}
            </button>
          </form>
          <div style={{ textAlign:'center', marginTop:24, paddingTop:20, borderTop:'1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ color:'#475569', fontSize:12 }}>Não tem acesso? Entre em contato com seu suporte técnico.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
