/**
 * The TradingView chart: lifetime, gestures and axis scaling.
 *
 * Ported from the `tv`, `gestures` and `axis` driven suites. Every check here
 * guards a regression that actually shipped:
 *
 *   - the chart owns a ResizeObserver and document listeners that dropping its
 *     container does not release, so every chevron press leaked a chart;
 *   - axis dragging was switched off in code by an option with no recorded
 *     reason;
 *   - the library sets `touch-action` nowhere and relies on the host page, so
 *     the browser claimed pinch as page zoom and the chart never saw it.
 *
 * The library object is frozen — `createChart` is non-writable *and*
 * non-configurable — so a test cannot wrap it to reach the chart instance, and
 * the app is not growing hooks just for tests. These work from what is
 * observable: the source, the DOM, and the rendered axis.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after, before, describe } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launch, open, openTicker, paintedPixels, pixelDiff, repo } from './harness.ts';

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Geometry of the library's own price and time axis cells. */
const axisGeometry = (page: Page) =>
  page.evaluate(() => {
    const table = document.querySelector('.chartwrap table')!;
    const rows = Array.from(table.querySelectorAll('tr'));
    const cells = Array.from(rows[0].querySelectorAll('td'));
    const price = cells[cells.length - 1].getBoundingClientRect();
    const time = rows[rows.length - 1].getBoundingClientRect();
    return {
      priceX: price.x + price.width / 2,
      priceTop: price.y,
      timeX: time.x + 60,
      timeY: time.y + time.height / 2,
    };
  });

/**
 * A screenshot of the price-axis column, re-measured each time.
 *
 * The column's width tracks its widest label, so a fixed clip drifts by a pixel
 * or two between scales. The pointer is parked off-chart first: a crosshair
 * price badge is drawn onto the axis and is not part of the scale.
 */
async function axisStrip(page: Page): Promise<Buffer> {
  await page.mouse.move(4, 4);
  await page.waitForTimeout(220);
  const g = await page.evaluate(() => {
    const table = document.querySelector('.chartwrap table')!;
    const cells = Array.from(table.querySelectorAll('tr')[0].querySelectorAll('td'));
    const a = cells[cells.length - 1].getBoundingClientRect();
    return { x: Math.round(a.x), y: Math.round(a.y), width: Math.ceil(a.width), height: Math.round(a.height) };
  });
  return page.screenshot({ clip: g });
}

