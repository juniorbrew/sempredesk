'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Shield, Zap, Headphones, BarChart3, Building2 } from 'lucide-react';

/** Ao abrir login, limpar modo TV compacto para não herdar CSS global em <html>. */
function useClearRealtimeTvModeOnMount() {
  useEffect(() => {
    document.documentElement.classList.remove('realtime-tv-mode');
  }, []);
}

interface LoginForm { email: string; password: string; }
interface TenantInfo { id: string; name: string; slug: string; }

function destinoAposLoginHost(): '/admin/tenants' | '/dashboard' {
  if (typeof window === 'undefined') return '/dashboard';
  return window.location.hostname.includes('adminpanel.') ? '/admin/tenants' : '/dashboard';
}

/** Componente interno — separado para que Suspense envolva useSearchParams() */
function LoginPageInner() {
  useClearRealtimeTvModeOnMount();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [painelMaster, setPainelMaster] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [tenantNotFound, setTenantNotFound] = useState(false);

  useEffect(() => {
    setPainelMaster(window.location.hostname.includes('adminpanel.'));
  }, []);

  // Resolve o tenant a partir do ?tenant= na URL OU do hostname automaticamente.
  // Prioridade: ?tenant= > hostname > nenhum (login genérico sem badge).
  // Subdomínios fixos do sistema nunca são tratados como tenant.
  useEffect(() => {
    const SYSTEM_SUBDOMAINS = new Set(['suporte', 'cliente', 'adminpanel', 'www', 'api', 'app', 'mail']);
    const BASE_DOMAIN = 'sempredesk.com.br';

    let slugToResolve = searchParams.get('tenant');

    if (!slugToResolve) {
      const hostname = window.location.hostname;
      // Extrai subdomínio se o hostname for <sub>.sempredesk.com.br
      if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
        const sub = hostname.slice(0, hostname.length - BASE_DOMAIN.length - 1);
        // Apenas um nível de subdomínio (não "a.b.sempredesk.com.br") e não fixo do sistema
        if (sub && !sub.includes('.') && !SYSTEM_SUBDOMAINS.has(sub)) {
          slugToResolve = sub;
        }
      }
    }

    if (!slugToResolve) return;

    fetch(`/api/v1/tenants/by-subdomain/${encodeURIComponent(slugToResolve)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => setTenantInfo(data?.data ?? data))
      .catch(() => setTenantNotFound(true));
  }, [searchParams]);

  useEffect(() => {
    useAuthStore.persist.rehydrate();
    const token = localStorage.getItem('accessToken');
    if (token) router.replace(destinoAposLoginHost());
  }, [router]);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      // tenantSlug: prioridade ?tenant= param, depois slug detectado no badge (via hostname)
      // Garante que o backend valide o vínculo mesmo sem query param na URL
      const paramSlug = searchParams.get('tenant') ?? undefined;
      const tenantSlug = paramSlug ?? tenantInfo?.slug ?? undefined;
      const res: any = await api.login(data.email, data.password, tenantSlug);
      setAuth(res.user, res.accessToken, res.refreshToken);
      toast.success(`Bem-vindo, ${res.user.name}!`);
      router.push(destinoAposLoginHost());
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message
        || err?.response?.data?.message
        || 'Credenciais inválidas';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-900 to-indigo-700 flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Headphones className="w-6 h-6 text-white" />
            </div>
            <span className="text-white font-bold text-xl">SempreDesk</span>
          </div>
          <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
            {painelMaster
              ? 'Administração master — empresas e licenças'
              : 'Gerencie seu suporte técnico com eficiência'}
          </h1>
          <p className="text-indigo-200 text-lg">
            {painelMaster
              ? 'Onboarding de tenants, renovação de licenças e gestão da plataforma.'
              : 'Tickets, monitoramento de PDVs, contratos e muito mais em um só lugar.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: <Shield className="w-5 h-5" />, title: 'SLA Garantido', desc: 'Controle de prazos automático' },
            { icon: <Zap className="w-5 h-5" />, title: 'Monitoramento', desc: 'PDVs em tempo real' },
            { icon: <BarChart3 className="w-5 h-5" />, title: 'Relatórios', desc: 'Dashboard completo' },
            { icon: <Headphones className="w-5 h-5" />, title: 'Multi-canal', desc: 'WhatsApp, email, portal' },
          ].map((f) => (
            <div key={f.title} className="bg-white/10 rounded-xl p-4">
              <div className="text-indigo-200 mb-2">{f.icon}</div>
              <div className="text-white font-semibold text-sm">{f.title}</div>
              <div className="text-indigo-300 text-xs">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">
          {/* Badge de empresa (acesso via subdomínio) */}
          {tenantNotFound && (
            <div className="mb-6 flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-red-700 text-sm">Empresa não encontrada</p>
                <p className="text-red-500 text-xs">O subdomínio acessado não corresponde a nenhuma empresa cadastrada.</p>
              </div>
            </div>
          )}
          {tenantInfo && (
            <div className="mb-6 flex items-center gap-3 p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
              <div className="w-9 h-9 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-indigo-500 font-medium uppercase tracking-wide">Acessando como equipe de</p>
                <p className="font-bold text-indigo-800 text-sm truncate">{tenantInfo.name}</p>
              </div>
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">
              {painelMaster ? 'Painel master' : 'Entrar'}
            </h2>
            <p className="text-gray-500 mt-2">
              {painelMaster
                ? 'Acesso restrito à equipe SempreDesk (super admin).'
                : 'Acesse sua conta para continuar'}
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="label">E-mail</label>
              <input
                {...register('email', { required: 'E-mail obrigatório' })}
                type="email"
                className="input"
                placeholder="seu@email.com"
                autoComplete="email"
              />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="label">Senha</label>
              <div className="relative">
                <input
                  {...register('password', { required: 'Senha obrigatória' })}
                  type={showPwd ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : 'Entrar'}
            </button>
          </form>

          {!painelMaster && (
            <div className="mt-8 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
              <p className="font-medium mb-1">Credenciais demo (equipe):</p>
              <p>admin@demo.com / Admin@123</p>
            </div>
          )}

          {painelMaster ? (
            <div className="mt-8 p-4 bg-slate-100 rounded-lg text-sm text-slate-700 border border-slate-200">
              <p className="font-semibold mb-1">Operação diária do suporte</p>
              <p className="mb-2">Use <strong>suporte.sempredesk.com.br</strong> para tickets e dashboard da empresa.</p>
              <a href="https://suporte.sempredesk.com.br/auth/login" className="text-indigo-700 hover:underline font-semibold">
                Ir para o painel de suporte →
              </a>
            </div>
          ) : (
            <div className="mt-4 p-4 bg-amber-50 rounded-lg text-sm text-amber-800 border border-amber-200">
              <p className="font-semibold mb-1">É cliente? Use o portal do cliente</p>
              <p className="mb-2">As credenciais do portal <strong>não funcionam aqui</strong>. Acesse <strong>cliente.sempredesk.com.br</strong> para acompanhar seus tickets.</p>
              <a href="https://cliente.sempredesk.com.br" className="text-amber-700 hover:underline font-semibold">
                Ir para portal do cliente →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Suspense obrigatório quando useSearchParams() é usado em Next.js 14 App Router */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
