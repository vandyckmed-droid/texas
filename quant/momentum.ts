/**
 * Momentum legs on adjusted closes, skipping the most recent month
 * (the classic short-term-reversal exclusion). Both legs are annualized
 * log returns, so they are duration-comparable before blending.
 */

/** Trading days skipped at the end of the window. */
export const SKIP = 21;
/** Trading-day offset for the 12-month lookback. */
export const LOOKBACK_12 = 252;
/** Trading-day offset for the 6-month lookback. */
export const LOOKBACK_6 = 126;

/** Bars required so c[T − LOOKBACK_12] exists. */
export const MIN_BARS_12_1 = LOOKBACK_12 + 1;

/** Annualized 12–1 momentum: ln(c[T−21]/c[T−252]) × 252/231. NaN if history is short. */
export function momentum12_1(closes: number[]): number {
  const T = closes.length - 1;
  if (T < LOOKBACK_12) return NaN;
  return Math.log(closes[T - SKIP] / closes[T - LOOKBACK_12]) * (252 / (LOOKBACK_12 - SKIP));
}

/** Annualized 6–1 momentum: ln(c[T−21]/c[T−126]) × 252/105. NaN if history is short. */
export function momentum6_1(closes: number[]): number {
  const T = closes.length - 1;
  if (T < LOOKBACK_6) return NaN;
  return Math.log(closes[T - SKIP] / closes[T - LOOKBACK_6]) * (252 / (LOOKBACK_6 - SKIP));
}

/** Equal-weight blend of the two annualized legs. NaN if either leg is NaN. */
export function blendedMomentum(closes: number[]): number {
  return (momentum12_1(closes) + momentum6_1(closes)) / 2;
}
