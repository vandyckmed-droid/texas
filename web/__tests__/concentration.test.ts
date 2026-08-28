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

// ---------- portfolio statistics ----------

const m3 = (rho: number) => constantCorr(3, rho);
const member = (i: number, ret: number, vol: number) => ({ i, ret, vol });

test('a single holding has the portfolio stats of that holding', () => {
  const p = C.portfolioStats(m3(0.5), [member(0, 0.30, 0.20)]);
  assert.equal(p.ret, 0.30);
  assert.ok(Math.abs(p.vol - 0.20) < 1e-12);
  assert.ok(Math.abs(p.score - 1.5) < 1e-12);
});

test('perfectly correlated equal-vol holdings keep the single-name volatility', () => {
  const held = [member(0, 0.3, 0.2), member(1, 0.3, 0.2), member(2, 0.3, 0.2)];
  assert.ok(Math.abs(C.portfolioStats(m3(1), held).vol - 0.2) < 1e-12);
});

test('uncorrelated equal-vol holdings scale volatility by 1/sqrt(n)', () => {
  const held = [member(0, 0.3, 0.2), member(1, 0.3, 0.2), member(2, 0.3, 0.2)];
  assert.ok(Math.abs(C.portfolioStats(m3(0), held).vol - 0.2 / Math.sqrt(3)) < 1e-12);
});

test('portfolio volatility uses the full double sum, not an average of vols', () => {
  // Averaging the vols would give 0.2 regardless of correlation; the real
  // answer for two uncorrelated names is 0.2/sqrt(2).
  const held = [member(0, 0.3, 0.2), member(1, 0.3, 0.2)];
  const p = C.portfolioStats(constantCorr(2, 0), held);
  assert.ok(Math.abs(p.vol - 0.2 / Math.sqrt(2)) < 1e-12);
  assert.ok(p.vol < 0.2);
});

test('portfolio return is the equal-weight mean', () => {
  const held = [member(0, 0.10, 0.2), member(1, 0.50, 0.2)];
  assert.ok(Math.abs(C.portfolioStats(constantCorr(2, 0.5), held).ret - 0.30) < 1e-12);
});

test('a non-finite correlation is treated as zero rather than poisoning the variance', () => {
  const m = [[1, NaN], [NaN, 1]];
  const p = C.portfolioStats(m, [member(0, 0.3, 0.2), member(1, 0.3, 0.2)]);
  assert.ok(isFinite(p.vol) && p.vol > 0);
});

// ---------- add / remove decisions ----------

test('an uncorrelated clone improves the book; a perfectly correlated one does not', () => {
  const held = [member(0, 0.3, 0.2)];
  const twin = member(1, 0.3, 0.2);
  assert.ok(C.deltaOnAdd(constantCorr(2, 0), held, twin) > 0, 'diversifying twin should help');
  assert.ok(Math.abs(C.deltaOnAdd(constantCorr(2, 1), held, twin)) < 1e-12, 'identical twin is neutral');
});

test('a high-momentum name that duplicates the book can still be the wrong add', () => {
  // Same direction, better return, but moving in lockstep and much more volatile.
  const m = constantCorr(2, 0.98);
  const held = [member(0, 0.30, 0.15)];       // score 2.00
  const flashy = member(1, 0.45, 0.40);        // score 1.13 alone
  assert.ok(C.deltaOnAdd(m, held, flashy) < 0, 'ranking high is not the same as fitting');
});

test('an equal-weight improvement always satisfies the textbook rule, but not the reverse', () => {
  // Elton-Gruber (add when SR_new > SR_p * rho) asks whether ANY positive
  // weight in the new name improves the portfolio, so it clears names that
  // only help in small size. A watchlist has no weight slider -- a name is
  // starred or it is not -- so the app answers the stricter equal-weight
  // question. The rule must therefore be the more permissive of the two.
  const held = [member(0, 0.30, 0.20)];        // SR_p = 1.5
  let sawRulePermitWhatEqualWeightRejects = false;

  for (const rho of [0.0, 0.3, 0.6, 0.9]) {
    for (const srNew of [0.5, 1.0, 1.5, 2.0]) {
      const cand = member(1, srNew * 0.2, 0.2);
      const helps = C.deltaOnAdd(constantCorr(2, rho), held, cand) > 1e-12;
      const rulePermits = srNew > 1.5 * rho;
      if (helps) {
        assert.ok(rulePermits,
          `equal weight helped at rho=${rho}, SR_new=${srNew}, but the rule forbids it`);
      } else if (rulePermits) {
        sawRulePermitWhatEqualWeightRejects = true;
      }
    }
  }
  assert.ok(sawRulePermitWhatEqualWeightRejects,
    'the two should genuinely differ; if they never do, one of them is miscomputed');
});

test('equal weight rejects a diversifier that is simply too weak to hold in size', () => {
  // Uncorrelated, so any sliver of it helps and the textbook rule says add.
  // At half the book it drags the return down more than it cuts the risk.
  const held = [member(0, 0.30, 0.20)];        // SR 1.5
  const weak = member(1, 0.10, 0.20);          // SR 0.5, rho 0
  assert.ok(0.5 > 1.5 * 0, 'the textbook rule permits it');
  assert.ok(C.deltaOnAdd(constantCorr(2, 0), held, weak) < 0, 'at equal weight it hurts');
});

test('removing the weakest name improves the book most', () => {
  const m = constantCorr(3, 0.5);
  const held = [member(0, 0.40, 0.20), member(1, 0.35, 0.20), member(2, 0.05, 0.20)];
  const deltas = held.map((_, k) => C.deltaOnRemove(m, held, k));
  const worst = deltas.indexOf(Math.max(...deltas));
  assert.equal(worst, 2, 'the 0.05-return name should be the best removal');
  assert.ok(deltas[2] > 0);
});

test('removal is undefined for a book of one, which cannot be reduced', () => {
  assert.equal(C.deltaOnRemove(constantCorr(2, 0.5), [member(0, 0.3, 0.2)], 0), null);
});

test('add and remove are inverses of each other', () => {
  const m = constantCorr(3, 0.4);
  const held = [member(0, 0.30, 0.20), member(1, 0.20, 0.25)];
  const cand = member(2, 0.40, 0.18);
  const added = C.deltaOnAdd(m, held, cand);
  const full = held.concat([cand]);
  const removedAgain = C.deltaOnRemove(m, full, 2);
  assert.ok(Math.abs(added + removedAgain) < 1e-12, 'adding then removing must net to zero');
});
