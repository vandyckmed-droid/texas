import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blendedMomentum, momentum12_1, momentum6_1 } from '../momentum.ts';

/** c_t = 100·e^(g·t) — constant daily log growth g. */
const expSeries = (n: number, g: number): number[] =>
  Array.from({ length: n }, (_, t) => 100 * Math.exp(g * t));

test('constant-growth series: both legs annualize to exactly 252·g', () => {
  const g = 0.001;
  const closes = expSeries(300, g);
  // 12–1 covers 231 days of growth, annualized ×252/231 → 252·g.
  assert.ok(Math.abs(momentum12_1(closes) - 252 * g) < 1e-9);
  assert.ok(Math.abs(momentum6_1(closes) - 252 * g) < 1e-9);
  assert.ok(Math.abs(blendedMomentum(closes) - 252 * g) < 1e-9);
});

test('skip month: the last 21 days do not affect momentum', () => {
  const closes = expSeries(300, 0.0005);
  const perturbed = [...closes];
  for (let i = perturbed.length - 21; i < perturbed.length; i++) perturbed[i] *= 5;
  assert.equal(momentum12_1(perturbed), momentum12_1(closes));
  assert.equal(momentum6_1(perturbed), momentum6_1(closes));
  // …but day T−21 itself does.
  const edge = [...closes];
  edge[edge.length - 22] *= 2;
  assert.notEqual(momentum12_1(edge), momentum12_1(closes));
});

test('short history yields NaN', () => {
  assert.ok(Number.isNaN(momentum12_1(expSeries(252, 0.001))));
  assert.ok(!Number.isNaN(momentum12_1(expSeries(253, 0.001))));
  assert.ok(Number.isNaN(momentum6_1(expSeries(126, 0.001))));
  assert.ok(!Number.isNaN(momentum6_1(expSeries(127, 0.001))));
  assert.ok(Number.isNaN(blendedMomentum(expSeries(200, 0.001))));
});

test('negative momentum for a declining series', () => {
  assert.ok(momentum12_1(expSeries(300, -0.002)) < 0);
});
