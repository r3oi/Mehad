/* Logo adapters shared by the idea stings (mash · risk · kapsul).
   Every part is cut from the official files; nothing is redrawn.
   On dark backgrounds:
     MEHAD — the icon keeps its colours, the wordmark is set in white (reversed lockup)
     AIM   — the letters are knock-outs, so a white letter plate sits under the file
             (the letters read white, exactly as on the light original) */
"use strict";
const LOGOS = {
  mehad: {
    dir: "../assets/mehad/",
    files: ["lockup_source.webp", "wordmark_ar.png", "wordmark_en.png", "icon_square.png", "icon_thread.png",
      "icon_fill_sand.png", "icon_fill_navy.png", "icon_fill_olive.png", "rough_0.png", "rough_1.png", "rough_2.png"],
    src: { w: 2000, h: 704 },
    icon: [1296, 0, 2000, 704],
    async load() {
      this.G = await (await fetch(this.dir + "geometry.json")).json();
      this.ST = await (await fetch(this.dir + "strokes.json")).json();
      await Promise.all(this.files.map(f => loadImg("mehad_" + f.split(".")[0], this.dir + f)));
      this.I = k => IMG["mehad_" + k];
      this.arW = tinted(this.I("wordmark_ar"), "#FFFFFF");
      this.enW = tinted(this.I("wordmark_en"), "#FFFFFF");
      this.threadInk = tinted(this.I("icon_thread"), "#43546A");
      // glyph slots, reading order: Arabic right→left, then MEHAD left→right
      const ar = [[872, 1150, "م"], [462, 872, "ه"], [250, 462, "ا"], [0, 250, "د"]];
      this.slots = [
        ...ar.map(([a, b, n]) => ({ id: n, group: "ar", img: "ar", box: [a, 0, b, 340] })),
        ...this.enBoxes().map((b, i) => ({ id: "MEHAD"[i], group: "en", img: "en", box: b })),
      ];
    },
    enBoxes() { return [[17, 441, 248, 704], [284, 441, 446, 704], [483, 441, 672, 704], [708, 441, 916, 704], [953, 441, 1155, 704]]; },
    layer(name, dark) {
      if (name === "ar") return dark ? this.arW : this.I("wordmark_ar");
      if (name === "en") return dark ? this.enW : this.I("wordmark_en");
      return this.I(name);
    },
    drawIcon(g) { const [a, b, c, d] = this.icon; g.drawImage(this.I("lockup_source"), a, b, c - a, d - b, a, b, c - a, d - b); },
    drawFinal(g, dark) {
      if (!dark) { g.drawImage(this.I("lockup_source"), 0, 0, this.src.w, this.src.h); return; }
      this.drawIcon(g); g.drawImage(this.arW, 0, 0, this.src.w, this.src.h); g.drawImage(this.enW, 0, 0, this.src.w, this.src.h);
    },
    drawRough(g, k) { g.drawImage(this.I("rough_" + (k % 3)), 0, 0, this.src.w, this.src.h); },
  },

  aim: {
    dir: "../assets/aim/",
    files: ["logo_source.webp", "mint_col.png", "deep_col.png", "letters.png", "rough_0.png", "rough_1.png", "rough_2.png"],
    src: { w: 2000, h: 1334 },
    async load() {
      this.G = await (await fetch(this.dir + "geometry.json")).json();
      await Promise.all(this.files.map(f => loadImg("aim_" + f.split(".")[0], this.dir + f)));
      this.I = k => IMG["aim_" + k];
      this.c1 = this.G.c1; this.c2 = this.G.c2; this.R = this.G.c1[2];
      this.CX = (this.c1[0] + this.c2[0]) / 2; this.CY = this.c1[1];
      this.slots = this.G.letters.map((b, i) => ({ id: "AIM"[i], group: "letters", img: "letters", box: b }));
    },
    layer(name) { return this.I(name); },
    // circles at any centres (the gradient is vertical, so it is exact anywhere)
    circles(g, x1, x2, y = this.CY, opts = {}) {
      const R = opts.r ?? this.R, wide = this.src.w * 3;
      const grad = col => g.drawImage(this.I(col), 0, 0, 1, this.src.h, -wide, y - this.CY, this.src.w + 2 * wide, this.src.h);
      for (const x of [x1, x2]) { if (x == null) continue; g.save(); g.beginPath(); g.arc(x, y, R, 0, 7); g.clip(); grad("mint_col"); g.restore(); }
      if (x1 != null && x2 != null) { g.save(); g.beginPath(); g.arc(x1, y, R, 0, 7); g.clip(); g.beginPath(); g.arc(x2, y, R, 0, 7); g.clip(); grad("deep_col"); g.restore(); }
    },
    drawFinal(g, dark) {
      if (dark) g.drawImage(this.I("letters"), 0, 0, this.src.w, this.src.h);
      g.drawImage(this.I("logo_source"), 0, 0, this.src.w, this.src.h);
    },
    drawRough(g, k) { g.drawImage(this.I("rough_" + (k % 3)), 0, 0, this.src.w, this.src.h); },
    /* the mark in any state, drawn through a layer so the knock-outs stay true holes.
       g must carry the source→screen transform. letters: per-letter visibility 0..1,
       dx: per-letter x offset (source px), wipe: letters cut only left of this x,
       dark: white letter plate under the holes, mono: white translucent version
       (overlap reads brighter), lens: overlap strength, r: circle radius */
    drawMark(g, o = {}) {
      const x1 = "x1" in o ? o.x1 : this.c1[0], x2 = "x2" in o ? o.x2 : this.c2[0], y = o.y ?? this.CY, r = o.r ?? this.R;
      const letters = o.letters ?? [1, 1, 1], dx = o.dx ?? [0, 0, 0], wipe = o.wipe ?? Infinity, lens = o.lens ?? 1;
      if (!this._lay) { this._lay = document.createElement("canvas"); }
      const lay = this._lay; if (lay.width !== W || lay.height !== H) { lay.width = W; lay.height = H; }
      const lg = lay.getContext("2d"); lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, W, H); lg.setTransform(g.getTransform());
      lg.imageSmoothingQuality = "high";
      if (o.mono) {
        lg.fillStyle = "#FFFFFF"; lg.globalAlpha = .74;
        for (const x of [x1, x2]) if (x != null) { lg.beginPath(); lg.arc(x, y, r, 0, 7); lg.fill(); }
        lg.globalAlpha = 1;
      } else {
        this.circles(lg, x1, null, y, { r }); this.circles(lg, null, x2, y, { r });
        if (x1 != null && x2 != null && lens > 0) {
          lg.save(); lg.globalAlpha = lens; lg.beginPath(); lg.arc(x1, y, r, 0, 7); lg.clip(); lg.beginPath(); lg.arc(x2, y, r, 0, 7); lg.clip();
          lg.drawImage(this.I("deep_col"), 0, 0, 1, this.src.h, -this.src.w * 3, y - this.CY, this.src.w * 7, this.src.h); lg.restore();
        }
      }
      const cut = (cg, i, op) => {
        const a = letters[i]; if (a <= 0) return;
        const [b0, b1, b2, b3] = this.G.letters[i];
        cg.save(); cg.beginPath(); cg.rect(-1e5, -1e5, Math.min(wipe, 1e5) + 1e5, 2e5); cg.clip();
        cg.translate(dx[i], 0); cg.beginPath(); cg.rect(b0 - 3, b1 - 3, b2 - b0 + 6, b3 - b1 + 6); cg.clip();
        cg.globalAlpha = a * (op ? 1 : (o.alpha ?? 1)); if (op) cg.globalCompositeOperation = op;
        cg.drawImage(this.I("letters"), 0, 0, this.src.w, this.src.h); cg.restore();
      };
      for (let i = 0; i < 3; i++) cut(lg, i, "destination-out");
      if (o.dark) for (let i = 0; i < 3; i++) cut(g, i);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha *= o.alpha ?? 1; g.drawImage(lay, 0, 0); g.restore();
    },
  },
};

/* place a logo: width in px → scale & offset, centred (optionally shifted) */
function place(logo, width, cx = W / 2, cy = H / 2) {
  const L = width / logo.src.w;
  return { L, x: cx - logo.src.w * L / 2, y: cy - logo.src.h * L / 2, tr(g, k = 1, ox = W / 2, oy = H / 2) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.translate(ox, oy); g.scale(k, k); g.translate(-ox, -oy);
    this.apply(g);
  }, apply(g) { g.translate(this.x, this.y); g.scale(this.L, this.L); } };
}
