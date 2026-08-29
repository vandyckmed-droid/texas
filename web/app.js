/* Momentum — S&P 500 momentum ranker over a static snapshot.

   The price chart is a line only. Candles were cut deliberately: every figure
   the app reports (12–1, 6–1, blended, 126-day volatility, the ranks) comes
   from adjusted closes, and the intraday range candles would add is already
   on screen as the 52-week range. They also could not animate between windows
   the way the line does — a window change alters the bar count, so there is
   nothing to interpolate, and they jumped where the line morphs. Charts
   therefore ship close-only, which is most of the payload saved. */
(function () {
  'use strict';
  var D = window.DATA;

  // ---------- persistence (per-viewer; safe when storage is unavailable) ----
  function loadLS(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function saveLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

  var S = {
    tab: 'ranks',
    mode: loadLS('texas.web.mode', 'blended'),
    rowViz: loadLS('texas.web.rowViz', 'range'),
    appearance: loadLS('texas.web.appearance', 'system'),
    watch: loadLS('texas.web.watch', []),
    showAll: loadLS('texas.web.showAll', false),
    stack: [], // pushed routes: {screen:'ticker'|'correlation', params}
  };

  function applyAppearance() {
    var root = document.documentElement;
    if (S.appearance === 'system') delete root.dataset.theme;
    else root.dataset.theme = S.appearance;
  }
  applyAppearance();

  // ---------- helpers ----------
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function money(v) { return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%'; }
  function ratio(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2); }
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function longDate(iso) { var p = iso.split('-'); return MONTHS[+p[1]-1] + ' ' + (+p[2]) + ', ' + p[0]; }
  function dayLong(t) { var m = Math.floor(t/100)%100, d = t%100; return MONTHS[m-1]+' '+d+', '+Math.floor(t/10000); }
  /**
   * Calendar days since the snapshot's asOf date. Momentum ranks computed from
   * three-week-old closes are actively misleading, and until now nothing on
   * screen said how old they were.
   */
  var STALE_DAYS = 8;   // roughly a trading week plus a weekend
  var VERY_STALE_DAYS = 22;
  function snapshotAgeDays() {
    var p = D.meta.asOf.split('-');
    var asOf = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(0, Math.round((today - asOf) / 86400000));
  }
  function ageNote() {
    var d = snapshotAgeDays();
    if (d < STALE_DAYS) return null;
    return { days: d, severe: d >= VERY_STALE_DAYS };
  }

  function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }

  // ---------- data accessors (mirrors src/data/store.ts) ----------
  var bySymbol = {};
  D.rankings.stocks.forEach(function (s) { bySymbol[s.symbol] = s; });
  function rankOf(s, mode) { return mode === 'blended' ? s.rankBlended : s.rankVolAdj; }
  function top50(mode) {
    return D.rankings.stocks.slice().sort(function (a, b) { return rankOf(a, mode) - rankOf(b, mode); }).slice(0, 50);
  }
  // Charts store a calendar id rather than their own dates: almost every
  // symbol shares one 253-day trading calendar, and repeating it per symbol
  // was more than half the payload. Rehydrated once, then cached.
  var chartCache = {};
  function getChart(sym) {
    var st = bySymbol[sym];
    var key = st ? st.fileKey : sym.replace(/\./g, '-');
    if (chartCache[key]) return chartCache[key];
    var raw = D.charts[key];
    if (!raw) return null;
    chartCache[key] = { t: D.calendars[raw.cal], c: raw.c };
    return chartCache[key];
  }
  function corrSet(mode) {
    for (var i = 0; i < D.correlation.sets.length; i++) if (D.correlation.sets[i].mode === mode) return D.correlation.sets[i];
    return null;
  }
  /**
   * Symbol-prefix first, then name substring. Someone typing "MU" wants Micron
   * ahead of every name containing those letters, so an exact symbol sorts to
   * the top and prefix matches ahead of name matches; ties fall back to rank.
   */
  function searchMatches(query) {
    var q = query.trim().toUpperCase();
    if (!q) return [];
    var scored = [];
    D.rankings.stocks.forEach(function (s) {
      var sym = s.symbol.toUpperCase();
      var name = s.name.toUpperCase();
      var tier = sym === q ? 0
        : sym.indexOf(q) === 0 ? 1
        : name.indexOf(q) === 0 ? 2
        : sym.indexOf(q) >= 0 ? 3
        : name.indexOf(q) >= 0 ? 4
        : -1;
      if (tier >= 0) scored.push({ s: s, tier: tier });
    });
    scored.sort(function (a, b) {
      return a.tier - b.tier || rankOf(a.s, S.mode) - rankOf(b.s, S.mode);
    });
    return scored.map(function (x) { return x.s; });
  }

  function orderedSymbols(list) {
    if (!list) return [];
    if (list.indexOf('search:') === 0) {
      return searchMatches(list.slice(7)).map(function (s) { return s.symbol; });
    }
    if (list === 'watchlist') {
      return S.watch.filter(function (s) { return bySymbol[s]; })
        .sort(function (a, b) { return rankOf(bySymbol[a], S.mode) - rankOf(bySymbol[b], S.mode); });
    }
    if (list.indexOf('ranks:') === 0) {
      var parts = list.slice(6).split(':');
      var ordered = D.rankings.stocks.slice().sort(function (a, b) {
        return rankOf(a, parts[0]) - rankOf(b, parts[0]);
      });
      if (parts[1] !== 'all') ordered = ordered.slice(0, 50);
      return ordered.map(function (st) { return st.symbol; });
    }
    if (list.indexOf('solo:') === 0) {
      var sset = corrSet(list.slice(5));
      if (!sset) return [];
      return sset.clusters.filter(function (c) { return c.size === 1; })
        .map(function (c) { return sset.tickers[c.start]; });
    }
    if (list.indexOf('cluster:') === 0) {
      var p = list.split(':'), set = corrSet(p[1]);
      if (!set) return [];
      for (var i = 0; i < set.clusters.length; i++) {
        var c = set.clusters[i];
        if (c.id === +p[2]) return set.tickers.slice(c.start, c.start + c.size);
      }
    }
    return [];
  }

  // ---------- chart maths (web/chartmath.js — pure, and unit-tested) -------
  var M = ChartMath;
  var LINE_POINTS = M.LINE_POINTS, BUCKETS = M.BUCKETS, WINDOWS = M.WINDOWS;
  var windowBars = M.windowBars, resampleToN = M.resampleToN, padDomain = M.padDomain;
  var withAlpha = M.withAlpha, lerpColor = M.lerpColor, bucketFor = M.bucketFor;
  var dayChange = M.dayChange;

  /** Bucket colour against the live theme, which only the DOM can supply. */
  function bucketColor(b) {
    return M.bucketColor(b, css('--corr-neu'), css('--corr-pos'), css('--corr-neg'));
  }

  // ---------- navigation (history-integrated so edge-swipe back works) -----
  var app = document.getElementById('app');
  function push(route) { S.stack.push(route); history.pushState({ d: S.stack.length }, ''); render(); }
  function back() { history.back(); }
  window.addEventListener('popstate', function () { if (S.stack.length) S.stack.pop(); render('fromleft'); });

  // ---------- shared components ----------
  function segmented(options, value, compact, onChange) {
    var seg = h('div', 'seg' + (compact ? ' compact' : ''));
    options.forEach(function (o) {
      var b = h('button', o.value === value ? 'on' : '', o.label);
      b.onclick = function () { if (o.value !== value) { haptic(); onChange(o.value); } };
      seg.appendChild(b);
    });
    return seg;
  }
  /* Repaints itself rather than re-rendering the screen. render() rebuilds the
     whole subtree, so the .screen element is new and its scrollTop is zero —
     starring row 30 used to throw you back to row 1. Only the watchlist needs
     a rebuild, because the row it just unstarred has to leave; it passes an
     onToggle that keeps the scroll position. */
  function starBtn(sym, onToggle) {
    var b = h('button', 'star num');
    function paint() {
      var on = S.watch.indexOf(sym) >= 0;
      b.className = 'star num' + (on ? ' on' : '');
      b.textContent = on ? '★' : '☆';
      b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + sym + (on ? ' from watchlist' : ' to watchlist'));
    }
    paint();
    b.onclick = function (e) {
      e.stopPropagation();
      haptic();
      var i = S.watch.indexOf(sym);
      if (i >= 0) S.watch.splice(i, 1); else S.watch.push(sym);
      saveLS('texas.web.watch', S.watch);
      if (onToggle) onToggle(); else paint();
    };
    return b;
  }
  function rangeBar(s) {
    var w = h('div', 'rangebar');
    w.appendChild(h('i', 'track'));
    var span = s.wk52High - s.wk52Low;
    var p = span > 0 ? Math.min(1, Math.max(0, (s.price - s.wk52Low) / span)) : 0.5;
    var dot = h('i', 'dot');
    dot.style.left = (p * 65).toFixed(1) + 'px';
    w.appendChild(dot);
    return w;
  }
  /**
   * 6-1 momentum against 12-1: a bar left of centre means the recent half is
   * weaker than the year, so the move is fading.
   *
   * Worth its own view because blending hides it. A name can sit near the top
   * of the ranking on a huge 12-1 while its last six months are flat or
   * negative -- the blend averages the two and reports a strong score for a
   * trend that has already turned.
   *
   * Scaled by tanh rather than clipped: spreads run past 200 points either
   * way, and a linear scale would peg most of the list at the ends. This is
   * presentation only and changes no ranking.
   */
  var TREND_SCALE = 1.0; // spread, in annualised return, that reaches ~76% width
  function trendBar(s) {
    var w = h('div', 'trend');
    w.appendChild(h('i', 'axis'));
    var spread = s.m6 - s.m12;
    var t = Math.tanh(spread / TREND_SCALE);
    var half = 35;
    var len = Math.max(1.5, Math.abs(t) * half);
    var bar = h('i', 'fill');
    bar.style.cssText = 'height:6px;top:10px;width:' + len.toFixed(1) + 'px;' +
      (t >= 0 ? 'left:36px;' : 'left:' + (36 - len).toFixed(1) + 'px;') +
      'background:var(--' + (t >= 0 ? 'pos' : 'neg') + ')';
    w.appendChild(bar);
    w.title = '6–1 ' + pct(s.m6) + ' vs 12–1 ' + pct(s.m12) +
      ' — ' + (spread >= 0 ? 'accelerating' : 'fading');
    return w;
  }

  function rollingBars(s) {
    var w = h('div', 'rolling');
    w.appendChild(h('i', 'base'));
    var n = s.rolling.length, slot = 72 / n, bw = Math.max(1.5, slot - 1);
    s.rolling.forEach(function (v, i) {
      if (v === null) return;
      var bar = h('i');
      var hh = Math.max(1.5, (Math.abs(v) / 2) * 13);
      bar.style.cssText = 'left:' + (i * slot).toFixed(1) + 'px;width:' + bw.toFixed(1) + 'px;height:' + hh.toFixed(1) +
        'px;top:' + (v >= 0 ? 13 - hh : 13).toFixed(1) + 'px;background:var(--' + (v >= 0 ? 'pos' : 'neg') + ')';
      w.appendChild(bar);
    });
    return w;
  }
  function stockRow(s, rank, list, onStar) {
    var row = h('button', 'row');
    row.appendChild(h('span', 'rank num', String(rank)));
    var nc = h('div', 'namecol');
    nc.appendChild(h('div', 'sym', s.symbol));
    nc.appendChild(h('div', 'nm', s.name));
    row.appendChild(nc);
    var viz = h('span', 'viz');
    viz.appendChild(S.rowViz === 'impact' ? deltaChip(s.symbol)
      : S.rowViz === 'day' ? dayChip(s.symbol)
      : S.rowViz === 'trend' ? trendBar(s)
      : S.rowViz === 'range' ? rangeBar(s) : rollingBars(s));
    row.appendChild(viz);
    var pc = h('span', 'pricecol');
    pc.appendChild(h('div', 'px num', money(s.price)));
    var val = S.mode === 'blended' ? s.blended : s.volAdj;
    pc.appendChild(h('div', 'score num ' + (val >= 0 ? 'pos' : 'neg'),
      S.mode === 'blended' ? pct(s.blended) : ratio(s.volAdj)));
    row.appendChild(pc);
    row.appendChild(starBtn(s.symbol, onStar));
    row.appendChild(h('i', 'hair'));
    row.onclick = function () { push({ screen: 'ticker', params: { symbol: s.symbol, list: list } }); };
    return row;
  }
  function emptyState(icon, title, hint) {
    var e = h('div', 'empty');
    e.appendChild(h('div', 'ic', icon));
    e.appendChild(h('div', 't', title));
    if (hint) e.appendChild(h('div', 'h', hint));
    return e;
  }
  function tabBar() {
    var bar = h('div', 'tabbar');
    [['ranks', '▤', 'Ranks'], ['watchlist', '★', 'Watchlist'], ['settings', '⚙', 'Settings']]
      .forEach(function (t) {
        var b = h('button', S.tab === t[0] ? 'on' : '');
        b.appendChild(h('span', 'ticon', t[1]));
        b.appendChild(h('span', '', t[2]));
        b.onclick = function () { if (S.tab !== t[0]) { S.tab = t[0]; render(); } };
        bar.appendChild(b);
      });
    return bar;
  }

  // ---------- Ranks ----------
  function ranksScreen() {
    var sc = h('div', 'screen');
    // No big title on a tabbed screen: the tab bar already names it, and a
    // 31px heading repeating the label cost a row of stocks.
    var hdr = h('div', 'hdr');
    var age = ageNote();
    var sub = h('div', 'sub', (S.showAll ? 'All ' + D.meta.rankedCount : 'Top 50 of ' + D.meta.rankedCount) +
      ' · ' + longDate(D.meta.asOf));
    if (age) {
      var warn = h('span', 'stale' + (age.severe ? ' severe' : ''),
        ' · ' + age.days + ' days old');
      warn.title = 'Ask Claude Code to refresh the snapshot';
      sub.appendChild(warn);
    }
    hdr.appendChild(sub);
    var find = h('button', 'iconbtn', '⌕');
    find.setAttribute('aria-label', 'Search all stocks');
    find.onclick = function () { push({ screen: 'search', params: {} }); };
    hdr.appendChild(find);
    var grid = h('button', 'iconbtn', '▦');
    grid.setAttribute('aria-label', 'Correlation and groups');
    grid.onclick = function () { push({ screen: 'correlation', params: {} }); };
    hdr.appendChild(grid);
    sc.appendChild(hdr);
    var sw = h('div', 'segwrap');
    sw.appendChild(segmented(
      [{ value: 'blended', label: 'Momentum' }, { value: 'volAdj', label: 'Vol-adjusted' }],
      S.mode, false,
      function (v) { S.mode = v; saveLS('texas.web.mode', v); render(); }
    ));
    sc.appendChild(sw);
    var ranked = D.rankings.stocks.slice().sort(function (a, b) {
      return rankOf(a, S.mode) - rankOf(b, S.mode);
    });
    var shown = S.showAll ? ranked : ranked.slice(0, 50);
    var list = h('div');
    shown.forEach(function (st) {
      list.appendChild(stockRow(st, rankOf(st, S.mode), 'ranks:' + S.mode + (S.showAll ? ':all' : '')));
    });
    sc.appendChild(list);

    // The 50-row cut-off was a payload constraint before every name shipped.
    // Now it is only a default, so it is worth being able to pass.
    if (ranked.length > 50) {
      var more = h('button', 'more', S.showAll
        ? 'Show top 50 only'
        : 'Show all ' + ranked.length);
      more.onclick = function () {
        haptic();
        S.showAll = !S.showAll;
        saveLS('texas.web.showAll', S.showAll);
        render();
      };
      sc.appendChild(more);
    }
    return sc;
  }

  // ---------- Watchlist ----------
  /* --- watchlist maths, over correlations computed here ------------------
     The shipped matrix covers only each mode's top 50, so once search could
     reach all 500 names, starring one from outside that set silently dropped
     it from every calculation below. Correlations are now computed from the
     close series already in the payload, which covers any pair.

     Two caches, because the ranks screen asks for one candidate against the
     whole watchlist on every row: return maps per symbol, and correlations
     per pair. */
  var retCache = {};
  var pairCache = {};

  function returnsOf(sym) {
    if (!(sym in retCache)) {
      var ch = getChart(sym);
      retCache[sym] = ch ? Concentration.returnsByDate(ch) : null;
    }
    return retCache[sym];
  }

  function corrBetween(a, b) {
    if (a === b) return 1;
    var key = a < b ? a + '|' + b : b + '|' + a;
    if (key in pairCache) return pairCache[key];
    var ra = returnsOf(a), rb = returnsOf(b);
    var r = ra && rb ? Concentration.correlationFromReturns(ra, rb) : NaN;
    // An unmeasurable pair reads as uncorrelated, matching the refresh script
    // rather than poisoning every sum it appears in.
    pairCache[key] = isFinite(r) ? r : 0;
    return pairCache[key];
  }

  /** Members and their correlation matrix, for any set of symbols. */
  function bookOf(symbols) {
    var members = [];
    symbols.forEach(function (sym) {
      var st = bySymbol[sym];
      if (st && getChart(sym)) members.push({ symbol: sym, ret: st.blended, vol: st.vol, i: 0 });
    });
    members.forEach(function (m, i) { m.i = i; });
    var n = members.length;
    var matrix = [];
    for (var i = 0; i < n; i++) { matrix.push(new Array(n).fill(0)); matrix[i][i] = 1; }
    for (var a = 0; a < n; a++) {
      for (var b = a + 1; b < n; b++) {
        var r = corrBetween(members[a].symbol, members[b].symbol);
        matrix[a][b] = r;
        matrix[b][a] = r;
      }
    }
    return { members: members, matrix: matrix };
  }

  /**
   * What this name is worth to the watchlist, in points of its score.
   *
   * One polarity for both cases, which matters more than it looks: for a name
   * held this is what would be LOST by dropping it, and for one not held it is
   * what would be GAINED by adding it. Both are the same question asked of a
   * book that contains the name -- what does removing it do -- so both take
   * the same code path, negated once.
   *
   * Null where the answer is undefined: a book of fewer than two names, or a
   * symbol with no chart to correlate.
   */
  function worthOf(sym) {
    var syms = S.watch.indexOf(sym) >= 0 ? S.watch : S.watch.concat([sym]);
    var book = bookOf(syms);
    if (book.members.length < 2) return null;
    var idx = -1;
    for (var k = 0; k < book.members.length; k++) if (book.members[k].symbol === sym) { idx = k; break; }
    if (idx < 0) return null;
    var drop = Concentration.deltaOnRemove(book.matrix, book.members, idx);
    return drop === null ? null : -drop;
  }

  /**
   * Move over the snapshot's final session, from the closes already shipped.
   * Labelled "last session" rather than "today" on purpose: the snapshot can be
   * days old, and a percentage implies currency far more strongly than a chart
   * does. The header's date and staleness warning carry the rest of the context.
   */
  /** Anything rounding to zero is flat, not a tiny loss: "−0.00%" is noise. */
  function dayText(chart) {
    var d = chart ? dayChange(chart.c) : null;
    if (d === null) return '—';
    var p = d * 100;
    if (Math.abs(p) < 0.005) return '0.00%';
    return (p > 0 ? '+' : '−') + Math.abs(p).toFixed(2) + '%';
  }
  function dayTone(chart) {
    var d = chart ? dayChange(chart.c) : null;
    if (d === null || Math.abs(d * 100) < 0.005) return '';
    return d > 0 ? 'pos' : 'neg';
  }

  function dayChip(sym) {
    var ch = getChart(sym);
    var el = h('div', 'delta num', dayText(ch));
    var tone = dayTone(ch);
    el.className = 'delta num' + (tone ? ' ' + tone : ' none');
    el.title = sym + ' over the last session in this snapshot (' + longDate(D.meta.asOf) + ')';
    return el;
  }

  function deltaChip(sym) {
    var d = worthOf(sym);
    var el = h('div', 'delta num');
    if (d === null) { el.className = 'delta num none'; el.textContent = '·'; return el; }
    // Anything that rounds to zero is neutral, not negative: "−0.00" is noise.
    if (Math.abs(d) < 0.005) {
      el.className = 'delta num none';
      el.textContent = '0.00';
      el.title = sym + ' makes no material difference either way';
      return el;
    }
    var sign = d > 0 ? '+' : '−';
    el.textContent = sign + Math.abs(d).toFixed(2);
    el.className = 'delta num ' + (d > 0 ? 'pos' : 'neg');
    el.title = S.watch.indexOf(sym) >= 0
      ? 'Dropping ' + sym + ' would move your score by ' + (d >= 0 ? '−' : '+') + Math.abs(d).toFixed(2)
      : 'Starring ' + sym + ' would move your score by ' + sign + Math.abs(d).toFixed(2);
    return el;
  }

  /**
   * How much of one bet the watchlist actually is. Counting names overstates
   * diversification when they move together, so the headline is the effective
   * number of independent bets; the bar shows how the names split across the
   * correlation groups, and the note names the largest overlap.
   */
  function concentrationBlock(symbols) {
    var book = bookOf(symbols);
    if (book.members.length < 2) return null;

    var idx = book.members.map(function (m) { return m.i; });
    var rho = Concentration.avgPairwiseCorr(book.matrix, idx);
    var bets = Concentration.effectiveBets(book.members.length, rho);

    var box = h('div', 'conc');
    var top = h('div', 'conc-top');
    var shown = bets.toFixed(1);
    top.appendChild(h('div', 'conc-n num', shown));
    var lbl = h('div', 'conc-lbl');
    // Singular only when the number actually displayed is 1.0.
    lbl.appendChild(h('div', 't', shown === '1.0' ? 'independent bet' : 'independent bets'));
    lbl.appendChild(h('div', 'm num', book.members.length + ' names · avg ρ ' + ratio(rho)));
    top.appendChild(lbl);
    box.appendChild(top);

    // The group split still comes from the precomputed clustering, which only
    // covers this mode's top 50. The headline above no longer depends on it,
    // so a watchlist reaching outside the ranking still gets its score -- it
    // just cannot be broken into groups that were never computed for it.
    var set = corrSet(S.mode);
    var split = set ? Concentration.groupsOf(set, symbols) : null;
    if (split && split.groups.length) {
      // One segment per group, width proportional to how many names sit in it.
      // Deliberately one neutral tone at descending strength rather than the
      // gain/loss or correlation hues: a wide leading segment is the signal,
      // and green here would read as 'good' when it means the opposite.
      var bar = h('div', 'conc-bar');
      split.groups.forEach(function (g, i) {
        var seg = h('i');
        seg.style.flex = String(g.symbols.length);
        seg.style.opacity = String(Math.max(0.22, 1 - i * 0.26));
        seg.title = g.symbols.join(', ');
        bar.appendChild(seg);
      });
      box.appendChild(bar);

      var big = split.groups[0];
      var note = big.symbols.length < 2
        ? 'No two of these move as a group — ' + split.groups.length + ' separate bets.'
        : big.symbols.length + ' of them move as one: ' + big.symbols.join(' · ');
      if (split.uncovered.length) {
        note += ' (' + split.uncovered.length + ' outside this mode’s top 50, not grouped)';
      }
      box.appendChild(h('div', 'conc-note', note));
    }

    // Which one to drop, rather than leaving the reader to try each in turn.
    var best = null;
    book.members.forEach(function (m, k) {
      var d = Concentration.deltaOnRemove(book.matrix, book.members, k);
      if (d !== null && (best === null || d > best.d)) best = { sym: m.symbol, d: d };
    });
    if (best && best.d > 0.005) {
      box.appendChild(h('div', 'conc-drop',
        'Dropping ' + best.sym + ' would help most: +' + best.d.toFixed(2)));
    } else if (best) {
      box.appendChild(h('div', 'conc-drop', 'Every name is currently earning its place.'));
    }
    return box;
  }

  function watchlistScreen() {
    var sc = h('div', 'screen');
    var present = orderedSymbols('watchlist');
    if (!present.length) {
      sc.appendChild(emptyState('☆', 'Nothing watched yet', 'Tap the star on any stock in Ranks to add it here.'));
      return sc;
    }
    // The concentration card already opens with the count, so the header only
    // earns its line when there is no card (a single name, or none ranked).
    var conc = concentrationBlock(present);
    if (conc) {
      sc.appendChild(conc);
    } else {
      var hdr = h('div', 'hdr');
      hdr.appendChild(h('div', 'sub', present.length + (present.length === 1 ? ' stock' : ' stocks')));
      sc.appendChild(hdr);
    }
    var list = h('div');
    present.forEach(function (sym) {
      var s = bySymbol[sym];
      var r = stockRow(s, rankOf(s, S.mode), 'watchlist', renderKeepingScroll);
      if (S.rowViz !== 'impact') {
        var viz = r.querySelector('.viz');
        viz.textContent = '';
        viz.appendChild(deltaChip(sym));
      }
      list.appendChild(r);
    });
    sc.appendChild(list);
    return sc;
  }

  // ---------- Settings ----------
  function settingsScreen() {
    var sc = h('div', 'screen');
    sc.appendChild(h('div', 'sect', 'ROW VISUALIZATION'));
    var vizCard = h('div', 'setcard');
    [['range', '52-week range', 'Low, high, and latest price'],
     ['rolling', 'Rolling blended score', 'Momentum score through time'],
     ['day', 'Last session move', 'Change over the snapshot’s final trading day'],
     ['trend', 'Accelerating or fading', '6–1 momentum against 12–1'],
     ['impact', 'Watchlist impact', 'What starring or dropping it does to your score']].forEach(function (opt) {
      var on = S.rowViz === opt[0];
      var row = h('button', 'setrow' + (on ? ' on' : ''));
      var sl = h('span', 'sl');
      sl.appendChild(h('div', 't', opt[1]));
      sl.appendChild(h('div', 'h', opt[2]));
      row.appendChild(sl);
      var prev = h('span', 'prev');
      var sample = top50(S.mode)[0];
      prev.appendChild(opt[0] === 'impact' ? deltaChip(sample.symbol)
        : opt[0] === 'day' ? dayChip(sample.symbol)
        : opt[0] === 'trend' ? trendBar(sample)
        : opt[0] === 'range' ? rangeBar(sample) : rollingBars(sample));
      row.appendChild(prev);
      row.appendChild(h('span', 'radio', on ? '◉' : '○'));
      row.onclick = function () { haptic(); S.rowViz = opt[0]; saveLS('texas.web.rowViz', opt[0]); render(); };
      vizCard.appendChild(row);
    });
    sc.appendChild(vizCard);

    sc.appendChild(h('div', 'sect', 'APPEARANCE'));
    var apCard = h('div', 'setcard setpad');
    apCard.appendChild(segmented(
      [{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }],
      S.appearance, false,
      function (v) { S.appearance = v; saveLS('texas.web.appearance', v); applyAppearance(); render(); }
    ));
    sc.appendChild(apCard);

    sc.appendChild(h('div', 'sect', 'DATA'));
    var dCard = h('div', 'setcard');
    [['As of', longDate(D.meta.asOf)],
     ['Generated', longDate(D.meta.generatedAt.slice(0, 10))],
     ['Universe', D.meta.universeCount + ' stocks · ' + D.meta.rankedCount + ' ranked'],
     ['Source', 'FMP (adjusted daily)']].forEach(function (kv) {
      var r = h('div', 'inforow');
      r.appendChild(h('span', '', kv[0]));
      r.appendChild(h('span', 'v num', kv[1]));
      dCard.appendChild(r);
    });
    sc.appendChild(dCard);
    sc.appendChild(h('div', 'foot',
      'Data is a static snapshot. It updates only when you ask Claude Code to run a refresh. ' +
      'Web build — charts cover the top-50 lists of both modes.'));
    return sc;
  }

  // ---------- Ticker ----------
  var tickerState = { win: '6M' };
  function tickerScreen(params, anim) {
    var sym = params.symbol, list = params.list;
    var s = bySymbol[sym], chart = getChart(sym);
    var sc = h('div', 'screen');

    var thdr = h('div', 'thdr');
    var bb = h('button', 'backbtn', '‹');
    bb.setAttribute('aria-label', 'Back');
    bb.onclick = back;
    thdr.appendChild(bb);
    if (!s || !chart) {
      sc.appendChild(thdr);
      sc.appendChild(emptyState('○', sym || 'Unknown', 'No chart data for this symbol in the web build.'));
      return sc;
    }
    var tt = h('div', 'tt');
    tt.appendChild(h('div', 'tsym', s.symbol));
    tt.appendChild(h('div', 'tname', s.name));
    thdr.appendChild(tt);
    thdr.appendChild(starBtn(s.symbol));
    var nav = orderedSymbols(list);
    var navIdx = nav.indexOf(sym);
    if (nav.length > 1) {
      var grp = h('div', 'navgrp');
      var prev = h('button', '', '‹');
      prev.disabled = navIdx <= 0;
      prev.onclick = function () { go(-1); };
      var pos = h('span', 'navpos num', (navIdx + 1) + '/' + nav.length);
      var next = h('button', '', '›');
      next.disabled = navIdx < 0 || navIdx >= nav.length - 1;
      next.onclick = function () { go(1); };
      grp.appendChild(prev); grp.appendChild(pos); grp.appendChild(next);
      thdr.appendChild(grp);
    }
    function go(dir) {
      var to = nav[navIdx + dir];
      if (!to) return;
      haptic();
      S.stack[S.stack.length - 1] = { screen: 'ticker', params: { symbol: to, list: list } };
      render(dir > 0 ? 'fromright' : 'fromleft');
    }
    sc.appendChild(thdr);

    var body = h('div', 'tickerbody' + (anim ? ' ' + anim : ''));

    var pb = h('div', 'priceblock');
    var bigEl = h('div', 'bigpx num', money(s.price));
    var roEl = h('div', 'readout num');
    pb.appendChild(bigEl); pb.appendChild(roEl);
    body.appendChild(pb);

    var wrap = h('div', 'chartwrap');
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    body.appendChild(wrap);

    var controls = h('div', 'controls');
    var winWrap = h('div', 'win');
    controls.appendChild(winWrap);
    body.appendChild(controls);

    var stats = h('div', 'stats');
    [['Blended momentum', pct(s.blended), s.blended >= 0 ? 'pos' : 'neg'],
     ['Vol-adjusted', ratio(s.volAdj), s.volAdj >= 0 ? 'pos' : 'neg'],
     ['12–1 momentum', pct(s.m12), ''],
     ['6–1 momentum', pct(s.m6), ''],
     ['Last session', dayText(chart), dayTone(chart)],
     ['6–1 vs 12–1', pct(s.m6 - s.m12), s.m6 >= s.m12 ? 'pos' : 'neg'],
     ['Volatility (126d)', (s.vol * 100).toFixed(1) + '%', ''],
     ['52-week range', money(s.wk52Low) + ' – ' + money(s.wk52High), ''],
     ['Rank · momentum', '#' + s.rankBlended, ''],
     ['Rank · vol-adjusted', '#' + s.rankVolAdj, ''],
     ['Sector', s.sector, '']].forEach(function (st) {
      var cell = h('div', 'stat');
      cell.appendChild(h('div', 'l', st[0]));
      cell.appendChild(h('div', 'v num' + (st[2] ? ' ' + st[2] : ''), st[1]));
      stats.appendChild(cell);
    });
    body.appendChild(stats);
    sc.appendChild(body);

    // ----- chart engine -----
    var GUTTER = 46, PAD = 8, HEIGHT = 290;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var built = {}; // per window: {pts, lo, hi, up, n, slice}
    Object.keys(WINDOWS).forEach(function (key) {
      var n = windowBars(key, chart.c.length);
      var slice = chart.c.slice(chart.c.length - n);
      var dom = padDomain(Math.min.apply(null, slice), Math.max.apply(null, slice));
      built[key] = { pts: resampleToN(slice, LINE_POINTS), lo: dom[0], hi: dom[1],
        up: slice[n - 1] >= slice[0], n: n, slice: slice };
    });
    var W = 0, plotW = 0, plotH = HEIGHT - 2 * PAD;
    var ctx = canvas.getContext('2d');
    function sizeCanvas() {
      W = Math.min(app.clientWidth, 520);
      canvas.width = W * dpr; canvas.height = HEIGHT * dpr;
      canvas.style.height = HEIGHT + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      plotW = W - GUTTER;
    }
    sizeCanvas();

    var cur = { pts: built[tickerState.win].pts.slice(), lo: built[tickerState.win].lo, hi: built[tickerState.win].hi,
      color: built[tickerState.win].up ? css('--pos') : css('--neg') };
    var animFrom = null, animStart = 0, animDur = 0, raf = 0;
    var active = -1; // crosshair index within window

    function yFor(v, lo, hi) { return PAD + (1 - (v - lo) / (hi - lo)) * plotH; }

    function drawAxis(lo, hi, vmin, vmax) {
      ctx.strokeStyle = css('--sep'); ctx.fillStyle = css('--text-3');
      ctx.font = '500 10.5px -apple-system, sans-serif'; ctx.textAlign = 'right';
      [vmax, (vmin + vmax) / 2, vmin].forEach(function (v) {
        var y = yFor(v, lo, hi);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.lineWidth = 0.5; ctx.stroke();
        ctx.fillText(money(v), W - 4, y + 3.5);
      });
    }

    function draw() {
      ctx.clearRect(0, 0, W, HEIGHT);
      var t = 1;
      if (animFrom) {
        t = Math.min(1, (performance.now() - animStart) / animDur);
        var e = 1 - Math.pow(1 - t, 3); // cubic-out
        for (var i = 0; i < LINE_POINTS; i++)
          cur.pts[i] = animFrom.pts[i] + (animTo.pts[i] - animFrom.pts[i]) * e;
        cur.lo = animFrom.lo + (animTo.lo - animFrom.lo) * e;
        cur.hi = animFrom.hi + (animTo.hi - animFrom.hi) * e;
        cur.color = lerpColor(animFrom.hex, animTo.hex, e);
        if (t >= 1) animFrom = null;
      }
      var wk = built[tickerState.win];
      var vmin = Math.min.apply(null, wk.slice), vmax = Math.max.apply(null, wk.slice);
      drawAxis(cur.lo, cur.hi, vmin, vmax);
      ctx.beginPath();
      for (var k = 0; k < LINE_POINTS; k++) {
        var x = (k / (LINE_POINTS - 1)) * plotW, y = yFor(cur.pts[k], cur.lo, cur.hi);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.save();
      ctx.lineTo(plotW, HEIGHT - PAD); ctx.lineTo(0, HEIGHT - PAD); ctx.closePath();
      var grad = ctx.createLinearGradient(0, PAD, 0, HEIGHT);
      grad.addColorStop(0, withAlpha(cur.color, 0.18));
      grad.addColorStop(1, withAlpha(cur.color, 0));
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
      ctx.beginPath();
      for (var k2 = 0; k2 < LINE_POINTS; k2++) {
        var x2 = (k2 / (LINE_POINTS - 1)) * plotW, y2 = yFor(cur.pts[k2], cur.lo, cur.hi);
        if (k2 === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = cur.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      if (active >= 0) {
        var n = wk.n, ci = Math.min(active, n - 1);
        var cx = (ci / Math.max(1, n - 1)) * plotW, cy = yFor(wk.slice[ci], cur.lo, cur.hi);
        crosshair(cx, cy, cur.color);
      }
      if (animFrom) raf = requestAnimationFrame(draw);
    }
    function crosshair(cx, cy, color) {
      ctx.strokeStyle = css('--cross'); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, PAD); ctx.lineTo(cx, HEIGHT - PAD); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, 7); ctx.fillStyle = 'rgba(128,128,128,0.2)'; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 7); ctx.fillStyle = color; ctx.fill();
    }

    function setReadout() {
      var wk = built[tickerState.win];
      var n = wk.n, off = chart.c.length - n;
      var first = chart.c[off];
      var idx = active >= 0 && active < n ? active : null;
      var shown = idx === null ? s.price : chart.c[off + idx];
      var delta = shown - first, dp = first !== 0 ? delta / first : 0;
      bigEl.textContent = money(shown);
      var sign = delta >= 0 ? '+' : '−';
      if (idx === null) {
        roEl.textContent = sign + money(Math.abs(delta)) + ' (' + pct(dp) + ') · ' + tickerState.win;
        roEl.className = 'readout num ' + (delta >= 0 ? 'pos' : 'neg');
      } else {
        roEl.textContent = dayLong(chart.t[off + idx]) + ' · ' + sign + money(Math.abs(delta)) + ' (' + pct(dp) + ')';
        roEl.className = 'readout num ' + (delta >= 0 ? 'pos' : 'neg');
      }
    }

    var animTo = null;
    function switchWin(w) {
      var fromLine = { pts: cur.pts.slice(), lo: cur.lo, hi: cur.hi, hex: rgbToHex(cur.color) };
      tickerState.win = w;
      active = -1;
      animTo = { pts: built[w].pts, lo: built[w].lo, hi: built[w].hi,
        hex: built[w].up ? css('--pos') : css('--neg') };
      fromLine.hex = fromLine.hex || animTo.hex;
      animFrom = fromLine;
      animStart = performance.now();
      animDur = 350;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
      renderControls();
      setReadout();
    }
    function rgbToHex(c) {
      if (c[0] === '#') return c;
      var m = c.match(/\d+/g);
      if (!m) return null;
      return '#' + m.slice(0, 3).map(function (v) { return (+v).toString(16).padStart(2, '0'); }).join('');
    }
    function renderControls() {
      winWrap.textContent = '';
      winWrap.appendChild(segmented(
        [{value:'1M',label:'1M'},{value:'3M',label:'3M'},{value:'6M',label:'6M'},{value:'12M',label:'12M'}],
        tickerState.win, true, switchWin));
    }

    // crosshair pointer handling (canvas has touch-action:none)
    var lastIdx = -1;
    function pointIndex(e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var n = built[tickerState.win].n;
      return Math.max(0, Math.min(n - 1, Math.round((x / plotW) * (n - 1))));
    }
    function onDown(e) { active = pointIndex(e); if (active !== lastIdx) { haptic(); lastIdx = active; } draw(); setReadout(); }
    function onMove(e) { if (active < 0) return; var i = pointIndex(e); if (i !== active) { active = i; haptic(); draw(); setReadout(); } }
    function onUp() { active = -1; lastIdx = -1; draw(); setReadout(); }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    renderControls();
    setReadout();
    requestAnimationFrame(draw);
    return sc;
  }

  // ---------- Search ----------
  /**
   * Reaches the whole ranked universe, not just the top 50. A name that has
   * fallen out of the ranking is still one you may hold, and until now nothing
   * could open it.
   *
   * The input keeps focus across keystrokes by re-rendering only the results
   * list rather than the screen -- a full render would rebuild the field and
   * drop the keyboard on every character.
   */
  function searchScreen(params) {
    var sc = h('div', 'screen');
    var thdr = h('div', 'thdr');
    var bb = h('button', 'backbtn', '‹');
    bb.setAttribute('aria-label', 'Back');
    bb.onclick = back;
    thdr.appendChild(bb);

    var input = document.createElement('input');
    input.className = 'searchbox';
    input.type = 'search';
    input.placeholder = 'Symbol or company';
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = params.q || '';
    thdr.appendChild(input);
    sc.appendChild(thdr);

    var results = h('div', 'results');
    sc.appendChild(results);

    function paint() {
      var q = input.value;
      params.q = q; // survives a back-and-forward through the stack
      results.textContent = '';
      if (!q.trim()) {
        results.appendChild(emptyState('⌕', 'Search ' + D.meta.rankedCount + ' stocks',
          'Every ranked S&P 500 name, not just the top 50.'));
        return;
      }
      var hits = searchMatches(q);
      if (!hits.length) {
        results.appendChild(emptyState('⌕', 'No match for “' + q.trim() + '”',
          'Try a ticker symbol or part of a company name.'));
        return;
      }
      hits.slice(0, 40).forEach(function (st) {
        results.appendChild(stockRow(st, rankOf(st, S.mode), 'search:' + q));
      });
    }

    input.oninput = paint;
    paint();
    // Autofocus after the screen is in the document, or iOS ignores it.
    setTimeout(function () { input.focus(); }, 0);
    return sc;
  }

  // ---------- Correlation ----------
  var corrState = { focused: null, sel: null };
  function correlationScreen() {
    var set = corrSet(S.mode);
    var sc = h('div', 'screen');
    var thdr = h('div', 'thdr');
    var bb = h('button', 'backbtn', '‹');
    bb.setAttribute('aria-label', 'Back');
    bb.onclick = back;
    thdr.appendChild(bb);
    if (!set || set.tickers.length < 2) {
      sc.appendChild(thdr);
      sc.appendChild(emptyState('▦', 'No correlation data'));
      return sc;
    }
    // Title rides on the back row rather than claiming a block below it.
    var tt = h('div', 'tt');
    tt.appendChild(h('div', 'tsym', 'Correlation'));
    tt.appendChild(h('div', 'tname', 'Top ' + set.tickers.length + ' · 126-day window · ' + longDate(D.correlation.asOf)));
    thdr.appendChild(tt);
    sc.appendChild(thdr);
    var sw = h('div', 'segwrap');
    sw.appendChild(segmented(
      [{ value: 'blended', label: 'Momentum' }, { value: 'volAdj', label: 'Vol-adjusted' }],
      S.mode, false,
      function (v) { S.mode = v; saveLS('texas.web.mode', v); corrState.focused = null; corrState.sel = null; render(); }
    ));
    sc.appendChild(sw);

    // The same measure the watchlist carries, aimed at the ranking itself. A
    // momentum list is prone to becoming one trade held fifty ways, and the
    // matrix below shows that only to someone who already reads matrices.
    var all = [];
    set.tickers.forEach(function (t, i) {
      var st = bySymbol[t];
      if (st) all.push({ i: i, ret: st.blended, vol: st.vol });
    });
    if (all.length > 1) {
      var rhoAll = Concentration.avgPairwiseCorr(set.matrix, all.map(function (m) { return m.i; }));
      var betsAll = Concentration.effectiveBets(all.length, rhoAll);
      var line = h('div', 'corr-conc');
      line.appendChild(h('span', 'v num', betsAll.toFixed(1)));
      line.appendChild(h('span', 't', 'independent bets across these ' + all.length +
        ' names · avg ρ ' + ratio(rhoAll)));
      sc.appendChild(line);
    }

    var ro = h('div', 'corr-readout');
    function renderReadout() {
      ro.textContent = '';
      if (corrState.sel) {
        var i = corrState.sel[0], j = corrState.sel[1];
        var r = set.matrix[i][j];
        var head = h('div', 'cr-head');
        var swz = h('span', 'swatch');
        swz.style.background = bucketColor(bucketFor(r));
        head.appendChild(swz);
        head.appendChild(h('span', 'cr-pair', set.tickers[i] + ' × ' + set.tickers[j]));
        head.appendChild(h('span', 'cr-val num', 'ρ ' + ratio(r)));
        ro.appendChild(head);
        var na = bySymbol[set.tickers[i]], nb = bySymbol[set.tickers[j]];
        ro.appendChild(h('div', 'cr-names',
          i === j ? (na ? na.name : set.tickers[i])
                  : (na ? na.name : set.tickers[i]) + ' · ' + (nb ? nb.name : set.tickers[j])));
      } else {
        ro.appendChild(h('div', 'cr-pair', 'Tap the grid'));
        ro.appendChild(h('div', 'cr-names', 'Bright blocks on the diagonal are stocks that moved together.'));
      }
    }
    renderReadout();
    sc.appendChild(ro);

    var hw = h('div', 'heatwrap');
    var canvas = document.createElement('canvas');
    hw.appendChild(canvas);
    sc.appendChild(hw);
    var n = set.tickers.length;
    var sizePt = Math.min(app.clientWidth, 520) - 32;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = sizePt * dpr; canvas.height = sizePt * dpr;
    canvas.style.height = sizePt + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cell = sizePt / n;

    function drawHeat() {
      var colors = [];
      for (var b = 0; b < BUCKETS; b++) colors.push(bucketColor(b));
      for (var i = 0; i < n; i++)
        for (var j = 0; j < n; j++) {
          ctx.fillStyle = colors[bucketFor(set.matrix[i][j])];
          ctx.fillRect(j * cell, i * cell, cell + 0.5, cell + 0.5);
        }
      ctx.strokeStyle = css('--text-3'); ctx.globalAlpha = 0.5; ctx.lineWidth = 0.5;
      set.clusters.forEach(function (c) {
        [c.start, c.start + c.size].forEach(function (edge) {
          if (edge === 0 || edge === n) return;
          var at = edge * cell;
          ctx.beginPath(); ctx.moveTo(at, 0); ctx.lineTo(at, sizePt); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, at); ctx.lineTo(sizePt, at); ctx.stroke();
        });
      });
      ctx.globalAlpha = 1;
      if (corrState.focused !== null) {
        var fc = null;
        set.clusters.forEach(function (c) { if (c.id === corrState.focused) fc = c; });
        if (fc) {
          var a = fc.start * cell, b2 = (fc.start + fc.size) * cell;
          ctx.fillStyle = css('--bg'); ctx.globalAlpha = 0.74;
          ctx.fillRect(0, 0, sizePt, a);
          ctx.fillRect(0, b2, sizePt, sizePt - b2);
          ctx.fillRect(0, a, a, b2 - a);
          ctx.fillRect(b2, a, sizePt - b2, b2 - a);
          ctx.globalAlpha = 1;
        }
      }
      if (corrState.sel) {
        var si = corrState.sel[0], sj = corrState.sel[1];
        ctx.fillStyle = css('--text'); ctx.globalAlpha = 0.16;
        ctx.fillRect(sj * cell, 0, cell, sizePt);
        ctx.fillRect(0, si * cell, sizePt, cell);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = css('--text'); ctx.lineWidth = 1.5;
        ctx.strokeRect(sj * cell, si * cell, cell, cell);
      }
    }
    drawHeat();
    function pick(e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      var j = Math.max(0, Math.min(n - 1, Math.floor(x / cell)));
      var i = Math.max(0, Math.min(n - 1, Math.floor(y / cell)));
      if (!corrState.sel || corrState.sel[0] !== i || corrState.sel[1] !== j) {
        corrState.sel = [i, j];
        haptic();
        drawHeat(); renderReadout();
      }
    }
    canvas.addEventListener('pointerdown', function (e) { pick(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) { if (e.buttons) pick(e); });
    canvas.style.touchAction = 'none';

    var lg = h('div', 'legend');
    var strip = h('div', 'strip');
    for (var b3 = 0; b3 < BUCKETS; b3++) { var seg = h('i'); seg.style.background = bucketColor(b3); strip.appendChild(seg); }
    lg.appendChild(strip);
    var lbls = h('div', 'lbls');
    lbls.appendChild(h('span', '', '−1 opposite'));
    lbls.appendChild(h('span', '', '0'));
    lbls.appendChild(h('span', '', '+1 together'));
    lg.appendChild(lbls);
    sc.appendChild(lg);

      sc.appendChild(h('div', 'sect', 'GROUPS'));
    sc.appendChild(h('div', 'secthint',
      'Only the current top 50 is compared. Every stock lands in exactly one group: ' +
      'over the last 126 days its returns moved with these members and not with the rest of the matrix.'));
    function outsideAvg(c) {
      var sum = 0, count = 0;
      for (var i = c.start; i < c.start + c.size; i++) {
        for (var j = 0; j < n; j++) {
          if (j >= c.start && j < c.start + c.size) continue;
          sum += set.matrix[i][j]; count++;
        }
      }
      return count ? sum / count : 0;
    }
    var multi = set.clusters.filter(function (c) { return c.size > 1; });
    var solo = set.clusters.filter(function (c) { return c.size === 1; });
    multi.forEach(function (c, index) {
      var card = h('div', 'card' + (corrState.focused === c.id ? ' focused' : ''));
      var head = h('button', 'cardhead');
      var ct = h('span', 'ct');
      var members = set.tickers.slice(c.start, c.start + c.size);
      ct.appendChild(h('div', 't', 'Group ' + (index + 1)));
      ct.appendChild(h('div', 'm num', c.size + ' stocks · ρ ' + ratio(c.avgIntraCorr) + ' within · ' + ratio(outsideAvg(c)) + ' outside'));
      head.appendChild(ct);
      head.appendChild(h('span', 'eye', corrState.focused === c.id ? '◉' : '○'));
      head.onclick = function () {
        haptic();
        corrState.focused = corrState.focused === c.id ? null : c.id;
        corrState.sel = null;
        render();
      };
      card.appendChild(head);
      var chips = h('div', 'chips');
      members.forEach(function (m) {
        var chip = h('button', 'chip', m);
        chip.onclick = function () { push({ screen: 'ticker', params: { symbol: m, list: 'cluster:' + S.mode + ':' + c.id } }); };
        chips.appendChild(chip);
      });
      card.appendChild(chips);
      sc.appendChild(card);
    });
    if (solo.length) {
      var scard = h('div', 'card');
      var shead = h('div', 'cardhead');
      var sct = h('span', 'ct');
      sct.appendChild(h('div', 't', 'Independent'));
      sct.appendChild(h('div', 'm', solo.length + ' stocks not tightly co-moving with any group'));
      shead.appendChild(sct);
      scard.appendChild(shead);
      var schips = h('div', 'chips');
      solo.forEach(function (c) {
        var sym = set.tickers[c.start];
        var chip = h('button', 'chip', sym);
        chip.onclick = function () { push({ screen: 'ticker', params: { symbol: sym, list: 'solo:' + S.mode } }); };
        schips.appendChild(chip);
      });
      scard.appendChild(schips);
      sc.appendChild(scard);
    }
    return sc;
  }

  // ---------- root render ----------
  function render(anim) {
    app.textContent = '';
    var route = S.stack.length ? S.stack[S.stack.length - 1] : null;
    if (!route) {
      app.appendChild(S.tab === 'ranks' ? ranksScreen() : S.tab === 'watchlist' ? watchlistScreen() : settingsScreen());
      app.appendChild(tabBar());
    } else if (route.screen === 'ticker') {
      app.appendChild(tickerScreen(route.params, anim));
    } else if (route.screen === 'search') {
      app.appendChild(searchScreen(route.params));
    } else {
      app.appendChild(correlationScreen());
    }
  }

  /** Rebuilds the current screen but leaves the reader where they were. */
  function renderKeepingScroll() {
    var prev = app.querySelector('.screen');
    var top = prev ? prev.scrollTop : 0;
    render();
    var next = app.querySelector('.screen');
    if (next) next.scrollTop = top;
  }

  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', function () { render(); });

  render();
})();
