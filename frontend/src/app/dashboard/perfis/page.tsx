'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuthStore, hasPermission } from '@/store/auth.store';
import { ShieldCheck, Plus, Pencil, Trash2, Save, X, ChevronDown, ChevronRight, Lock, Check } from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Permission { id: string; code: string; name: string; module: string }
interface Role { id: string; slug: string; name: string; description?: string; permissions: string[] }
type PermissionsGrouped = Record<string, Permission[]>;

const SYSTEM_ROLES = ['super_admin', 'admin', 'manager', 'technician', 'viewer'];

const ROLE_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  super_admin: { bg: '#FEE2E2', text: '#991B1B', dot: '#DC2626' },
  admin:       { bg: '#FEE2E2', text: '#DC2626', dot: '#EF4444' },
  manager:     { bg: '#DBEAFE', text: '#1D4ED8', dot: '#3B82F6' },
  technician:  { bg: '#DCFCE7', text: '#15803D', dot: '#22C55E' },
  viewer:      { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
};

const MODULE_LABELS: Record<string, string> = {
  dashboard:  'Dashboard',    ticket:     'Tickets',
  customer:   'Clientes',     agent:      'Equipe',
  settings:   'Configurações', reports:   'Relatórios',
  knowledge:  'Base de Conhecimento', contracts: 'Contratos',
  networks:   'Redes',        devices:    'Dispositivos',
  alerts:     'Alertas',      chat:       'Chat Interno',
  attendance: 'Atendimento',
};

const MODULE_ICONS: Record<string, string> = {
  dashboard: '📊', ticket: '🎫', customer: '👥', agent: '👤',
  settings: '⚙️', reports: '📈', knowledge: '📚', contracts: '📄',
  networks: '🌐', devices: '🖥️', alerts: '🔔', chat: '💬',
  attendance: '🎧',
};

