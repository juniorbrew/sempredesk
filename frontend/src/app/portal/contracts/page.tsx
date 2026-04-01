'use client';
import { useEffect, useState } from 'react';
import { usePortalStore } from '@/store/portal.store';
import { portalFetch } from '@/lib/portal-fetch';
import { FileText, Clock, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const TYPE_LABELS: Record<string,string> = { hours_bank:'Banco de Horas', monthly:'Mensal', on_demand:'Sob Demanda', warranty:'Garantia' };
const STATUS_STYLE: Record<string,{ bg:string; color:string }> = {
  active:{ bg:'#DCFCE7', color:'#15803D' }, expired:{ bg:'#FEE2E2', color:'#DC2626' },
  cancelled:{ bg:'#F1F5F9', color:'#475569' }, suspended:{ bg:'#FEF9C3', color:'#854D0E' },
};

export default function PortalContractsPage() {
  const { client, accessToken } = usePortalStore();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken || !client?.id) return;
    setLoading(true);
    portalFetch(`/api/v1/contracts`, { headers:{ Authorization:`Bearer ${accessToken}` } })
      .then(r=>r.json())
      .then(d => {
        const all = d?.data?.data || d?.data || d || [];
        setContracts(Array.isArray(all) ? all.filter((c:any) => c.clientId === client.id) : []);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  }, [accessToken, client]);

  return (
    <div style={{ maxWidth:800 }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ color:'#0F172A', fontSize:22, fontWeight:800, margin:'0 0 4px' }}>Meus Contratos</h1>
        <p style={{ color:'#94A3B8', fontSize:13, margin:0 }}>{contracts.length} contrato{contracts.length!==1?'s':''}</p>
      </div>

      {loading ? (
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:40, textAlign:'center', color:'#94A3B8' }}>Carregando...</div>
      ) : contracts.length === 0 ? (
        <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:60, textAlign:'center', color:'#94A3B8' }}>
          <FileText style={{ width:40, height:40, margin:'0 auto 16px', opacity:0.2 }} />
          <p style={{ fontWeight:600, color:'#475569', margin:0 }}>Nenhum contrato encontrado</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {contracts.map((c:any) => {
            const s = STATUS_STYLE[c.status]||{ bg:'#F1F5F9', color:'#475569' };
            return (
              <div key={c.id} style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:20 }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:14 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:42, height:42, borderRadius:12, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <FileText style={{ width:20, height:20, color:'#4F46E5' }} />
                    </div>
                    <div>
                      <p style={{ fontSize:15, fontWeight:700, color:'#0F172A', margin:0 }}>{TYPE_LABELS[c.contractType]||c.contractType}</p>
                      <p style={{ fontSize:12, color:'#94A3B8', margin:'2px 0 0' }}>
                        {c.startDate ? format(new Date(c.startDate),'dd/MM/yyyy',{locale:ptBR}) : '—'}
                        {c.endDate ? ` até ${format(new Date(c.endDate),'dd/MM/yyyy',{locale:ptBR})}` : ' · Sem prazo'}
                      </p>
                    </div>
                  </div>
                  <span style={{ background:s.bg, color:s.color, padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:700 }}>
                    {c.status==='active'?'Ativo':c.status==='expired'?'Expirado':c.status==='cancelled'?'Cancelado':'Suspenso'}
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
                  {[
                    { label:'SLA Resposta', value:`${c.slaResponseHours}h` },
                    { label:'SLA Resolução', value:`${c.slaResolveHours}h` },
                    { label:'Horas/Mês', value:c.monthlyHours?`${c.monthlyHours}h`:'—' },
                    { label:'Valor Mensal', value:c.monthlyValue>0?`R$ ${Number(c.monthlyValue).toLocaleString('pt-BR',{minimumFractionDigits:2})}`:'—' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ background:'#F8FAFC', borderRadius:10, padding:'10px 14px' }}>
                      <p style={{ fontSize:10, color:'#94A3B8', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 3px' }}>{label}</p>
                      <p style={{ fontSize:14, fontWeight:700, color:'#0F172A', margin:0 }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
