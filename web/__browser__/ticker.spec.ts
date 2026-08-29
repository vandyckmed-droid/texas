/**
 * The ticker screen's statistics: the three-metric hierarchy and the Details
 * disclosure.
 *
 * Ported from the `stats` driven suite. The load-bearing check is that opening
 * Details does not rebuild the chart — it toggles in place rather than through
 * render(), which would replace the chart and drop the reader's scroll.
 */
import assert from 'node:assert/strict';
import test, { after, before, describe } from 'node:test';
import type { Browser } from 'playwright';
import { launch, open, openTicker } from './harness.ts';

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Details is hidden with the [hidden] attribute; measure what is painted. */
const detailsVisible = (page: import('playwright').Page) =>
  page.evaluate(() => document.querySelector('.stats')!.getBoundingClientRect().height > 0);

describe('the three primary metrics', () => {
  test('lead with a phrase and keep the figure subordinate', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'MU');

    const hero = await s.page.evaluate(() => ({
      label: document.querySelector('.hero .l')?.textContent,
      value: document.querySelector('.hero .v')?.textContent,
      meta: document.querySelector('.hero .meta')?.textContent,
    }));
    assert.equal(hero.label, 'Momentum');
    assert.match(hero.value ?? '', /^[+−]\d/);
    assert.match(hero.meta ?? '', /#\d+ of \d+\s+·\s+#\d+ vol-adjusted/);

    const rows = await s.page.$$eval('.keyrow', (els) =>
      els.map((r) => ({
        label: r.querySelector('.l')!.textContent,
        word: r.querySelector('.w')!.textContent,
        figure: r.querySelector('.s')!.textContent,
        bar: !!r.querySelector('.channel'),
      })),
    );
    assert.equal(rows.length, 2, 'the hero plus two key rows make three primary metrics');
    assert.deepEqual(
      rows.map((r) => r.label),
      ['Price vs trend', 'Trend change'],
    );
    assert.ok(rows[0].bar, 'price-vs-trend should carry the ranking row’s own channel bar');
    assert.ok(!rows[1].bar, 'trend change should not compete with a second bar');
    for (const r of rows) assert.match(r.figure ?? '', /σ$/, 'the sigma figure stays as supporting detail');

    // Exactly three labelled metrics above the fold.
    assert.equal(await s.page.evaluate(() => document.querySelectorAll('.keystats .l').length), 3);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('the phrases follow the same thresholds as the ranking rows', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'MU');
    const agrees = await s.page.evaluate(() => {
      const T = (window as never as { Trend: Record<string, (...a: unknown[]) => unknown> }).Trend;
      const DATA = (window as never as { DATA: never }).DATA as {
        rankings: { stocks: Array<{ symbol: string; fileKey: string }> };
        charts: Record<string, { c: number[] }>;
      };
      const out: Array<{ sym: string; position: string; change: string }> = [];
      for (const sym of ['MU', 'AMAT', 'V', 'LITE', 'DELL']) {
        const st = DATA.rankings.stocks.find((x) => x.symbol === sym)!;
        const c = DATA.charts[st.fileKey].c;
        const ch = T.channel(c);
        out.push({
          sym,
          position: T.positionLabel(ch) as string,
          change: T.changeLabel(T.acceleration(c, ch)) as string,
        });
      }
      return out;
    });
    const words = new Set(agrees.map((a) => a.position));
    assert.ok(words.size > 1, 'the sample should exercise more than one position phrase');
    // A fit too weak to read must say so rather than naming a position: V sits
    // +2.24 sigma out on an R² of 0.02, where "far above trend" would be a lie.
    assert.equal(agrees.find((a) => a.sym === 'V')!.position, 'No clear trend');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('the Details disclosure', () => {
  test('starts collapsed and holds the supporting figures', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'MU');
    assert.equal(await detailsVisible(s.page), false, 'details should start collapsed');
    // .stats sets display:flex, which outranks the user agent's [hidden] rule —
    // measure painted height rather than trusting the attribute.
    assert.equal(await s.page.locator('.stat').count(), 11);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('opening it does not rebuild the chart', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'MU');
    // A re-render would replace .chartwrap, so mark the node and check that the
    // very same element survives. Scroll alone is a poor probe: with details
    // collapsed the page is shorter than the viewport, so scrollTop clamps to 0.
    await s.page.evaluate(() => {
      (document.querySelector('.chartwrap') as HTMLElement).dataset.mark = 'keep';
    });
    const canvasesBefore = await s.page.evaluate(() => document.querySelectorAll('.chartwrap canvas').length);

    await s.page.locator('.detailsbtn').click();
    await s.page.waitForTimeout(250);
    assert.equal(await detailsVisible(s.page), true, 'details should expand on tap');
    assert.equal(
      await s.page.evaluate(() => document.querySelectorAll('.chartwrap canvas').length),
      canvasesBefore,
      'the chart should not be rebuilt',
    );
    assert.equal(
      await s.page.evaluate(() => (document.querySelector('.chartwrap') as HTMLElement | null)?.dataset.mark),
      'keep',
      'the very same chart element should survive — no re-render',
    );

    // Repeated toggling, now that the page is tall enough to scroll.
    await s.page.evaluate(() => {
      document.querySelector('.screen')!.scrollTop = 200;
    });
    assert.ok((await s.page.evaluate(() => document.querySelector('.screen')!.scrollTop)) > 0);
    await s.page.locator('.detailsbtn').click();
    await s.page.waitForTimeout(200);
    await s.page.locator('.detailsbtn').click();
    await s.page.waitForTimeout(200);
    assert.equal(
      await s.page.evaluate(() => (document.querySelector('.chartwrap') as HTMLElement | null)?.dataset.mark),
      'keep',
      'the chart should survive repeated toggling',
    );
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('stays open as the chevrons walk the list', async () => {
    const s = await open(browser);
    await openTicker(s.page, 'MU');
    await s.page.locator('.detailsbtn').click();
    await s.page.waitForTimeout(200);
    await s.page.locator('.navgrp button').last().click();
    await s.page.waitForTimeout(500);
    assert.equal(await detailsVisible(s.page), true, 'the choice should carry to the next name');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});
