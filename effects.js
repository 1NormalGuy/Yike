/*
 * Spellbloom — a unified pink magic effects engine.
 * A self-contained Canvas2D layer that breathes a rose-gold dreamscape behind
 * every scene: a drifting nebula, out-of-focus bokeh, a luminous swarm of motes,
 * sakura petals & hearts, a live summon-circle energy field, a pointer wand-trail,
 * and choreographed bursts for the game's big moments. Exposes window.magic.
 *
 * No build step, no deps. All work happens in 1280x720 design units; the two
 * canvases live inside #game-shell and ride its transform:scale() with the stage.
 */
(() => {
  "use strict";

  const DESIGN_W = 1280;
  const DESIGN_H = 720;

  // Palette — read from :root so it stays in sync with the theme, with fallbacks.
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    return {
      rose: pick("--rose", "#f38fb1"),
      roseDark: pick("--rose-dark", "#b83f70"),
      lavender: pick("--lavender", "#dd8fb7"),
      lavDark: pick("--lavender-dark", "#8f365e"),
      cream: pick("--cream", "#fff4f7"),
      gold: pick("--gold", "#ffd76d"),
      plum: pick("--ink", "#5d2844"),
      night: pick("--night", "#35162a")
    };
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const v = h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h;
    const n = parseInt(v, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ---- Sprite baking (pre-render once, blit forever) ----------------------
  function makeCanvas(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  }

  function bakeDot(rgb) {
    const S = 128;
    const c = makeCanvas(S);
    const x = c.getContext("2d");
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, rgba(rgb, 1));
    g.addColorStop(0.35, rgba(rgb, 0.55));
    g.addColorStop(1, rgba(rgb, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    return c;
  }

  function bakeSparkle(rgb) {
    const S = 96;
    const c = makeCanvas(S);
    const x = c.getContext("2d");
    const cx = S / 2;
    // soft core
    const g = x.createRadialGradient(cx, cx, 0, cx, cx, S * 0.22);
    g.addColorStop(0, rgba(rgb, 1));
    g.addColorStop(1, rgba(rgb, 0));
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    // 4-point star rays
    x.globalCompositeOperation = "lighter";
    const ray = (w, len) => {
      const grd = x.createLinearGradient(cx - len, cx, cx + len, cx);
      grd.addColorStop(0, rgba(rgb, 0));
      grd.addColorStop(0.5, rgba(rgb, 0.9));
      grd.addColorStop(1, rgba(rgb, 0));
      x.fillStyle = grd;
      x.fillRect(cx - len, cx - w / 2, len * 2, w);
    };
    ray(3, S * 0.46);
    x.translate(cx, cx); x.rotate(Math.PI / 2); x.translate(-cx, -cx);
    ray(3, S * 0.46);
    return c;
  }

  function bakePetal(fillRgb, edgeRgb) {
    const S = 64;
    const c = makeCanvas(S);
    const x = c.getContext("2d");
    x.translate(S / 2, S / 2);
    x.beginPath();
    // sakura-ish petal: rounded with a soft notch
    x.moveTo(0, S * 0.42);
    x.bezierCurveTo(S * 0.34, S * 0.18, S * 0.30, -S * 0.30, 0, -S * 0.42);
    x.bezierCurveTo(-S * 0.30, -S * 0.30, -S * 0.34, S * 0.18, 0, S * 0.42);
    x.closePath();
    const g = x.createLinearGradient(0, -S * 0.42, 0, S * 0.42);
    g.addColorStop(0, rgba(edgeRgb, 0.95));
    g.addColorStop(0.5, rgba(fillRgb, 1));
    g.addColorStop(1, rgba(fillRgb, 0.9));
    x.fillStyle = g;
    x.fill();
    return c;
  }

  function bakeHeart(fillRgb, edgeRgb, gold) {
    const S = 64;
    const c = makeCanvas(S);
    const x = c.getContext("2d");
    x.translate(S / 2, S / 2);
    const s = S * 0.4;
    x.beginPath();
    x.moveTo(0, s * 0.95);
    x.bezierCurveTo(s * 1.25, s * 0.1, s * 0.62, -s * 1.05, 0, -s * 0.35);
    x.bezierCurveTo(-s * 0.62, -s * 1.05, -s * 1.25, s * 0.1, 0, s * 0.95);
    x.closePath();
    x.fillStyle = rgba(fillRgb, 1);
    x.fill();
    x.lineWidth = 3;
    x.strokeStyle = rgba(edgeRgb, 0.9);
    x.stroke();
    // highlight dot
    x.beginPath();
    x.arc(-s * 0.38, -s * 0.2, s * 0.18, 0, TAU);
    x.fillStyle = gold ? rgba(hexToRgb("#fff7e0"), 0.95) : rgba(hexToRgb("#fff4f7"), 0.9);
    x.fill();
    return c;
  }

  function bakeRing(rgb) {
    const S = 128;
    const c = makeCanvas(S);
    const x = c.getContext("2d");
    x.strokeStyle = rgba(rgb, 1);
    x.lineWidth = 8;
    x.beginPath();
    x.arc(S / 2, S / 2, S / 2 - 8, 0, TAU);
    x.stroke();
    return c;
  }

  // ---- Engine -------------------------------------------------------------
  const M = {
    ready: false,
    enabled: true,
    reduced: false,
    quality: "high"
  };

  let shell, ambient, burst, actx, bctx, flashEl;
  let pal, sprites;
  let dpr = 1;
  let rafId = 0;
  let lastT = 0;
  let nowS = 0;
  let paused = false;

  // pointer (design units)
  let ptr = { x: 640, y: 360, px: 640, py: 360, active: false, lastEmitX: 640, lastEmitY: 360 };
  let trailEnabled = true;
  let shellRect = null;

  // theme (lerped)
  const theme = {
    ambientAlpha: 1, bokehMul: 1, moteMul: 1, sparkMul: 1,
    petalMul: 1, heartMul: 1, windBase: 12, motionMul: 1,
    circleOn: 0, circleX: 640, circleY: 430, cool: 0, warm: 0
  };
  const target = Object.assign({}, theme);
  let scene = "start";
  let charge = 0, chargeTarget = 0;
  let shakeAmt = 0, shakeT = 0;
  let wind = 12, gustPhase = 0;

  // particle collections
  let bokeh = [], motes = [], petals = [], hearts = [], orbs = [];
  let pool = [];
  let liveBurst = 0;

  const SCENES = {
    start:  { ambientAlpha: 0.95, bokehMul: 0.85, moteMul: 1, sparkMul: 1, petalMul: 1, heartMul: 1.4, windBase: 10, motionMul: 1, circleOn: 0, cool: 0.15, warm: 0 },
    hub:    { ambientAlpha: 1.05, bokehMul: 1, moteMul: 1.15, sparkMul: 1, petalMul: 1, heartMul: 1, windBase: 12, motionMul: 1, circleOn: 1, circleX: 640, circleY: 430, cool: 0, warm: 0.15 },
    stella: { ambientAlpha: 0.85, bokehMul: 0.7, moteMul: 1.3, sparkMul: 1.5, petalMul: 0.5, heartMul: 0.6, windBase: 8, motionMul: 1, circleOn: 0, cool: 0.55, warm: 0 },
    dog:    { ambientAlpha: 0.5, bokehMul: 0.4, moteMul: 0.7, sparkMul: 0.7, petalMul: 0.5, heartMul: 0.4, windBase: 22, motionMul: 1, circleOn: 0, cool: 0.1, warm: 0.05 },
    hand:   { ambientAlpha: 0.9, bokehMul: 0.85, moteMul: 0.8, sparkMul: 0.9, petalMul: 1, heartMul: 1.5, windBase: 9, motionMul: 0.85, circleOn: 0, cool: 0, warm: 0.1 },
    blind:  { ambientAlpha: 0.95, bokehMul: 0.9, moteMul: 1.1, sparkMul: 1.3, petalMul: 0.7, heartMul: 0.7, windBase: 14, motionMul: 1, circleOn: 0, cool: 0, warm: 0.2 },
    aitips: { ambientAlpha: 0.7, bokehMul: 0.5, moteMul: 0.7, sparkMul: 1.1, petalMul: 0.5, heartMul: 0.7, windBase: 6, motionMul: 0.8, circleOn: 0, cool: 0.1, warm: 0.05 },
    final:  { ambientAlpha: 1.2, bokehMul: 1.2, moteMul: 1.2, sparkMul: 1.3, petalMul: 1.2, heartMul: 1.3, windBase: 12, motionMul: 1, circleOn: 1, circleX: 640, circleY: 400, cool: 0, warm: 0.4 }
  };

  // counts per quality
  function counts() {
    return M.quality === "low"
      ? { bokeh: 9, motes: 16, sparks: 7, petals: 4, hearts: 5, blobs: 3, pool: 220, orbs: 8 }
      : { bokeh: 14, motes: 26, sparks: 10, petals: 6, hearts: 8, blobs: 5, pool: 340, orbs: 10 };
  }

  // ---- init ---------------------------------------------------------------
  function init(opts) {
    if (M.ready) return;
    shell = (opts && opts.shell) || document.querySelector("#game-shell");
    if (!shell) return;
    pal = readPalette();
    flashEl = document.querySelector("#global-flash");

    M.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    if (minDim < 820 || (navigator.hardwareConcurrency || 8) <= 4) M.quality = "low";
    dpr = Math.min(window.devicePixelRatio || 1, M.quality === "low" ? 1.5 : 2);

    ambient = mkCanvas("fx-ambient", 1);
    burst = mkCanvas("fx-burst", 150);
    actx = ambient.getContext("2d");
    bctx = burst.getContext("2d");
    sizeCanvases();

    sprites = bakeAll();
    buildAmbient();
    buildPool();

    Object.assign(theme, SCENES.start);
    Object.assign(target, SCENES.start);

    bindEvents();
    shell.classList.add("magic-on");
    M.ready = true;

    if (M.reduced) { renderStatic(); return; }
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function mkCanvas(id, z) {
    let c = document.getElementById(id);
    if (!c) {
      c = document.createElement("canvas");
      c.id = id;
      shell.appendChild(c);
    }
    Object.assign(c.style, {
      position: "absolute", inset: "0", width: DESIGN_W + "px", height: DESIGN_H + "px",
      pointerEvents: "none", zIndex: String(z), imageRendering: "auto"
    });
    return c;
  }

  function sizeCanvases() {
    [ambient, burst].forEach((c) => {
      c.width = Math.round(DESIGN_W * dpr);
      c.height = Math.round(DESIGN_H * dpr);
    });
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bakeAll() {
    const dots = {
      rose: bakeDot(hexToRgb(pal.rose)),
      lavender: bakeDot(hexToRgb(pal.lavender)),
      cream: bakeDot(hexToRgb(pal.cream)),
      roseDark: bakeDot(hexToRgb(pal.roseDark)),
      gold: bakeDot(hexToRgb(pal.gold))
    };
    return {
      dots,
      dotRose: dots.rose, dotCream: dots.cream, dotLav: dots.lavender, dotGold: dots.gold, dotDark: dots.roseDark,
      sparkRose: bakeSparkle(hexToRgb(pal.cream)),
      sparkGold: bakeSparkle(hexToRgb(pal.gold)),
      sparkLav: bakeSparkle(hexToRgb(pal.lavender)),
      petalRose: bakePetal(hexToRgb(pal.rose), hexToRgb(pal.cream)),
      petalLav: bakePetal(hexToRgb(pal.lavender), hexToRgb(pal.cream)),
      petalDark: bakePetal(hexToRgb(pal.roseDark), hexToRgb(pal.rose)),
      heart: bakeHeart(hexToRgb(pal.rose), hexToRgb(pal.roseDark), false),
      heartGold: bakeHeart(hexToRgb(pal.gold), hexToRgb(pal.roseDark), true),
      ringRose: bakeRing(hexToRgb(pal.rose)),
      ringCream: bakeRing(hexToRgb(pal.cream)),
      ringGold: bakeRing(hexToRgb(pal.gold))
    };
  }

  function buildAmbient() {
    const n = counts();
    bokeh = []; motes = []; petals = []; hearts = []; orbs = [];
    const bokehTints = ["rose", "rose", "rose", "lavender", "lavender", "cream", "gold"];
    for (let i = 0; i < n.bokeh; i++) {
      const z = Math.random();
      bokeh.push({
        x: rand(0, DESIGN_W), y: rand(0, DESIGN_H), z,
        d: 36 + z * 120, rise: 6 + z * 16,
        swayA: rand(18, 40), swayF: rand(0.04, 0.09), swayP: rand(0, TAU),
        a: 0.1 + z * 0.16, twF: rand(0.3, 0.7), twP: rand(0, TAU),
        tint: i % 11 === 0 ? "gold" : pick(bokehTints)
      });
    }
    const moteTints = ["rose", "rose", "rose", "lavender", "lavender", "cream", "gold"];
    for (let i = 0; i < n.motes; i++) {
      const tier = Math.random();
      motes.push({
        x: rand(0, DESIGN_W), y: rand(0, DESIGN_H),
        vx: rand(-6, 6), vy: rand(-12, -3),
        s: tier < 0.5 ? rand(1.5, 3) : tier < 0.85 ? rand(4, 7) : rand(7, 9),
        wF: rand(0.3, 1.1), wP: rand(0, TAU), wA: rand(6, 14),
        a: rand(0.3, 0.8), tint: i % 12 === 0 ? "gold" : pick(moteTints)
      });
    }
    for (let i = 0; i < n.sparks; i++) {
      motes.push({
        spark: true, x: rand(0, DESIGN_W), y: rand(0, DESIGN_H),
        vx: rand(-5, 5), vy: rand(-10, -2), s: rand(5, 9),
        wF: rand(0.3, 1), wP: rand(0, TAU), wA: rand(6, 12),
        a: rand(0.2, 0.9), tw: rand(2, 5), twT: rand(0, 5),
        tint: i % 5 === 0 ? "gold" : (i % 3 === 0 ? "lav" : "rose")
      });
    }
    for (let i = 0; i < n.petals; i++) petals.push(spawnPetal(true));
    for (let i = 0; i < n.hearts; i++) {
      hearts.push({
        x: rand(0, DESIGN_W), y: rand(0, DESIGN_H),
        vy: Math.random() < 0.6 ? rand(18, 30) : -rand(18, 30),
        s: rand(16, 30), bob: rand(0, TAU), bobF: rand(0.4, 0.6),
        rot: rand(-0.4, 0.4), spin: rand(-0.6, 0.6),
        gold: i % 12 === 0, a: rand(0.5, 0.85)
      });
    }
    for (let i = 0; i < n.orbs; i++) {
      orbs.push({ ang: (i / n.orbs) * TAU, ringIdx: i % 3, speed: rand(0.3, 0.6) * (i % 2 ? 1 : -1), s: rand(6, 12) });
    }
  }

  function spawnPetal(anywhere) {
    const variants = ["petalRose", "petalRose", "petalLav", "petalDark"];
    return {
      x: rand(0, DESIGN_W), y: anywhere ? rand(0, DESIGN_H) : -30,
      vy: rand(14, 26), s: rand(18, 30),
      swayA: rand(20, 36), swayF: rand(0.2, 0.32), swayP: rand(0, TAU),
      spin: rand(1.2, 2.6) * (Math.random() < 0.5 ? 1 : -1), rot: rand(0, TAU),
      a: rand(0.5, 0.85), sprite: pick(variants)
    };
  }

  function buildPool() {
    const n = counts();
    pool = [];
    for (let i = 0; i < n.pool; i++) {
      pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, s: 0, grav: 0, drag: 1, rot: 0, spin: 0, sprite: null, a: 1, fg: false });
    }
  }

  function seed(x, y, opts) {
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      if (p.active) continue;
      p.active = true; p.x = x; p.y = y;
      p.vx = opts.vx; p.vy = opts.vy;
      p.life = 0; p.max = opts.max; p.s = opts.s;
      p.grav = opts.grav || 0; p.drag = opts.drag || 1; p.grow = opts.grow || 0;
      p.rot = opts.rot || 0; p.spin = opts.spin || 0;
      p.sprite = opts.sprite; p.a = opts.a == null ? 1 : opts.a;
      p.fade = opts.fade || "out"; p.fg = !!opts.fg;
      liveBurst++;
      return p;
    }
    return null;
  }

  // ---- update -------------------------------------------------------------
  function approach(o, t, dt) {
    const k = 1 - Math.exp(-dt * 2.6); // ~600ms settle
    for (const key in t) {
      if (typeof t[key] === "number" && typeof o[key] === "number") o[key] = lerp(o[key], t[key], k);
    }
  }

  function update(dt) {
    approach(theme, target, dt);
    charge = lerp(charge, chargeTarget, 1 - Math.exp(-dt * 3));
    const mm = theme.motionMul;

    // wind gust envelope
    gustPhase += dt;
    const gust = Math.max(0, Math.sin(gustPhase * 0.16)) ** 3;
    wind = theme.windBase + gust * 48;

    for (const b of bokeh) {
      b.y -= b.rise * dt * mm;
      b.swayP += b.swayF * dt * mm;
      if (b.y < -b.d) { b.y = DESIGN_H + b.d; b.x = rand(0, DESIGN_W); }
    }
    for (const m of motes) {
      m.x += (m.vx + Math.sin(nowS * m.wF + m.wP) * m.wA * 0.3 + wind * 0.25) * dt * mm;
      m.y += m.vy * dt * mm;
      if (m.spark) { m.twT += dt; }
      wrap(m, 12);
    }
    for (const p of petals) {
      p.y += p.vy * dt * mm;
      p.swayP += p.swayF * dt * mm;
      p.x += (Math.sin(p.swayP) * p.swayA * 0.04 + wind * 0.5) * dt * mm;
      p.rot += p.spin * dt * mm;
      if (p.y > DESIGN_H + 30 || p.x > DESIGN_W + 40) Object.assign(p, spawnPetal(false));
    }
    for (const h of hearts) {
      h.y += h.vy * dt * mm;
      h.bob += h.bobF * dt * mm;
      h.x += (Math.sin(h.bob) * 14 + wind * 0.2) * dt * mm;
      h.rot += h.spin * dt * mm;
      if (h.vy > 0 ? h.y > DESIGN_H + 30 : h.y < -30) {
        h.y = h.vy > 0 ? -30 : DESIGN_H + 30; h.x = rand(0, DESIGN_W);
      } else { wrapX(h, 30); }
    }
    for (const o of orbs) o.ang += o.speed * dt * (1 + charge) * mm;

    // pool
    if (liveBurst > 0) {
      for (const p of pool) {
        if (!p.active) continue;
        p.life += dt;
        if (p.life >= p.max) { p.active = false; liveBurst--; continue; }
        if (p.sprite && p.sprite.indexOf("ring") === 0) continue; // rings only grow + fade
        p.vy += p.grav * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      }
    }

    if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) { shakeAmt = 0; burst.style.transform = ""; } }
  }

  function wrap(m, pad) {
    if (m.x < -pad) m.x = DESIGN_W + pad; else if (m.x > DESIGN_W + pad) m.x = -pad;
    if (m.y < -pad) m.y = DESIGN_H + pad; else if (m.y > DESIGN_H + pad) m.y = -pad;
  }
  function wrapX(m, pad) {
    if (m.x < -pad) m.x = DESIGN_W + pad; else if (m.x > DESIGN_W + pad) m.x = -pad;
  }

  // ---- draw ---------------------------------------------------------------
  function draw() {
    drawAmbient();
    drawBurst();
  }

  function drawAmbient() {
    const ctx = actx;
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
    const A = theme.ambientAlpha;
    ctx.globalCompositeOperation = "lighter";

    // L0 nebula blobs
    const n = counts();
    const roseRgb = hexToRgb(pal.rose), lavRgb = hexToRgb(pal.lavender), darkRgb = hexToRgb(pal.roseDark), plumRgb = hexToRgb(pal.plum);
    const blobDefs = [
      { bx: 360, by: 250, r: 380, rgb: roseRgb, ph: 0 },
      { bx: 900, by: 300, r: 460, rgb: lavRgb, ph: 1.7 },
      { bx: 640, by: 520, r: 520, rgb: darkRgb, ph: 3.1 },
      { bx: 220, by: 560, r: 460, rgb: roseRgb, ph: 4.4 },
      { bx: 1080, by: 600, r: 500, rgb: lavRgb, ph: 5.6 }
    ];
    const breathe = 1 + Math.sin(nowS * (TAU / 8)) * 0.04;
    for (let i = 0; i < n.blobs; i++) {
      const b = blobDefs[i];
      const cx = b.bx + Math.sin(nowS * 0.05 + b.ph) * 120;
      const cy = b.by + Math.cos(nowS * 0.037 + b.ph) * 90;
      const r = b.r * breathe;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, rgba(b.rgb, 0.34 * A));
      g.addColorStop(0.5, rgba(b.rgb, 0.13 * A));
      g.addColorStop(1, rgba(b.rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    // cool overlay for nightier scenes
    if (theme.cool > 0.02) {
      const g = ctx.createRadialGradient(640, 200, 0, 640, 200, 700);
      g.addColorStop(0, rgba(hexToRgb(pal.night), 0.18 * theme.cool));
      g.addColorStop(1, rgba(hexToRgb(pal.night), 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    }

    // L1 bokeh
    for (const b of bokeh) {
      const tw = 1 + Math.sin(nowS * b.twF * TAU + b.twP) * 0.18;
      const px = ptr.active ? (ptr.x - 640) * b.z * 0.02 : 0;
      blit(ctx, sprites.dots[b.tint], b.x + px, b.y, b.d * tw, b.a * A * theme.bokehMul);
    }

    // L2 swarm
    for (const m of motes) {
      let a = m.a, s = m.s;
      if (m.spark) {
        const ph = (m.twT % m.tw) / m.tw;
        a = 0.2 + Math.sin(ph * Math.PI) * 0.8;
        const spike = ph > 0.45 && ph < 0.55 ? 1.6 : 1;
        s = m.s * spike;
        const spr = m.tint === "gold" ? sprites.sparkGold : m.tint === "lav" ? sprites.sparkLav : sprites.sparkRose;
        blit(ctx, spr, m.x, m.y, s * 2.4, a * A * theme.sparkMul);
      } else {
        blit(ctx, sprites.dots[m.tint], m.x, m.y, s * 3, a * A * theme.moteMul);
      }
    }

    // L4 magic circle (hub/final)
    if (theme.circleOn > 0.02) drawCircle(ctx);

    ctx.globalCompositeOperation = "source-over";
    // L3 petals + hearts (solid romance with faint glow already from lighter pass)
    for (const p of petals) {
      blitR(ctx, sprites[p.sprite], p.x, p.y, p.s, p.rot, p.a * A * theme.petalMul, Math.cos(p.rot));
    }
    for (const h of hearts) {
      blitR(ctx, h.gold ? sprites.heartGold : sprites.heart, h.x, h.y, h.s, h.rot, h.a * A * theme.heartMul, 1);
    }
  }

  function drawCircle(ctx) {
    const on = theme.circleOn;
    const cx = theme.circleX, cy = theme.circleY;
    const isFinal = scene === "final";
    const radii = isFinal ? [150, 205, 265] : [120, 170, 220];
    const ch = charge;
    ctx.save();
    // central glow
    const gr = (60 + Math.sin(nowS * 0.5 * TAU) * 14) * (1 + ch * 0.4);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, gr * 2);
    cg.addColorStop(0, rgba(hexToRgb(pal.cream), 0.5 * on * (0.5 + ch * 0.5)));
    cg.addColorStop(0.4, rgba(hexToRgb(pal.rose), 0.35 * on));
    cg.addColorStop(1, rgba(hexToRgb(pal.rose), 0));
    ctx.fillStyle = cg; ctx.fillRect(cx - gr * 2, cy - gr * 2, gr * 4, gr * 4);
    // rings
    const ringRgb = ch > 0.5 ? hexToRgb(pal.rose) : hexToRgb(pal.lavDark);
    const rots = [0.15, -0.22, 0.34];
    for (let i = 0; i < 3; i++) {
      const r = radii[i] * (1 + ch * 0.04);
      const segs = 16;
      const rot = nowS * rots[i] * (1 + ch * 0.8);
      ctx.strokeStyle = rgba(ringRgb, (0.25 + ch * 0.4) * on);
      ctx.lineWidth = 2.5;
      for (let s = 0; s < segs; s++) {
        const a0 = rot + (s / segs) * TAU;
        const a1 = a0 + (TAU / segs) * 0.6;
        ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      }
      // gold filament on inner ring at full charge
      if (i === 2 && ch > 0.7) {
        ctx.strokeStyle = rgba(hexToRgb(pal.gold), (ch - 0.7) / 0.3 * 0.9 * on);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, r, rot, rot + TAU * 0.4); ctx.stroke();
      }
    }
    ctx.restore();
    // orbiting orbs
    ctx.globalCompositeOperation = "lighter";
    for (const o of orbs) {
      const r = radii[o.ringIdx] * (1 + ch * 0.04) - ch * 14;
      const ox = cx + Math.cos(o.ang) * r;
      const oy = cy + Math.sin(o.ang) * r;
      blit(ctx, sprites.dots.cream, ox, oy, o.s * (2 + ch), (0.5 + ch * 0.5) * on);
      blit(ctx, sprites.dots.rose, ox, oy, o.s * 3.4, 0.4 * on);
    }
  }

  function drawBurst() {
    if (liveBurst === 0 && trail.length === 0) {
      if (burstDirty) { bctx.clearRect(0, 0, DESIGN_W, DESIGN_H); burstDirty = false; }
      return;
    }
    burstDirty = true;
    bctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
    // wand trail ribbon + sparkles
    drawTrail();
    bctx.globalCompositeOperation = "lighter";
    for (const p of pool) {
      if (!p.active) continue;
      const t = p.life / p.max;
      const a = p.fade === "in" ? Math.sin(Math.min(1, t) * Math.PI) : (1 - t);
      if (p.sprite.indexOf("ring") === 0) {
        const size = p.s + t * p.grow;
        bctx.globalCompositeOperation = "lighter";
        blit(bctx, sprites[p.sprite], p.x, p.y, size, a * p.a);
      } else if (p.sprite === "heart" || p.sprite === "heartGold" || p.sprite.indexOf("petal") === 0) {
        bctx.globalCompositeOperation = "source-over";
        blitR(bctx, sprites[p.sprite], p.x, p.y, p.s, p.rot, a * p.a, Math.cos(p.rot));
        bctx.globalCompositeOperation = "lighter";
      } else {
        blit(bctx, sprites[p.sprite], p.x, p.y, p.s, a * p.a);
      }
    }
    bctx.globalCompositeOperation = "source-over";
  }

  // ---- pointer trail ------------------------------------------------------
  let trail = [];
  let burstDirty = false;
  function drawTrail() {
    if (trail.length < 2) return;
    bctx.globalCompositeOperation = "lighter";
    bctx.lineCap = "round";
    for (let i = 1; i < trail.length; i++) {
      const a = (i / trail.length) * 0.4;
      bctx.strokeStyle = rgba(hexToRgb(pal.rose), a);
      bctx.lineWidth = (i / trail.length) * 3;
      bctx.beginPath();
      bctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      bctx.lineTo(trail[i].x, trail[i].y);
      bctx.stroke();
    }
  }

  // ---- helpers ------------------------------------------------------------
  function blit(ctx, spr, x, y, size, alpha) {
    if (!spr || alpha <= 0.002) return;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(spr, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }
  function blitR(ctx, spr, x, y, size, rot, alpha, scaleX) {
    if (alpha <= 0.002) return;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scaleX || 1, 1);
    ctx.drawImage(spr, -size / 2, -size / 2, size, size);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  // ---- loop ---------------------------------------------------------------
  function loop(t) {
    if (paused) return;
    const dt = clamp((t - lastT) / 1000, 0, 1 / 30);
    lastT = t;
    nowS += dt;
    // decay trail
    if (trail.length) {
      trailAge += dt;
      if (trailAge > 0.03) { trail.shift(); trailAge = 0; }
    }
    update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }
  let trailAge = 0;

  function renderStatic() {
    // reduced-motion: one calm frame, no loop
    nowS = 2;
    drawAmbient();
    bctx && bctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
  }

  // ---- events -------------------------------------------------------------
  function refreshRect() { shellRect = shell.getBoundingClientRect(); }
  function toDesign(cx, cy) {
    if (!shellRect) refreshRect();
    const sx = shellRect.width / DESIGN_W || 1;
    const sy = shellRect.height / DESIGN_H || 1;
    return { x: (cx - shellRect.left) / sx, y: (cy - shellRect.top) / sy };
  }

  function bindEvents() {
    refreshRect();
    window.addEventListener("resize", () => { dpr = Math.min(window.devicePixelRatio || 1, M.quality === "low" ? 1.5 : 2); sizeCanvases(); refreshRect(); if (M.reduced) renderStatic(); }, { passive: true });
    window.addEventListener("scroll", refreshRect, { passive: true });
    document.addEventListener("visibilitychange", () => { document.hidden ? pause() : resume(); });

    const onMove = (cx, cy) => {
      if (!trailEnabled || M.reduced) return;
      const d = toDesign(cx, cy);
      ptr.x = d.x; ptr.y = d.y; ptr.active = true;
      const dx = d.x - ptr.lastEmitX, dy = d.y - ptr.lastEmitY;
      if (dx * dx + dy * dy > 64) {
        trail.push({ x: d.x, y: d.y });
        if (trail.length > 7) trail.shift();
        const gold = Math.random() < 0.12;
        seed(d.x, d.y, { vx: rand(-20, 20), vy: rand(-20, 20), max: rand(0.5, 0.85), s: rand(8, 13), drag: 0.9, sprite: gold ? "sparkGold" : (Math.random() < 0.4 ? "sparkRose" : "dotCream") , a: 0.9 });
        // ensure dot sprite key resolves
        ptr.lastEmitX = d.x; ptr.lastEmitY = d.y;
      }
    };
    shell.addEventListener("pointermove", (e) => onMove(e.clientX, e.clientY), { passive: true });
    shell.addEventListener("pointerdown", (e) => { onMove(e.clientX, e.clientY); }, { passive: true });
  }

  function pause() { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } paused = true; }
  function resume() { if (M.reduced || !M.ready) return; if (!paused) return; paused = false; lastT = performance.now(); rafId = requestAnimationFrame(loop); }

  // ---- public API ---------------------------------------------------------
  function setScene(name) {
    if (!SCENES[name]) name = "hub";
    scene = name;
    const s = SCENES[name];
    for (const k in target) if (k in s) target[k] = s[k];
    if ("circleX" in s) { target.circleX = s.circleX; theme.circleX = s.circleX; }
    if ("circleY" in s) { target.circleY = s.circleY; theme.circleY = s.circleY; }
    if (M.reduced) { renderStatic(); return; }
    burstAt(640, 360, "sceneEnter");
  }

  function setCharge(n) { chargeTarget = clamp(n, 0, 1); }
  function setCircle(x, y) {
    target.circleX = x;
    target.circleY = y;
    theme.circleX = x;
    theme.circleY = y;
  }

  // burst presets
  function burstAt(x, y, type) {
    if (M.reduced) { seed(x, y, { vx: 0, vy: 0, max: 0.5, s: 60, sprite: "dotRose", a: 0.3, fade: "in" }); return; }
    const dot = (tint) => (sprites.dots[tint] ? tint : "rose");
    switch (type) {
      case "sceneEnter": {
        ring(x, y, "ringRose", 30, 360, 0.5);
        for (let i = 0; i < 20; i++) { const a = rand(0, TAU); seed(x, y, { vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), max: rand(0.5, 0.8), s: rand(6, 12), drag: 0.92, sprite: pick(["dotCream", "sparkRose"]), a: 0.8 }); }
        break;
      }
      case "starCaught": {
        ring(x, y, "ringRose", 16, 150, 0.5);
        for (let i = 0; i < 14; i++) seed(x, y, { vx: rand(-80, 80), vy: rand(-180, -60), max: rand(0.5, 0.8), s: rand(7, 12), grav: 320, drag: 0.98, sprite: Math.random() < 0.5 ? "sparkGold" : "sparkRose", a: 0.95 });
        break;
      }
      case "fizzle": {
        for (let i = 0; i < 8; i++) seed(x, y, { vx: rand(-40, 40), vy: rand(-20, 40), max: 0.6, s: rand(5, 8), grav: 260, sprite: "sparkLav", a: 0.5 });
        break;
      }
      case "catDefeated": {
        ring(x, y, "ringCream", 14, 180, 0.6);
        for (let i = 0; i < 24; i++) { const a = rand(0, TAU), sp = rand(120, 340); seed(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, max: rand(0.6, 0.85), s: rand(6, 14), grav: 260, drag: 0.92, sprite: pick(["dotRose", "dotCream", "sparkRose"]), a: 0.9 }); }
        shake(6, 0.26);
        break;
      }
      case "matchFound":
      case "padCorrect": {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; seed(x, y, { vx: Math.cos(a) * rand(50, 110), vy: Math.sin(a) * rand(50, 110) - 30, max: 0.8, s: rand(16, 24), spin: rand(-2, 2), rot: rand(0, TAU), sprite: Math.random() < 0.85 ? "heart" : "heartGold", a: 0.95 }); }
        seed(x, y, { vx: 0, vy: 0, max: 0.4, s: 70, sprite: "dotCream", a: 0.5, fade: "out" });
        break;
      }
      case "jackpot": {
        ring(x, y, "ringGold", 20, 360, 0.6);
        for (let i = 0; i < 60; i++) { const a = rand(0, TAU), sp = rand(80, 360); const gold = Math.random() < 0.25; seed(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, max: rand(0.8, 1.4), s: rand(8, 18), grav: 220, drag: 0.96, spin: rand(-3, 3), rot: rand(0, TAU), sprite: gold ? "sparkGold" : pick(["petalRose", "petalLav", "sparkRose", "heart"]), a: 0.95 }); }
        break;
      }
      case "rewardUnlock": {
        ring(x, y, "ringGold", 20, 320, 0.6);
        ring(x, y, "ringRose", 40, 420, 0.45);
        for (let i = 0; i < 40; i++) { const a = rand(0, TAU), sp = rand(70, 280); const gold = Math.random() < 0.4; seed(x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, max: rand(0.9, 1.4), s: rand(8, 16), grav: 240, drag: 0.96, spin: rand(-3, 3), rot: rand(0, TAU), sprite: gold ? "sparkGold" : pick(["sparkRose", "heart", "petalRose"]), a: 0.95 }); }
        flash(pal.rose, 0.35, 300);
        break;
      }
      case "finalReveal": {
        finalReveal();
        break;
      }
      default:
        for (let i = 0; i < 12; i++) { const a = rand(0, TAU); seed(x, y, { vx: Math.cos(a) * 100, vy: Math.sin(a) * 100, max: 0.7, s: 10, drag: 0.92, sprite: "sparkRose", a: 0.8 }); }
    }
  }

  function ring(x, y, sprite, start, grow, a) {
    seed(x, y, { vx: 0, vy: 0, grow: grow, max: 0.7, s: start, sprite, a, fade: "out" });
  }

  function finalReveal() {
    if (M.reduced) { flash(pal.cream, 0.5, 400); return; }
    chargeTarget = 1;
    flash(pal.cream, 0.7, 450);
    // t0 shockwave
    ring(640, 360, "ringRose", 30, 520, 0.6);
    setTimeout(() => {
      ring(640, 360, "ringGold", 40, 620, 0.5);
      for (let i = 0; i < 90; i++) { const a = rand(0, TAU), sp = rand(120, 460); const gold = Math.random() < 0.35; seed(640, 360, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, max: rand(1, 1.8), s: rand(8, 18), grav: 200, drag: 0.97, spin: rand(-3, 3), rot: rand(0, TAU), sprite: gold ? "sparkGold" : pick(["sparkRose", "heart", "petalRose", "petalLav"]), a: 0.95 }); }
      shake(4, 0.2);
    }, 300);
    // sustained hearts rising
    let waves = 0;
    const t = setInterval(() => {
      for (let i = 0; i < 10; i++) seed(rand(120, 1160), rand(420, 720), { vx: rand(-20, 20), vy: -rand(60, 140), max: rand(1.4, 2.2), s: rand(16, 30), spin: rand(-1, 1), rot: rand(0, TAU), sprite: Math.random() < 0.85 ? "heart" : "heartGold", a: 0.9 });
      if (++waves > 8) clearInterval(t);
    }, 200);
  }

  function flash(color, maxAlpha, ms) {
    if (!flashEl || M.reduced) return;
    flashEl.style.transition = "none";
    flashEl.style.background = color;
    flashEl.style.opacity = String(maxAlpha);
    requestAnimationFrame(() => {
      flashEl.style.transition = `opacity ${ms}ms ease-out`;
      flashEl.style.opacity = "0";
    });
  }

  function shake(px, sec) {
    if (M.reduced) return;
    shakeAmt = px; shakeT = sec;
    const tick = () => {
      if (shakeT <= 0) { burst.style.transform = ""; return; }
      const k = shakeT; const o = shakeAmt * (k / sec);
      burst.style.transform = `translate(${rand(-o, o)}px,${rand(-o, o)}px)`;
    };
    const iv = setInterval(() => { if (shakeT <= 0) { clearInterval(iv); burst.style.transform = ""; } else tick(); }, 16);
  }

  function pulse() {
    // brief swarm brightness spike
    for (const m of motes) if (m.spark) m.twT = 0;
  }

  function burstEl(el, type) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = toDesign(r.left + r.width / 2, r.top + r.height / 2);
    burstAt(d.x, d.y, type);
  }
  function burstAtClient(cx, cy, type) { const d = toDesign(cx, cy); burstAt(d.x, d.y, type); }

  window.magic = {
    init,
    setScene,
    setCharge,
    setCircle,
    getCircle: () => ({ x: theme.circleX, y: theme.circleY }),
    burst: burstAt,
    burstEl,
    burstAtClient,
    rewardUnlock: (x, y) => burstAt(x == null ? 640 : x, y == null ? 300 : y, "rewardUnlock"),
    finalReveal,
    flash,
    shake,
    pulse,
    setTrailEnabled: (v) => { trailEnabled = !!v; if (!v) trail = []; },
    pause, resume,
    setQuality: (q) => { M.quality = q; dpr = Math.min(window.devicePixelRatio || 1, q === "low" ? 1.5 : 2); sizeCanvases(); buildAmbient(); buildPool(); },
    setReducedMotion: (v) => { M.reduced = !!v; if (v) { pause(); renderStatic(); } else { resume(); } },
    setEnabled: (v) => { M.enabled = !!v; if (ambient) ambient.style.display = burst.style.display = v ? "" : "none"; },
    isReady: () => M.ready
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init());
  } else {
    init();
  }
})();
