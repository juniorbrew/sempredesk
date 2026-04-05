'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export interface RealtimeTVData {
  indicators: any;
  alerts: any;
  operators: any[];
  conversations: any[];
  queue: any;
}

type RealtimeTVContextApi = {
  data: RealtimeTVData;
  setData: Dispatch<SetStateAction<RealtimeTVData>>;
};

const RealtimeTVContext = createContext<RealtimeTVContextApi | null>(null);

export function RealtimeTVDataProvider({
  children,
  initialData,
}: {
  children: ReactNode;
  initialData: RealtimeTVData;
}) {
  const [data, setData] = useState<RealtimeTVData>(initialData);
  const value = useMemo(() => ({ data, setData }), [data]);

  return <RealtimeTVContext.Provider value={value}>{children}</RealtimeTVContext.Provider>;
}

export function useRealtimeTVData(): RealtimeTVData | null {
  const ctx = useContext(RealtimeTVContext);
  if (!ctx) return null;
  return ctx.data;
}

/** Atualização do payload TV (ex.: sync com API / WebSocket). Só dentro do provider. */
export function useRealtimeTVSetData(): Dispatch<SetStateAction<RealtimeTVData>> | null {
  const ctx = useContext(RealtimeTVContext);
  return ctx?.setData ?? null;
}
