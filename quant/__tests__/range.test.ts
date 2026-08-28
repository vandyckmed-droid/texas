import assert from 'node:assert/strict';
import { test } from 'node:test';
import { range52w } from '../range.ts';

test('range from intraday extremes over the trailing window', () => {
  const highs = [10, 20, 30, 15];
  const lows = [8, 18, 25, 12];
  const r = range52w(highs, lows, 14, 3); // window covers last 3 bars only
  assert.equal(r.high, 30);
  assert.equal(r.low, 12);
  assert.equal(r.latest, 14);
});

test('window larger than history uses everything', () => {
  const r = range52w([5, 9], [4, 7], 8);
  assert.equal(r.high, 9);
  assert.equal(r.low, 4);
});
