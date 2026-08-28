import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rollingDisplaySeries, squash, type DatedCloses } from '../rolling.ts';

test('squash: odd, monotone, bounded in (−2, 2), ~identity near zero', () => {
  assert.equal(squash(0), 0);
  assert.equal(squash(1.3), -squash(-1.3));
  assert.ok(squash(0.5) < squash(1) && squash(1) < squash(3));
  // Mathematically bounded to (−2, 2); float64 tanh saturates to exactly ±1.
  assert.ok(squash(50) <= 2 && squash(-50) >= -2);
  assert.ok(squash(5) < 2 && squash(-5) > -2);
  assert.ok(Math.abs(squash(0.1) - 0.1) < 0.001);
});

const isoDates = (n: number): string[] => {
  // Weekday-only synthetic calendar starting 2024-01-01.
  const out: string[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

const growthStock = (dates: string[], g: number): DatedCloses => ({
  dates,
  closes: dates.map((_, t) => 100 * Math.exp(g * t)),
});

test('cross-sectional ordering preserved and values bounded', () => {
  const dates = isoDates(300);
  const series = new Map<string, DatedCloses>([
    ['HI', growthStock(dates, 0.002)],
    ['MID', growthStock(dates, 0.0005)],
    ['LO', growthStock(dates, -0.001)],
  ]);
  const anchors = [dates[280], dates[290], dates[299]];
  const out = rollingDisplaySeries(series, anchors);
  for (let a = 0; a < anchors.length; a++) {
    const hi = out.get('HI')![a]!;
    const mid = out.get('MID')![a]!;
    const lo = out.get('LO')![a]!;
    assert.ok(hi > mid && mid > lo, 'ordering preserved');
    for (const v of [hi, mid, lo]) assert.ok(v > -2 && v < 2, 'bounded');
  }
});

test('short history at early anchors yields null, fills in later', () => {
  const dates = isoDates(320);
  const late = { dates: dates.slice(60), closes: dates.slice(60).map((_, t) => 100 + t) };
  const series = new Map<string, DatedCloses>([
    ['FULL', growthStock(dates, 0.001)],
    ['FULL2', growthStock(dates, -0.001)],
    ['LATE', late],
  ]);
  // At anchor dates[300], LATE has 241 bars (< 253) → null; at dates[319] it has 260 → value.
  const out = rollingDisplaySeries(series, [dates[300], dates[319]]);
  assert.equal(out.get('LATE')![0], null);
  assert.ok(typeof out.get('LATE')![1] === 'number');
  assert.ok(typeof out.get('FULL')![0] === 'number');
});

test('anchor before all data yields null for everyone', () => {
  const dates = isoDates(300);
  const series = new Map<string, DatedCloses>([['A', growthStock(dates, 0.001)]]);
  const out = rollingDisplaySeries(series, ['2020-01-01']);
  assert.equal(out.get('A')![0], null);
});
