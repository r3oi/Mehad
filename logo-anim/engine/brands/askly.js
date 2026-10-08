/* AIM × "Askly": ink dabs scattered over the page swirl in and assemble into the mark.
   The mark is cut into wedge pieces (the official pixels); each piece starts life as a
   dab far away, flies a curved path, and unfolds into its piece as it lands. */
"use strict";
(() => {
  const T = { start: .05, stagger: .045, fly: .8, swap: 1.18, end: 4.0 };
  const BG = "#F4F7F7", INK = "#23B2A8";
  let P, pieces = [], extras = [];

  async function load() {
    await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 720 : 820);
    const { c1, c2, R } = LOGO;
    [[c1, .3], [c2, 1.1]].forEach(([c, a0], ci) => {
      const cuts = [0, .23, .51, .74, 1].map((f, i) => a0 + f * Math.PI * 2 + (i % 4 ? hash(ci * 9 + i) * .25 : 0));
      for (let i = 0; i < 4; i++) {
        const a = cuts[i], b = cuts[i + 1], m = (a + b) / 2;
        pieces.push({ c, a, b, cx: c[0] + Math.cos(m) * R * .55, cy: c[1] + Math.sin(m) * R * .55, k: pieces.length });
      }
    });
    pieces.forEach((p, i) => {                                  // start somewhere around the frame
      const ang = rnd(i * 7 + 1) * Math.PI * 2, dist = lerp(950, 1500, rnd(i * 7 + 2));
      p.sx = LOGO.CX + Math.cos(ang) * dist * 1.25; p.sy = LOGO.CY + Math.sin(ang) * dist * .7;
      p.rot = hash(i * 7 + 3) * 1.6; p.swirl = hash(i * 7 + 4) * 420; p.t0 = T.start + i * T.stagger;
    });
    for (let i = 0; i < 7; i++) extras.push({ sx: LOGO.CX + hash(i * 5 + 50) * 1500, sy: LOGO.CY + hash(i * 5 + 51) * 700, t0: T.start + rnd(i * 5 + 52) * .3, to: pieces[i % 8] });
  }

  function dab(g, x, y, w, h, rot) {                           // a soft marker dab
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); g.fill(); g.restore();
  }

  function draw(t) {
    flatBG(BG);
    P.tr(ctx); ctx.imageSmoothingQuality = "high";
    if (t >= T.swap) { LOGO.drawFinal(ctx, false); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    for (const e of extras) {                                   // stray dabs that join the nearest piece
      const u = seg(t, e.t0, e.t0 + .55); if (u <= 0 || u >= 1) continue;
      const q = E.inOutCubic(u), x = lerp(e.sx, e.to.cx, q), y = lerp(e.sy, e.to.cy, q);
      ctx.globalAlpha = 1 - E.inOutCubic(seg(u, .6, 1)); dab(ctx, x, y, 200 * (1 - .4 * q), 110 * (1 - .4 * q), q * 2 + e.sx * .01); ctx.globalAlpha = 1;
    }
    for (const p of pieces) {
      const u = seg(t, p.t0, p.t0 + T.fly); if (u <= 0) continue;
      const q = E.outCubic(u), sw = Math.sin(Math.PI * q) * p.swirl;
      const dx = p.sx - p.cx, dy = p.sy - p.cy, len = Math.hypot(dx, dy) || 1;
      const x = lerp(p.sx, p.cx, q) - dy / len * sw, y = lerp(p.sy, p.cy, q) + dx / len * sw;
      const morph = E.inOutCubic(seg(u, .38, .82));
      if (morph < 1) { ctx.globalAlpha = 1 - morph; dab(ctx, x, y, lerp(170, 320, q), lerp(95, 170, q), p.rot * (1 - q) + q * (p.a + p.b) / 2); ctx.globalAlpha = 1; }
      if (morph > 0) {                                          // the piece unfolds from the dab
        const s = lerp(.35, 1, morph), r = p.rot * (1 - q);
        ctx.save(); ctx.translate(x, y); ctx.rotate(r); ctx.scale(s, s); ctx.translate(-p.cx, -p.cy);
        ctx.beginPath(); ctx.moveTo(p.c[0], p.c[1]); ctx.arc(p.c[0], p.c[1], LOGO.R + 3, p.a, p.b); ctx.closePath(); ctx.clip();
        ctx.globalAlpha = morph; LOGO.drawFinal(ctx, false); ctx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function cues() {
    const ev = [];
    pieces.forEach((p, i) => { ev.push({ type: "pop", t: p.t0 + .02, pan: hash(i * 3) * .7 }); ev.push({ type: "flutter", t: p.t0 + T.fly * .55 }); });
    ev.push({ type: "whoosh", t: T.start, d: .9, pan: [-.4, .4], level: -20, fc: [300, 2400] });
    ev.push({ type: "impact", t: T.swap - .08, style: "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "askly-aim", load, draw, cues, blur: [[0, T.swap]] };
  TIMING.dur = T.end;
})();
