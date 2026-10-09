/* Effects shared by the idea stings: stop-motion timing, hand-drawn marks,
   liquid warp, and a little 3D. All deterministic (seeded), so any frame renders alone. */
"use strict";

/* ---------- noise ---------- */
function hash(n) { n = (n | 0) * 374761393 + 668265263; n = (n ^ (n >>> 13)) * 1274126177; n ^= n >>> 16; return ((n >>> 0) / 4294967295) * 2 - 1; }
const rnd = n => (hash(n) + 1) / 2;
function vnoise(x, seed = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i + seed * 7919), hash(i + 1 + seed * 7919), u); }
function fbm(x, seed = 0) { return .6 * vnoise(x, seed) + .3 * vnoise(x * 2.1, seed + 1) + .1 * vnoise(x * 4.3, seed + 2); }

/* ---------- stop-motion ---------- */
const SM_FPS = 12.5;                                   // "on twos" at 25fps
const smStep = t => Math.floor(t * SM_FPS + 1e-6);
const smTime = t => smStep(t) / SM_FPS;

/* ---------- hand-drawn marks (boil = stop-motion step, changes the wobble) ---------- */
function handPts(pts, seed, amp = 2.2, freq = 1 / 38) {
  const out = []; let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const a = i ? Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) : Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
    const o = amp * fbm(s * freq, seed);
    out.push([pts[i][0] - Math.sin(a) * o, pts[i][1] + Math.cos(a) * o]);
  }
  return out;
}
function densify(pts, step = 8) {
  const o = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) o.push([lerp(x0, x1, k / n), lerp(y0, y1, k / n)]);
  }
  return o;
}
function strokePart(g, pts, p = 1) {
  if (p <= 0 || pts.length < 2) return;
  const P = mkPath(pts); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  const s = P.L * Math.min(p, 1);
  for (let i = 1; i < pts.length; i++) {
    if (P.cum[i] <= s) { g.lineTo(pts[i][0], pts[i][1]); continue; }
    const f = (s - P.cum[i - 1]) / (P.cum[i] - P.cum[i - 1] || 1);
    g.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); break;
  }
  g.stroke();
}
function hand(g, pts, { seed = 1, p = 1, w = 2, color = "#333", amp = 2.2, alpha = 1 } = {}) {
  g.save(); g.strokeStyle = color; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.globalAlpha *= alpha;
  strokePart(g, handPts(densify(pts), seed, amp), p); g.restore();
}
function handArrowHead(g, x, y, ang, size, o) {
  hand(g, [[x - Math.cos(ang - .45) * size, y - Math.sin(ang - .45) * size], [x, y], [x - Math.cos(ang + .45) * size, y - Math.sin(ang + .45) * size]], o);
}
function handArrow(g, pts, o = {}) {
  hand(g, pts, o);
  if ((o.p ?? 1) >= .98) { const n = pts.length, a = Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0]); handArrowHead(g, pts[n - 1][0], pts[n - 1][1], a, o.head ?? 14, { ...o, p: 1, seed: (o.seed ?? 1) + 5 }); }
}
function handEllipse(g, cx, cy, rx, ry, o = {}) {
  const a0 = o.a0 ?? -2.2, over = o.over ?? .18, pts = [];
  for (let i = 0; i <= 64; i++) { const a = a0 + (Math.PI * 2 * (1 + over)) * i / 64, k = 1 + .04 * Math.sin(i * .3) + .03 * (i / 64); pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
  hand(g, pts, o);
}
function dimLine(g, x0, y0, x1, y1, o = {}) {       // ↔ with arrow heads at both ends
  hand(g, [[x0, y0], [x1, y1]], o);
  if ((o.p ?? 1) >= .98) { const a = Math.atan2(y1 - y0, x1 - x0), h = o.head ?? 10; handArrowHead(g, x1, y1, a, h, { ...o, p: 1, seed: (o.seed ?? 1) + 3 }); handArrowHead(g, x0, y0, a + Math.PI, h, { ...o, p: 1, seed: (o.seed ?? 1) + 4 }); }
}
function handText(g, txt, x, y, { font = "500 30px Caveat", color = "#333", seed = 1, rot = 0, align = "left", dir = "ltr", alpha = 1 } = {}) {
  g.save(); g.translate(x + hash(seed) * 1.2, y + hash(seed + 1) * 1.2); g.rotate(rot + hash(seed + 2) * .025);
  g.font = font; g.fillStyle = color; g.textAlign = align; g.direction = dir; g.textBaseline = "middle"; g.globalAlpha *= alpha;
  g.fillText(txt, 0, 0); g.restore();
}
function sparkle(g, x, y, r, o = {}) {
  hand(g, [[x - r, y], [x + r, y]], o); hand(g, [[x, y - r], [x, y + r]], { ...o, seed: (o.seed ?? 1) + 9 });
}
function squiggle(g, x0, x1, y, o = {}) {
  const pts = []; for (let x = x0; x <= x1; x += 6) pts.push([x, y + Math.sin((x - x0) / 14) * 5]); hand(g, pts, o);
}

/* ---------- liquid warp (Risk): two strip passes of smooth displacement ---------- */
const _w1 = document.createElement("canvas"), _w2 = document.createElement("canvas");
function liquid(g, img, sx, sy, sw, sh, dx, dy, dw, dh, amt, seed, t) {
  const m = Math.ceil(Math.max(dw, dh) * .35 * Math.min(amt, 1.2)) + 4;
  const cw = Math.ceil(dw + 2 * m), ch = Math.ceil(dh + 2 * m);
  if (_w1.width < cw || _w1.height < ch) { _w1.width = _w2.width = Math.max(cw, _w1.width); _w1.height = _w2.height = Math.max(ch, _w1.height); }
  const a = _w1.getContext("2d"), b = _w2.getContext("2d");
  a.setTransform(1, 0, 0, 1, 0, 0); b.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, cw, ch); b.clearRect(0, 0, cw, ch);
  const sxk = sw / dw, syk = sh / dh, strip = 3, A = dw * .22 * amt, B = dh * .22 * amt;
  for (let y = 0; y < dh; y += strip) {                       // rows slide sideways
    const off = A * fbm(y / (dh * .18) + t * 1.7, seed) + (rnd(seed * 31 + Math.floor(y / 9) + Math.floor(t * 30)) < .06 * amt ? A * 1.4 * hash(seed + y) : 0);
    a.drawImage(img, sx, sy + y * syk, sw, strip * syk + .5, m + off, m + y, dw, strip + .5);
  }
  for (let x = 0; x < cw; x += strip) {                       // columns slide vertically
    const off = B * fbm(x / (dw * .2) - t * 1.3, seed + 17);
    b.drawImage(_w1, x, 0, strip + .5, ch, x, off, strip + .5, ch);
  }
  g.drawImage(_w2, 0, 0, cw, ch, dx - m, dy - m, cw, ch);
}

