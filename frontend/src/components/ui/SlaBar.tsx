interface SlaBarProps {
  percent: number;
  label?: string;
}

export default function SlaBar({ percent, label }: SlaBarProps) {
  const clamped = Math.min(100, Math.max(0, percent));

  const barColor =
    clamped < 50 ? '#22C55E' :
    clamped < 80 ? '#F59E0B' :
    '#EF4444';

  const textColor =
    clamped < 50 ? '#166534' :
    clamped < 80 ? '#92400E' :
    '#991B1B';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label && (
          <span style={{ fontSize: 11, color: '#64748B' }}>{label}</span>
        )}
        <span style={{ fontSize: 11, fontWeight: 600, color: textColor, marginLeft: 'auto' }}>
          {clamped}%
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 99,
          background: '#E2E8F0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${clamped}%`,
            borderRadius: 99,
            background: barColor,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
