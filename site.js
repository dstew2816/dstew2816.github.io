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
        if (p) { var was = p.hidden; p.hidden = !on; if (on && was) p.dispatchEvent(new CustomEvent('panelshow')); }
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

// Wafer map: a round field of dies that looks like a clean grid. A scan band follows the cursor, the dies
// under it swell slightly, and the few that never fired turn red and sit out of true.
(function () {
  var canvas = document.getElementById('monitor');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var checkedEl = document.getElementById('mon-checked');
  var badEl = document.getElementById('mon-bad');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BAND = 46, MISSING = 0.05, N = 17;
  var dies = [], W = 0, H = 0, cx = 0, cy = 0, R = 0, pitch = 0, size = 0, c = {}, bandX = -999, bandOn = false, raf = 0, sweepStart = 0;

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
    cx = W / 2; cy = H / 2; R = Math.min(W, H) / 2 - 6;
    pitch = (2 * R) / N; size = pitch - 2.6;
    var rand = rng(11);
    dies = [];
    for (var row = 0; row < N; row++) {
      for (var col = 0; col < N; col++) {
        var x = cx + (col - (N - 1) / 2) * pitch, y = cy + (row - (N - 1) / 2) * pitch;
        var dx = x - cx, dy = y - cy;
        if (Math.sqrt(dx * dx + dy * dy) > R - pitch * 0.55) continue;
        if (dy > R - pitch * 1.0) continue; // the flat at the bottom of the wafer
        dies.push({ x: x, y: y, bad: false, seen: reduce, heat: 0, prog: reduce ? 1 : 0, ox: 0, oy: 0, rot: 0 });
      }
    }
    // Exactly MISSING of the dies never fired, so the readout agrees with what you see.
    var idx = dies.map(function (_, i) { return i; });
    for (var k = idx.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)); var t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
    for (var m = 0; m < Math.max(1, Math.round(dies.length * MISSING)); m++) {
      var d = dies[idx[m]];
      d.bad = true;
      d.ox = (rand() < 0.5 ? -1 : 1) * (2 + rand() * 3);
      d.oy = (rand() < 0.5 ? -1 : 1) * (2 + rand() * 3);
      d.rot = (rand() - 0.5) * 0.7;
    }
  }
  function die(x, y, s, color, alpha, rot) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    // wafer outline with the flat
    ctx.globalAlpha = 0.5; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    var active = false, checked = 0, bad = 0, flagged = [];
    for (var i = 0; i < dies.length; i++) {
      var r = dies[i];
      if (bandOn && Math.abs(r.x - bandX) < BAND) { r.heat = 1; r.seen = true; }
      else if (r.heat > 0.01) r.heat *= 0.93; else r.heat = 0;
      if (r.heat > 0.01) active = true;
      if (r.seen) { checked++; if (r.bad) bad++; }
      var d = Math.max(-1, Math.min(1, (r.x - bandX) / BAND));
      var x = r.x + (r.heat > 0.01 ? d * 4 * r.heat : 0);
      var s = size * (1 + 0.22 * r.heat);
      if (r.seen && r.bad) {
        if (r.prog < 1) { r.prog = Math.min(1, r.prog + 0.07); active = true; }
        flagged.push({ x: x + r.ox * r.prog, y: r.y + r.oy * r.prog, s: size * (1 + 0.18 * r.prog) + 1, rot: r.rot * r.prog });
      } else if (r.heat > 0.01) {
        die(x, r.y, s, c.text, 0.35 + 0.65 * r.heat);
      } else {
        die(x, r.y, size, c.line, r.seen ? 0.9 : 0.55);
      }
    }
    ctx.shadowColor = c.signal; ctx.shadowBlur = 8;
    for (var f = 0; f < flagged.length; f++) die(flagged[f].x, flagged[f].y, flagged[f].s, c.signal, 1, flagged[f].rot);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    if (bandOn) {
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.5; ctx.fillRect(bandX - 0.5, 0, 1, H); ctx.globalAlpha = 1;
    }
    if (checkedEl && checked) {
      checkedEl.textContent = 'Dies checked: ' + checked.toLocaleString('en-US');
      badEl.innerHTML = 'Never fired: <span class="bad">' + bad + '</span> (' + (Math.round(1000 * bad / checked) / 10) + '%)';
    }
    return active;
  }
  function loop() {
    raf = 0;
    if (sweepStart) {
      var p = Math.min((performance.now() - sweepStart) / 3400, 1);
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

// Scroll reveals and count-up numbers.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) { document.documentElement.classList.remove('js'); return; }

  var groups = ['.block > h2', '.work', '.proj', '.resume', '.hero .panel', '.affil'];
  groups.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el, i) {
      el.setAttribute('data-reveal', '');
      el.style.setProperty('--d', (i % 3) * 90 + 'ms');
    });
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
      if (e.target.classList.contains('work')) startCounts(e.target);
      var ch = e.target.querySelector && e.target.querySelector('.chart');
      if (ch) ch.classList.add('go');
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  document.querySelectorAll('.proj').forEach(function (card) {
    var ch = card.querySelector('.chart');
    if (!ch) return;
    card.addEventListener('mouseenter', function () {
      ch.classList.remove('go'); void ch.getBoundingClientRect(); ch.classList.add('go');
    });
  });

  function startCounts(root) {
    root.querySelectorAll('[data-count]').forEach(function (el) {
      var to = parseFloat(el.getAttribute('data-count')), t0 = performance.now(), dur = 1200;
      function step(now) {
        var p = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(to * e).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(step);
      }
      el.textContent = '0';
      requestAnimationFrame(step);
    });
    var tl = root.querySelector('.timeline');
    if (tl) tl.classList.add('go');
  }
})();

// Route map: draws the path when its tab opens.
(function () {
  var panel = document.getElementById('lang');
  if (!panel) return;
  var map = panel.querySelector('.route');
  if (!map) return;
  panel.addEventListener('panelshow', function () {
    map.classList.remove('go');
    void map.getBoundingClientRect();
    map.classList.add('go');
  });
})();
