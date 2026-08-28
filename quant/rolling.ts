/**
 * Rolling blended-score DISPLAY series.
 *
 * For each anchor date, every stock's blended momentum is computed on its
 * history up to that date, z-scored cross-sectionally, and squashed through
 * 2·tanh(z/2) — a monotone, direction-preserving map smoothly bounded to
 * (−2, 2) so outliers cannot destroy the common visual scale.
 *
 * Visualization only: nothing in the ranking pipeline reads these values.
 */
import { blendedMomentum, MIN_BARS_12_1 } from './momentum.ts';
import { zscores } from './stats.ts';

/** Monotone squash of a z-score into (−2, 2). Odd, with slope 1 at zero. */
export function squash(z: number): number {
  return 2 * Math.tanh(z / 2);
}

export interface DatedCloses {
  /** YYYY-MM-DD, ascending, aligned with closes. */
  dates: string[];
  closes: number[];
}

/** Index of the last date ≤ target, or −1. Dates ascending. */
function lastIndexOnOrBefore(dates: string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * For each symbol, the squashed cross-sectional display value at each anchor
 * date (null where the symbol lacks the history for a blended score).
 */
export function rollingDisplaySeries(
  seriesBySymbol: Map<string, DatedCloses>,
  anchorDates: string[],
): Map<string, (number | null)[]> {
  const symbols = [...seriesBySymbol.keys()];
  const out = new Map<string, (number | null)[]>(
    symbols.map((s) => [s, new Array<number | null>(anchorDates.length).fill(null)]),
  );

  anchorDates.forEach((anchor, a) => {
    const raw: (number | null)[] = symbols.map((sym) => {
      const { dates, closes } = seriesBySymbol.get(sym)!;
      const idx = lastIndexOnOrBefore(dates, anchor);
      if (idx + 1 < MIN_BARS_12_1) return null;
      const b = blendedMomentum(closes.slice(0, idx + 1));
      return Number.isNaN(b) ? null : b;
    });
    const zs = zscores(raw);
    symbols.forEach((sym, i) => {
      const z = zs[i];
      out.get(sym)![a] = z === null ? null : squash(z);
    });
  });

  return out;
}
