'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Coffee, Edit2, Plus, ToggleLeft, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';

const lbl = {
  display: 'block', color: '#64748B', fontSize: 11, fontWeight: 700 as const,
  letterSpacing: '0.07em', marginBottom: 5, textTransform: 'uppercase' as const,
};
const inp = (focus?: boolean) => ({
  width: '100%', padding: '10px 12px',
  background: focus ? '#fff' : '#F8FAFC',
  border: `1.5px solid ${focus ? '#6366F1' : '#E2E8F0'}`,
  borderRadius: 10, color: '#0F172A', fontSize: 14, outline: 'none',
  boxSizing: 'border-box' as const,
  boxShadow: focus ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
  transition: 'all 0.15s',
});

interface PauseReason {
  id: string;
  name: string;
  description?: string;
  requiresApproval: boolean;
  maxDurationMinutes: number | null;
  active: boolean;
  sortOrder: number;
}

const EMPTY_FORM = {
  name: '', description: '', requiresApproval: true,
  maxDurationMinutes: '', active: true, sortOrder: 0,
};

function durationLabel(mins: number | null) {
  if (!mins) return 'Livre';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export default function PauseReasonsPage() {
  const [reasons, setReasons] = useState<PauseReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [focus, setFocus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const raw = await api.getAllPauseReasons();
      const list: PauseReason[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as any)?.data) ? (raw as any).data : [];
      setReasons(list);
    } catch { /* silencioso */ }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const reset = () => {
    setEditingId(null);
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const startEdit = (r: PauseReason) => {
    setEditingId(r.id);
    setForm({
      name: r.name,
      description: r.description ?? '',
      requiresApproval: r.requiresApproval,
      maxDurationMinutes: r.maxDurationMinutes != null ? String(r.maxDurationMinutes) : '',
      active: r.active,
      sortOrder: r.sortOrder,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const maxMin = form.maxDurationMinutes !== '' ? Number(form.maxDurationMinutes) : null;
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        requiresApproval: form.requiresApproval,
        maxDurationMinutes: maxMin,
        active: form.active,
        sortOrder: Number(form.sortOrder),
      };
      if (editingId) {
        await api.updatePauseReason(editingId, payload);
        toast.success('Motivo atualizado');
      } else {
        await api.createPauseReason(payload);
        toast.success('Motivo criado');
      }
      await load();
      reset();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao salvar');
    }
    setSaving(false);
  };

  const toggleActive = async (r: PauseReason) => {
    try {
      await api.updatePauseReason(r.id, { active: !r.active });
      setReasons(prev => prev.map(x => x.id === r.id ? { ...x, active: !r.active } : x));
    } catch {
      toast.error('Erro ao alterar status');
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, background: '#EDE9FE', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Coffee size={18} color="#7C3AED" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>Motivos de Pausa</h1>
            <p style={{ fontSize: 13, color: '#94A3B8', margin: 0 }}>
              Configure os motivos disponíveis quando um agente solicitar pausa.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <Plus size={14} /> Novo motivo
        </button>
      </div>

      {/* Formulário */}
      {showForm && (
        <div style={{ borderRadius: 12, border: '1.5px solid #C7D2FE', background: '#F5F3FF', padding: 20, marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#3730A3', margin: '0 0 16px' }}>
            {editingId ? 'Editar motivo' : 'Novo motivo de pausa'}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Nome */}
            <div>
              <label style={lbl}>Nome <span style={{ color: '#EF4444' }}>*</span></label>
              <input
                style={inp(focus === 'name')}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                onFocus={() => setFocus('name')}
                onBlur={() => setFocus('')}
                placeholder="Ex.: Almoço, Reunião, Treinamento"
                maxLength={100}
              />
            </div>

            {/* Duração máxima */}
            <div>
              <label style={lbl}>Duração máxima</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  style={{ ...inp(focus === 'dur'), flex: 1 }}
                  value={form.maxDurationMinutes}
                  onChange={e => setForm(p => ({ ...p, maxDurationMinutes: e.target.value }))}
                  onFocus={() => setFocus('dur')}
                  onBlur={() => setFocus('')}
                  placeholder="Livre (sem limite)"
                  min={1} max={480}
                />
                <span style={{ fontSize: 13, color: '#64748B', whiteSpace: 'nowrap' }}>min</span>
              </div>
              <span style={{ fontSize: 11, color: '#94A3B8' }}>Vazio = sem limite de tempo</span>
            </div>

            {/* Descrição */}
            <div>
              <label style={lbl}>Descrição</label>
              <input
                style={inp(focus === 'desc')}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                onFocus={() => setFocus('desc')}
                onBlur={() => setFocus('')}
                placeholder="Descrição opcional"
                maxLength={255}
              />
            </div>

            {/* Ordem */}
            <div>
              <label style={lbl}>Ordem de exibição</label>
              <input
                type="number"
                style={inp(focus === 'ord')}
                value={form.sortOrder}
                onChange={e => setForm(p => ({ ...p, sortOrder: Number(e.target.value) }))}
                onFocus={() => setFocus('ord')}
                onBlur={() => setFocus('')}
                min={0}
              />
              <span style={{ fontSize: 11, color: '#94A3B8' }}>Menor número = aparece primeiro</span>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#0F172A' }}>
              <input
                type="checkbox"
                checked={form.requiresApproval}
                onChange={e => setForm(p => ({ ...p, requiresApproval: e.target.checked }))}
              />
              Requer aprovação do supervisor
            </label>
            {editingId && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#0F172A' }}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={e => setForm(p => ({ ...p, active: e.target.checked }))}
                />
                Motivo ativo
              </label>
            )}
          </div>

          {/* Botões */}
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              onClick={save}
              disabled={saving || !form.name.trim()}
              style={{ padding: '8px 20px', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!form.name.trim() || saving) ? 0.6 : 1 }}
            >
              {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar motivo'}
            </button>
            <button
              onClick={reset}
              style={{ padding: '8px 16px', background: 'transparent', color: '#64748B', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div style={{ borderRadius: 12, border: '1.5px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#F8FAFC', borderBottom: '1.5px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Coffee size={14} color="#6366F1" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Motivos cadastrados</span>
          <span style={{ fontSize: 11, background: '#E0E7FF', color: '#4338CA', borderRadius: 99, padding: '1px 8px', fontWeight: 600 }}>
            {reasons.length}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>Carregando...</div>
        ) : reasons.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#94A3B8' }}>
            Nenhum motivo cadastrado. Os padrões serão criados automaticamente na primeira solicitação de pausa.
          </div>
        ) : (
          reasons.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #F1F5F9' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: r.active ? '#0F172A' : '#94A3B8' }}>{r.name}</span>
                  {!r.active && (
                    <span style={{ fontSize: 10, background: '#F1F5F9', color: '#94A3B8', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>INATIVO</span>
                  )}
                  {r.requiresApproval && (
                    <span style={{ fontSize: 10, background: '#FEF3C7', color: '#92400E', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>APROVAÇÃO</span>
                  )}
                </div>
                {r.description && (
                  <p style={{ fontSize: 12, color: '#94A3B8', margin: '2px 0 0' }}>{r.description}</p>
                )}
              </div>

              {/* Badge de duração */}
              <span style={{
                fontSize: 12, fontWeight: 700,
                background: r.maxDurationMinutes ? '#EEF2FF' : '#F0FDF4',
                color: r.maxDurationMinutes ? '#4338CA' : '#15803D',
                borderRadius: 8, padding: '3px 10px', whiteSpace: 'nowrap',
              }}>
                {durationLabel(r.maxDurationMinutes)}
              </span>

              {/* Ações */}
              <button
                onClick={() => startEdit(r)}
                title="Editar"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => toggleActive(r)}
                title={r.active ? 'Desativar' : 'Ativar'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: r.active ? '#64748B' : '#4F46E5', padding: 4 }}
              >
                {r.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
