/** Pure statistics helpers. No I/O, no dependencies. */

export function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1 denominator). */
export function sampleStdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Daily log returns: r[i] = ln(closes[i+1] / closes[i]); length = closes.length − 1. */
export function logReturns(closes: number[]): number[] {
  const out = new Array<number>(Math.max(0, closes.length - 1));
  for (let i = 1; i < closes.length; i++) out[i - 1] = Math.log(closes[i] / closes[i - 1]);
  return out;
}

/** Pearson correlation. NaN when either series is constant or lengths differ/are too short. */
export function pearson(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Cross-sectional z-scores. Nulls pass through; non-null values are scored
 * against the mean/stdev of the non-null set. A degenerate set (fewer than
 * two values, or zero spread) scores as all zeros.
 */
export function zscores(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return values.map((v) => (v === null ? null : 0));
  const m = mean(present);
  const sd = sampleStdev(present);
  if (sd === 0) return values.map((v) => (v === null ? null : 0));
  return values.map((v) => (v === null ? null : (v - m) / sd));
}

/**
 * Pairwise Pearson correlation matrix of the given return series.
 * Symmetric with unit diagonal; NaN where pearson is undefined.
 */
export function correlationMatrix(series: number[][]): number[][] {
  const n = series.length;
  const out = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    out[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(series[i], series[j]);
      out[i][j] = r;
      out[j][i] = r;
    }
  }
  return out;
}
