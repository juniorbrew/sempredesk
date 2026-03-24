'use client';
import { useEffect, useState } from 'react';
import { usePortalStore } from '@/store/portal.store';
import { BookOpen, Search, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function PortalKnowledgePage() {
  const { accessToken } = usePortalStore();
  const [articles, setArticles] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (q?: string) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const url = q ? `/api/v1/knowledge/search?q=${encodeURIComponent(q)}` : `/api/v1/knowledge`;
      const res = await fetch(url, { headers:{ Authorization:`Bearer ${accessToken}` } });
      const data = await res.json();
      setArticles(data?.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [accessToken]);
  useEffect(() => { const t = setTimeout(()=>load(search||undefined), 400); return ()=>clearTimeout(t); }, [search]);

  return (
    <div style={{ maxWidth:800 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ color:'#0F172A', fontSize:22, fontWeight:800, margin:'0 0 4px' }}>Base de Conhecimento</h1>
        <p style={{ color:'#94A3B8', fontSize:13, margin:0 }}>Encontre respostas para dúvidas comuns</p>
      </div>

      {/* Busca */}
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:14, marginBottom:20 }}>
        <div style={{ position:'relative' }}>
          <Search style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', width:15, height:15, color:'#CBD5E1' }} />
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar artigos..."
            style={{ width:'100%', padding:'10px 14px 10px 38px', background:'#F8FAFC', border:'1.5px solid #E2E8F0', borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const }} />
        </div>
      </div>

      {loading ? (
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:40, textAlign:'center', color:'#94A3B8' }}>Carregando...</div>
      ) : articles.length===0 ? (
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:60, textAlign:'center', color:'#94A3B8' }}>
          <BookOpen style={{ width:40, height:40, margin:'0 auto 16px', opacity:0.2 }} />
          <p style={{ fontWeight:600, color:'#475569', margin:0 }}>{search?'Nenhum artigo encontrado':'Nenhum artigo disponível'}</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          {articles.map((a:any) => (
            <div key={a.id} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:14, padding:18, cursor:'pointer', transition:'all 0.15s' }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor='#C7D2FE'; e.currentTarget.style.boxShadow='0 4px 12px rgba(99,102,241,0.1)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor='#E2E8F0'; e.currentTarget.style.boxShadow='none'; }}>
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                <h3 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:0, lineHeight:1.4, flex:1 }}>{a.title}</h3>
                <span style={{ background:a.visibility==='public'?'#DCFCE7':'#F1F5F9', color:a.visibility==='public'?'#15803D':'#475569', padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, marginLeft:8, flexShrink:0 }}>
                  {a.visibility==='public'?'Público':'Interno'}
                </span>
              </div>
              <p style={{ fontSize:12, color:'#64748B', margin:'0 0 12px', lineHeight:1.5, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                {a.content?.slice(0,120)}...
              </p>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:11, color:'#94A3B8' }}>
                <span style={{ display:'flex', alignItems:'center', gap:4 }}><Eye style={{width:12,height:12}} />{a.views} views</span>
                <span>{formatDistanceToNow(new Date(a.createdAt),{locale:ptBR,addSuffix:true})}</span>
              </div>
              {a.tags?.length>0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:10 }}>
                  {a.tags.map((tag:string)=>(
                    <span key={tag} style={{ background:'#EEF2FF', color:'#4F46E5', padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600 }}>{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
