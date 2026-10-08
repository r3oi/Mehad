/* × "Broken Attitude": the mark is built as a coarse pixel grid in stop-motion —
   one pixel, a line, accent bars, grey blocks with black edges — it glitches and
   shuffles for a while, then the grid refines into the official mark. A digital scan
   resolving into the logo. During the glitch the grid flickers, three stop-motion steps
   at a time, into small pixel objects that say what the brand is about.
   AIM:   28 → 224 columns, left → right; garments and accessories (glasses, a tee with
          AIM's lens, sneaker, cap, bag) — the try-on idea.
   MEHAD: 40 → 320 columns, right → left on a warm ground; grey icon block with the
          white thread cut out and the counters in sand / olive / navy, the name in navy
          pixels; objects of learning (book, pencil, bulb, school bag, graduation cap). */
"use strict";
(() => {
  const isM = LOGO_NAME === "mehad";
  // each object: one sliced step in, six clean steps (~0.5s), one sliced step out; two steps of the mark between
  const FL = { first: 26, hold: 6, gap: 2, n: 5 }, FLASH_LEN = FL.hold + 2;
  const flashEnd = (FL.first + FL.n * FLASH_LEN + (FL.n - 1) * FL.gap) / SM_FPS;            // 5.92s
  const T = { build: [.3, 1.9], shuffle: [1.9, flashEnd + .38], refine: [flashEnd + .38, .35], final: [flashEnd + 1.43, flashEnd + 1.68], end: flashEnd + 3.18,
              flash: [...Array(FL.n).keys()].map(k => (FL.first + k * (FLASH_LEN + FL.gap)) / SM_FPS) };
  const CFG = isM
    ? { bg: [245, 242, 236], width: { "16x9": 1040, "1x1": 860 }, levels: [56, 112, 224, 448], items: [40, 14], dir: -1, src: "lockup_source", tag: "MEHAD · 26", flashTag: "LEARN", first: [48, 4], tagAt: [38, 15],
        C: { grey: "#DDD8CE", dark: "#0E1620", lens: "#28A299", bar: ["#28A299", "#BC9D6A", "#6DA87D", "#28A299"], ink: "#43546A", thread: "#FFFFFF", sand: "#BC9D6A", olive: "#6DA87D", navy: "#43546A" } }
    : { bg: [244, 247, 247], width: { "16x9": 780, "1x1": 700 }, levels: [28, 56, 112, 224], items: [28, 19], dir: 1, src: "logo_source", tag: "AIM · 26", flashTag: "FIT", first: [3, 9], tagAt: [4, 6],
        C: { grey: "#D3DEDD", dark: "#0D1515", lens: "#23B2A8", bar: ["#3CCFC0"] } };
  const C = CFG.C, BG = `rgb(${CFG.bg})`, LEVELS = CFG.levels;
  let P, G = [], ITEMS = [];

  // the try-on items, drawn in grid-cell units on a 28 × 23 board, then sampled one point per cell
  const SRC = { grey: "#D3DEDD", teal: "#23B2A8", dark: "#0D1515", white: "#FFFFFF", sand: "#BC9D6A", olive: "#6DA87D", navy: "#43546A" };
  const lens = (g, x, y, r, d) => {                             // AIM's lens: where the two circles overlap
    g.save(); g.beginPath(); g.arc(x - d / 2, y, r, 0, 7); g.clip(); g.fillStyle = SRC.teal; g.beginPath(); g.arc(x + d / 2, y, r, 0, 7); g.fill(); g.restore();
  };
  const DRAW_AIM = [
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
  const DRAW_MEHAD = [
    g => {                                                      // open book
      g.fillStyle = SRC.teal; g.beginPath(); g.moveTo(2.4, 7.4); g.lineTo(14, 8.8); g.lineTo(25.6, 7.4); g.lineTo(25.6, 19); g.lineTo(14, 20.4); g.lineTo(2.4, 19); g.closePath(); g.fill();
      g.fillStyle = SRC.grey; g.beginPath(); g.moveTo(3.6, 5.8); g.quadraticCurveTo(9, 5.2, 13.4, 7.2); g.lineTo(13.4, 18.6); g.quadraticCurveTo(9, 16.8, 3.6, 17.4); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(24.4, 5.8); g.quadraticCurveTo(19, 5.2, 14.6, 7.2); g.lineTo(14.6, 18.6); g.quadraticCurveTo(19, 16.8, 24.4, 17.4); g.closePath(); g.fill();
      g.fillStyle = SRC.dark; [9, 11, 13].forEach(y => { g.fillRect(5, y, 6.6, 1); g.fillRect(16.4, y, 6.6, 1); });
    },
    g => {                                                      // pencil
      g.translate(14, 11.5); g.rotate(-Math.PI / 5);
      g.fillStyle = SRC.olive; g.fillRect(-12.6, -2.3, 2.4, 4.6); g.fillStyle = SRC.grey; g.fillRect(-10.2, -2.3, 1.8, 4.6);
      g.fillStyle = SRC.teal; g.fillRect(-8.4, -2.3, 15, 4.6);
      g.fillStyle = SRC.sand; g.beginPath(); g.moveTo(6.6, -2.3); g.lineTo(12.2, 0); g.lineTo(6.6, 2.3); g.closePath(); g.fill();
      g.fillStyle = SRC.dark; g.beginPath(); g.moveTo(10.2, -.8); g.lineTo(12.4, 0); g.lineTo(10.2, .8); g.closePath(); g.fill();
    },
    g => {                                                      // a bulb: the idea
      g.fillStyle = SRC.sand; g.beginPath(); g.arc(14, 9.6, 5.8, Math.PI * .78, Math.PI * 2.22); g.lineTo(16.4, 16.4); g.lineTo(11.6, 16.4); g.closePath(); g.fill();
      g.fillStyle = SRC.grey; g.fillRect(11.4, 16.4, 5.2, 3.2); g.fillStyle = SRC.dark; g.fillRect(12.4, 20, 3.2, 1); g.fillStyle = SRC.white; g.fillRect(11, 7, 1, 2);
      [-150, -115, -90, -65, -30].forEach(a => { g.save(); g.translate(14, 9.6); g.rotate(a * Math.PI / 180); g.fillStyle = SRC.dark; g.fillRect(7.6, -.5, 1.8, 1); g.restore(); });
    },
    g => {                                                      // school bag
      g.strokeStyle = SRC.dark; g.lineWidth = 1.2; g.beginPath(); g.arc(14, 5.8, 2.6, Math.PI, 0); g.stroke();
      g.fillStyle = SRC.grey; g.fillRect(5, 9, 1.8, 9); g.fillRect(21.2, 9, 1.8, 9); g.beginPath(); g.roundRect(6.6, 5.4, 14.8, 15.6, 4); g.fill();
      g.fillStyle = SRC.olive; g.beginPath(); g.roundRect(9, 12.6, 10, 6.6, 1.6); g.fill(); g.fillStyle = SRC.dark; g.fillRect(10, 14, 8, 1);
    },
    g => {                                                      // graduation cap
      g.fillStyle = SRC.navy; g.beginPath(); g.moveTo(8, 11); g.lineTo(20, 11); g.lineTo(20, 16.6); g.quadraticCurveTo(14, 19, 8, 16.6); g.closePath(); g.fill();
      g.fillStyle = SRC.teal; g.beginPath(); g.moveTo(1.6, 9); g.lineTo(14, 4.2); g.lineTo(26.4, 9); g.lineTo(14, 13.8); g.closePath(); g.fill();
      g.strokeStyle = SRC.dark; g.lineWidth = .9; g.beginPath(); g.moveTo(14, 9); g.lineTo(21.5, 10.6); g.lineTo(21.5, 15.4); g.stroke();
      g.fillStyle = SRC.sand; g.fillRect(20.6, 15, 2, 3);
    },
  ];
  const DRAW = isM ? DRAW_MEHAD : DRAW_AIM;
  const CLASS = { grey: C.grey, teal: C.lens, dark: C.dark, white: "#FFFFFF", sand: C.sand || SRC.sand, olive: C.olive || SRC.olive, navy: C.navy || SRC.navy };

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
      cells.push({ i, j, col: edge ? C.dark : CLASS[c] });
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const di = Math.round((N0 - 1) / 2 - (i0 + i1) / 2), dj = Math.round((M0 - 1) / 2 - (j0 + j1) / 2);   // centred on the mark's grid
    cells.forEach(c => { c.i += di; c.j += dj; });
    cells.box = [i0 + di, j0 + dj, i1 + di, j1 + dj];
    return cells;
  }

  async function load() {
    await LOGO.load(); P = place(LOGO, CFG.width[FORMAT]);
    const w = LOGO.src.w, h = LOGO.src.h, img = LOGO.I(CFG.src);
    for (const N of LEVELS) {                                    // average colour and coverage per cell, for the refine
      const M = Math.round(N * h / w), cv = Object.assign(document.createElement("canvas"), { width: N, height: M });
      const g = cv.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, N, M);
      const d = g.getImageData(0, 0, N, M).data, cells = [];
      for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const k = (j * N + i) * 4; cells.push({ i, j, r: d[k], g: d[k + 1], b: d[k + 2], a: d[k + 3] / 255 }); }
      G.push({ N, M, cells });
    }
    ITEMS = DRAW.map(fn => buildItem(fn, ...CFG.items));
    const L0 = G[0], at = (i, j) => (i < 0 || j < 0 || i >= L0.N || j >= L0.M) ? null : L0.cells[j * L0.N + i];
    if (isM) classifyMehad(L0, img); else classifyAIM(L0);
    const body = c => c && c.body;                                // blocks get a dark edge where they meet the empty ground
    for (const c of L0.cells) {
      if (c.body && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !body(at(c.i + di, c.j + dj)))) c.col = C.dark;
      const x = CFG.dir > 0 ? c.i / L0.N : 1 - (c.i + 1) / L0.N;
      c.t = T.build[0] + (T.build[1] - T.build[0]) * (x * .72 + rnd(c.i * 131 + c.j * 7) * .28);
    }
  }
  function classifyAIM(L0) {                                     // the circles in grey, the lens teal, the letters cut out
    const { c1, c2, R } = LOGO, w = LOGO.src.w, h = LOGO.src.h;
    for (const c of L0.cells) {
      const x = (c.i + .5) / L0.N * w, y = (c.j + .5) / L0.M * h, in1 = Math.hypot(x - c1[0], y - c1[1]) < R, in2 = Math.hypot(x - c2[0], y - c2[1]) < R;
      c.body = (in1 || in2) && c.a >= .5; c.col = !c.body ? null : in1 && in2 ? C.lens : C.grey;
    }
  }
  const THREAD = .42;
  function classifyMehad(L0, img) {                              // majority colour per cell from an 8 × 8 sample
    const S = 8, N = L0.N, M = L0.M, cv = Object.assign(document.createElement("canvas"), { width: N * S, height: M * S });
    const g = cv.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, N * S, M * S);
    const d = g.getImageData(0, 0, N * S, M * S).data;
    const pal = { teal: [40, 162, 153], white: [248, 248, 248], navy: [64, 80, 104], sand: [188, 157, 106], olive: [109, 168, 125] };
    const iconX = LOGO.icon[0] / LOGO.src.w * N;
    for (const c of L0.cells) {
      const n = { none: 0, teal: 0, white: 0, navy: 0, sand: 0, olive: 0 };
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const k = ((c.j * S + y) * N * S + c.i * S + x) * 4;
        if (d[k + 3] < 128) { n.none++; continue; }
        let best = "teal", be = 1e9;
        for (const [nm, p] of Object.entries(pal)) { const e = (p[0] - d[k]) ** 2 + (p[1] - d[k + 1]) ** 2 + (p[2] - d[k + 2]) ** 2; if (e < be) { be = e; best = nm; } }
        n[best]++;
      }
      if (c.i + .5 >= iconX) {                                     // the icon: grey block, the thread as one line of pixels, counters in colour
        const acc = ["sand", "olive", "navy"].find(k => n[k] > S * S * .35);
        c.body = n.none < S * S / 2;
        c.col = !c.body ? null : n.white > S * S * THREAD ? C.thread : acc ? C[acc] : C.grey;
      } else { c.body = false; c.col = n.navy > S * S * .3 ? C.ink : null; }   // the name: navy pixels
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
  const mixBG = c => c.a > .02 ? `rgb(${[c.r, c.g, c.b].map((v, q) => Math.round(v * c.a + CFG.bg[q] * (1 - c.a)))})` : null;
  function tag(text, at = CFG.tagAt, [N, M] = [G[0].N, G[0].M]) {   // a small label, like on a prototype
    const cw = LOGO.src.w * P.L / N, ch = LOGO.src.h * P.L / M;
    ctx.font = `600 ${16 * W / 1920}px Inter, sans-serif`;
    const tw = Math.max(92 * W / 1920, ctx.measureText(text).width + 24 * W / 1920), th = 30 * W / 1920, tx = P.x + at[0] * cw, ty = P.y + at[1] * ch;
    ctx.fillStyle = C.dark; ctx.fillRect(tx, ty, tw, th); ctx.fillStyle = "#FFFFFF"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
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
      if (f < 1) grid(G[3], mixBG, t, st, 0);
      P.tr(ctx); ctx.globalAlpha = f; LOGO.drawFinal(ctx, false); ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0); return;
    }
    const lvl = t < T.refine[0] ? 0 : Math.min(3, 1 + Math.floor((t - T.refine[0]) / T.refine[1]));
    if (lvl > 0) {                                               // refining: true colours, finer each step
      grid(G[lvl], mixBG, t, st, 0);
      return;
    }
    const sh = seg(t, T.shuffle[0], T.shuffle[0] + .3) * (1 - seg(t, T.shuffle[1] - .4, T.shuffle[1]));
    const L0 = G[0], logoCol = c => (ts >= c.t ? (sh > 0 && rnd(c.i * 7 + c.j * 3 + st) < .05 ? (c.col === C.dark ? C.grey : C.dark) : c.col) : null);
    const f = flashAt(st);
    if (f) {
      const item = { N: CFG.items[0], M: CFG.items[1], cells: ITEMS[f.k] };
      const slip = (j, p) => rnd(j * 13 + st * 7) < p ? (rnd(j * 5 + st) < .5 ? -1 : 1) * (1 + Math.floor(rnd(j * 3 + st) * 2)) : 0;
      const sliced = f.ph === 0 || f.ph === FLASH_LEN - 1;
      if (sliced) {                                              // sliced: bands of rows swap between the mark and the item
        const fromItem = j => rnd(Math.floor((j + 4) / 2) * 31 + st) < .55;
        grid(L0, logoCol, t, st, 0, j => fromItem(j) ? null : slip(j, .4));
        grid(item, c => c.col, t, st, 0, j => fromItem(j) ? slip(j, .4) : null);
      } else grid(item, c => c.col, t, st, 0, j => f.ph === 1 ? slip(j, .1) : 0);
      if (!sliced) { const b = ITEMS[f.k].box; tag(`${CFG.flashTag} · 0${f.k + 1}`, [b[0] - 1, b[1] - 2], CFG.items); } else tag(CFG.tag);
      return;
    }
    grid(L0, logoCol, t, st, sh);
    // the first pixel and line
    const cw = LOGO.src.w * P.L / L0.N, ch = LOGO.src.h * P.L / L0.M;
    if (t >= .12 && t < T.build[0] + .3) { ctx.fillStyle = C.dark; ctx.fillRect(P.x + CFG.first[0] * cw, P.y + CFG.first[1] * ch, cw, ch); }
    // accent bars that jump between columns
    const bars = t >= .3 && t < T.refine[0] - .2 ? 4 : 0;
    for (let b = 0; b < bars; b++) {
      const col = 4 + Math.floor(rnd(b * 97 + Math.floor(st / 3) * 13) * (L0.N - 8));
      const grow = seg(ts, .3 + b * .2, .7 + b * .2);
      ctx.fillStyle = C.bar[b % C.bar.length]; ctx.fillRect(P.x + col * cw + cw * .3, P.y + ch * 2, cw * .4, (L0.M - 4) * ch * grow);
    }
    if (t >= .5 && t < T.shuffle[1] - .3) tag(CFG.tag);
  }

  function cues() {
    const ev = [{ type: "pop", t: .12, pan: -.4 * CFG.dir }];
    for (let s = smStep(T.build[0]); s < smStep(T.build[1]); s += 1) ev.push({ type: "type", t: s / SM_FPS, level: -28, pan: CFG.dir * lerp(-.6, .6, (s / SM_FPS - T.build[0]) / (T.build[1] - T.build[0])) });
    ev.push({ type: "glitch", t: T.shuffle[0], d: T.shuffle[1] - T.shuffle[0], pan: 0 });
    T.flash.forEach((t, k) => {                                  // each try-on item: a bright burst and a click as it lands
      const s0 = smTime(t), pan = [-.35, .3, -.15, .4, -.3][k];
      ev.push({ type: "glitch", t: s0, d: .2, pan, level: -20 });
      ev.push({ type: "pop", t: s0 + 1 / SM_FPS, pan });
      ev.push({ type: "glitch", t: s0 + (FLASH_LEN - 1) / SM_FPS, d: .1, pan: -pan, level: -25 });
    });
    for (let i = 0; i < 3; i++) ev.push({ type: "zip", t: T.refine[0] + i * T.refine[1] });
    ev.push({ type: "impact", t: T.final[0], style: isM ? "paper" : "digital" });
    return { dur: T.end, events: ev };
  }

  window.BRAND_DEF = { name: "broken-" + LOGO_NAME, load, draw, cues, blur: [] };
  TIMING.dur = T.end;
})();
