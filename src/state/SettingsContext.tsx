import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { RankMode, RowViz } from '@/shared/types';
import { getJSON, KEYS, setJSON } from './storage';

export type Appearance = 'system' | 'light' | 'dark';

export interface Settings {
  rowViz: RowViz;
  appearance: Appearance;
  rankMode: RankMode;
}

const DEFAULTS: Settings = { rowViz: 'range', appearance: 'system', rankMode: 'blended' };

interface SettingsValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

const Ctx = createContext<SettingsValue>({ settings: DEFAULTS, update: () => {} });

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    getJSON<Partial<Settings>>(KEYS.settings, {}).then((stored) =>
      setSettings((s) => ({ ...s, ...stored })),
    );
  }, []);

  const value = useMemo<SettingsValue>(
    () => ({
      settings,
      update: (patch) =>
        setSettings((s) => {
          const next = { ...s, ...patch };
          setJSON(KEYS.settings, next);
          return next;
        }),
    }),
    [settings],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
