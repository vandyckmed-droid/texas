/**
 * Row visualisations: the options that exist, what a stale choice does, and
 * the channel column's mapping from data to colour.
 *
 * Ported from the `rowviz` and `zone` driven suites.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after, before, describe } from 'node:test';
import type { Browser } from 'playwright';
import { launch, open, repo } from './harness.ts';

let browser: Browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const KEPT = ['52-week range', 'Trend channel', 'Last session move', 'Watchlist impact'];
const REMOVED = ['Rolling blended score', 'Trend acceleration', 'Accelerating or fading'];

describe('the option list', () => {
  test('offers exactly the four that remain, each with a preview', async () => {
    const s = await open(browser);
    await s.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await s.page.waitForSelector('.setcard .setrow');
    const offered = await s.page.$$eval('.setcard .setrow .t', (els) => els.map((e) => e.textContent ?? ''));
    assert.deepEqual(offered, KEPT);
    for (const gone of REMOVED) assert.ok(!offered.includes(gone), `${gone} should be removed`);
    const previews = await s.page.$$eval('.setcard .setrow .prev', (els) => els.map((e) => e.childElementCount));
    assert.equal(previews.length, 4);
    assert.ok(previews.every((n) => n > 0), 'every option should render a preview');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('migration of a stale stored choice', () => {
  // Trend acceleration was the selected option when it was removed, so a real
  // device was holding a value that no longer exists. Without coercion the
  // settings screen shows nothing selected while the rows silently fall back.
  for (const stale of ['accel', 'rolling', 'trend', 'nonsense']) {
    test(`"${stale}" becomes the range bar, once, on load`, async () => {
      const s = await open(browser, { seed: { rowViz: stale } });
      const stored = await s.page.evaluate(() => JSON.parse(localStorage.getItem('texas.web.rowViz')!));
      assert.equal(stored, 'range', 'the stale value should be rewritten, not just ignored');
      assert.ok((await s.page.locator('.row').count()) > 0);
      assert.ok(
        (await s.page.evaluate(() => document.querySelector('.row .viz')?.childElementCount ?? 0)) > 0,
        'rows should still render a visualisation',
      );
      await s.page.locator('.tabbar button', { hasText: 'Settings' }).click();
      await s.page.waitForSelector('.setcard .setrow');
      assert.equal(await s.page.locator('.setrow.on').count(), 1, 'exactly one option should read as selected');
      assert.deepEqual(s.errors, []);
      await s.close();
    });
  }
});

describe('the trend channel column', () => {
  test('every dot across all 500 matches Trend.zone, at one size', async () => {
    const s = await open(browser, { seed: { rowViz: 'channel', showAll: true, buyOnly: false } });
    const audit = await s.page.evaluate(() => {
      const T = (window as never as { Trend: Record<string, (...a: unknown[]) => unknown> }).Trend;
      const DATA = (window as never as { DATA: never }).DATA as {
        rankings: { stocks: Array<{ symbol: string; fileKey: string }> };
        charts: Record<string, { c: number[] }>;
      };
      const mismatch: string[] = [];
      const counts: Record<string, number> = { buy: 0, extended: 0, neutral: 0 };
      for (const row of Array.from(document.querySelectorAll('.row'))) {
        const dot = row.querySelector('.channel .dot');
        if (!dot) continue;
        const sym = row.querySelector('.sym')!.textContent!;
        const cls = dot.classList.contains('buy') ? 'buy' : dot.classList.contains('extended') ? 'extended' : 'neutral';
        counts[cls]++;
        const st = DATA.rankings.stocks.find((x) => x.symbol === sym)!;
        const want = (T.zone(T.channel(DATA.charts[st.fileKey].c)) as string) || 'neutral';
        if (want !== cls) mismatch.push(`${sym} dom=${cls} calc=${want}`);
      }
      const sizes = new Set(
        Array.from(document.querySelectorAll('.channel .dot')).map(
          (d) => `${getComputedStyle(d).width}x${getComputedStyle(d).height}`,
        ),
      );
      return { mismatch, counts, sizes: Array.from(sizes) };
    });
    assert.deepEqual(audit.mismatch, [], 'the rendered colour must follow Trend.zone');
    assert.equal(audit.sizes.length, 1, `one dot size only, got ${audit.sizes.join(' ')}`);
    const total = audit.counts.buy + audit.counts.extended + audit.counts.neutral;
    assert.equal(total, 500);
    assert.ok(audit.counts.buy > 0 && audit.counts.extended > 0, 'both coloured zones should be populated');
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('the buy-zone filter shows exactly the green dots', async () => {
    // Filter and colour are the same predicate, so the list can never show a
    // name whose dot is not green. This pins the invariant from both ends.
    const s = await open(browser, { seed: { rowViz: 'channel', showAll: false, buyOnly: false } });
    const green = await s.page.evaluate(() =>
      Array.from(document.querySelectorAll('.row'))
        .filter((r) => r.querySelector('.channel .dot.buy'))
        .map((r) => r.querySelector('.sym')!.textContent!),
    );
    assert.ok(green.length > 0, 'the snapshot should contain some buy-zone names');
    assert.match(((await s.page.locator('.zonechip').textContent()) ?? '').trim(), /^Buy zone · \d+$/);

    await s.page.locator('.zonechip').click();
    await s.page.waitForTimeout(150);
    const filtered = await s.page.evaluate(() =>
      Array.from(document.querySelectorAll('.row')).map((r) => r.querySelector('.sym')!.textContent!),
    );
    assert.deepEqual(filtered, green, 'the filtered list must equal the set of green dots');
    assert.ok(
      await s.page.evaluate(() =>
        Array.from(document.querySelectorAll('.row')).every((r) => !!r.querySelector('.channel .dot.buy')),
      ),
      'every visible dot should be green',
    );
    assert.equal(await s.page.locator('.zonechip.on').count(), 1);
    assert.match(((await s.page.locator('.sub').textContent()) ?? '').trim(), /in buy zone of top 50/);
    assert.deepEqual(s.errors, []);
    await s.close();
  });

  test('the filter composes with the all-500 toggle and any row visualisation', async () => {
    const s = await open(browser, { seed: { rowViz: 'range', showAll: true, buyOnly: true } });
    assert.ok((await s.page.locator('.row').count()) > 0);
    assert.match(((await s.page.locator('.sub').textContent()) ?? '').trim(), /in buy zone of all 500/);
    assert.equal(await s.page.locator('.more').count(), 1, 'the top-50 toggle must stay reachable');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('the axis legend', () => {
  test('names the scale once, then retires and stays gone', async () => {
    const s = await open(browser, { seed: { rowViz: 'channel' } });
    assert.equal(await s.page.locator('.chankey').count(), 1, 'the legend should appear on the first paint');
    assert.equal(await s.page.locator('.chankey.gone').count(), 0);

    await s.page.waitForTimeout(4600);
    const collapsed = await s.page.evaluate(() => {
      const el = document.querySelector('.chankey');
      return el ? { opacity: getComputedStyle(el).opacity, height: el.getBoundingClientRect().height } : null;
    });
    assert.ok(collapsed, 'the legend element should still exist, collapsed');
    assert.equal(Number(collapsed!.opacity), 0);
    assert.equal(collapsed!.height, 0);

    // A re-render must not resurrect it mid-fade.
    await s.page.locator('.seg button', { hasText: 'Vol-adjusted' }).click();
    await s.page.waitForTimeout(200);
    assert.equal(await s.page.locator('.chankey').count(), 0, 'a re-render should not bring the legend back');
    assert.deepEqual(s.errors, []);
    await s.close();
  });
});

describe('payload', () => {
  test('the rolling series is no longer shipped', async () => {
    // Removing the rolling row visualisation left its weekly series unread.
    const built = readFileSync(join(repo, 'dist', 'momentum.html'), 'utf8');
    assert.doesNotMatch(built, /"rolling":/);
  });
});
