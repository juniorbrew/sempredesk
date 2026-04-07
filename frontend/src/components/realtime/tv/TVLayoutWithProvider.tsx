'use client';

import { RealtimeTVDataProvider, type RealtimeTVData } from '@/contexts/realtime-tv-data';
import { RealtimeTVSync } from './RealtimeTVSync';
import TVLayout from './TVLayout';

const initialData: RealtimeTVData = {
  indicators: {
    active: 12,
    operatorsOnline: 5,
    sla: 92,
    queue: 1,
  },
  alerts: {
    critical: 2,
    warning: 0,
  },
  operators: [
    { name: 'Ana Souza', status: 'online', conversations: 3, sla: 95, time: '2h 14m' },
    { name: 'Carlos Lima', status: 'online', conversations: 1, sla: 88, time: '1h 02m' },
    { name: 'Fernanda Dias', status: 'offline', conversations: 0, sla: 0, time: '—' },
    { name: 'João Pedro', status: 'online', conversations: 4, sla: 91, time: '3h 40m' },
  ],
  conversations: [
    { contact: 'Maria Silva', channel: 'WhatsApp', operator: 'Ana Souza', sla: 92, wait: '1m 20s' },
    { contact: 'João Santos', channel: 'Chat Web', operator: 'Carlos Lima', sla: 88, wait: '3m 10s' },
    { contact: 'Empresa XPTO', channel: 'Email', operator: 'João Pedro', sla: 91, wait: '—' },
  ],
  queue: {
    waiting: 4,
    avgWait: '2m 45s',
    longestWait: '6m 10s',
  },
};

export default function TVLayoutWithProvider() {
  return (
    <RealtimeTVDataProvider initialData={initialData}>
      <RealtimeTVSync />
      <TVLayout />
    </RealtimeTVDataProvider>
  );
}
