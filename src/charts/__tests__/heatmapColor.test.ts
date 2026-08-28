import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUCKETS,
  NEUTRAL_BUCKET,
  bucketColor,
  bucketFor,
  cellAt,
  colorForCorr,
  luminance,
  type Poles,
} from '../heatmapColor.ts';

// The tokens the app actually ships, so these assertions cover the real ramps.
const LIGHT: Poles = { positive: '#1F5FA8', negative: '#B75A17', neutral: '#EEF0F3' };
const DARK: Poles = { positive: '#5AA9FF', negative: '#F0A055', neutral: '#1A1A21' };

test('bucketFor is monotone non-decreasing in r', () => {
  let prev = -1;
  for (let r = -1; r <= 1.0001; r += 0.01) {
    const b = bucketFor(r);
    assert.ok(b >= prev, `bucket dropped at r=${r.toFixed(2)}`);
    prev = b;
  }
});

test('bucketFor puts 0 exactly on the neutral bucket and spans the full range', () => {
  assert.equal(bucketFor(0), NEUTRAL_BUCKET);
  assert.equal(bucketFor(-1), 0);
  assert.equal(bucketFor(1), BUCKETS - 1);
});

test('bucketFor clamps out-of-range and non-finite correlations', () => {
  assert.equal(bucketFor(5), BUCKETS - 1);
  assert.equal(bucketFor(-5), 0);
  assert.equal(bucketFor(NaN), NEUTRAL_BUCKET);
});

test('bucketFor is symmetric about the midpoint', () => {
  for (const r of [0.1, 0.35, 0.6, 0.9, 1]) {
    assert.equal(
      bucketFor(r) - NEUTRAL_BUCKET,
      NEUTRAL_BUCKET - bucketFor(-r),
      `asymmetric at ±${r}`,
    );
  }
});

test('the midpoint is exactly the neutral colour — no hue at the diverging centre', () => {
  assert.equal(bucketColor(NEUTRAL_BUCKET, LIGHT).toUpperCase(), LIGHT.neutral);
  assert.equal(bucketColor(NEUTRAL_BUCKET, DARK).toUpperCase(), DARK.neutral);
  assert.equal(colorForCorr(0, LIGHT).toUpperCase(), LIGHT.neutral);
});

test('each arm reaches its own pole', () => {
  assert.equal(bucketColor(BUCKETS - 1, LIGHT).toUpperCase(), LIGHT.positive);
  assert.equal(bucketColor(0, LIGHT).toUpperCase(), LIGHT.negative);
  assert.equal(bucketColor(BUCKETS - 1, DARK).toUpperCase(), DARK.positive);
  assert.equal(bucketColor(0, DARK).toUpperCase(), DARK.negative);
});

// The real check for a diverging ramp is lightness monotonicity per arm —
// the categorical CVD validator fails such ramps by design.
for (const [name, poles, direction] of [
  ['light', LIGHT, 'darker'],
  ['dark', DARK, 'lighter'],
] as const) {
  test(`${name} mode: both arms move monotonically ${direction} from the midpoint`, () => {
    const sign = direction === 'darker' ? -1 : 1;
    for (const arm of ['positive', 'negative'] as const) {
      let prev = luminance(bucketColor(NEUTRAL_BUCKET, poles));
      for (let step = 1; step <= NEUTRAL_BUCKET; step++) {
        const bucket = arm === 'positive' ? NEUTRAL_BUCKET + step : NEUTRAL_BUCKET - step;
        const lum = luminance(bucketColor(bucket, poles));
        assert.ok(
          sign * (lum - prev) > 0,
          `${name}/${arm} arm not monotonic at step ${step}: ${prev} → ${lum}`,
        );
        prev = lum;
      }
    }
  });
}

test('bucketColor clamps buckets outside the scale', () => {
  assert.equal(bucketColor(-3, LIGHT), bucketColor(0, LIGHT));
  assert.equal(bucketColor(999, LIGHT), bucketColor(BUCKETS - 1, LIGHT));
});

test('cellAt maps cell centres back to their own row and column', () => {
  const size = 7.2;
  const n = 50;
  for (const i of [0, 1, 17, 49]) {
    for (const j of [0, 25, 49]) {
      const hit = cellAt((j + 0.5) * size, (i + 0.5) * size, size, n);
      assert.deepEqual(hit, { row: i, col: j });
    }
  }
});

test('cellAt clamps touches outside the matrix', () => {
  const size = 7.2;
  const n = 50;
  assert.deepEqual(cellAt(-40, -40, size, n), { row: 0, col: 0 });
  assert.deepEqual(cellAt(99999, 99999, size, n), { row: n - 1, col: n - 1 });
});
