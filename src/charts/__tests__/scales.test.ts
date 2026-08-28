import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  barForX,
  barForXLine,
  LINE_POINTS,
  padDomain,
  resampleToN,
  windowBars,
  xForBar,
  type ChartFrame,
} from '../scales.ts';

const frame: ChartFrame = { width: 400, height: 200, labelGutter: 40, padTop: 8, padBottom: 8 };
const PLOT_W = 360; // width − labelGutter

test('resampleToN preserves endpoints and length', () => {
  const out = resampleToN([10, 20, 30, 40], 7);
  assert.equal(out.length, 7);
  assert.equal(out[0], 10);
  assert.equal(out[out.length - 1], 40);
});

test('resampleToN reproduces the input exactly when n equals m', () => {
  const input = [3, 1, 4, 1, 5, 9];
  const out = resampleToN(input, input.length);
  out.forEach((v, i) => assert.ok(Math.abs(v - input[i]) < 1e-12));
});

test('resampleToN interpolates a linear series linearly', () => {
  // f(t) = 100 + 10t over t = 0..10 → upsampled samples stay on the line.
  const input = Array.from({ length: 11 }, (_, t) => 100 + 10 * t);
  const out = resampleToN(input, 21);
  out.forEach((v, i) => assert.ok(Math.abs(v - (100 + 10 * (i / 2))) < 1e-9));
});

test('resampleToN handles degenerate inputs', () => {
  assert.deepEqual(resampleToN([], 3), [0, 0, 0]);
  assert.deepEqual(resampleToN([7], 3), [7, 7, 7]);
});

test('LINE_POINTS covers the chart bar cap so no window is downsampled', () => {
  // scripts/refresh.ts emits at most 253 bars per chart.
  assert.ok(LINE_POINTS >= 253);
});

test('padDomain pads symmetrically and guards zero span', () => {
  const [lo, hi] = padDomain(0, 100, 0.1);
  assert.ok(Math.abs(lo - -10) < 1e-9);
  assert.ok(Math.abs(hi - 110) < 1e-9);
  const [zlo, zhi] = padDomain(50, 50);
  assert.ok(zhi > zlo, 'zero span must still yield a usable domain');
});

test('windowBars clamps to available history', () => {
  assert.equal(windowBars('1M', 253), 21);
  assert.equal(windowBars('3M', 253), 63);
  assert.equal(windowBars('6M', 253), 126);
  assert.equal(windowBars('12M', 253), 253);
  assert.equal(windowBars('6M', 40), 40, 'short history caps the window');
});

test('barForX round-trips the bar-centre layout it inverts', () => {
  const n = 21;
  for (let i = 0; i < n; i++) {
    assert.equal(barForX(xForBar(i, n, frame), n, frame), i);
  }
});

test('barForXLine round-trips the edge-to-edge layout the line chart draws', () => {
  const n = 21;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * PLOT_W;
    assert.equal(barForXLine(x, n, frame), i);
  }
});

test('the two inverses genuinely disagree, so the line chart needs its own', () => {
  // The bug this guards: using the bar-centre inverse on the edge-to-edge line
  // layout skews the hairline by up to half a slot. Scan the plot rather than
  // trusting one hand-picked touch point.
  const n = 21;
  let disagreements = 0;
  for (let px = 0; px <= PLOT_W; px++) {
    if (barForXLine(px, n, frame) !== barForX(px, n, frame)) disagreements++;
  }
  assert.ok(disagreements > 0, 'the layouts must not be interchangeable');
  // Concretely: a touch 9px in resolves to bar 1 edge-to-edge, bar 0 centred.
  assert.equal(barForXLine(9, n, frame), 1);
  assert.equal(barForX(9, n, frame), 0);
  // Endpoints still land on the first and last bar under the line layout.
  assert.equal(barForXLine(0, n, frame), 0);
  assert.equal(barForXLine(PLOT_W, n, frame), n - 1);
});

test('both inverses clamp out-of-range touches', () => {
  const n = 10;
  for (const f of [barForX, barForXLine]) {
    assert.equal(f(-500, n, frame), 0);
    assert.equal(f(99999, n, frame), n - 1);
  }
  assert.equal(barForXLine(123, 1, frame), 0, 'single bar has no span to divide by');
});
