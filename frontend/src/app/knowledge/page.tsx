'use client';
import { useEffect, useState } from 'react';
import { Search, BookOpen, Eye, ArrowRight, Headphones } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const getBase = () => process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== 'undefined' ? window.location.origin + '/api/v1' : 'http://localhost:4000/api/v1');

export default function PublicKnowledgePage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [tenantIdInput, setTenantIdInput] = useState('');

  const load = async (tid: string, q?: string) => {
    if (!tid) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: tid });
      if (q) params.append('search', q);
      const res = await fetch(`${getBase()}/public/knowledge?${params}`);
      const data = await res.json();
      setArticles(Array.isArray(data) ? data : data?.data || []);
    } catch { setArticles([]); }
    setLoading(false);
  };

  useEffect(() => {
    // Try to get tenantId from URL params
    const params = new URLSearchParams(window.location.search);
    const tid = params.get('t') || params.get('tenantId') || '';
    if (tid) { setTenantId(tid); setTenantIdInput(tid); load(tid); }
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const t = setTimeout(() => load(tenantId, search || undefined), 400);
    return () => clearTimeout(t);
  }, [search, tenantId]);

  return (
    <div style={{ minHeight:'100vh', background:'#F8FAFC', fontFamily:"'Inter',sans-serif" }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#1E1B4B,#312E81,#4338CA)', padding:'40px 24px', textAlign:'center' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:16 }}>
          <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Headphones style={{ width:20, height:20, color:'#fff' }} />
          </div>
          <span style={{ color:'#fff', fontWeight:700, fontSize:20 }}>SempreDesk</span>
        </div>
        <h1 style={{ color:'#fff', fontSize:28, fontWeight:800, margin:'0 0 8px' }}>Base de Conhecimento</h1>
        <p style={{ color:'rgba(255,255,255,0.7)', fontSize:14, margin:'0 0 24px' }}>Encontre respostas para as dúvidas mais comuns</p>
        {tenantId ? (
          <div style={{ maxWidth:500, margin:'0 auto', position:'relative' }}>
            <Search style={{ position:'absolute', left:14, top:'50%', transform:'translateY(-50%)', width:16, height:16, color:'#94A3B8' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar artigos..."
              style={{ width:'100%', padding:'12px 14px 12px 44px', borderRadius:12, border:'none', fontSize:14, outline:'none', boxSizing:'border-box' }} />
          </div>
        ) : (
          <div style={{ maxWidth:400, margin:'0 auto' }}>
            <p style={{ color:'rgba(255,255,255,0.8)', fontSize:13, marginBottom:8 }}>Informe o ID da empresa para acessar a base de conhecimento:</p>
            <div style={{ display:'flex', gap:8 }}>
              <input value={tenantIdInput} onChange={e => setTenantIdInput(e.target.value)}
                placeholder="ID do tenant"
                style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'none', fontSize:13, outline:'none' }} />
              <button onClick={() => { setTenantId(tenantIdInput); load(tenantIdInput); }}
                style={{ padding:'10px 18px', borderRadius:10, background:'#4F46E5', color:'#fff', border:'none', cursor:'pointer', fontWeight:600, fontSize:13 }}>
                Buscar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ maxWidth:900, margin:'0 auto', padding:'32px 16px' }}>
        {!tenantId ? (
          <div style={{ textAlign:'center', color:'#94A3B8', padding:'60px 0' }}>
            <BookOpen style={{ width:48, height:48, margin:'0 auto 12px', opacity:0.3 }} />
            <p style={{ fontSize:14 }}>Informe o ID da empresa para carregar os artigos</p>
          </div>
        ) : loading ? (
          <div style={{ textAlign:'center', color:'#94A3B8', padding:'60px 0' }}>Carregando...</div>
        ) : articles.length === 0 ? (
          <div style={{ textAlign:'center', color:'#94A3B8', padding:'60px 0' }}>
            <BookOpen style={{ width:48, height:48, margin:'0 auto 12px', opacity:0.3 }} />
            <p style={{ fontSize:14 }}>{search ? `Nenhum artigo encontrado para "${search}"` : 'Nenhum artigo disponível'}</p>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
            {articles.map((a: any) => (
              <div key={a.id}
                style={{ background:'#fff', border:'1.5px solid #E2E8F0', borderRadius:14, padding:20, cursor:'pointer', transition:'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#C7D2FE'; e.currentTarget.style.boxShadow='0 4px 16px rgba(99,102,241,0.12)'; e.currentTarget.style.transform='translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='#E2E8F0'; e.currentTarget.style.boxShadow='none'; e.currentTarget.style.transform=''; }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:10 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <BookOpen style={{ width:16, height:16, color:'#4F46E5' }} />
                  </div>
                  <h3 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:0, lineHeight:1.4 }}>{a.title}</h3>
                </div>
                <p style={{ fontSize:12, color:'#64748B', margin:'0 0 12px', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' } as any}>
                  {a.content?.replace(/#+ /g, '').slice(0, 150)}...
                </p>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span style={{ fontSize:11, color:'#94A3B8', display:'flex', alignItems:'center', gap:4 }}>
                    <Eye style={{ width:11, height:11 }} />{a.views || 0} views
                  </span>
                  <span style={{ fontSize:11, color:'#4F46E5', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                    Ler artigo <ArrowRight style={{ width:11, height:11 }} />
                  </span>
                </div>
                {a.tags?.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:10 }}>
                    {a.tags.slice(0, 3).map((tag: string) => (
                      <span key={tag} style={{ background:'#EEF2FF', color:'#4F46E5', padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600 }}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
