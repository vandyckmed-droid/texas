/* Pure chart maths, shared by the app and its tests.

   Kept as a separate script with no DOM access so the node test runner can
   require it directly and the browser can take it as a global. Colour helpers
   that read CSS custom properties stay in app.js; everything here is a plain
   function of its arguments. */
var ChartMath = (function () {
  'use strict';

  /* Trading days per window. 12M is unbounded and clamps to what a ticker has,
     which is the whole series — recent listings simply show fewer bars. */
  var WINDOWS = { '1M': 21, '3M': 63, '6M': 126, '12M': 1e9 };

  /* Every window resamples to this many points so two windows always have the
     same point count and can be interpolated against each other. Pinned to the
     chart file's bar count so no window is ever downsampled. */
  var LINE_POINTS = 253;

  function windowBars(key, avail) {
    return Math.min(WINDOWS[key], avail);
  }

  /** Linear resample of `values` onto exactly n points, endpoints preserved. */
  function resampleToN(values, n) {
    var m = values.length;
    var out = new Array(n);
    var i;
    if (m === 0) {
      for (i = 0; i < n; i++) out[i] = 0;
      return out;
    }
    if (m === 1) {
      for (i = 0; i < n; i++) out[i] = values[0];
      return out;
    }
    for (i = 0; i < n; i++) {
      var pos = (i / (n - 1)) * (m - 1);
      var lo = Math.floor(pos);
      var hi = Math.min(m - 1, lo + 1);
      var f = pos - lo;
      out[i] = values[lo] * (1 - f) + values[hi] * f;
    }
    return out;
  }

  /**
   * Fractional move over the final session of a close series: the last close
   * against the one before it.
   *
   * Needs no new data. The snapshot's last close is exactly what the quote API
   * reports as "previous close" (checked against FMP across the top 10, matching
   * to the cent), so the same comparison a broker shows is already derivable
   * from what ships. Null when there is no prior close to compare against, or
   * when it is zero.
   *
   * Computed from the adjusted series, so a name that has just gone ex-dividend
   * reads slightly differently from an unadjusted broker headline. That is the
   * internally consistent choice: every other figure in the app is adjusted.
   */
  function dayChange(closes) {
    if (!closes || closes.length < 2) return null;
    var prev = closes[closes.length - 2];
    if (!prev) return null;
    return closes[closes.length - 1] / prev - 1;
  }

  /** Pads a value range by 6% so the line never touches the frame edge. */
  function padDomain(lo, hi) {
    var span = hi - lo;
    if (span <= 0) {
      var pad = Math.max(1e-6, Math.abs(hi) * 0.01);
      return [lo - pad, hi + pad];
    }
    return [lo - span * 0.06, hi + span * 0.06];
  }

  function toRgb(c) {
    if (c[0] === '#') {
      return [
        parseInt(c.slice(1, 3), 16),
        parseInt(c.slice(3, 5), 16),
        parseInt(c.slice(5, 7), 16),
      ];
    }
    var m = c.match(/\d+/g);
    return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
  }

  function withAlpha(c, a) {
    var r = toRgb(c);
    return 'rgba(' + r[0] + ',' + r[1] + ',' + r[2] + ',' + a + ')';
  }

  function lerpColor(a, b, t) {
    var A = toRgb(a);
    var B = toRgb(b);
    return 'rgb(' +
      Math.round(A[0] + (B[0] - A[0]) * t) + ',' +
      Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
      Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  }

  /* Diverging scale for the correlation matrix: an odd bucket count puts a
     true neutral at the centre, so zero correlation reads as the ground rather
     than as a weak signal in either direction. */
  var BUCKETS = 17;
  var NEUTRAL = 8;

  function bucketFor(r) {
    var safe = isFinite(r) ? Math.max(-1, Math.min(1, r)) : 0;
    return Math.max(0, Math.min(BUCKETS - 1, Math.round(((safe + 1) / 2) * (BUCKETS - 1))));
  }

  /** Blend from neutral toward whichever pole the bucket sits on. */
  function bucketColor(bucket, neutral, positive, negative) {
    var b = Math.max(0, Math.min(BUCKETS - 1, bucket));
    var dist = Math.abs(b - NEUTRAL) / NEUTRAL;
    return lerpColor(neutral, b >= NEUTRAL ? positive : negative, dist);
  }

  return {
    WINDOWS: WINDOWS,
    LINE_POINTS: LINE_POINTS,
    BUCKETS: BUCKETS,
    NEUTRAL: NEUTRAL,
    windowBars: windowBars,
    resampleToN: resampleToN,
    padDomain: padDomain,
    dayChange: dayChange,
    toRgb: toRgb,
    withAlpha: withAlpha,
    lerpColor: lerpColor,
    bucketFor: bucketFor,
    bucketColor: bucketColor,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChartMath;
