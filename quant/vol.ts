import { logReturns, sampleStdev } from './stats.ts';

/** Trading days of returns in the realized-vol window. */
export const VOL_WINDOW = 126;

/**
 * Annualized realized volatility: sample stdev of the last `window` daily
 * log returns × √252. NaN if there are fewer than `window` returns.
 */
export function realizedVol(closes: number[], window: number = VOL_WINDOW): number {
  const rets = logReturns(closes);
  if (rets.length < window) return NaN;
  return sampleStdev(rets.slice(rets.length - window)) * Math.sqrt(252);
}
