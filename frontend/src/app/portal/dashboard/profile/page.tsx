'use client';
import { usePortalStore } from '@/store/portal.store';
import { User, Building2, Mail, Phone } from 'lucide-react';

export default function PortalProfilePage() {
  const { contact, client } = usePortalStore();
  return (
    <div style={{ maxWidth:600 }}>
      <h1 style={{ color:'#0F172A', fontSize:22, fontWeight:800, margin:'0 0 24px' }}>Meu Perfil</h1>
      <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:16, padding:28, marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
          <div style={{ width:60, height:60, borderRadius:'50%', background:'linear-gradient(135deg,#4F46E5,#6366F1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:800, color:'#fff' }}>
            {contact?.name?.[0]?.toUpperCase()||'?'}
          </div>
          <div>
            <h2 style={{ color:'#0F172A', fontWeight:700, fontSize:18, margin:'0 0 4px' }}>{contact?.name}</h2>
            <p style={{ color:'#94A3B8', fontSize:13, margin:0 }}>{contact?.role||'Contato'}</p>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {[
            { icon:Mail, label:'E-mail', value:contact?.email },
            { icon:Phone, label:'Telefone', value:contact?.phone||'—' },
            { icon:Building2, label:'Empresa', value:client?.tradeName||client?.companyName },
          ].map(({ icon:Icon, label, value }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'#F8FAFC', borderRadius:10 }}>
              <div style={{ width:34, height:34, borderRadius:9, background:'#EEF2FF', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Icon style={{ width:16, height:16, color:'#4F46E5' }} />
              </div>
              <div>
                <p style={{ fontSize:11, color:'#94A3B8', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.07em', margin:'0 0 2px' }}>{label}</p>
                <p style={{ fontSize:14, color:'#0F172A', fontWeight:500, margin:0 }}>{value||'—'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
