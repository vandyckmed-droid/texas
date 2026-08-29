import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../chartmath.js');

// ---------- resampling ----------

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

test('toRgb reads hex and rgb() alike', () => {
  assert.deepEqual(M.toRgb('#00D264'), [0, 210, 100]);
  assert.deepEqual(M.toRgb('rgb(0, 210, 100)'), [0, 210, 100]);
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
