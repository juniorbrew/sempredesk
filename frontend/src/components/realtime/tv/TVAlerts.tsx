import { useRealtimeTVData } from '@/contexts/realtime-tv-data';
import { realtimeTvBlockTitleClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES } from '@/lib/realtime-tv-constants';

export default function TVAlerts() {
  const data = useRealtimeTVData();
  if (!data) return null;

  const { alerts } = data;

  const items = [
    {
      value: String(alerts.critical),
      label: 'Conversas Críticas (SLA)',
      backgroundColor: TV_COLORS.critical,
    },
    {
      value: String(alerts.warning),
      label: 'Conversas em Atenção (SLA)',
      backgroundColor: TV_COLORS.warning,
    },
  ] as const;

  return (
    <section className="w-full min-w-0" style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}>
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        ALERTAS
      </h2>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex flex-col items-center justify-center gap-2 rounded-xl p-8 text-center"
            style={{ backgroundColor: item.backgroundColor, color: TV_COLORS.text }}
          >
            <span className="text-4xl font-bold" style={{ color: TV_COLORS.text }}>
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
