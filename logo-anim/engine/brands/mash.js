/* Idea 1 — "Mash": the design process, in stop-motion (12.5fps, on twos).
   guides and notes → the logo drawn in charcoal from both ends inward → the clean logo
   with pen notes → diagonal slice + brush strokes flip the page to dark → the logo
   (reversed) returns and small hand notes pop around it. Works for ?logo=mehad|aim. */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  const C = isM
    ? { paper: "#EFECE6", pen: "#1F8F86", pencil: "#7C7F86", dark: "#0E1620", note: "#D9B77A", width: { "16x9": 1040, "1x1": 840 } }
    : { paper: "#ECEFEE", pen: "#159488", pencil: "#7C8786", dark: "#081615", note: "#7FE6DA", width: { "16x9": 760, "1x1": 660 } };
  const T = { guides: [0, .32], draw: [.32, 1.12], clean: 1.12, notes: [1.2, 2.0], slice: [2.0, 2.12], brush: [2.08, 2.4], back: [2.48, 2.56], doodles: [2.64, 3.44], dur: 5.6 };
  let P, S, sc;

  async function load() {
    await loadImg("paper", "../assets/shared/paper.png");
    await Promise.all([0, 1, 2].map(i => loadImg("brush" + i, `../assets/shared/brush_${i}.png`)));
    await LOGO.load();
    await Promise.all(["500 30px Caveat", "700 30px Caveat", '400 30px "Aref Ruqaa"', '700 30px "Aref Ruqaa"'].map(f => document.fonts.load(f, "abc خيط")));
    P = place(LOGO, C.width[FORMAT]);
    S = (x, y) => [P.x + x * P.L, P.y + y * P.L];
    sc = W / 1920 * (FORMAT === "1x1" ? 1.15 : 1);          // mark sizes in px, per format
  }

  /* masks for the charcoal reveal, in logo source coords */
  function revealMask(g, q) {                                // q: 0..1 drawing progress (stepped)
    const seg2 = (a, b) => clamp((q - a) / (b - a));
    g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#000"; g.fillStyle = "#000";
    if (isM) {
      const ST = LOGO.ST, path = k => mkPath(ST.ar[k]);
      const en = Object.values(ST.en).map(ps => ps.map(mkPath));
      g.lineWidth = ST.ar_width + 34;
      [["dal", 0, .35], ["alef", .2, .62], ["meem", .28, .66], ["knot", .5, .95]].forEach(([k, a, b]) => { const p = path(k); strokeUpTo(g, p, p.L * seg2(a, b)); });
      g.lineWidth = ST.en_width + 34;
      [[0, 0, .4], [4, .05, .45], [1, .3, .7], [3, .35, .75], [2, .6, 1]].forEach(([i, a, b]) => {
        let s = seg2(a, b) * en[i].reduce((x, p) => x + p.L, 0);
        for (const p of en[i]) { strokeUpTo(g, p, Math.min(s, p.L)); s -= p.L; if (s <= 0) break; }
      });
      const w = seg2(0, .55);                                // icon: hatched in from the right edge, diagonally
      if (w > 0) { const [x0, y0, x1, y1] = LOGO.icon, d = (x1 - x0) + (y1 - y0); g.beginPath(); g.moveTo(x1, y0 - 10); g.lineTo(x1 - d * w, y0 - 10); g.lineTo(x1 - d * w + (y1 - y0) + 20, y1 + 10); g.lineTo(x1, y1 + 10); g.closePath(); g.fill(); }
    } else {
      const { c1, c2, R } = LOGO, sweep = seg2(0, .9) * Math.PI * 2;
      for (const [c, a0, dir] of [[c1, Math.PI, 1], [c2, 0, -1]]) {
        if (sweep <= 0) continue;
        g.beginPath(); g.moveTo(c[0], c[1]); g.arc(c[0], c[1], R + 30, a0, a0 + dir * sweep, dir < 0); g.closePath(); g.fill();
      }
    }
  }

  function guides(st, seed) {
    const n = st - smStep(T.guides[0]), pen = { color: C.pencil, w: 1.6 * sc, amp: 1.4, seed };
    const p1 = clamp((n + 1) / 2), p2 = clamp((n - 1) / 2), lab = n >= 3;
    const g = ctx, ext = 70 * sc;
    if (isM) {
      const [xl] = S(0, 0), [xr] = S(2000, 0);
      for (const y of [1, 329, 441, 704]) { const [, yy] = S(0, y); dimLine(g, xl - ext, yy, xr + ext, yy, { ...pen, p: p1, head: 8 * sc, seed: seed + y }); }
      for (const x of [0, 1296, 2000]) { const [xx, y0] = S(x, 0), [, y1] = S(x, 704); dimLine(g, xx, y0 - ext, xx, y1 + ext, { ...pen, p: p2, head: 8 * sc, seed: seed + x }); }
      if (lab) {
        const [a, b] = S(0, 0), [c, d] = S(2000, 704);
        handText(g, "height", a - 6 * sc, b - ext - 8 * sc, { font: `500 ${30 * sc}px Caveat`, color: C.pencil, seed, rot: -.05 });
        handText(g, "width", c + ext - 40 * sc, d + ext + 6 * sc, { font: `500 ${30 * sc}px Caveat`, color: C.pencil, seed: seed + 2 });
        handText(g, "mehad logotype", a, d + ext * .75, { font: `500 ${28 * sc}px Caveat`, color: C.pencil, seed: seed + 4 });
        handEllipse(g, c + ext * .55, b - ext * .6, 13 * sc, 13 * sc, { ...pen, seed: seed + 6 });
        hand(g, [[c + ext * .48, b - ext * .6], [c + ext * .55, b - ext * .5], [c + ext * .75, b - ext * .95]], { ...pen, seed: seed + 7 });
      }
    } else {
      const { c1, c2, R } = LOGO, [l, cy] = S(c1[0] - R, c1[1]), [r] = S(c2[0] + R, 0), [, top] = S(0, c1[1] - R), [, bot] = S(0, c1[1] + R);
      dimLine(g, l - ext, cy, r + ext, cy, { ...pen, p: p1, head: 8 * sc, seed: seed + 1 });
      for (const y of [top, bot]) dimLine(g, l - ext, y, r + ext, y, { ...pen, p: p1, head: 8 * sc, seed: seed + y | 0 });
      for (const c of [c1, c2]) {
        const [x, y] = S(c[0], c[1]);
        hand(g, [[x - 12 * sc, y], [x + 12 * sc, y]], { ...pen, p: p2 }); hand(g, [[x, y - 12 * sc], [x, y + 12 * sc]], { ...pen, p: p2, seed: seed + 3 });
        handEllipse(g, x, y, R * P.L, R * P.L, { ...pen, p: p2, a0: c === c1 ? Math.PI : 0, over: .04, seed: seed + c[0] | 0, amp: 1.2 });
      }
      if (lab) {
        const [x, y] = S(c1[0], c1[1]);
        dimLine(g, x, y, x - R * P.L, y, { ...pen, color: C.pen, head: 8 * sc, seed: seed + 9 });
        handText(g, "r", x - R * P.L / 2, y - 16 * sc, { font: `700 ${24 * sc}px Caveat`, color: C.pen, seed });
        handText(g, "aim mark", l - ext * .4, bot + ext * .7, { font: `500 ${28 * sc}px Caveat`, color: C.pencil, seed: seed + 4 });
        handEllipse(g, r + ext * .55, top - ext * .5, 13 * sc, 13 * sc, { ...pen, seed: seed + 6 });
        hand(g, [[r + ext * .48, top - ext * .5], [r + ext * .55, top - ext * .4], [r + ext * .75, top - ext * .85]], { ...pen, seed: seed + 7 });
      }
    }
  }

  function penNotes(st, seed) {
    const n = st - smStep(T.notes[0]), o = { color: C.pen, w: 2.6 * sc, amp: 1.8, seed };
    const F = (sz, ar) => ar ? `700 ${sz * 1.35 * sc}px "Aref Ruqaa"` : `700 ${sz * 1.3 * sc}px Caveat`;
    const items = isM ? [
      (g, p) => { const [x, y] = S(665, 160); handEllipse(g, x, y, 260 * P.L, 175 * P.L, { ...o, p: p }); },
      (g, p) => { const [x, y] = S(560, 20); handArrow(g, [[x - 70 * sc, y - 70 * sc], [x - 40 * sc, y - 40 * sc], [x - 8 * sc, y - 8 * sc]], { ...o, p: p, head: 12 * sc }); if (p >= 1) handText(g, "تعليم", x - 80 * sc, y - 95 * sc, { font: F(34, 1), color: C.pen, seed, dir: "rtl", align: "center" }); },
      (g, p) => { const [x0, y0] = S(900, 60), [x1, y1] = S(1320, 60); handArrow(g, [[x0, y0 - 60 * sc], [(x0 + x1) / 2, y0 - 110 * sc], [x1, y1 - 30 * sc]], { ...o, p: p, head: 12 * sc }); if (p >= 1) handText(g, "معلّم وطالب", (x0 + x1) / 2, y0 - 140 * sc, { font: F(30, 1), color: C.pen, seed, dir: "rtl", align: "center" }); },
      (g, p) => { const [x0, y] = S(17, 740), [x1] = S(1155, 0); squiggle(g, x0, x0 + (x1 - x0) * p, y, { ...o }); if (p >= 1) handText(g, "معرفة ✓", x1 + 18 * sc, y + 2 * sc, { font: F(28, 1), color: C.pen, seed, dir: "rtl", align: "left" }); },
    ] : [
      (g, p) => { const [x, y] = S(240, 160); handArrow(g, [[x - 90 * sc, y - 80 * sc], [x - 50 * sc, y - 40 * sc], [x - 8 * sc, y]], { ...o, p: p, head: 12 * sc }); if (p >= 1) handText(g, "you", x - 110 * sc, y - 100 * sc, { font: F(32), color: C.pen, seed, align: "center" }); },
      (g, p) => { const [x, y] = S(1760, 160); handArrow(g, [[x + 90 * sc, y - 80 * sc], [x + 50 * sc, y - 40 * sc], [x + 8 * sc, y]], { ...o, p: p, head: 12 * sc }); if (p >= 1) handText(g, "AI", x + 110 * sc, y - 100 * sc, { font: F(32), color: C.pen, seed, align: "center" }); },
      (g, p) => { const [x, y] = S(1000, 667); handEllipse(g, x, y, 380 * P.L, 640 * P.L, { ...o, p: p }); },
      (g, p) => { const [x, y] = S(1000, 1334); handArrow(g, [[x + 120 * sc, y + 60 * sc], [x + 50 * sc, y + 40 * sc], [x + 8 * sc, y + 8 * sc]], { ...o, p: p, head: 12 * sc }); if (p >= 1) handText(g, "the fit ✓", x + 135 * sc, y + 62 * sc, { font: F(28), color: C.pen, seed }); },
    ];
    items.forEach((f, i) => { const p = clamp((n - i * 2 + 1) / 2); if (p > 0) f(ctx, p); });
  }

  function doodles(st, seed) {
    const n = st - smStep(T.doodles[0]), o = { color: C.note, w: 2.4 * sc, amp: 1.6, seed };
    const F = (sz, ar) => ar ? `700 ${sz * 1.7 * sc}px "Aref Ruqaa"` : `700 ${sz * 1.6 * sc}px Caveat`;
    const box = isM ? [S(0, 0), S(2000, 704)] : [S(0, 0), S(2000, 1334)];
    const [[x0, y0], [x1, y1]] = box, m = 58 * sc;
    const items = [
      () => sparkle(ctx, x1 + m * .6, y0 - m * .3, 18 * sc, o),
      () => handText(ctx, "© 2026", x1 - 10 * sc, y1 + m * 1.1, { font: F(26), color: C.note, seed, align: "right" }),
      () => { handArrow(ctx, [[x0 - m * 1.6, y0 - m * .2], [x0 - m * 1.0, y0 + m * .1], [x0 - m * .35, y0 + m * .55]], { ...o, head: 11 * sc }); handText(ctx, isM ? "2026" : "v1", x0 - m * 1.8, y0 - m * .6, { font: F(26), color: C.note, seed }); },
      () => isM ? handText(ctx, "مِهاد", x0 - m * .2, y1 + m * 1.1, { font: F(30, 1), color: C.note, seed, dir: "rtl", align: "left" }) : handText(ctx, "body ∩ digital", x0, y1 + m * 1.1, { font: F(26), color: C.note, seed }),
      () => sparkle(ctx, x0 - m * .7, y1 - m * .2, 9 * sc, { ...o, seed: seed + 3 }),
      () => handEllipse(ctx, x1 + m * .9, y1 - m * .1, 6 * sc, 6 * sc, { ...o, w: 2 * sc }),
    ];
    items.forEach((f, i) => { if (n >= i) f(); });
  }

  const mask = Object.assign(document.createElement("canvas"), { width: 10, height: 10 });
  function draw(t, frame) {
    const st = smStep(t), seed = st * 13 + 1;
    if (mask.width !== W) { mask.width = W; mask.height = H; }
    const dark = t >= T.brush[1] - .02;
    if (!dark) paperBG(C.paper); else flatBG(C.dark);
    const m = mask.getContext("2d");

    if (t < T.clean) {                                        // guides + charcoal drawing
      guides(st, seed);
      if (t >= T.draw[0]) {
        const q = clamp((st - smStep(T.draw[0]) + 1) / (smStep(T.draw[1]) - smStep(T.draw[0])));
        m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H); P.tr(m); revealMask(m, q);
        m.globalCompositeOperation = "source-in"; LOGO.drawRough(m, st); m.globalCompositeOperation = "source-over";
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(mask, 0, 0);
      }
      return;
    }
    if (t < T.slice[0]) {                                     // clean logo + pen notes
      P.tr(ctx); LOGO.drawFinal(ctx, false); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (t >= T.notes[0]) penNotes(st, seed);
      return;
    }
    if (!dark) {                                              // slice, then brush strokes
      const k = st - smStep(T.slice[0]) + 1, bands = 9, ang = -.42, shift = 14 * sc * k * k;
      m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H);
      for (let i = 0; i < bands; i++) {
        m.save(); m.translate(W / 2, H / 2); m.rotate(ang); const bh = Math.hypot(W, H) / bands;
        m.beginPath(); m.rect(-W, -Math.hypot(W, H) / 2 + i * bh, 2 * W, bh); m.clip();
        m.translate((i % 2 ? 1 : -1) * shift * (1 + (i % 3) * .4), 0); m.rotate(-ang); m.translate(-W / 2, -H / 2);
        P.apply(m); LOGO.drawFinal(m, false); m.restore();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(mask, 0, 0);
      const nb = st - smStep(T.brush[0]);                     // brushes land one per step, scaled to cover
      for (let i = 0; i <= Math.min(nb, 2); i++) {
        const b = IMG["brush" + i], s = 1.9;
        m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H);
        m.translate(W / 2, H / 2); m.scale(s * Math.max(W / 1920, H / 1080), s * H / 1080 * 1.2); m.translate(-960, -540);
        m.drawImage(b, 0, (i - 1) * 140); m.setTransform(1, 0, 0, 1, 0, 0);
        m.globalCompositeOperation = "source-in"; m.fillStyle = C.dark; m.fillRect(0, 0, W, H); m.globalCompositeOperation = "source-over";
        ctx.drawImage(mask, 0, 0);
      }
      if (nb >= 3) flatBG(C.dark);
      return;
    }
    vignetteDark(.3);                                         // dark page: the logo returns, notes pop
    if (t >= T.back[0]) {
      if (st === smStep(T.back[0])) {                         // first step: only some bands
        m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, W, H); P.tr(m); LOGO.drawFinal(m, true);
        m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "destination-in"; m.translate(W / 2, H / 2); m.rotate(-.42);
        const D = Math.hypot(W, H), bh = D / 9; m.beginPath(); for (let i = 0; i < 9; i += 2) m.rect(-D, -D / 2 + i * bh, 2 * D, bh); m.fill();
        m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "source-over"; ctx.drawImage(mask, 0, 0);
      } else { P.tr(ctx); LOGO.drawFinal(ctx, true); ctx.setTransform(1, 0, 0, 1, 0, 0); }
    }
    if (t >= T.doodles[0]) doodles(st, seed);
  }

  function cues() {
    const st = t => smStep(t) / SM_FPS, ev = [];
    for (let t = 0; t < T.clean; t += 1 / SM_FPS) ev.push({ type: "scratch", t: st(t + 1e-4), level: t < T.draw[0] ? -32 : -26 });
    for (let i = 0; i < 4; i++) ev.push({ type: "squeak", t: T.notes[0] + i * 2 / SM_FPS, d: .16 });
    ev.push({ type: "zip", t: T.slice[0] });
    [0, 1, 2].forEach(i => ev.push({ type: "whoosh", t: T.brush[0] + i / SM_FPS - .03, d: .32, pan: [i % 2 ? .6 : -.6, i % 2 ? -.4 : .4], level: -12, fc: [180, 1400] }));
    ev.push({ type: "impact", t: T.back[0], style: isM ? "paper" : "digital" });
    for (let i = 0; i < 6; i++) ev.push({ type: "pop", t: T.doodles[0] + i / SM_FPS, pan: [.6, .4, -.6, -.3, -.7, .7][i] });
    return { dur: T.dur, events: ev };
  }

  window.BRAND_DEF = { name: "mash-" + LOGO_NAME, load, draw, cues, blur: [] };
  TIMING.dur = T.dur;
})();
