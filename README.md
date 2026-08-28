# Momentum

A personal iPhone app that ranks the S&P 500 by momentum. Expo Go + React
Native + TypeScript.

## How it works

The data is a **static snapshot**. The app makes no network calls at all: it
reads JSON that was committed to this repo by a refresh you run deliberately.
Nothing updates on its own — no intraday quotes, no scheduled jobs, no backend.

```
scripts/   fetch from Financial Modeling Prep, validate, adjust, emit
quant/     the maths — momentum, volatility, correlation, clustering
data/      the generated snapshot, committed (this is what the app reads)
src/, app/ the app itself — screens, charts, theme
```

`shared/types.ts` is the contract between those layers.

## Running it

```bash
npm install
npx expo start          # scan the QR with Expo Go on your iPhone
```

Expo Go on the App Store tracks **SDK 54**, which is what this targets. Install
native-adjacent packages with `npx expo install` (never a bare `npm install
<pkg>`) so versions keep matching the Expo Go binary, and check with `npx
expo-doctor`.

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
- **Ticker** — price line or OHLC candles over 1M/3M/6M/12M. Changing window
  reshapes the existing line into the new horizon rather than replacing it.
  Long-press and drag for a crosshair. Chevrons walk the list you arrived from
  without going back.
- **Correlation** — the top-50 matrix with its clusters, reachable from the
  grid button on Ranks. Blue means moved together, amber means moved opposite.

## Tests

```bash
npm test        # quant + chart geometry
npm run typecheck
npm run lint
```

The tests cover the parts where being wrong is silent: momentum on synthetic
series with known closed-form answers, the skipped month actually being
skipped, cluster recovery on planted blocks, and the colour scale's
monotonicity.
