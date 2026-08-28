/**
 * 52-week price range from adjusted intraday extremes, so rendered candles
 * can never extend past the stated range.
 */

export const RANGE_WINDOW = 252;

export interface Range52w {
  low: number;
  high: number;
  latest: number;
}

/**
 * Min of lows / max of highs over the last `window` bars (fewer if history
 * is shorter), plus the latest adjusted close.
 */
export function range52w(
  highs: number[],
  lows: number[],
  latestClose: number,
  window: number = RANGE_WINDOW,
): Range52w {
  let low = Infinity;
  let high = -Infinity;
  for (let i = Math.max(0, highs.length - window); i < highs.length; i++) {
    if (lows[i] < low) low = lows[i];
    if (highs[i] > high) high = highs[i];
  }
  return { low, high, latest: latestClose };
}
