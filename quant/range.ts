/** 52-week price range from adjusted closes. */

export const RANGE_WINDOW = 252;

export interface Range52w {
  low: number;
  high: number;
  latest: number;
}

/** Min/max over the last `window` closes (fewer if history is shorter) plus the latest close. */
export function range52w(closes: number[], window: number = RANGE_WINDOW): Range52w {
  const slice = closes.slice(Math.max(0, closes.length - window));
  let low = Infinity;
  let high = -Infinity;
  for (const c of slice) {
    if (c < low) low = c;
    if (c > high) high = c;
  }
  return { low, high, latest: closes[closes.length - 1] };
}
