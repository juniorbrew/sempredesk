'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BookOpen, Search, Plus, Eye } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function KnowledgePage() {
  const [articles, setArticles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async (q?: string) => {
    setLoading(true);
    try {
      if (q) {
        const r: any = await api.searchKb(q);
        setArticles(r);
      } else {
        const [a, c]: any = await Promise.all([api.getKbArticles(), api.getKbCategories()]);
        setArticles(a); setCategories(c);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { const t = setTimeout(() => load(search || undefined), 400); return () => clearTimeout(t); }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold t-text">Base de Conhecimento</h1>
          <p className="t-text-muted text-sm">{articles.length} artigo(s)</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Novo Artigo
        </button>
      </div>

      <div className="card p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 t-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar artigos..." className="input pl-9" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 t-text-muted">Carregando...</div>
      ) : articles.length === 0 ? (
        <div className="card p-16 text-center">
          <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="t-text-muted">Nenhum artigo encontrado</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {articles.map((a: any) => (
            <div key={a.id} className="card p-5 hover:shadow-md transition-shadow cursor-pointer">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold t-text text-sm leading-snug">{a.title}</h3>
                <span className={`badge ml-2 shrink-0 ${a.visibility === 'public' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {a.visibility === 'public' ? 'Público' : 'Interno'}
                </span>
              </div>
              <p className="text-xs t-text-muted line-clamp-2 mb-3">
                {a.content.slice(0, 150)}...
              </p>
              <div className="flex items-center justify-between text-xs t-text-muted">
                <div className="flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  <span>{a.views} visualizações</span>
                </div>
                <span>{formatDistanceToNow(new Date(a.createdAt), { locale: ptBR, addSuffix: true })}</span>
              </div>
              {a.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {a.tags.map((tag: string) => (
                    <span key={tag} className="badge bg-indigo-50 text-indigo-600 text-xs">{tag}</span>
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
