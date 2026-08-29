/**
 * Shared plumbing for the browser suites.
 *
 * These cover what the unit tests structurally cannot: that the built page
 * actually loads and runs, that state does not leak across navigation, and
 * that gestures reach the chart. They drive `dist/momentum.html` over
 * `file://`, which is exactly how the app is used once added to a home screen
 * — there is no server, and no network request after load.
 *
 * Everything here is repo-relative. Nothing reads a temp directory or any
 * session-specific path.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, '..', '..');

/** The build under test. `npm run test:web` builds it first. */
export const BUILT = join(repo, 'dist', 'momentum.html');
export const PAGE_URL = pathToFileURL(BUILT).href;

/**
 * Which Chromium to drive.
 *
 * A bare `chromium.launch()` wants Playwright's own headless-shell download,
 * which is absent in sandboxes that ship a browser at a fixed path instead.
 * So: an explicit override first, then the well-known preinstalled path, then
 * Playwright's own resolution for an ordinary machine that has run
 * `npx playwright install chromium`.
 */
function executablePath(): string | undefined {
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return undefined;
}

export async function launch(): Promise<Browser> {
  if (!existsSync(BUILT)) {
    throw new Error(`${BUILT} is missing — run \`npm run build:web\` first (\`npm run test:web\` does this for you).`);
  }
  const exe = executablePath();
  try {
    return await chromium.launch(exe ? { executablePath: exe } : {});
  } catch (err) {
    throw new Error(
      'Could not launch Chromium. Install one with `npx playwright install chromium`, ' +
        'or point CHROMIUM_PATH at an existing binary.\n' +
        (err as Error).message,
    );
  }
}

/** localStorage keys the app reads, seeded before the first script runs. */
export type Seed = Record<string, unknown>;

export interface Session {
  page: Page;
  context: BrowserContext;
  /** Uncaught page errors and console errors, in order. */
  errors: string[];
  close(): Promise<void>;
}

export interface OpenOptions {
  seed?: Seed;
  colorScheme?: 'dark' | 'light';
  hasTouch?: boolean;
  isMobile?: boolean;
  /** Wait for this before returning. Ranks renders rows; a filter may render an empty state. */
  waitFor?: string;
}

/**
 * A fresh context per session, so localStorage never bleeds between checks —
 * several of these assert on what a device was already holding.
 */
export async function open(browser: Browser, opts: OpenOptions = {}): Promise<Session> {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    colorScheme: opts.colorScheme ?? 'dark',
    hasTouch: opts.hasTouch ?? true,
    isMobile: opts.isMobile ?? false,
  });
  const page = await context.newPage();

  /* tsx compiles with esbuild's keepNames, which wraps inner function
     expressions in a __name() helper. That helper exists in Node but not in the
     page, so any evaluate() body containing a named inner function throws
     ReferenceError. A no-op shim restores it. Test-only — the app itself never
     references __name. */
  await page.addInitScript(() => {
    const w = window as unknown as { __name?: (fn: unknown) => unknown };
    if (!w.__name) w.__name = (fn: unknown) => fn;
  });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  if (opts.seed) {
    await page.addInitScript((s: Seed) => {
      for (const k of Object.keys(s)) localStorage.setItem('texas.web.' + k, JSON.stringify(s[k]));
    }, opts.seed);
  }
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForSelector(opts.waitFor ?? '.row, .empty', { timeout: 15_000 });
  return { page, context, errors, close: () => context.close() };
}

/** Open a ticker screen by symbol and wait for the chart to exist. */
export async function openTicker(page: Page, symbol: string): Promise<void> {
  await page.locator('.row', { hasText: symbol }).first().click();
  await page.waitForSelector('.chartwrap canvas', { timeout: 15_000 });
  // The chart draws on the frame after insertion; wait for it to have painted.
  await page.waitForFunction(() => {
    const c = document.querySelector('.chartwrap canvas') as HTMLCanvasElement | null;
    return !!c && c.width > 0;
  });
  await page.waitForTimeout(400);
}

/** Non-transparent pixels across every chart canvas — proof it actually drew. */
export async function paintedPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    for (const c of Array.from(document.querySelectorAll('.chartwrap canvas'))) {
      const canvas = c as HTMLCanvasElement;
      try {
        const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
      } catch {
        /* a canvas the library keeps for hit-testing may be unreadable; skip it */
      }
    }
    return n;
  });
}

/**
 * Share of pixels that differ between two screenshots, 0..1.
 *
 * Decoded pixels, never PNG bytes: a one-pixel layout shift changes almost
 * every byte of an encoded PNG, which once reported two identical price axes
 * as different and sent a real investigation chasing a bug that did not exist.
 * Decoding happens inside the page because Node has no PNG decoder here.
 */
export async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([da, db]: [string, string]) => {
      const load = (d: string) =>
        new Promise<HTMLImageElement>((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = 'data:image/png;base64,' + d;
        });
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const px = (img: HTMLImageElement) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d')!;
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, w, h).data;
      };
      const A = px(ia);
      const B = px(ib);
      let bad = 0;
      for (let i = 0; i < A.length; i += 4) {
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 90) bad++;
      }
      return bad / (w * h);
    },
    [a.toString('base64'), b.toString('base64')] as [string, string],
  );
}
