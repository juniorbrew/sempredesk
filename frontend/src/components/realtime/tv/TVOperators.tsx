import { useRealtimeTVData } from '@/contexts/realtime-tv-data';
import { realtimeTvBlockTitleClass, realtimeTvDataRowClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES } from '@/lib/realtime-tv-constants';

const CARD_BG = 'rgba(255,255,255,0.05)';

export default function TVOperators() {
  const data = useRealtimeTVData();
  if (!data) return null;

  const { operators } = data;

  return (
    <section className="w-full min-w-0" style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}>
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        OPERADORES
      </h2>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {operators.map((op) => {
          const statusColor = op.status === 'online' ? TV_COLORS.success : TV_COLORS.critical;
          const statusLabel = op.status === 'online' ? 'Online' : 'Offline';
          return (
            <div
              key={op.name}
              className="flex flex-col gap-3 rounded-xl p-6"
              style={{ backgroundColor: CARD_BG, color: TV_COLORS.text }}
            >
              <span className={`${TV_FONT_SIZES.label} font-bold`} style={{ color: TV_COLORS.text }}>
                {op.name}
              </span>
              <span className={TV_FONT_SIZES.label} style={{ color: statusColor }}>
                {statusLabel}
              </span>
              <div className={realtimeTvDataRowClass} style={{ color: TV_COLORS.text }}>
                <span className="text-4xl font-bold">{op.conversations} conversas</span>
                <span className="text-4xl font-bold">{op.sla}% SLA</span>
              </div>
              <span className="text-xl" style={{ color: TV_COLORS.text }}>
                {op.time}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
