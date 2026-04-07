import { realtimeTvBlockTitleClass } from '@/lib/realtime-tv-ui';
import { TV_COLORS, TV_FONT_SIZES } from '@/lib/realtime-tv-constants';

export interface TVChartsWrapperProps {
  title: string;
  children: React.ReactNode;
}

const CARD_BG = 'rgba(255,255,255,0.05)';

export default function TVChartsWrapper({ title, children }: TVChartsWrapperProps) {
  return (
    <section
      className={`w-full min-w-0 ${TV_FONT_SIZES.label}`}
      style={{ backgroundColor: TV_COLORS.background, color: TV_COLORS.text }}
    >
      <h2 className={realtimeTvBlockTitleClass} style={{ color: TV_COLORS.text }}>
        {title}
      </h2>
      <div
        className="mt-8 flex h-[400px] flex-col overflow-hidden rounded-xl p-8"
        style={{ backgroundColor: CARD_BG, color: TV_COLORS.text }}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </section>
  );
}
