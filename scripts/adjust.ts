/**
 * Validation and split/dividend adjustment of raw daily bars.
 * Adjusted OHLC via the factor adjClose/close; rows without adjClose fall
 * back to factor 1 (counted so the summary can surface it).
 */
import type { RawBar } from './fmp.ts';

export interface AdjustedSeries {
  /** YYYY-MM-DD ascending. */
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[]; // adjusted close
  /** Rows lacking adjClose (factor-1 fallback). */
  missingAdjClose: number;
  /** Rows dropped for bad values or duplicate dates. */
  dropped: number;
}

export function adjustSeries(raw: RawBar[]): AdjustedSeries {
  const out: AdjustedSeries = {
    dates: [],
    open: [],
    high: [],
    low: [],
    close: [],
    missingAdjClose: 0,
    dropped: 0,
  };
  let prevDate = '';
  for (const bar of raw) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(bar.date) &&
      [bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0) &&
      (bar.adjClose === undefined || (Number.isFinite(bar.adjClose) && bar.adjClose > 0));
    if (!valid || bar.date === prevDate) {
      out.dropped++;
      continue;
    }
    prevDate = bar.date;
    let factor = 1;
    if (bar.adjClose !== undefined) {
      factor = bar.adjClose / bar.close;
    } else {
      out.missingAdjClose++;
    }
    out.dates.push(bar.date);
    out.open.push(bar.open * factor);
    out.high.push(bar.high * factor);
    out.low.push(bar.low * factor);
    out.close.push(bar.close * factor);
  }
  return out;
}