/* ---------- 3D ---------- */
function rot3(p, rx, ry, rz) {
  let [x, y, z] = p, c, s;
  c = Math.cos(rx); s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ry); s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rz); s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}
const proj = (p, f, cx, cy, k) => [cx + k * p[0] * f / (f + p[2]), cy + k * p[1] * f / (f + p[2])];
/* image → arbitrary quad (P0 tl, P1 tr, P2 br, P3 bl) via a grid of affine triangles */
function drawImageQuad(g, img, sx, sy, sw, sh, P, n = 10) {
  // no visible perspective → one exact affine draw (no triangle seams)
  const dev = Math.hypot(P[0][0] + P[2][0] - P[1][0] - P[3][0], P[0][1] + P[2][1] - P[1][1] - P[3][1]);
  if (dev < .75) {
    g.save(); g.transform((P[1][0] - P[0][0]) / sw, (P[1][1] - P[0][1]) / sw, (P[3][0] - P[0][0]) / sh, (P[3][1] - P[0][1]) / sh, P[0][0], P[0][1]);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); g.restore(); return;
  }
  const at = (u, v) => [lerp(lerp(P[0][0], P[1][0], u), lerp(P[3][0], P[2][0], u), v), lerp(lerp(P[0][1], P[1][1], u), lerp(P[3][1], P[2][1], u), v)];
  const tri = (s0, s1, s2, d0, d1, d2) => {
    g.save(); g.beginPath(); const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3, e = 1.1;
    const ex = p => [p[0] + Math.sign(p[0] - cx) * e, p[1] + Math.sign(p[1] - cy) * e];
    const q0 = ex(d0), q1 = ex(d1), q2 = ex(d2);
    g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.closePath(); g.clip();
    const den = s0[0] * (s2[1] - s1[1]) - s1[0] * s2[1] + s2[0] * s1[1] + (s1[0] - s2[0]) * s0[1];
    if (Math.abs(den) < 1e-9) { g.restore(); return; }
    const m11 = -(s0[1] * (d2[0] - d1[0]) - s1[1] * d2[0] + s2[1] * d1[0] + (s1[1] - s2[1]) * d0[0]) / den;
    const m12 = (s1[1] * d2[1] + s0[1] * (d1[1] - d2[1]) - s2[1] * d1[1] + (s2[1] - s1[1]) * d0[1]) / den;
    const m21 = (s0[0] * (d2[0] - d1[0]) - s1[0] * d2[0] + s2[0] * d1[0] + (s1[0] - s2[0]) * d0[0]) / den;
    const m22 = -(s1[0] * d2[1] + s0[0] * (d1[1] - d2[1]) - s2[0] * d1[1] + (s2[0] - s1[0]) * d0[1]) / den;
    const dx = (s0[0] * (s2[1] * d1[0] - s1[1] * d2[0]) + s0[1] * (s1[0] * d2[0] - s2[0] * d1[0]) + (s2[0] * s1[1] - s1[0] * s2[1]) * d0[0]) / den;
    const dy = (s0[0] * (s2[1] * d1[1] - s1[1] * d2[1]) + s0[1] * (s1[0] * d2[1] - s2[0] * d1[1]) + (s2[0] * s1[1] - s1[0] * s2[1]) * d0[1]) / den;
    g.transform(m11, m12, m21, m22, dx, dy); g.drawImage(img, 0, 0); g.restore();
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
    const s = (u, v) => [sx + u * sw, sy + v * sh];
    tri(s(u0, v0), s(u1, v0), s(u1, v1), at(u0, v0), at(u1, v0), at(u1, v1));
    tri(s(u0, v0), s(u1, v1), s(u0, v1), at(u0, v0), at(u1, v1), at(u0, v1));
  }
}

/* ---------- page helpers ---------- */
function paperBG(base) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  if (IMG.paper) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = .55; ctx.drawImage(IMG.paper, 0, 0, W, H, 0, 0, W, H); ctx.restore(); }
}
function flatBG(c) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); }
function vignetteDark(a = .35) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.hypot(W, H) * .6);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
const LOGO_NAME = QS.get("logo") || "mehad";
const LOGO = LOGOS[LOGO_NAME];
