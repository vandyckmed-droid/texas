/**
 * Refresh pipeline: fetch FMP data → validate/adjust → compute all
 * rankings/analytics via quant/ → self-check → deterministic write to data/.
 *
 * Run only on explicit request: `npm run refresh`
 * Flags:
 *   --limit N        first N constituents only (smoke runs)
 *   --symbols A,B    exact symbols only (FMP dash or display dot form)
 *   --skip-fetch     reuse .cache/fmp/ instead of hitting the API
 *
 * Fails loud and writes nothing on any error or failed self-check.
 */
import { clusterAverageLinkage } from '../quant/cluster.ts';
import { blendedMomentum, MIN_BARS_12_1, momentum12_1, momentum6_1 } from '../quant/momentum.ts';
import { range52w } from '../quant/range.ts';
import { rollingDisplaySeries, type DatedCloses } from '../quant/rolling.ts';
import { correlationMatrix, logReturns } from '../quant/stats.ts';
import { realizedVol } from '../quant/vol.ts';
import type {
  ChartFile,
  CorrelationSet,
  Meta,
  RankMode,
  Rankings,
  Sector,
  StockRow,
} from '../shared/types.ts';
import { adjustSeries, type AdjustedSeries } from './adjust.ts';
import { fetchConstituents, fetchHistory, mapLimit, type FmpSource } from './fmp.ts';
import { normalizeSectors } from './sectors.ts';
import { round, writeSnapshot, type Snapshot } from './write.ts';

const HISTORY_MONTHS = 25; // ≈ 525 trading days; ranking needs 273
const MIN_BARS_RANKED = 273;
const MIN_BARS_CHART = 30;
const MAX_RANK_EXCLUSIONS = 25;
const CHART_BARS = 253;
const ROLLING_POINTS = 26;
const ROLLING_STEP = 5;
const CORR_WINDOW = 126;
const MIN_CORR_OVERLAP = 100;
const TOP_N = 50;
const CONCURRENCY = 8;

interface Args {
  limit: number | null;
  symbols: string[] | null;
  skipFetch: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { limit: null, symbols: null, skipFetch: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--symbols') args.symbols = argv[++i].split(',').map((s) => s.trim());
    else if (argv[i] === '--skip-fetch') args.skipFetch = true;
    else throw new Error(`unknown flag: ${argv[i]}`);
  }
  return args;
}

const isoDaysAgoMonths = (months: number): string => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

