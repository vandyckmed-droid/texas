/**
 * Screens, navigation and persistence.
 *
 * Ported from the `verify`, `wl`, `impact` and `new` driven suites. The spine
 * of every check is that the page runs without a single uncaught error — the
 * app is one inlined script over a megabyte of data, and a thrown exception
 * halfway through a render leaves a half-drawn screen rather than a crash.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import type { Browser } from 'playwright';
import { launch, open, openTicker, paintedPixels } from './harness.ts';

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

describe('ranks', () => {
  test('loads, paints rows, and raises no page errors', async () => {
    const s = await open(browser);
    const rows = await s.page.locator('.row').count();
    assert.ok(rows > 0, 'ranks should render rows');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('starring a row deep in the list does not move the reader', async () => {
    // A render() rebuilds #app, so the .screen element is new and its scrollTop
    // is zero — starring row 15 used to throw you back to row 1.
    const s = await open(browser);
    await s.page.locator('.screen').evaluate((el) => {
      el.scrollTop = 900;
    });
    const before = await s.page.locator('.screen').evaluate((el) => el.scrollTop);
    assert.ok(before > 0, 'the list must be scrollable for this to mean anything');
    await s.page.locator('.row').nth(14).locator('.star').click();
    const after = await s.page.locator('.screen').evaluate((el) => el.scrollTop);
    assert.equal(after, before, 'scroll jumped when starring');
    assert.equal(await s.page.locator('.row').nth(14).locator('.star.on').count(), 1);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('the watchlist and the row visualisation survive a reload', async () => {
    const s = await open(browser);
    await s.page.locator('.row .star').first().click();
    assert.equal(await s.page.locator('.star.on').count(), 1);
    await s.page.reload({ waitUntil: 'load' });
    await s.page.waitForSelector('.row');
    assert.equal(await s.page.locator('.star.on').count(), 1, 'star did not persist');

    await s.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await s.page.locator('.setrow').nth(1).click();
    await s.page.reload({ waitUntil: 'load' });
    await s.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    assert.equal(await s.page.locator('.setrow.on').count(), 1, 'row visualisation did not persist');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('search', () => {
  test('ranks exact symbol first, then name, and says so when nothing matches', async () => {
    const s = await open(browser);
    await s.page.locator('.hdr .iconbtn').first().click();
    await s.page.waitForSelector('.searchbox');

    await s.page.fill('.searchbox', 'MU');
    const first = await s.page.locator('.row .sym').first().textContent();
    assert.equal(first?.trim(), 'MU', 'an exact symbol match must lead');

    await s.page.fill('.searchbox', 'ford');
    assert.ok((await s.page.locator('.row').count()) > 0, 'company-name search should hit');

    await s.page.fill('.searchbox', 'XYZZY');
    await s.page.waitForSelector('.empty');
    assert.equal(await s.page.locator('.row').count(), 0);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('opens a name from outside the top 50', async () => {
    // Search reaches the whole ranked universe; a name that has fallen out of
    // the ranking is still one you may hold.
    const s = await open(browser);
    await s.page.locator('.hdr .iconbtn').first().click();
    await s.page.waitForSelector('.searchbox');
    await s.page.fill('.searchbox', 'ford');
    await s.page.locator('.row').first().click();
    await s.page.waitForSelector('.chartwrap canvas');
    const meta = await s.page.locator('.hero .meta').textContent();
    const rank = Number(/#(\d+)/.exec(meta ?? '')?.[1]);
    assert.ok(rank > 50, `expected a rank past the top 50, got ${meta}`);
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('watchlist', () => {
  // Concentration is the point of the screen: six names from one block is a
  // very different book from six spread across groups.
  const scenarios: Array<[string, string[]]> = [
    ['one block', ['SNDK', 'MU', 'WDC', 'STX', 'AMD', 'INTC']],
    ['two blocks', ['SNDK', 'MU', 'DELL', 'HPE', 'PANW', 'CRWD']],
    ['spread', ['SNDK', 'DELL', 'PANW', 'GEV', 'HWM']],
    ['a pair', ['SNDK', 'MU']],
  ];

  for (const [name, watch] of scenarios) {
    test(`renders a concentration card for ${name}`, async () => {
      const s = await open(browser, { seed: { watch } });
      await s.page.locator('.tabbar button', { hasText: 'Watchlist' }).click();
      await s.page.waitForSelector('.conc');
      const text = (await s.page.locator('.conc').textContent())?.replace(/\s+/g, ' ').trim() ?? '';
      assert.match(text, /independent bets/, `concentration card missing for ${name}: ${text}`);
      assert.match(text, /avg ρ/, 'the card should report average pairwise correlation');
      assert.equal(await s.page.locator('.row').count(), watch.length);
      assert.deepEqual(s.errors, []);
      await s.close();
    });
  }

  test('a more concentrated book buys fewer independent bets', async () => {
    const bets = async (watch: string[]) => {
      const s = await open(browser, { seed: { watch } });
      await s.page.locator('.tabbar button', { hasText: 'Watchlist' }).click();
      await s.page.waitForSelector('.conc');
      const text = (await s.page.locator('.conc').textContent()) ?? '';
      assert.deepEqual(s.errors, []);
      await s.close();
      return Number(/([\d.]+)/.exec(text)?.[1]);
    };
    const oneBlock = await bets(['SNDK', 'MU', 'WDC', 'STX', 'AMD', 'INTC']);
    const spread = await bets(['SNDK', 'DELL', 'PANW', 'GEV', 'HWM']);
    assert.ok(
      oneBlock < spread,
      `six correlated names should buy fewer bets than five spread ones (${oneBlock} vs ${spread})`,
    );
  });
});

describe('watchlist impact row visualisation', () => {
  test('scores every row against the book you hold', async () => {
    const s = await open(browser, {
      seed: { watch: ['SNDK', 'MU', 'WDC', 'STX', 'AMD', 'INTC'], rowViz: 'impact' },
    });
    const deltas = await s.page.$$eval('.row .delta', (els) => els.slice(0, 14).map((e) => e.textContent ?? ''));
    assert.equal(deltas.length, 14);
    assert.ok(
      deltas.every((d) => /^[+−]?\d|^0\.00$|^·$/.test(d.trim())),
      `every row should carry an impact figure: ${deltas.join(' | ')}`,
    );
    assert.ok(new Set(deltas).size > 1, 'impact should differ between names');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('correlation', () => {
  test('draws the matrix, selects a cell and focuses a cluster', async () => {
    const s = await open(browser);
    await s.page.locator('.hdr .iconbtn').nth(1).click();
    await s.page.waitForSelector('.heatwrap canvas');
    assert.match(
      ((await s.page.locator('.corr-conc').textContent()) ?? '').replace(/\s+/g, ' '),
      /independent bets/,
      'the header should say how many independent bets the top 50 amounts to',
    );
    const box = (await s.page.locator('.heatwrap canvas').boundingBox())!;
    await s.page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await s.page.waitForSelector('.cr-pair');
    await s.page.locator('.card .cardhead').first().click();
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('ticker', () => {
  test('paints a chart and walks the list with the chevrons', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'AMAT');
    assert.ok((await paintedPixels(s.page)) > 1000, 'the chart should actually draw');
    const first = await s.page.locator('.tsym').textContent();
    await s.page.locator('.navgrp button').last().click();
    await s.page.waitForTimeout(400);
    const second = await s.page.locator('.tsym').textContent();
    assert.notEqual(second, first, 'the chevron should move to another name');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('renders in light mode without errors', async () => {
    const s = await open(browser, { colorScheme: 'light' });
    await openTicker(s.page, 'AMAT');
    assert.ok((await paintedPixels(s.page)) > 1000);
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});
