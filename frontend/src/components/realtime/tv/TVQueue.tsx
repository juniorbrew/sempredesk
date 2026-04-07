import { useRealtimeTVData } from '@/contexts/realtime-tv-data';
import { realtimeTvBlockTitleClass, realtimeTvDataRowClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES } from '@/lib/realtime-tv-constants';

const CARD_BG = 'rgba(255,255,255,0.05)';

export default function TVQueue() {
  const data = useRealtimeTVData();
  if (!data) return null;

  const { queue } = data;

  return (
    <section className="w-full min-w-0" style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}>
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        FILA (SEM AGENTE)
      </h2>
      <div
        className="mt-8 flex flex-col gap-4 rounded-xl p-8"
        style={{ backgroundColor: CARD_BG, color: TV_COLORS.text }}
      >
        <div className={realtimeTvDataRowClass} style={{ color: TV_COLORS.text }}>
          <span className={TV_FONT_SIZES.label}>Aguardando</span>
          <span className="text-4xl font-bold">{queue.waiting}</span>
        </div>
        <div className={realtimeTvDataRowClass} style={{ color: TV_COLORS.text }}>
          <span className={TV_FONT_SIZES.label}>Espera Média</span>
          <span className="text-4xl font-bold">{queue.avgWait}</span>
        </div>
        <div className={realtimeTvDataRowClass} style={{ color: TV_COLORS.text }}>
          <span className={TV_FONT_SIZES.label}>Maior Espera</span>
          <span className="text-4xl font-bold">{queue.longestWait}</span>
        </div>
      </div>
    </section>
  );
}
