import type { ReactNode } from 'react';

type TrendDir = 'up' | 'down' | 'neutral';

interface StatCardProps {
  value: number | string;
  label: string;
  icon?: ReactNode;
  trend?: string;
  trendDir?: TrendDir;
  onClick?: () => void;
  active?: boolean;
}

const TREND_COLOR: Record<TrendDir, string> = {
  up:      '#16A34A',
  down:    '#DC2626',
  neutral: '#64748B',
};

const TREND_ICON: Record<TrendDir, string> = {
  up:      '↑',
  down:    '↓',
  neutral: '→',
};

export default function StatCard({
  value,
  label,
  icon,
  trend,
  trendDir = 'neutral',
  onClick,
  active,
}: StatCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      style={{
        background: '#fff',
        border: active ? '1.5px solid #4F46E5' : '1px solid rgba(0,0,0,0.07)',
        borderRadius: 12,
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: active ? '0 0 0 3px rgba(79,70,229,0.12)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: active ? '#4F46E5' : '#0F172A',
              lineHeight: 1,
              marginBottom: 4,
            }}
          >
            {value}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>{label}</div>
          {trend && (
            <div style={{ fontSize: 11, color: TREND_COLOR[trendDir], marginTop: 4, fontWeight: 500 }}>
              {TREND_ICON[trendDir]} {trend}
            </div>
          )}
        </div>
        {icon && (
          <div style={{ color: active ? '#4F46E5' : '#94A3B8', flexShrink: 0 }}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
