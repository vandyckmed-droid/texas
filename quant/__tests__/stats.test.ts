import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correlationMatrix, logReturns, mean, pearson, sampleStdev, zscores } from '../stats.ts';

test('mean and sample stdev of known values', () => {
  assert.equal(mean([2, 4, 6]), 4);
  // stdev of [2,4,6]: variance = (4+0+4)/2 = 4 → 2
  assert.equal(sampleStdev([2, 4, 6]), 2);
  assert.equal(sampleStdev([5]), 0);
});

test('log returns', () => {
  const rets = logReturns([100, 110, 99]);
  assert.equal(rets.length, 2);
  assert.ok(Math.abs(rets[0] - Math.log(1.1)) < 1e-12);
  assert.ok(Math.abs(rets[1] - Math.log(0.9)) < 1e-12);
});

test('pearson: perfect, inverse, orthogonal, degenerate', () => {
  const x = [1, 2, 3, 4, 5];
  assert.ok(Math.abs(pearson(x, x) - 1) < 1e-12);
  assert.ok(Math.abs(pearson(x, x.map((v) => -v)) + 1) < 1e-12);
  // Orthogonal: y symmetric around its mean regardless of x direction.
  const y = [1, -1, 0, -1, 1];
  assert.ok(Math.abs(pearson(x, y)) < 1e-12);
  assert.ok(Number.isNaN(pearson(x, [7, 7, 7, 7, 7])));
  assert.ok(Number.isNaN(pearson([1, 2], [1, 2, 3])));
});

test('zscores: standardized, null passthrough, degenerate spread', () => {
  const zs = zscores([1, 2, 3, null]) as (number | null)[];
  assert.equal(zs[3], null);
  const present = zs.slice(0, 3) as number[];
  assert.ok(Math.abs(mean(present)) < 1e-12);
  assert.ok(Math.abs(sampleStdev(present) - 1) < 1e-12);
  assert.deepEqual(zscores([5, 5, 5]), [0, 0, 0]);
  assert.deepEqual(zscores([null, 7]), [null, 0]);
});

test('correlation matrix: symmetric with unit diagonal', () => {
  const m = correlationMatrix([
    [1, 2, 3, 4],
    [2, 4, 6, 8],
    [4, 3, 2, 1],
  ]);
  assert.equal(m[0][0], 1);
  assert.equal(m[1][1], 1);
  assert.ok(Math.abs(m[0][1] - 1) < 1e-12);
  assert.ok(Math.abs(m[0][2] + 1) < 1e-12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) assert.equal(m[i][j], m[j][i]);
});
