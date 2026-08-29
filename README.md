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

Before overwriting, the refresh reads the old `rankings.json` and carries each
symbol's ranks forward as `prevRankBlended`/`prevRankVolAdj`. Nothing in the app
reads them today — they were added for rank-movement indicators that were
removed after measurement showed rank deltas are a poor proxy for score change
in the top 50 (`corr` ≈ 0.14 there against 0.73 below #150, because scores are
77× denser mid-list). The build strips them from the payload. They keep being
recorded because a prior snapshot cannot be reconstructed after the fact, and an
entrants/exits view would need them.

The app shows the snapshot's age in the Ranks header once it passes 8 days,
heavier past 22.

The full update flow is: ask Claude Code to refresh → `npm run refresh` →
`npm run build:web` → republish `dist/momentum.html` to the same artifact URL.
The home-screen icon picks up the new build on next open; nothing to re-add.

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

The **trend channel** is the one statistic computed in the browser rather than
the pipeline (`web/trend.js`, cached per symbol): ordinary least squares of
`ln(adjusted close)` against time over the last 252 bars, giving a fitted line,
a residual standard deviation `σ` on n−2 degrees of freedom, and the score

    z = last residual / σ

— how far the latest close sits above or below its own trend. Every other
figure here measures how *strong* a trend is; this measures where the price
currently sits *inside* it. The two are close to unrelated: `z` correlates
−0.23 with blended momentum and +0.00 with volatility, and a name can rank
top-20 on momentum while trading three σ below its own line.

Two caveats the display exists to handle:

