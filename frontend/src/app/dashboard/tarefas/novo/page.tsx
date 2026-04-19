'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ListChecks } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

export default function NovaTarefaPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusField, setFocusField] = useState('');
  const [form, setForm] = useState({
    title: '',
    priority: 'medium',
    status: 'pending',
    dueAt: '',
    description: '',
  });

  if (!hasPermission(user, 'tasks.create')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para criar tarefas.
        </div>
      </div>
    );
  }

  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  // Converte datetime-local (sem fuso) para ISO com fuso do browser
  const toISO = (dtLocal: string) => dtLocal ? new Date(dtLocal).toISOString() : '';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('O título é obrigatório.'); return; }
    setError('');
    setSaving(true);
    try {
      await api.createTask({
        title: form.title,
        priority: form.priority || 'medium',
        status: form.status || 'pending',
        dueAt: form.dueAt ? toISO(form.dueAt) : undefined,
        description: form.description || undefined,
        origin: 'manual',
      });
      toast.success('Tarefa criada com sucesso!');
      router.push('/dashboard/tarefas');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Erro ao criar tarefa';
      setError(msg);
      toast.error(msg);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/dashboard/tarefas" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:36, height:36, borderRadius:10, background:'#F1F5F9', color:'#64748B', textDecoration:'none' }}>
          <ArrowLeft style={{ width:16, height:16 }} />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#059669,#10B981)', boxShadow:'0 4px 14px rgba(16,185,129,0.3)' }}>
            <ListChecks className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="page-title">Nova Tarefa</h1>
            <p className="page-subtitle">Preencha as informações da tarefa</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card p-5">
          <div style={{ display:'grid', gap:18 }}>
            {/* Título */}
            <div>
              <label style={lbl}>Título *</label>
              <input
                style={inp(focusField==='title')}
                value={form.title}
                required
                placeholder="Ex: Ligar para cliente, Atualizar documentação..."
                onFocus={() => setFocusField('title')}
                onBlur={() => setFocusField('')}
                onChange={e => set('title', e.target.value)}
              />
            </div>

            {/* Prioridade + Status */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div>
                <label style={lbl}>Prioridade</label>
                <select style={inp()} value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="critical">Crítica</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Status inicial</label>
                <select style={inp()} value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="pending">Pendente</option>
                  <option value="in_progress">Em andamento</option>
                </select>
              </div>
            </div>

            {/* Vencimento */}
            <div>
              <label style={lbl}>Vencimento</label>
              <input
                type="datetime-local"
                style={inp(focusField==='dueAt')}
                value={form.dueAt}
                onFocus={() => setFocusField('dueAt')}
                onBlur={() => setFocusField('')}
                onChange={e => set('dueAt', e.target.value)}
              />
            </div>

            {/* Descrição */}
            <div>
              <label style={lbl}>Descrição</label>
              <textarea
                rows={3}
                style={{ ...inp(focusField==='desc'), resize:'vertical' as const }}
                value={form.description}
                placeholder="Descrição da tarefa (opcional)"
                onFocus={() => setFocusField('desc')}
                onBlur={() => setFocusField('')}
                onChange={e => set('description', e.target.value)}
              />
            </div>

            {/* Erro */}
            {error && (
              <div style={{ padding:'10px 14px', background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:8, color:'#991B1B', fontSize:13 }}>
                {error}
              </div>
            )}

            {/* Botões */}
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <Link href="/dashboard/tarefas" className="btn-secondary" style={{ textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
                Cancelar
              </Link>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Salvando...' : 'Criar Tarefa'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
