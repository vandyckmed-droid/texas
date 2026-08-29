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

test('isWeak flags an unfittable channel so noise cannot read as signal', () => {
  assert.equal(T.isWeak(null), true);
  assert.equal(T.isWeak({ r2: null }), true);
  assert.equal(T.isWeak({ r2: 0.05 }), true);
  assert.equal(T.isWeak({ r2: T.WEAK_R2 }), false);
  assert.equal(T.isWeak({ r2: 0.9 }), false);
});

// ---------- zones ----------

/**
 * The boundary table, driven exactly. Getting a comparison backwards here would
 * paint a pullback as extended, which is the mistake this scheme exists to fix.
 */
test('the zone boundaries are exactly where they are specified', () => {
  const fit = (z: number) => ({ r2: 0.9, z });
  assert.equal(T.zone(fit(-2.01)), '', 'past -2 sigma is too far below to read');
  assert.equal(T.zone(fit(-2)), 'buy', 'the outer edge is inclusive');
  assert.equal(T.zone(fit(-1.2)), 'buy');
  assert.equal(T.zone(fit(-0.51)), 'buy');
  assert.equal(T.zone(fit(-0.5)), '', 'the inner edge is exclusive');
  assert.equal(T.zone(fit(0)), '');
  assert.equal(T.zone(fit(0.5)), '');
  assert.equal(T.zone(fit(0.51)), 'extended');
  assert.equal(T.zone(fit(2)), 'extended', 'the outer edge is inclusive');
  assert.equal(T.zone(fit(2.01)), '', 'past +2 sigma is too far above to read');
});

test('the scale is symmetric about the trend line', () => {
  for (const z of [0.4, 0.6, 1.5, 2.0, 2.5, 3.4]) {
    const lo = T.zone({ r2: 0.9, z: -z });
    const hi = T.zone({ r2: 0.9, z });
    assert.equal(lo === '', hi === '', `|z| ${z} should be neutral on both sides or neither`);
  }
});

test('a weak fit is neutral wherever it sits', () => {
  assert.equal(T.zone({ r2: 0.05, z: -1.2 }), '', 'even squarely in the buy band');
  assert.equal(T.zone({ r2: 0.02, z: 1.5 }), '');
  assert.equal(T.zone({ r2: T.WEAK_R2 - 0.001, z: -1 }), '');
  assert.equal(T.zone({ r2: T.WEAK_R2, z: -1 }), 'buy', 'the threshold itself is readable');
});

test('an absent or unscorable channel is neutral', () => {
  assert.equal(T.zone(null), '');
  assert.equal(T.zone(undefined), '');
  assert.equal(T.zone({ r2: 0.9, z: null }), '');
  assert.equal(T.zone({ r2: null, z: -1 }), '');
});

test('the buy zone over the snapshot, and no weak fit inside it', () => {
  const rankings = readJson('data/rankings.json');
  const zoneOf = new Map<string, string>();
  const chOf = new Map<string, { z: number; r2: number }>();
  for (const s of rankings.stocks as { symbol: string; fileKey: string }[]) {
    const ch = T.channel(readJson(`data/charts/${s.fileKey}.json`).c);
    chOf.set(s.symbol, ch);
    zoneOf.set(s.symbol, T.zone(ch));
  }
  const top = (key: string) =>
    [...(rankings.stocks as Record<string, never>[])]
      .sort((a, b) => (a[key] as unknown as number) - (b[key] as unknown as number))
      .slice(0, 50) as unknown as { symbol: string }[];

  const buyIn = (key: string) => top(key).filter((s) => zoneOf.get(s.symbol) === 'buy');
  assert.equal(buyIn('rankBlended').length, 14);
  assert.equal(buyIn('rankVolAdj').length, 15);

  // The override that keeps an unreadable channel out of a buy list.
  for (const [sym, z] of zoneOf) {
    if (z !== '') assert.equal(T.isWeak(chOf.get(sym)), false, `${sym} is weak but coloured ${z}`);
  }

  // Every buy-zone name really is below its own trend, never above it.
  for (const [sym, z] of zoneOf) {
    if (z === 'buy') assert.ok(chOf.get(sym)!.z < 0, `${sym} is in the buy zone but above trend`);
    if (z === 'extended') assert.ok(chOf.get(sym)!.z > 0, `${sym} is extended but below trend`);
  }
});

// ---------- trend acceleration ----------

/** Deterministic iid noise, so "no acceleration" can be tested without a seed. */
const lcg = (seed: number) => {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296 - 0.5; };
};
const drift = (seed: number, slope: number, amp: number, n = 260) => {
  const r = lcg(seed);
  return Array.from({ length: n }, (_, i) => 100 * Math.exp(slope * i + r() * amp));
};
const accelOf = (closes: number[]) => T.acceleration(closes, T.channel(closes));

