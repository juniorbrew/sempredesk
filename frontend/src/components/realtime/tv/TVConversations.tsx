import { useRealtimeTVData } from '@/contexts/realtime-tv-data';
import { realtimeTvBlockTitleClass, realtimeTvDataRowClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES, TV_SLA_THRESHOLDS } from '@/lib/realtime-tv-constants';

const CARD_BG = 'rgba(255,255,255,0.05)';

function slaColor(sla: number) {
  if (sla < TV_SLA_THRESHOLDS.critical) return TV_COLORS.critical;
  if (sla < TV_SLA_THRESHOLDS.warning) return TV_COLORS.warning;
  return TV_COLORS.success;
}

export default function TVConversations() {
  const data = useRealtimeTVData();
  if (!data) return null;

  const { conversations } = data;

  return (
    <section className="w-full min-w-0" style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}>
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        CONVERSAS
      </h2>
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        {conversations.map((c) => (
          <div
            key={`${c.contact}-${c.channel}`}
            className="flex flex-col gap-3 rounded-xl p-6"
            style={{ backgroundColor: CARD_BG, color: TV_COLORS.text }}
          >
            <span className={`${TV_FONT_SIZES.label} font-bold`} style={{ color: TV_COLORS.text }}>
              {c.contact}
            </span>
            <div className={realtimeTvDataRowClass} style={{ color: TV_COLORS.text }}>
              <span className="text-xl">{c.channel}</span>
              <span className="text-xl">{c.operator}</span>
            </div>
            <span className="text-4xl font-bold" style={{ color: slaColor(c.sla) }}>
              {c.sla}% SLA
            </span>
            <span className="text-xl" style={{ color: TV_COLORS.text }}>
              {c.wait}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
