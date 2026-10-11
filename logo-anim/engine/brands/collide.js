/* AIM × "Collide": two balls, «AI» and «IM», smash into each other; their two I's become
   the one I in the lens, and the mark reads AIM (the I is the letter both shapes share).
   In:  the balls pop in apart and hold so both names read → a small pull back → they rush
        together, overshoot into each other, squash, ring and wobble like jelly, and spring
        onto the official mark.
   Out: the mark breathes in, then the balls burst apart through a liquid neck that snaps,
        «AI» and «IM» drift for a beat, and both shrink away to an empty frame.
   Made for a transparent master (?alpha, 4K, 60 fps): no background is painted then. */
"use strict";
(() => {
  const T = {
    pop: [.08, .2, .42],              // left start, right start, duration
    anti: [.72, 1.12], go: [1.12, 1.44],
    settle: 1.25,                     // seconds after impact until the official file
    out: 4.6, breathe: [4.6, 4.88], burst: [4.88, 5.42], drift: [5.42, 6.1], vanish: [6.1, .4, .08], end: 6.85,
  };
  const BG = "#F4F7F7", RING = "#23B2A8";
  const SEP = { "16x9": 440, "1x1": 330 }[FORMAT];             // how far each ball sits from its place (source px)
  const PULL = 45, OVER_OUT = 35, DRIFT = 50;
  let P, oc, tI, vI, snapT;
  const SP = { w: 2 * Math.PI * 1.7, z: .42 };                 // the collision spring

  const backOut = u => { const c = 1.70158; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
  const backIn = u => { const c = 1.70158; return (c + 1) * u ** 3 - c * u * u; };
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  function spring(tau, x0, v0) {
    const a = SP.z * SP.w, wd = SP.w * Math.sqrt(1 - SP.z ** 2);
    return Math.exp(-a * tau) * (x0 * Math.cos(wd * tau) + (v0 + a * x0) / wd * Math.sin(wd * tau));
  }

  async function load() {
    await LOGO.load();
    P = place(LOGO, { "16x9": 820, "1x1": 640 }[FORMAT] * SCALE);
    oc = (LOGO.c2[0] - LOGO.c1[0] - 2 * LOGO.RX) / 2;           // offset at which the two shapes just touch
    const d = oc - (-SEP - PULL); tI = T.go[1]; vI = 3 * d / (T.go[1] - T.go[0]);   // cubic ease-in → arrival speed
    for (let t = T.burst[0]; t < T.burst[1]; t += .001) if (gapAt(t) > GMAX) { snapT = t; break; }
  }

  /* offset of each ball from its place, towards the other (+ = deeper than the mark) */
  function offset(t) {
    if (t < T.anti[0]) return -SEP;
    if (t < T.go[0]) return -SEP - PULL * E.inOutSine(seg(t, T.anti[0], T.anti[1]));
    if (t < tI) return -SEP - PULL + (oc + SEP + PULL) * seg(t, T.go[0], T.go[1]) ** 3;
    if (t < T.out) { const tau = t - tI; return spring(tau, oc, vI) * (1 - smooth(T.settle - .4, T.settle, tau)); }
    if (t < T.breathe[1]) return OVER_OUT * E.inOutSine(seg(t, T.breathe[0], T.breathe[1]));
    if (t < T.burst[1]) return lerp(OVER_OUT, -SEP, E.outCubic(seg(t, T.burst[0], T.burst[1])));
    return -SEP - DRIFT * E.inOutSine(seg(t, T.drift[0], T.drift[1]));
  }
  const GMAX = 230;                                              // the neck snaps at this gap (source px)
  const gapAt = t => 2 * (oc - offset(t));                       // edge-to-edge gap (negative while overlapping)

  /* per-ball squash: [sx, sy] */
  function squash(t) {
    if (t >= T.go[0] && t < tI) { const u = seg(t, T.go[0], T.go[1]) ** 2; return [1 + .06 * u, 1 - .035 * u]; }   // stretched by speed
    if (t >= tI && t < T.out) {                                  // jelly after the hit, starting from that stretch
      const tau = t - tI, w = 2 * Math.PI * 3.1, j = Math.exp(-5.5 * tau) * (-.06 * Math.cos(w * tau) + .095 * Math.sin(w * tau));
      const e = 1 - smooth(T.settle - .4, T.settle, tau); return [1 - j * e, 1 + .7 * j * e];
    }
    if (t >= T.breathe[0] && t < T.burst[0]) { const b = Math.sin(Math.PI * seg(t, T.breathe[0], T.burst[0])) * .025; return [1 - b, 1 + b * .6]; }
    if (t >= T.burst[0] && snapT && t < snapT) { const k = .05 * clamp(gapAt(t) / GMAX); return [1 + k, 1 - k * .6]; }   // pulled by the neck
    if (snapT && t >= snapT && t < T.vanish[0]) { const tau = t - snapT, j = .05 * Math.exp(-6 * tau) * Math.cos(2 * Math.PI * 3 * tau); return [1 + j, 1 - .6 * j]; }
    return [1, 1];
  }
  /* liquid neck strength (metaball spread), only while bursting apart */
  function neck(t) {
    if (t < T.burst[0] || t >= T.burst[1]) return 0;
    const o = offset(t);
    if (o > oc) return .55 * clamp((OVER_OUT - o) / (OVER_OUT - oc));           // grows as the overlap opens
    return .55 * Math.max(0, 1 - gapAt(t) / GMAX) ** .7;                         // thins as the gap widens
  }
  /* pop-in / vanish scale per ball */
  function life(t, i) {
    const s0 = T.pop[i], k = t < s0 ? 0 : backOut(Math.min(1, (t - s0) / T.pop[2]));
    if (t < T.vanish[0]) return k;
    const v0 = T.vanish[0] + i * T.vanish[2]; return t < v0 ? 1 : Math.max(0, 1 - backIn(Math.min(1, (t - v0) / T.vanish[1])));
  }

  /* drawing, in source coordinates (g carries the source → screen transform) */
  const grad = (g, col, sy) => g.drawImage(LOGO.I(col), 0, 0, 1, LOGO.src.h, -LOGO.src.w * 3, LOGO.CY - LOGO.CY * sy, LOGO.src.w * 7, LOGO.src.h * sy);
  function shape(g, x, sx, sy, rip) {                            // one ball's outline as a path (rippled after a hit)
    const rx = LOGO.RX * sx, ry = LOGO.R * sy, y = LOGO.CY;
    if (!rip || rip.a < 1e-4) { g.ellipse(x, y, rx, ry, 0, 0, 7); return; }
    for (let i = 0; i <= 360; i++) {
      const th = i / 360 * Math.PI * 2, r = 1 + rip.a * Math.sin(rip.k * th + rip.ph);
      i ? g.lineTo(x + rx * r * Math.cos(th), y + ry * r * Math.sin(th)) : g.moveTo(x + rx * r * Math.cos(th), y + ry * r * Math.sin(th));
    }
    g.closePath();
  }
  function letters(g, x, home, sx, sy, which) {                  // the ball's own letters, printed on it
    const L = LOGO.G.letters, boxes = which ? [L[1], L[2]] : [L[0], L[1]];
    g.save(); g.translate(x, LOGO.CY); g.scale(sx, sy); g.translate(-home, -LOGO.CY);
    for (const [b0, b1, b2, b3] of boxes) g.drawImage(LOGO.I("letters"), b0 - 4, b1 - 4, b2 - b0 + 8, b3 - b1 + 8, b0 - 4, b1 - 4, b2 - b0 + 8, b3 - b1 + 8);
    g.restore();
  }
  function bridge(g, x1, x2, v) {                                 // metaball neck between the two shapes (in circle space)
    const S = LOGO.SX, r = LOGO.R, cy = LOGO.CY, a = x1 / S, b = x2 / S, d = b - a;
    if (v <= 0 || d >= 2 * r + GMAX / S) return false;
    const u = d < 2 * r ? Math.acos(d / (2 * r)) : 0, spread = Math.acos(0);              // equal radii: maxSpread = π/2
    const a1 = u + (spread - u) * v, a3 = Math.PI - u - (Math.PI - u - spread) * v;
    const p = (cx, ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    const p1 = p(a, a1), p2 = p(a, -a1), p3 = p(b, a3), p4 = p(b, -a3);
    const hs = Math.min(v * 2.4, Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / (2 * r)) * Math.min(1, d / r) * r;
    const h = (q, ang, s) => [q[0] + hs * Math.cos(ang + s * Math.PI / 2), q[1] + hs * Math.sin(ang + s * Math.PI / 2)];
    const h1 = h(p1, a1, -1), h2 = h(p2, -a1, 1), h3 = h(p3, a3, 1), h4 = h(p4, -a3, -1);
    g.save(); g.scale(S, 1);
    g.moveTo(...p1); g.bezierCurveTo(...h1, ...h3, ...p3); g.lineTo(...p4); g.bezierCurveTo(...h4, ...h2, ...p2); g.closePath();
    g.restore();
    return true;
  }

  function mark(g, t) {
    const o = offset(t), x1 = LOGO.c1[0] + o, x2 = LOGO.c2[0] - o, [sx, sy] = squash(t), k1 = life(t, 0), k2 = life(t, 1);
    const tau = t - tI, hit = t >= tI && t < T.out ? tau : -1;
    const rip = hit >= 0 ? { a: .006 * Math.exp(-4.5 * hit) * smooth(0, .05, hit), k: 5, ph: 16 * hit } : null;
    const s = [[sx * k1, sy * k1], [sx * k2, sy * k2]];
    const path = (i, rp) => { g.beginPath(); shape(g, i ? x2 : x1, s[i][0], s[i][1], rp && { ...rp, ph: rp.ph * (i ? -1 : 1) }); };
    for (const i of [0, 1]) { if ((i ? k2 : k1) <= 0) continue; g.save(); path(i, rip); g.clip(); grad(g, "mint_col", s[i][1]); g.restore(); }
    const v = neck(t);
    if (v > 0) { g.save(); g.beginPath(); if (bridge(g, x1, x2, v)) { g.clip(); grad(g, "mint_col", 1); } g.restore(); }
    if (k1 > 0 && k2 > 0 && x2 - x1 < 2 * LOGO.RX * Math.max(s[0][0], s[1][0])) {          // the lens where they overlap
      g.save(); path(0, rip); g.clip(); path(1, rip); g.clip(); grad(g, "deep_col", (s[0][1] + s[1][1]) / 2);
      if (hit >= 0 && hit < .4) { g.globalAlpha = .55 * (1 - hit / .4) ** 2; g.fillStyle = "#FFFFFF"; g.fillRect(-1e4, -1e4, 2e4, 2e4); }   // the flash
      g.restore();
    }
    if (k1 > 0) letters(g, x1, LOGO.c1[0], s[0][0], s[0][1], 0);
    if (k2 > 0) letters(g, x2, LOGO.c2[0], s[1][0], s[1][1], 1);
    if (hit >= 0 && hit < .6) {                                   // a thin ring from the point of impact
      const u = hit / .6, rr = lerp(.35, 1.75, E.outCubic(u)) * LOGO.R;
      g.save(); g.globalAlpha = .6 * (1 - u) ** 1.5; g.strokeStyle = RING; g.lineWidth = lerp(9, 3, u);
      g.beginPath(); g.ellipse(LOGO.CX, LOGO.CY, rr * LOGO.SX * .62, rr, 0, 0, 7); g.stroke(); g.restore();
    }
  }

  function cam(t) {                                               // wide for the names, a punch on the hit, wide again to leave
    let k = lerp(.96, 1, E.inOutSine(seg(t, T.go[0], tI + .8)));
    if (t >= tI) { const tau = t - tI; k += .016 * (1 - Math.exp(-60 * tau)) * Math.exp(-6 * tau); }
    if (t >= T.out) k = lerp(k, .96, E.inOutSine(seg(t, T.burst[0], T.drift[1])));
    return k;
  }

  function draw(t) {
    if (!ALPHA) flatBG(BG);
    ctx.imageSmoothingQuality = "high";
    P.tr(ctx, cam(t));
    if (t >= tI + T.settle && t < T.out) LOGO.drawFinal(ctx);   // at rest it is the official file
    else mark(ctx, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function cues() {
    const ev = [
      { type: "pop", t: T.pop[0] + .02, pan: -.55 }, { type: "pop", t: T.pop[1] + .02, pan: .55 },
      { type: "whoosh", t: T.go[0] - .08, d: tI - T.go[0] + .12, pan: [-.85, 0], level: -17, fc: [300, 2600] },
      { type: "whoosh", t: T.go[0] - .06, d: tI - T.go[0] + .1, pan: [.85, 0], level: -17, fc: [350, 3000] },
      { type: "thud", t: tI }, { type: "impact", t: tI - .005, style: "digital", tail: T.out - tI },
      { type: "swell", t: T.breathe[0] - .1, d: T.breathe[1] - T.breathe[0] + .1 },
      { type: "whoosh", t: T.burst[0] - .02, d: .55, pan: [0, -.85], level: -18, fc: [400, 2400] },
      { type: "whoosh", t: T.burst[0], d: .5, pan: [0, .85], level: -18, fc: [450, 2800] },
      { type: "pop", t: snapT || T.burst[0] + .2, pan: 0 },
      { type: "pop", t: T.vanish[0] + T.vanish[1] * .7, pan: -.55 }, { type: "pop", t: T.vanish[0] + T.vanish[2] + T.vanish[1] * .7, pan: .55 },
    ];
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "collide-aim", load, draw, cues,
    blur: [[T.pop[0], T.pop[1] + T.pop[2]], [T.go[0], tI + .9], [T.breathe[1], T.drift[0] + .2], [T.vanish[0], T.vanish[0] + T.vanish[1] + T.vanish[2] + .05]] };
  TIMING.dur = T.end;
})();