test('a constant slope produces no acceleration on average', () => {
  const vals: number[] = [];
  for (let seed = 1; seed <= 200; seed++) {
    const a = accelOf(drift(seed, 0.001, 0.06));
    if (a !== null) vals.push(a);
  }
  assert.equal(vals.length, 200);
  const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
  assert.ok(Math.abs(mean) < 0.1, `unbiased on a constant slope, got mean ${mean}`);
  // The dead band is set at roughly the one-sigma noise level of this case.
  const sd = Math.sqrt(vals.reduce((s2, x) => s2 + (x - mean) ** 2, 0) / vals.length);
  assert.ok(sd > 0.3 && sd < 0.7, `noise sd ${sd} should bracket ACCEL_FLAT ${T.ACCEL_FLAT}`);
});

test('planted curvature is recovered with the right sign and symmetry', () => {
  const curve = (c: number) =>
    Array.from({ length: 260 }, (_, i) => 100 * Math.exp(0.002 * i + c * i * i));
  const up = accelOf(curve(0.000004));
  const down = accelOf(curve(-0.000004));
  assert.ok(up > 0.5, `upward curvature should read positive, got ${up}`);
  assert.ok(down < -0.5, `downward curvature should read negative, got ${down}`);
  assert.ok(Math.abs(up + down) < 1e-6, 'equal and opposite curvature should mirror');
});

test('acceleration is guarded rather than returning nonsense', () => {
  // An exact exponential has no scatter to normalise by.
  assert.equal(accelOf(Array.from({ length: 260 }, (_, i) => 100 * Math.exp(0.002 * i))), null);
  assert.equal(T.acceleration(drift(1, 0.001, 0.06), null), null);
  // Needs the full slow window.
  const short = drift(1, 0.001, 0.06, T.SLOW - 1);
  assert.equal(T.acceleration(short, { sigma: 0.1, slope: 0 }), null);
  assert.ok(T.acceleration(drift(1, 0.001, 0.06, T.SLOW), { sigma: 0.1, slope: 0 }) !== null);
});

test('accelZone has a dead band and is monotonic outside it', () => {
  assert.equal(T.accelZone(T.ACCEL_FLAT + 0.001), 'improving');
  assert.equal(T.accelZone(T.ACCEL_FLAT), '', 'the band edge is neutral');
  assert.equal(T.accelZone(0), '');
  assert.equal(T.accelZone(-T.ACCEL_FLAT), '');
  assert.equal(T.accelZone(-T.ACCEL_FLAT - 0.001), 'worsening');
  // Unlike zone(), the extremes stay coloured — the strongest readings are the
  // most stable ones, so there is no "too far to read" case here.
  assert.equal(T.accelZone(12), 'improving');
  assert.equal(T.accelZone(-12), 'worsening');
  assert.equal(T.accelZone(null), '');
  assert.equal(T.accelZone(undefined), '');
});

test('phase names all four states plus the steady middle', () => {
  const rise = { slope: 0.001 }, fall = { slope: -0.001 };
  assert.equal(T.phase(rise, 2), 'rising, accelerating');
  assert.equal(T.phase(rise, -2), 'rising, slowing');
  assert.equal(T.phase(fall, 2), 'falling, improving');
  assert.equal(T.phase(fall, -2), 'falling, worsening');
  assert.equal(T.phase(rise, 0), 'rising, steady');
  assert.equal(T.phase(fall, 0), 'falling, steady');
  assert.equal(T.phase(null, 2), '');
  assert.equal(T.phase(rise, null), '');
});

/**
 * The windows are 42/126 on measurement, not taste. This pins the evidence:
 * recompute every name with the last five sessions withheld, holding the
 * normalising sigma fixed, and require the verdict to hold. At 21/63 the same
 * check yields 26.4% and 13 — so the window cannot be changed back unnoticed.
 */
test('the window choice keeps the signal stable over five sessions', () => {
  const rankings = readJson('data/rankings.json');
  const now: number[] = [];
  const prev: number[] = [];
  for (const s of rankings.stocks as { fileKey: string }[]) {
    const c = readJson(`data/charts/${s.fileKey}.json`).c as number[];
    const ch = T.channel(c);
    const a = T.acceleration(c, ch);
    if (a === null) continue;
    const held = c.slice(0, -5);
    const f = T.channel(held, T.FAST), sl = T.channel(held, T.SLOW);
    now.push(a);
    prev.push(((f.slope - sl.slope) * T.FAST) / ch.sigma);
  }
  assert.equal(now.length, 500);
  const flips = now.filter((v, i) => Math.sign(v) !== Math.sign(prev[i])).length;
  assert.ok(flips / now.length <= 0.10, `${flips} of ${now.length} reversed in five sessions`);

  // The names it is loudest about must not reverse at all.
  const cut = now.map(Math.abs).sort((x, y) => y - x)[Math.floor(now.length * 0.25)];
  const loud = now.map((_, i) => i).filter((i) => Math.abs(now[i]) >= cut);
  const loudFlips = loud.filter((i) => Math.sign(now[i]) !== Math.sign(prev[i]));
  assert.equal(loudFlips.length, 0, 'a strong reading must not reverse within a week');
});

