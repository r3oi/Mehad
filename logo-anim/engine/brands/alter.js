/* × "Alterscope": a dot grows into the symbol, the name wipes in from it; construction
   lines draw the logo's geometry; then colour panels rise from the bottom one after
   another and the logo switches to the right version on each ground.
   AIM:   dot → first circle, the second slides out, letters wipe in left → right;
          panels mint (white mono) · white · light grey · deep teal · graphite.
   MEHAD: dot → the icon square, the thread opens from the knot, the counters fill, the
          name wipes in right → left from the icon; panels from the brand palette
          (light sand · white · light olive · navy · base), reversed lockup on dark. */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  const T = { dot: [.15, .5], grow: [.45, 1.05], slide: [.95, 1.45], wipe: [1.4, 1.85], lines: [2.4, 4.9], panels: 5.3, step: .95, dur: .5, end: 10.4 };
  const C = isM
    ? { base: "#0E1620", accent: "#28A299", line: "40,162,153", width: { "16x9": 1040, "1x1": 860 },
        panels: [["#EFE6D6", "light"], ["#FAFAF8", "light"], ["#E1ECE3", "light"], ["#43546A", "dark"], ["#0E1620", "dark"]] }
    : { base: "#141A1A", accent: "#5FD8CA", line: "95,216,202", width: { "16x9": 760, "1x1": 680 },
        panels: [["#5FD8CA", "mono"], ["#FAFCFC", "light"], ["#DDE5E4", "light"], ["#0E4A45", "dark"], ["#141A1A", "dark"]] };
  const PANELS = C.panels;
  let P, GEO;

  async function load() {
    await LOGO.load(); P = place(LOGO, C.width[FORMAT]);
    if (isM) GEO = { h: [1, 329, 441, 704], v: [0, 1147, 1296, 2000], box: [-70, -70, 2070, 774] };
    else {
      const { c1, c2, R, CY } = LOGO, m = R * .3;
      GEO = { h: [CY - R, CY, CY + R], v: [c1[0] - R, c2[0] - R, c1[0] + R, c2[0] + R], box: [c1[0] - R - m, CY - R - m, c2[0] + R + m, CY + R + m] };
    }
  }
  const S = (x, y) => [P.x + x * P.L, P.y + y * P.L];
  const dotR = () => 30 * .45 / P.L * (isM ? 1.2 : 1);

  function markAIM(t, variant) {
    const { c1, c2, R } = LOGO, gr = E.outCubic(seg(t, T.grow[0], T.grow[1]));
    const r = lerp(dotR(), R, gr), sl = E.outCubic(seg(t, T.slide[0], T.slide[1]));
    const lb = LOGO.G.letters_box, wp = lerp(lb[0] - 20, lb[2] + 20, E.inOutCubic(seg(t, T.wipe[0], T.wipe[1])));
    LOGO.drawMark(ctx, { x1: c1[0], x2: sl > 0 ? lerp(c1[0], c2[0], sl) : null, r, wipe: t >= T.wipe[0] ? wp : -1e9, dark: variant === "dark", mono: variant === "mono" });
  }
  function markMehad(t, variant) {
    const dark = variant === "dark", [a, b, c, d] = LOGO.icon, icx = (a + c) / 2, icy = (b + d) / 2, src = LOGO.src;
    const s = lerp(dotR() * 2 / (d - b), 1, E.outCubic(seg(t, T.grow[0], T.grow[1])));
    ctx.save(); ctx.translate(icx, icy); ctx.scale(s, s); ctx.translate(-icx, -icy); ctx.drawImage(LOGO.I("icon_square"), 0, 0, src.w, src.h); ctx.restore();
    [["sand", 0], ["navy", 1], ["olive", 2]].forEach(([nm, i]) => {          // counters fill, right → left
      const q = E.outCubic(seg(t, T.slide[0] + .15 + i * .08, T.slide[0] + .45 + i * .08)); if (q <= 0) return;
      const [fx, fy] = LOGO.G["fill_" + nm];
      ctx.save(); ctx.beginPath(); ctx.arc(fx, fy, 160 * q, 0, 7); ctx.clip(); ctx.drawImage(LOGO.I("icon_fill_" + nm), 0, 0, src.w, src.h); ctx.restore();
    });
    const th = E.outCubic(seg(t, T.slide[0], T.slide[1]));                     // the thread opens from the knot
    if (th > 0) { ctx.save(); ctx.beginPath(); ctx.arc(1620, 330, 620 * th, 0, 7); ctx.clip(); ctx.drawImage(LOGO.I("icon_thread"), 0, 0, src.w, src.h); ctx.restore(); }
    const wp = lerp(a, -20, E.inOutCubic(seg(t, T.wipe[0], T.wipe[1])));       // the name, right → left from the icon
    if (t >= T.wipe[0]) {
      ctx.save(); ctx.beginPath(); ctx.rect(wp, -10, a - wp, src.h + 20); ctx.clip();
      ctx.drawImage(LOGO.layer("ar", dark), 0, 0, src.w, src.h); ctx.drawImage(LOGO.layer("en", dark), 0, 0, src.w, src.h); ctx.restore();
    }
  }

  function mark(t, variant) {
    P.tr(ctx);
    if (t >= T.wipe[1] + .05 && variant !== "mono") { LOGO.drawFinal(ctx, variant === "dark"); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    if (seg(t, T.grow[0], T.grow[1]) <= 0) {                                    // the dot
      const d = seg(t, T.dot[0], T.dot[1]);
      if (d > 0) {
        const [cx, cy] = isM ? [(LOGO.icon[0] + LOGO.icon[2]) / 2, (LOGO.icon[1] + LOGO.icon[3]) / 2] : LOGO.c1;
        ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(cx, cy, dotR() * E.outCubic(d), 0, 7); ctx.fill();
      }
    } else if (isM) markMehad(t, variant); else markAIM(t, variant);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function lines(t) {                                          // construction geometry, drawn on
    const u = seg(t, T.lines[0], T.lines[1]); if (u <= 0) return;
    const [[bx0, by0], [bx1, by1]] = [S(GEO.box[0], GEO.box[1]), S(GEO.box[2], GEO.box[3])], ext = 60 * W / 1920;
    ctx.save(); ctx.strokeStyle = `rgba(${C.line},.55)`; ctx.lineWidth = 1.4; ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ln = (x0, y0, x1, y1, p) => { if (p <= 0) return; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, p), lerp(y0, y1, p)); ctx.stroke(); };
    const p = k => E.inOutCubic(clamp((u - k * .07) / .3));
    GEO.h.forEach((y, i) => { const [, yy] = S(0, y); ln(bx0 - ext, yy, bx1 + ext, yy, p(i)); });
    GEO.v.forEach((x, i) => { const [xx] = S(x, 0); ln(xx, by0 - ext, xx, by1 + ext, p(GEO.h.length + i)); });
    const bp = p(GEO.h.length + GEO.v.length);
    if (bp > 0) {
      ctx.fillStyle = `rgba(${C.line},${.07 * bp})`; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ln(bx0, by0, bx1, by0, bp); ln(bx1, by0, bx1, by1, bp); ln(bx1, by1, bx0, by1, bp); ln(bx0, by1, bx0, by0, bp);
    }
    const tp = p(GEO.h.length + GEO.v.length + 1), tx = bx1 + 26 * W / 1920;   // dimension ticks on the right
    for (let i = 0; i < 5; i++) { const y = lerp(by0, by1, i / 4); if (tp * 5 > i) ln(tx - 6, y, tx + 6, y, 1); }
    if (tp > 0) ln(tx, by0, tx, by1, tp);
    ctx.restore();
  }

  function draw(t) {
    // panel k is the last one that started rising; until it finishes, the previous ground stays above its edge
    let k = -1; for (let i = 0; i < PANELS.length; i++) if (t >= T.panels + i * T.step) k = i;
    const cur = k < 0 ? [C.base, "dark"] : PANELS[k], prev = k <= 0 ? [C.base, "dark"] : PANELS[k - 1];
    const settled = k >= 0 ? E.inOutCubic(seg(t, T.panels + k * T.step, T.panels + k * T.step + T.dur)) : 1;
    flatBG(settled < 1 ? prev[0] : cur[0]); mark(t, settled < 1 ? prev[1] : cur[1]);
    if (k < 0) lines(t);
    if (k === 0 && settled < 1) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H * (1 - settled)); ctx.clip(); lines(t); ctx.restore(); }
    if (settled < 1) {
      const ey = H * (1 - settled);
      ctx.save(); ctx.beginPath(); ctx.rect(0, ey, W, H - ey); ctx.clip(); flatBG(cur[0]); mark(t, cur[1]); ctx.restore();
    }
  }

  function cues() {
    const ev = [{ type: "pop", t: T.dot[0], pan: isM ? .3 : -.3 }, { type: "whoosh", t: T.grow[0], d: .6, pan: [0, 0], level: -20, fc: [300, 1800] },
      { type: "whoosh", t: T.slide[0], d: .5, pan: isM ? [.3, .2] : [-.2, .3], level: -20, fc: [400, 2200] }, { type: "zip", t: T.wipe[0] + .1 },
      { type: "impact", t: T.wipe[1], style: isM ? "paper" : "digital", tail: T.lines[1] - T.wipe[1] + .4 }];
    for (let i = 0; i < 9; i++) ev.push({ type: "type", t: T.lines[0] + i * .175, pan: (i % 3 - 1) * .4 });
    PANELS.forEach((_, i) => ev.push({ type: "whoosh", t: T.panels + i * T.step - .05, d: T.dur + .15, pan: [0, 0], level: -17, fc: [200, 1600] }));
    ev.push({ type: "thud", t: T.panels + (PANELS.length - 1) * T.step + T.dur - .05 });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "alter-" + LOGO_NAME, load, draw, cues, blur: [[T.grow[0], T.slide[1]], [T.panels, T.panels + PANELS.length * T.step]] };
  TIMING.dur = T.end;
})();
