# Momentum

A personal iPhone app that ranks the S&P 500 by momentum. It is a single
self-contained HTML file you add to your home screen.

## How it works

The data is a **static snapshot**. The app makes no network calls at all: it
reads JSON that was committed to this repo by a refresh you run deliberately.
Nothing updates on its own — no intraday quotes, no scheduled jobs, no backend.

```
scripts/   fetch from Financial Modeling Prep, validate, adjust, emit
quant/     the maths — momentum, volatility, correlation, clustering
data/      the generated snapshot, committed (this is what the app reads)
web/       the app itself — screens, charts, theme, and the build that inlines them
```

`shared/types.ts` is the contract between those layers.

## Running it

```bash
npm install
npm run build:web       # -> dist/momentum.html
```

Open that file in any browser. Everything — data, styles, behaviour, the
home-screen icon — is inlined into it, so the page makes no network requests
after it loads and works offline once cached.

On an iPhone: open the published page in **Safari**, then Share → Add to Home
Screen. It launches full-screen with no browser chrome.

There was an Expo Go / React Native build of this. It was removed: Skia,
Reanimated and worklets are three native runtimes with manual memory
semantics, and canvas surfaces churned faster than the JS collector had reason
to reclaim them, which killed the app under normal use. The web build has no
equivalent failure mode, and `git log` still has the native one.

## Refreshing the data

```bash
npm run refresh
```

Needs a Financial Modeling Prep key in the environment as `API_KEY` (or
`FMP_API_KEY`). The key is never read by the app, never written to disk, and
never committed — only this script sees it.

The refresh fetches 25 months of split- and dividend-adjusted daily bars for
every S&P 500 constituent, computes everything, runs a set of self-checks, and
only then writes `data/`. If any check fails — a lopsided universe, an
asymmetric correlation matrix, a ranked stock with no chart — it exits without
writing, leaving the previous snapshot intact.

Useful while iterating:

| flag | effect |
|---|---|
| `--limit N` | first N constituents only |
| `--symbols A,B` | just those symbols |
| `--skip-fetch` | recompute from the cached responses in `.cache/` |

## The maths

Computed once per refresh in `quant/`, never in the app.

- **12–1 momentum** — log return from 252 to 21 trading days ago, annualised.
- **6–1 momentum** — the same from 126 to 21 days ago, annualised.
  Skipping the last month is the standard short-term-reversal exclusion.
- **Blended** — the equal-weight mean of the two. Both legs are annualised
  first, so a 12-month and a 6-month return are directly comparable.
- **Volatility** — standard deviation of the last 126 daily log returns,
  annualised (×√252).
- **Vol-adjusted** — blended ÷ volatility.
- **Correlation** — Pearson on 126 days of aligned daily log returns across
  each mode's top 50, then average-linkage clustering on distance `1 − ρ`. The
  matrix is emitted in dendrogram leaf order, so groups form solid blocks down
  the diagonal.

A stock needs 273 bars to be ranked. Newer listings still get a chart and
remain viewable, but never enter the rankings or the correlation set.

The **rolling score** in the ranking rows is presentation only: each week's
blended score is z-scored across the universe and squashed through
`2·tanh(z/2)`, which bounds it to ±2 without changing any ordering. It never
feeds a ranking.

## Screens

- **Ranks** — top 50 by blended momentum or its vol-adjusted equivalent. Each
  row carries either a 52-week range bar or the rolling score, your choice in
  Settings.
- **Watchlist** — tap any star to add or remove; persists on the device.
- **Ticker** — the price line over 1M/3M/6M/12M. Changing window reshapes the
  existing line into the new horizon rather than replacing it: every window
  resamples to the same 253 points, so the two shapes interpolate. Drag for a
  crosshair. Chevrons walk the list you arrived from without going back.

  Candles were cut. They could not morph — a window change alters the bar
  count, leaving nothing to interpolate — and every figure here comes from
  adjusted closes, with the intraday range already shown as the 52-week range.
  Charts therefore ship close-only.
- **Correlation** — the top-50 matrix with its clusters, reachable from the
  grid button on Ranks. Blue means moved together, amber means moved opposite.

## Tests

```bash
npm test        # quant + chart geometry
npm run typecheck
```

The tests cover the parts where being wrong is silent: momentum on synthetic
series with known closed-form answers, the skipped month actually being
skipped, cluster recovery on planted blocks, and the colour scale's
monotonicity. `web/chartmath.js` is the code the browser actually runs, not a
copy of it, so those tests cover what ships.