- The fitted slope is reported as `b × 252` — an annualised **log** return, to
  match how blended/12–1/6–1 are already rendered, *not* a simple return
  (AMAT's +124.2% log is +246% simple). It is a supporting figure only: it
  correlates +0.86 with blended momentum, so it is a second estimate of the
  same trend rather than new information.
- `R² < 0.20` means there is no trend to sit inside — that is 119 of the 500
  names — so the app renders those neutrally and they never enter the buy-zone
  filter. A channel fitted to noise otherwise reads exactly like a signal.
  Fewer than 252 bars yields no channel at all rather than a shorter fit
  relabelled as a 252-day one.

`Trend.zone()` turns the score into `buy`, `extended` or neutral, and is the
single source for both the dot's colour and the filter — so the list can never
show a name whose dot is not green:

| z | zone |
|---|---|
| < −2.0 | neutral — too far below to read as a pullback |
| −2.0 … −0.5 | **buy** — a readable pullback |
| −0.5 … +0.5 | neutral — sitting on its trend |
| +0.5 … +2.0 | **extended** |
| > +2.0 | neutral |
| R² < 0.20 | neutral, overriding all of the above |

The scale is deliberately not monotonic. Past 2σ the extremes are not more of
the same signal, they are a different situation — a name 3σ under its own trend
is likelier broken than cheap — so both ends go quiet rather than louder. The
weak override is what keeps an unreadable channel out of a buy list: 71 of the
500 fall in a coloured band on a fit explaining almost none of their price
action (V would read as extended on an R² of 0.02). None of the current
top-50 buy-zone names is a weak fit, so it costs nothing where it is used.

**Trend acceleration** answers what the channel cannot: not where the price sits
in its trend, but whether the trend itself is turning. A fast slope against a
slower one, in units of the channel's own scatter:

    accel = (β42 − β126) × 42 / σ252

`channel(closes, n)` already fits an arbitrary window, so this is three existing
calls rather than new regression code, and σ252 is already memoised per symbol.
The `× 42` is a display scale, not statistics: the slope difference is log-price
per day and σ is log-price, so multiplying by a day count makes the ratio
dimensionless. Using the fast window puts the spread at sd 1.93 on the same ±3σ
range the track already uses; every other multiplier is a rescale that leaves
the ordering identical.

**The windows are 42/126 on measurement, not taste.** Recomputing every name
with the last five sessions withheld:

| pair | corr(vol) | 5-day stability | sign flips | flips among strongest quartile |
|---|---|---|---|---|
| 21/63 | 0.43 | 0.71 | 26% | 12% |
| **42/126** | **0.004** | **0.96** | **8%** | **0%** |
| 63/189 | −0.23 | 0.98 | 5% | 0%, but too slow to be early |

At 21/63 a quarter of the universe reverses its verdict inside a week and the
score is 0.43 correlated with volatility — high-vol names score high simply for
being volatile. At 42/126 that contamination is gone and the names the measure
is loudest about never reverse. A test pins both figures against the committed
snapshot, so the window cannot be changed back unnoticed.

Two deliberate departures from the channel's rules:

- **No weak-fit suppression.** A low R² means a straight line fits badly, and a
  name that is accelerating is exactly one a straight line fits badly. Silencing
  acceleration there would silence it where it is most informative.
- **Colour is monotonic**, with only a dead band inside ±0.5σ (about the
  one-sigma noise level on a constant-slope series). The channel's "too far to
  read" argument does not apply, and the measurement points the other way: the
  strongest quartile is the most stable of all.

It is its own axis — `corr` with volatility 0.004, and −0.07 with the 6–1 vs
12–1 bar, the other thing on screen that sounds like acceleration. Across all
500 it correlates 0.63 with channel position, but that is not where it is used:
**inside the buy zone the two are independent** (`corr` −0.17 across those 14
names, spanning +0.79 to −3.87). They look identical on the dot. MU at rank 2
reads as a textbook pullback and is still deteriorating at −2.53σ; LITE looks
the same and is the one actually turning up.

One limitation worth knowing: any fast-versus-slow comparison, this one
included, cannot tell a turning trend from an oscillation whose period is near
the window lengths. A planted 80-day cycle reads ±3σ on a series with no trend
change at all.

## Screens

- **Ranks** — top 50 by blended momentum or its vol-adjusted equivalent, with
  a toggle at the foot to show all 500. The row visualisation is chosen in
  Settings, from four: a 52-week range bar, where the price sits in its 252-day
  regression channel, the last session's move, or watchlist impact.

  Three others were cut after use: the rolling blended score, accelerating-or-
  fading (6–1 against 12–1), and trend acceleration. A row visualisation has to
  earn a scan of 50 rows, and these did not — the two acceleration measures both
  remain as ticker stats, where they are read one name at a time. `ROW_VIZ` is
  the single list behind the rows, the settings screen and the stored-value
  check, so an option cannot linger in one of them after leaving the others, and
  a device still holding a removed choice is coerced to the range bar on load
  rather than being left with nothing selected.

  The channel bar spans ±3σ rather than ±2σ: the spread of `z` across the
  universe is 1.51, not 1.0, so ±2 would peg a fifth of the list at the ends.
  Ticks mark the trend line and ±2σ, which is exactly where colour stops. One
  dot size throughout; the hue carries it, per `Trend.zone` above — green below
  the trend line, red above it, neutral in the middle and at both extremes.

  A one-line legend names the axis on the first paint after launch and then
  retires itself, collapsing so the list settles rather than jumps. It is built
  from the row's own CSS classes, so it cannot drift out of alignment with the
  track it annotates.

- **Buy zone** — a toggle above the list collapses it to the names in a
  readable pullback: 14 of the current top 50, 110 of all 500. It is the same
  predicate as the green dot, so every row it shows is green and every green
  row is shown. It composes with the all-500 toggle, works under any row
  visualisation, and the header names what is being shown so a short list is
  never mysterious.

  Dropping the rolling row visualisation left its weekly series unread, so the
  build now strips `rolling` from the payload alongside `prevRank*` — 82 KB, and
  1.31 MB down to 1.22 MB. The refresh still records it.

  The last-session move is the final close against the one before it, derived
  from closes already in the payload — the snapshot's last close is exactly what
  a quote API reports as the previous close, so no live feed is needed. It is
  labelled *last session* rather than *today* on purpose: the snapshot can be
  days old and a percentage implies currency more strongly than a chart does.
  Being computed from the adjusted series, it differs slightly from an
  unadjusted broker headline on a name that has just gone ex-dividend.
- **Search** — the magnifier on Ranks, over every ranked name, not just the
  top 50. Exact symbol first, then symbol prefix, then company name, so "MU"
  finds Micron rather than TMUS.
- **Watchlist** — tap any star to add or remove; persists on the device. Opens
  with a concentration card: the effective number of independent bets
  (`n / (1 + (n−1)·ρ̄)`), a bar splitting the names across correlation groups,
  and which single drop would help most. Each row shows what that name is
  worth to the list — what dropping it would cost, or what starring it would
  add — from the Elton–Gruber add rule evaluated at equal weight.
- **Ticker** — the price over 1M/3M/6M/12M, drawn by TradingView's
  **lightweight-charts** (v5). Real time and price axes, a magnet crosshair with
  synced axis labels, and pan and pinch-zoom. Chevrons walk the list you arrived
  from without going back. The
  stat grid includes 6–1 vs 12–1, the momentum-deceleration spread, and the
  channel position, fit and slope, plus trend acceleration and the phase it
  implies (`rising, slowing` / `falling, improving` and the other two). Position
  and acceleration are toned by the same `Trend.zone` and `Trend.accelZone` as
  the rows, so the two screens cannot disagree.

  The fitted line and its ±2σ bands were briefly drawn under the price and were
  removed: the chart is for reading price, and the channel is already stated
  twice on that screen, as a number and as a colour.

  The library is a build-time devDependency, not a runtime one: `web/build.ts`
  inlines the standalone IIFE build from `node_modules` alongside the app's own
  scripts, so the page still makes no network requests. It costs about 200 KB
  raw (62 KB gzipped) and took the file from 1.12 MB to 1.30 MB.

  Two things follow from the switch. The window buttons now move the visible
  range over one series rather than replacing the data — `setData` resets the
  range, and holding the whole series is what makes panning work. And the morph
  between windows is gone: it existed because every window resampled to the same
  253 points so two shapes could interpolate, which a real time axis cannot do.
  `resampleToN`, `padDomain` and `LINE_POINTS` went with it.

  Charts still ship close-only, so the series is an area rather than candles.
  Candlesticks are now one option change away, but they would need OHLC in the
  payload, which `web/build.ts` strips — roughly four times the chart bytes.

  **Gestures are split between the page and the chart, deliberately.** The
  library sets `touch-action` nowhere and relies on the host page for it, so
  without a rule the browser claims pinch as page zoom and the chart never sees
  it. `.chartwrap` carries `touch-action: pan-y`: vertical drag scrolls the page
  (the chart sits inside a scrolling screen, and `vertTouchDrag` is off for the
  same reason), while horizontal pan and pinch reach the chart. `none` would
  work for the chart and leave a 290px dead zone that the page could not scroll
  through.

  Either axis can be dragged to stretch it. The window buttons name a *time*
  window, so a price-axis stretch leaves the selected button correct — but the
  view still needs a way back, so `segmented()` takes an `alwaysFire` flag and
  re-tapping the current window resets both axes, `autoScale` included. A pinch
  or pan that moves the view somewhere no button describes deselects them all,
  and the header then measures from the first visible bar instead of naming a
  window it is no longer showing.

  Two foot-guns worth recording. The chart owns a `ResizeObserver` and
  document-level listeners that dropping its container does not release, so
  `render()` calls `chart.remove()` first — without it every chevron press
  leaked a chart. And a script block ends at the first `</script` even inside a
  string literal: the minified library carries SVG markup, so the build escapes
  that sequence in inlined JS the same way it already did in the data payload.
- **Correlation** — the top-50 matrix with its clusters, reachable from the
  grid button on Ranks. Blue means moved together, amber means moved opposite.
  The header states how many independent bets the whole top 50 amounts to.

Watchlist and ranks-impact figures use correlations computed in the browser
from the shipped close series — the same definition as the pipeline, and a
test requires the recomputation to reproduce the shipped matrix exactly — so
any searchable name is scoreable, not just the top 50. The precomputed matrix
and clustering serve only the Correlation screen. Charts ship close-only with
their trading calendars pooled (500 symbols share one 253-day calendar),
which is what makes carrying the full universe cost ~1 MB.

## Tests

```bash
npm test        # quant + chart geometry
npm run typecheck
```

The tests cover the parts where being wrong is silent: momentum on synthetic
series with known closed-form answers, the skipped month actually being
skipped, cluster recovery on planted blocks, and the colour scale's
monotonicity. `web/chartmath.js` and `web/trend.js` are the code the browser
actually runs, not copies of it, so those tests cover what ships.

They also earn their keep on cleanups: deleting the chart's morph helpers took
`lerpColor` with them, and the bucket-colour tests failed immediately because
`bucketColor` still reaches it. It went back as an internal function.

The browser-driven suites compare *decoded pixels*, not PNG bytes. A one-pixel
layout shift changes almost every byte of an encoded PNG, so a byte diff
reported two identical price axes as different and sent a real investigation
chasing a bug that did not exist. They also park the pointer off-chart before
capturing: a crosshair badge is drawn onto the price axis and is not part of
the scale.
