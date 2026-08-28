/**
 * Generates deterministic synthetic data in exactly the shapes the app consumes,
 * so the app can be built and exercised before (or without) a real FMP refresh.
 * Values are plausible but fabricated; `meta.source: 'mock'` marks the snapshot.
 */
import { GICS_SECTORS, type ChartFile, type CorrelationSet, type Sector, type StockRow } from '../shared/types.ts';
import { round, writeSnapshot, type Snapshot } from './write.ts';

// mulberry32 — tiny seeded PRNG for reproducible output.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N_STOCKS = 120;
const N_DAYS = 550;
const CHART_DAYS = 253;
const ROLLING_POINTS = 26;

/** NYSE full-day closures, 2024–2026, so the mock calendar matches real trading dates. */
const US_MARKET_HOLIDAYS = new Set([
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27',
  '2024-06-19', '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27',
  '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);

/** Trading dates ending near today, skipping weekends and US market holidays. */
function tradingDates(n: number): Date[] {
  const dates: Date[] = [];
  const d = new Date();
  while (dates.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !US_MARKET_HOLIDAYS.has(d.toISOString().slice(0, 10))) {
      dates.push(new Date(d));
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return dates.reverse();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const yyyymmdd = (d: Date) => Number(iso(d).replaceAll('-', ''));

function main(): void {
  const rand = rng(20260828);
  const dates = tradingDates(N_DAYS);
  const asOf = iso(dates[dates.length - 1]);

  interface MockStock {
    symbol: string;
    name: string;
    sector: Sector;
    closes: number[];
    chart: ChartFile;
  }

  const stocks: MockStock[] = [];
  for (let i = 0; i < N_STOCKS; i++) {
    const symbol = `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))}${i % 10}`;
    const sector = GICS_SECTORS[i % GICS_SECTORS.length];
    const drift = (rand() - 0.35) * 0.002;
    const dailyVol = 0.008 + rand() * 0.02;
    let price = 20 + rand() * 480;
    const closes: number[] = [];
    for (let d = 0; d < N_DAYS; d++) {
      const shock = (rand() * 2 - 1) * dailyVol;
      price = Math.max(1, price * Math.exp(drift + shock));
      closes.push(price);
    }
    const t: number[] = [];
    const o: number[] = [];
    const h: number[] = [];
    const l: number[] = [];
    const c: number[] = [];
    for (let d = N_DAYS - CHART_DAYS; d < N_DAYS; d++) {
      const close = closes[d];
      const open = close * (1 + (rand() * 2 - 1) * dailyVol);
      t.push(yyyymmdd(dates[d]));
      o.push(round(open, 2));
      h.push(round(Math.max(open, close) * (1 + rand() * dailyVol), 2));
      l.push(round(Math.min(open, close) * (1 - rand() * dailyVol), 2));
      c.push(round(close, 2));
    }
    stocks.push({
      symbol,
      name: `Mock ${symbol} Corp`,
      sector,
      closes,
      chart: { symbol, t, o, h, l, c },
    });
  }

  // Momentum/vol computed directly from the synthetic closes (plausible, not quant/).
  const T = N_DAYS - 1;
  const rows: Omit<StockRow, 'rankBlended' | 'rankVolAdj'>[] = stocks.map((s) => {
    const m12 = Math.log(s.closes[T - 21] / s.closes[T - 252]) * (252 / 231);
    const m6 = Math.log(s.closes[T - 21] / s.closes[T - 126]) * (252 / 105);
    const blended = (m12 + m6) / 2;
    const rets: number[] = [];
    for (let d = T - 125; d <= T; d++) rets.push(Math.log(s.closes[d] / s.closes[d - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const vol =
      Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);
    // 52-week range from the bars' intraday extremes (matches the real
    // pipeline: candles must never extend past the stated range).
    const barsInYear = Math.min(252, s.chart.h.length);
    const highs = s.chart.h.slice(-barsInYear);
    const lows = s.chart.l.slice(-barsInYear);
    return {
      symbol: s.symbol,
      fileKey: s.symbol,
      name: s.name,
      sector: s.sector,
      price: round(s.closes[T], 2),
      m12: round(m12, 4),
      m6: round(m6, 4),
      blended: round(blended, 4),
      vol: round(vol, 4),
      volAdj: round(blended / vol, 4),
      wk52Low: round(Math.min(...lows), 2),
      wk52High: round(Math.max(...highs), 2),
      rolling: Array.from({ length: ROLLING_POINTS }, (_, k) =>
        k < 3 && rand() < 0.15 ? null : round(2 * Math.tanh((blended * 2 + (rand() - 0.5)) / 2), 3),
      ),
    };
  });

  const byBlended = [...rows].sort((a, b) => b.blended - a.blended);
  const byVolAdj = [...rows].sort((a, b) => b.volAdj - a.volAdj);
  const full: StockRow[] = rows.map((r) => ({
    ...r,
    rankBlended: byBlended.indexOf(r) + 1,
    rankVolAdj: byVolAdj.indexOf(r) + 1,
  }));
  full.sort((a, b) => a.rankBlended - b.rankBlended);

  const rollingDates = dates
    .filter((_, i) => i > N_DAYS - ROLLING_POINTS * 5 - 1 && (N_DAYS - 1 - i) % 5 === 0)
    .map(iso)
    .slice(-ROLLING_POINTS);

  // Block-structured correlation sets for both modes.
  const makeSet = (mode: 'blended' | 'volAdj'): CorrelationSet => {
    const top = [...full]
      .sort((a, b) => (mode === 'blended' ? a.rankBlended - b.rankBlended : a.rankVolAdj - b.rankVolAdj))
      .slice(0, 50);
    const groupSizes = [11, 9, 8, 8, 7, 4, 3];
    const bounds: { id: number; start: number; size: number }[] = [];
    let start = 0;
    groupSizes.forEach((size, id) => {
      bounds.push({ id, start, size });
      start += size;
    });
    const groupOf = (i: number) => bounds.findIndex((cl) => i >= cl.start && i < cl.start + cl.size);
    const matrix = Array.from({ length: 50 }, () => new Array<number>(50).fill(0));
    for (let i = 0; i < 50; i++) {
      for (let j = i; j < 50; j++) {
        const r =
          i === j ? 1 : groupOf(i) === groupOf(j) ? 0.55 + rand() * 0.35 : -0.1 + rand() * 0.45;
        matrix[i][j] = matrix[j][i] = round(r, 2);
      }
    }
    // Cluster labels derived from the matrix actually generated above.
    const clusters: CorrelationSet['clusters'] = bounds.map(({ id, start: s0, size }) => {
      const members = top.slice(s0, s0 + size);
      const sectorCounts = new Map<Sector, number>();
      members.forEach((m) => sectorCounts.set(m.sector, (sectorCounts.get(m.sector) ?? 0) + 1));
      const topSector = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      let sum = 0;
      let cnt = 0;
      for (let i = s0; i < s0 + size; i++) {
        for (let j = i + 1; j < s0 + size; j++) {
          sum += matrix[i][j];
          cnt++;
        }
      }
      return { id, start: s0, size, avgIntraCorr: cnt > 0 ? round(sum / cnt, 2) : 1, topSector };
    });
    return { mode, tickers: top.map((s) => s.symbol), matrix, clusters };
  };

  const snapshot: Snapshot = {
    meta: {
      asOf,
      generatedAt: new Date().toISOString(),
      universeCount: N_STOCKS,
      rankedCount: N_STOCKS,
      excluded: [],
      source: 'mock',
    },
    rankings: { asOf, rollingDates, stocks: full },
    correlation: { asOf, window: 126, sets: [makeSet('blended'), makeSet('volAdj')] },
    charts: stocks.map((s) => ({ fileKey: s.symbol, file: s.chart })),
  };

  writeSnapshot(snapshot);
  console.log(`mock snapshot written: ${N_STOCKS} stocks, asOf ${asOf}`);
}

main();
