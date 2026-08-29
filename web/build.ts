/**
 * Assembles the app into one self-contained HTML file.
 *
 * Everything — data, styles, behaviour, icon — is inlined, so the page makes no
 * network requests after the initial load and works offline once cached. That
 * is the whole performance story: there is nothing to wait for.
 *
 * Output is written as page *content*, without <html>/<head>/<body> wrappers,
 * because the publishing target supplies those. <title> is emitted first so it
 * lands well inside the first 8 KB that the publisher scans for it — the data
 * blob that follows is several hundred kilobytes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon } from './icon.ts';
import type { ChartFile, CorrelationFile, Meta, Rankings } from '../shared/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const read = <T>(rel: string): T => JSON.parse(readFileSync(join(repo, rel), 'utf8')) as T;

const meta = read<Meta>('data/meta.json');
const rankings = read<Rankings>('data/rankings.json');
const correlation = read<CorrelationFile>('data/correlation.json');

/**
 * Close-only projection of every chart, with the trading calendars pooled.
 *
 * Two narrowings, both build-time only — the refresh script still writes full
 * OHLC per symbol and this does not touch the data format.
 *
 * Close-only: the app draws a line and nothing else, so open/high/low would be
 * three quarters of the chart payload for arrays nothing reads. The 52-week
 * range they might have served is precomputed into rankings.json.
 *
 * Pooled calendars: the dates are the larger half of what remains and are very
 * nearly all the same. Across the whole index there are only a handful of
 * distinct date arrays — one shared by almost every symbol, plus a few short
 * ones for recent listings — so each chart stores a calendar id instead of 253
 * repeated dates. That is what makes shipping the full universe affordable
 * rather than the top 50 alone.
 */
interface PooledChart {
  cal: number;
  c: number[];
}

const calendars: number[][] = [];
const calendarIds = new Map<string, number>();

const calendarId = (dates: number[]): number => {
  const key = dates.join(',');
  let id = calendarIds.get(key);
  if (id === undefined) {
    id = calendars.length;
    calendars.push(dates);
    calendarIds.set(key, id);
  }
  return id;
};

const charts: Record<string, PooledChart> = {};
for (const stock of [...rankings.stocks].sort((a, b) => (a.fileKey < b.fileKey ? -1 : 1))) {
  const { t, c } = read<ChartFile>(`data/charts/${stock.fileKey}.json`);
  charts[stock.fileKey] = { cal: calendarId(t), c };
}

/**
 * Prior ranks stay in data/ but are dropped here: nothing in the app reads
 * them since the movement carets were removed, and shipping ~500 unread pairs
 * is dead payload. scripts/write.ts still records them, so an entrants/exits
 * view could use them later without another refresh cycle to seed history.
 */
const shipped = {
  ...rankings,
  stocks: rankings.stocks.map(({ prevRankBlended, prevRankVolAdj, ...keep }) => keep),
};

/** `</` inside a string literal would close the enclosing <script> early. */
const payload = JSON.stringify({ meta, rankings: shipped, correlation, calendars, charts }).replace(/<\//g, '<\\/');

const css = readFileSync(join(here, 'app.css'), 'utf8');
// chartmath first: app.js closes over the global it defines.
const js = ['chartmath.js', 'concentration.js', 'trend.js', 'app.js']
  .map((f) => readFileSync(join(here, f), 'utf8'))
  .join('\n');

const build = () => {
  const icon = renderIcon();

  const html = [
    '<title>Momentum</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    // Added to the home screen, these drop Safari's chrome and let the app own
    // the status bar, so it presents as an installed app rather than a page.
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="Momentum">',
    '<meta name="color-scheme" content="light dark">',
    `<link rel="apple-touch-icon" href="${icon}">`,
    `<style>\n${css}</style>`,
    '<div id="app"></div>',
    `<script>window.DATA=${payload};</${'script'}>`,
    `<script>\n${js}</${'script'}>`,
    '',
  ].join('\n');

  const out = join(repo, 'dist', 'momentum.html');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  const mb = (html.length / 1024 / 1024).toFixed(2);
  console.log(`dist/momentum.html — ${mb} MB · ${Object.keys(charts).length} charts · ${calendars.length} calendars · ${rankings.stocks.length} stocks`);
};

try {
  build();
} catch (err) {
  console.error('build failed:', (err as Error).message);
  process.exit(1);
}