test('acceleration is its own axis, and splits the buy zone', () => {
  const rankings = readJson('data/rankings.json');
  const rows = (rankings.stocks as { symbol: string; fileKey: string; rankBlended: number;
    vol: number; m6: number; m12: number }[]).map((s) => {
    const c = readJson(`data/charts/${s.fileKey}.json`).c as number[];
    const ch = T.channel(c);
    return { ...s, ch, a: T.acceleration(c, ch) as number, z: ch.z as number };
  });
  const corr = (a: number[], b: number[]) => {
    const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sa += da * da; sb += db * db; sab += da * db; }
    return sab / Math.sqrt(sa * sb);
  };
  const acc = rows.map((r) => r.a);
  // Volatility-neutral by construction of the normalisation, and not a
  // restatement of the 6-1 vs 12-1 bar that is already on the ranking rows.
  assert.ok(Math.abs(corr(acc, rows.map((r) => r.vol))) < 0.05);
  assert.ok(Math.abs(corr(acc, rows.map((r) => r.m6 - r.m12))) < 0.15);

  // The justification for the feature: inside the buy zone, where the decision
  // is made, the dots look alike and the acceleration does not.
  const buy = rows.filter((r) => r.rankBlended <= 50 && T.zone(r.ch) === 'buy');
  assert.equal(buy.length, 14);
  const spread = Math.max(...buy.map((r) => r.a)) - Math.min(...buy.map((r) => r.a));
  assert.ok(spread > 4, `buy-zone acceleration should spread widely, got ${spread}`);
  assert.ok(Math.abs(corr(buy.map((r) => r.z), buy.map((r) => r.a))) < 0.3,
    'inside the buy zone, position and acceleration must stay independent');
});

// ---------- plain language ----------

/**
 * The ticker screen leads with these phrases, so their boundaries are what a
 * reader actually acts on. They must agree with zone()/accelZone rather than
 * drifting into a second, softer set of thresholds.
 */
test('positionLabel walks the channel and agrees with zone()', () => {
  const at = (z: number) => T.positionLabel({ r2: 0.9, z });
  assert.equal(at(-3), 'Far below trend');
  assert.equal(at(-2.01), 'Far below trend');
  assert.equal(at(-2), 'Pulled back');
  assert.equal(at(-0.51), 'Pulled back');
  assert.equal(at(-0.5), 'At its trend');
  assert.equal(at(0), 'At its trend');
  assert.equal(at(0.5), 'At its trend');
  assert.equal(at(0.51), 'Extended');
  assert.equal(at(2), 'Extended');
  assert.equal(at(2.01), 'Far above trend');
  // Every phrase the coloured zones claim must match the zone itself.
  for (const z of [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3]) {
    const ch = { r2: 0.9, z };
    if (T.zone(ch) === 'buy') assert.equal(T.positionLabel(ch), 'Pulled back');
    if (T.zone(ch) === 'extended') assert.equal(T.positionLabel(ch), 'Extended');
  }
});

test('a fit too weak to read says so instead of naming a position', () => {
  // V sits +2.24 sigma out on an R2 of 0.02: "Far above trend" would be a lie.
  assert.equal(T.positionLabel({ r2: 0.02, z: 2.24 }), 'No clear trend');
  assert.equal(T.positionLabel({ r2: 0.05, z: -1.2 }), 'No clear trend');
  assert.equal(T.positionLabel(null), 'No clear trend');
  assert.equal(T.positionLabel({ r2: 0.9, z: null }), 'No clear trend');
});

test('changeLabel has five bands and is symmetric about stable', () => {
  const at = (a: number | null) => T.changeLabel(a);
  assert.equal(at(0), 'Stable');
  assert.equal(at(T.ACCEL_FLAT), 'Stable');
  assert.equal(at(-T.ACCEL_FLAT), 'Stable');
  assert.equal(at(T.ACCEL_FLAT + 0.01), 'Strengthening');
  assert.equal(at(T.ACCEL_STRONG), 'Strengthening');
  assert.equal(at(T.ACCEL_STRONG + 0.01), 'Strengthening fast');
  assert.equal(at(-T.ACCEL_FLAT - 0.01), 'Slowing');
  assert.equal(at(-T.ACCEL_STRONG), 'Slowing');
  assert.equal(at(-T.ACCEL_STRONG - 0.01), 'Slowing sharply');
  assert.equal(at(null), '\u2014');
  // A phrase must never contradict the colour beside it.
  for (const a of [-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4]) {
    if (T.accelZone(a) === 'improving') assert.ok(at(a).startsWith('Strengthening'));
    if (T.accelZone(a) === 'worsening') assert.ok(at(a).startsWith('Slowing'));
    if (T.accelZone(a) === '') assert.equal(at(a), 'Stable');
  }
});

test('the five bands each carry a real share of the universe', () => {
  const rankings = readJson('data/rankings.json');
  const counts: Record<string, number> = {};
  for (const s of rankings.stocks as { fileKey: string }[]) {
    const c = readJson(`data/charts/${s.fileKey}.json`).c as number[];
    const label = T.changeLabel(T.acceleration(c, T.channel(c)));
    counts[label] = (counts[label] || 0) + 1;
  }
  assert.deepEqual(counts, {
    'Slowing sharply': 127, Slowing: 81, Stable: 81,
    Strengthening: 97, 'Strengthening fast': 114,
  });
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
