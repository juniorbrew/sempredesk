'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, ListChecks, Clock, MessageSquare, CheckSquare, Square, AlertTriangle, GitCommit, Edit2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';

const lbl = { display:'block', color:'#64748B', fontSize:11, fontWeight:700 as const, letterSpacing:'0.07em', marginBottom:5, textTransform:'uppercase' as const };
const inp = (focus?:boolean) => ({ width:'100%', padding:'10px 12px', background:focus?'#fff':'#F8FAFC', border:`1.5px solid ${focus?'#6366F1':'#E2E8F0'}`, borderRadius:10, color:'#0F172A', fontSize:14, outline:'none', boxSizing:'border-box' as const, boxShadow:focus?'0 0 0 3px rgba(99,102,241,0.1)':'none', transition:'all 0.15s' });

const STATUS_LABELS: Record<string,string> = { pending:'Pendente', in_progress:'Em andamento', completed:'Concluída', cancelled:'Cancelada' };
const STATUS_STYLE: Record<string,{bg:string;color:string;dot:string}> = {
  pending:     { bg:'#FFF7ED', color:'#9A3412', dot:'#F97316' },
  in_progress: { bg:'#EEF2FF', color:'#3730A3', dot:'#4F46E5' },
  completed:   { bg:'#F0FDF4', color:'#166534', dot:'#16A34A' },
  cancelled:   { bg:'#F9FAFB', color:'#374151', dot:'#94A3B8' },
};
const PRIORITY_LABELS: Record<string,string> = { low:'Baixa', medium:'Média', high:'Alta', critical:'Crítica' };
const PRIORITY_STYLE: Record<string,{bg:string;color:string}> = {
  low:      { bg:'#F0FDF4', color:'#166534' },
  medium:   { bg:'#FFF7ED', color:'#9A3412' },
  high:     { bg:'#FEF2F2', color:'#991B1B' },
  critical: { bg:'#581C87', color:'#fff' },
};

const LOG_ACTION_ICONS: Record<string, React.ReactNode> = {
  created:        <GitCommit style={{ width:13, height:13, color:'#6366F1' }} />,
  status_changed: <AlertTriangle style={{ width:13, height:13, color:'#F59E0B' }} />,
  commented:      <MessageSquare style={{ width:13, height:13, color:'#3B82F6' }} />,
  updated:        <Edit2 style={{ width:13, height:13, color:'#64748B' }} />,
  reminder_sent:  <Clock style={{ width:13, height:13, color:'#0F766E' }} />,
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'130px 1fr', gap:8, padding:'10px 0', borderBottom:'1px solid #F1F5F9' }}>
      <span style={{ fontSize:12, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.06em', paddingTop:1 }}>{label}</span>
      <span style={{ fontSize:14, color:'#0F172A' }}>{value || '—'}</span>
    </div>
  );
}

