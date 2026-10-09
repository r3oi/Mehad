/* Idea 3 — "Kapsul": a small 3D object grows and tumbles, settles face-on and becomes
   the symbol; its inner shapes fan open like pages and close into place. Cut to the
   lockup: the name types on part by part with wide tracking that closes up, then a
   slow pull-back to the end.
   MEHAD: a teal cube → the icon square; the white thread fans like pages; the counters fill.
   AIM:   a mint disc (coin) → one circle; copies fan out to the right and settle as the pair. */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  const C = isM ? { bg: "#0E1620", width: { "16x9": 1060, "1x1": 860 } } : { bg: "#081615", width: { "16x9": 820, "1x1": 720 } };
  const T = { grow: [0, 1.05], flat: [.82, 1.05], fan: [.95, 1.75], fills: [1.32, .08, .22], cut: 2.04, track: [2.04, 2.64], type: [2.08, .08], dur: 5.2 };
  let P, B, BC, faceTex, backTex;     // P: lockup placement, B: big symbol scale, BC: big symbol centre (source px)

  async function load() {
    await LOGO.load();
    P = place(LOGO, C.width[FORMAT]);
    if (isM) {
      const [a, b, c, d] = LOGO.icon; BC = [(a + c) / 2, (b + d) / 2];
      B = .54 * H / (d - b);
      faceTex = document.createElement("canvas"); faceTex.width = c - a; faceTex.height = d - b;
      faceTex.getContext("2d").drawImage(LOGO.I("icon_square"), a, b, c - a, d - b, 0, 0, c - a, d - b);
    } else {
      const { R } = LOGO; BC = [LOGO.CX, LOGO.CY]; B = Math.min(.58 * H / (2 * R), .76 * W / LOGO.src.w);
      const d = Math.ceil(2 * R);
      faceTex = Object.assign(document.createElement("canvas"), { width: d, height: d });
      const g = faceTex.getContext("2d"); g.translate(R - LOGO.c1[0], R - LOGO.c1[1]); LOGO.circles(g, LOGO.c1[0], null);
      backTex = tinted(faceTex, "#1C8C84");
    }
  }

  const big = (x, y) => [W / 2 + (x - BC[0]) * B, H / 2 + (y - BC[1]) * B];   // symbol stage, centred
  const tumble = t => {
    const u = E.outCubic(seg(t, T.grow[0], T.grow[1]));
    return { rx: (1 - u) * 2.5, ry: (1 - u) * -3.4, rz: (1 - u) * .5, k: lerp(.03, 1, E.outCubic(seg(t, 0, 1.0)) ** 1.15) };
  };

  /* MEHAD: a cube whose front face becomes the icon square */
  function cube(t) {
    const { rx, ry, rz, k } = tumble(t), [a, b, c, d] = LOGO.icon, side = (c - a) * B * k;
    const flat = E.inOutCubic(seg(t, T.flat[0], T.flat[1])), depth = side * (1 - flat);
    const V = []; for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) V.push(rot3([x * side, y * side, z * depth], rx, ry, rz));
    const Q = V.map(p => proj(p, 2600, W / 2, H / 2, 1));
    const faces = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1], [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];   // -z(front) +z -y +y -x +x
    const cols = [["#2FB5A9", "#6FD9CD"], ["#1E8C84", "#BC9D6A"], ["#5FD3C6", "#28A299"], ["#167A73", "#2FB5A9"], ["#28A299", "#7FE3D6"], ["#BC9D6A", "#2FB5A9"]];
    const vis = faces.map((f, i) => {
      const [p0, p1, p2] = f.map(j => Q[j]);
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      return { f, i, cross, z: f.reduce((s, j) => s + V[j][2], 0) };
    }).filter(o => o.cross < 0).sort((x, y) => y.z - x.z);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const { f, i } of vis) {
      const pts = f.map(j => Q[j]);
      if (i === 0 && flat > 0) {                                  // the front face turns into the icon square
        drawImageQuad(ctx, faceTex, 0, 0, faceTex.width, faceTex.height, [pts[0], pts[3], pts[2], pts[1]].map(p => p), 10);
        if (flat >= 1) continue;
        ctx.globalAlpha = 1 - E.inOutCubic(Math.min(1, flat / .55));
      }
      const g = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
      const sh = .55 + .45 * Math.abs(Math.sin(t * 2.2 + i));
      g.addColorStop(0, cols[i][0]); g.addColorStop(1, cols[i][1]);
      ctx.beginPath(); pts.forEach((p, j) => j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
      const nrm = rot3([[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0]][i], rx, ry, rz);
      const lit = Math.max(0, -.35 * nrm[0] - .55 * nrm[1] - .76 * nrm[2]);              // key light from upper left, front
      ctx.fillStyle = g; ctx.fill(); ctx.fillStyle = `rgba(255,255,255,${.1 * sh + .18 * lit})`; ctx.fill();
      ctx.fillStyle = `rgba(4,20,24,${.42 * (1 - lit)})`; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  /* AIM: a coin with thickness whose face becomes the first circle */
  function coin(t) {
    const { rx, ry, rz, k } = tumble(t), d = faceTex.width * B * k, flat = E.inOutCubic(seg(t, T.flat[0], T.flat[1]));
    const th = d * .09 * (1 - flat), layers = 9;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i <= layers; i++) {
      const z = lerp(th / 2, -th / 2, i / layers);
      const Q = [[-d / 2, -d / 2, z], [d / 2, -d / 2, z], [d / 2, d / 2, z], [-d / 2, d / 2, z]].map(p => proj(rot3(p, rx * .8, ry, rz), 2600, W / 2, H / 2, 1));
      const nz = rot3([0, 0, -1], rx * .8, ry, rz)[2];
      const tex = i === layers ? (nz <= 0 ? faceTex : backTex) : i === 0 ? (nz <= 0 ? backTex : faceTex) : backTex;
      drawImageQuad(ctx, tex, 0, 0, tex.width, tex.height, Q, 10);
    }
  }

  function draw(t, n) {
    flatBG(C.bg); vignetteDark(.32); ctx.imageSmoothingQuality = "high";
    if (t < T.cut) {
      const fan = seg(t, T.fan[0], T.fan[1]), f = E.outCubic(fan);
      if (isM) {
        cube(t);
        if (t >= T.fan[0]) {                                     // thread pages fan open and close
          const [ox, oy] = big(1620, 330), N = 6;
          const tr = (k = 1) => { ctx.setTransform(1, 0, 0, 1, 0, 0); const [x0, y0] = big(0, 0); ctx.translate(x0, y0); ctx.scale(B * k, B * k); };
          [["sand", 0], ["navy", 1], ["olive", 2]].forEach(([nm, i]) => {
            const q = E.outCubic(seg(t, T.fills[0] + i * T.fills[1], T.fills[0] + i * T.fills[1] + T.fills[2])); if (q <= 0) return;
            const [cx, cy] = LOGO.G["fill_" + nm]; tr(); ctx.translate(cx, cy); ctx.scale(lerp(.3, 1, q), lerp(.3, 1, q)); ctx.translate(-cx, -cy);
            ctx.globalAlpha = q; ctx.drawImage(LOGO.I("icon_fill_" + nm), 0, 0, LOGO.src.w, LOGO.src.h); ctx.globalAlpha = 1;
          });
          for (let k = N - 1; k >= 0; k--) {
            const spread = (1 - f) * .95, ang = -spread * (k / (N - 1)) * (1 - .15 * k / N);
            const a = k === 0 ? 1 : (1 - f) * (.9 - k * .1) * Math.min(1, fan * 6);
            if (a <= .01) continue;
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.translate(ox, oy); ctx.rotate(ang); ctx.translate(-ox, -oy);
            const [x0, y0] = big(0, 0); ctx.translate(x0, y0); ctx.scale(B, B);
            ctx.globalAlpha = Math.min(1, a * Math.min(1, fan * 5)); ctx.drawImage(LOGO.I("icon_thread"), 0, 0, LOGO.src.w, LOGO.src.h);
          }
          ctx.globalAlpha = 1;
        }
      } else {
        const { c1, c2 } = LOGO, N = 6;
        if (t < T.fan[0]) coin(t);
        else {
          const s1 = E.outCubic(seg(t, T.fan[0], T.fan[0] + .45)), s2 = E.inOutCubic(seg(t, T.fan[0] + .3, T.fan[1]));
          const xL = lerp(BC[0], c1[0], s2), xMax = lerp(BC[0], c2[0] + 170, s1) - 170 * s2;
          ctx.setTransform(1, 0, 0, 1, 0, 0); const [x0, y0] = big(0, 0); ctx.translate(x0, y0); ctx.scale(B, B);
          for (let k = N - 1; k >= 1; k--) {                      // pages spread to the right, then gather into the second circle
            const a = .32 * (1 - s2) * Math.min(1, (t - T.fan[0]) * 8); if (a <= .01) continue;
            ctx.globalAlpha = a; LOGO.circles(ctx, lerp(xL, xMax, k / N), null);
          }
          ctx.globalAlpha = 1; LOGO.circles(ctx, xL, null);
          ctx.globalAlpha = Math.min(1, (t - T.fan[0]) * 6); LOGO.circles(ctx, null, xMax); ctx.globalAlpha = 1;
          const lens = seg(t, T.fan[1] - .3, T.fan[1]);
          if (lens > 0) { ctx.save(); ctx.beginPath(); LOGO.ell(ctx, xL, LOGO.CY); ctx.clip(); ctx.globalAlpha = lens; LOGO.circles(ctx, xL, xMax); ctx.restore(); }
        }
      }
      return;
    }
    // cut: the lockup types on with wide tracking that closes up, then a slow pull-back
    const k = 1 - .05 * E.outCubic(seg(t, T.cut, T.dur));
    const sp = lerp(isM ? 1.32 : 1.55, 1, E.inOutCubic(seg(t, T.track[0], T.track[1])));
    const cxs = LOGO.src.w / 2, shown = i => n / FPS >= T.type[0] + i * T.type[1] - 1e-6;   // parts pop on whole frames
    if (sp <= 1.0001 && t > T.track[1]) { P.tr(ctx, k); LOGO.drawFinal(ctx, true); ctx.setTransform(1, 0, 0, 1, 0, 0); return; }
    if (isM) {
      const [a, , c] = LOGO.icon, dx = ((a + c) / 2 - cxs) * (sp - 1);
      P.tr(ctx, k); ctx.translate(dx, 0); LOGO.drawIcon(ctx);
      const ar = LOGO.slots.filter(s => s.group === "ar"), en = LOGO.slots.filter(s => s.group === "en");
      [[ar, 0], [en, 0]].forEach(([list]) => list.forEach((s, i) => {
        if (!shown(i)) return;
        const [x0, y0, x1, y1] = s.box, off = ((x0 + x1) / 2 - cxs) * (sp - 1);
        P.tr(ctx, k); ctx.translate(off, 0); ctx.drawImage(LOGO.layer(s.img, true), x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }));
    } else {
      P.tr(ctx, k); LOGO.circles(ctx, LOGO.c1[0], LOGO.c2[0]);
      LOGO.slots.forEach((s, i) => {
        if (!shown(i)) return;
        const [x0, y0, x1, y1] = s.box, off = ((x0 + x1) / 2 - cxs) * (sp - 1);
        P.tr(ctx, k); ctx.translate(off, 0); ctx.drawImage(LOGO.layer("letters"), x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4, x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
      });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function cues() {
    const ev = [{ type: "spin", t: 0, d: T.grow[1] }, { type: "thud", t: T.flat[1] - .03 }];
    const nPages = 6; for (let i = 0; i < nPages; i++) ev.push({ type: "flutter", t: T.fan[0] + .05 + i * .07 });
    if (isM) for (let i = 0; i < 3; i++) ev.push({ type: "pop", t: T.fills[0] + i * T.fills[1], pan: [.4, .1, -.3][i] });
    ev.push({ type: "swell", t: T.fan[1] - .3, d: T.cut - T.fan[1] + .3 });
    ev.push({ type: "impact", t: T.cut, style: isM ? "paper" : "digital" });
    const nType = isM ? 5 : 3; for (let i = 0; i < nType; i++) ev.push({ type: "type", t: T.type[0] + i * T.type[1], pan: (i / Math.max(1, nType - 1)) * 1.2 - .6 });
    ev.push({ type: "whoosh", t: T.track[0], d: T.track[1] - T.track[0] + .1, pan: [0, 0], level: -24, fc: [500, 3000] });
    return { dur: T.dur, events: ev };
  }

  window.BRAND_DEF = { name: "kapsul-" + LOGO_NAME, load, draw, cues, blur: [[0, 1.8], [T.track[0], T.track[1]]] };
  TIMING.dur = T.dur;
})();
