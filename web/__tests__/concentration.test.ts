import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../concentration.js');

/** n×n matrix with 1 on the diagonal and a constant off-diagonal. */
function constantCorr(n: number, rho: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : rho)),
  );
}

const allOf = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---------- average pairwise correlation ----------

test('avgPairwiseCorr ignores the diagonal', () => {
  // With rho 0.5 off-diagonal, including the 1s would pull the mean above 0.5.
  assert.equal(C.avgPairwiseCorr(constantCorr(4, 0.5), allOf(4)), 0.5);
});

test('avgPairwiseCorr averages only the selected members', () => {
  const m = [
    [1, 0.9, 0.0],
    [0.9, 1, 0.0],
    [0.0, 0.0, 1],
  ];
  assert.equal(C.avgPairwiseCorr(m, [0, 1]), 0.9);
  assert.equal(C.avgPairwiseCorr(m, [0, 2]), 0.0);
  // All three: pairs are 0.9, 0.0, 0.0.
  assert.ok(Math.abs(C.avgPairwiseCorr(m, [0, 1, 2]) - 0.3) < 1e-12);
});

test('avgPairwiseCorr is zero when there is no pair to average', () => {
  assert.equal(C.avgPairwiseCorr(constantCorr(3, 0.5), [1]), 0);
  assert.equal(C.avgPairwiseCorr(constantCorr(3, 0.5), []), 0);
});

test('avgPairwiseCorr skips non-finite entries rather than poisoning the mean', () => {
  const m = [
    [1, 0.4, NaN],
    [0.4, 1, 0.6],
    [NaN, 0.6, 1],
  ];
  assert.equal(C.avgPairwiseCorr(m, [0, 1, 2]), 0.5); // mean of 0.4 and 0.6
});

// ---------- effective bets ----------

test('uncorrelated names each count as their own bet', () => {
  assert.equal(C.effectiveBets(6, 0), 6);
});

test('perfectly correlated names collapse to one bet', () => {
  assert.equal(C.effectiveBets(6, 1), 1);
});

test('the headline case: six names at rho 0.6 carry the risk of 1.5', () => {
  assert.ok(Math.abs(C.effectiveBets(6, 0.6) - 1.5) < 1e-12);
});

test('effectiveBets decreases monotonically as correlation rises', () => {
  let prev = Infinity;
  for (let r = 0; r <= 1.0001; r += 0.05) {
    const k = C.effectiveBets(10, r);
    assert.ok(k <= prev + 1e-12, `rose at rho=${r.toFixed(2)}`);
    prev = k;
  }
});

test('a single name is one bet, and zero names is zero', () => {
  assert.equal(C.effectiveBets(1, 0), 1);
  assert.equal(C.effectiveBets(0, 0), 0);
});

test('negative correlation is capped at the number of names held', () => {
  // Real hedging, but "3 names, 7 bets" reads as a bug to the person holding 3.
  assert.equal(C.effectiveBets(3, -0.4), 3);
  // A denominator at or below zero must not produce a negative or infinite count.
  assert.equal(C.effectiveBets(3, -0.5), 3);
  assert.equal(C.effectiveBets(3, -0.9), 3);
});

// ---------- group breakdown ----------

const set = {
  tickers: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'],
  clusters: [
    { id: 0, start: 0, size: 3 },
    { id: 1, start: 3, size: 2 },
  ],
};

test('groupsOf splits holdings across clusters, largest first', () => {
  const out = C.groupsOf(set, ['AAA', 'DDD', 'BBB', 'EEE', 'CCC']);
  assert.deepEqual(out.groups.map((g: any) => g.id), [0, 1]);
  assert.deepEqual(out.groups[0].symbols, ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(out.groups[1].symbols, ['DDD', 'EEE']);
});

test('groupsOf reports symbols the set does not cover instead of dropping them', () => {
  // Starred under the other ranking mode, so absent from this mode's top 50.
  const out = C.groupsOf(set, ['AAA', 'ZZZ']);
  assert.deepEqual(out.covered, ['AAA']);
  assert.deepEqual(out.uncovered, ['ZZZ']);
  assert.equal(out.groups.length, 1);
});

test('every covered symbol lands in exactly one group', () => {
  const out = C.groupsOf(set, set.tickers);
  const placed = out.groups.flatMap((g: any) => g.symbols);
  assert.equal(placed.length, set.tickers.length);
  assert.equal(new Set(placed).size, set.tickers.length);
});
