/**
 * Normalizes FMP sector strings to the 11 standard GICS sector names.
 * Covers both FMP vocabularies (GICS-style and the shorter legacy names).
 * Unknown strings are a hard error listing every offender — never a
 * silent "Other" — so vocabulary drift fails the refresh loudly.
 */
import { GICS_SECTORS, type Sector } from '../shared/types.ts';

const MAP = new Map<string, Sector>([
  ...GICS_SECTORS.map((s) => [s, s] as const),
  ['Technology', 'Information Technology'],
  ['Healthcare', 'Health Care'],
  ['Financial Services', 'Financials'],
  ['Financial', 'Financials'],
  ['Consumer Cyclical', 'Consumer Discretionary'],
  ['Consumer Defensive', 'Consumer Staples'],
  ['Basic Materials', 'Materials'],
  ['Communication Services', 'Communication Services'],
  ['Telecommunications', 'Communication Services'],
]);

export function normalizeSectors(rows: { symbol: string; sector: string }[]): Map<string, Sector> {
  const out = new Map<string, Sector>();
  const unknown = new Map<string, string[]>();
  for (const { symbol, sector } of rows) {
    const normalized = MAP.get(sector.trim());
    if (normalized) {
      out.set(symbol, normalized);
    } else {
      unknown.set(sector, [...(unknown.get(sector) ?? []), symbol]);
    }
  }
  if (unknown.size > 0) {
    const lines = [...unknown.entries()]
      .map(([sec, syms]) => `  "${sec}" (${syms.slice(0, 5).join(', ')}${syms.length > 5 ? ', …' : ''})`)
      .join('\n');
    throw new Error(`unknown FMP sector strings — extend the map in scripts/sectors.ts:\n${lines}`);
  }
  return out;
}
