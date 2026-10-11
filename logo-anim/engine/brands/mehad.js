/* MEHAD — مهاد. The knot «ه» is searched for through materials (Sadu weave, qalam ink,
   pencil, embroidery, paper, rope…), finds its clean form, travels into the icon,
   the teal floods in behind it, the counters fill, and the name writes itself:
   Arabic right→left from the icon, MEHAD left→right. Last frames = the official file. */
"use strict";
(() => {
  const A = "../assets/mehad/";
  const COL = { navy: "#43546A", ink: "#344254", teal: "#28A299" };
  const BG = ["#FBFAF7", "#EEEBE5"];
  const SRC = { w: 2000, h: 704 };
  const THREAD_BOX = [1296, 174, 1950, 570];         // thread bbox in source px
  const FLOOD_ORIGIN = [1620, 330], FLOOD_R = 545;
  const FILLS = [["sand", 146], ["navy", 104], ["olive", 111]];   // right → left, cover radius
  const LOCKUP_W = { "16x9": 1100, "1x1": 880 };
  const KNOT_SCALE = 1.15;                            // centred knot vs. its size in the lockup

  // build-up: [image, frames held, scale]. 2–3 frame holds, decelerating into the clean knot.
  const SEQ = [
    ["s11", 3, 1.10], ["p_hair", 2, .86], ["s09", 3, 1.00], ["s02", 2, .92], ["s01", 3, 1.06],
    ["p_dots", 2, .90], ["s06", 3, 1.00], ["s07", 2, .94], ["s08", 3, 1.04], ["s12", 3, .96],
    ["p_outline", 2, 1.02], ["s04", 3, .98], ["s05", 2, 1.03], ["s03", 3, .97], ["s10", 2, 1.01],
    ["s00", 3, 1.00], ["s01", 4, 1.00],
  ].map(([img, frames, scale]) => ({ img, frames, scale }));

  let G, ST, REG, L, LX, LY, AR = [], EN = [], threadNavy;

  async function load() {
    G = await (await fetch(A + "geometry.json")).json();
    ST = await (await fetch(A + "strokes.json")).json();
    REG = await (await fetch(A + "flash/registration.json")).json();
    const layers = ["lockup_source.webp", "wordmark_ar.png", "wordmark_en.png", "icon_square.png", "icon_thread.png",
      "icon_fill_sand.png", "icon_fill_navy.png", "icon_fill_olive.png"];
    const flashes = [...new Set(SEQ.map(s => s.img))];
    await Promise.all([...layers.map(f => loadImg(f.split(".")[0], A + f)), ...flashes.map(f => loadImg(f, A + "flash/" + f + ".png"))]);
    threadNavy = tinted(IMG.icon_thread, COL.navy);
    L = LOCKUP_W[FORMAT] / SRC.w; LX = (W - SRC.w * L) / 2; LY = (H - SRC.h * L) / 2;
    AR = ST.ar_order.map(k => mkPath(ST.ar[k]));
    EN = Object.values(ST.en).map(paths => paths.map(mkPath));
  }

  const sx = x => LX + x * L, sy = y => LY + y * L;
  const knotCX = (THREAD_BOX[0] + THREAD_BOX[2]) / 2, knotCY = (THREAD_BOX[1] + THREAD_BOX[3]) / 2;

  // knot pose: p=0 centred & enlarged, p=1 in the lockup
  function knotTransform(p) {
    const k = lerp(KNOT_SCALE, 1, p);
    const cx = lerp(W / 2, sx(knotCX), p), cy = lerp(H / 2, sy(knotCY), p);
    return [k * L, cx - knotCX * k * L, cy - knotCY * k * L];   // scale, tx, ty (source → screen)
  }
  function drawSrc(img, tr) { ctx.save(); ctx.transform(tr[0], 0, 0, tr[0], tr[1], tr[2]); ctx.drawImage(img, 0, 0, SRC.w, SRC.h); ctx.restore(); }
  const lockTr = () => [L, LX, LY];

  function drawFlash(s) {
    // registration box (flash canvas) → the centred knot's box on screen
    const [k, tx, ty] = knotTransform(0);
    const bw = (THREAD_BOX[2] - THREAD_BOX[0]) * k * s.scale, rb = REG.box;
    const f = bw / (rb[2] - rb[0]);
    const cx = tx + knotCX * k, cy = ty + knotCY * k;
    const im = IMG[s.img];
    ctx.drawImage(im, cx - (rb[0] + rb[2]) / 2 * f, cy - (rb[1] + rb[3]) / 2 * f, im.width * f, im.height * f);
  }

  // reveal a layer through a stroked path mask (paths in source px)
  function writeOn(img, jobs, width, cam) {
    sctx.setTransform(1, 0, 0, 1, 0, 0); sctx.clearRect(0, 0, W, H);
    sctx.setTransform(cam * L, 0, 0, cam * L, W / 2 * (1 - cam) + cam * LX, H / 2 * (1 - cam) + cam * LY);
    sctx.lineCap = "round"; sctx.lineJoin = "round"; sctx.lineWidth = width; sctx.strokeStyle = "#000";
    for (const [P, s] of jobs) strokeUpTo(sctx, P, s);
    sctx.globalCompositeOperation = "source-in"; sctx.drawImage(img, 0, 0, SRC.w, SRC.h);
    sctx.globalCompositeOperation = "source-over";
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(scratch, 0, 0); ctx.restore();
  }

  function draw(t, frame) {
    const T = TIMING;
    background(BG);
    withCamera(t, cam => {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      // 01 build-up
      if (t < T.clean[0]) { const s = flashAt(SEQ, frame); if (s) drawFlash(s); return; }

      // 03 lockup: the official file, untouched
      const swap = seg(t, T.swap[0], T.swap[1]);
      if (swap >= 1) { drawSrc(IMG.lockup_source, lockTr()); return; }

      // 02 reveal
      const p = E.inOutQuint(seg(t, T.glide[0], T.glide[1]));
      const ktr = knotTransform(p);
      const fl = E.outQuart(seg(t, T.flood[0], T.flood[1]));
      drawSrc(threadNavy, ktr);
      if (fl > 0) {
        ctx.save(); ctx.beginPath(); ctx.arc(sx(FLOOD_ORIGIN[0]), sy(FLOOD_ORIGIN[1]), FLOOD_R * L * fl, 0, Math.PI * 2); ctx.clip();
        drawSrc(IMG.icon_square, lockTr());
        FILLS.forEach(([n, r], i) => {
          const q = E.outCubic(seg(t, T.fills[0] + i * T.fills[1], T.fills[0] + i * T.fills[1] + T.fills[2]));
          if (q <= 0) return;
          const [cx, cy] = G["fill_" + n];
          ctx.save(); ctx.beginPath(); ctx.arc(sx(cx), sy(cy), (r + 6) * L * q, 0, Math.PI * 2); ctx.clip();
          drawSrc(IMG["icon_fill_" + n], lockTr()); ctx.restore();
        });
        drawSrc(IMG.icon_thread, ktr);
        ctx.restore();
      }

      // Arabic: one pen through م and the ه knot; ا branches from the junction; د last
      const w0 = T.write[0], w1 = T.write[1];
      const pen = E.inOutCubic(seg(t, w0, w1 - .14));
      const [meem, knot, alef, dal] = AR;
      const sPen = pen * (meem.L + knot.L);
      const tJ = w0 + .35 * (w1 - .14 - w0);              // ≈ when the pen reaches the junction
      const jobs = [[meem, sPen], [knot, sPen - meem.L], [alef, alef.L * E.outCubic(seg(t, tJ, tJ + .5))], [dal, dal.L * E.inOutCubic(seg(t, w1 - .38, w1))]];
      if (t > w0) writeOn(IMG.wordmark_ar, jobs, ST.ar_width + 4, cam);

      // MEHAD: letter by letter, left → right
      const [e0, eStep, eDur] = T.write2;
      const enJobs = [];
      EN.forEach((paths, i) => {
        const q = E.inOutCubic(seg(t, e0 + i * eStep, e0 + i * eStep + eDur));
        let s = q * paths.reduce((a, P) => a + P.L, 0);
        for (const P of paths) { enJobs.push([P, Math.min(s, P.L)]); s -= P.L; if (s <= 0) break; }
      });
      if (t > e0) writeOn(IMG.wordmark_en, enJobs, ST.en_width + 8, cam);

      if (swap > 0) { ctx.globalAlpha = swap; drawSrc(IMG.lockup_source, lockTr()); ctx.globalAlpha = 1; }
    });
  }

  // sound cues (seconds) for tools/sound.py
  function cues() {
    const T = TIMING, flashes = []; let f = 0;
    for (const q of SEQ) { flashes.push(f / FPS); f += q.frames; }
    flashes.push(T.clean[0]);
    const pan = x => (x - W / 2) / (W / 2);
    return {
      dur: T.dur, flashes, glide: T.glide, flood: T.flood[0],
      fills: FILLS.map(([n], i) => ({ t: T.fills[0] + i * T.fills[1], pan: pan(sx(G["fill_" + n][0])) })),
      glidePan: [0, pan(sx(knotCX))], write: T.write, write2: [T.write2[0], T.write2[0] + 4 * T.write2[1] + T.write2[2]], lock: T.lock,
    };
  }

  window.BRAND_DEF = { name: "mehad", load, draw, cues };
})();
