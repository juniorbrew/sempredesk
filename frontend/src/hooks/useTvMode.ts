'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useState } from 'react';

/** Modo TV: classe em document.documentElement (sidebar / barra global escondidas via globals.css). */
export function useTvMode(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [tvMode, setTvMode] = useState(false);

  useEffect(() => {
    if (tvMode) {
      document.documentElement.classList.add('realtime-tv-mode');
    } else {
      document.documentElement.classList.remove('realtime-tv-mode');
    }
    return () => document.documentElement.classList.remove('realtime-tv-mode');
  }, [tvMode]);

  return [tvMode, setTvMode];
}
