import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const C = require('../concentration.js');

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));

interface Chart { t: number[]; c: number[] }
const chartOf = (fileKey: string): Chart => {
  const { t, c } = readJson(`data/charts/${fileKey}.json`);
  return { t, c };
};

/**
 * The load-bearing test for this module: the browser recomputes correlations
 * from the close series, and must land on the same numbers the refresh
 * pipeline wrote. If these drift, the watchlist quietly starts scoring names
 * against a different definition than the correlation screen shows.
 */
test('recomputing from closes reproduces the shipped correlation matrix', () => {
  const corr = readJson('data/correlation.json');
  const rankings = readJson('data/rankings.json');
  const fileKeyOf = new Map<string, string>(
    rankings.stocks.map((s: { symbol: string; fileKey: string }) => [s.symbol, s.fileKey]),
  );

  const set = corr.sets.find((s: { mode: string }) => s.mode === 'blended');
  // A 12-name corner of the matrix: 66 pairs, enough to catch an off-by-one in
  // the date alignment or a wrong window without reading 500 chart files.
  const take = 12;
  const charts = set.tickers.slice(0, take).map((sym: string) => chartOf(fileKeyOf.get(sym)!));
  const mine = C.correlationMatrixOf(charts);

  // Rounding the recomputation the way scripts/write.ts rounds the snapshot
  // must reproduce the shipped values EXACTLY. Comparing raw against rounded
  // instead would need a tolerance, and any tolerance loose enough to admit
  // two-decimal rounding (mean error 0.0025) is also loose enough to hide a
  // real drift of the same size.
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const mismatches: string[] = [];
  for (let i = 0; i < take; i++) {
    for (let j = 0; j < take; j++) {
      if (round2(mine[i][j]) !== set.matrix[i][j]) {
        mismatches.push(
          `${set.tickers[i]}/${set.tickers[j]}: ${round2(mine[i][j])} vs ${set.matrix[i][j]}`,
        );
      }
    }
  }
  assert.deepEqual(mismatches, [], `${mismatches.length} of ${take * take} pairs disagree`);
});

test('a series correlates perfectly with itself and with a scaled copy', () => {
  const a = chartOf('AAPL');
  assert.ok(Math.abs(C.correlationOf(a, a) - 1) < 1e-12);
  const scaled = { t: a.t, c: a.c.map((v: number) => v * 3.5) };
  assert.ok(Math.abs(C.correlationOf(a, scaled) - 1) < 1e-12, 'scale must not matter');
});

test('returns are keyed by the date they land on, not the one before', () => {
  const r = C.returnsByDate({ t: [20250102, 20250103, 20250106], c: [100, 110, 99] });
  assert.deepEqual(Object.keys(r), ['20250103', '20250106']);
  assert.ok(Math.abs(r[20250103] - Math.log(1.1)) < 1e-12);
});

test('too little overlap is undefined rather than a confident number', () => {
  const short = { t: [20250102, 20250103, 20250106], c: [10, 11, 12] };
  assert.ok(Number.isNaN(C.correlationOf(short, short)), 'three bars is not a correlation');
});

test('non-overlapping dates give no correlation at all', () => {
  const n = 140;
  const mk = (start: number) => ({
    t: Array.from({ length: n }, (_, i) => start + i),
    c: Array.from({ length: n }, (_, i) => 100 + Math.sin(i)),
  });
  assert.ok(Number.isNaN(C.correlationOf(mk(20200101), mk(20250101))));
});

test('the matrix is symmetric with a unit diagonal and no NaN', () => {
  const charts = ['AAPL', 'MSFT', 'F'].map(chartOf);
  const m = C.correlationMatrixOf(charts);
  for (let i = 0; i < 3; i++) {
    assert.equal(m[i][i], 1);
    for (let j = 0; j < 3; j++) {
      assert.equal(m[i][j], m[j][i]);
      assert.ok(isFinite(m[i][j]));
    }
  }
});

test('pearson matches a hand-computed case and rejects a constant series', () => {
  assert.ok(Math.abs(C.pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
  assert.ok(Math.abs(C.pearson([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-12);
  assert.ok(Number.isNaN(C.pearson([1, 1, 1], [1, 2, 3])));
});
