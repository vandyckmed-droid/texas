/**
 * Financial Modeling Prep client for the refresh pipeline.
 *
 * Prefers the current "stable" API and falls back to legacy /api/v3 per
 * request kind (older Premium keys may only have one surface enabled).
 * Raw responses are cached under .cache/fmp/ (gitignored) so compute
 * iteration with --skip-fetch never re-hits the API.
 *
 * The API key comes from the environment only and is never logged,
 * thrown, or written to disk.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE = 'https://financialmodelingprep.com';
const CACHE_DIR = path.join(import.meta.dirname, '..', '.cache', 'fmp');

export type FmpSource = 'fmp-stable' | 'fmp-v3';

export interface RawConstituent {
  symbol: string;
  name: string;
  sector: string;
}

export interface RawBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  /** Split+dividend adjusted close; absent on some rows/endpoints. */
  adjClose?: number;
}

export function apiKey(): string {
  const key = process.env.API_KEY ?? process.env.FMP_API_KEY;
  if (!key) {
    console.error('refresh: no FMP API key found. Set API_KEY (or FMP_API_KEY) in the environment.');
    process.exit(1);
  }
  return key;
}

/** Strip the API key from anything that might get printed. */
const scrub = (s: string): string => s.replaceAll(apiKey(), '***');

async function getJson(pathAndQuery: string, attempt = 0): Promise<unknown> {
  const url = `${BASE}${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}apikey=${apiKey()}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    if (attempt >= 3) throw new Error(`network failure for ${scrub(pathAndQuery)}: ${String(err)}`);
    await backoff(attempt, null);
    return getJson(pathAndQuery, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`HTTP ${res.status} for ${scrub(pathAndQuery)} after retries`);
    await backoff(attempt, res.headers.get('retry-after'));
    return getJson(pathAndQuery, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${scrub(pathAndQuery)}`);
  }
  return res.json();
}

async function backoff(attempt: number, retryAfter: string | null): Promise<void> {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const base = Number.isFinite(hinted) ? hinted : 1000 * 2 ** attempt;
  const jitter = Math.random() * 500;
  await new Promise((r) => setTimeout(r, base + jitter));
}

const isHttpError = (err: unknown, ...codes: number[]): boolean =>
  err instanceof Error && codes.some((c) => err.message.startsWith(`HTTP ${c} `));

function readCache<T>(name: string): T | null {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeCache(name: string, value: unknown): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), JSON.stringify(value));
}

interface CachedPayload<T> {
  source: FmpSource;
  data: T;
}

export async function fetchConstituents(skipFetch: boolean): Promise<CachedPayload<RawConstituent[]>> {
  const cached = readCache<CachedPayload<RawConstituent[]>>('constituents');
  if (skipFetch) {
    if (!cached) throw new Error('--skip-fetch: no cached constituents in .cache/fmp/');
    return cached;
  }
  let source: FmpSource = 'fmp-stable';
  let raw: unknown;
  try {
    raw = await getJson('/stable/sp500-constituent');
  } catch (err) {
    if (!isHttpError(err, 401, 402, 403, 404)) throw err;
    source = 'fmp-v3';
    raw = await getJson('/api/v3/sp500_constituent');
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`constituents: unexpected ${source} response shape`);
  }
  const data = raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      symbol: String(r.symbol ?? ''),
      name: String(r.name ?? ''),
      sector: String(r.sector ?? ''),
    };
  });
  if (data.some((c) => !c.symbol || !c.sector)) {
    throw new Error('constituents: rows missing symbol or sector');
  }
  const payload = { source, data };
  writeCache('constituents', payload);
  return payload;
}

/**
 * Normalizes the endpoint shapes to RawBar[], ascending by date.
 * v3 rows carry open/high/low/close + adjClose; the stable
 * dividend-adjusted rows carry adjOpen/adjHigh/adjLow/adjClose — those
 * arrive pre-adjusted, so they are emitted with close = adjClose and the
 * downstream adjustment factor becomes 1.
 */
function parseBars(raw: unknown): RawBar[] {
  const rows = Array.isArray(raw)
    ? raw
    : ((raw as { historical?: unknown[] })?.historical ?? []);
  const bars: RawBar[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    const preAdjusted = row.adjOpen !== undefined && row.open === undefined;
    const num = (v: unknown): number => Number(v);
    const bar: RawBar = {
      date: String(row.date ?? '').slice(0, 10),
      open: num(preAdjusted ? row.adjOpen : row.open),
      high: num(preAdjusted ? row.adjHigh : row.high),
      low: num(preAdjusted ? row.adjLow : row.low),
      close: num(preAdjusted ? row.adjClose : row.close),
    };
    if (row.adjClose !== undefined && row.adjClose !== null) bar.adjClose = num(row.adjClose);
    bars.push(bar);
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

/**
 * Daily history for one symbol (FMP dash form). Prefers the stable
 * dividend+split adjusted endpoint; falls back to v3 historical-price-full.
 */
export async function fetchHistory(
  fmpSymbol: string,
  from: string,
  to: string,
  skipFetch: boolean,
): Promise<CachedPayload<RawBar[]>> {
  const cacheName = `history-${fmpSymbol}`;
  const cached = readCache<CachedPayload<RawBar[]>>(cacheName);
  if (skipFetch) {
    if (!cached) throw new Error(`--skip-fetch: no cached history for ${fmpSymbol}`);
    return cached;
  }
  const enc = encodeURIComponent(fmpSymbol);
  let source: FmpSource = 'fmp-stable';
  let bars: RawBar[];
  try {
    const raw = await getJson(
      `/stable/historical-price-eod/dividend-adjusted?symbol=${enc}&from=${from}&to=${to}`,
    );
    bars = parseBars(raw);
    if (bars.length > 0 && bars.every((b) => b.adjClose === undefined)) {
      // Stable endpoint exists but without adjusted closes — use v3 instead.
      throw new Error('HTTP 404 synthetic: stable rows lack adjClose');
    }
  } catch (err) {
    if (!isHttpError(err, 401, 402, 403, 404)) throw err;
    source = 'fmp-v3';
    const raw = await getJson(
      `/api/v3/historical-price-full/${enc}?from=${from}&to=${to}&serietype=bar`,
    );
    bars = parseBars(raw);
  }
  const payload = { source, data: bars };
  writeCache(cacheName, payload);
  return payload;
}

/** Runs tasks with bounded concurrency, preserving order of results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
