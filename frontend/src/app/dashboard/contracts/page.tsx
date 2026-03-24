'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Plus, FileText, AlertTriangle, Pencil, Trash2, ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo', expired: 'Expirado', cancelled: 'Cancelado', suspended: 'Suspenso',
};
const TYPE_LABELS: Record<string, string> = {
  hours_bank: 'Banco de Horas', monthly: 'Mensal', on_demand: 'Sob Demanda', warranty: 'Garantia',
};

const EMPTY_FORM = {
  clientId: '', contractType: 'monthly', slaResponseHours: 4, slaResolveHours: 24,
  monthlyHours: '', monthlyValue: '', startDate: '', endDate: '', status: 'active', notes: '',
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [expiring, setExpiring] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({...EMPTY_FORM});

  const load = async () => {
    setLoading(true);
    try {
      const [c, e, cust]: any = await Promise.all([
        api.getContracts(), api.expiringContracts(), api.getCustomers({ perPage: 200 })
      ]);
      setContracts(Array.isArray(c) ? c : c?.data || []);
      setExpiring(Array.isArray(e) ? e : e?.data || []);
      setCustomers(cust?.data || cust || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const customerName = (id: string) => {
    const c = customers.find((c: any) => c.id === id);
    return c ? (c.tradeName || c.companyName) : id?.slice(0, 8) + '…';
  };

  const openNew = () => {
    setEditing(null);
    setForm({...EMPTY_FORM});
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      clientId: c.clientId || '',
      contractType: c.contractType || 'monthly',
      slaResponseHours: c.slaResponseHours || 4,
      slaResolveHours: c.slaResolveHours || 24,
      monthlyHours: c.monthlyHours || '',
      monthlyValue: c.monthlyValue || '',
      startDate: c.startDate ? c.startDate.slice(0, 10) : '',
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      status: c.status || 'active',
      notes: c.notes || '',
    });
    setShowModal(true);
  };

  const deleteContract = async (id: string) => {
    if (!window.confirm('Deseja realmente excluir este contrato?')) return;
    try {
      await api.deleteContract(id);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao excluir contrato');
    }
  };

  const saveContract = async (e: any) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        clientId: form.clientId,
        contractType: form.contractType,
        slaResponseHours: Number(form.slaResponseHours),
        slaResolveHours: Number(form.slaResolveHours),
        monthlyHours: form.monthlyHours ? Number(form.monthlyHours) : undefined,
        monthlyValue: form.monthlyValue ? Number(form.monthlyValue) : undefined,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        status: form.status,
        notes: form.notes || undefined,
      };
      if (editing) {
        await api.updateContract(editing.id, payload);
      } else {
        await api.createContract(payload);
      }
      setShowModal(false);
      await load();
      toast.success(editing ? 'Contrato atualizado!' : 'Contrato criado!');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Erro ao salvar contrato');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background:'linear-gradient(135deg,#6366F1,#4F46E5)', boxShadow:'0 4px 14px rgba(99,102,241,0.35)' }}>
            <ClipboardList className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="page-title">Contratos</h1>
            <p className="page-subtitle">{contracts.length} contrato{contracts.length !== 1 ? 's' : ''} cadastrado{contracts.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openNew}>
          <Plus className="w-4 h-4" /> Novo Contrato
        </button>
      </div>

      {expiring.length > 0 && (
        <div className="card border-yellow-300 p-4 bg-yellow-50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <span className="font-semibold text-yellow-800 text-sm">{expiring.length} contrato(s) expirando em 30 dias</span>
          </div>
          {expiring.slice(0, 3).map((c: any) => (
            <div key={c.id} className="text-xs text-yellow-700">
              {customerName(c.clientId)} — vence em {format(new Date(c.endDate), 'dd/MM/yyyy', { locale: ptBR })}
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="t-bg border-b t-border">
              {['Cliente', 'Tipo', 'SLA Resp.', 'SLA Resol.', 'Horas/Mês', 'Valor Mensal', 'Vigência', 'Status', 'Ações'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold t-text-muted uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12 t-text-muted">Carregando...</td></tr>
            ) : contracts.length === 0 ? (
              <tr><td colSpan={9} className="py-16 text-center">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="t-text-muted">Nenhum contrato cadastrado</p>
              </td></tr>
            ) : contracts.map((c: any) => (
              <tr key={c.id} className="hover:t-bg">
                <td className="px-4 py-3 font-medium t-text">{customerName(c.clientId)}</td>
                <td className="px-4 py-3 t-text-secondary">{TYPE_LABELS[c.contractType] || c.contractType}</td>
                <td className="px-4 py-3 t-text-secondary">{c.slaResponseHours}h</td>
                <td className="px-4 py-3 t-text-secondary">{c.slaResolveHours}h</td>
                <td className="px-4 py-3 t-text-secondary">{c.monthlyHours || '—'}</td>
                <td className="px-4 py-3 t-text font-medium">
                  {c.monthlyValue > 0 ? `R$ ${Number(c.monthlyValue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">
                  {format(new Date(c.startDate), 'dd/MM/yy')} →{' '}
                  {c.endDate ? format(new Date(c.endDate), 'dd/MM/yy') : '∞'}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${c.status === 'active' ? 'bg-green-100 text-green-700' : c.status === 'expired' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[c.status] || c.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(c)} className="p-1 t-text-muted hover:text-indigo-600" title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteContract(c.id)} className="p-1 t-text-muted hover:text-red-600" title="Excluir">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background:'rgba(0,0,0,0.5)' }}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-up" style={{ borderRadius:16, padding:0 }}>
            <div className="flex items-center gap-3 p-6 pb-4" style={{ borderBottom:'1px solid #E2E8F0' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background:'linear-gradient(135deg,#6366F1,#4F46E5)' }}>
                <ClipboardList className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-lg font-bold t-text">{editing ? 'Editar Contrato' : 'Novo Contrato'}</h2>
            </div>
            <div className="p-6 pt-4">
            <form onSubmit={saveContract} className="space-y-3">

              <div>
                <label className="block text-sm font-medium mb-1">Cliente *</label>
                <select className="input" required value={form.clientId} onChange={e => setForm({...form, clientId: e.target.value})}>
                  <option value="">Selecione o cliente</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.tradeName || c.companyName}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Tipo *</label>
                <select className="input" value={form.contractType} onChange={e => setForm({...form, contractType: e.target.value})}>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">SLA Resposta (h) *</label>
                  <input type="number" className="input" required value={form.slaResponseHours} onChange={e => setForm({...form, slaResponseHours: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">SLA Resolução (h) *</label>
                  <input type="number" className="input" required value={form.slaResolveHours} onChange={e => setForm({...form, slaResolveHours: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Horas/Mês</label>
                  <input type="number" className="input" value={form.monthlyHours} onChange={e => setForm({...form, monthlyHours: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Valor Mensal (R$)</label>
                  <input type="number" className="input" value={form.monthlyValue} onChange={e => setForm({...form, monthlyValue: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Data Início *</label>
                  <input type="date" className="input" required value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Data Fim</label>
                  <input type="date" className="input" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Status</label>
                <select className="input" value={form.status} onChange={e => setForm({...form, status: e.target.value})}>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Observações</label>
                <textarea className="input min-h-20" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary flex-1" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
