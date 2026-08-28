/** Chart geometry: windows, linear scales, resampling. Pure functions. */

export type WindowKey = '1M' | '3M' | '6M' | '12M';

export const WINDOWS: { key: WindowKey; bars: number }[] = [
  { key: '1M', bars: 21 },
  { key: '3M', bars: 63 },
  { key: '6M', bars: 126 },
  { key: '12M', bars: Number.MAX_SAFE_INTEGER }, // all available
];

export const windowBars = (key: WindowKey, available: number): number => {
  const spec = WINDOWS.find((w) => w.key === key)!.bars;
  return Math.min(spec, available);
};

/**
 * Fixed point count every line window resamples to → identical path verb
 * structure → Skia path interpolation is always valid.
 *
 * Kept at the CHART_BARS cap in scripts/refresh.ts so no window is ever
 * downsampled: the drawn line then passes through the same closes the
 * crosshair reads out, instead of smoothing spikes away from the dot.
 */
export const LINE_POINTS = 253;

/** Linear interpolation resample of `values` to exactly `n` points. */
export function resampleToN(values: number[], n: number): number[] {
  const m = values.length;
  if (m === 0) return new Array<number>(n).fill(0);
  if (m === 1) return new Array<number>(n).fill(values[0]);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (m - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(m - 1, lo + 1);
    const frac = pos - lo;
    out[i] = values[lo] * (1 - frac) + values[hi] * frac;
  }
  return out;
}

/** Pads [lo, hi] outward by `frac` of its span (guards zero span). */
export function padDomain(lo: number, hi: number, frac = 0.06): [number, number] {
  const span = hi - lo;
  if (span <= 0) {
    const pad = Math.max(1e-6, Math.abs(hi) * 0.01);
    return [lo - pad, hi + pad];
  }
  return [lo - span * frac, hi + span * frac];
}

export interface ChartFrame {
  width: number;
  height: number;
  /** Right-side gutter reserved for price labels. */
  labelGutter: number;
  padTop: number;
  padBottom: number;
}

export const plotWidth = (f: ChartFrame): number => f.width - f.labelGutter;
export const plotHeight = (f: ChartFrame): number => f.height - f.padTop - f.padBottom;

/** y pixel for a price given a domain and frame. Plain function — worklet-safe. */
export function yFor(price: number, lo: number, hi: number, f: ChartFrame): number {
  'worklet';
  return f.padTop + (1 - (price - lo) / (hi - lo)) * plotHeight(f);
}

/** x pixel for bar i of n (bar centers spread across the plot). */
export function xForBar(i: number, n: number, f: ChartFrame): number {
  'worklet';
  const w = plotWidth(f);
  return n <= 1 ? w / 2 : ((i + 0.5) / n) * w;
}

/**
 * Nearest bar index for a touch x under the bar-CENTRE layout (candles).
 * Inverse of xForBar.
 */
export function barForX(x: number, n: number, f: ChartFrame): number {
  'worklet';
  const i = Math.round((x / plotWidth(f)) * n - 0.5);
  return Math.max(0, Math.min(n - 1, i));
}

/**
 * Nearest bar index under the EDGE-TO-EDGE layout the line chart draws with
 * (x = i/(n−1) · w). Using the bar-centre inverse here skews the hairline by
 * up to half a slot near the plot edges.
 */
export function barForXLine(x: number, n: number, f: ChartFrame): number {
  'worklet';
  if (n <= 1) return 0;
  const i = Math.round((x / plotWidth(f)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}
