/**
 * Diverging colour scale and hit-testing for the correlation heatmap.
 * Pure: no imports, no theme knowledge — pole colours are passed in, so this
 * stays testable and the theme keeps ownership of the palette.
 *
 * The scale is diverging because 0 (uncorrelated) is a meaningful midpoint:
 * two hues with a neutral midpoint, each arm running monotonically in
 * lightness from the midpoint out to its pole.
 */

/** Odd, so exactly one bucket sits on the neutral midpoint. */
export const BUCKETS = 17;
export const NEUTRAL_BUCKET = (BUCKETS - 1) / 2;

export interface Poles {
  /** Pole for r → +1 (moves together). */
  positive: string;
  /** Pole for r → −1 (moves opposite). */
  negative: string;
  /** Midpoint for r → 0. */
  neutral: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Bucket index for a correlation, 0 (most negative) … BUCKETS−1 (most
 * positive), monotone non-decreasing in r. |r| > 1 clamps rather than
 * escaping the scale.
 */
export function bucketFor(r: number): number {
  const safe = Number.isFinite(r) ? clamp(r, -1, 1) : 0;
  const scaled = (safe + 1) / 2; // → [0, 1]
  return clamp(Math.round(scaled * (BUCKETS - 1)), 0, BUCKETS - 1);
}

const parseHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = (c: number): string =>
  clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0');

/**
 * Colour for a bucket: interpolated from the neutral midpoint out to whichever
 * pole the bucket falls on. Bucket NEUTRAL_BUCKET returns the midpoint exactly.
 */
export function bucketColor(bucket: number, poles: Poles): string {
  const b = clamp(Math.round(bucket), 0, BUCKETS - 1);
  const distance = Math.abs(b - NEUTRAL_BUCKET) / NEUTRAL_BUCKET; // 0 … 1
  const pole = b >= NEUTRAL_BUCKET ? poles.positive : poles.negative;
  const [nr, ng, nb] = parseHex(poles.neutral);
  const [pr, pg, pb] = parseHex(pole);
  const mix = (from: number, to: number): number => from + (to - from) * distance;
  return `#${toHex(mix(nr, pr))}${toHex(mix(ng, pg))}${toHex(mix(nb, pb))}`;
}

/** Convenience: colour straight from a correlation. */
export const colorForCorr = (r: number, poles: Poles): string => bucketColor(bucketFor(r), poles);

/** Relative luminance (WCAG), used by tests to assert lightness monotonicity. */
export function luminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Grid cell under a touch point, clamped to the matrix. */
export function cellAt(
  x: number,
  y: number,
  cellSize: number,
  n: number,
): { row: number; col: number } {
  'worklet';
  const col = clamp(Math.floor(x / cellSize), 0, n - 1);
  const row = clamp(Math.floor(y / cellSize), 0, n - 1);
  return { row, col };
}
