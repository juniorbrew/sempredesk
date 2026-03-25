'use client';
import { useState, useRef, useEffect } from 'react';
import { usePresence } from '@/components/PresenceProvider';
import { usePresenceStore } from '@/store/presence.store';
import { useAuthStore } from '@/store/auth.store';
import { ChevronDown } from 'lucide-react';
import { STATUS_STYLE } from '@/lib/presence';

const STATUS_OPTIONS = (['online', 'away', 'busy'] as const).map((v) => ({
  value: v,
  label: STATUS_STYLE[v].label,
  color: STATUS_STYLE[v].color,
}));

export function StatusSelector() {
  const { user } = useAuthStore();
  const { setStatus, isConnected } = usePresence();
  const myStatus = usePresenceStore((s) => user?.id ? (s.statusMap[user.id] || 'offline') : 'offline');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = myStatus === 'offline'
  ? { value: 'offline' as const, label: STATUS_STYLE.offline.label, color: STATUS_STYLE.offline.color }
  : STATUS_OPTIONS.find((o) => o.value === myStatus) || STATUS_OPTIONS[0];

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onOutside);
    return () => document.removeEventListener('click', onOutside);
  }, []);

  if (!user?.id) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#1E293B',
          color: '#E2E8F0',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected ? current.color : '#94A3B8',
          }}
        />
        {current.label}
        <ChevronDown className="w-4 h-4" style={{ opacity: open ? 1 : 0.7 }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            background: '#1E293B',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
            minWidth: 140,
            zIndex: 50,
          }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setStatus(opt.value);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 14px',
                background: myStatus === opt.value ? 'rgba(99,102,241,0.15)' : 'transparent',
                border: 'none',
                color: '#E2E8F0',
                fontSize: 13,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color }} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
