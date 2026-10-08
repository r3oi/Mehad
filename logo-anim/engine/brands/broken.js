/* AIM × "Broken Attitude": the mark is built as a coarse pixel grid in stop-motion —
   one pixel, a line, accent bars, grey blocks with black edges — it glitches and
   shuffles for a while, then the grid refines (28 → 56 → 112 → 224 columns) into the
   official mark. A digital-body scan resolving into the logo. */
"use strict";
(() => {
  const T = { build: [.3, 1.9], shuffle: [1.9, 4.2], refine: [4.2, .35], final: [5.25, 5.5], end: 7.0 };
  const BG = "#F4F7F7", C = { grey: "#D3DEDD", dark: "#0D1515", lens: "#23B2A8", bar: "#3CCFC0" };
  const LEVELS = [28, 56, 112, 224];
  let P, G = [];

  async function load() {
    await LOGO.load(); P = place(LOGO, FORMAT === "1x1" ? 700 : 780);
    const { c1, c2, R } = LOGO, w = LOGO.src.w, h = LOGO.src.h;
    for (const N of LEVELS) {
      const M = Math.round(N * h / w), cv = Object.assign(document.createElement("canvas"), { width: N, height: M });
      const g = cv.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(LOGO.I("logo_source"), 0, 0, N, M);
      const d = g.getImageData(0, 0, N, M).data, cells = [];
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
        const k = (j * N + i) * 4, x = (i + .5) / N * w, y = (j + .5) / M * h;
        const in1 = Math.hypot(x - c1[0], y - c1[1]) < R, in2 = Math.hypot(x - c2[0], y - c2[1]) < R;
        cells.push({ i, j, r: d[k], g: d[k + 1], b: d[k + 2], a: d[k + 3] / 255, inU: in1 || in2, lens: in1 && in2 });
      }
      G.push({ N, M, cells });
    }
    const L0 = G[0], at = (i, j) => (i < 0 || j < 0 || i >= L0.N || j >= L0.M) ? null : L0.cells[j * L0.N + i];
    for (const c of L0.cells) {                                  // palette for the coarse build
      const letter = c.inU && c.a < .5;
      const edge = !letter && c.inU && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const n = at(c.i + di, c.j + dj); return !n || !n.inU || (n.inU && n.a < .5); });
      c.col = letter || !c.inU ? null : edge ? C.dark : c.lens ? C.lens : C.grey;
      c.t = T.build[0] + (T.build[1] - T.build[0]) * (c.i / L0.N * .72 + rnd(c.i * 131 + c.j * 7) * .28);
    }
  }

  function grid(L, colourOf, t, st, shuffle) {
    const cw = LOGO.src.w * P.L / L.N, ch = LOGO.src.h * P.L / L.M;
    for (const c of L.cells) {
      const col = colourOf(c); if (!col) continue;
      let dy = 0;
      if (shuffle > 0 && rnd(c.i * 53 + st * 11) < .12 * shuffle) dy = (rnd(c.i * 71 + st) < .5 ? -1 : 1) * ch;
      ctx.fillStyle = col; ctx.fillRect(P.x + c.i * cw, P.y + c.j * ch + dy, Math.ceil(cw) + .5, Math.ceil(ch) + .5);
    }
  }

  function draw(t) {
    flatBG(BG); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const st = smStep(t), ts = smTime(t);
    if (t >= T.final[0]) {
      const f = E.inOutCubic(seg(t, T.final[0], T.final[1]));
      if (f < 1) grid(G[3], c => c.a > .02 ? `rgb(${Math.round(c.r * c.a + 244 * (1 - c.a))},${Math.round(c.g * c.a + 247 * (1 - c.a))},${Math.round(c.b * c.a + 247 * (1 - c.a))})` : null, t, st, 0);
      P.tr(ctx); ctx.globalAlpha = f; LOGO.drawFinal(ctx, false); ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0); return;
    }
    const lvl = t < T.refine[0] ? 0 : Math.min(3, 1 + Math.floor((t - T.refine[0]) / T.refine[1]));
    if (lvl > 0) {                                               // refining: true colours, finer each step
      grid(G[lvl], c => c.a > .02 ? `rgb(${Math.round(c.r * c.a + 244 * (1 - c.a))},${Math.round(c.g * c.a + 247 * (1 - c.a))},${Math.round(c.b * c.a + 247 * (1 - c.a))})` : null, t, st, 0);
      return;
    }
    const sh = seg(t, T.shuffle[0], T.shuffle[0] + .3) * (1 - seg(t, T.shuffle[1] - .4, T.shuffle[1]));
    const L0 = G[0];
    grid(L0, c => (ts >= c.t ? (sh > 0 && rnd(c.i * 7 + c.j * 3 + st) < .05 ? (c.col === C.dark ? C.grey : C.dark) : c.col) : null), t, st, sh);
    // the first pixel and line
    const cw = LOGO.src.w * P.L / L0.N, ch = LOGO.src.h * P.L / L0.M;
    if (t >= .12 && t < T.build[0] + .3) { ctx.fillStyle = C.dark; ctx.fillRect(P.x + 3 * cw, P.y + 9 * ch, cw, ch); }
    // accent bars that jump between columns
    const bars = t >= .3 && t < T.refine[0] - .2 ? 4 : 0;
    for (let b = 0; b < bars; b++) {
      const col = 4 + Math.floor(rnd(b * 97 + Math.floor(st / 3) * 13) * (L0.N - 8));
      const grow = seg(ts, .3 + b * .2, .7 + b * .2);
      ctx.fillStyle = C.bar; ctx.fillRect(P.x + col * cw + cw * .3, P.y + ch * 2, cw * .4, (L0.M - 4) * ch * grow);
    }
    // a small tag, like a label on a prototype
    if (t >= .5 && t < 3.9) {
      ctx.fillStyle = C.dark; const tw = 92 * W / 1920, th = 30 * W / 1920, tx = P.x + 4 * cw, ty = P.y + 6 * ch;
      ctx.fillRect(tx, ty, tw, th); ctx.fillStyle = "#FFFFFF"; ctx.font = `600 ${16 * W / 1920}px Inter, sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText("AIM · 26", tx + tw / 2, ty + th / 2 + 1);
    }
  }

  function cues() {
    const ev = [{ type: "pop", t: .12, pan: -.4 }];
    for (let s = smStep(T.build[0]); s < smStep(T.build[1]); s += 1) ev.push({ type: "type", t: s / SM_FPS, level: -28, pan: lerp(-.6, .6, (s / SM_FPS - T.build[0]) / (T.build[1] - T.build[0])) });
    ev.push({ type: "glitch", t: T.shuffle[0], d: T.shuffle[1] - T.shuffle[0], pan: 0 });
    for (let i = 0; i < 3; i++) ev.push({ type: "zip", t: T.refine[0] + i * T.refine[1] });
    ev.push({ type: "impact", t: T.final[0], style: "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "broken-aim", load, draw, cues, blur: [] };
  TIMING.dur = T.end;
})();
