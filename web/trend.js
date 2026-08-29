/* Log regression channel: where a price sits inside its own fitted trend.

   Every other figure in the app measures how STRONG a trend is. This measures
   where the price currently sits WITHIN it — a name can rank top-20 on momentum
   while trading three residual standard deviations below its own trend line.

   Pure and unit-tested; the DOM layer only formats and draws it. */
var Trend = (function () {
  'use strict';

  /** Trading days in the regression window. */
  var WINDOW = 252;

  /**
   * Below this, a residual standard deviation is float noise rather than a
   * channel. An exact exponential leaves residuals around 1e-15, which would
   * divide into a meaningless but finite z; `sigma === 0` would not catch it.
   * The smallest sigma across the 500 ranked names is 0.024, so this sits some
   * 24 million times below any real value and cannot mask a genuine channel.
   */
  var EPS = 1e-9;

  /**
   * Ordinary least squares of ln(adjusted close) against time, over the last
   * `n` closes.
   *
   * `closes` must be the adjusted series — the same one scripts/refresh.ts
   * writes and every other figure here is built from.
   *
   * Returns null when fewer than `n` closes are available. Deliberately not
   * min(n, available): a channel fitted over 60 bars is not a 252-day channel,
   * and the pipeline already takes the line that short-history names get a
   * chart but no computed statistics.
   *
   *   slope            per-day log slope
   *   slopeAnnualised  slope * 252 — an annualised LOG return, not a simple
   *                    one. Matches how the app already renders blended/m12/m6,
   *                    so it is directly comparable to the momentum score shown
   *                    beside it; the simple equivalent would be exp(x) - 1.
   *   sigma            residual standard deviation, n-2 degrees of freedom
   *   z                last residual over sigma — the score
   *   r2               1 - SSE/SST; null when the series has no variance
   */
  function channel(closes, n) {
    var win = n || WINDOW;
    if (!closes || closes.length < win) return null;

    var y = [];
    var i;
    for (i = closes.length - win; i < closes.length; i++) {
      var v = closes[i];
      if (!(v > 0)) return null; // ln of a non-positive close is undefined
      y.push(Math.log(v));
    }

    var m = y.length;
    var xMean = (m - 1) / 2;
    var yMean = 0;
    for (i = 0; i < m; i++) yMean += y[i];
    yMean /= m;

    // Centred form: one pass, and no catastrophic cancellation from large sums.
    var sxx = 0;
    var sxy = 0;
    for (i = 0; i < m; i++) {
      var dx = i - xMean;
      sxx += dx * dx;
      sxy += dx * (y[i] - yMean);
    }
    var slope = sxy / sxx;
    var intercept = yMean - slope * xMean;

    var sse = 0;
    var sst = 0;
    var lastResidual = 0;
    for (i = 0; i < m; i++) {
      var e = y[i] - (intercept + slope * i);
      sse += e * e;
      var d = y[i] - yMean;
      sst += d * d;
      if (i === m - 1) lastResidual = e;
    }

    var sigma = Math.sqrt(sse / (m - 2));
    return {
      n: m,
      slope: slope,
      slopeAnnualised: slope * 252,
      intercept: intercept,
      sigma: sigma,
      z: sigma < EPS ? null : lastResidual / sigma,
      r2: sst < EPS ? null : 1 - sse / sst,
    };
  }

  /** Fit quality below which the channel is noise and must not read as signal. */
  var WEAK_R2 = 0.20;

  function isWeak(ch) {
    return !ch || ch.r2 === null || ch.r2 < WEAK_R2;
  }

  /** Inside this the price is effectively sitting on its own trend line. */
  var BAND_INNER = 0.5;
  /** Outside this the deviation is too large to read as pullback or extension. */
  var BAND_OUTER = 2;

  /**
   * Where the last close sits, as one of 'buy', 'extended' or '' (neutral).
   *
   * The single source for both the dot's colour and the buy-zone filter, so the
   * list can never show a name whose dot is not green.
   *
   * The scale is deliberately not monotonic — neutral, green, neutral, red,
   * neutral. Past 2 sigma the extremes are not more of the same signal, they
   * are a different situation: a name 3 sigma under its own trend is likelier
   * broken than cheap. Both ends therefore go quiet rather than louder.
   *
   * A weak fit is neutral whatever its z, and so never passes the filter. That
   * override matters: 71 of the 500 sit in a coloured band on a channel that
   * explains almost none of their price action — V would read as extended on an
   * R2 of 0.02. None of the current top-50 buy-zone names is a weak fit, so it
   * costs nothing where it is actually used.
   */
  function zone(ch) {
    if (!ch || ch.z === null || isWeak(ch)) return '';
    if (ch.z >= -BAND_OUTER && ch.z < -BAND_INNER) return 'buy';
    if (ch.z > BAND_INNER && ch.z <= BAND_OUTER) return 'extended';
    return '';
  }

  return {
    WINDOW: WINDOW,
    EPS: EPS,
    WEAK_R2: WEAK_R2,
    BAND_INNER: BAND_INNER,
    BAND_OUTER: BAND_OUTER,
    channel: channel,
    isWeak: isWeak,
    zone: zone,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Trend;
