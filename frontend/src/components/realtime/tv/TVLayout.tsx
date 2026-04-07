import { realtimeTvShellClass } from '@/lib/realtime-tv-ui';
import TVIndicators from './TVIndicators';
import TVAlerts from './TVAlerts';
import TVOperators from './TVOperators';
import TVConversations from './TVConversations';
import TVQueue from './TVQueue';
import TVChartsWrapper from './TVChartsWrapper';

export default function TVLayout() {
  return (
    <div className={realtimeTvShellClass}>
      <TVIndicators />
      <TVAlerts />
      <TVOperators />
      <TVConversations />
      <TVQueue />
      <TVChartsWrapper title="Produtividade (Mock)">
        <div className="flex h-full items-center justify-center text-2xl">Gráfico mock aqui</div>
      </TVChartsWrapper>
    </div>
  );
}
