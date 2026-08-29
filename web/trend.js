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

  /**
   * Fitted log price at bar `i` of the regression window, offset by `k` sigma.
   * The chart draws the centre line and the ±1σ / ±2σ bands from this.
   */
  function fittedAt(ch, i, k) {
    return ch.intercept + ch.slope * i + (k || 0) * ch.sigma;
  }

  /** Fit quality below which the channel is noise and must not read as signal. */
  var WEAK_R2 = 0.20;

  function isWeak(ch) {
    return !ch || ch.r2 === null || ch.r2 < WEAK_R2;
  }

  return {
    WINDOW: WINDOW,
    EPS: EPS,
    WEAK_R2: WEAK_R2,
    channel: channel,
    fittedAt: fittedAt,
    isWeak: isWeak,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Trend;
