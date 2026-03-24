'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Shield, Zap, Headphones, BarChart3 } from 'lucide-react';

interface LoginForm { email: string; password: string; }

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    useAuthStore.persist.rehydrate();
    const token = localStorage.getItem('accessToken');
    if (token) router.replace('/dashboard');
  }, [router]);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const res: any = await api.login(data.email, data.password);
      setAuth(res.user, res.accessToken, res.refreshToken);
      toast.success(`Bem-vindo, ${res.user.name}!`);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Credenciais inválidas');
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
            Gerencie seu suporte técnico com eficiência
          </h1>
          <p className="text-indigo-200 text-lg">
            Tickets, monitoramento de PDVs, contratos e muito mais em um só lugar.
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
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Entrar</h2>
            <p className="text-gray-500 mt-2">Acesse sua conta para continuar</p>
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

          <div className="mt-8 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
            <p className="font-medium mb-1">Credenciais demo (equipe):</p>
            <p>admin@demo.com / Admin@123</p>
          </div>

          <div className="mt-4 p-4 bg-amber-50 rounded-lg text-sm text-amber-800 border border-amber-200">
            <p className="font-semibold mb-1">É cliente? Use o portal do cliente</p>
            <p className="mb-2">As credenciais do portal <strong>não funcionam aqui</strong>. Acesse <strong>cliente.sempredesk.com.br</strong> para acompanhar seus tickets.</p>
            <a href="https://cliente.sempredesk.com.br" className="text-amber-700 hover:underline font-semibold">
              Ir para portal do cliente →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
