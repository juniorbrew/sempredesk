'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Edit2, Flag, Plus, Power, PowerOff } from 'lucide-react';
import toast from 'react-hot-toast';

type PriorityFormState = {
  name: string;
  slug: string;
  color: string;
  sortOrder: number;
  active: boolean;
  slaPolicyId: string;
};

const createEmptyForm = (): PriorityFormState => ({
  name: '',
  slug: '',
  color: '#4F46E5',
  sortOrder: 0,
  active: true,
  slaPolicyId: '',
});

const lbl = {
  display: 'block',
  color: '#64748B',
  fontSize: 11,
  fontWeight: 700 as const,
  letterSpacing: '0.07em',
  marginBottom: 5,
  textTransform: 'uppercase' as const,
};

const inp = (focus?: boolean) => ({
  width: '100%',
  padding: '10px 12px',
  background: focus ? '#fff' : '#F8FAFC',
  border: `1.5px solid ${focus ? '#4F46E5' : '#E2E8F0'}`,
  borderRadius: 10,
  color: '#0F172A',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box' as const,
  boxShadow: focus ? '0 0 0 3px rgba(79,70,229,0.10)' : 'none',
  transition: 'all 0.15s',
});

function normalizeList(raw: any) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function toSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
}

export default function PrioritiesPage() {
  const [priorities, setPriorities] = useState<any[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [focusField, setFocusField] = useState('');
  const [form, setForm] = useState<PriorityFormState>(createEmptyForm);

  const availablePolicies = useMemo(() => {
    return slaPolicies.filter((policy) => policy && policy.id);
  }, [slaPolicies]);

  const load = async () => {
    setLoading(true);
    try {
      const [prioritiesResponse, slaResponse] = await Promise.all([
        (api as any).getTenantPriorities(),
        api.getSlaPolicies(),
      ]);
      setPriorities(normalizeList(prioritiesResponse));
      setSlaPolicies(normalizeList(slaResponse));
    } catch (e) {
      console.error(e);
      toast.error('Erro ao carregar prioridades');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const reset = () => {
    setEditingId('');
    setForm(createEmptyForm());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        slug: toSlug(form.slug || form.name),
        color: form.color,
        sortOrder: Number(form.sortOrder || 0),
        active: form.active,
        slaPolicyId: form.slaPolicyId || null,
      };

      if (!payload.slug) {
        toast.error('Informe um nome ou slug válido');
        setSaving(false);
        return;
      }

      if (editingId) await (api as any).updateTenantPriority(editingId, payload);
      else await (api as any).createTenantPriority(payload);

      await load();
      reset();
      toast.success(editingId ? 'Prioridade atualizada' : 'Prioridade criada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao salvar prioridade');
    }
    setSaving(false);
  };

  const editItem = (item: any) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      slug: item.slug || '',
      color: item.color || '#4F46E5',
      sortOrder: item.sortOrder || 0,
      active: item.active !== false,
      slaPolicyId: item.slaPolicyId || '',
    });
  };

  const toggleActive = async (item: any) => {
    setTogglingId(item.id);
    try {
      await (api as any).setTenantPriorityActive(item.id, !item.active);
      await load();
      if (editingId === item.id) {
        setForm((current) => ({ ...current, active: !item.active }));
      }
      toast.success(item.active ? 'Prioridade inativada' : 'Prioridade ativada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao alterar status');
    }
    setTogglingId('');
  };

  const resolveSlaName = (item: any) => slaPolicies.find((policy) => policy.id === item.slaPolicyId)?.name || '-';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#4F46E5,#312E81)', boxShadow: '0 4px 14px rgba(79,70,229,0.3)' }}
          >
            <Flag className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Prioridades</h1>
            <p className="page-subtitle">{priorities.length} prioridades cadastradas no tenant</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/dashboard/departments" className="btn-secondary">
            Abrir departamentos
          </Link>
          <Link href="/dashboard/settings?tab=sla" className="btn-secondary">
            Abrir prazos
          </Link>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#EEF2FF' }}>
            <Plus className="w-4 h-4" style={{ color: '#4F46E5' }} />
          </div>
          <h2 className="table-header">{editingId ? 'Editar prioridade' : 'Nova prioridade'}</h2>
        </div>

        <form onSubmit={submit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px,1.3fr) minmax(180px,1fr) 110px 110px minmax(220px,1.2fr) auto',
              gap: 14,
              marginBottom: 14,
              alignItems: 'flex-end',
            }}
          >
            <div>
              <label style={lbl}>Nome</label>
              <input
                style={inp(focusField === 'name')}
                value={form.name}
                required
                onFocus={() => setFocusField('name')}
                onBlur={() => setFocusField('')}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setForm((current) => ({
                    ...current,
                    name: nextName,
                    slug: editingId ? current.slug : toSlug(nextName),
                  }));
                }}
                placeholder="Ex.: Crítica"
              />
            </div>

            <div>
              <label style={lbl}>Slug</label>
              <input
                style={inp(focusField === 'slug')}
                value={form.slug}
                required
                onFocus={() => setFocusField('slug')}
                onBlur={() => setFocusField('')}
                onChange={(e) => setForm((current) => ({ ...current, slug: toSlug(e.target.value) }))}
                placeholder="critica"
              />
            </div>

            <div>
              <label style={lbl}>Cor</label>
              <input
                type="color"
                style={{ ...inp(focusField === 'color'), padding: 6, minHeight: 42 }}
                value={form.color}
                onFocus={() => setFocusField('color')}
                onBlur={() => setFocusField('')}
                onChange={(e) => setForm((current) => ({ ...current, color: e.target.value }))}
              />
            </div>

            <div>
              <label style={lbl}>Ordem</label>
              <input
                type="number"
                style={inp(focusField === 'sortOrder')}
                value={form.sortOrder}
                onFocus={() => setFocusField('sortOrder')}
                onBlur={() => setFocusField('')}
                onChange={(e) => setForm((current) => ({ ...current, sortOrder: Number(e.target.value) }))}
              />
            </div>

            <div>
              <label style={lbl}>Política de prazo vinculada</label>
              <select
                style={{ ...inp(focusField === 'slaPolicyId'), appearance: 'none' as const }}
                value={form.slaPolicyId}
                onFocus={() => setFocusField('slaPolicyId')}
                onBlur={() => setFocusField('')}
                onChange={(e) => setForm((current) => ({ ...current, slaPolicyId: e.target.value }))}
              >
                <option value="">Nenhuma política</option>
                {availablePolicies.map((policy: any) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                    {policy.isDefault ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {editingId && (
                <button type="button" onClick={reset} className="btn-secondary" style={{ whiteSpace: 'nowrap' }}>
                  Cancelar
                </button>
              )}
              <button type="submit" disabled={saving} className="btn-primary" style={{ whiteSpace: 'nowrap' }}>
                {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}
              </button>
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((current) => ({ ...current, active: e.target.checked }))}
            />
            Prioridade ativa
          </label>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #F1F5F9',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#FAFBFC',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: '#EEF2FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Flag style={{ width: 15, height: 15, color: '#4F46E5' }} />
          </div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', margin: 0 }}>Prioridades cadastradas</h3>
          <span
            style={{
              background: '#EEF2FF',
              color: '#4F46E5',
              padding: '2px 10px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {priorities.length}
          </span>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #F1F5F9', background: '#FAFBFC' }}>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Nome</th>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Slug</th>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Política de prazo</th>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Ordem</th>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Status</th>
              <th className="table-header" style={{ padding: '10px 16px', textAlign: 'left' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#94A3B8' }}>
                  Carregando...
                </td>
              </tr>
            ) : priorities.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
                  <Flag style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.2 }} />
                  <p>Nenhuma prioridade cadastrada</p>
                </td>
              </tr>
            ) : (
              priorities.map((item) => (
                <tr
                  key={item.id}
                  className="table-row"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#FAFBFC';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0F172A' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: item.color || '#CBD5E1',
                          boxShadow: `0 0 0 3px ${item.color || '#CBD5E1'}22`,
                          flexShrink: 0,
                        }}
                      />
                      {item.name}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748B', fontSize: 12 }}>{item.slug}</td>
                  <td style={{ padding: '12px 16px', color: '#64748B', fontSize: 12 }}>{resolveSlaName(item)}</td>
                  <td style={{ padding: '12px 16px', color: '#94A3B8', fontSize: 12 }}>{item.sortOrder || 0}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        background: item.active ? '#DCFCE7' : '#FEE2E2',
                        color: item.active ? '#15803D' : '#DC2626',
                        padding: '3px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {item.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => editItem(item)} className="btn-secondary" style={{ padding: '5px 7px' }}>
                        <Edit2 style={{ width: 13, height: 13 }} />
                      </button>
                      <button
                        onClick={() => toggleActive(item)}
                        className={item.active ? 'btn-danger' : 'btn-secondary'}
                        disabled={togglingId === item.id}
                        style={{ padding: '5px 7px' }}
                        title={item.active ? 'Inativar prioridade' : 'Ativar prioridade'}
                      >
                        {item.active ? <PowerOff style={{ width: 13, height: 13 }} /> : <Power style={{ width: 13, height: 13 }} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


