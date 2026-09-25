/* خيطٌ واحد — Mehad launch film, first cut engine.
   Deterministic: renderAt(t) draws the frame for time t (seconds) onto #cv.
   Timings follow the storyboard artifact (20 shots, 89.5s). */
"use strict";
const W = 1920, H = 1080, FPS = 25, DUR = 89.5;
const COL = {
  night: "#07161B", night2: "#0A1D22", panel: "#0C2127",
  teal: "#17A59B", teal2: "#2BD4C5", gold: "#C9A876", gold2: "#E8D5AB",
  green: "#008849", deep: "#002528", deep2: "#003439", navy: "#365268",
  logoNavy: "#44546B", olive: "#6BA77B", ice: "#EEF5F3", muted: "#88A5A0"
};
const cv = document.getElementById("cv");
let ctx = cv.getContext("2d");
const IMG = {};
let STR = null;            // logo strands (wordmark coords)
const SHOW_TAGS = !/notags/.test(location.search);

/* ---------------- math ---------------- */
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const eo = t => 1 - Math.pow(1 - t, 3);
const ei = t => t * t * t;
const ss = t => t * t * (3 - 2 * t);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hex(c, a = 1) { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function mixHex(c1, c2, t) { const a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16); const m = s => Math.round(lerp(a >> s & 255, b >> s & 255, t)); return `rgb(${m(16)},${m(8)},${m(0)})`; }

/* ---------------- paths ---------------- */
function mkPath(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, L: cum[cum.length - 1] }; }
function idxAt(P, s) { let lo = 0, hi = P.cum.length - 1; while (lo < hi - 1) { const m = (lo + hi) >> 1; if (P.cum[m] <= s) lo = m; else hi = m; } return lo; }
function ptAt(P, s) { s = clamp(s, 0, P.L); const i = idxAt(P, s); const j = Math.min(i + 1, P.pts.length - 1); const d = P.cum[j] - P.cum[i] || 1; const f = (s - P.cum[i]) / d; return [lerp(P.pts[i][0], P.pts[j][0], f), lerp(P.pts[i][1], P.pts[j][1], f)]; }
function sub(P, a, b) { a = clamp(a, 0, P.L); b = clamp(b, 0, P.L); if (b - a < .5) return []; const out = [ptAt(P, a)]; for (let k = idxAt(P, a) + 1; k < P.pts.length && P.cum[k] < b; k++) out.push(P.pts[k]); out.push(ptAt(P, b)); return out; }
function subU(P, u0, u1) { return sub(P, u0 * P.L, u1 * P.L); }
function resample(pts, n) { const P = mkPath(pts); const o = []; for (let i = 0; i < n; i++) o.push(ptAt(P, P.L * i / (n - 1))); return o; }
function bez(p0, p1, p2, p3, n = 60) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; o.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } return o; }

