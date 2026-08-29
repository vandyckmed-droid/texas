import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const T = require('../trend.js');

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel: string) => JSON.parse(readFileSync(join(repo, rel), 'utf8'));

/** Exactly `n` closes on a clean exponential with the given per-day log slope. */
const exact = (n: number, dailyLogSlope: number, start = 100) =>
  Array.from({ length: n }, (_, i) => start * Math.exp(dailyLogSlope * i));

// ---------- the fit ----------

test('recovers a known slope from a clean exponential', () => {
  const daily = 0.002; // 0.2% per day in log terms
  const ch = T.channel(exact(252, daily));
  assert.ok(Math.abs(ch.slope - daily) < 1e-12);
  assert.ok(Math.abs(ch.slopeAnnualised - daily * 252) < 1e-10);
});

test('an exact exponential has no residual channel, so z is null not enormous', () => {
  // sigma is float noise (~1e-15) here. Dividing by it would yield a finite but
  // meaningless z, which is exactly what the epsilon guard exists to prevent.
  const ch = T.channel(exact(252, 0.002));
  assert.ok(ch.sigma < T.EPS, `sigma ${ch.sigma} should be below the epsilon`);
  assert.equal(ch.z, null);
  assert.ok(ch.r2 > 0.999999, 'a perfect fit still reports R² ≈ 1');
});

test('a flat series has no variance to explain, so R² is null and z is null', () => {
  const ch = T.channel(Array.from({ length: 252 }, () => 50));
  assert.equal(ch.slope, 0);
  assert.equal(ch.r2, null);
  assert.equal(ch.z, null);
});

test('a planted endpoint deviation lands where it was planted', () => {
  // Clean trend, then push the final close down by a known multiple of the
  // series' own residual scale and check z reports roughly that.
  const base = exact(252, 0.001);
  const noisy = base.map((v, i) => v * Math.exp(Math.sin(i / 7) * 0.05));
  const before = T.channel(noisy);
  const pushed = noisy.slice();
  pushed[pushed.length - 1] = pushed[pushed.length - 1] * Math.exp(-2 * before.sigma);
  const after = T.channel(pushed);
  assert.ok(after.z < before.z - 1.5, `z should fall by roughly 2σ: ${before.z} -> ${after.z}`);
});

test('sign of z distinguishes above from below the fitted line', () => {
  const base = exact(252, 0.001);
  const up = base.slice();
  up[up.length - 1] *= 1.15;
  const down = base.slice();
  down[down.length - 1] *= 0.85;
  assert.ok(T.channel(up).z > 0);
  assert.ok(T.channel(down).z < 0);
});

// ---------- window and guards ----------

test('requires the full window rather than fitting whatever is available', () => {
  assert.equal(T.channel(exact(251, 0.001)), null);
  assert.ok(T.channel(exact(252, 0.001)) !== null);
  assert.equal(T.channel([]), null);
  assert.equal(T.channel(null), null);
});

test('uses the last n closes, ignoring anything earlier', () => {
  const tail = exact(252, 0.003);
  const withPrefix = [...exact(100, -0.02, 5), ...tail];
  const a = T.channel(tail);
  const b = T.channel(withPrefix);
  assert.ok(Math.abs(a.slope - b.slope) < 1e-12);
  assert.equal(a.n, 252);
  assert.equal(b.n, 252);
});

test('a non-positive close is rejected rather than producing NaN', () => {
  const bad = exact(252, 0.001);
  bad[10] = 0;
  assert.equal(T.channel(bad), null);
  bad[10] = -5;
  assert.equal(T.channel(bad), null);
});

test('a custom window length is honoured', () => {
  const ch = T.channel(exact(300, 0.001), 60);
  assert.equal(ch.n, 60);
});

// ---------- fitted line and fit quality ----------

test('fittedAt walks the centre line and offsets by whole sigma', () => {
  const noisy = exact(252, 0.001).map((v, i) => v * Math.exp(Math.cos(i / 5) * 0.04));
  const ch = T.channel(noisy);
  assert.ok(Math.abs(T.fittedAt(ch, 0, 0) - ch.intercept) < 1e-12);
  assert.ok(Math.abs(T.fittedAt(ch, 10, 0) - (ch.intercept + ch.slope * 10)) < 1e-12);
  assert.ok(Math.abs(T.fittedAt(ch, 10, 2) - (T.fittedAt(ch, 10, 0) + 2 * ch.sigma)) < 1e-12);
});

test('isWeak flags an unfittable channel so noise cannot read as signal', () => {
  assert.equal(T.isWeak(null), true);
  assert.equal(T.isWeak({ r2: null }), true);
  assert.equal(T.isWeak({ r2: 0.05 }), true);
  assert.equal(T.isWeak({ r2: T.WEAK_R2 }), false);
  assert.equal(T.isWeak({ r2: 0.9 }), false);
});

// ---------- marker precedence ----------

/**
 * Trust gates salience. These assert the precedence is strict: a weak fit is
 * quiet however extreme its z, because that z is not interpretable. Getting
 * this backwards would give the least meaningful names the loudest marks.
 */
