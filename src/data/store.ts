/**
 * Typed accessors over the generated data/ snapshot. The only place the
 * app touches raw JSON; everything downstream sees shared/types shapes.
 */
import { chartFiles } from '@/data/charts';
import correlationJson from '@/data/correlation.json';
import metaJson from '@/data/meta.json';
import rankingsJson from '@/data/rankings.json';
import type {
  ChartFile,
  CorrelationFile,
  CorrelationSet,
  Meta,
  RankMode,
  Rankings,
  StockRow,
} from '@/shared/types';

const meta = metaJson as Meta;
const rankings = rankingsJson as unknown as Rankings;
const correlation = correlationJson as unknown as CorrelationFile;

const bySymbol = new Map(rankings.stocks.map((s) => [s.symbol, s]));

export const getMeta = (): Meta => meta;
export const getRankings = (): Rankings => rankings;

export function rankOf(stock: StockRow, mode: RankMode): number {
  return mode === 'blended' ? stock.rankBlended : stock.rankVolAdj;
}

export function scoreOf(stock: StockRow, mode: RankMode): number {
  return mode === 'blended' ? stock.blended : stock.volAdj;
}

const top50Cache = new Map<RankMode, StockRow[]>();

export function getTop50(mode: RankMode): StockRow[] {
  let cached = top50Cache.get(mode);
  if (!cached) {
    cached = [...rankings.stocks].sort((a, b) => rankOf(a, mode) - rankOf(b, mode)).slice(0, 50);
    top50Cache.set(mode, cached);
  }
  return cached;
}

export const getStock = (symbol: string): StockRow | undefined => bySymbol.get(symbol);

/** Lazy: the chart JSON parses on first access for a given ticker. */
export function getChart(symbol: string): ChartFile | null {
  const fileKey = bySymbol.get(symbol)?.fileKey ?? symbol.replaceAll('.', '-');
  const thunk = chartFiles[fileKey];
  return thunk ? thunk() : null;
}

export function getCorrelation(mode: RankMode): CorrelationSet | undefined {
  return correlation.sets.find((s) => s.mode === mode);
}
