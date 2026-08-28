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

/** Fixed point count every line window resamples to → identical path verb
 * structure → Skia path interpolation is always valid. */
export const LINE_POINTS = 100;

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
  const h = f.height - f.padTop - f.padBottom;
  return f.padTop + (1 - (price - lo) / (hi - lo)) * h;
}

/** x pixel for bar i of n (bar centers spread across the plot). */
export function xForBar(i: number, n: number, f: ChartFrame): number {
  'worklet';
  const w = f.width - f.labelGutter;
  return n <= 1 ? w / 2 : ((i + 0.5) / n) * w;
}

/** Nearest bar index for a touch x. */
export function barForX(x: number, n: number, f: ChartFrame): number {
  'worklet';
  const w = f.width - f.labelGutter;
  const i = Math.round((x / w) * n - 0.5);
  return Math.max(0, Math.min(n - 1, i));
}