test('a weak fit stays quiet however extreme its z', () => {
  assert.equal(T.marker({ r2: 0.05, z: 2.7 }), 'weak');
  assert.equal(T.marker({ r2: 0.02, z: -4.0 }), 'weak');
  assert.equal(T.marker({ r2: 0.0, z: 3.1 }), 'weak');
});

test('a trustworthy fit is emphasised only past the FAR threshold', () => {
  assert.equal(T.marker({ r2: 0.9, z: 2.7 }), 'far');
  assert.equal(T.marker({ r2: 0.9, z: -2.7 }), 'far');
  assert.equal(T.marker({ r2: 0.9, z: T.FAR }), 'far', 'the threshold is inclusive');
  assert.equal(T.marker({ r2: 0.9, z: 1.99 }), 'near');
  assert.equal(T.marker({ r2: 0.9, z: 0 }), 'near');
});

test('an absent or unscorable channel is weak, not near', () => {
  assert.equal(T.marker(null), 'weak');
  assert.equal(T.marker(undefined), 'weak');
  assert.equal(T.marker({ r2: 0.9, z: null }), 'weak');
  assert.equal(T.marker({ r2: null, z: 1 }), 'weak');
});

test('the marker split over the snapshot, and every weak-and-extreme name', () => {
  const rankings = readJson('data/rankings.json');
  const counts: Record<string, number> = { near: 0, far: 0, weak: 0 };
  const weakAndExtreme: string[] = [];
  for (const s of rankings.stocks as { symbol: string; fileKey: string }[]) {
    const ch = T.channel(readJson(`data/charts/${s.fileKey}.json`).c);
    const m = T.marker(ch);
    counts[m]++;
    if (T.isWeak(ch) && Math.abs(ch.z) >= T.FAR) {
      weakAndExtreme.push(s.symbol);
      // The rule that matters: extreme but untrustworthy must not be emphasised.
      assert.equal(m, 'weak', `${s.symbol} (z ${ch.z}, R2 ${ch.r2}) must stay quiet`);
    }
  }
  assert.deepEqual(counts, { near: 293, far: 88, weak: 119 });
  assert.equal(weakAndExtreme.length, 18);
  // Named so a data refresh that changes the picture is visible in the diff.
  for (const sym of ['V', 'NWS', 'NWSA', 'ADP', 'PAYX', 'LH']) {
    assert.ok(weakAndExtreme.includes(sym), `${sym} should be weak-and-extreme`);
  }
});

// ---------- cross-check against an independent implementation ----------

/**
 * These figures come from a separate Python implementation run over the same
 * committed data before any of this was written. Agreement to three decimals
 * across two very different names is what says the JS is right, rather than
 * merely self-consistent.
 */
test('reproduces an independently computed channel on real committed data', () => {
  const rankings = readJson('data/rankings.json');
  const fileKeyOf = new Map<string, string>(
    rankings.stocks.map((s: { symbol: string; fileKey: string }) => [s.symbol, s.fileKey]),
  );
  const closesOf = (sym: string) => readJson(`data/charts/${fileKeyOf.get(sym)}.json`).c;

  const amat = T.channel(closesOf('AMAT'));
  assert.ok(Math.abs(amat.z - -3.06) < 5e-3, `AMAT z ${amat.z}`);
  assert.ok(Math.abs(amat.r2 - 0.93) < 5e-3, `AMAT r2 ${amat.r2}`);
  assert.ok(Math.abs(amat.slopeAnnualised - 1.242) < 5e-3, `AMAT slope ${amat.slopeAnnualised}`);

  const mrna = T.channel(closesOf('MRNA'));
  assert.ok(Math.abs(mrna.z - 2.93) < 5e-3, `MRNA z ${mrna.z}`);
  assert.ok(Math.abs(mrna.r2 - 0.80) < 5e-3, `MRNA r2 ${mrna.r2}`);

  // The caveat the display exists to handle: a real name whose channel is noise.
  const bby = T.channel(closesOf('BBY'));
  assert.ok(bby.r2 < 0.05, `BBY r2 ${bby.r2}`);
  assert.equal(T.isWeak(bby), true);
});

test('every ranked name in the snapshot produces a finite channel', () => {
  const rankings = readJson('data/rankings.json');
  let computed = 0;
  let minSigma = Infinity;
  for (const s of rankings.stocks as { fileKey: string }[]) {
    const ch = T.channel(readJson(`data/charts/${s.fileKey}.json`).c);
    assert.ok(ch !== null, `${s.fileKey} produced no channel`);
    assert.ok(Number.isFinite(ch.z), `${s.fileKey} produced a non-finite z`);
    assert.ok(Number.isFinite(ch.r2), `${s.fileKey} produced a non-finite r2`);
    minSigma = Math.min(minSigma, ch.sigma);
    computed++;
  }
  assert.equal(computed, rankings.stocks.length);
  // The epsilon must sit far below anything real, or it would silently null out
  // a legitimate channel on a very tightly trending name.
  assert.ok(minSigma > T.EPS * 1e6, `smallest real sigma ${minSigma} is too close to the epsilon`);
});