describe('chart lifetime', () => {
  test('the library is inlined, not fetched', async () => {
    const s = await open(browser);
    const kind = await s.page.evaluate(() => typeof (window as never as { LightweightCharts: unknown }).LightweightCharts);
    assert.equal(kind, 'object', 'the standalone build should define its global');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('chart state does not leak across navigation', async () => {
    // render() clears #app on every navigation, which does not release the
    // chart's ResizeObserver or its document-level listeners. Without an
    // explicit chart.remove(), the canvas count grows with every chevron.
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const afterFirst = await s.page.evaluate(() => document.querySelectorAll('canvas').length);
    assert.ok(afterFirst > 0, 'the ticker should have canvases');

    for (let i = 0; i < 6; i++) {
      await s.page.locator('.navgrp button').last().click();
      await s.page.waitForTimeout(250);
    }
    const afterSix = await s.page.evaluate(() => document.querySelectorAll('canvas').length);
    assert.ok(afterSix <= afterFirst, `canvases grew from ${afterFirst} to ${afterSix} across six navigations`);

    await s.page.locator('.backbtn').click();
    await s.page.waitForSelector('.row');
    assert.equal(
      await s.page.evaluate(() => document.querySelectorAll('canvas').length),
      0,
      'leaving the ticker should leave no canvas behind',
    );
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('windows and crosshair', () => {
  test('each window button reports its own change', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const seen = new Map<string, string>();
    for (const w of ['1M', '3M', '6M', '12M']) {
      await s.page.locator('.win .seg button', { hasText: new RegExp(`^${w}$`) }).click();
      await s.page.waitForTimeout(350);
      const readout = ((await s.page.locator('.readout').textContent()) ?? '').trim();
      assert.ok(readout.endsWith(`· ${w}`), `readout should name the selected window, got "${readout}"`);
      seen.set(w, readout);
    }
    assert.equal(new Set(seen.values()).size, 4, 'each window should measure a different change');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('hovering the chart dates the readout', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const before = ((await s.page.locator('.readout').textContent()) ?? '').trim();
    const box = (await s.page.locator('.chartwrap').boundingBox())!;
    await s.page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await s.page.waitForTimeout(250);
    const hovered = ((await s.page.locator('.readout').textContent()) ?? '').trim();
    assert.notEqual(hovered, before);
    assert.match(hovered, /^\w{3} \d+, \d{4} ·/, `a hover should lead with the date, got "${hovered}"`);
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('gesture routing', () => {
  test('the chart container claims pinch and horizontal pan, the page keeps vertical', async () => {
    // The library sets touch-action nowhere and relies on the host page. pan-y
    // rather than none: vertical drag belongs to the page, since the chart sits
    // in a scrolling screen and vertTouchDrag is off for the same reason.
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const touchAction = await s.page.evaluate(
      () => getComputedStyle(document.querySelector('.chartwrap')!).touchAction,
    );
    assert.equal(touchAction, 'pan-y');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('axis scaling is not disabled in the app source', async () => {
    // The exact regression: handleScale.axisPressedMouseMove was set to
    // {time:false, price:false}, where both default to true.
    const src = readFileSync(join(repo, 'web', 'app.js'), 'utf8');
    assert.doesNotMatch(src, /axisPressedMouseMove/, 'axis dragging must not be switched off');
  });
});

describe('axis scaling', () => {
  test('dragging an axis rescales it, and re-tapping the window resets it', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const geo = await axisGeometry(s.page);
    const base = await axisStrip(s.page);

    // Stretch the price axis.
    await s.page.mouse.move(geo.priceX, geo.priceTop + 60);
    await s.page.mouse.down();
    await s.page.mouse.move(geo.priceX, geo.priceTop + 200, { steps: 12 });
    await s.page.mouse.up();
    await s.page.waitForTimeout(400);
    const dragged = await axisStrip(s.page);
    const stretched = await pixelDiff(s.page, base, dragged);
    assert.ok(stretched > 0.02, `price-axis drag should rescale the axis (${(stretched * 100).toFixed(1)}% changed)`);

    // A view no button describes must not leave a button claiming it.
    assert.equal(
      await s.page.evaluate(() => document.querySelector('.win .seg button.on')?.textContent ?? null),
      null,
      'the window button should deselect once the view is manual',
    );

    // Re-tapping the current window is the way back — segmented() takes an
    // alwaysFire flag precisely so the selected option can be chosen again.
    await s.page.locator('.win .seg button', { hasText: /^6M$/ }).click();
    await s.page.waitForTimeout(500);
    const reset = await pixelDiff(s.page, base, await axisStrip(s.page));
    assert.ok(
      reset < stretched / 5,
      `tapping the window should restore autoScale (${(reset * 100).toFixed(1)}% vs ${(stretched * 100).toFixed(1)}%)`,
    );
    assert.equal(
      await s.page.evaluate(() => document.querySelector('.win .seg button.on')?.textContent ?? null),
      '6M',
    );
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('the time axis stretches too', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const geo = await axisGeometry(s.page);
    const clip = { x: 0, y: Math.round(geo.timeY - 12), width: 340, height: 24 };
    const before = await s.page.screenshot({ clip });
    await s.page.mouse.move(geo.timeX, geo.timeY);
    await s.page.mouse.down();
    await s.page.mouse.move(geo.timeX + 170, geo.timeY, { steps: 10 });
    await s.page.mouse.up();
    await s.page.waitForTimeout(400);
    await s.page.mouse.move(4, 4);
    await s.page.waitForTimeout(150);
    const changed = await pixelDiff(s.page, before, await s.page.screenshot({ clip }));
    assert.ok(changed > 0.02, `time-axis drag should rescale the range (${(changed * 100).toFixed(1)}%)`);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('a wheel zoom deselects the window and drops the stale label', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    const box = (await s.page.locator('.chartwrap').boundingBox())!;
    await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 5; i++) {
      await s.page.mouse.wheel(0, -120);
      await s.page.waitForTimeout(70);
    }
    await s.page.waitForTimeout(300);
    assert.equal(
      await s.page.evaluate(() => document.querySelector('.win .seg button.on')?.textContent ?? null),
      null,
    );
    const readout = ((await s.page.locator('.readout').textContent()) ?? '').trim();
    assert.doesNotMatch(readout, /· (1M|3M|6M|12M)$/, `readout should not name a window it is no longer showing: "${readout}"`);
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('the removed regression channel overlay', () => {
  test('is gone from the built output', async () => {
    const built = readFileSync(join(repo, 'dist', 'momentum.html'), 'utf8');
    assert.doesNotMatch(built, /drawChannel/);
    assert.doesNotMatch(built, /fittedAt/);
  });
});
