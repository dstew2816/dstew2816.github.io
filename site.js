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

// Wafer map: a round field of dies that looks like a clean grid. A scan band follows the cursor. Where the
// band passes, the dies that never fired show up as red extras that squeeze into the grid and warp the
// regular dies around them. When the scan moves on, the grid settles back. The regular die count never
// changes, and the extras land in new places every time the wafer is scanned again.
(function () {
  var canvas = document.getElementById('monitor');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var checkedEl = document.getElementById('mon-checked');
  var badEl = document.getElementById('mon-bad');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var BAND = 46, MISSING = 0.05, N = 17;
  var dies = [], extras = [], W = 0, H = 0, cx = 0, cy = 0, R = 0, pitch = 0, size = 0, c = {}, bandX = -999, bandOn = false, raf = 0, sweepStart = 0;

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
    dies = [];
    for (var row = 0; row < N; row++) {
      for (var col = 0; col < N; col++) {
        var x = cx + (col - (N - 1) / 2) * pitch, y = cy + (row - (N - 1) / 2) * pitch;
        var dx = x - cx, dy = y - cy;
        if (Math.sqrt(dx * dx + dy * dy) > R - pitch * 0.55) continue;
        if (dy > R - pitch * 1.0) continue; // the flat at the bottom of the wafer
        dies.push({ x: x, y: y, heat: 0, jx: 0, jy: 0, jr: 0 });
      }
    }
    reseed();
  }
  // New random extras and new random warping, so each scan finds the misses somewhere different.
  function reseed() {
    dies.forEach(function (d) { d.jx = Math.random() * 2 - 1; d.jy = Math.random() * 2 - 1; d.jr = Math.random() * 2 - 1; });
    extras = [];
    var want = Math.max(1, Math.round(dies.length * MISSING)), tries = 0;
    while (extras.length < want && tries++ < 600) {
      var base = dies[Math.floor(Math.random() * dies.length)];
      var ex = base.x + pitch * (Math.random() < 0.5 ? 0.5 : -0.5), ey = base.y + pitch * (Math.random() < 0.5 ? 0.5 : -0.5);
      var ddx = ex - cx, ddy = ey - cy;
      if (Math.sqrt(ddx * ddx + ddy * ddy) > R - pitch * 1.2 || ddy > R - pitch * 1.4) continue;
      if (extras.some(function (o) { return Math.abs(o.x - ex) < pitch * 2.2 && Math.abs(o.y - ey) < pitch * 2.2; })) continue;
      extras.push({ x: ex, y: ey, heat: reduce ? 1 : 0, seen: reduce, rot: (Math.random() - 0.5) * 0.8,
        sig: (1.4 + Math.random() * 0.9) * pitch, amp: (0.42 + Math.random() * 0.26) * pitch, sz: 0.95 + Math.random() * 0.3 });
    }
  }
  function die(x, y, s, color, alpha, rot) {
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  function ease(t) { return t * t * (3 - 2 * t); }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    var active = false, bad = 0, i, k;

    for (k = 0; k < extras.length; k++) {
      var e = extras[k];
      if (!reduce) {
        if (bandOn && Math.abs(e.x - bandX) < BAND) { e.heat = 1; e.seen = true; }
        else if (e.heat > 0.01) e.heat *= 0.94; else e.heat = 0;
      }
      if (e.heat > 0.01) active = true;
    }
    for (i = 0; i < dies.length; i++) {
      var r = dies[i];
      if (bandOn && Math.abs(r.x - bandX) < BAND) r.heat = 1;
      else if (r.heat > 0.01) r.heat *= 0.93; else r.heat = 0;
      if (r.heat > 0.01) active = true;
      // The grid warps smoothly around each extra, with a little irregularity from die to die.
      var x = r.x, y = r.y, F = 0;
      for (k = 0; k < extras.length; k++) {
        var ee = extras[k];
        if (ee.heat <= 0.01) continue;
        var dx = r.x - ee.x, dy = r.y - ee.y, d = Math.sqrt(dx * dx + dy * dy);
        var g = Math.exp(-Math.pow(d / ee.sig, 2)) * ease(ee.heat);
        if (g < 0.01) continue;
        x += (dx / d) * ee.amp * g; y += (dy / d) * ee.amp * g; F += g;
      }
      x += r.jx * pitch * 0.14 * F; y += r.jy * pitch * 0.14 * F;
      var rot = r.jr * 0.2 * Math.min(1, F);
      var swell = 1 + 0.15 * r.heat;
      if (r.heat > 0.01) die(x, y, size * swell, c.text, 0.35 + 0.65 * r.heat, rot);
      else die(x, y, size, F > 0.01 ? c.text : c.line, F > 0.01 ? 0.6 : 0.55, rot);
    }
    ctx.shadowColor = c.signal; ctx.shadowBlur = 8;
    for (k = 0; k < extras.length; k++) {
      var g2 = extras[k];
      if (g2.heat > 0.5) bad++;
      if (g2.heat <= 0.01) continue;
      var p = ease(Math.min(1, g2.heat));
      die(g2.x, g2.y, size * g2.sz * (0.4 + 0.75 * p), c.signal, Math.min(1, 0.3 + p), g2.rot * p);
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    if (bandOn) {
      ctx.fillStyle = c.accent; ctx.globalAlpha = 0.5; ctx.fillRect(bandX - 0.5, 0, 1, H); ctx.globalAlpha = 1;
    }
    if (checkedEl) {
      checkedEl.textContent = 'Automations on the wafer: ' + dies.length;
      badEl.innerHTML = 'Never fired, in view: <span class="bad">' + bad + '</span>';
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
    // A new pass over the wafer finds the misses in new places.
    if (!bandOn && extras.every(function (x) { return x.heat < 0.05; })) reseed();
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
      var ch = e.target.querySelector && e.target.querySelector('.audit');
      if (ch) ch.classList.add('go');
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { io.observe(el); });
  document.querySelectorAll('.proj').forEach(function (card) {
    var ch = card.querySelector('.audit');
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

// Route map: draws the path whenever it comes into view (including when its tab opens).
(function () {
  var map = document.querySelector('.route');
  if (!map) return;
  function play() { map.classList.remove('go'); void map.getBoundingClientRect(); map.classList.add('go'); }
  if (!('IntersectionObserver' in window)) { map.classList.add('go'); return; }
  var seen = false;
  new IntersectionObserver(function (en) { if (en[0].isIntersecting && !seen) { seen = true; play(); } }, { threshold: 0.2 }).observe(map);
  var panel = document.getElementById('lang');
  if (panel) panel.addEventListener('panelshow', function () { setTimeout(play, 30); });
})();

// Backroom card: a cloud of notes. A scene is typed, the notes that fit it light up and connect to it, then the next scene.
(function () {
  var canvas = document.querySelector('canvas.graph');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, nodes = [], edges = [], c = {}, raf = 0, t0 = 0, visible = false;
  var SCENES = [
    { text: 'the wizard starts flying', q: [0.30, 0.42], names: ['Alley trap', 'Rooftop chase', 'Tower guards'] },
    { text: 'the party reaches the keep', q: [0.68, 0.36], names: ['Gate captain', 'Moat riddle', 'Hidden stair'] },
    { text: 'they bargain with the guild', q: [0.55, 0.66], names: ['Guildmaster\'s debt', 'Smuggler\'s cache', 'Forged seal'] }
  ];
  var SCENE_MS = 5200;

  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function colors() {
    var s = getComputedStyle(document.documentElement), g = function (n) { return s.getPropertyValue(n).trim(); };
    c = { line: g('--line-strong'), text: g('--text'), muted: g('--muted'), signal: g('--signal') };
  }
  function build() {
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var rand = rng(5), n = 46;
    nodes = [];
    var tries = 0;
    while (nodes.length < n && tries++ < 4000) {
      var x = 0.06 + rand() * 0.88, y = 0.08 + rand() * 0.72;
      if (y < 0.24 && x < 0.46) continue; // keep clear of the status badge
      if (nodes.every(function (o) { return Math.hypot((o.x - x) * W, (o.y - y) * H) > 17; })) nodes.push({ x: x, y: y, p: rand() * 6.28, r: 1.6 + rand() * 1.6 });
    }
    edges = [];
    nodes.forEach(function (a, i) {
      var near = nodes.map(function (b, j) { return { j: j, d: Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) }; })
        .filter(function (o) { return o.j !== i; }).sort(function (u, v) { return u.d - v.d; }).slice(0, 2);
      near.forEach(function (o) { if (o.j > i || !edges.some(function (e) { return e[0] === o.j && e[1] === i; })) edges.push([i, o.j]); });
    });
    SCENES.forEach(function (sc) {
      var qx = sc.q[0] * W, qy = sc.q[1] * H;
      var order = nodes.map(function (nd, i) { return { i: i, d: Math.hypot(nd.x * W - qx, nd.y * H - qy) }; })
        .sort(function (u, v) { return u.d - v.d; });
      sc.hits = [];
      order.forEach(function (o) {
        if (sc.hits.length >= 3) return;
        var far = sc.hits.every(function (h) { return Math.hypot((nodes[h].x - nodes[o.i].x) * W, (nodes[h].y - nodes[o.i].y) * H) > 62; });
        if (far) sc.hits.push(o.i);
      });
    });
  }
  function pos(i, t) { var n = nodes[i]; return [n.x * W + Math.sin(t / 1800 + n.p) * 2.2, n.y * H + Math.cos(t / 2100 + n.p) * 2.2]; }
  function frame(now) {
    raf = 0;
    var t = reduce ? 3000 : now - t0;
    var si = Math.floor(t / SCENE_MS) % SCENES.length, sc = SCENES[si], u = (t % SCENE_MS) / SCENE_MS;
    if (reduce) { si = 0; sc = SCENES[0]; u = 0.6; }
    var typed = Math.min(1, u / 0.22), found = Math.max(0, Math.min(1, (u - 0.3) / 0.18)), fade = u > 0.86 ? 1 - (u - 0.86) / 0.14 : 1;
    ctx.clearRect(0, 0, W, H);
    var lit = {}; sc.hits.forEach(function (i) { lit[i] = true; });
    ctx.lineWidth = 1;
    edges.forEach(function (e) {
      var a = pos(e[0], t), b = pos(e[1], t);
      ctx.globalAlpha = 0.5; ctx.strokeStyle = c.line;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    var qx = sc.q[0] * W, qy = sc.q[1] * H;
    // query ring expands from the query point, then lines run to the notes that fit
    if (u > 0.22) {
      var ring = Math.min(1, (u - 0.22) / 0.2);
      ctx.globalAlpha = (1 - ring) * 0.7 * fade; ctx.strokeStyle = c.signal;
      ctx.beginPath(); ctx.arc(qx, qy, 4 + ring * 46, 0, 6.283); ctx.stroke();
    }
    nodes.forEach(function (nd, i) {
      var p = pos(i, t), on = lit[i] && found > 0;
      ctx.globalAlpha = on ? 1 : 0.9; ctx.fillStyle = on ? c.text : c.line;
      var rr = nd.r + (on ? 2.2 * found : 0);
      ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, 6.283); ctx.fill();
    });
    if (found > 0) {
      sc.hits.forEach(function (i, k) {
        var p = pos(i, t), x = qx + (p[0] - qx) * found, y = qy + (p[1] - qy) * found;
        ctx.globalAlpha = fade; ctx.strokeStyle = c.signal; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = c.text; ctx.font = '500 9px "IBM Plex Mono", monospace';
        var lbl = sc.names[k], right = p[0] < W * 0.62;
        ctx.globalAlpha = fade * found; ctx.textAlign = right ? 'left' : 'right';
        ctx.fillText(lbl, p[0] + (right ? 8 : -8), p[1] + (k === 1 ? 14 : -6));
      });
      ctx.globalAlpha = fade; ctx.fillStyle = c.signal; ctx.beginPath(); ctx.arc(qx, qy, 3.2, 0, 6.283); ctx.fill();
    }
    // the typed scene
    ctx.globalAlpha = fade; ctx.fillStyle = c.muted; ctx.textAlign = 'left'; ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText('> ' + sc.text.slice(0, Math.round(sc.text.length * typed)) + (typed < 1 || (u * 8 | 0) % 2 ? '_' : ''), 14, H - 14);
    ctx.globalAlpha = 1;
    if (!reduce && visible) raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf) { t0 = t0 || performance.now(); raf = requestAnimationFrame(frame); } }
  function init() { colors(); build(); if (reduce) frame(0); else if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) start(); }, { threshold: 0.1 }).observe(canvas);
  } else { visible = true; start(); } }
  window.addEventListener('resize', function () { build(); if (reduce) frame(0); });
  document.addEventListener('themechange', function () { colors(); if (reduce) frame(0); });
  init();
})();
