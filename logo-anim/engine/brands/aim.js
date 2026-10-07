/* AIM — two circles slide in and meet; the I is born in their intersection.
   1  the left circle enters from the left, the right from the right (ease-out)
   2  where they overlap the deeper lens forms and glows softly
   3  the I grows inside the lens, bottom → top
   4  A and M fade in with a small move, each from its own circle's side
   5  one small pulse, then the logo holds — the last frames are the official file
   AIM's letters are knock-outs in the file (they show the background), so the
   background stays light and the letters are cut, never painted. */
"use strict";
(() => {
  const A = "../assets/aim/";
  const BG = ["#FAFCFC", "#E6ECEC"];
  const MARK_W = { "16x9": 900, "1x1": 780 };
  const T = {
    slide: [0.10, 1.70],      // both circles, outQuart
    glow: [0.90, 1.70, 2.60], // rise, peak, gone
    I: [1.85, 2.45],          // bottom → top
    AM: [2.30, 2.90],         // fade + 70px move toward the centre
    pulse: [3.00, 3.16, 3.70],// up to 1.03, back to 1
    swap: [3.72, 3.84],
    dur: 6.4,
  };
  const MOVE = 70, PULSE = .03;

  let G, L, LX, LY, SRC, CX, CY, R, layer, lctx, glow, gctx, enterDx;

  async function load() {
    G = await (await fetch(A + "geometry.json")).json();
    await Promise.all(["logo_source.webp", "mint_col.png", "deep_col.png", "letters.png"].map(f => loadImg(f.split(".")[0], A + f)));
    SRC = { w: G.size[0], h: G.size[1] };
    L = MARK_W[FORMAT] / SRC.w; LX = (W - SRC.w * L) / 2; LY = (H - SRC.h * L) / 2;
    CX = (G.c1[0] + G.c2[0]) / 2; CY = G.c1[1]; R = G.c1[2];
    enterDx = LX / L + G.c1[0] + R + 60;                      // start fully outside the frame
    layer = Object.assign(document.createElement("canvas"), { width: W, height: H }); lctx = layer.getContext("2d");
    glow = Object.assign(document.createElement("canvas"), { width: W, height: H }); gctx = glow.getContext("2d");
  }

  // source px → screen, around the mark centre with the pulse scale
  function setTr(g, k) { g.setTransform(L * k, 0, 0, L * k, W / 2 - CX * L * k, H / 2 - CY * L * k); }
  const circle = (g, x) => { g.beginPath(); g.arc(x, CY, R, 0, Math.PI * 2); };
  const gradFill = (g, col) => g.drawImage(IMG[col], 0, 0, 1, SRC.h, -enterDx * 2, 0, SRC.w + enterDx * 4, SRC.h);

  function draw(t, frame) {
    background(BG);
    const swap = seg(t, T.swap[0], T.swap[1]);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (swap >= 1) { setTr(ctx, 1); ctx.drawImage(IMG.logo_source, 0, 0, SRC.w, SRC.h); return; }

    const s = E.outQuart(seg(t, T.slide[0], T.slide[1]));
    const x1 = G.c1[0] - (1 - s) * enterDx, x2 = G.c2[0] + (1 - s) * enterDx;
    const up = E.outCubic(seg(t, T.pulse[0], T.pulse[1])), down = E.inOutSine(seg(t, T.pulse[1], T.pulse[2]));
    const k = 1 + PULSE * (up - down);

    // mark layer: circles, lens, then letters cut out (so they show the background)
    lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, W, H); setTr(lctx, k);
    lctx.imageSmoothingQuality = "high";
    for (const x of [x1, x2]) { lctx.save(); circle(lctx, x); lctx.clip(); gradFill(lctx, "mint_col"); lctx.restore(); }
    lctx.save(); circle(lctx, x1); lctx.clip(); circle(lctx, x2); lctx.clip(); gradFill(lctx, "deep_col"); lctx.restore();

    const cut = (box, amount, dx = 0, clipY = null) => {
      if (amount <= 0) return;
      lctx.save();
      if (clipY !== null) { lctx.beginPath(); lctx.rect(box[0] - 2, clipY, box[2] - box[0] + 4, box[3] + 2 - clipY); lctx.clip(); }
      lctx.translate(dx, 0);                                       // the letter's own pixels, moved by dx
      lctx.beginPath(); lctx.rect(box[0] - 2, box[1] - 2, box[2] - box[0] + 4, box[3] - box[1] + 4); lctx.clip();
      lctx.globalAlpha = amount; lctx.globalCompositeOperation = "destination-out";
      lctx.drawImage(IMG.letters, 0, 0, SRC.w, SRC.h); lctx.restore();
    };
    const [bA, bI, bM] = G.letters;
    const gi = E.inOutCubic(seg(t, T.I[0], T.I[1]));
    cut(bI, gi > 0 ? 1 : 0, 0, lerp(bI[3] + 2, bI[1] - 2, gi));       // I: grows bottom → top
    const am = E.outCubic(seg(t, T.AM[0], T.AM[1]));
    cut(bA, am, -MOVE * (1 - am));                                // A from its circle's side (left)
    cut(bM, am, MOVE * (1 - am));                                 // M from the right
    ctx.drawImage(layer, 0, 0);

    // the lens glows softly while it forms
    const gl = E.inOutSine(seg(t, T.glow[0], T.glow[1])) * (1 - E.inOutSine(seg(t, T.glow[1], T.glow[2])));
    if (gl > 0) {
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, W, H); setTr(gctx, k);
      gctx.save(); circle(gctx, x1); gctx.clip(); circle(gctx, x2); gctx.fillStyle = "#62EADB"; gctx.fill(); gctx.restore();
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = .32 * gl;   // soft halo
      ctx.filter = `blur(${Math.round(30 * L / .45)}px)`; ctx.drawImage(glow, 0, 0);
      ctx.filter = "none"; ctx.globalAlpha = .07 * gl; ctx.drawImage(glow, 0, 0); ctx.restore(); // the lens itself, barely
    }
    if (swap > 0) { ctx.globalAlpha = swap; setTr(ctx, 1); ctx.drawImage(IMG.logo_source, 0, 0, SRC.w, SRC.h); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; }
  }

  function cues() {
    return {
      style: "digital", dur: T.dur,
      whooshes: [{ t: T.slide, pan: [-.85, -.2] }, { t: T.slide, pan: [.85, .2] }],
      bloom: lerp(T.slide[0], T.slide[1], .4), shimmer: [T.glow[0], T.glow[2]],
      rise: T.I, swells: [{ t: T.AM[0], pan: -.35 }, { t: T.AM[0], pan: .35 }], lock: T.pulse[0],
    };
  }

  TIMING.dur = T.dur;
  window.BRAND_DEF = { name: "aim", load, draw, cues, blur: [[T.slide[0], 1.15], [T.AM[0], T.AM[1]]] };
})();
