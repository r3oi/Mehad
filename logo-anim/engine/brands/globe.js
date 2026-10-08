/* AIM × "Globe-Trotter": a tour of the mark's system with clean typewriter timing —
   the letters delete one by one, the two circles slide into one and shrink to a small
   symbol (with the year set beside it), then the symbol grows, splits back into the pair
   and the letters type back on. */
"use strict";
(() => {
  const T = { del: [.95, .2], merge: [1.5, 2.05], small: [2.05, 2.85], grow: [2.85, 3.45], type: [3.5, .15], settle: 4.0, end: 6.5 };
  const BG = "#071A1C", NOTE = "#7FE6DA";
  let P;

  async function load() { await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 700 : 780); }

  function draw(t, n) {
    flatBG(BG); vignetteDark(.25);
    const tf = n / FPS, { c1, c2, CX } = LOGO;
    P.tr(ctx); ctx.imageSmoothingQuality = "high";
    if (tf < T.del[0] || tf >= T.settle) { LOGO.drawFinal(ctx, true); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    // letters off (M, I, A) and back on (A, I, M) on whole frames, like a typewriter
    const off = i => tf >= T.del[0] + (2 - i) * T.del[1] - 1e-6, on = i => tf >= T.type[0] + i * T.type[1] - 1e-6;
    const letters = [0, 1, 2].map(i => (tf < T.type[0] ? !off(i) : on(i)) ? 1 : 0);
    const m = E.inOutCubic(seg(t, T.merge[0], T.merge[1])) * (1 - E.inOutCubic(seg(t, T.grow[0], T.grow[1])));
    const k = lerp(1, .42, m);
    ctx.translate(CX, LOGO.CY); ctx.scale(k, k); ctx.translate(-CX, -LOGO.CY);
    LOGO.drawMark(ctx, { dark: true, x1: lerp(c1[0], CX, m), x2: lerp(c2[0], CX, m), letters });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const yr = seg(t, T.small[0], T.small[0] + .2) * (1 - seg(t, T.grow[0], T.grow[0] + .15));   // "20 · 26" beside the small symbol
    if (yr > 0) {
      const r = LOGO.R * P.L * .42, cx = W / 2, cy = H / 2, fs = 22 * W / 1920;
      ctx.globalAlpha = yr; ctx.fillStyle = NOTE; ctx.font = `600 ${fs}px Inter, sans-serif`; ctx.textBaseline = "middle";
      ctx.textAlign = "right"; ctx.fillText("20", cx - r - 18 * W / 1920, cy + r * .55);
      ctx.textAlign = "left"; ctx.fillText("26", cx + r + 18 * W / 1920, cy + r * .55); ctx.globalAlpha = 1;
    }
  }

  function cues() {
    const ev = [];
    for (let i = 0; i < 3; i++) ev.push({ type: "type", t: T.del[0] + i * T.del[1], pan: (1 - i) * .4 });
    ev.push({ type: "whoosh", t: T.merge[0], d: T.merge[1] - T.merge[0] + .1, pan: [0, 0], level: -19, fc: [300, 1800] });
    ev.push({ type: "pop", t: T.small[0] + .05, pan: 0 });
    ev.push({ type: "whoosh", t: T.grow[0], d: T.grow[1] - T.grow[0] + .1, pan: [0, 0], level: -19, fc: [400, 2400] });
    for (let i = 0; i < 3; i++) ev.push({ type: "type", t: T.type[0] + i * T.type[1], pan: (i - 1) * .4 });
    ev.push({ type: "impact", t: T.settle - .05, style: "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "globe-aim", load, draw, cues, blur: [[T.merge[0], T.merge[1]], [T.grow[0], T.grow[1]]] };
  TIMING.dur = T.end;
})();
