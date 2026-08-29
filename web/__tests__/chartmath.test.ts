import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../chartmath.js');

// ---------- resampling ----------

test('resampleToN preserves endpoints and length', () => {
  const out = M.resampleToN([10, 20, 30, 40], 7);
  assert.equal(out.length, 7);
  assert.equal(out[0], 10);
  assert.equal(out[6], 40);
});

test('resampleToN interpolates linearly at the midpoint', () => {
  const out = M.resampleToN([0, 100], 3);
  assert.deepEqual(out, [0, 50, 100]);
});

test('resampleToN is monotone on monotone input', () => {
  const rising = Array.from({ length: 40 }, (_, i) => i * i);
  const out = M.resampleToN(rising, M.LINE_POINTS);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1]);
});

test('resampleToN handles degenerate inputs without NaN', () => {
  assert.deepEqual(M.resampleToN([], 3), [0, 0, 0]);
  assert.deepEqual(M.resampleToN([7], 3), [7, 7, 7]);
});

test('every window resamples to the same point count, so windows interpolate', () => {
  // The line morph interpolates point-for-point between two windows; it is
  // only valid because both sides always have exactly LINE_POINTS points.
  const series = Array.from({ length: 253 }, (_, i) => 100 + Math.sin(i / 9) * 5);
  const counts = Object.keys(M.WINDOWS).map((key) => {
    const n = M.windowBars(key, series.length);
    return M.resampleToN(series.slice(series.length - n), M.LINE_POINTS).length;
  });
  assert.deepEqual(counts, counts.map(() => M.LINE_POINTS));
});

// ---------- windows ----------

test('windowBars clamps to the bars actually available', () => {
  assert.equal(M.windowBars('1M', 253), 21);
  assert.equal(M.windowBars('3M', 253), 63);
  assert.equal(M.windowBars('6M', 253), 126);
  assert.equal(M.windowBars('12M', 253), 253);
  // A recent listing with a short history shows what it has, never more.
  assert.equal(M.windowBars('6M', 40), 40);
  assert.equal(M.windowBars('12M', 40), 40);
});

// ---------- domain padding ----------

test('padDomain widens the range and keeps it ordered', () => {
  const [lo, hi] = M.padDomain(100, 200);
  assert.ok(lo < 100);
  assert.ok(hi > 200);
  assert.ok(hi > lo);
});

test('padDomain gives a flat series a non-zero span', () => {
  const [lo, hi] = M.padDomain(50, 50);
  assert.ok(hi > lo, 'a flat line must not divide by a zero span');
});

// ---------- colour ----------

test('toRgb reads hex and rgb() alike', () => {
  assert.deepEqual(M.toRgb('#00D264'), [0, 210, 100]);
  assert.deepEqual(M.toRgb('rgb(0, 210, 100)'), [0, 210, 100]);
});

test('lerpColor hits both endpoints exactly', () => {
  assert.equal(M.lerpColor('#000000', '#FFFFFF', 0), 'rgb(0,0,0)');
  assert.equal(M.lerpColor('#000000', '#FFFFFF', 1), 'rgb(255,255,255)');
});

test('withAlpha keeps the channels and applies the alpha', () => {
  assert.equal(M.withAlpha('#00D264', 0.18), 'rgba(0,210,100,0.18)');
});

// ---------- correlation buckets ----------

test('bucketFor maps the correlation range onto the full bucket range', () => {
  assert.equal(M.bucketFor(-1), 0);
  assert.equal(M.bucketFor(0), M.NEUTRAL);
  assert.equal(M.bucketFor(1), M.BUCKETS - 1);
});

test('bucketFor clamps out-of-range and non-finite input', () => {
  assert.equal(M.bucketFor(-4), 0);
  assert.equal(M.bucketFor(4), M.BUCKETS - 1);
  assert.equal(M.bucketFor(NaN), M.NEUTRAL);
});

test('bucketFor is monotone across the range', () => {
  let prev = -1;
  for (let r = -1; r <= 1.0001; r += 0.05) {
    const b = M.bucketFor(r);
    assert.ok(b >= prev, `bucket fell at r=${r.toFixed(2)}`);
    prev = b;
  }
});

test('the neutral bucket is the neutral colour, not a weak pole', () => {
  // An odd bucket count exists precisely so zero correlation reads as ground.
  assert.equal(M.bucketColor(M.NEUTRAL, '#EEF0F3', '#1F5FA8', '#B75A17'), 'rgb(238,240,243)');
});

test('bucket colours run to the correct pole on each arm', () => {
  assert.equal(M.bucketColor(M.BUCKETS - 1, '#EEF0F3', '#1F5FA8', '#B75A17'), 'rgb(31,95,168)');
  assert.equal(M.bucketColor(0, '#EEF0F3', '#1F5FA8', '#B75A17'), 'rgb(183,90,23)');
});

test('bucketColor clamps a bucket index outside the scale', () => {
  const top = M.bucketColor(M.BUCKETS - 1, '#EEF0F3', '#1F5FA8', '#B75A17');
  assert.equal(M.bucketColor(99, '#EEF0F3', '#1F5FA8', '#B75A17'), top);
});

// ---------- last-session move ----------

test('dayChange is the final close against the one before it', () => {
  assert.ok(Math.abs(M.dayChange([100, 110]) - 0.1) < 1e-12);
  assert.ok(Math.abs(M.dayChange([50, 40, 100, 90]) - -0.1) < 1e-12);
});

test('dayChange ignores everything before the last two closes', () => {
  const noise = Array.from({ length: 250 }, (_, i) => 10 + i * 3);
  assert.equal(M.dayChange([...noise, 200, 210]), M.dayChange([200, 210]));
});

test('dayChange is undefined without a prior close to compare against', () => {
  assert.equal(M.dayChange([100]), null);
  assert.equal(M.dayChange([]), null);
  assert.equal(M.dayChange(null), null);
});

test('dayChange refuses to divide by a zero prior close', () => {
  assert.equal(M.dayChange([0, 100]), null);
});

test('dayChange is zero, not null, on an unchanged session', () => {
  // Distinct outcomes: "flat" must render as 0.00%, "unknown" must render as nothing.
  assert.equal(M.dayChange([250, 250]), 0);
});