export default function TarefaDetailPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState('');
  const [commentFocus, setCommentFocus] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const raw: any = await api.getTask(id);
      setTask(raw);
    } catch { toast.error('Erro ao carregar tarefa'); }
    setLoading(false);
  };

  useEffect(() => { if (id) load(); }, [id]);

  if (!hasPermission(user, 'tasks.view')) {
    return (
      <div className="space-y-6">
        <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>
          Acesso negado. Você não tem permissão para visualizar tarefas.
        </div>
      </div>
    );
  }

  const handleStart = async () => {
    setActing(true);
    try {
      await api.updateTask(id, { status: 'in_progress' });
      toast.success('Tarefa iniciada!');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao iniciar'); }
    setActing(false);
  };

  const handleComplete = async () => {
    setActing(true);
    try {
      await api.completeTask(id);
      toast.success('Tarefa concluída!');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao concluir'); }
    setActing(false);
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancelar esta tarefa?')) return;
    setActing(true);
    try {
      await api.cancelTask(id);
      toast.success('Tarefa cancelada');
      router.push('/dashboard/tarefas');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao cancelar'); }
    setActing(false);
  };

  const handleDelete = async () => {
    if (!window.confirm('Excluir permanentemente esta tarefa?')) return;
    setActing(true);
    try {
      await api.deleteTask(id);
      toast.success('Tarefa excluída');
      router.push('/dashboard/tarefas');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao excluir'); }
    setActing(false);
  };

  const handleChecklistItem = async (itemId: string, done: boolean) => {
    if (!task?.checklist) return;
    const updated = task.checklist.map((it: any) => it.id === itemId ? { ...it, done } : it);
    try {
      await api.updateTask(id, { checklist: updated });
      setTask((prev: any) => ({ ...prev, checklist: updated }));
    } catch (e: any) { toast.error('Erro ao atualizar checklist'); }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    setSubmittingComment(true);
    try {
      await api.addTaskComment(id, { comment });
      toast.success('Comentário adicionado');
      setComment('');
      load();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao comentar'); }
    setSubmittingComment(false);
  };

  const st = task ? (STATUS_STYLE[task.status] || { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8' }) : null;
  const pr = task ? (PRIORITY_STYLE[task.priority] || { bg:'#F1F5F9', color:'#64748B' }) : null;

  const formatDate = (d: string) => {
    try { return format(new Date(d), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return d; }
  };

  const checklist: any[] = task?.checklist || [];
  const checklistDone = checklist.filter((i: any) => i.done).length;
  const logs: any[] = task?.logs || [];

  const isActive = task && ['pending','in_progress'].includes(task.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/tarefas" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:36, height:36, borderRadius:10, background:'#F1F5F9', color:'#64748B', textDecoration:'none' }}>
            <ArrowLeft style={{ width:16, height:16 }} />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background:'linear-gradient(135deg,#059669,#10B981)', boxShadow:'0 4px 14px rgba(16,185,129,0.3)' }}>
              <ListChecks className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{loading ? 'Carregando...' : (task?.title || 'Tarefa')}</h1>
              {task && st && pr && (
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:st.bg, color:st.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                    <span style={{ width:6, height:6, borderRadius:'50%', background:st.dot }} />
                    {STATUS_LABELS[task.status] || task.status}
                  </span>
                  <span style={{ background:pr.bg, color:pr.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                    {PRIORITY_LABELS[task.priority] || task.priority}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:'#94A3B8' }}>Carregando...</div>}

      {!loading && task && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:20, alignItems:'start' }}>
          {/* Coluna principal */}
          <div className="space-y-5">
            {/* Detalhes */}
            <div className="card p-5">
              <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:'0 0 16px 0' }}>Detalhes da Tarefa</h2>
              <DetailRow label="Título" value={task.title} />
              <DetailRow label="Status" value={<span style={{ display:'inline-flex', alignItems:'center', gap:5, ...st, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}><span style={{ width:6, height:6, borderRadius:'50%', background:st?.dot }} />{STATUS_LABELS[task.status] || task.status}</span>} />
              <DetailRow label="Prioridade" value={<span style={{ background:pr?.bg, color:pr?.color, padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700 }}>{PRIORITY_LABELS[task.priority] || task.priority}</span>} />
              <DetailRow label="Vencimento" value={task.dueAt ? formatDate(task.dueAt) : '—'} />
              <DetailRow label="Lembrete" value={task.reminderAt ? formatDate(task.reminderAt) : '—'} />
              <DetailRow label="Criado em" value={task.createdAt ? formatDate(task.createdAt) : '—'} />
              {task.assignedUser && <DetailRow label="Atribuído" value={task.assignedUser.name} />}
              {task.description && <DetailRow label="Descrição" value={<span style={{ whiteSpace:'pre-wrap' }}>{task.description}</span>} />}
            </div>

            {/* Checklist */}
            {checklist.length > 0 && (
              <div className="card p-5">
                <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:'0 0 4px 0' }}>Checklist</h2>
                <p style={{ fontSize:12, color:'#64748B', margin:'0 0 14px 0' }}>{checklistDone} de {checklist.length} itens concluídos</p>
                {/* Progress bar */}
                <div style={{ height:4, background:'#F1F5F9', borderRadius:4, marginBottom:16, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${checklist.length ? (checklistDone/checklist.length*100) : 0}%`, background:'#10B981', borderRadius:4, transition:'width 0.3s' }} />
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {checklist.map((item: any) => (
                    <div
                      key={item.id}
                      style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'6px 0' }}
                      onClick={() => handleChecklistItem(item.id, !item.done)}
                    >
                      {item.done
                        ? <CheckSquare style={{ width:16, height:16, color:'#10B981', flexShrink:0 }} />
                        : <Square style={{ width:16, height:16, color:'#CBD5E1', flexShrink:0 }} />
                      }
                      <span style={{ fontSize:14, color: item.done ? '#94A3B8' : '#0F172A', textDecoration: item.done ? 'line-through' : 'none' }}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Histórico */}
            {logs.length > 0 && (
              <div className="card p-5">
                <h2 style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:'0 0 16px 0' }}>Histórico</h2>
                <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
                  {logs.map((log: any, idx: number) => (
                    <div key={log.id || idx} style={{ display:'flex', gap:12, paddingBottom:16, position:'relative' }}>
                      {idx < logs.length - 1 && (
                        <div style={{ position:'absolute', left:11, top:22, width:1, height:'calc(100% - 10px)', background:'#F1F5F9' }} />
                      )}
                      <div style={{ width:24, height:24, borderRadius:'50%', background:'#F8FAFC', border:'1.5px solid #E2E8F0', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, zIndex:1 }}>
                        {LOG_ACTION_ICONS[log.action] || <Clock style={{ width:12, height:12, color:'#94A3B8' }} />}
                      </div>
                      <div style={{ flex:1, paddingTop:2 }}>
                        <p style={{ fontSize:13, color:'#0F172A', margin:'0 0 2px 0' }}>{log.description}</p>
                        {log.createdAt && (
                          <span style={{ fontSize:11, color:'#94A3B8' }}>
                            {format(new Date(log.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Coluna direita */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Ações */}
            {(hasPermission(user, 'tasks.edit') || hasPermission(user, 'tasks.delete')) && (
              <div className="card p-4">
                <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:'0 0 14px 0' }}>Ações</h3>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {hasPermission(user, 'tasks.edit') && task.status === 'pending' && (
                    <button className="btn-secondary" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleStart}>
                      Iniciar tarefa
                    </button>
                  )}
                  {hasPermission(user, 'tasks.edit') && isActive && (
                    <button className="btn-primary" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleComplete}>
                      Concluir
                    </button>
                  )}
                  {hasPermission(user, 'tasks.edit') && isActive && (
                    <button className="btn-secondary" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleCancel}>
                      Cancelar tarefa
                    </button>
                  )}
                  {hasPermission(user, 'tasks.delete') && (
                    <button className="btn-danger" style={{ width:'100%', justifyContent:'center' }} disabled={acting} onClick={handleDelete}>
                      Excluir
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Comentar */}
            {hasPermission(user, 'tasks.edit') && (
              <div className="card p-4">
                <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:'0 0 12px 0' }}>Adicionar comentário</h3>
                <textarea
                  rows={3}
                  style={{ ...inp(commentFocus), resize:'vertical' as const, marginBottom:10 }}
                  value={comment}
                  placeholder="Escreva um comentário..."
                  onFocus={() => setCommentFocus(true)}
                  onBlur={() => setCommentFocus(false)}
                  onChange={e => setComment(e.target.value)}
                />
                <button
                  className="btn-primary"
                  style={{ width:'100%', justifyContent:'center' }}
                  disabled={submittingComment || !comment.trim()}
                  onClick={handleComment}
                >
                  {submittingComment ? 'Enviando...' : 'Comentar'}
                </button>
              </div>
            )}

            {/* Meta info */}
            <div className="card p-4">
              <h3 style={{ fontSize:13, fontWeight:700, color:'#0F172A', margin:'0 0 12px 0' }}>Informações</h3>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {task.createdAt && (
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#64748B' }}>
                    <Clock style={{ width:12, height:12 }} />
                    Criada em {format(new Date(task.createdAt), 'dd/MM/yyyy', { locale: ptBR })}
                  </div>
                )}
                {task.origin && (
                  <div style={{ fontSize:12, color:'#94A3B8' }}>Origem: {task.origin}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
