import assert from 'node:assert/strict';
import { test } from 'node:test';
import { realizedVol, VOL_WINDOW } from '../vol.ts';

test('constant series has zero vol', () => {
  assert.equal(realizedVol(new Array(200).fill(50)), 0);
});

test('alternating ±r log returns: vol = r·√(n/(n−1))·√252', () => {
  const r = 0.01;
  const closes = [100];
  for (let i = 0; i < 200; i++) {
    closes.push(closes[closes.length - 1] * Math.exp(i % 2 === 0 ? r : -r));
  }
  // Window of 126 returns alternating ±r: mean 0, sample variance r²·n/(n−1).
  const expected = r * Math.sqrt(VOL_WINDOW / (VOL_WINDOW - 1)) * Math.sqrt(252);
  assert.ok(Math.abs(realizedVol(closes) - expected) < 1e-12);
});

test('short history yields NaN', () => {
  assert.ok(Number.isNaN(realizedVol(new Array(126).fill(50)))); // 125 returns < 126
  assert.ok(!Number.isNaN(realizedVol(new Array(127).fill(50))));
});

test('vol uses only the trailing window', () => {
  const quiet = new Array(300).fill(100);
  const noisyPast = [...quiet];
  for (let i = 0; i < 100; i++) noisyPast[i] = 100 * (1 + (i % 2 ? 0.5 : -0.4));
  assert.equal(realizedVol(noisyPast), realizedVol(quiet));
});
