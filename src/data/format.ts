/** Number/date formatting. All numerals render with tabular figures via PriceText. */

export function formatPrice(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Annualized (log) return as a signed percent, e.g. +38.2%. */
export function formatPct(v: number): string {
  const pct = v * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}

/** Unitless ratio (vol-adjusted score), e.g. 1.36 / −0.42. */
export function formatRatio(v: number): string {
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → 'Aug 27, 2026'. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** yyyymmdd int → 'Aug 27'. */
export function formatDayShort(t: number): string {
  const m = Math.floor(t / 100) % 100;
  const d = t % 100;
  return `${MONTHS[m - 1]} ${d}`;
}

/** yyyymmdd int → 'Aug 27, 2026'. */
export function formatDayLong(t: number): string {
  return `${formatDayShort(t)}, ${Math.floor(t / 10000)}`;
}
