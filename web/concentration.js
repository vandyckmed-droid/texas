/* How concentrated a set of holdings is, from the correlation matrix the app
   already ships. Pure and unit-tested; the DOM layer only formats it. */
var Concentration = (function () {
  'use strict';

  /* --- correlation from raw closes ------------------------------------- *
     The shipped matrix covers only each mode's top 50, but search reaches the
     whole ranked universe, so a name starred from outside that set had no
     correlation and silently dropped out of the watchlist maths. Every close
     series is already in the payload, so the pair can simply be correlated on
     demand. This mirrors scripts/refresh.ts exactly -- daily log returns keyed
     by the later date, intersected on common dates, last CORR_WINDOW of them,
     and NaN below MIN_OVERLAP -- and a test checks it reproduces the
     precomputed matrix on real data. */
  var CORR_WINDOW = 126;
  var MIN_OVERLAP = 100;

  /** Daily log returns keyed by the date they land on. */
  function returnsByDate(chart) {
    var m = {};
    for (var i = 1; i < chart.c.length; i++) {
      m[chart.t[i]] = Math.log(chart.c[i] / chart.c[i - 1]);
    }
    return m;
  }

  function pearson(x, y) {
    var n = x.length;
    if (n !== y.length || n < 2) return NaN;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
    mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0;
    for (i = 0; i < n; i++) {
      var dx = x[i] - mx, dy = y[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return NaN;
    return sxy / Math.sqrt(sxx * syy);
  }

  /** Correlation of two already-computed return maps over the recent window. */
  function correlationFromReturns(a, b) {
    var common = [];
    for (var d in a) if (Object.prototype.hasOwnProperty.call(b, d)) common.push(+d);
    common.sort(function (p, q) { return p - q; });
    var recent = common.slice(-CORR_WINDOW);
    if (recent.length < MIN_OVERLAP) return NaN;
    return pearson(
      recent.map(function (d) { return a[d]; }),
      recent.map(function (d) { return b[d]; })
    );
  }

  /** Correlation of two charts. Returns are recomputed each call; callers that
   *  correlate one symbol against many should cache returnsByDate themselves. */
  function correlationOf(chartA, chartB) {
    return correlationFromReturns(returnsByDate(chartA), returnsByDate(chartB));
  }

  /**
   * Symmetric matrix over `charts`, unit diagonal, NaN pairs read as 0 -- the
   * same substitution the refresh script makes, so an unmeasurable pair is
   * treated as uncorrelated rather than poisoning every sum it appears in.
   */
  function correlationMatrixOf(charts) {
    var n = charts.length;
    var m = [];
    for (var i = 0; i < n; i++) { m.push(new Array(n).fill(0)); m[i][i] = 1; }
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var r = correlationOf(charts[a], charts[b]);
        if (!isFinite(r)) r = 0;
        m[a][b] = r;
        m[b][a] = r;
      }
    }
    return m;
  }

  /** Mean of the off-diagonal correlations among `idx` (positions in the matrix). */
  function avgPairwiseCorr(matrix, idx) {
    var n = idx.length;
    if (n < 2) return 0;
    var sum = 0;
    var pairs = 0;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var r = matrix[idx[i]][idx[j]];
        if (isFinite(r)) { sum += r; pairs++; }
      }
    }
    return pairs ? sum / pairs : 0;
  }

  /**
   * Effective number of independent bets in an equal-weighted set of n names
   * with average pairwise correlation rhoBar.
   *
   * An equal-weighted portfolio of n names with common volatility s and average
   * pairwise correlation r has variance (s^2/n)(1 + (n-1)r). A portfolio of k
   * genuinely independent names has variance s^2/k. Setting those equal gives
   * k = n / (1 + (n-1)r): six names at r = 0.6 carry the risk of 1.5.
   *
   * Clamped to [1, n]. A negative rhoBar can push the formula above n, which is
   * real hedging but reads as nonsense next to a list of n names, and the
   * denominator can even go non-positive.
   */
  function effectiveBets(n, rhoBar) {
    if (n <= 1) return n;
    var denom = 1 + (n - 1) * rhoBar;
    if (!(denom > 0)) return n;
    return Math.max(1, Math.min(n, n / denom));
  }

  /**
   * Splits `symbols` across the clusters of a correlation set, largest first.
   * Symbols the set does not cover (starred under the other ranking mode, so
   * absent from this one's top 50) come back separately rather than silently
   * skewing the maths.
   */
  function groupsOf(set, symbols) {
    var pos = {};
    for (var i = 0; i < set.tickers.length; i++) pos[set.tickers[i]] = i;

    var covered = [];
    var uncovered = [];
    symbols.forEach(function (s) {
      if (pos[s] === undefined) uncovered.push(s); else covered.push(s);
    });

    var byCluster = {};
    covered.forEach(function (s) {
      var p = pos[s];
      for (var c = 0; c < set.clusters.length; c++) {
        var cl = set.clusters[c];
        if (p >= cl.start && p < cl.start + cl.size) {
          (byCluster[cl.id] = byCluster[cl.id] || { id: cl.id, symbols: [] }).symbols.push(s);
          break;
        }
      }
    });

    var groups = Object.keys(byCluster).map(function (k) { return byCluster[k]; });
    groups.sort(function (a, b) {
      return b.symbols.length - a.symbols.length || a.id - b.id;
    });
    return { groups: groups, covered: covered, uncovered: uncovered, index: pos };
  }

  /**
   * Equal-weighted portfolio statistics for a set of holdings.
   *
   * `members` are {i, ret, vol}: i indexes the correlation matrix, ret is the
   * annualised blended momentum, vol the annualised realised volatility.
   *
   * Return is the mean of the members' returns. Variance is the full double
   * sum (1/n^2) * sum_i sum_j s_i s_j rho_ij -- averaging the members' vols
   * would assume they move together and overstate risk badly for a mixed set.
   * score is return over volatility: the same vol-adjusted ratio the app ranks
   * by, so a portfolio score is directly comparable to a single stock's.
   */
  function portfolioStats(matrix, members) {
    var n = members.length;
    if (!n) return null;
    var ret = 0;
    for (var k = 0; k < n; k++) ret += members[k].ret;
    ret /= n;

    var varSum = 0;
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        var rho = a === b ? 1 : matrix[members[a].i][members[b].i];
        if (!isFinite(rho)) rho = 0;
        varSum += members[a].vol * members[b].vol * rho;
      }
    }
    var vol = Math.sqrt(Math.max(0, varSum)) / n;
    return { ret: ret, vol: vol, score: vol > 0 ? ret / vol : 0, n: n };
  }

  /**
   * Change in the portfolio's score from adding `candidate` to `held`.
   *
   * This is the decision the textbook rule (add when SR_new > SR_p * rho(new,p))
   * resolves to, evaluated directly on the equal-weighted book the reader
   * actually holds rather than on an optimally re-weighted one. Positive means
   * the name earns its place; negative means skip it however high it ranks.
   */
  function deltaOnAdd(matrix, held, candidate) {
    var base = portfolioStats(matrix, held);
    var next = portfolioStats(matrix, held.concat([candidate]));
    if (!base || !next) return null;
    return next.score - base.score;
  }

  /** Change in the portfolio's score from dropping the member at `pos`. */
  function deltaOnRemove(matrix, held, pos) {
    if (held.length < 2) return null;
    var base = portfolioStats(matrix, held);
    var rest = held.slice(0, pos).concat(held.slice(pos + 1));
    var next = portfolioStats(matrix, rest);
    if (!base || !next) return null;
    return next.score - base.score;
  }

  return {
    CORR_WINDOW: CORR_WINDOW,
    MIN_OVERLAP: MIN_OVERLAP,
    pearson: pearson,
    returnsByDate: returnsByDate,
    correlationOf: correlationOf,
    correlationFromReturns: correlationFromReturns,
    correlationMatrixOf: correlationMatrixOf,
    avgPairwiseCorr: avgPairwiseCorr,
    effectiveBets: effectiveBets,
    groupsOf: groupsOf,
    portfolioStats: portfolioStats,
    deltaOnAdd: deltaOnAdd,
    deltaOnRemove: deltaOnRemove,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Concentration;
