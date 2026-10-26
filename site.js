(function () {
  var root = document.documentElement;

  // Light and dark toggle. The head script applies a saved choice before first paint.
  var btn = document.querySelector('.toggle');
  function current() {
    return root.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function label() {
    if (btn) btn.textContent = current() === 'dark' ? 'Light mode' : 'Dark mode';
  }
  if (btn) {
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
      label();
      document.dispatchEvent(new Event('themechange'));
    });
    label();
  }
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
    var cols = Math.max(14, Math.floor(W / 12)), gx = W / cols, gy = H / ROWS, rand = rng(11);
    runs = [];
    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < cols; col++) {
        runs.push({ x: (col + 0.5) * gx, y: (row + 0.5) * gy, bad: rand() < MISSING, seen: reduce, heat: 0 });
      }
    }
  }
  function tick(r, color, alpha, extra) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.fillRect(r.x - 1.5, r.y - 7 - (extra || 0), 3, 14 + 2 * (extra || 0));
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
        ctx.shadowColor = c.signal; ctx.shadowBlur = 8;
        tick(r, c.signal, 1, 3);
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
    if (e.clientY < r.top - 140 || e.clientY > r.bottom + 140) { if (bandOn && !sweepStart) { bandOn = false; kick(); } return; }
    sweepStart = 0; bandOn = true; bandX = e.clientX - r.left; kick();
  });
  window.addEventListener('resize', function () { layout(); draw(); });
  document.addEventListener('themechange', function () { colors(); draw(); });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { colors(); draw(); });
  init();
})();
