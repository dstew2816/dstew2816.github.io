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

  // Skills: a loose pile of pills that can be dragged around inside the card.
  var pile = document.getElementById('pile');
  if (pile) {
    var items = Array.prototype.slice.call(pile.children);
    var seed = 3;
    var rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var rot = items.map(function () { return (rand() - 0.5) * 12; });
    var layout = function () {
      var W = pile.clientWidth, x = 0, y = 4, rowH = 0, row = [];
      var flush = function () {
        var used = row.reduce(function (s, r) { return s + r.w; }, 0) + (row.length - 1) * 8;
        var cx = Math.max(0, (W - used) / 2);
        row.forEach(function (r) { r.el.style.left = cx + 'px'; r.el.style.top = y + 'px'; cx += r.w + 8; });
        y += rowH + 10; row = []; x = 0; rowH = 0;
      };
      items.forEach(function (el, i) {
        el.style.transform = 'rotate(' + rot[i].toFixed(1) + 'deg)';
        var w = el.offsetWidth, h = el.offsetHeight;
        if (x && x + w > W) flush();
        row.push({ el: el, w: w }); x += w + 8; rowH = Math.max(rowH, h);
      });
      flush();
      pile.style.minHeight = Math.max(pile.clientHeight, y) + 'px';
    };
    var drag = null;
    pile.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('li'); if (!el) return;
      var r = el.getBoundingClientRect();
      drag = { el: el, dx: e.clientX - r.left, dy: e.clientY - r.top };
      el.classList.add('drag'); el.setPointerCapture(e.pointerId); e.preventDefault();
    });
    pile.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = pile.getBoundingClientRect();
      var x = e.clientX - p.left - drag.dx, y = e.clientY - p.top - drag.dy;
      x = Math.max(0, Math.min(x, p.width - drag.el.offsetWidth));
      y = Math.max(0, Math.min(y, p.height - drag.el.offsetHeight));
      drag.el.style.left = x + 'px'; drag.el.style.top = y + 'px';
    });
    var end = function () { if (drag) { drag.el.classList.remove('drag'); drag = null; } };
    pile.addEventListener('pointerup', end);
    pile.addEventListener('pointercancel', end);
    var go = function () { layout(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    window.addEventListener('resize', go);
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
    ctx.fillRect(r.x - 1.5, r.y - 8 - (extra || 0), 3, 16 + 2 * (extra || 0));
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
