/* AIM — same timing sheet, camera and blur as MEHAD; a different personality.
   The two circles (body ∩ digital) are searched for through tech and garment materials
   (wireframe, point cloud, knit, chrome, measuring tape…), resolve to two clean rings,
   orbit half a turn into place, the mint floods out from the overlap, the lens deepens,
   and a scan beam passes left→right cutting A·I·M out of the mark.
   AIM's letters are knock-outs in the official file, so they always show the background:
   the background stays light. Last frames = the official file. */
"use strict";
(() => {
  const A = "../assets/aim/";
  const INK = "#23B2A8";                              // the lens teal, from the file
  const BG = ["#FAFCFC", "#E6ECEC"];
  const MARK_W = { "16x9": 900, "1x1": 780 };
  const KNOT_SCALE = 1.15;

  const SEQ = [
    ["s07", 3, 1.10], ["p_hair", 2, .86], ["s01", 3, 1.00], ["s04", 2, .92], ["s06", 3, 1.06],
    ["p_dots", 2, .90], ["s00", 3, 1.00], ["s03", 2, .94], ["s10", 3, 1.04], ["s09", 3, .96],
    ["p_outline", 2, 1.02], ["s08", 3, .98], ["s05", 2, 1.03], ["s11", 3, .97], ["s12", 2, 1.01],
    ["s03", 3, 1.00], ["s02", 4, 1.00],
  ].map(([img, frames, scale]) => ({ img, frames, scale }));

  let G, REG, L, LX, LY, SRC, CX, CY, BOX, ringsInk, layer, lctx;

  async function load() {
    G = await (await fetch(A + "geometry.json")).json();
    REG = await (await fetch(A + "flash/registration.json")).json();
    const layers = ["logo_source.webp", "base.png", "lens.png", "letters.png", "rings.png"];
    const flashes = [...new Set(SEQ.map(s => s.img))];
    await Promise.all([...layers.map(f => loadImg(f.split(".")[0], A + f)), ...flashes.map(f => loadImg(f, A + "flash/" + f + ".png"))]);
    ringsInk = tinted(IMG.rings, INK);
    SRC = { w: G.size[0], h: G.size[1] };
    L = MARK_W[FORMAT] / SRC.w; LX = (W - SRC.w * L) / 2; LY = (H - SRC.h * L) / 2;
    CX = (G.c1[0] + G.c2[0]) / 2; CY = G.c1[1];              // centre of the lens
    BOX = [G.c1[0] - G.c1[2], G.c1[1] - G.c1[2], G.c2[0] + G.c2[2], G.c2[1] + G.c2[2]];
    layer = Object.assign(document.createElement("canvas"), { width: W, height: H }); lctx = layer.getContext("2d");
  }

  const lockTr = () => [L, LX, LY];
  function drawSrc(g, img, tr, rot = 0) {
    g.save(); g.transform(tr[0], 0, 0, tr[0], tr[1], tr[2]);
    if (rot) { g.translate(CX, CY); g.rotate(rot); g.translate(-CX, -CY); }
    g.drawImage(img, 0, 0, SRC.w, SRC.h); g.restore();
  }
  // mark pose: p=0 centred & enlarged, p=1 in the lockup (the lockup is centred too)
  function markTransform(p) { const k = lerp(KNOT_SCALE, 1, p) * L; return [k, W / 2 - CX * k, H / 2 - CY * k]; }

  function drawFlash(s) {
    const [k] = markTransform(0), rb = REG.box;
    const f = (BOX[2] - BOX[0]) * k * s.scale / (rb[2] - rb[0]);
    const im = IMG[s.img];
    ctx.drawImage(im, W / 2 - (rb[0] + rb[2]) / 2 * f, H / 2 - (rb[1] + rb[3]) / 2 * f, im.width * f, im.height * f);
  }
  function circlePath(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(r, 0), 0, Math.PI * 2); }

  function draw(t, frame) {
    const T = TIMING;
    background(BG);
    withCamera(t, cam => {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      // 01 build-up
      if (t < T.clean[0]) { const s = flashAt(SEQ, frame); if (s) drawFlash(s); return; }
      // 03 lockup: the official file, untouched
      const swap = seg(t, T.swap[0], T.swap[1]);
      if (swap >= 1) { drawSrc(ctx, IMG.logo_source, lockTr()); return; }

      // 02 reveal — rings orbit half a turn into place (the pair is symmetric, so it lands as it started)
      const p = E.inOutQuint(seg(t, T.glide[0], T.glide[1]));
      const ringsA = 1 - seg(t, T.flood[1], T.flood[1] + .12);
      if (ringsA > 0) { ctx.globalAlpha = ringsA; drawSrc(ctx, ringsInk, markTransform(p), Math.PI * (1 - p)); ctx.globalAlpha = 1; }

      // mark layer, composited once so the knock-outs show the background
      const fl = E.outQuart(seg(t, T.flood[0], T.flood[1]));
      if (fl > 0) {
        const c = ctx.getTransform();
        lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, W, H);
        lctx.setTransform(c); lctx.imageSmoothingQuality = "high";
        const sx = x => LX + x * L, sy = y => LY + y * L;
        lctx.save(); circlePath(lctx, sx(CX), sy(CY), 1010 * L * fl); lctx.clip(); drawSrc(lctx, IMG.base, lockTr()); lctx.restore();
        const q = E.outCubic(seg(t, T.fills[0], T.fills[0] + T.fills[2]));
        if (q > 0) { lctx.save(); circlePath(lctx, sx(CX), sy(CY), 590 * L * q); lctx.clip(); drawSrc(lctx, IMG.lens, lockTr()); lctx.restore(); }
        // scan beam cuts the letters out, left → right, landing on the lock frame
        const lb = G.letters_box, b = E.inOutCubic(seg(t, T.write2[0], T.lock));
        const bx = lerp(lb[0] - 70, lb[2] + 70, b);
        if (b > 0) {
          lctx.save(); lctx.beginPath(); lctx.rect(sx(0), sy(0), (bx) * L, SRC.h * L); lctx.clip();
          lctx.globalCompositeOperation = "destination-out"; drawSrc(lctx, IMG.letters, lockTr()); lctx.restore();
        }
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(layer, 0, 0); ctx.restore();
        // the beam itself: a thin light line, only on the mark
        const beamA = seg(t, T.write2[0], T.write2[0] + .08) * (1 - seg(t, T.lock - .12, T.lock));
        if (beamA > 0) {
          ctx.save();
          circlePath(ctx, sx(G.c1[0]), sy(G.c1[1]), G.c1[2] * L); ctx.moveTo(sx(G.c2[0] + G.c2[2]), sy(G.c2[1])); ctx.arc(sx(G.c2[0]), sy(G.c2[1]), G.c2[2] * L, 0, Math.PI * 2); ctx.clip("nonzero");
          const x = sx(bx), gw = 26 * L / .45;
          const g = ctx.createLinearGradient(x - gw, 0, x + gw, 0);
          g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, `rgba(255,255,255,${.38 * beamA})`); g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g; ctx.fillRect(x - gw, sy(0), gw * 2, SRC.h * L);
          ctx.fillStyle = `rgba(255,255,255,${.95 * beamA})`; ctx.fillRect(x - 1.25 / cam, sy(0), 2.5 / cam, SRC.h * L);
          ctx.restore();
        }
      }
      if (swap > 0) { ctx.globalAlpha = swap; drawSrc(ctx, IMG.logo_source, lockTr()); ctx.globalAlpha = 1; }
    });
  }

  function cues() {
    const T = TIMING, flashes = []; let f = 0;
    for (const q of SEQ) { flashes.push(f / FPS); f += q.frames; }
    flashes.push(T.clean[0]);
    return {
      style: "digital", dur: T.dur, flashes, glide: T.glide, glidePan: [0, 0], flood: T.flood[0],
      fills: [{ t: T.fills[0], pan: 0 }], scan: [T.write2[0], T.lock], write: [], lock: T.lock,
    };
  }

  window.BRAND_DEF = { name: "aim", load, draw, cues };
})();
