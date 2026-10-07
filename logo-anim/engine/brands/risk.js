/* Idea 2 — "Risk & Reward": the name scrambles into place through liquid, warped
   glyph fragments, slot by slot in reading order, while the symbol tumbles in like a
   die; it holds, then the whole build runs backwards and the name melts away.
   MEHAD: icon tumbles in, «مهاد» resolves right→left, MEHAD left→right.
   AIM:   the two circles flip in like coins, then A·I·M resolve left→right. */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  const C = isM ? { bg: "#0E1620", width: { "16x9": 1080, "1x1": 880 } } : { bg: "#081615", width: { "16x9": 820, "1x1": 720 } };
  const T = { hold: [2.1, 5.0], mirror: 7.0, dur: 7.6 };
  let P, slots, circleImg, backImg;

  async function load() {
    await LOGO.load();
    P = place(LOGO, C.width[FORMAT]);
    if (isM) {
      slots = LOGO.slots.map((s, i) => ({ ...s, win: s.group === "ar" ? [.34 + (i) * .16, .55] : [.86 + (i - 4) * .13, .5] }));
    } else {
      slots = LOGO.slots.map((s, i) => ({ ...s, win: [.72 + i * .2, .62] }));
      // one flat circle (file gradient) to flip in 3D, and a darker back face
      const R = LOGO.R, d = Math.ceil(2 * R);
      circleImg = Object.assign(document.createElement("canvas"), { width: d, height: d });
      const g = circleImg.getContext("2d"); g.translate(R - LOGO.c1[0], R - LOGO.c1[1]); LOGO.circles(g, LOGO.c1[0], null);
      backImg = tinted(circleImg, "#1C8C84");
    }
  }

  const S = (x, y) => [P.x + x * P.L, P.y + y * P.L];

  // a flat card (image region) rotated in 3D around its centre, drawn in screen space
  function card(img, sx, sy, sw, sh, cx, cy, w, h, rx, ry, rz, back) {
    const corners = [[-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0]].map(p => rot3(p, rx, ry, rz));
    const nz = rot3([0, 0, 1], rx, ry, rz)[2];
    const Q = corners.map(p => proj(p, 2600, cx, cy, 1));
    if (nz < 0 && back) drawImageQuad(ctx, back, 0, 0, back.width, back.height, Q, 12);
    else drawImageQuad(ctx, img, sx, sy, sw, sh, Q, 12);
  }
  // tumble: spins down to rest, drops in with a small bounce
  function tumble(u) {
    const e = E.outCubic(u), b = Math.abs(Math.sin(u * Math.PI * 2.2)) * Math.pow(1 - u, 2);
    return { rx: (1 - e) * Math.PI * 2.2, ry: (1 - e) * -Math.PI * 1.4, rz: (1 - e) * .9, k: lerp(.25, 1, E.outCubic(Math.min(1, u * 1.6))), dy: -b * 140 * P.L / .55 };
  }

  function drawSlot(s, tt, n) {
    const u = seg(tt, s.win[0], s.win[0] + s.win[1]);
    if (u <= 0) return;
    const img = LOGO.layer(s.img, true), [bx0, by0, bx1, by1] = s.box;
    const [dx0, dy0] = S(bx0, by0), dw = (bx1 - bx0) * P.L, dh = (by1 - by0) * P.L;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (u >= 1) { ctx.drawImage(img, bx0, by0, bx1 - bx0, by1 - by0, dx0, dy0, dw, dh); return; }
    if (u < .12 && rnd(n * 7 + s.box[0]) < .45) return;          // flickers on
    const amt = Math.pow(1 - u, 1.4) * 1.1, sd = s.box[0] * 13 + s.box[1];
    const pool = slots, frag = u < .45;
    const pick = frag ? pool[Math.floor(rnd(sd + Math.floor(n / 2) * 31) * pool.length)] : s;
    const pimg = LOGO.layer(pick.img, true), [px0, py0, px1, py1] = pick.box;
    const ph = dh * lerp(.85, 1.15, rnd(sd + n)), pw = (px1 - px0) / (py1 - py0) * ph;
    const cx = dx0 + dw / 2 + hash(sd + Math.floor(n / 2)) * dw * .25 * amt, cy = dy0 + dh / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(hash(sd + 5 + Math.floor(n / 3)) * .6 * amt); ctx.scale(1 + .2 * amt * hash(sd + n), 1); ctx.translate(-cx, -cy);
    liquid(ctx, pimg, px0, py0, px1 - px0, py1 - py0, cx - pw / 2, cy - ph / 2, pw, ph, amt, sd, tt);
    if (frag && rnd(sd + n * 3) < .5) {                           // a second shard, smaller
      const q = pool[Math.floor(rnd(sd + n * 11) * pool.length)], qi = LOGO.layer(q.img, true), [qx0, qy0, qx1, qy1] = q.box;
      const qh = ph * .6, qw = (qx1 - qx0) / (qy1 - qy0) * qh;
      liquid(ctx, qi, qx0, qy0, qx1 - qx0, qy1 - qy0, cx - qw / 2 + hash(sd + n) * dw * .4, cy - qh / 2 + hash(sd - n) * dh * .3, qw, qh, 1, sd + 9, tt);
    }
    ctx.restore();
  }

  function draw(t, n) {
    flatBG(C.bg); vignetteDark(.32);
    const tt = t < T.hold[1] ? t : Math.max(0, T.mirror - t);   // the outro is the intro, backwards
    ctx.imageSmoothingQuality = "high";
    if (tt >= T.hold[0]) { P.tr(ctx); LOGO.drawFinal(ctx, true); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    if (tt <= 0) return;
    if (isM) {
      const u = seg(tt, .12, .9);
      if (u > 0) {
        const [a, b, c, d] = LOGO.icon, tb = tumble(u), [cx, cy] = S((a + c) / 2, (b + d) / 2);
        const w = (c - a) * P.L * tb.k, h = (d - b) * P.L * tb.k;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        card(LOGO.I("lockup_source"), a, b, c - a, d - b, cx, cy + tb.dy, w, h, tb.rx, tb.ry, tb.rz, LOGO.I("icon_square"));
      }
    } else {
      const { c1, c2, R } = LOGO;
      [[c1, .1, .78], [c2, .26, .94]].forEach(([c, a, b]) => {
        const u = seg(tt, a, b); if (u <= 0) return;
        const tb = tumble(u), [cx, cy] = S(c[0], c[1]), d = 2 * R * P.L * tb.k;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        card(circleImg, 0, 0, circleImg.width, circleImg.height, cx, cy + tb.dy, d, d, tb.rx * .8, tb.ry, 0, backImg);
      });
      const lens = seg(tt, .9, 1.1);                              // the overlap deepens once both have landed
      if (lens > 0) {
        ctx.save(); P.tr(ctx); ctx.globalAlpha = lens;
        ctx.beginPath(); ctx.arc(c1[0], c1[1], R, 0, 7); ctx.clip(); ctx.beginPath(); ctx.arc(c2[0], c2[1], R, 0, 7); ctx.clip();
        LOGO.circles(ctx, c1[0], c2[0]); ctx.restore();
      }
    }
    for (const s of slots) drawSlot(s, tt, n);
  }

  function cues() {
    const ev = [], out = t => T.mirror - t;
    const tumbleTimes = isM ? [[.12, .9]] : [[.1, .78], [.26, .94]];
    for (const [a, b] of tumbleTimes) { ev.push({ type: "clicks", t: a, d: b - a, n: 6 }); ev.push({ type: "thud", t: b - .05 }); ev.push({ type: "clicks", t: out(b), d: b - a, n: 5, rev: true }); }
    for (const s of slots) {
      const x = (s.box[0] + s.box[2]) / 2 / LOGO.src.w * 2 - 1;
      ev.push({ type: "glitch", t: s.win[0], d: s.win[1], pan: x * .6 });
      ev.push({ type: "glitch", t: out(s.win[0] + s.win[1]), d: s.win[1], pan: x * .6, rev: true });
    }
    const end = Math.max(...slots.map(s => s.win[0] + s.win[1]));
    ev.push({ type: "impact", t: end, style: isM ? "paper" : "digital", tail: T.hold[1] - end });
    ev.push({ type: "riser", t: T.hold[1] - .1, d: T.mirror - T.hold[1] + .1, rev: true });
    return { dur: T.dur, events: ev };
  }

  window.BRAND_DEF = { name: "risk-" + LOGO_NAME, load, draw, cues, blur: [] };
  TIMING.dur = T.dur;
})();