async function main(): Promise<void> {
  const args = parseArgs();
  const t0 = Date.now();

  // 1. Universe ---------------------------------------------------------
  const constituents = await fetchConstituents(args.skipFetch);
  let universe = constituents.data;
  if (args.symbols) {
    const want = new Set(args.symbols.map((s) => s.replaceAll('.', '-')));
    universe = universe.filter((c) => want.has(c.symbol.replaceAll('.', '-')));
    if (universe.length !== want.size) {
      const found = new Set(universe.map((c) => c.symbol.replaceAll('.', '-')));
      throw new Error(`--symbols not in universe: ${[...want].filter((s) => !found.has(s)).join(', ')}`);
    }
  }
  if (args.limit !== null) universe = universe.slice(0, args.limit);
  console.log(`universe: ${universe.length} constituents (source ${constituents.source})`);

  const sectorBySymbol = normalizeSectors(universe);

  // 2. History ----------------------------------------------------------
  const from = isoDaysAgoMonths(HISTORY_MONTHS);
  const to = new Date().toISOString().slice(0, 10);
  let fetched = 0;
  const sources = new Set<FmpSource>([constituents.source]);
  const histories = await mapLimit(universe, CONCURRENCY, async (c) => {
    const fmpSymbol = c.symbol.replaceAll('.', '-');
    const res = await fetchHistory(fmpSymbol, from, to, args.skipFetch);
    sources.add(res.source);
    fetched++;
    if (fetched % 50 === 0) console.log(`  fetched ${fetched}/${universe.length}`);
    return { constituent: c, fmpSymbol, series: adjustSeries(res.data) };
  });

  // 3. Eligibility ------------------------------------------------------
  interface Candidate {
    symbol: string; // display form
    fileKey: string;
    name: string;
    sector: Sector;
    series: AdjustedSeries;
  }
  const excluded: Meta['excluded'] = [];
  const ranked: Candidate[] = [];
  const chartOnly: Candidate[] = [];
  let totalMissingAdj = 0;
  let totalDropped = 0;

  for (const { constituent, fmpSymbol, series } of histories) {
    totalMissingAdj += series.missingAdjClose;
    totalDropped += series.dropped;
    const cand: Candidate = {
      symbol: fmpSymbol.replaceAll('-', '.'),
      fileKey: fmpSymbol,
      name: constituent.name,
      sector: sectorBySymbol.get(constituent.symbol)!,
      series,
    };
    if (series.dates.length < MIN_BARS_CHART) {
      excluded.push({ symbol: cand.symbol, reason: `insufficient-history (${series.dates.length} bars)` });
      continue;
    }
    if (series.dates.length < MIN_BARS_RANKED) {
      excluded.push({ symbol: cand.symbol, reason: `short-history (${series.dates.length} bars, chart only)` });
      chartOnly.push(cand);
      continue;
    }
    const vol = realizedVol(series.close);
    if (!Number.isFinite(vol) || vol < 1e-6) {
      excluded.push({ symbol: cand.symbol, reason: 'degenerate-vol (chart only)' });
      chartOnly.push(cand);
      continue;
    }
    ranked.push(cand);
  }

  if (excluded.length > MAX_RANK_EXCLUSIONS) {
    console.error(`excluded symbols (${excluded.length}):`);
    for (const e of excluded) console.error(`  ${e.symbol}: ${e.reason}`);
    throw new Error(
      `${excluded.length} symbols excluded from ranks (> ${MAX_RANK_EXCLUSIONS}) — bad fetch, refusing to write`,
    );
  }

  // asOf = latest trading date seen; require rankable symbols to be current.
  const asOf = ranked.reduce((m, c) => {
    const last = c.series.dates[c.series.dates.length - 1];
    return last > m ? last : m;
  }, '');
  const stale = ranked.filter((c) => c.series.dates[c.series.dates.length - 1] < asOf);
  if (stale.length > universe.length * 0.2) {
    throw new Error(`asOf ${asOf}: ${stale.length} ranked symbols lack that date — inconsistent fetch`);
  }

  // 4. Per-stock metrics ------------------------------------------------
  const reference = ranked.reduce((a, b) => (b.series.dates.length > a.series.dates.length ? b : a));
  const refDates = reference.series.dates;
  const anchorDates: string[] = [];
  for (let k = ROLLING_POINTS - 1; k >= 0; k--) {
    const idx = refDates.length - 1 - k * ROLLING_STEP;
    if (idx >= 0) anchorDates.push(refDates[idx]);
  }
  const rolling = rollingDisplaySeries(
    new Map<string, DatedCloses>(
      ranked.map((c) => [c.symbol, { dates: c.series.dates, closes: c.series.close }]),
    ),
    anchorDates,
  );

  const rows = ranked.map((c) => {
    const closes = c.series.close;
    const m12 = momentum12_1(closes);
    const m6 = momentum6_1(closes);
    const blended = blendedMomentum(closes);
    const vol = realizedVol(closes);
    const range = range52w(c.series.high, c.series.low, closes[closes.length - 1]);
    return {
      cand: c,
      m12,
      m6,
      blended,
      vol,
      volAdj: blended / vol,
      range,
      rolling: rolling.get(c.symbol)!.map((v) => (v === null ? null : round(v, 3))),
    };
  });
  for (const r of rows) {
    for (const [k, v] of Object.entries({ m12: r.m12, m6: r.m6, vol: r.vol, volAdj: r.volAdj })) {
      if (!Number.isFinite(v)) throw new Error(`${r.cand.symbol}: non-finite ${k}`);
    }
  }

  const byBlended = [...rows].sort((a, b) => b.blended - a.blended);
  const byVolAdj = [...rows].sort((a, b) => b.volAdj - a.volAdj);
  const rankB = new Map(byBlended.map((r, i) => [r.cand.symbol, i + 1]));
  const rankV = new Map(byVolAdj.map((r, i) => [r.cand.symbol, i + 1]));

  const stocks: StockRow[] = byBlended.map((r) => ({
    symbol: r.cand.symbol,
    fileKey: r.cand.fileKey,
    name: r.cand.name,
    sector: r.cand.sector,
    price: round(r.range.latest, 2),
    m12: round(r.m12, 4),
    m6: round(r.m6, 4),
    blended: round(r.blended, 4),
    vol: round(r.vol, 4),
    volAdj: round(r.volAdj, 4),
    rankBlended: rankB.get(r.cand.symbol)!,
    rankVolAdj: rankV.get(r.cand.symbol)!,
    wk52Low: round(r.range.low, 2),
    wk52High: round(r.range.high, 2),
    rolling: r.rolling,
  }));

  const rankings: Rankings = { asOf, rollingDates: anchorDates, stocks };

  // 5. Correlation + clustering per mode --------------------------------
  const candBySymbol = new Map(ranked.map((c) => [c.symbol, c]));
  let nanPairs = 0;

  const makeSet = (mode: RankMode): CorrelationSet => {
    const top = [...stocks]
      .sort((a, b) => (mode === 'blended' ? a.rankBlended - b.rankBlended : a.rankVolAdj - b.rankVolAdj))
      .slice(0, Math.min(TOP_N, stocks.length));
    // Per-symbol date → daily log return over the recent window.
    const retMaps = top.map((s) => {
      const { dates, close } = candBySymbol.get(s.symbol)!.series;
      const rets = logReturns(close);
      const recent = new Map<string, number>();
      for (let i = Math.max(0, rets.length - (CORR_WINDOW + 30)); i < rets.length; i++) {
        recent.set(dates[i + 1], rets[i]);
      }
      return recent;
    });
    const n = top.length;
    // Align each pair on its common dates before correlating.
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) matrix[i][i] = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const common = [...retMaps[i].keys()].filter((d) => retMaps[j].has(d)).sort();
        const recent = common.slice(-CORR_WINDOW);
        let r = NaN;
        if (recent.length >= MIN_CORR_OVERLAP) {
          const xi = recent.map((d) => retMaps[i].get(d)!);
          const xj = recent.map((d) => retMaps[j].get(d)!);
          r = correlationMatrix([xi, xj])[0][1];
        }
        if (Number.isNaN(r)) {
          nanPairs++;
          r = 0;
        }
        matrix[i][j] = matrix[j][i] = round(r, 2);
      }
    }

    const { leafOrder, groups } = clusterAverageLinkage(matrix);
    const tickers = leafOrder.map((i) => top[i].symbol);
    const ordered = leafOrder.map((i) => matrix[i].slice());
    const orderedMatrix = ordered.map((row) => leafOrder.map((j) => row[j]));

    const posInLeaf = new Map(leafOrder.map((orig, pos) => [orig, pos]));
    const clusters = groups.map((members, id) => {
      const positions = members.map((m) => posInLeaf.get(m)!).sort((a, b) => a - b);
      const start = positions[0];
      const size = positions.length;
      const sectorCounts = new Map<Sector, number>();
      for (const m of members) {
        const sec = top[m].sector;
        sectorCounts.set(sec, (sectorCounts.get(sec) ?? 0) + 1);
      }
      const topSector = [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      let sum = 0;
      let cnt = 0;
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          sum += matrix[members[a]][members[b]];
          cnt++;
        }
      }
      return { id, start, size, avgIntraCorr: cnt > 0 ? round(sum / cnt, 2) : 1, topSector };
    });

    return { mode, tickers, matrix: orderedMatrix, clusters };
  };

  const sets = [makeSet('blended'), makeSet('volAdj')];

  // 6. Charts -----------------------------------------------------------
  const charts = [...ranked, ...chartOnly].map((c) => {
    const s = c.series;
    const startIdx = Math.max(0, s.dates.length - CHART_BARS);
    const file: ChartFile = {
      symbol: c.symbol,
      t: s.dates.slice(startIdx).map((d) => Number(d.replaceAll('-', ''))),
      o: s.open.slice(startIdx).map((v) => round(v, 2)),
      h: s.high.slice(startIdx).map((v) => round(v, 2)),
      l: s.low.slice(startIdx).map((v) => round(v, 2)),
      c: s.close.slice(startIdx).map((v) => round(v, 2)),
    };
    return { fileKey: c.fileKey, file };
  });

  const meta: Meta = {
    asOf,
    generatedAt: new Date().toISOString(),
    universeCount: universe.length,
    rankedCount: stocks.length,
    excluded,
    source: sources.has('fmp-v3') ? 'fmp-v3' : 'fmp-stable',
  };

  // 7. Self-checks ------------------------------------------------------
  const chartKeys = new Set(charts.map((ch) => ch.fileKey));
  for (const s of stocks) {
    if (!chartKeys.has(s.fileKey)) throw new Error(`self-check: ranked ${s.symbol} has no chart`);
  }
  const rankedSymbols = new Set(stocks.map((s) => s.symbol));
  for (const set of sets) {
    const n = set.tickers.length;
    if (stocks.length >= TOP_N && n !== TOP_N) throw new Error(`self-check: ${set.mode} top-50 has ${n}`);
    for (const t of set.tickers) {
      if (!rankedSymbols.has(t)) throw new Error(`self-check: correlation ticker ${t} not ranked`);
    }
    for (let i = 0; i < n; i++) {
      if (set.matrix[i][i] !== 1) throw new Error('self-check: matrix diagonal != 1');
      for (let j = 0; j < n; j++) {
        const v = set.matrix[i][j];
        if (v !== set.matrix[j][i]) throw new Error('self-check: matrix not symmetric');
        if (!(v >= -1 && v <= 1)) throw new Error('self-check: |r| > 1');
      }
    }
    const covered = new Array<boolean>(n).fill(false);
    for (const cl of set.clusters) {
      for (let p = cl.start; p < cl.start + cl.size; p++) {
        if (covered[p]) throw new Error('self-check: overlapping clusters');
        covered[p] = true;
      }
    }
    if (covered.some((c) => !c)) throw new Error('self-check: clusters do not tile leaf order');
  }
  if (stocks.some((s) => s.rolling.length !== anchorDates.length)) {
    throw new Error('self-check: rolling series misaligned');
  }

  // 8. Write + summary --------------------------------------------------
  writeSnapshot({
    meta,
    rankings,
    correlation: { asOf, window: CORR_WINDOW, sets },
    charts,
  } satisfies Snapshot);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nrefresh complete in ${secs}s — asOf ${asOf} (${meta.source})`);
  console.log(`ranked ${stocks.length}/${universe.length}, charts ${charts.length}, excluded ${excluded.length}`);
  if (excluded.length > 0) for (const e of excluded) console.log(`  excluded ${e.symbol}: ${e.reason}`);
  if (totalMissingAdj > 0) console.log(`rows with factor-1 adjClose fallback: ${totalMissingAdj}`);
  if (totalDropped > 0) console.log(`bad/duplicate rows dropped: ${totalDropped}`);
  if (nanPairs > 0) console.log(`correlation pairs with insufficient overlap (set to 0): ${nanPairs}`);
  for (const mode of ['blended', 'volAdj'] as const) {
    const top10 = [...stocks]
      .sort((a, b) => (mode === 'blended' ? a.rankBlended - b.rankBlended : a.rankVolAdj - b.rankVolAdj))
      .slice(0, 10)
      .map((s) => s.symbol)
      .join(' ');
    console.log(`top10 ${mode}: ${top10}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
