/* AIM × "Back Market": a small grey mark lights up; the camera dives into it and travels
   across giant outlined letters, then giant solid slices; it snaps back to the mark,
   the letters wipe away, the circles merge to a dot, and the page flips to light where
   the mark rebuilds: circles part, letters type on. */
"use strict";
(() => {
  const T = { light: [.6, .9], dive: [1.15, 1.55], pan: [1.55, 2.75], slices: [2.75, 3.45], snap: [3.45, 3.8], hold: 4.8,
    wipeOut: [4.8, 5.25], merge: [5.15, 5.65], dot: [5.65, 6.0], flip: 6.08, part: [6.1, 6.6], type: [6.55, .1], end: 8.0 };
  const DARK = "#05090A", LIGHT = "#E6F6F3";
  let P, OUT;

  async function load() {
    await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 660 : 720);
    OUT = await (await fetch("../assets/aim/letter_outlines.json")).json();
  }

  // camera: zoom k around a focus point (source px) placed at screen centre
  function cam(g, k, fx, fy) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, H / 2); g.scale(P.L * k, P.L * k); g.translate(-fx, -fy);
  }
  function outlines(k, fx, fy, alpha) {
    const { c1, c2, R } = LOGO;
    cam(ctx, k, fx, fy); ctx.lineWidth = 1.7 / (P.L * k); ctx.strokeStyle = `rgba(235,245,244,${alpha})`;
    for (const c of [c1, c2]) { ctx.beginPath(); LOGO.ell(ctx, c[0], c[1]); ctx.stroke(); }
    for (const poly of OUT) { ctx.beginPath(); poly.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function draw(t, n) {
    const { c1, c2, CX, CY } = LOGO, lb = LOGO.G.letters;
    if (t >= T.flip) {                                          // light page: the mark rebuilds
      flatBG(LIGHT); P.tr(ctx);
      const p = E.outCubic(seg(t, T.part[0], T.part[1])), shown = i => n / FPS >= T.type[0] + i * T.type[1] - 1e-6;
      if (t > T.type[0] + 3 * T.type[1]) LOGO.drawFinal(ctx, false);
      else {
        const r = lerp(60, LOGO.R, E.outCubic(seg(t, T.flip, T.part[0] + .15)));
        LOGO.drawMark(ctx, { x1: lerp(CX, c1[0], p), x2: lerp(CX, c2[0], p), r, letters: [0, 1, 2].map(i => shown(i) ? 1 : 0) });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); return;
    }
    flatBG(DARK);
    if (t < T.dive[0] || (t >= T.snap[0])) {                    // the mark at normal scale (and the snap back)
      let k = 1, fx = CX, fy = CY;
      if (t >= T.snap[0] && t < T.snap[1]) { const s = E.outCubic(seg(t, T.snap[0], T.snap[1])); k = lerp(5, 1, s); fx = lerp((lb[2][0] + lb[2][2]) / 2, CX, s); }
      cam(ctx, k, fx, fy);
      const lit = E.inOutCubic(seg(t, T.light[0], T.light[1]));
      if (t < T.hold) {
        if (lit < 1) { ctx.save(); ctx.filter = "grayscale(1)"; LOGO.drawMark(ctx, { dark: true, alpha: .35 + .65 * lit }); ctx.restore(); }
        if (lit > 0) LOGO.drawMark(ctx, { dark: true, alpha: lit });
      } else {                                                   // letters wipe out right→left, circles merge to a dot
        const w = E.inOutCubic(seg(t, T.wipeOut[0], T.wipeOut[1])), lbx = LOGO.G.letters_box;
        const m = E.inOutCubic(seg(t, T.merge[0], T.merge[1])), d = E.inOutCubic(seg(t, T.dot[0], T.dot[1]));
        LOGO.drawMark(ctx, { dark: true, x1: lerp(c1[0], CX, m), x2: lerp(c2[0], CX, m), r: lerp(LOGO.R, 40, d), wipe: lerp(lbx[2] + 10, lbx[0] - 10, w), letters: w >= 1 ? [0, 0, 0] : [1, 1, 1] });
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); return;
    }
    if (t < T.pan[0]) {                                         // the dive into the lens
      const z = E.inOutQuint(seg(t, T.dive[0], T.dive[1]));
      const k = lerp(1, 8, z * z), fx = lerp(CX, (lb[0][0] + lb[0][2]) / 2, z);
      cam(ctx, k, fx, CY); LOGO.drawMark(ctx, { dark: true, alpha: 1 - z * .9 }); ctx.setTransform(1, 0, 0, 1, 0, 0);
      outlines(k, fx, CY, z);
      return;
    }
    if (t < T.slices[0]) {                                      // travelling across giant outlines
      const p = E.inOutSine(seg(t, T.pan[0], T.pan[1]));
      outlines(lerp(8, 6.5, p), lerp((lb[0][0] + lb[0][2]) / 2, (lb[2][0] + lb[2][2]) / 2, p), CY + Math.sin(p * Math.PI) * 60, 1);
      return;
    }
    // giant solid slices of the mark through vertical bands that jump each quarter second
    const cut = Math.floor((t - T.slices[0]) / .23), fx = [(lb[1][0] + lb[1][2]) / 2, (lb[2][0] + lb[2][2]) / 2, lb[2][0] + 60][Math.min(cut, 2)];
    cam(ctx, 5, fx, CY);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath();
    for (let i = 0; i < 4; i++) { const x0 = W * rnd(cut * 17 + i * 3), w = W * lerp(.08, .3, rnd(cut * 17 + i * 3 + 1)); ctx.rect(x0, 0, w, H); }
    ctx.clip(); cam(ctx, 5, fx, CY); LOGO.drawFinal(ctx); ctx.restore();
    outlines(5, fx, CY, .5);
  }

  function cues() {
    return { dur: T.end, events: [
      { type: "swell", t: .1, d: T.light[1] }, { type: "pop", t: T.light[0] + .05, pan: 0 },
      { type: "riser", t: T.dive[0] - .35, d: .75 }, { type: "whoosh", t: T.pan[0], d: T.pan[1] - T.pan[0], pan: [-.6, .6], level: -19, fc: [200, 1500] },
      { type: "zip", t: T.slices[0] }, { type: "zip", t: T.slices[0] + .23 }, { type: "zip", t: T.slices[0] + .46 },
      { type: "impact", t: T.snap[0] + .05, style: "digital", tail: T.wipeOut[0] - T.snap[0] },
      { type: "zip", t: T.wipeOut[0] + .1 }, { type: "whoosh", t: T.merge[0], d: .5, pan: [.3, 0], level: -20, fc: [300, 1800] },
      { type: "thud", t: T.dot[1] - .05 }, { type: "impact", t: T.flip, style: "digital" },
      ...[0, 1, 2].map(i => ({ type: "type", t: T.type[0] + i * T.type[1], pan: (i - 1) * .4 })),
    ] };
  }

  window.BRAND_DEF = { name: "backm-aim", load, draw, cues, blur: [[T.dive[0], T.pan[1]], [T.snap[0], T.snap[1]], [T.wipeOut[0], T.dot[1]], [T.flip, T.part[1]]] };
  TIMING.dur = T.end;
})();
