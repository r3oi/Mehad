/* AIM × "Alterscope": a dot grows into the first circle, the second slides out from
   behind it, the letters wipe in; construction lines draw the mark's geometry; then
   colour panels rise from the bottom one after another and the mark changes to the
   right version on each ground (white on mint, official on light, white letters on dark). */
"use strict";
(() => {
  const T = { dot: [.15, .5], grow: [.45, 1.05], slide: [.95, 1.45], wipe: [1.4, 1.85], lines: [2.4, 4.9], panels: 5.3, step: .95, dur: .5, end: 10.4 };
  const BASE = "#141A1A", MINT = "#5FD8CA";
  const PANELS = [[MINT, "mono"], ["#FAFCFC", "light"], ["#DDE5E4", "light"], ["#0E4A45", "dark"], [BASE, "dark"]];
  let P, LG;

  async function load() { await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 680 : 760); }
  const S = (x, y) => [P.x + x * P.L, P.y + y * P.L];

  function mark(t, variant) {
    const { c1, c2, R } = LOGO;
    P.tr(ctx);
    if (t >= T.wipe[1] + .05 && variant !== "mono") { LOGO.drawFinal(ctx, variant === "dark"); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    const d = seg(t, T.dot[0], T.dot[1]), gr = E.outCubic(seg(t, T.grow[0], T.grow[1]));
    if (gr <= 0) {                                             // the dot
      if (d > 0) { ctx.fillStyle = MINT; ctx.beginPath(); ctx.arc(c1[0], c1[1], 30 * E.outCubic(d) / P.L * .45, 0, 7); ctx.fill(); }
      ctx.setTransform(1, 0, 0, 1, 0, 0); return;
    }
    const r = lerp(30 * .45 / P.L, R, gr), sl = E.outCubic(seg(t, T.slide[0], T.slide[1]));
    const lb = LOGO.G.letters_box, wp = lerp(lb[0] - 20, lb[2] + 20, E.inOutCubic(seg(t, T.wipe[0], T.wipe[1])));
    LOGO.drawMark(ctx, { x1: c1[0], x2: sl > 0 ? lerp(c1[0], c2[0], sl) : null, r, wipe: t >= T.wipe[0] ? wp : -1e9, dark: variant === "dark", mono: variant === "mono" });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function lines(t) {                                          // construction geometry, drawn on
    const u = seg(t, T.lines[0], T.lines[1]); if (u <= 0) return;
    const { c1, c2, R, CY } = LOGO, m = R * .3;
    const box = [S(c1[0] - R - m, CY - R - m), S(c2[0] + R + m, CY + R + m)];
    const [[bx0, by0], [bx1, by1]] = box, ext = 60 * W / 1920;
    ctx.save(); ctx.strokeStyle = "rgba(95,216,202,.55)"; ctx.lineWidth = 1.4; ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ln = (x0, y0, x1, y1, p) => { if (p <= 0) return; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, p), lerp(y0, y1, p)); ctx.stroke(); };
    const p = k => E.inOutCubic(clamp((u - k * .07) / .3));
    [CY - R, CY, CY + R].forEach((y, i) => { const [, yy] = S(0, y); ln(bx0 - ext, yy, bx1 + ext, yy, p(i)); });
    [c1[0] - R, c2[0] - R, c1[0] + R, c2[0] + R].forEach((x, i) => { const [xx] = S(x, 0); ln(xx, by0 - ext, xx, by1 + ext, p(3 + i)); });
    const bp = p(7);
    if (bp > 0) {
      ctx.fillStyle = `rgba(95,216,202,${.07 * bp})`; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
      ln(bx0, by0, bx1, by0, bp); ln(bx1, by0, bx1, by1, bp); ln(bx1, by1, bx0, by1, bp); ln(bx0, by1, bx0, by0, bp);
    }
    const tp = p(8);                                            // dimension ticks on the right
    for (let i = 0; i < 5; i++) { const y = lerp(by0, by1, i / 4), x = bx1 + 26 * W / 1920; if (tp * 5 > i) ln(x - 6, y, x + 6, y, 1); }
    if (tp > 0) ln(bx1 + 26 * W / 1920, by0, bx1 + 26 * W / 1920, by1, tp);
    ctx.restore();
  }

  function draw(t) {
    // panel k is the last one that started rising
    let k = -1; for (let i = 0; i < PANELS.length; i++) if (t >= T.panels + i * T.step) k = i;
    const cur = k < 0 ? [BASE, "dark"] : PANELS[k];
    const settled = k >= 0 ? E.inOutCubic(seg(t, T.panels + k * T.step, T.panels + k * T.step + T.dur)) : 1;
    // the current ground (the previous one below its edge until it finishes rising)
    const prev = k <= 0 ? [BASE, "dark"] : PANELS[k - 1];
    flatBG(settled < 1 ? prev[0] : cur[0]); mark(t, settled < 1 ? prev[1] : cur[1]);
    if (k < 0) lines(t);
    if (k === 0 && settled < 1) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H * (1 - settled)); ctx.clip(); lines(t); ctx.restore(); }
    if (settled < 1) {
      const ey = H * (1 - settled);
      ctx.save(); ctx.beginPath(); ctx.rect(0, ey, W, H - ey); ctx.clip(); flatBG(cur[0]); mark(t, cur[1]); ctx.restore();
    }
  }

  function cues() {
    const ev = [{ type: "pop", t: T.dot[0], pan: -.3 }, { type: "whoosh", t: T.grow[0], d: .6, pan: [-.3, -.2], level: -20, fc: [300, 1800] },
      { type: "whoosh", t: T.slide[0], d: .5, pan: [-.2, .3], level: -20, fc: [400, 2200] }, { type: "zip", t: T.wipe[0] + .1 },
      { type: "impact", t: T.wipe[1], style: "digital", tail: T.lines[1] - T.wipe[1] + .4 }];
    for (let i = 0; i < 9; i++) ev.push({ type: "type", t: T.lines[0] + i * .175, pan: (i % 3 - 1) * .4 });
    PANELS.forEach((_, i) => ev.push({ type: "whoosh", t: T.panels + i * T.step - .05, d: T.dur + .15, pan: [0, 0], level: -17, fc: [200, 1600] }));
    ev.push({ type: "thud", t: T.panels + (PANELS.length - 1) * T.step + T.dur - .05 });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "alter-aim", load, draw, cues, blur: [[T.grow[0], T.slide[1]], [T.panels, T.panels + PANELS.length * T.step]] };
  TIMING.dur = T.end;
})();