/* ---------------- drawing helpers ---------------- */
function fill(c) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
function line(pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function thread(pts, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = o.w ?? 6, a = o.alpha ?? 1, g = o.glow ?? 1;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; line(pts);
  if (g > 0) {
    ctx.globalCompositeOperation = o.glowOp || "lighter";
    ctx.shadowColor = hex(COL.teal, .9 * a * g); ctx.shadowBlur = w * 5;
    ctx.strokeStyle = hex(COL.teal, .45 * a * g); ctx.lineWidth = w * 2.2; ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalCompositeOperation = "source-over";
  }
  ctx.strokeStyle = o.color || hex(COL.teal2, a); ctx.lineWidth = w; ctx.stroke();
  if (o.core !== false) { ctx.strokeStyle = o.coreColor || `rgba(226,255,251,${.7 * a})`; ctx.lineWidth = Math.max(1, w * .34); ctx.stroke(); }
  if (o.head) { const [x, y] = pts[pts.length - 1]; glowDot(x, y, w * (o.headR ?? 5), a * (o.headA ?? .9)); }
  ctx.restore();
}
function glowDot(x, y, r, a = 1, c = COL.teal2) {
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(235,255,252,${a})`); g.addColorStop(.18, hex(c, .85 * a)); g.addColorStop(.5, hex(COL.teal, .22 * a)); g.addColorStop(1, hex(COL.teal, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore();
}
function txt(s, x, y, o = {}) {
  ctx.save(); ctx.font = o.font || "400 40px Cairo"; ctx.fillStyle = o.color || COL.ice; ctx.globalAlpha = o.alpha ?? 1;
  ctx.textAlign = o.align || "center"; ctx.textBaseline = o.base || "middle"; ctx.direction = o.dir || "rtl";
  if (o.ls) ctx.letterSpacing = o.ls;
  if (o.blur) ctx.filter = `blur(${o.blur}px)`;
  ctx.fillText(s, x, y); ctx.restore();
}
function tag(s, light = false) {
  if (!SHOW_TAGS) return;
  ctx.save(); ctx.font = "500 21px Cairo"; ctx.direction = "rtl"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const w = ctx.measureText(s).width + 36;
  ctx.fillStyle = light ? "rgba(54,82,104,.10)" : "rgba(0,0,0,.45)"; rr(1880 - w, 1012, w, 40, 20); ctx.fill();
  ctx.strokeStyle = light ? "rgba(54,82,104,.35)" : "rgba(230,184,114,.55)"; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = light ? "#365268" : "#E6B872"; ctx.fillText(s, 1862, 1033); ctx.restore();
}
function cover(img, x, y, w, h, o = {}) {
  const ir = img.width / img.height, r = w / h; let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) * (o.ax ?? .5); sy = 0; } else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) * (o.ay ?? .5); }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
const memo = {};
function fx(key, img, filter, scale = 1) {
  if (memo[key]) return memo[key];
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext("2d"); g.filter = filter; g.drawImage(img, 0, 0, c.width, c.height); memo[key] = c; return c;
}
function vignette(a = .55, light = false) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, light ? `rgba(54,82,104,${a * .25})` : `rgba(0,0,0,${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
let GRAIN = [];
function mkGrain() {
  const r = rng(7);
  for (let k = 0; k < 8; k++) {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360; const g = c.getContext("2d"); const d = g.createImageData(640, 360);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 90; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); GRAIN.push(c);
  }
}
function grain(t, a = .1) {
  const f = Math.floor(t * FPS) % GRAIN.length;
  ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = a; ctx.drawImage(GRAIN[f], 0, 0, W, H);
  ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = a * .18; ctx.drawImage(GRAIN[(f + 3) % GRAIN.length], 0, 0, W, H); ctx.restore();
}
/* device mockups with a real UI screenshot */
function device(kind, img, x, y, w, o = {}) {
  ctx.save();
  if (o.skew) ctx.transform(1, o.skew[1] || 0, o.skew[0] || 0, 1, 0, 0);
  const a = o.alpha ?? 1; ctx.globalAlpha = a;
  if (kind === "laptop") {
    const h = w * .62; ctx.fillStyle = "#15191c"; rr(x, y, w, h, 18); ctx.fill();
    ctx.save(); rr(x + 16, y + 16, w - 32, h - 32, 6); ctx.clip(); cover(img, x + 16, y + 16, w - 32, h - 32, { ay: 0 }); if (o.dim) { ctx.fillStyle = `rgba(0,0,0,${o.dim})`; ctx.fillRect(x, y, w, h); } ctx.restore();
    ctx.fillStyle = "#23292e"; ctx.beginPath(); ctx.moveTo(x - w * .06, y + h + 22); ctx.lineTo(x + w * 1.06, y + h + 22); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  } else if (kind === "tablet") {
    const h = w * .72; ctx.fillStyle = "#101316"; rr(x, y, w, h, 28); ctx.fill();
    ctx.save(); rr(x + 22, y + 22, w - 44, h - 44, 10); ctx.clip(); cover(img, x + 22, y + 22, w - 44, h - 44, { ay: 0 }); if (o.dim) { ctx.fillStyle = `rgba(0,0,0,${o.dim})`; ctx.fillRect(x, y, w, h); } ctx.restore();
  } else if (kind === "phone") {
    const h = w * 2.05; ctx.fillStyle = "#0e1114"; rr(x, y, w, h, 44); ctx.fill();
    ctx.save(); rr(x + 14, y + 14, w - 28, h - 28, 32); ctx.clip(); ctx.fillStyle = "#fff"; ctx.fillRect(x, y, w, h); cover(img, x + 14, y + 60, w - 28, (w - 28) * img.height / img.width, { ay: 0 }); if (o.dim) { ctx.fillStyle = `rgba(0,0,0,${o.dim})`; ctx.fillRect(x, y, w, h); } ctx.restore();
  } else { // monitor
    const h = w * .58; ctx.fillStyle = "#101316"; rr(x, y, w, h, 12); ctx.fill();
    ctx.save(); rr(x + 12, y + 12, w - 24, h - 24, 4); ctx.clip(); cover(img, x + 12, y + 12, w - 24, h - 24, { ay: 0 }); if (o.dim) { ctx.fillStyle = `rgba(0,0,0,${o.dim})`; ctx.fillRect(x, y, w, h); } ctx.restore();
  }
  ctx.restore();
}
function codeBars(x, y, w, rows, t, o = {}) {
  const r = rng(o.seed || 3); const cols = [COL.teal2, COL.gold, "#7FA7C9", COL.olive, "#9FB3B0"]; const lh = o.lh || 30;
  ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
  for (let i = 0; i < rows; i++) {
    let cx = x + 40 + Math.floor(r() * 4) * 36; const yy = y + i * lh - ((o.scroll || 0) % lh);
    const n = 1 + Math.floor(r() * 5);
    for (let k = 0; k < n && cx < x + w; k++) { const bw = 30 + r() * 150; ctx.fillStyle = hex(cols[Math.floor(r() * cols.length)], .75); rr(cx, yy, bw, lh * .42, 4); ctx.fill(); cx += bw + 14; }
    ctx.fillStyle = "rgba(136,165,160,.35)"; ctx.fillRect(x + 6, yy + 2, 18, lh * .3);
  }
  ctx.restore();
}

/* ---------------- lockup geometry ---------------- */
const LK = 1.3, LW = 900 * LK, LH = 317 * LK, LX = 960 - LW / 2, LY = 470 - LH / 2;
const TL = p => [LX + p[0] * LK, LY + p[1] * LK];         // wordmark → screen (final lockup)
const KC = [297, 64], KS = 3.6;                              // knot centre / scale for S06
const T6 = p => [960 + (p[0] - KC[0]) * KS, 540 + (p[1] - KC[1]) * KS];
let P = {};                                                  // prepared paths

function drawLockup(o = {}) {
  // o.white: reversed, o.alpha, o.scale, o.cx, o.cy, o.parts
  const s = o.scale ?? 1, a = o.alpha ?? 1;
  ctx.save(); ctx.globalAlpha = a;
  const cx = o.cx ?? 960, cy = o.cy ?? 470;
  ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-960, -470);
  const parts = o.parts || { word: 1, text: 1, icon: 1 };
  if (parts.word) { ctx.globalAlpha = a * parts.word; ctx.drawImage(o.white ? IMG.wordmark_white : IMG.wordmark, LX, LY, 560 * LK, 160 * LK); }
  if (parts.text) { ctx.globalAlpha = a * parts.text; ctx.drawImage(o.white ? IMG.mehadtext_white : IMG.mehadtext, LX, LY + 170 * LK, 560 * LK, 147 * LK); }
  if (parts.icon) { ctx.globalAlpha = a * parts.icon; ctx.drawImage(IMG.icon, LX + 575 * LK, LY, 325 * LK, 317 * LK); }
  ctx.restore();
}

/* ---------------- textile (Sadu-like weave) ---------------- */
const CELL = 40;
const SPR = {};
function mkSprites() {
  const defs = { base: "#0C3A33", base2: "#0A332D", band: "#008849", band2: "#0F9E58", light: "#3FB27A", deep: "#062A27", teal: "#2BD4C5", teal2: "#17A59B", gold: "#C9A876", warp: "#0B7A45" };
  const r = rng(11);
  for (const k in defs) for (const dir of ["h", "v"]) {
    const c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d");
    g.fillStyle = "#020c0b"; g.fillRect(0, 0, 40, 40);
    const grd = dir === "h" ? g.createLinearGradient(0, 3, 0, 37) : g.createLinearGradient(3, 0, 37, 0);
    grd.addColorStop(0, mixHex(defs[k], "#000000", .35)); grd.addColorStop(.45, mixHex(defs[k], "#ffffff", .10)); grd.addColorStop(1, mixHex(defs[k], "#000000", .45));
    g.fillStyle = grd; g.beginPath(); g.roundRect(2, 2, 36, 36, 9); g.fill();
    g.globalAlpha = .22; g.strokeStyle = "#fff"; g.lineWidth = .8;
    for (let i = 0; i < 9; i++) { const o = 5 + i * 3.6 + r() * 1.5; g.beginPath(); if (dir === "h") { g.moveTo(5, o); g.bezierCurveTo(15, o + r() * 2 - 1, 25, o + r() * 2 - 1, 35, o); } else { g.moveTo(o, 5); g.bezierCurveTo(o + r() * 2 - 1, 15, o + r() * 2 - 1, 25, o, 35); } g.stroke(); }
    SPR[k + dir] = c;
  }
}
const D96 = ["01110 10001 10001 01111 00001 00010 01100", "00110 01000 10000 11110 10001 10001 01110"].map(s => s.split(" "));
function in96(i, j) { // i: 0..10 from left, j 0..6
  if (j < 0 || j > 6) return false;
  if (i >= 0 && i <= 4) return D96[0][j][i] === "1";
  if (i >= 6 && i <= 10) return D96[1][j][i - 6] === "1";
  return false;
}
function cellKind(i, j) { // textile outside the 96 window; (i,j) relative to window origin
  const rj = ((j % 18) + 18) % 18;
  const band = rj === 11 || rj === 12 || rj === 13;
  if (band) { const step = ((i % 6) + 6) % 6; if (rj === 12) return "band"; if (rj === 11) return step < 3 ? "band2" : "base"; return step >= 3 ? "band2" : "base"; }
  if (rj === 10 || rj === 14) return ((i % 2) + 2) % 2 ? "deep" : "base2";
  return ((i + j) % 7 === 0) ? "base2" : "base";
}
/* draws textile; view: scale s, centre of 96 window at screen (cx,cy); weave(i,j) -> {kind|null} for window cells */
function drawTextile(s, cx, cy, windowFn, o = {}) {
  const c = CELL * s; const ox = cx - 5.5 * c, oy = cy - 3.5 * c; // window cell (0,0) top-left
  const i0 = Math.floor(-ox / c) - 1, i1 = Math.ceil((W - ox) / c) + 1, j0 = Math.floor(-oy / c) - 1, j1 = Math.ceil((H - oy) / c) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = ox + i * c, y = oy + j * c; const inWin = i >= -1 && i <= 11 && j >= -1 && j <= 7;
    let k;
    if (inWin && windowFn) { k = windowFn(i, j); if (k === null) continue; }
    else k = cellKind(i, j + 3);
    const dir = ((i + j) & 1) ? "h" : "v";
    ctx.drawImage(SPR[k + dir], x, y, c + .5, c + .5);
  }
  if (o.light !== false) { // raking side light
    const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(.55, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(255,236,200,.06)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

/* ================= SCENES ================= */
/* S01 · 0–4.5 نقطة */
function s01(t) {
  fill("#020607");
  const ig = seg(t, 1.0, 1.35);
  if (ig <= 0) return;
  const push = 1 + .03 * eio(seg(t, 3.9, 4.5));
  const breath = 1 + .05 * Math.sin((t - 1) * 2.1);
  const mv = eio(seg(t, 4.05, 4.5));
  const x = 960 - mv * 260, y = 540;
  if (mv > 0) thread([[960, 540], [x, 540 + Math.sin(mv * 3) * 4]], { w: 3.2 * push, alpha: ig });
  glowDot(x, y, 70 * breath * push * (0.6 + .4 * eo(ig)), ig);
  glowDot(x, y, 16 * breath * push, ig);
  // dust
  const r = rng(5); ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 40; i++) { const dx = r() * W, dy = r() * H, sp = r() * 8; const px = (dx + t * sp) % W, py = (dy - t * sp * .6 + H) % H; const d = Math.hypot(px - x, py - y); const a = ig * clamp(1 - d / 700) * .35 * r(); ctx.fillStyle = hex(COL.teal2, a); ctx.beginPath(); ctx.arc(px, py, 1 + r() * 1.6, 0, 7); ctx.fill(); }
  ctx.restore();
}

/* S02 · 4.5–8.5 أول الخيط — montage (placeholder plates for real materials) */
function s02(t) {
  const lt = t - 4.5, k = Math.min(6, Math.floor(lt / (4 / 7))), pl = lt - k * (4 / 7);
  const plates = [plPaper, plMeeting, plBoard, plSite, plIcons, plCode, plClick];
  plates[k](pl, lt);
  // the continuous thread passes right→left across every plate
  const hx = lerp(1700, 250, (pl / (4 / 7))) ;
  const pts = []; for (let x = 2000; x >= hx; x -= 12) pts.push([x, 560 + Math.sin(x / 140 + k) * 10]);
  if (k !== 0 && k !== 6) thread(pts, { w: 4, head: true, headR: 4 });
  vignette(.6);
  tag("مؤقت · S02 · تُستبدل بموادكم الحقيقية (المحضر، التصميم، الكود)");
}
function plPaper(p) {
  fill("#1a140c");
  const g = ctx.createRadialGradient(1500, 300, 50, 1300, 500, 1300); g.addColorStop(0, "#d8cdb6"); g.addColorStop(.5, "#8d826d"); g.addColorStop(1, "#1d1810");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(GRAIN[2], 0, 0, W, H); ctx.globalAlpha = 1; fill("rgba(40,30,15,.35)");
  const hx = lerp(1500, 520, eio(p / (4 / 7)));
  const pts = []; for (let x = 1750; x >= hx; x -= 8) pts.push([x, 580 + Math.sin(x / 90) * 6]);
  ctx.save(); ctx.strokeStyle = "rgba(20,30,34,.85)"; ctx.lineWidth = 4; ctx.lineCap = "round"; line(pts); ctx.stroke(); ctx.restore();
  thread(pts, { w: 2, alpha: .45, core: false });
  // pen nib
  ctx.save(); ctx.translate(hx, 580 + Math.sin(hx / 90) * 6); ctx.rotate(-.75);
  ctx.fillStyle = "#101518"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(260, -26); ctx.lineTo(260, 26); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#C9A876"; ctx.fillRect(240, -26, 40, 52); ctx.restore();
}
function plMeeting(p) {
  fill("#0b1316");
  ctx.save(); ctx.translate(960, 560); ctx.rotate(-.06); ctx.fillStyle = "#e9e6de"; ctx.fillRect(-520, -380, 1040, 900);
  txt("اجتماع رقم 1", 380, -250, { font: "700 64px Cairo", color: "#243446", align: "right" });
  ctx.filter = "blur(7px)"; ctx.fillStyle = "#9aa3a8";
  for (let i = 0; i < 9; i++) ctx.fillRect(-420 + (i % 3) * 30, -140 + i * 62, 760 - (i % 4) * 90, 16);
  ctx.restore();
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(0,0,0,.2)"); g.addColorStop(1, "rgba(0,0,0,.55)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function plBoard(p) {
  fill("#1b1f23"); ctx.fillStyle = "#24292e"; ctx.fillRect(0, 0, W, 70); ctx.fillRect(0, 70, 90, H);
  ctx.fillStyle = "#f4f6f5"; ctx.fillRect(420, 190, 1080, 700);
  ctx.fillStyle = "rgba(54,82,104,.25)"; for (let x = 440; x < 1500; x += 40) for (let y = 210; y < 890; y += 40) ctx.fillRect(x, y, 2, 2);
  ctx.strokeStyle = COL.teal; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.strokeRect(420, 190, 1080, 700); ctx.setLineDash([]);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = "#3a4148"; rr(20, 110 + i * 70, 50, 50, 10); ctx.fill(); }
}
function plSite(p) {
  fill("#0d1215");
  ctx.save(); ctx.filter = "blur(2px)";
  ctx.fillStyle = "#f7f9f8"; ctx.fillRect(260, 120, 1400, 860); ctx.fillStyle = "#e3ecea"; ctx.fillRect(260, 120, 1400, 80);
  ctx.fillStyle = COL.teal; rr(1480, 140, 150, 40, 20); ctx.fill();
  ctx.fillStyle = "#cfe3df"; ctx.fillRect(300, 240, 1320, 330);
  ctx.fillStyle = "#365268"; ctx.fillRect(1120, 320, 460, 34); ctx.fillRect(1220, 380, 360, 22);
  ctx.fillStyle = COL.gold; rr(1400, 450, 180, 56, 28); ctx.fill();
  for (let i = 0; i < 3; i++) { ctx.fillStyle = "#e9eeed"; rr(300 + i * 450, 620, 410, 300, 16); ctx.fill(); }
  ctx.restore();
  txt("😀", 520, 400, { font: "90px 'Noto Color Emoji'", alpha: .8 });
}
function plIcons(p) {
  fill("#0b1a1d"); const cols = [COL.teal, COL.olive, COL.gold, COL.navy]; const z = 1 + .05 * p;
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) {
    const x = 330 + i * 270, y = 170 + j * 270; ctx.fillStyle = hex(cols[(i + j) % 4], .9); rr(x, y, 200, 200, 48); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(x + 100, y + 100, 44 + ((i * 7 + j) % 3) * 8, .4 + i, 5.2 + i); ctx.stroke();
  }
  ctx.restore();
}
function plCode(p, lt) { fill("#081114"); codeBars(80, 120, 1760, 30, lt, { seed: 9, scroll: p * 120, lh: 32 }); }
function plClick(p) {
  fill("#081114"); codeBars(80, 120, 1760, 30, 0, { seed: 12, alpha: .18 });
  const x = 960, y = 540; const cl = seg(p, .12, .2);
  // cursor
  ctx.save(); ctx.translate(x + 6, y + 6); ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 46); ctx.lineTo(12, 35); ctx.lineTo(22, 56); ctx.lineTo(30, 52); ctx.lineTo(20, 32); ctx.lineTo(36, 32); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  // three rings released
  const rp = seg(p, .2, .57);
  if (cl > 0) for (let i = 0; i < 3; i++) { const q = clamp(rp * 1.3 - i * .15); if (q <= 0) continue; ctx.save(); ctx.strokeStyle = hex(COL.teal2, (1 - q) * .9 + .1); ctx.lineWidth = 3; ctx.shadowColor = COL.teal2; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(x + (i - 1) * 40 * q, y, 10 + q * 120, 0, 7); ctx.stroke(); ctx.restore(); }
}

/* S03 · 8.5–13 أقرب · أسهل · أوسع */
const YB = 610; // shared baseline of the three loops
function loopPath(cx, r) { // travelling left along the baseline, the line makes one full loop above it
  const pts = [], cy = YB - r;
  for (let a = Math.PI / 2; a <= Math.PI / 2 + Math.PI * 2 + 1e-6; a += .04) pts.push([cx + Math.cos(a) * r - (a - Math.PI / 2) * r * .06, cy + Math.sin(a) * r]);
  return pts;
}
function s03(t) {
  fill(COL.night);
  const specs = [
    { cx: 1380, r: 105, w: "أقرب", a: 9.6, b: 10.6, wt: 10.75, col: COL.teal2 },
    { cx: 960, r: 125, w: "أسهل", a: 10.4, b: 11.35, wt: 11.35, col: COL.olive },
    { cx: 540, r: 150, w: "أوسع", a: 11.15, b: 12.1, wt: 11.95, col: COL.gold }
  ];
  const all = []; all.push([2000, YB]);
  specs.forEach((s, i) => all.push(...loopPath(s.cx, s.r * (i === 2 ? lerp(.8, 1, eo(seg(t, 11.6, 12.6))) : 1))));
  all.push([-100, YB]);
  const PP = mkPath(all);
  // the head reaches the end of each loop as its word is spoken
  const ends = [0]; let acc = Math.hypot(2000 - specs[0].cx, 0);
  specs.forEach((s, i) => { const lp = mkPath(loopPath(s.cx, s.r)); acc += lp.L; ends.push(acc); if (i < 2) acc += Math.abs(s.cx - specs[i + 1].cx) - s.r * .38; });
  const keys = [[9.0, 0], [10.7, ends[1]], [11.4, ends[2]], [12.15, ends[3]], [12.5, PP.L]];
  let hs = PP.L; for (let k = 0; k < keys.length - 1; k++) if (t < keys[k + 1][0]) { hs = lerp(keys[k][1], keys[k + 1][1], ss(seg(t, keys[k][0], keys[k + 1][0]))); break; }
  const u = t < 9.0 ? 0 : clamp(hs / PP.L);
  const blur = seg(t, 12.45, 13.0);
  ctx.save(); if (blur > 0) ctx.filter = `blur(${blur * 18}px)`; ctx.globalAlpha = 1 - blur * .6;
  thread(subU(PP, 0, u), { w: 4, head: u < 1 });
  specs.forEach(s => { const q = seg(t, s.wt, s.wt + .35) * (1 - seg(t, 12.4, 12.8)); if (q > 0) { glowDot(s.cx, YB - s.r, s.r * 1.3, .1 * q, s.col); txt(s.w, s.cx - s.r * .2, YB + 80, { font: "300 60px Cairo", color: COL.ice, alpha: q }); } });
  ctx.restore();
  vignette(.6);
}

/* S04 · 13–17.5 ليالي العمل (placeholder for the AI office clip) */
function s04(t) {
  const lt = t - 13, z = 1 + .05 * eio(clamp(lt / 4.5));
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  fill("#081419");
  // window + blurred city bokeh
  ctx.fillStyle = "#0b1d26"; ctx.fillRect(120, 80, 1680, 520);
  const r = rng(21); ctx.save(); ctx.filter = "blur(10px)"; ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i++) { const x = 140 + r() * 1640, y = 250 + r() * 330, rad = 8 + r() * 30; ctx.fillStyle = r() < .6 ? hex("#E8B872", .18 + r() * .25) : hex(COL.teal2, .12 + r() * .2); ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); }
  ctx.restore();
  // desk + screens (solid glows)
  ctx.fillStyle = "#0a0f12"; ctx.fillRect(0, 700, W, 380);
  [[330, 430, 420], [800, 400, 460], [1310, 440, 400]].forEach(([x, y, w]) => { ctx.save(); ctx.shadowColor = COL.teal; ctx.shadowBlur = 80; ctx.fillStyle = "#0f2a2d"; rr(x, y, w, w * .56, 8); ctx.fill(); ctx.restore(); ctx.fillStyle = "rgba(43,212,197,.10)"; rr(x + 10, y + 10, w - 20, w * .56 - 20, 4); ctx.fill(); });
  // silhouettes (over the shoulder)
  ctx.fillStyle = "#04080a";
  [[520, 820, 150], [1000, 860, 170], [1480, 830, 150]].forEach(([x, y, s]) => { ctx.beginPath(); ctx.ellipse(x, y - s * 1.05, s * .42, s * .5, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(x, y + s * .7, s * 1.1, s * .95, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(x - s * 1.1, y + s * .7, s * 2.2, 400); });
  // warm lamps
  [[180, 690], [1760, 700]].forEach(([x, y]) => { const g = ctx.createRadialGradient(x, y, 0, x, y, 420); g.addColorStop(0, "rgba(255,196,120,.35)"); g.addColorStop(1, "rgba(255,196,120,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); });
  ctx.restore();
  // thread crossing behind, lightly
  const pts = []; for (let x = 2000; x >= -80; x -= 16) pts.push([x, 300 + Math.sin(x / 260 + 1) * 40]);
  const u = eio(seg(t, 13.1, 17.3)); thread(subU(mkPath(pts), 0, u), { w: 3, alpha: .55, head: true, headR: 4 });
  // dissolve in from S03 bokeh
  vignette(.7);
  tag("مؤقت · S04 · لقطة الفريق ليلًا — AI جاهزة في Higgsfield");
}

/* S05 · 17.5–21.5 اشتغلنا · جرّبنا · غلطنا · عدّلنا */
function s05(t) {
  const lt = t - 17.5, b = Math.min(3, Math.floor(lt));
  fill("#081114");
  if (b === 0) { codeBars(100, 60, 1720, 34, lt, { seed: 31, scroll: lt * 260, lh: 32 }); const g = ctx.createLinearGradient(0, 700, 0, H); g.addColorStop(0, "rgba(23,165,155,0)"); g.addColorStop(1, "rgba(23,165,155,.25)"); ctx.fillStyle = g; ctx.fillRect(0, 700, W, 380); }
  if (b === 1) { device("monitor", IMG["ui-request-tutor"], 400, 150, 1120, { skew: [-.08, .03] }); const q = lt - 1; const cx = 820 + q * 300, cy = 520 + Math.sin(q * 6) * 30; ctx.save(); ctx.strokeStyle = hex(COL.teal2, .9); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, 26 + (q * 8 % 1) * 20, 0, 7); ctx.stroke(); ctx.restore(); }
  if (b === 2) { ctx.save(); ctx.filter = "blur(14px) grayscale(.7) brightness(.7)"; device("monitor", IMG["ui-conflict"], 420, 150, 1080, { skew: [.06, -.02] }); ctx.restore(); fill("rgba(20,40,60,.25)"); }
  if (b === 3) {
    const q = eio(seg(lt, 3.05, 3.8)); const wx = lerp(1640, 280, q);
    ctx.save(); ctx.filter = "blur(1.5px)"; ctx.fillStyle = "#f2f4f3"; ctx.fillRect(280, 150, 1360, 780); ctx.fillStyle = "#d9e3e1"; for (let i = 0; i < 6; i++) ctx.fillRect(330, 220 + i * 110, 1260, 60); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(wx, 0, W, H); ctx.clip(); ctx.fillStyle = "#fff"; ctx.fillRect(280, 150, 1360, 780); cover(IMG["ui-request-tutor"], 280, 150, 1360, 780, { ay: 0 }); ctx.restore();
    const curl = seg(lt, 3.6, 4.0);
    const pts = [[wx, 120], [wx, 960]];
    if (curl > 0) { const cx = wx, cy = 540; const L = []; for (let y = 120; y <= 960; y += 10) { const d = 1 - Math.abs(y - cy) / 420; L.push([cx + Math.sin((y - cy) / 40) * 60 * curl * clamp(d), y]); } thread(L, { w: 4 }); }
    else thread(pts, { w: 4 });
  }
  vignette(.65);
  tag("مؤقت · S05 · تسجيلات الشاشة الحقيقية (BUGs + النسخة الأولى)");
}

/* S06 · 21.5–26 العقدة */
function knotLead() { // lead-in from right edge into the knot start
  const k0 = T6(STR.knot.pts[0]);
  return bez([2020, 820], [1700, 840], [1300, 760], k0, 50);
}
function s06(t) {
  fill("#050d10");
  ctx.save(); ctx.globalAlpha = .55; const bg = fx("conflictCold", IMG["ui-conflict"], "blur(22px) grayscale(.75) brightness(.55)", .5); cover(bg, 0, 0, W, H); ctx.restore();
  fill("rgba(5,13,16,.35)");
  const draw = eio(seg(t, 21.5, 23.7));
  const tension = eio(seg(t, 23.5, 24.5));
  const rew = ei(seg(t, 24.75, 25.5));
  const u = draw * (1 - rew);
  const z = (1 - .035 * tension) * (1 - .1 * eio(seg(t, 24.75, 25.6)));
  ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  const PP = P.knot6;
  const jit = tension * (1 - rew) * 1.2;
  if (u > 0) {
    if (rew > 0) { ctx.save(); ctx.globalAlpha = .35; ctx.translate(-10 * rew, 0); thread(subU(PP, 0, u), { w: 9, glow: .4, core: false }); ctx.restore(); }
    thread(subU(PP, 0, u), { w: 9 + tension * 2, head: draw < 1 || rew > 0, glow: 1 - .4 * tension, color: mixHex(COL.teal2, "#7E9C99", tension * .45) });
    if (jit > 0) { ctx.save(); ctx.translate(Math.sin(t * 90) * jit, Math.cos(t * 70) * jit); ctx.globalAlpha = .25; thread(subU(PP, 0, u), { w: 9, glow: 0, core: false }); ctx.restore(); }
  }
  ctx.restore();
  // one cold light on the knot
  const g = ctx.createRadialGradient(960, 520, 0, 960, 520, 700); g.addColorStop(0, "rgba(120,160,170,.06)"); g.addColorStop(1, "rgba(0,0,0,.55)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (rew > 0 && rew < 1) { ctx.save(); ctx.globalAlpha = .08 * Math.sin(rew * Math.PI); for (let y = 0; y < H; y += 6) { ctx.fillStyle = "#9fd"; ctx.fillRect(0, y, W, 1); } ctx.restore(); }
  tag("S06 · خلفها شاشة «Conflict Detected» الحقيقية خارج التركيز");
}

/* S07 · 26–30 سبب نكمل */
function s07(t) {
  fill("#07141a");
  const warm = seg(t, 26.4, 28.5);
  const g = ctx.createRadialGradient(1900, 380, 0, 1900, 380, 1300); g.addColorStop(0, `rgba(232,196,140,${.28 * warm})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const ui = seg(t, 27.7, 28.2);
  if (ui > 0) { device("monitor", IMG["ui-booking-success"], 560, 170, 800, { skew: [-.05, .02], alpha: ui }); }
  // knot → straight thread
  const pull = eio(seg(t, 26.3, 27.6)), fade = seg(t, 27.7, 28.1);
  if (fade < 1) {
    const K = P.knot6, n = 220; const pts = [];
    for (let i = 0; i < n; i++) { const u = i / (n - 1); const a = ptAt(K, u * K.L); const b = [lerp(1880, 60, u), 540]; pts.push([lerp(a[0], b[0], pull), lerp(a[1], b[1], pull)]); }
    const grow = eo(seg(t, 26.0, 26.3));
    thread(subU(mkPath(pts), 0, grow), { w: 9 - pull * 4, alpha: 1 - fade, glow: 1 + pull * .8, head: pull > .9 });
  }
  // check mark lands on the success screen
  const ck = eio(seg(t, 28.05, 28.65));
  if (ck > 0) { const c = mkPath([[820, 470], [920, 570], [1120, 360]]); thread(subU(c, 0, ck), { w: 10, head: ck < 1 }); }
  const out = seg(t, 29.4, 30); if (out > 0) { ctx.save(); ctx.strokeStyle = hex(COL.teal2, out); ctx.lineWidth = 2; for (let i = 0; i < 8; i++) { const y = 230 + i * 70; ctx.beginPath(); ctx.moveTo(560 - out * 560, y); ctx.lineTo(1360 + out * 560, y); ctx.stroke(); } ctx.restore(); }
  vignette(.6);
  if (t < 27.8) tag("مؤقت · S07 · لقطة اليدين والخيط — AI جاهزة في Higgsfield");
}

/* S08 · 30–33 من الواجهة إلى النسيج */
function s08(t) {
  fill("#03100f");
  const lt = t - 30;
  const woven = eio(seg(lt, .9, 2.2));
  const s = lerp(2.4, 1.0, eio(seg(lt, .4, 3.0)));
  if (woven > 0) {
    ctx.save(); ctx.globalAlpha = woven;
    drawTextile(s, 960, 540, (i, j) => { const inside = i >= 0 && i <= 10 && j >= 0 && j <= 6; if (inside) return null; return cellKind(i, j + 3); });
    ctx.restore();
  }
  // warp threads (vertical) appear
  const wp = seg(lt, .5, 1.4); const c = CELL * s; const ox = 960 - 5.5 * c;
  if (wp > 0) { ctx.save(); ctx.globalAlpha = wp * (1 - woven * .3); for (let i = -40; i < 60; i++) { const x = ox + i * c + c / 2; if (x < -20 || x > W + 20) continue; ctx.strokeStyle = hex(COL.green, .9); ctx.lineWidth = c * .32; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } ctx.restore(); }
  // UI lines stretch into wefts
  const st = eio(seg(lt, 0, .9)), fadeUI = seg(lt, .8, 1.6);
  if (fadeUI < 1) {
    ctx.save(); ctx.globalAlpha = 1 - fadeUI;
    const rows = [200, 260, 330, 420, 480, 560, 620, 700, 760, 840];
    rows.forEach((y, i) => { const x0 = lerp(560 + (i % 3) * 40, -20, st), x1 = lerp(1360 - (i % 2) * 60, W + 20, st); thread([[x1, y], [x0, y]], { w: 3, glow: .6, core: false }); });
    if (st < .6) { ctx.strokeStyle = hex(COL.teal2, .6 * (1 - st / .6)); ctx.lineWidth = 2; ctx.strokeRect(560, 170, 800, 700); }
    ctx.restore();
  }
  vignette(.55);
}

/* S09 · 33–37 «96» */
const ROWT = [[33.2, .3], [33.5, .28], [33.8, .26], [34.08, .22], [34.32, .2], [34.54, .18], [34.74, .2]];
function s09(t) {
  fill("#03100f");
  const back = eio(seg(t, 35.2, 37.0)); const s = lerp(1.25, .44, back);
  const passCols = ["teal", "teal2", "teal", "teal2", "teal", "teal2", "teal"];
  drawTextile(s, 960, 540, (i, j) => {
    const inside = i >= 0 && i <= 10 && j >= 0 && j <= 6;
    if (!inside) return cellKind(i, j + 3);
    const [t0, d] = ROWT[j]; const q = seg(t, t0, t0 + d); const col = 10 - i; // shuttle travels right→left
    if (q * 11 < col + 1 - 1e-6 && q < 1) return null;
    return in96(i, j) ? passCols[j] : "deep";
  });
  // empty warp in the unfilled window cells
  const c = CELL * s, ox = 960 - 5.5 * c, oy = 540 - 3.5 * c;
  ctx.save();
  for (let j = 0; j < 7; j++) { const [t0, d] = ROWT[j]; const q = seg(t, t0, t0 + d); for (let i = 0; i <= 10; i++) { const col = 10 - i; if (q * 11 < col + 1 && q < 1) { const x = ox + i * c, y = oy + j * c; ctx.fillStyle = "#010807"; ctx.fillRect(x, y, c + .5, c + .5); ctx.fillStyle = hex(COL.green, .85); ctx.fillRect(x + c * .32, y, c * .36, c + .5); ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(x + c * .42, y, c * .06, c); } } }
  // shuttle of light
  for (let j = 0; j < 7; j++) { const [t0, d] = ROWT[j]; const q = seg(t, t0, t0 + d); if (q > 0 && q < 1) { const x = ox + (11 - q * 11) * c, y = oy + j * c + c / 2; glowDot(x, y, c * 2.2, .9, j % 2 ? COL.gold : COL.teal2); ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = hex(j % 2 ? COL.gold : COL.teal2, .8); ctx.lineWidth = c * .18; ctx.beginPath(); ctx.moveTo(ox + 11 * c + 30, y); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); } }
  ctx.restore();
  // gold shimmer at the hit (35.0)
  const sh = seg(t, 35.0, 35.8);
  if (sh > 0 && sh < 1) { ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, 11 * c, 7 * c); ctx.clip(); ctx.globalCompositeOperation = "lighter"; const x = lerp(ox - 300, ox + 11 * c + 300, eio(sh)); const g = ctx.createLinearGradient(x - 160, 0, x + 160, 0); g.addColorStop(0, "rgba(201,168,118,0)"); g.addColorStop(.5, "rgba(232,213,171,.55)"); g.addColorStop(1, "rgba(201,168,118,0)"); ctx.fillStyle = g; ctx.fillRect(ox, oy, 11 * c, 7 * c); ctx.restore(); }
  const flash = seg(t, 34.98, 35.05) * (1 - seg(t, 35.05, 35.5)); if (flash > 0) { ctx.save(); ctx.globalCompositeOperation = "lighter"; fill(`rgba(232,213,171,${.12 * flash})`); ctx.restore(); }
  vignette(.55);
}

/* S10 · 37–43 وطنٌ بنى — official portraits (placeholders; never generated) */
function portraitSlot(x, y, w, h, cap, a) {
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = "rgba(0,20,18,.75)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = hex(COL.gold, .9); ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); ctx.strokeStyle = hex(COL.gold, .35); ctx.lineWidth = 1; ctx.strokeRect(x - 14, y - 14, w + 28, h + 28);
  txt("الصورة الرسمية", x + w / 2, y + h / 2 - 20, { font: "600 34px Cairo", color: hex(COL.gold2, .9) });
  txt("(ملف وزارة الإعلام — دون تعديل)", x + w / 2, y + h / 2 + 28, { font: "400 22px Cairo", color: hex(COL.gold2, .6) });
  const lines = cap.split("\n"); lines.forEach((l, i) => txt(l, x + w / 2, y + h + 52 + i * 36, { font: `${i === lines.length - 1 ? 400 : 600} ${i === lines.length - 1 ? 22 : 25}px Cairo`, color: i === lines.length - 1 ? hex(COL.gold2, .85) : COL.ice }));
  ctx.restore();
}
function s10(t) {
  fill("#021311");
  ctx.save(); ctx.globalAlpha = .35; drawTextile(.44, 960, 540, null, { light: false }); ctx.restore(); fill("rgba(0,20,18,.55)");
  const a1 = seg(t, 37, 37.6) * (1 - seg(t, 39.3, 40.2));
  const a2 = seg(t, 39.6, 40.5) * (1 - seg(t, 42.4, 43.0));
  if (a1 > 0) portraitSlot(710, 130, 500, 620, "الملك عبدالعزيز بن عبدالرحمن آل سعود\nطيب الله ثراه", a1);
  if (a2 > 0) { portraitSlot(1020, 130, 440, 560, "خادم الحرمين الشريفين\nالملك سلمان بن عبدالعزيز آل سعود\nحفظه الله", a2); portraitSlot(460, 130, 440, 560, "صاحب السمو الملكي الأمير محمد بن سلمان\nبن عبدالعزيز آل سعود، ولي العهد رئيس مجلس الوزراء\nحفظه الله", a2); }
  vignette(.5);
  tag("S10 · الصور الرسمية + قالب الإطار (ص56) — يعتمدها فريق البروتوكول");
}

/* S11 · 43–49 خيطٌ جديد */
function s11(t) {
  fill("#021311");
  const lt = t - 43; const pan = eio(clamp(lt / 3.2)) * 380;
  drawTextile(.62, 960 + pan, 540, null);
  // the thread weaves through (over / under), tracked by the camera
  const c = CELL * .62; const y0 = 540 + c * 0.5; const headX = lerp(2050, 700, eio(seg(t, 43.2, 46.2))) ;
  const pts = []; for (let x = 2100; x >= headX; x -= 4) pts.push([x, y0 + Math.sin(x / (c) * Math.PI) * 3]);
  if (pts.length > 2) {
    // under-segments dimmed
    ctx.save(); thread(pts, { w: 7, glow: .7 }); ctx.restore();
    ctx.save(); ctx.globalAlpha = .55; const ox = (960 + pan) - 5.5 * c; for (let x = ox - 200 * c; x < W; x += 2 * c) { if (x > headX) { ctx.fillStyle = "rgba(6,42,39,.9)"; ctx.fillRect(x + c * .15, y0 - 7, c * .7, 14); } } ctx.restore();
  }
  // the free end lifts toward the lens
  const lift = seg(t, 46.0, 48.35);
  if (lift > 0) {
    const e = ei(lift); const tip = [lerp(headX, 960, eio(lift)), lerp(y0, 520, eio(lift))];
    const ctrl = [headX - 140, y0 - 40 * (1 - e)];
    const curve = bez([headX, y0], ctrl, [lerp(headX, tip[0], .6), lerp(y0, tip[1] - 120 * (1 - e), .6)], tip, 40);
    thread(curve, { w: 7 + e * 30, glow: 1 + e * 2, head: true, headR: 6 + e * 40 });
    glowDot(tip[0], tip[1], 60 + e * 1800, .35 + e * .65);
  }
  vignette(.55);
  const white = seg(t, 48.1, 48.4); if (white > 0) fill(`rgba(220,255,250,${white * .85})`);
}

/* S12 · 49–51.5 المنصة */
function s12(t) {
  const flood = eo(seg(t, 49.0, 49.55));
  fill("#000");
  ctx.save(); ctx.beginPath(); ctx.arc(960, 540, flood * 1300, 0, 7); ctx.clip(); fill(COL.ice); ctx.restore();
  const fold = eio(seg(t, 50.95, 51.5));
  const cards = [["ui-request-tutor", 250, 150, 700, .0], ["ui-attendance", 990, 150, 680, .25], ["ui-child-mgmt", 250, 610, 520, .5], ["ui-booking-success", 820, 610, 450, .75]];
  ctx.save(); ctx.translate(960, 540); ctx.scale(1, 1 - fold); ctx.transform(1, 0, -.06, 1, 0, 0); ctx.translate(-960, -540);
  cards.forEach(([k, x, y, w, d]) => {
    const q = eo(seg(t, 49.35 + d * .9, 49.75 + d * .9)); if (q <= 0) return; const img = IMG[k]; const h = Math.min(420, w * img.height / img.width);
    ctx.save(); ctx.globalAlpha = q; ctx.translate(0, (1 - q) * 18);
    ctx.shadowColor = "rgba(54,82,104,.18)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12; ctx.fillStyle = "#fff"; rr(x, y, w, h, 18); ctx.fill(); ctx.shadowColor = "transparent";
    ctx.save(); rr(x, y, w, h, 18); ctx.clip(); cover(img, x, y, w, h, { ay: 0 }); ctx.restore(); ctx.restore();
  });
  [[1720, 610, 180], [1720, 700, 140]].forEach(([x, y, w], i) => { const q = eo(seg(t, 50.2 + i * .15, 50.5 + i * .15)); ctx.globalAlpha = q; ctx.fillStyle = i ? COL.gold : COL.teal; rr(x - w, y, w, 58, 29); ctx.fill(); ctx.globalAlpha = 1; });
  ctx.restore();
  if (fold > 0) { ctx.save(); fill(hex(COL.night2, fold * .96)); ctx.restore(); thread([[1920 * (1 - fold * .2), 540], [0, 540]].map((p, i) => i ? [lerp(0, 700, fold), 540] : p), { w: 5 * fold + 1, alpha: fold }); }
  if (t < 50.9) tag("S12 · التقاط 4K للواجهة العربية بحساب تجريبي (مؤقتًا لقطات إنجليزية)", true);
}

/* S13–S14 · 51.5–62 العُقد تصير شكلنا + Learn Without Limits */
function s13(t) {
  const light = eo(seg(t, 53.1, 53.45));
  fill(COL.night2);
  if (light > 0) { ctx.save(); ctx.beginPath(); ctx.arc(960, 470, light * 1300, 0, 7); ctx.clip(); fill(COL.ice); ctx.restore(); }
  const hold = 1 + .02 * eio(seg(t, 54.0, 62.0));
  ctx.save(); ctx.translate(960, 470); ctx.scale(hold, hold); ctx.translate(-960, -470);
  // 1) the folded line arrives from the right and ties the S06 knot again
  const tie = eio(seg(t, 51.45, 52.15));
  const settle = eio(seg(t, 52.1, 52.85));
  const toLogo = p => { const a = T6(p), b = TL(p); return [lerp(a[0], b[0], settle), lerp(a[1], b[1], settle)]; };
  const wKnot = lerp(9, STR.strokeW * LK, settle);
  const navy = seg(t, 53.15, 53.4), swap = seg(t, 53.35, 53.6);
  const tcol = mixHex(COL.teal2, COL.logoNavy, navy), glow = 1 - navy;
  const topt = (u, extra = {}) => Object.assign({ w: wKnot, color: tcol, glow, core: navy < .5, head: false }, extra);
  if (swap < 1) {
    ctx.save(); ctx.globalAlpha = 1 - swap;
    const lead = seg(t, 51.45, 51.7);
    if (lead < 1) thread([[lerp(1500, 1100, lead), 713], [1920, 700]], { w: 5, alpha: 1 - lead });
    const kp = mkPath(STR.knot.pts.map(toLogo)); thread(subU(kp, 0, tie), topt(tie, { head: tie < 1 }));
    // 2) the rest of the word grows out of the knot (right → left)
    const m = eio(seg(t, 52.4, 53.05)), al = eio(seg(t, 52.5, 53.1)), da = eio(seg(t, 52.8, 53.15));
    if (m > 0) thread(subU(P.meemR, 0, m), topt(m, { head: m < 1 }));
    if (al > 0) thread(subU(P.alef, 0, al), topt(al, { head: al < 1 }));
    if (da > 0) thread(subU(P.dal, 0, da), topt(da, { head: da < 1 }));
    ctx.restore();
  }
  if (swap > 0) drawLockup({ alpha: swap, parts: { word: 1, text: 0, icon: 0 } });
  // 3) icon: square, line, the three circles (child · family · teacher)
  const sq = eo(seg(t, 53.25, 53.65));
  if (sq > 0) {
    const ix = LX + 575 * LK, iy = LY, iw = 325 * LK, ih = 317 * LK, sc = lerp(.94, 1, sq);
    ctx.save(); ctx.translate(ix + iw / 2, iy + ih / 2); ctx.scale(sc, sc); ctx.translate(-(ix + iw / 2), -(iy + ih / 2));
    ctx.globalAlpha = sq; ctx.drawImage(IMG.icon_sq, ix, iy, iw, ih);
    const ln = eio(seg(t, 53.45, 53.85)); if (ln > 0) { ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw * ln, ih); ctx.clip(); ctx.globalAlpha = 1; ctx.drawImage(IMG.icon_line, ix, iy, iw, ih); ctx.restore(); }
    [["icon_olive", 53.67], ["icon_gold", 53.77], ["icon_navy", 53.87]].forEach(([k, t0]) => { const q = seg(t, t0, t0 + .16); if (q > 0) { ctx.globalAlpha = q; ctx.drawImage(IMG[k], ix, iy, iw, ih); } });
    const fin = seg(t, 54.05, 54.25); if (fin > 0) { ctx.globalAlpha = fin; ctx.drawImage(IMG.icon, ix, iy, iw, ih); }
    ctx.restore();
  }
  // 4) MEHAD
  const mt = eio(seg(t, 53.75, 54.3));
  if (mt > 0) { ctx.save(); ctx.beginPath(); ctx.rect(LX, LY + 160 * LK, 560 * LK * mt, 170 * LK); ctx.clip(); drawLockup({ parts: { word: 0, text: 1, icon: 0 } }); ctx.restore(); }
  // S14 · Learn Without Limits typed under the lockup
  const S = "Learn Without Limits"; const n = Math.floor(clamp((t - 56.6) / 1.3) * S.length + 1e-6);
  if (t >= 56.6) {
    ctx.save(); ctx.font = "300 44px Cairo"; ctx.letterSpacing = "2px"; ctx.direction = "ltr"; const fw = ctx.measureText(S).width;
    ctx.fillStyle = COL.navy; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(S.slice(0, n), 960 - fw / 2, LY + LH + 78); ctx.restore();
  }
  ctx.restore();
  // exit: a thread leaves the last letter (dal) out of frame
  const ex = eio(seg(t, 61.2, 62.0));
  if (ex > 0) { const a = TL(STR.dal.pts[STR.dal.pts.length - 1]); thread([a, [lerp(a[0], -60, ex), a[1] + 40 * ex]], { w: 6, glow: 0, color: COL.teal, core: false }); }
  vignette(light > .5 ? .35 : .5, light > .5);
}

/* S15–S17 · 62–76.5 طالب · معلم · ولي أمر (placeholders for the AI clips) */
function warmRoom(c1, c2, lx) { const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); const r = ctx.createRadialGradient(lx, 200, 0, lx, 200, 1400); r.addColorStop(0, "rgba(255,226,170,.55)"); r.addColorStop(1, "rgba(255,226,170,0)"); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); }
function s15(t) {
  const lt = t - 62, dx = -lt * 18;
  warmRoom("#6d5a40", "#1f1b16", 1700);
  ctx.save(); ctx.translate(dx, 0);
  ctx.fillStyle = "#3a2c1d"; ctx.fillRect(-100, 760, W + 300, 400); // desk
  ctx.fillStyle = "#efe6d3"; ctx.save(); ctx.translate(560, 820); ctx.rotate(-.05); ctx.fillRect(-260, -60, 520, 170); ctx.restore(); // notebook
  device("tablet", IMG["ui-request-tutor"], 900, 330, 640, { skew: [-.06, 0] });
  ctx.restore();
  const g = ctx.createLinearGradient(1600, 0, 700, 0); g.addColorStop(0, "rgba(255,210,140,.18)"); g.addColorStop(1, "rgba(255,210,140,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  thread([[900 + dx, 330 + 460], [1540 + dx - 30, 330 + 460]], { w: 2, alpha: .6 });
  vignette(.55);
  tag("مؤقت · S15 · لقطة الطالب — AI جاهزة في Higgsfield + واجهة الطالب العربية");
}
function s16(t) {
  const lt = t - 67.5; const hx = Math.sin(lt * 1.7) * 6, hy = Math.cos(lt * 1.3) * 4;
  ctx.save(); ctx.translate(hx, hy);
  warmRoom("#dfe8e4", "#8fa7a2", 300);
  ctx.fillStyle = "#f7f7f4"; ctx.fillRect(1180, 120, 620, 420); ctx.strokeStyle = "#c9d3d0"; ctx.lineWidth = 6; ctx.strokeRect(1180, 120, 620, 420); // whiteboard
  ctx.strokeStyle = COL.navy; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(1390, 320, 90, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(1520, 240); ctx.lineTo(1680, 400); ctx.stroke(); ctx.beginPath(); ctx.moveTo(1650, 400); ctx.lineTo(1680, 400); ctx.lineTo(1680, 370); ctx.stroke();
  ctx.fillStyle = "#c8b394"; ctx.fillRect(-50, 780, W + 100, 400);
  device("laptop", IMG["ui-attendance"], 380, 380, 700, { skew: [.05, 0] });
  ctx.restore();
  vignette(.35);
  tag("مؤقت · S16 · لقطة المعلمة — AI جاهزة في Higgsfield + واجهة المعلم");
}
function s17(t) {
  const lt = t - 72.5;
  warmRoom("#4a3522", "#120d09", 300);
  const r = rng(4); ctx.save(); ctx.filter = "blur(18px)"; for (let i = 0; i < 6; i++) { ctx.fillStyle = hex(i % 2 ? "#8a5a33" : "#5b3e25", .8); rr(100 + i * 300, 700 + r() * 60, 260, 200, 60); ctx.fill(); } ctx.restore();
  const z = 1 + lt * .012; ctx.save(); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540);
  device("phone", IMG["ui-child-mgmt"], 800, 170, 330, { skew: [0, -.03] });
  const ping = seg(t, 72.6, 73.0) * (1 - seg(t, 74.2, 74.6)); if (ping > 0) { ctx.save(); ctx.globalAlpha = ping; ctx.fillStyle = "rgba(255,255,255,.95)"; rr(830, 220, 270, 90, 20); ctx.fill(); txt("تقرير الجلسة جاهز", 1080, 265, { font: "600 26px Cairo", color: COL.navy, align: "right" }); ctx.fillStyle = COL.teal; rr(846, 240, 50, 50, 12); ctx.fill(); ctx.restore(); }
  ctx.restore();
  // phone glow collapses to a point of light → S18
  const pt = eio(seg(t, 75.9, 76.5)); if (pt > 0) { fill(hex(COL.night, pt)); glowDot(960, 540, lerp(400, 40, pt), pt); glowDot(960, 540, 12, pt); }
  vignette(.6);
  if (t < 75.9) tag("مؤقت · S17 · لقطة ولي الأمر — AI جاهزة في Higgsfield + واجهة ولي الأمر");
}

/* S18 · 76.5–79.5 من نقطة إلى شبكة */
let NET = null;
function mkNet() {
  const r = rng(96); const nodes = [{ x: 0, y: 0, t: 0, p: -1 }];
  for (let gen = 0; gen < 5; gen++) {
    const layer = nodes.filter(n => (n.gen ?? 0) === gen);
    layer.forEach(n => { const k = gen === 0 ? 6 : 2 + Math.floor(r() * 2); for (let i = 0; i < k; i++) { const a = (gen === 0 ? i / k * Math.PI * 2 : Math.atan2(n.y, n.x) + (r() - .5) * 1.6); const d = 120 + r() * 140 + gen * 20; nodes.push({ x: n.x + Math.cos(a) * d, y: n.y + Math.sin(a) * d * .7, t: n.t + .3 + r() * .25, p: nodes.indexOf(n), gen: gen + 1, gold: r() < .3 }); } });
  }
  NET = nodes;
}
function s18(t) {
  fill(COL.night);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#050f14"); g.addColorStop(1, "#0b2531"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const lt = t - 76.5; const rise = eio(seg(lt, 0, .8));
  const cx = 960, cy = lerp(620, 470, rise);
  const zoom = lerp(1, .78, eio(seg(lt, .6, 3)));
  const sink = eio(seg(t, 79.0, 79.5));
  ctx.save(); ctx.translate(cx, cy + sink * 260); ctx.scale(zoom * (1 - sink * .55), zoom * (1 - sink * .75));
  NET.forEach((n, i) => {
    if (n.p < 0) return; const q = eo(seg(lt, .5 + n.t, .5 + n.t + .35)); if (q <= 0) return; const pa = NET[n.p];
    const x = lerp(pa.x, n.x, q), y = lerp(pa.y, n.y, q);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.strokeStyle = hex(n.gold ? COL.gold : COL.teal2, .75); ctx.lineWidth = 2.2 / zoom; ctx.shadowColor = n.gold ? COL.gold : COL.teal; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
    if (q >= 1) glowDot(n.x, n.y, 16 / zoom, .8, n.gold ? COL.gold : COL.teal2);
  });
  glowDot(0, 0, 60, 1); glowDot(0, 0, 14, 1);
  ctx.restore();
  vignette(.6);
}

/* S19 · 79.5–86 من السعودية (placeholder for licensed drone / AI skyline) */
function s19(t) {
  const lt = t - 79.5; const z = 1 + .12 * eio(clamp(lt / 6.5));
  ctx.save(); ctx.translate(960, 700); ctx.scale(z, z); ctx.translate(-960, -700 - lt * 6);
  const g = ctx.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, "#051318"); g.addColorStop(.55, "#0c3440"); g.addColorStop(.86, "#3f6b69"); g.addColorStop(1, "#d9b27a"); ctx.fillStyle = g; ctx.fillRect(-200, -200, W + 400, 980);
  // generic low skyline + city lights (no identifiable landmarks)
  const r = rng(19); ctx.fillStyle = "#0a1a20"; for (let x = 200; x < 1720; x += 20 + r() * 30) { const h = 10 + r() * 50 * (1 - Math.abs(x - 960) / 900); ctx.fillRect(x, 760 - h, 16 + r() * 20, h + 40); }
  ctx.fillStyle = "#0b1b1f"; ctx.fillRect(-200, 770, W + 400, 400);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; for (let i = 0; i < 520; i++) { const x = 180 + r() * 1560, y = 770 + Math.pow(r(), 1.8) * 90, tw = .5 + .5 * Math.sin(t * 3 + i); ctx.fillStyle = hex(r() < .7 ? "#F2C98A" : COL.teal2, (.25 + .55 * r()) * tw); ctx.fillRect(x, y, 2.2, 2.2); } ctx.restore();
  // escarpment edge in the foreground
  ctx.fillStyle = "#050a0b"; ctx.beginPath(); ctx.moveTo(-200, 1200); ctx.lineTo(-200, 930); const rr2 = rng(33); for (let x = -200; x <= W + 200; x += 40) ctx.lineTo(x, 900 + Math.sin(x / 210) * 26 + rr2() * 14 + (x > 1300 ? (x - 1300) * .12 : 0)); ctx.lineTo(W + 200, 1200); ctx.closePath(); ctx.fill();
  ctx.restore();
  // threads rise from the city and converge in the sky
  const r3 = rng(7);
  for (let i = 0; i < 12; i++) { const sx = 260 + r3() * 1400, sy = 790 + r3() * 40; const q = eio(seg(t, 80.2 + i * .07, 81.9 + i * .05)); if (q <= 0) continue; const c = bez([sx, sy], [sx, 560], [lerp(sx, 960, .6), 330], [960, 300], 40); thread(subU(mkPath(c), 0, q), { w: 2.4, alpha: .8 * (1 - seg(t, 82.3, 82.9)), head: q < 1, headR: 4, color: i % 3 ? undefined : hex(COL.gold, .9) }); }
  const conv = seg(t, 81.9, 82.4); if (conv > 0) glowDot(960, 300, 200 * (1 - seg(t, 82.3, 83)) + 20, conv * (1 - seg(t, 82.4, 83.0)));
  const lk = eo(seg(t, 82.2, 82.9)); if (lk > 0) drawLockup({ white: true, alpha: lk, scale: .52, cx: 960, cy: 290 });
  const lw = seg(t, 83.0, 83.5); if (lw > 0) txt("Learn Without Limits", 960, 505, { font: "300 34px Cairo", color: COL.ice, alpha: lw, dir: "ltr", ls: "2px" });
  const nd = seg(t, 83.6, 84.1); if (nd > 0) txt("اليوم الوطني السعودي 96", 960, 575, { font: "600 38px Cairo", color: COL.gold2, alpha: nd });
  const dk = seg(t, 85.4, 86.0); if (dk > 0) fill(hex(COL.deep, dk));
  vignette(.55);
  tag("مؤقت · S19 · لقطة درون مرخّصة للرياض وطويق (أو AI جاهزة في Higgsfield) · شعار معكوس مؤقت");
}

/* S20 · 86–89.5 التوقيع */
function s20(t) {
  fill(COL.deep);
  ctx.save(); ctx.globalAlpha = .18; drawTextile(.3, 960, 540, null, { light: false }); ctx.restore(); fill("rgba(0,37,40,.6)");
  const a = seg(t, 86.0, 86.5);
  ctx.save(); ctx.globalAlpha = a; ctx.setLineDash([12, 10]); ctx.strokeStyle = hex(COL.gold2, .7); ctx.lineWidth = 2; ctx.strokeRect(540, 200, 840, 320); ctx.setLineDash([]);
  txt("الشعار المتحرك الرسمي لليوم الوطني 96", 960, 340, { font: "600 36px Cairo", color: COL.gold2 });
  txt("«عزّنا بطبعنا» — الملف الرسمي من الدليل (ص63)، دون تعديل", 960, 400, { font: "400 24px Cairo", color: hex(COL.gold2, .7) });
  ctx.restore();
  const b = eo(seg(t, 86.3, 86.9)); if (b > 0) drawLockup({ white: true, alpha: b, scale: .36, cx: 960, cy: 770 });
  const out = seg(t, 89.0, 89.5); if (out > 0) fill(`rgba(0,0,0,${out})`);
  tag("S20 · بطاقة الختام حسب ص14: شعار اليوم الوطني بضعف عرض شعار مهاد");
}

/* VO guide subtitles — timings from the storyboard VO table */
const SHOW_SUBS = !/nosubs/.test(location.search);
const VO = [[1.0, 4.3, "كل شيء كبير... بدأ بفكرة."], [5.5, 8.3, "ومهاد... بدأت بفكرة."], [9.3, 12.8, "فكرة إن التعليم... يكون أقرب. أسهل. وأوسع."],
  [13.8, 17.3, "خلال الشهور اللي راحت... ما كان الطريق سهل."], [18.0, 21.3, "اشتغلنا... وجرّبنا... وغلطنا... وعدّلنا."], [22.3, 25.8, "مرات وقفنا عند مشكلة... ومرات رجعنا من البداية."],
  [26.5, 29.8, "بس كل مرة... كان عندنا سبب نكمل."], [36.0, 41.0, "وفي يوم نحتفل فيه بوطن... علّمنا إن الطموح ما له سقف."], [43.5, 45.8, "نحتفل بخطوة جديدة..."],
  [46.0, 48.4, "خطوة اسمها... مهاد."], [53.6, 56.5, "اليوم... مهاد مو مجرد فكرة."], [56.8, 59.3, "اليوم... مهاد صارت منصة."], [59.5, 61.9, "ومن هنا... تبدأ الحكاية."],
  [62.3, 64.2, "طموحنا أكبر من منصة."], [64.4, 67.5, "طموحنا إننا نقرّب التعليم... من كل طالب."], [67.9, 72.4, "ونعطي المعلم مساحة أكبر... يعلّم، ويطوّر، ويصنع أثر."],
  [72.9, 76.3, "ونبني تجربة... تخلي التعليم أقرب للناس."], [76.8, 79.3, "وهذي... بس البداية."], [80.3, 83.8, "من السعودية... وبطموح ما يعرف حدود."], [84.3, 85.8, "مهاد."]];
function subs(t) {
  if (!SHOW_SUBS) return; const v = VO.find(x => t >= x[0] && t < x[1]); if (!v) return;
  const a = seg(t, v[0], v[0] + .15) * (1 - seg(t, v[1] - .15, v[1]));
  ctx.save(); ctx.globalAlpha = a; ctx.font = "600 38px Cairo"; ctx.direction = "rtl"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(v[2]).width + 56; ctx.fillStyle = "rgba(0,0,0,.55)"; rr(960 - w / 2, 928, w, 64, 12); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText(v[2], 960, 961); ctx.restore();
}

/* ================= timeline ================= */
const SCENES = [
  [0, 4.5, s01], [4.5, 8.5, s02], [8.5, 13, s03], [13, 17.5, s04], [17.5, 21.5, s05], [21.5, 26, s06], [26, 30, s07],
  [30, 33, s08], [33, 37, s09], [37, 43, s10], [43, 48.4, s11], [48.4, 49, () => fill("#000")], [49, 51.5, s12],
  [51.5, 62, s13], [62, 67.5, s15], [67.5, 72.5, s16], [72.5, 76.5, s17], [76.5, 79.5, s18], [79.5, 86, s19], [86, 89.5, s20]
];
// dissolves: [start, end, fromScene, toScene]
const DISS = [[12.55, 13.1, s03, s04], [36.4, 37.2, s09, s10], [42.4, 43.2, s10, s11], [79.2, 79.7, s18, s19], [85.6, 86.2, s19, s20]];
const buf = document.createElement("canvas"); buf.width = W; buf.height = H;
function renderAt(t) {
  t = clamp(t, 0, DUR - 1e-4);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.filter = "none"; ctx.globalCompositeOperation = "source-over";
  const d = DISS.find(x => t >= x[0] && t < x[1]);
  if (d) {
    d[2](t);
    swapCtx(buf.getContext("2d"), () => d[3](t));
    ctx.globalAlpha = ss(seg(t, d[0], d[1])); ctx.drawImage(buf, 0, 0); ctx.globalAlpha = 1;
  } else {
    const s = SCENES.find(x => t >= x[0] && t < x[1]) || SCENES[SCENES.length - 1];
    s[2](t);
  }
  grain(t, .11);
  subs(t);
  ctx.restore();
}
function swapCtx(g, fn) { const keep = ctx; ctx = g; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = "none"; g.globalCompositeOperation = "source-over"; try { fn(); } finally { g.restore(); ctx = keep; } }

/* ================= boot ================= */
function loadImg(k, src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => { IMG[k] = i; res(); }; i.onerror = () => rej(new Error("img " + src)); i.src = src; }); }
async function boot() {
  const imgs = ["icon", "icon_sq", "icon_line", "icon_olive", "icon_gold", "icon_navy", "wordmark", "wordmark_white", "mehadtext", "mehadtext_white"].map(k => loadImg(k, `assets/${k}.png`));
  ["ui-attendance", "ui-booking-success", "ui-child-mgmt", "ui-conflict", "ui-request-tutor"].forEach(k => imgs.push(loadImg(k, `assets/${k}.jpg`)));
  await Promise.all(imgs);
  STR = await (await fetch("assets/logo_strands.json")).json();
  await Promise.all(["300 40px Cairo", "400 40px Cairo", "600 40px Cairo", "700 40px Cairo"].map(f => document.fonts.load(f, "مهاد Learn")));
  P.knot6 = mkPath(knotLead().concat(STR.knot.pts.map(T6)));
  P.meemR = mkPath(STR.meem.pts.slice().reverse().map(TL));
  P.alef = mkPath(STR.alef.pts.map(TL));
  P.dal = mkPath(STR.dal.pts.map(TL));
  mkSprites(); mkGrain(); mkNet();
  window.renderAt = renderAt; window.DUR = DUR; window.FPS = FPS;
  if (/render/.test(location.search)) { document.body.classList.add("render"); window.READY = true; return; }
  const play = document.getElementById("play"), scrub = document.getElementById("scrub"), tc = document.getElementById("tc");
  let t = +(new URLSearchParams(location.search).get("t") || 0), playing = false, last = 0;
  const fmt = x => { const m = Math.floor(x / 60), s = x - m * 60; return String(m).padStart(2, "0") + ":" + s.toFixed(2).padStart(5, "0"); };
  const draw = () => { renderAt(t); scrub.value = t; tc.textContent = fmt(t); };
  const tick = now => { if (playing) { t += (now - last) / 1000; last = now; if (t >= DUR) { t = DUR; playing = false; play.textContent = "▶"; } draw(); requestAnimationFrame(tick); } };
  play.onclick = () => { playing = !playing; play.textContent = playing ? "❚❚" : "▶"; if (playing) { if (t >= DUR) t = 0; last = performance.now(); requestAnimationFrame(tick); } };
  scrub.oninput = () => { t = +scrub.value; draw(); };
  draw(); window.READY = true;
}
boot().catch(e => { document.body.insertAdjacentHTML("beforeend", `<pre style="color:#f88">${e.stack || e}</pre>`); window.BOOT_ERROR = String(e); });
