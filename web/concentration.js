/* How concentrated a set of holdings is, from the correlation matrix the app
   already ships. Pure and unit-tested; the DOM layer only formats it. */
var Concentration = (function () {
  'use strict';

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

  return {
    avgPairwiseCorr: avgPairwiseCorr,
    effectiveBets: effectiveBets,
    groupsOf: groupsOf,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Concentration;
