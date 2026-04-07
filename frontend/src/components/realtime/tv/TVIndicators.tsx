import { useRealtimeTVData } from '@/contexts/realtime-tv-data';
import { realtimeTvBlockTitleClass, realtimeTvDataRowClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES } from '@/lib/realtime-tv-constants';

const cellLayout = {
  flexDirection: 'column' as const,
  justifyContent: 'center' as const,
  alignItems: 'center' as const,
  textAlign: 'center' as const,
  gap: '0.5rem',
  color: TV_COLORS.text,
};

export default function TVIndicators() {
  const data = useRealtimeTVData();
  if (!data) return null;

  const { indicators } = data;

  const items = [
    { value: String(indicators.active), label: 'Conversas Ativas' },
    { value: String(indicators.operatorsOnline), label: 'Operadores Online' },
    { value: `${indicators.sla}%`, label: 'SLA Geral' },
    { value: String(indicators.queue), label: 'Fila Sem Agente' },
  ] as const;

  return (
    <section
      className="w-full min-w-0"
      style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}
    >
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        INDICADORES
      </h2>
      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className={realtimeTvDataRowClass} style={cellLayout}>
            <span className={`${TV_FONT_SIZES.number} font-bold`} style={{ color: TV_COLORS.text }}>
              {item.value}
            </span>
            <span className={TV_FONT_SIZES.label} style={{ color: TV_COLORS.text }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
