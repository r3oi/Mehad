/* AIM × "Broken Attitude": the mark is built as a coarse pixel grid in stop-motion —
   one pixel, a line, accent bars, grey blocks with black edges — it glitches and
   shuffles for a while, then the grid refines (28 → 56 → 112 → 224 columns) into the
   official mark. A digital-body scan resolving into the logo.
   During the glitch the grid flickers, for a few frames at a time, into pixel garments
   and accessories (glasses, tee with the lens on its chest, sneaker, cap, bag), as if
   the scan were trying outfits on — AIM's try-on idea. */
"use strict";
(() => {
  const T = { build: [.3, 1.9], shuffle: [1.9, 4.2], refine: [4.2, .35], final: [5.25, 5.5], end: 7.0, flash: [2.08, 2.48, 2.8, 3.2, 3.6] };
  const BG = "#F4F7F7", C = { grey: "#D3DEDD", dark: "#0D1515", lens: "#23B2A8", bar: "#3CCFC0" };
  const LEVELS = [28, 56, 112, 224];
  const FLASH_LEN = 3;                                           // stop-motion steps: one sliced, two clean
  let P, G = [], ITEMS = [];

  // the try-on items, drawn in grid-cell units on a 28 × 23 board, then sampled one point per cell
  const SRC = { grey: "#D3DEDD", teal: "#23B2A8", dark: "#0D1515", white: "#FFFFFF" };
  const lens = (g, x, y, r, d) => {                             // AIM's lens: where the two circles overlap
    g.save(); g.beginPath(); g.arc(x - d / 2, y, r, 0, 7); g.clip(); g.fillStyle = SRC.teal; g.beginPath(); g.arc(x + d / 2, y, r, 0, 7); g.fill(); g.restore();
  };
  const DRAW = [
    g => {                                                      // round glasses
      g.fillStyle = SRC.teal; [8.4, 19.6].forEach(x => { g.beginPath(); g.arc(x, 12, 4.7, 0, 7); g.fill(); });
      g.strokeStyle = SRC.dark; g.lineWidth = 1.1; g.beginPath(); g.arc(14, 11.4, 2, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
      g.fillStyle = SRC.dark; g.fillRect(1.6, 9.4, 2.6, 1.1); g.fillRect(23.8, 9.4, 2.6, 1.1);
      g.fillStyle = SRC.white; g.fillRect(5.6, 9.4, 1, 2); g.fillRect(16.8, 9.4, 1, 2);
    },
    g => {                                                      // tee, the lens on its chest
      g.fillStyle = SRC.grey; g.beginPath(); g.moveTo(8.6, 4.2); g.lineTo(11.6, 3.6); g.quadraticCurveTo(14, 6.6, 16.4, 3.6); g.lineTo(19.4, 4.2);
      g.lineTo(25, 8.4); g.lineTo(22.6, 12.2); g.lineTo(20, 10.8); g.lineTo(20, 21); g.lineTo(8, 21); g.lineTo(8, 10.8); g.lineTo(5.4, 12.2); g.lineTo(3, 8.4); g.closePath(); g.fill();
      lens(g, 14, 13, 3.4, 2.6);
    },
    g => {                                                      // sneaker, toe to the right
      g.fillStyle = SRC.grey; g.beginPath(); g.moveTo(3.8, 16); g.lineTo(4, 10.2); g.quadraticCurveTo(6.4, 9.2, 8.6, 10.6); g.lineTo(10.6, 7.6); g.lineTo(12.6, 7.4);
      g.lineTo(17.6, 11.6); g.quadraticCurveTo(23.6, 12.4, 25.4, 14.6); g.lineTo(25.4, 16); g.closePath(); g.fill();
      g.fillStyle = SRC.teal; g.beginPath(); g.roundRect(3, 15.4, 23, 2.6, 1.2); g.fill(); g.fillRect(4.6, 10.8, 2, 4);
      g.fillStyle = SRC.dark; [[12, 9], [13.6, 10.1], [15.2, 11.2]].forEach(([x, y]) => g.fillRect(x - .6, y - .5, 1.2, 1));
    },
    g => {                                                      // cap, side on
      g.fillStyle = SRC.grey; g.beginPath(); g.moveTo(3.5, 16); g.bezierCurveTo(3.5, 4.5, 19.5, 3.5, 20.5, 16); g.closePath(); g.fill();
      g.fillStyle = SRC.teal; g.beginPath(); g.moveTo(17, 13.6); g.quadraticCurveTo(24.5, 12.4, 27, 15.2); g.lineTo(26.6, 17.4); g.quadraticCurveTo(21.5, 16.4, 17, 17.4); g.closePath(); g.fill();
      g.fillStyle = SRC.dark; g.fillRect(10.2, 6.4, 1.6, 1);
      g.strokeStyle = SRC.dark; g.lineWidth = .8; g.beginPath(); g.moveTo(11.4, 7.6); g.quadraticCurveTo(15.4, 10, 16, 15); g.stroke();
    },
    g => {                                                      // bag
      g.strokeStyle = SRC.grey; g.lineWidth = 1.6; g.beginPath(); g.moveTo(9.4, 10.5); g.bezierCurveTo(9.4, 3.4, 18.6, 3.4, 18.6, 10.5); g.stroke();
      g.fillStyle = SRC.grey; g.beginPath(); g.moveTo(6.2, 10); g.lineTo(21.8, 10); g.lineTo(23.4, 20); g.lineTo(4.6, 20); g.closePath(); g.fill();
      g.fillStyle = SRC.teal; g.beginPath(); g.moveTo(6.2, 10); g.lineTo(21.8, 10); g.lineTo(22.3, 13.6); g.quadraticCurveTo(14, 16.4, 5.7, 13.6); g.closePath(); g.fill();
      g.fillStyle = SRC.dark; g.fillRect(13.2, 14, 1.6, 1.8);
    },
  ];

  function buildItem(fn, N0, M0) {
    const IW = 28, IH = 23, S = 24, cv = Object.assign(document.createElement("canvas"), { width: IW * S, height: IH * S });
    const g = cv.getContext("2d", { willReadFrequently: true }); g.scale(S, S); fn(g);
    const d = g.getImageData(0, 0, cv.width, cv.height).data, pal = Object.entries(SRC).map(([k, h]) => [k, [1, 3, 5].map(o => parseInt(h.slice(o, o + 2), 16))]);
    const cls = [];
    for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
      const k = (Math.floor((j + .5) * S) * cv.width + Math.floor((i + .5) * S)) * 4;
      cls.push(d[k + 3] < 128 ? null : pal.reduce((b, [n, c]) => { const e = (c[0] - d[k]) ** 2 + (c[1] - d[k + 1]) ** 2 + (c[2] - d[k + 2]) ** 2; return e < b[1] ? [n, e] : b; }, [null, 1e9])[0]);
    }
    const at = (i, j) => (i < 0 || j < 0 || i >= IW || j >= IH) ? null : cls[j * IW + i];
    const cells = []; let i0 = IW, i1 = 0, j0 = IH, j1 = 0;
    for (let j = 0; j < IH; j++) for (let i = 0; i < IW; i++) {
      const c = at(i, j); if (!c) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !at(i + di, j + dj));
      cells.push({ i, j, col: edge ? C.dark : c === "grey" ? C.grey : c === "teal" ? C.lens : c === "dark" ? C.dark : "#FFFFFF" });
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const di = Math.round((N0 - 1) / 2 - (i0 + i1) / 2), dj = Math.round((M0 - 1) / 2 - (j0 + j1) / 2);   // centred on the mark's grid
    cells.forEach(c => { c.i += di; c.j += dj; });
    cells.box = [i0 + di, j0 + dj, i1 + di, j1 + dj];
    return cells;
  }

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
    ITEMS = DRAW.map(fn => buildItem(fn, G[0].N, G[0].M));
    const L0 = G[0], at = (i, j) => (i < 0 || j < 0 || i >= L0.N || j >= L0.M) ? null : L0.cells[j * L0.N + i];
    for (const c of L0.cells) {                                  // palette for the coarse build
      const letter = c.inU && c.a < .5;
      const edge = !letter && c.inU && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => { const n = at(c.i + di, c.j + dj); return !n || !n.inU || (n.inU && n.a < .5); });
      c.col = letter || !c.inU ? null : edge ? C.dark : c.lens ? C.lens : C.grey;
      c.t = T.build[0] + (T.build[1] - T.build[0]) * (c.i / L0.N * .72 + rnd(c.i * 131 + c.j * 7) * .28);
    }
  }

  function grid(L, colourOf, t, st, shuffle, rowShift) {
    const cw = LOGO.src.w * P.L / L.N, ch = LOGO.src.h * P.L / L.M;
    for (const c of L.cells) {
      const col = colourOf(c); if (!col) continue;
      let dy = 0;
      if (shuffle > 0 && rnd(c.i * 53 + st * 11) < .12 * shuffle) dy = (rnd(c.i * 71 + st) < .5 ? -1 : 1) * ch;
      const dx = rowShift ? rowShift(c.j) : 0; if (dx === null) continue;
      ctx.fillStyle = col; ctx.fillRect(P.x + (c.i + dx) * cw, P.y + c.j * ch + dy, Math.ceil(cw) + .5, Math.ceil(ch) + .5);
    }
  }
  function tag(text, at = [4, 6]) {                              // a small label, like on a prototype
    const L0 = G[0], cw = LOGO.src.w * P.L / L0.N, ch = LOGO.src.h * P.L / L0.M;
    ctx.fillStyle = C.dark; const tw = 92 * W / 1920, th = 30 * W / 1920, tx = P.x + at[0] * cw, ty = P.y + at[1] * ch;
    ctx.fillRect(tx, ty, tw, th); ctx.fillStyle = "#FFFFFF"; ctx.font = `600 ${16 * W / 1920}px Inter, sans-serif`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.fillText(text, tx + tw / 2, ty + th / 2 + 1);
  }
  function flashAt(st) {                                         // which try-on item (if any) holds this step
    for (let k = 0; k < T.flash.length; k++) { const s0 = smStep(T.flash[k]); if (st >= s0 && st < s0 + FLASH_LEN) return { k, ph: st - s0 }; }
    return null;
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
    const L0 = G[0], logoCol = c => (ts >= c.t ? (sh > 0 && rnd(c.i * 7 + c.j * 3 + st) < .05 ? (c.col === C.dark ? C.grey : C.dark) : c.col) : null);
    const f = flashAt(st);
    if (f) {
      const item = { N: L0.N, M: L0.M, cells: ITEMS[f.k] };
      const slip = (j, p) => rnd(j * 13 + st * 7) < p ? (rnd(j * 5 + st) < .5 ? -1 : 1) * (1 + Math.floor(rnd(j * 3 + st) * 2)) : 0;
      if (f.ph === 0) {                                          // sliced: bands of rows swap between the mark and the item
        const fromItem = j => rnd(Math.floor((j + 4) / 2) * 31 + st) < .55;
        grid(L0, logoCol, t, st, 0, j => fromItem(j) ? null : slip(j, .4));
        grid(item, c => c.col, t, st, 0, j => fromItem(j) ? slip(j, .4) : null);
      } else grid(item, c => c.col, t, st, 0, j => f.ph === 1 ? slip(j, .1) : 0);
      if (f.ph) { const b = ITEMS[f.k].box; tag(`FIT · 0${f.k + 1}`, [b[0] - 1, b[1] - 2]); } else tag("AIM · 26");
      return;
    }
    grid(L0, logoCol, t, st, sh);
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
    if (t >= .5 && t < 3.9) tag("AIM · 26");
  }

  function cues() {
    const ev = [{ type: "pop", t: .12, pan: -.4 }];
    for (let s = smStep(T.build[0]); s < smStep(T.build[1]); s += 1) ev.push({ type: "type", t: s / SM_FPS, level: -28, pan: lerp(-.6, .6, (s / SM_FPS - T.build[0]) / (T.build[1] - T.build[0])) });
    ev.push({ type: "glitch", t: T.shuffle[0], d: T.shuffle[1] - T.shuffle[0], pan: 0 });
    T.flash.forEach((t, k) => {                                  // each try-on item: a bright burst and a click as it lands
      const s0 = smTime(t), pan = [-.35, .3, -.15, .4, -.3][k];
      ev.push({ type: "glitch", t: s0, d: .2, pan, level: -20 });
      ev.push({ type: "pop", t: s0 + 1 / SM_FPS, pan });
    });
    for (let i = 0; i < 3; i++) ev.push({ type: "zip", t: T.refine[0] + i * T.refine[1] });
    ev.push({ type: "impact", t: T.final[0], style: "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "broken-aim", load, draw, cues, blur: [] };
  TIMING.dur = T.end;
})();
