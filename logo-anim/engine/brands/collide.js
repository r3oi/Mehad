/* AIM × "Collide": two balls, «AI» and «IM», smash into each other; their two I's become
   the one I in the lens, and the mark reads AIM (the I is the letter both shapes share).
   In:  the balls pop in apart and hold so both names read → they pull back, trembling with
        charge → rush together, overshoot, squash and wobble on a spring onto the official
        mark. The hit flashes, rings twice, shakes the frame and bursts out what AIM is about:
        makeup and clothes (the Higgsfield product cut-outs), with sparks.
   Out: the products are pulled back into the lens as the mark breathes in, then the balls
        burst apart through a liquid neck that snaps, «AI» and «IM» drift, and both shrink
        away to an empty frame.
   Made for a transparent master (?alpha, 4K, 60 fps): no background is painted then. */
"use strict";
(() => {
  const T = {
    pop: [.08, .2, .42],              // left start, right start, duration
    anti: [.72, 1.14], go: [1.14, 1.4],
    settle: 1.25,                     // seconds after impact until the official file
    absorb: [4.5, 5.0], breathe: [4.78, 5.06], burst: [5.06, 5.6], drift: [5.6, 6.25], vanish: [6.25, .4, .08], end: 7.0,
  };
  const BG = "#F4F7F7", RING = "#23B2A8", SPARK = ["#FFFFFF", "#9BEDE3", "#E6C47A", "#5FD8CA"];
  const SEP = { "16x9": 440, "1x1": 330 }[FORMAT];             // how far each ball sits from its place (source px)
  const PULL = 60, OVER_OUT = 35, DRIFT = 50, GMAX = 230;
  const PRODUCTS = ["lipstick", "heel", "handbag", "watch", "dress", "brush", "bowtie", "polish", "hanger", "compact", "necktie", "oxford"];
  let P, oc, tI, vI, snapT, BURST = [], SPARKS = [], ABSORB = [], HW, HH;
  const SP = { w: 2 * Math.PI * 1.7, z: .4 };                  // the collision spring

  const backOut = u => { const c = 1.70158; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
  const backIn = u => { const c = 1.70158; return (c + 1) * u ** 3 - c * u * u; };
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  function spring(tau, x0, v0) {
    const a = SP.z * SP.w, wd = SP.w * Math.sqrt(1 - SP.z ** 2);
    return Math.exp(-a * tau) * (x0 * Math.cos(wd * tau) + (v0 + a * x0) / wd * Math.sin(wd * tau));
  }
  const edge = ang => Math.min(HW / Math.max(1e-3, Math.abs(Math.cos(ang))), HH / Math.max(1e-3, Math.abs(Math.sin(ang))));   // centre → frame edge (source px)
  const logoEdge = ang => 1 / Math.hypot(Math.cos(ang) / 1080, Math.sin(ang) / 740);                                          // centre → just outside the mark
  const landAt = (ang, size, f) => { const a = logoEdge(ang) + size * .55, b = edge(ang) - size * .5; return b > a ? lerp(a, b, f) : a; };   // between mark and frame

  async function load() {
    await LOGO.load();
    await Promise.all(PRODUCTS.map(n => loadImg("p_" + n, `../assets/aim/icons/real_${n}.png`)));
    P = place(LOGO, { "16x9": 820, "1x1": 640 }[FORMAT] * SCALE);
    HW = W / 2 / P.L; HH = H / 2 / P.L;
    oc = (LOGO.c2[0] - LOGO.c1[0] - 2 * LOGO.RX) / 2;           // offset at which the two shapes just touch
    const d = oc - (-SEP - PULL); tI = T.go[1]; vI = 3 * d / (T.go[1] - T.go[0]);   // cubic ease-in → arrival speed
    for (let t = T.burst[0]; t < T.burst[1]; t += .001) if (gapAt(t) > GMAX) { snapT = t; break; }
    const N = 14;                                                // the burst: products fly out of the hit
    for (let i = 0; i < N; i++) {
      const ang = (i + .5) / N * Math.PI * 2 + hash(i * 7 + 1) * .3, z = .5 + .5 * rnd(i * 7 + 2);
      BURST.push({ img: "p_" + PRODUCTS[(i * 5) % PRODUCTS.length], ang, z, reach: lerp(.15, .85, rnd(i * 7 + 3)),
                   size: lerp(310, 540, z), spin: hash(i * 7 + 4) * 2.6, rot0: hash(i * 7 + 5) * .5, delay: rnd(i * 7 + 6) * .05, life: lerp(1.3, 1.7, rnd(i * 7 + 7)) });
    }
    for (let i = 0; i < 34; i++) SPARKS.push({ ang: rnd(i * 13 + 1) * Math.PI * 2, reach: lerp(.22, .62, rnd(i * 13 + 2)), r: lerp(5, 13, rnd(i * 13 + 3)),
                                               col: SPARK[i % SPARK.length], life: lerp(.4, .75, rnd(i * 13 + 4)), delay: rnd(i * 13 + 5) * .04 });
    for (let i = 0; i < 10; i++) {                               // the outro: products gather back into the lens
      const ang = (i + .5) / 10 * Math.PI * 2 + .3 + hash(i * 11 + 1) * .25, z = .5 + .5 * rnd(i * 11 + 2);
      ABSORB.push({ img: "p_" + PRODUCTS[(i * 7 + 3) % PRODUCTS.length], ang, z, reach: lerp(.35, .95, rnd(i * 11 + 3)), size: lerp(290, 470, z),
                    spin: hash(i * 11 + 4) * 2.2, t0: T.absorb[0] + rnd(i * 11 + 5) * .12, dur: lerp(.34, .42, rnd(i * 11 + 6)) });
    }
  }

  /* offset of each ball from its place, towards the other (+ = deeper than the mark) */
  function offset(t) {
    if (t < T.anti[0]) return -SEP;
    if (t < T.go[0]) {                                           // pull back, trembling with charge
      const u = seg(t, T.anti[0], T.anti[1]); return -SEP - PULL * E.inOutSine(u) + Math.sin(2 * Math.PI * 26 * t) * 6 * u * u;
    }
    if (t < tI) return -SEP - PULL + (oc + SEP + PULL) * seg(t, T.go[0], T.go[1]) ** 3;
    if (t < T.absorb[0]) { const tau = t - tI; return spring(tau, oc, vI) * (1 - smooth(T.settle - .4, T.settle, tau)); }
    if (t < T.breathe[0]) return 0;
    if (t < T.breathe[1]) return OVER_OUT * E.inOutSine(seg(t, T.breathe[0], T.breathe[1]));
    if (t < T.burst[1]) return lerp(OVER_OUT, -SEP, E.outCubic(seg(t, T.burst[0], T.burst[1])));
    return -SEP - DRIFT * E.inOutSine(seg(t, T.drift[0], T.drift[1]));
  }
  const gapAt = t => 2 * (oc - offset(t));                       // edge-to-edge gap (negative while overlapping)

  /* per-ball squash: [sx, sy] */
  function squash(t) {
    if (t >= T.go[0] && t < tI) { const u = seg(t, T.go[0], T.go[1]) ** 2; return [1 + .09 * u, 1 - .05 * u]; }    // stretched by speed
    if (t >= tI && t < T.absorb[0]) {                            // jelly after the hit, starting from that stretch
      const tau = t - tI, w = 2 * Math.PI * 3.1, j = Math.exp(-5 * tau) * (-.09 * Math.cos(w * tau) + .13 * Math.sin(w * tau));
      const e = 1 - smooth(T.settle - .4, T.settle, tau); return [1 - j * e, 1 + .7 * j * e];
    }
    if (t >= T.breathe[0] && t < T.burst[0]) { const b = Math.sin(Math.PI * seg(t, T.breathe[0], T.burst[0])) * .03; return [1 - b, 1 + b * .6]; }
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
    const u = d < 2 * r ? Math.acos(d / (2 * r)) : 0, spread = Math.PI / 2;                // equal radii: maxSpread = π/2
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
    const hit = t >= tI && t < T.absorb[0] ? t - tI : -1;
    const rip = hit >= 0 ? { a: .008 * Math.exp(-4.5 * hit) * smooth(0, .04, hit), k: 5, ph: 16 * hit } : null;
    const s = [[sx * k1, sy * k1], [sx * k2, sy * k2]];
    const path = (i, rp) => { g.beginPath(); shape(g, i ? x2 : x1, s[i][0], s[i][1], rp && { ...rp, ph: rp.ph * (i ? -1 : 1) }); };
    for (const i of [0, 1]) { if ((i ? k2 : k1) <= 0) continue; g.save(); path(i, rip); g.clip(); grad(g, "mint_col", s[i][1]); g.restore(); }
    const v = neck(t);
    if (v > 0) { g.save(); g.beginPath(); if (bridge(g, x1, x2, v)) { g.clip(); grad(g, "mint_col", 1); } g.restore(); }
    if (k1 > 0 && k2 > 0 && x2 - x1 < 2 * LOGO.RX * Math.max(s[0][0], s[1][0])) {          // the lens where they overlap
      g.save(); path(0, rip); g.clip(); path(1, rip); g.clip(); grad(g, "deep_col", (s[0][1] + s[1][1]) / 2);
      if (hit >= 0 && hit < .45) { g.globalAlpha = .75 * (1 - hit / .45) ** 2; g.fillStyle = "#FFFFFF"; g.fillRect(-1e4, -1e4, 2e4, 2e4); }   // the flash
      g.restore();
    }
    if (k1 > 0) letters(g, x1, LOGO.c1[0], s[0][0], s[0][1], 0);
    if (k2 > 0) letters(g, x2, LOGO.c2[0], s[1][0], s[1][1], 1);
  }

  function impactFX(g, hit) {                                     // glow, two rings and sparks, over the mark
    if (hit < 0) return;
    if (hit < .4) {
      const a = .7 * (1 - hit / .4) ** 2, r = LOGO.R * lerp(.6, 1.3, E.outCubic(hit / .4));
      const gr = g.createRadialGradient(LOGO.CX, LOGO.CY, 0, LOGO.CX, LOGO.CY, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(.35, `rgba(200,250,244,${a * .55})`); gr.addColorStop(1, "rgba(160,240,232,0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(LOGO.CX, LOGO.CY, r, r, 0, 0, 7); g.fill();
    }
    for (const [d, dur, r0, r1, w0, w1, a0, sq] of [[0, .55, .3, 1.8, 10, 3, .7, .62], [.05, .8, .45, 2.5, 22, 4, .35, .85]]) {
      const u = (hit - d) / dur; if (u <= 0 || u >= 1) continue;
      const rr = lerp(r0, r1, E.outCubic(u)) * LOGO.R;
      g.save(); g.globalAlpha = a0 * (1 - u) ** 1.5; g.strokeStyle = RING; g.lineWidth = lerp(w0, w1, u);
      g.beginPath(); g.ellipse(LOGO.CX, LOGO.CY, rr * LOGO.SX * sq, rr, 0, 0, 7); g.stroke(); g.restore();
    }
    for (const p of SPARKS) {
      const u = (hit - p.delay) / p.life; if (u <= 0 || u >= 1) continue;
      const rr = p.reach * edge(p.ang) * E.outQuart(Math.min(1, u * 1.3)), x = LOGO.CX + Math.cos(p.ang) * rr, y = LOGO.CY + Math.sin(p.ang) * rr;
      g.globalAlpha = (1 - u) ** 1.2; g.fillStyle = p.col; g.beginPath(); g.ellipse(x, y, p.r * (1 - .6 * u), p.r * (1 - .6 * u), 0, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
  function product(g, img, x, y, size, rot, k, alpha, shadow) {
    if (k <= .01 || alpha <= .01) return;
    const im = IMG[img], s = size * k / Math.max(im.width, im.height);
    g.save(); g.globalAlpha = alpha; g.translate(x, y); g.rotate(rot);
    if (shadow) { g.shadowColor = "rgba(10,30,28,.25)"; g.shadowBlur = 26 * P.L * SCALE; g.shadowOffsetY = 10 * P.L * SCALE; }
    g.drawImage(im, -im.width * s / 2, -im.height * s / 2, im.width * s, im.height * s); g.restore();
  }
  function products(g, t) {
    const hit = t - tI;
    if (hit >= 0 && hit < 2) for (const p of BURST) {            // out of the hit: fast, then floating out and away
      const u = hit - p.delay; if (u <= 0 || u >= p.life) continue;
      const f = E.outQuart(Math.min(1, u / .85)) + .05 * u, rr = landAt(p.ang, p.size, p.reach) * f;
      const k = backOut(Math.min(1, u / .22)) * (1 - smooth(p.life - .4, p.life, u));
      product(g, p.img, LOGO.CX + Math.cos(p.ang) * rr, LOGO.CY + Math.sin(p.ang) * rr, p.size, p.rot0 + p.spin * (1 - Math.exp(-3 * u)), k, 1, true);
    }
    for (const p of ABSORB) {                                    // the outro: pulled back into the lens, accelerating
      const u = (t - p.t0) / p.dur; if (u <= 0 || u >= 1) continue;
      const f = 1 - u ** 2.4, rr = landAt(p.ang, p.size, p.reach) * f;
      product(g, p.img, LOGO.CX + Math.cos(p.ang) * rr, LOGO.CY + Math.sin(p.ang) * rr, p.size, p.spin * u * 1.5, lerp(1, .15, u ** 1.5), Math.min(1, u * 6), true);
    }
  }

  function cam(t) {                                               // wide for the names, a punch and a shake on the hit, wide again to leave
    let k = lerp(.95, 1, E.inOutSine(seg(t, T.go[0], tI + .8))), dx = 0, dy = 0;
    if (t >= tI) {
      const tau = t - tI, e = Math.exp(-7 * tau);
      k += .03 * (1 - Math.exp(-60 * tau)) * Math.exp(-5 * tau);
      dx = 16 * e * (Math.sin(97 * tau) + .6 * Math.sin(53 * tau + 1)) * P.L; dy = 12 * e * (Math.sin(83 * tau + 2) + .6 * Math.sin(61 * tau)) * P.L;
    }
    if (t >= T.breathe[0]) k = lerp(k, .95, E.inOutSine(seg(t, T.burst[0], T.drift[1])));
    return [k, dx, dy];
  }

  function draw(t) {
    if (!ALPHA) flatBG(BG);
    ctx.imageSmoothingQuality = "high";
    const [k, dx, dy] = cam(t), hit = t >= tI && t < T.absorb[0] ? t - tI : -1;
    P.tr(ctx, k); const m = ctx.getTransform(); ctx.setTransform(m.a, m.b, m.c, m.d, m.e + dx, m.f + dy);
    if (t >= tI + T.settle && t < T.breathe[0]) LOGO.drawFinal(ctx);   // at rest it is the official file
    else mark(ctx, t);
    impactFX(ctx, hit);
    products(ctx, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function cues() {
    const ev = [
      { type: "pop", t: T.pop[0] + .02, pan: -.55 }, { type: "pop", t: T.pop[1] + .02, pan: .55 },
      { type: "riser", t: T.anti[0], d: tI - T.anti[0], rev: true, level: -20 },                       // the charge
      { type: "whoosh", t: T.go[0] - .06, d: tI - T.go[0] + .1, pan: [-.9, 0], level: -15, fc: [300, 3200] },
      { type: "whoosh", t: T.go[0] - .05, d: tI - T.go[0] + .09, pan: [.9, 0], level: -15, fc: [350, 3600] },
      { type: "boom", t: tI - .004, level: -5 }, { type: "impact", t: tI, style: "digital", tail: T.absorb[0] - tI },
      { type: "whoosh", t: tI + .01, d: .8, pan: [0, 0], level: -19, fc: [2600, 500] },                // the burst flying out
      { type: "sparkle", t: tI + .02, d: 1.0, n: 30, level: -20 },
      { type: "riser", t: T.absorb[0] - .02, d: T.absorb[1] - T.absorb[0] + .04, rev: true, level: -21 },   // pulled back in
      { type: "sparkle", t: T.absorb[0] + .05, d: .45, n: 14, rev: true, level: -23 },
      { type: "thud", t: T.breathe[1] - .02 },
      { type: "whoosh", t: T.burst[0] - .02, d: .55, pan: [0, -.85], level: -17, fc: [400, 2400] },
      { type: "whoosh", t: T.burst[0], d: .5, pan: [0, .85], level: -17, fc: [450, 2800] },
      { type: "pop", t: snapT || T.burst[0] + .2, pan: 0 },
      { type: "pop", t: T.vanish[0] + T.vanish[1] * .7, pan: -.55 }, { type: "pop", t: T.vanish[0] + T.vanish[2] + T.vanish[1] * .7, pan: .55 },
    ];
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "collide-aim", load, draw, cues,
    blur: [[T.pop[0], T.pop[1] + T.pop[2]], [T.go[0], tI + 1.75], [T.absorb[0], T.drift[0] + .2], [T.vanish[0], T.vanish[0] + T.vanish[1] + T.vanish[2] + .05]] };
  TIMING.dur = T.end;
})();
