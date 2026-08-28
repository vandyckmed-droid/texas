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
  function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {} }

  // ---------- data accessors (mirrors src/data/store.ts) ----------
  var bySymbol = {};
  D.rankings.stocks.forEach(function (s) { bySymbol[s.symbol] = s; });
  function rankOf(s, mode) { return mode === 'blended' ? s.rankBlended : s.rankVolAdj; }
  function top50(mode) {
    return D.rankings.stocks.slice().sort(function (a, b) { return rankOf(a, mode) - rankOf(b, mode); }).slice(0, 50);
  }
  function getChart(sym) {
    var st = bySymbol[sym];
    var key = st ? st.fileKey : sym.replace(/\./g, '-');
    return D.charts[key] || null;
  }
  function corrSet(mode) {
    for (var i = 0; i < D.correlation.sets.length; i++) if (D.correlation.sets[i].mode === mode) return D.correlation.sets[i];
    return null;
  }
  function orderedSymbols(list) {
    if (!list) return [];
    if (list === 'watchlist') {
      return S.watch.filter(function (s) { return bySymbol[s]; })
        .sort(function (a, b) { return rankOf(bySymbol[a], S.mode) - rankOf(bySymbol[b], S.mode); });
    }
    if (list.indexOf('ranks:') === 0) return top50(list.slice(6)).map(function (s) { return s.symbol; });
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
  function starBtn(sym) {
    var on = S.watch.indexOf(sym) >= 0;
    var b = h('button', 'star num' + (on ? ' on' : ''), on ? '★' : '☆');
    b.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + sym + (on ? ' from watchlist' : ' to watchlist'));
    b.onclick = function (e) {
      e.stopPropagation();
      haptic();
      var i = S.watch.indexOf(sym);
      if (i >= 0) S.watch.splice(i, 1); else S.watch.push(sym);
      saveLS('texas.web.watch', S.watch);
      render();
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
  function stockRow(s, rank, list) {
    var row = h('button', 'row');
    row.appendChild(h('span', 'rank num', String(rank)));
    var nc = h('div', 'namecol');
    nc.appendChild(h('div', 'sym', s.symbol));
    nc.appendChild(h('div', 'nm', s.name));
    row.appendChild(nc);
    var viz = h('span', 'viz');
    viz.appendChild(S.rowViz === 'range' ? rangeBar(s) : rollingBars(s));
    row.appendChild(viz);
    var pc = h('span', 'pricecol');
    pc.appendChild(h('div', 'px num', money(s.price)));
    var val = S.mode === 'blended' ? s.blended : s.volAdj;
    pc.appendChild(h('div', 'score num ' + (val >= 0 ? 'pos' : 'neg'),
      S.mode === 'blended' ? pct(s.blended) : ratio(s.volAdj)));
    row.appendChild(pc);
    row.appendChild(starBtn(s.symbol));
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
    hdr.appendChild(h('div', 'sub', 'Top 50 of ' + D.meta.rankedCount + ' · ' + longDate(D.meta.asOf)));
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
    var list = h('div');
    top50(S.mode).forEach(function (s) { list.appendChild(stockRow(s, rankOf(s, S.mode), 'ranks:' + S.mode)); });
    sc.appendChild(list);
    return sc;
  }

  // ---------- Watchlist ----------
  function watchlistScreen() {
    var sc = h('div', 'screen');
    var present = orderedSymbols('watchlist');
    if (present.length) {
      var hdr = h('div', 'hdr');
      hdr.appendChild(h('div', 'sub', present.length + (present.length === 1 ? ' stock' : ' stocks')));
      sc.appendChild(hdr);
    }
    if (!present.length) {
      sc.appendChild(emptyState('☆', 'Nothing watched yet', 'Tap the star on any stock in Ranks to add it here.'));
      return sc;
    }
    var list = h('div');
    present.forEach(function (sym) {
      var s = bySymbol[sym];
      list.appendChild(stockRow(s, rankOf(s, S.mode), 'watchlist'));
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
     ['rolling', 'Rolling blended score', 'Momentum score through time']].forEach(function (opt) {
      var on = S.rowViz === opt[0];
      var row = h('button', 'setrow' + (on ? ' on' : ''));
      var sl = h('span', 'sl');
      sl.appendChild(h('div', 't', opt[1]));
      sl.appendChild(h('div', 'h', opt[2]));
      row.appendChild(sl);
      var prev = h('span', 'prev');
      var sample = top50(S.mode)[0];
      prev.appendChild(opt[0] === 'range' ? rangeBar(sample) : rollingBars(sample));
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
    } else {
      app.appendChild(correlationScreen());
    }
  }

  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', function () { render(); });

  render();
})();
