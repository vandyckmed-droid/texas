/**
 * Data contract shared by the refresh pipeline (scripts/, quant/) and the app (web/).
 * Everything the app renders is precomputed at refresh time into data/*.json;
 * the app performs no financial math beyond mapping values to pixels.
 */

export type RankMode = 'blended' | 'volAdj';
export type RowViz = 'range' | 'channel' | 'day' | 'impact';

export const GICS_SECTORS = [
  'Information Technology',
  'Health Care',
  'Financials',
  'Consumer Discretionary',
  'Communication Services',
  'Industrials',
  'Consumer Staples',
  'Energy',
  'Utilities',
  'Real Estate',
  'Materials',
] as const;
export type Sector = (typeof GICS_SECTORS)[number];

// ---- data/meta.json ----
export interface Meta {
  /** Last trading date in the snapshot, YYYY-MM-DD. */
  asOf: string;
  /** ISO timestamp of the refresh run. */
  generatedAt: string;
  /** Constituents returned by FMP. */
  universeCount: number;
  /** Symbols with full metrics (in rankings). */
  rankedCount: number;
  excluded: { symbol: string; reason: string }[];
  source: 'fmp-stable' | 'fmp-v3' | 'mock';
}

// ---- data/rankings.json ----
export interface StockRow {
  /** Display form, e.g. "BRK.B". */
  symbol: string;
  /** Chart file key, e.g. "BRK-B". */
  fileKey: string;
  name: string;
  sector: Sector;
  /** Latest adjusted close. */
  price: number;
  /** Annualized 12–1 momentum leg (log return). */
  m12: number;
  /** Annualized 6–1 momentum leg (log return). */
  m6: number;
  /** Equal-weight mean of m12 and m6. */
  blended: number;
  /** 126-day realized vol of daily log returns, annualized. */
  vol: number;
  /** blended / vol. */
  volAdj: number;
  rankBlended: number;
  /**
   * Ranks in the snapshot this refresh replaced, absent for a name that was
   * not in it. Carried forward so the app can show what moved between
   * refreshes; the previous snapshot is otherwise overwritten and gone.
   */
  prevRankBlended?: number;
  prevRankVolAdj?: number;
  rankVolAdj: number;
  wk52Low: number;
  wk52High: number;
  /**
   * Rolling blended-score DISPLAY series aligned to Rankings.rollingDates:
   * cross-sectional z-score squashed via 2*tanh(z/2) to (-2, 2).
   * Visualization only — never an input to ranking.
   */
  rolling: (number | null)[];
}

export interface Rankings {
  asOf: string;
  /** Shared dates for every row's rolling series, oldest → newest, YYYY-MM-DD. */
  rollingDates: string[];
  /** Sorted by rankBlended ascending. */
  stocks: StockRow[];
}

// ---- data/correlation.json ----
export interface CorrelationCluster {
  id: number;
  /** Index range [start, start + size) into CorrelationSet.tickers (leaf order). */
  start: number;
  size: number;
  avgIntraCorr: number;
  /** Dominant sector among members, used as the group label. */
  topSector: Sector;
}

export interface CorrelationSet {
  mode: RankMode;
  /** Top-50 symbols in dendrogram leaf order. */
  tickers: string[];
  /** Pearson r of daily log returns, leaf order, symmetric, diag = 1. */
  matrix: number[][];
  clusters: CorrelationCluster[];
}

export interface CorrelationFile {
  asOf: string;
  /** Trading days of returns used. */
  window: number;
  sets: CorrelationSet[];
}

// ---- data/charts/{fileKey}.json ----
export interface ChartFile {
  symbol: string;
  /** Dates as yyyymmdd integers, ascending. */
  t: number[];
  /** Split/dividend-adjusted OHLC. */
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}
