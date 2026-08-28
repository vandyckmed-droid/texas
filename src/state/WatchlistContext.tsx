import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { tap } from '@/src/theme/haptics';
import { getJSON, KEYS, setJSON } from './storage';

interface WatchlistValue {
  symbols: string[];
  has: (symbol: string) => boolean;
  toggle: (symbol: string) => void;
}

const Ctx = createContext<WatchlistValue>({ symbols: [], has: () => false, toggle: () => {} });

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    getJSON<string[]>(KEYS.watchlist, []).then(setSymbols);
  }, []);

  const value = useMemo<WatchlistValue>(() => {
    const set = new Set(symbols);
    return {
      symbols,
      has: (symbol) => set.has(symbol),
      toggle: (symbol) => {
        tap();
        setSymbols((prev) => {
          const next = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
          setJSON(KEYS.watchlist, next);
          return next;
        });
      },
    };
  }, [symbols]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useWatchlist = () => useContext(Ctx);
