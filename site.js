(function () {
  var root = document.documentElement;

  // Light and dark switch. The head script applies a saved choice before first paint.
  var sw = document.querySelector('.switch');
  function current() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function paintSwitch() {
    if (!sw) return;
    var dark = current() === 'dark';
    sw.setAttribute('aria-checked', dark ? 'true' : 'false');
    var lbl = sw.querySelector('.lbl');
    if (lbl) lbl.textContent = dark ? 'Dark' : 'Light';
  }
  if (sw) {
    sw.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      paintSwitch();
      document.dispatchEvent(new Event('themechange'));
    });
    paintSwitch();
  }

  // Tabs inside cards.
  document.querySelectorAll('[data-tabs]').forEach(function (card) {
    var tabs = card.querySelectorAll('[role="tab"]');
    function show(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        var p = document.getElementById(t.dataset.for);
        if (p) p.hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(t); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          n.focus(); show(n);
        }
      });
    });
  });
})();

// Run monitor: a field of runs, a few percent of which never ran. A scan band follows the cursor
// and reveals the ones that went missing, with a running count.
(function () {
  var canvas = document.getElementById('monitor');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var checkedEl = document.getElementById('mon-checked');
  var badEl = document.getElementById('mon-bad');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROWS = 6, BAND = 70, MISSING = 0.05;
  var runs = [], W = 0, H = 0, c = {}, bandX = -999, bandOn = false, raf = 0, sweepStart = 0;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function colors() {
    var s = getComputedStyle(document.documentElement);
    var get = function (n) { return s.getPropertyValue(n).trim(); };
    c = { line: get('--line-strong'), text: get('--text'), accent: get('--accent'), signal: get('--signal') };
  }
  function layout() {
    var r = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The grid is the batch the platform ran. A margin around it holds the runs that should have been in it.
    var padX = 30, padY = 26;
    var cols = Math.max(14, Math.floor((W - 2 * padX) / 12)), gx = (W - 2 * padX) / cols, gy = (H - 2 * padY) / ROWS, rand = rng(11);
    runs = [];
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < cols; col++) {
        runs.push({ x: padX + (col + 0.5) * gx, y: padY + (row + 0.5) * gy, bad: false, seen: reduce, heat: 0, prog: 0 });
      }
    }
    // Exactly MISSING of the runs never ran, so the readout agrees with the caption.
    var idx = runs.map(function (_, i) { return i; });
    for (var k = idx.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)); var t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
    for (var m = 0; m < Math.round(runs.length * MISSING); m++) {
      var o = runs[idx[m]], tx, ty;
      o.bad = true;
      // When found, the run leaves its slot and sits in the margin, outside the batch.
      var side = Math.floor(rand() * 4);
      if (side < 2) { tx = 10 + rand() * (W - 20); ty = side === 0 ? 12 : H - 12; }
      else { ty = 10 + rand() * (H - 20); tx = side === 2 ? 12 : W - 12; }
      o.ox = tx - o.x; o.oy = ty - o.y; o.rot = (rand() - 0.5) * 0.8;
      if (reduce) o.prog = 1;
    }
  }
  function tick(r, color, alpha, extra, e) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.save();
    ctx.translate(r.x + (e ? r.ox * e : 0), r.y + (e ? r.oy * e : 0));
    if (e) ctx.rotate(r.rot * e);
    ctx.fillRect(-1.5, -8 - (extra || 0), 3, 16 + 2 * (extra || 0));
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var active = false, checked = 0, bad = 0;
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      if (bandOn && Math.abs(r.x - bandX) < BAND) { r.heat = 1; r.seen = true; }
      else if (r.heat > 0.01) r.heat *= 0.93; else r.heat = 0;
      if (r.heat > 0.01) active = true;
      if (r.seen) { checked++; if (r.bad) bad++; }
      if (r.seen && r.bad) {
        if (r.prog < 1) { r.prog = Math.min(1, r.prog + 0.04); active = true; }
        var e = 1 - Math.pow(1 - r.prog, 3);
        // The empty slot where the run belonged.
        ctx.globalAlpha = 0.7; ctx.strokeStyle = c.signal; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.strokeRect(r.x - 2.5, r.y - 8.5, 5, 17); ctx.setLineDash([]);
        ctx.shadowColor = c.signal; ctx.shadowBlur = 8;
        tick(r, c.signal, 1, 3, e);
        ctx.shadowBlur = 0;
      } else if (r.heat > 0.01) {
        tick(r, c.text, 0.35 + 0.65 * r.heat);
      } else {
        tick(r, c.line, r.seen ? 0.85 : 0.5);
      }
    }
    ctx.globalAlpha = 1;
    if (bandOn) {
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.5; ctx.fillRect(bandX - 0.5, 0, 1, H); ctx.globalAlpha = 1;
    }
    if (checkedEl && checked) {
      checkedEl.textContent = 'Runs checked: ' + checked.toLocaleString('en-US');
      badEl.innerHTML = 'Never ran: <span class="bad">' + bad + '</span> (' + (Math.round(1000 * bad / checked) / 10) + '%)';
    }
    return active;
  }
  function loop() {
    raf = 0;
    if (sweepStart) {
      var p = Math.min((performance.now() - sweepStart) / 3200, 1);
      bandX = W * (1 - Math.pow(1 - p, 2)); bandOn = true;
      if (p >= 1) { sweepStart = 0; bandOn = false; }
    }
    var active = draw();
    if (active || sweepStart) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }

  function init() { colors(); layout(); draw(); if (!reduce) { sweepStart = performance.now(); kick(); } }
  document.addEventListener('pointermove', function (e) {
    if (reduce) return;
    var r = canvas.getBoundingClientRect();
    if (e.clientY < r.top - 140 || e.clientY > r.bottom + 140 || e.clientX < r.left - 140 || e.clientX > r.right + 140) {
      if (bandOn && !sweepStart) { bandOn = false; kick(); }
      return;
    }
    sweepStart = 0; bandOn = true; bandX = e.clientX - r.left; kick();
  });
  window.addEventListener('resize', function () { layout(); draw(); });
  document.addEventListener('themechange', function () { colors(); draw(); });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { colors(); draw(); });
  init();
})();