const PERM_LABELS: Record<string, string> = {
  'dashboard.view': 'Visualizar dashboard',
  'ticket.view': 'Visualizar tickets', 'ticket.create': 'Criar tickets',
  'ticket.edit': 'Editar tickets', 'ticket.reply': 'Responder tickets',
  'ticket.edit_content': 'Editar assunto e descrição do ticket',
  'ticket.transfer': 'Transferir tickets', 'ticket.close': 'Fechar tickets',
  'ticket.reopen': 'Reabrir tickets',
  'ticket.view_all': 'Ver todos os tickets (não só os próprios)',
  'customer.view': 'Visualizar clientes', 'customer.create': 'Criar clientes',
  'customer.edit': 'Editar clientes',
  'agent.view': 'Visualizar equipe', 'agent.create': 'Criar usuários',
  'agent.edit': 'Editar usuários', 'agent.delete': 'Remover usuários',
  'settings.manage': 'Gerenciar configurações',
  'reports.view': 'Visualizar relatórios',
  'knowledge.view': 'Visualizar base de conhecimento', 'knowledge.edit': 'Editar artigos',
  'contracts.view': 'Visualizar contratos', 'contracts.edit': 'Editar contratos',
  'networks.view': 'Visualizar redes', 'networks.edit': 'Editar redes',
  'devices.view': 'Visualizar dispositivos', 'devices.edit': 'Gerenciar dispositivos',
  'alerts.view': 'Visualizar alertas', 'alerts.manage': 'Gerenciar alertas',
  'chat.view': 'Acessar chat interno',
  'chat.view_agents': 'Visualizar todos os agentes',
  'chat.view_status': 'Visualizar status dos agentes',
  'attendance.view': 'Acessar atendimento',
  'attendance.view_all': 'Ver todos os atendimentos (não só os próprios)',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function PerfisPage() {
  const { user } = useAuthStore();
  const canManage = hasPermission(user, 'settings.manage');

  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionsGrouped, setPermissionsGrouped] = useState<PermissionsGrouped>({});
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [editingPerms, setEditingPerms] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set(Object.keys(MODULE_LABELS)));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveOk, setSaveOk] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalData, setModalData] = useState({ name: '', slug: '', description: '' });
  const [modalError, setModalError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.getRoles() as Promise<Role[]>,
        (api as any).getAllPermissions() as Promise<PermissionsGrouped>,
      ]);
      setRoles(rolesRes);
      setPermissionsGrouped(permsRes);
      if (rolesRes.length > 0) {
        setSelectedRole(rolesRes[0]);
        setEditingPerms(new Set(rolesRes[0].permissions));
      }
    } catch { /* noop */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, []); // eslint-disable-line

  function selectRole(role: Role) {
    setSelectedRole(role);
    setEditingPerms(new Set(role.permissions));
    setDirty(false);
    setSaveOk(false);
  }

  function togglePerm(code: string) {
    if (!canManage || selectedRole?.slug === 'super_admin') return;
    setEditingPerms(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
    setDirty(true);
    setSaveOk(false);
  }

  function toggleModule(module: string, codes: string[]) {
    if (!canManage || selectedRole?.slug === 'super_admin') return;
    const allChecked = codes.every(c => editingPerms.has(c));
    setEditingPerms(prev => {
      const next = new Set(prev);
      allChecked ? codes.forEach(c => next.delete(c)) : codes.forEach(c => next.add(c));
      return next;
    });
    setDirty(true);
    setSaveOk(false);
  }

  function toggleAll() {
    if (!canManage || selectedRole?.slug === 'super_admin') return;
    const allCodes = Object.values(permissionsGrouped).flat().map(p => p.code);
    const allChecked = allCodes.every(c => editingPerms.has(c));
    setEditingPerms(() => {
      const next = new Set<string>();
      if (!allChecked) allCodes.forEach(c => next.add(c));
      return next;
    });
    setDirty(true);
    setSaveOk(false);
  }

  async function savePermissions() {
    if (!selectedRole || !dirty) return;
    setSaving(true);
    try {
      const updated = await api.setRolePermissions(selectedRole.id, Array.from(editingPerms)) as Role;
      setRoles(prev => prev.map(r => r.id === updated.id ? { ...r, permissions: updated.permissions } : r));
      setSelectedRole(prev => prev ? { ...prev, permissions: updated.permissions } : null);
      setDirty(false);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch { /* noop */ } finally { setSaving(false); }
  }

  function openCreate() {
    setModalMode('create');
    setModalData({ name: '', slug: '', description: '' });
    setModalError('');
    setModalOpen(true);
  }

  function openEdit(role: Role, e: React.MouseEvent) {
    e.stopPropagation();
    setModalMode('edit');
    setModalData({ name: role.name, slug: role.slug, description: role.description ?? '' });
    setModalError('');
    setModalOpen(true);
  }

  async function handleModalSave() {
    setModalError('');
    if (!modalData.name.trim()) { setModalError('Nome é obrigatório'); return; }
    if (modalMode === 'create' && !modalData.slug.trim()) { setModalError('Slug é obrigatório'); return; }
    try {
      if (modalMode === 'create') {
        const created = await api.createRole({
          slug: modalData.slug.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
          name: modalData.name.trim(),
          description: modalData.description.trim() || undefined,
        }) as Role;
        setRoles(prev => [...prev, created]);
        selectRole(created);
      } else if (selectedRole) {
        const updated = await api.updateRole(selectedRole.id, {
          name: modalData.name.trim(),
          description: modalData.description.trim() || undefined,
        }) as Role;
        setRoles(prev => prev.map(r => r.id === updated.id ? { ...r, name: updated.name, description: updated.description } : r));
        setSelectedRole(prev => prev ? { ...prev, name: updated.name, description: updated.description } : null);
      }
      setModalOpen(false);
    } catch (err: any) { setModalError(err?.response?.data?.message ?? 'Erro ao salvar'); }
  }

  async function handleDelete(role: Role, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Remover o perfil "${role.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await api.deleteRole(role.id);
      const remaining = roles.filter(r => r.id !== role.id);
      setRoles(remaining);
      if (selectedRole?.id === role.id) selectRole(remaining[0] ?? null);
    } catch (err: any) { toast.error(err?.response?.data?.message ?? 'Erro ao remover perfil'); }
  }

  const isSysRole = (slug: string) => SYSTEM_ROLES.includes(slug);
  const isSuperAdmin = selectedRole?.slug === 'super_admin';

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', boxShadow: '0 4px 14px rgba(79,70,229,0.35)' }}>
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Perfis de Acesso</h1>
            <p className="page-subtitle">{roles.length} perfis configurados • {Object.values(permissionsGrouped).flat().length} permissões disponíveis</p>
          </div>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4" /> Novo Perfil
          </button>
        )}
      </div>

      <div className="flex gap-5 items-start">
        {/* ── Lista de perfis ── */}
        <div className="w-64 shrink-0 space-y-2">
          <p className="label px-1">Perfis</p>
          {roles.map(role => {
            const colors = ROLE_COLOR[role.slug] ?? { bg: '#EEF2FF', text: '#4F46E5', dot: '#6366F1' };
            const isSelected = selectedRole?.id === role.id;
            return (
              <button key={role.id} onClick={() => selectRole(role)}
                className="w-full text-left rounded-2xl transition-all"
                style={{
                  padding: '12px 14px',
                  background: isSelected ? '#EEF2FF' : 'white',
                  border: `1.5px solid ${isSelected ? '#A5B4FC' : '#E2E8F0'}`,
                  boxShadow: isSelected ? '0 0 0 3px rgba(99,102,241,0.1)' : '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: colors.dot }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: isSelected ? '#4F46E5' : '#0F172A' }}>
                        {role.name}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
                        {role.slug === 'super_admin' ? 'Acesso total' : `${role.permissions.length} permissões`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isSysRole(role.slug) && <Lock className="w-3 h-3" style={{ color: '#CBD5E1' }} />}
                    {canManage && (
                      <button onClick={e => openEdit(role, e)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-indigo-50"
                        title="Editar nome">
                        <Pencil className="w-3 h-3" style={{ color: '#94A3B8' }} />
                      </button>
                    )}
                    {canManage && !isSysRole(role.slug) && (
                      <button onClick={e => handleDelete(role, e)}
                        className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-red-50"
                        title="Remover perfil">
                        <Trash2 className="w-3 h-3" style={{ color: '#EF4444' }} />
                      </button>
                    )}
                  </div>
                </div>
                {role.slug !== 'super_admin' && (
                  <div className="mt-2">
                    <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: '#F1F5F9' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (role.permissions.length / 28) * 100)}%`,
                          background: colors.dot,
                        }} />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Painel de permissões ── */}
        {selectedRole && (
          <div className="flex-1 card overflow-hidden">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1.5px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: (ROLE_COLOR[selectedRole.slug] ?? { bg: '#EEF2FF' }).bg }}>
                  <ShieldCheck className="w-5 h-5" style={{ color: (ROLE_COLOR[selectedRole.slug] ?? { text: '#4F46E5' }).text }} />
                </div>
                <div>
                  <h2 className="text-base font-bold" style={{ color: '#0F172A' }}>{selectedRole.name}</h2>
                  {selectedRole.description
                    ? <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{selectedRole.description}</p>
                    : <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>{selectedRole.slug}</p>
                  }
                </div>
                {isSuperAdmin && (
                  <span className="ml-2 px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{ background: '#DCFCE7', color: '#15803D' }}>
                    Acesso total
                  </span>
                )}
              </div>
              {canManage && !isSuperAdmin && (
                <button onClick={savePermissions} disabled={!dirty || saving}
                  className={dirty ? 'btn-success' : 'btn-secondary'}
                  style={{ minWidth: 160, justifyContent: 'center' }}>
                  {saving
                    ? <><div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Salvando…</>
                    : saveOk
                    ? <><Check className="w-4 h-4" /> Salvo!</>
                    : <><Save className="w-4 h-4" /> {dirty ? 'Salvar alterações' : 'Sem alterações'}</>
                  }
                </button>
              )}
            </div>

            {isSuperAdmin && (
              <div className="px-6 py-4 flex items-center gap-3"
                style={{ background: '#F0FDF4', borderBottom: '1px solid #BBF7D0' }}>
                <div className="w-8 h-8 rounded-xl bg-green-100 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-sm font-medium text-green-800">
                  Super Administrador possui todas as permissões do sistema e não pode ser editado.
                </p>
              </div>
            )}

            {/* Resumo de permissões */}
            {!isSuperAdmin && (
              <div className="px-6 py-3 flex items-center gap-6" style={{ borderBottom: '1px solid #F1F5F9', background: '#FAFBFF' }}>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                  <span className="text-sm font-semibold" style={{ color: '#4F46E5' }}>{editingPerms.size}</span>
                  <span className="text-xs" style={{ color: '#94A3B8' }}>selecionadas</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-slate-300" />
                  <span className="text-sm font-semibold" style={{ color: '#64748B' }}>{Object.values(permissionsGrouped).flat().length - editingPerms.size}</span>
                  <span className="text-xs" style={{ color: '#94A3B8' }}>bloqueadas</span>
                </div>
                {canManage && (
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg transition-all"
                    style={{
                      background: Object.values(permissionsGrouped).flat().every(p => editingPerms.has(p.code)) ? '#DCFCE7' : '#EEF2FF',
                      color:      Object.values(permissionsGrouped).flat().every(p => editingPerms.has(p.code)) ? '#15803D' : '#4F46E5',
                      border:     Object.values(permissionsGrouped).flat().every(p => editingPerms.has(p.code)) ? '1px solid #BBF7D0' : '1px solid #C7D2FE',
                    }}
                  >
                    {Object.values(permissionsGrouped).flat().every(p => editingPerms.has(p.code))
                      ? <><Check className="w-3 h-3" /> Desmarcar tudo</>
                      : <><Check className="w-3 h-3" /> Marcar tudo</>
                    }
                  </button>
                )}
                {dirty && (
                  <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: '#FEF9C3', color: '#92400E' }}>
                    Alterações não salvas
                  </span>
                )}
              </div>
            )}

            {/* Grupos de permissões */}
            <div className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: 520 }}>
              {Object.entries(permissionsGrouped).map(([module, perms]) => {
                const codes = perms.map(p => p.code);
                const checkedCount = codes.filter(c => isSuperAdmin || editingPerms.has(c)).length;
                const allChecked = checkedCount === codes.length;
                const someChecked = checkedCount > 0 && !allChecked;
                const isExpanded = expandedModules.has(module);

                return (
                  <div key={module}>
                    {/* Header do módulo */}
                    <div className="flex items-center gap-3 px-6 py-3 cursor-pointer select-none transition-colors hover:bg-slate-50"
                      style={{ background: isExpanded ? '#FAFBFF' : 'white' }}
                      onClick={() => setExpandedModules(prev => {
                        const next = new Set(prev);
                        next.has(module) ? next.delete(module) : next.add(module);
                        return next;
                      })}>
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: '#94A3B8' }} />
                        : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#94A3B8' }} />
                      }
                      <span className="text-sm mr-1">{MODULE_ICONS[module] ?? '🔧'}</span>
                      <span className="text-sm font-semibold flex-1" style={{ color: '#0F172A' }}>
                        {MODULE_LABELS[module] ?? module}
                      </span>
                      <div className="flex items-center gap-2">
                        {canManage && !isSuperAdmin && (
                          <button
                            className="text-xs px-2 py-0.5 rounded-lg transition-colors hover:bg-indigo-50"
                            style={{ color: '#6366F1', fontWeight: 600 }}
                            onClick={e => { e.stopPropagation(); toggleModule(module, codes); }}>
                            {allChecked ? 'Desmarcar todos' : 'Marcar todos'}
                          </button>
                        )}
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: allChecked ? '#DCFCE7' : someChecked ? '#FEF9C3' : '#F1F5F9',
                            color:      allChecked ? '#15803D' : someChecked ? '#92400E' : '#94A3B8',
                          }}>
                          {checkedCount}/{codes.length}
                        </span>
                      </div>
                    </div>

                    {/* Permissões */}
                    {isExpanded && (
                      <div className="px-6 pb-2 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {perms.map(perm => {
                          const checked = isSuperAdmin || editingPerms.has(perm.code);
                          return (
                            <label key={perm.id}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer"
                              style={{
                                background: checked ? '#EEF2FF' : '#F8FAFC',
                                border: `1.5px solid ${checked ? '#C7D2FE' : '#F1F5F9'}`,
                                cursor: canManage && !isSuperAdmin ? 'pointer' : 'default',
                              }}
                              onClick={() => togglePerm(perm.code)}>
                              {/* Checkbox custom */}
                              <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all"
                                style={{
                                  background: checked ? '#4F46E5' : 'white',
                                  border: `2px solid ${checked ? '#4F46E5' : '#CBD5E1'}`,
                                }}>
                                {checked && (
                                  <svg viewBox="0 0 10 8" className="w-2.5 h-2" fill="none">
                                    <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: checked ? '#3730A3' : '#374151' }}>
                                  {PERM_LABELS[perm.code] ?? perm.name}
                                </p>
                                <p className="text-xs font-mono mt-0.5 truncate" style={{ color: '#94A3B8' }}>
                                  {perm.code}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Modal criar/editar ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl w-full max-w-md animate-fade-up"
            style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: '1px solid #E2E8F0' }}>
            <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid #F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }}>
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-bold text-sm" style={{ color: '#0F172A' }}>
                    {modalMode === 'create' ? 'Novo Perfil de Acesso' : 'Editar Perfil'}
                  </h2>
                  <p className="text-xs" style={{ color: '#94A3B8' }}>
                    {modalMode === 'create' ? 'Defina o nome e slug do perfil' : 'Atualize as informações do perfil'}
                  </p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors hover:bg-slate-100">
                <X className="w-4 h-4" style={{ color: '#94A3B8' }} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="label">Nome do Perfil <span style={{ color: '#6366F1' }}>*</span></label>
                <input value={modalData.name} onChange={e => setModalData(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Analista de Suporte" className="input" />
              </div>
              {modalMode === 'create' && (
                <div>
                  <label className="label">Slug (identificador) <span style={{ color: '#6366F1' }}>*</span></label>
                  <input value={modalData.slug}
                    onChange={e => setModalData(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))}
                    placeholder="ex: analista_suporte" className="input font-mono" />
                  <p className="text-xs mt-1" style={{ color: '#94A3B8' }}>Apenas letras minúsculas, números e underscore</p>
                </div>
              )}
              <div>
                <label className="label">Descrição (opcional)</label>
                <textarea value={modalData.description}
                  onChange={e => setModalData(p => ({ ...p, description: e.target.value }))}
                  placeholder="Descreva as responsabilidades deste perfil..."
                  rows={3} className="input resize-none" />
              </div>
              {modalError && (
                <div className="flex items-center gap-2 p-3 rounded-xl text-sm"
                  style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                  <X className="w-4 h-4 shrink-0" /> {modalError}
                </div>
              )}
            </div>

            <div className="flex gap-3 p-5 pt-0">
              <button onClick={() => setModalOpen(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button onClick={handleModalSave} className="btn-primary flex-1 justify-center">
                {modalMode === 'create' ? 'Criar Perfil' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
