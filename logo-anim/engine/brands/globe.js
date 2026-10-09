/* × "Globe-Trotter": a tour of the logo system with clean typewriter timing.
   AIM:   the letters delete one by one, the two circles slide into one small symbol
          (the year beside it), then it splits back into the pair and the letters type on.
   MEHAD: MEHAD deletes from its end, then «مهاد» from its end, leaving the icon; the icon
          travels to the centre and shrinks (the year in sand beside it), returns, and the
          name types back on — Arabic right → left, then MEHAD left → right. */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  const T = isM
    ? { del: [.85, .1], delAr: [1.4, .1], merge: [1.85, 2.4], small: [2.4, 3.2], grow: [3.2, 3.75], type: [3.8, .1], typeEn: [4.25, .08], settle: 4.7, end: 6.8 }
    : { del: [.95, .2], merge: [1.5, 2.05], small: [2.05, 2.85], grow: [2.85, 3.45], type: [3.5, .15], settle: 4.0, end: 6.5 };
  const BG = isM ? "#0E1620" : "#071A1C", NOTE = isM ? "#D9B77A" : "#7FE6DA";
  let P;

  async function load() { await LOGO.load(); P = place(LOGO, isM ? (FORMAT === "1x1" ? 860 : 1040) : (FORMAT === "1x1" ? 700 : 780)); }

  function year(t, cx, cy, r) {                                  // "20 · 26" beside the small symbol
    const yr = seg(t, T.small[0], T.small[0] + .2) * (1 - seg(t, T.grow[0], T.grow[0] + .15));
    if (yr <= 0) return;
    const fs = 28 * W / 1920; ctx.globalAlpha = yr; ctx.fillStyle = NOTE; ctx.font = `600 ${fs}px Inter, sans-serif`; ctx.textBaseline = "middle";
    ctx.textAlign = "right"; ctx.fillText("20", cx - r - 18 * W / 1920, cy + r * .55);
    ctx.textAlign = "left"; ctx.fillText("26", cx + r + 18 * W / 1920, cy + r * .55); ctx.globalAlpha = 1;
  }

  function drawAIM(t, tf) {
    const { c1, c2, CX } = LOGO;
    const off = i => tf >= T.del[0] + (2 - i) * T.del[1] - 1e-6, on = i => tf >= T.type[0] + i * T.type[1] - 1e-6;
    const letters = [0, 1, 2].map(i => (tf < T.type[0] ? !off(i) : on(i)) ? 1 : 0);
    const m = E.inOutCubic(seg(t, T.merge[0], T.merge[1])) * (1 - E.inOutCubic(seg(t, T.grow[0], T.grow[1]))), k = lerp(1, .42, m);
    ctx.translate(CX, LOGO.CY); ctx.scale(k, k); ctx.translate(-CX, -LOGO.CY);
    LOGO.drawMark(ctx, { dark: true, x1: lerp(c1[0], CX, m), x2: lerp(c2[0], CX, m), letters });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    year(t, W / 2, H / 2, LOGO.R * P.L * .42);
  }

  function drawMehad(t, tf) {
    const ar = LOGO.slots.filter(s => s.group === "ar"), en = LOGO.slots.filter(s => s.group === "en");   // reading order
    const vis = (list, i, del, typ) => tf < T.type[0] ? tf < del[0] + (list.length - 1 - i) * del[1] - 1e-6 : tf >= typ[0] + i * typ[1] - 1e-6;
    const [a, b, c, d] = LOGO.icon, icx = (a + c) / 2, icy = (b + d) / 2;
    const m = E.inOutCubic(seg(t, T.merge[0], T.merge[1])) * (1 - E.inOutCubic(seg(t, T.grow[0], T.grow[1]))), k = lerp(1, .5, m);
    const sx = P.x + icx * P.L, sy = P.y + icy * P.L, tx = lerp(sx, W / 2, m), ty = lerp(sy, H / 2, m);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(tx, ty); ctx.scale(P.L * k, P.L * k); ctx.translate(-icx, -icy); LOGO.drawIcon(ctx);
    P.tr(ctx);
    for (const [list, del, typ] of [[ar, T.delAr, T.type], [en, T.del, T.typeEn]])
      list.forEach((s, i) => { if (!vis(list, i, del, typ)) return; const [x0, y0, x1, y1] = s.box; ctx.drawImage(LOGO.layer(s.img, true), x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    year(t, W / 2, H / 2, (d - b) * P.L * .5 / 2);
  }

  function draw(t, n) {
    flatBG(BG); vignetteDark(.25);
    const tf = n / FPS;
    P.tr(ctx); ctx.imageSmoothingQuality = "high";
    if (tf < T.del[0] || tf >= T.settle) { LOGO.drawFinal(ctx, true); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    if (isM) drawMehad(t, tf); else drawAIM(t, tf);
  }

  function cues() {
    const ev = [];
    const del = isM ? [...[0, 1, 2, 3, 4].map(i => T.del[0] + i * T.del[1]), ...[0, 1, 2, 3].map(i => T.delAr[0] + i * T.delAr[1])] : [0, 1, 2].map(i => T.del[0] + i * T.del[1]);
    const typ = isM ? [...[0, 1, 2, 3].map(i => T.type[0] + i * T.type[1]), ...[0, 1, 2, 3, 4].map(i => T.typeEn[0] + i * T.typeEn[1])] : [0, 1, 2].map(i => T.type[0] + i * T.type[1]);
    del.forEach((t, i) => ev.push({ type: "type", t, pan: .4 - i * .1 }));
    ev.push({ type: "whoosh", t: T.merge[0], d: T.merge[1] - T.merge[0] + .1, pan: [isM ? .4 : 0, 0], level: -19, fc: [300, 1800] });
    ev.push({ type: "pop", t: T.small[0] + .05, pan: 0 });
    ev.push({ type: "whoosh", t: T.grow[0], d: T.grow[1] - T.grow[0] + .1, pan: [0, isM ? .4 : 0], level: -19, fc: [400, 2400] });
    typ.forEach((t, i) => ev.push({ type: "type", t, pan: isM ? (i < 4 ? .3 - i * .15 : -.5 + (i - 4) * .2) : (i - 1) * .4 }));
    ev.push({ type: "impact", t: T.settle - .05, style: isM ? "paper" : "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "globe-" + LOGO_NAME, load, draw, cues, blur: [[T.merge[0], T.merge[1]], [T.grow[0], T.grow[1]]] };
  TIMING.dur = T.end;
})();
