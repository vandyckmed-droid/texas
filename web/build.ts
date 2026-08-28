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
 * Charts for the union of both top-50 lists. That is the complete reachable
 * set: the ranking screen shows the top 50 of the selected mode, and the
 * watchlist can only ever hold symbols starred from there. Shipping all 503
 * would multiply the payload roughly eightfold for rows no tap can reach.
 */
const reachable = new Set<string>();
for (const key of ['rankBlended', 'rankVolAdj'] as const) {
  [...rankings.stocks]
    .sort((a, b) => a[key] - b[key])
    .slice(0, 50)
    .forEach((s) => reachable.add(s.fileKey));
}

/**
 * Close-only projection of the chart files. The web app draws a line and
 * nothing else, so the open/high/low series would ship three quarters of the
 * chart payload for arrays nothing reads — the 52-week range it might have
 * served is precomputed into rankings.json. The refresh script still writes
 * full OHLC; this is a build-time narrowing, not a change to the data format.
 */
type LineChartFile = Pick<ChartFile, 't' | 'c'>;

const charts: Record<string, LineChartFile> = {};
for (const key of [...reachable].sort()) {
  const { t, c } = read<ChartFile>(`data/charts/${key}.json`);
  charts[key] = { t, c };
}

/** `</` inside a string literal would close the enclosing <script> early. */
const payload = JSON.stringify({ meta, rankings, correlation, charts }).replace(/<\//g, '<\\/');

const css = readFileSync(join(here, 'app.css'), 'utf8');
const js = readFileSync(join(here, 'app.js'), 'utf8');

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
  console.log(`dist/momentum.html — ${mb} MB · ${Object.keys(charts).length} charts · ${rankings.stocks.length} stocks`);
};

try {
  build();
} catch (err) {
  console.error('build failed:', (err as Error).message);
  process.exit(1);
}
