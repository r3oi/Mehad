/* Logo-animation system shared by every brand (Mehad now, AIM next).
   One timing sheet, one set of easings, one camera and one motion-blur model:
   brands only supply artwork and choreography on top of TIMING.
   Motion language read from the reference (Envato rebrand sting, 5.8s):
     01 build-up  — the core mark flickers through materials, 2–3 frames each, hard cuts, fixed position
     02 reveal    — brand colour arrives with one gesture, then the wordmark writes itself on
     03 lockup    — motion settles, then a long still hold (≈2s) and a clean end on the logo */
"use strict";
const FPS = 25;
const TIMING = {
  dur: 6.4,
  clean: [1.80, 2.20],   // build-up resolves to the clean mark and holds
  glide: [2.20, 2.76],   // mark travels to its lockup position
  flood: [2.70, 3.15],   // brand colour floods in behind the mark
  fills: [2.92, 0.08, 0.34], // start, stagger, duration
  write: [2.84, 3.76],   // primary wordmark write-on
  write2: [3.26, 0.07, 0.40], // secondary wordmark: start, per-letter stagger, letter duration
  lock: 3.94,            // logo complete — audio impact
  swap: [3.96, 4.08],    // layered build hands over to the untouched source file
  camera: [0, 5.0, 0.97],// push-in from 0.97 → 1.0, settled before the hold ends
  blur: [2.16, 3.98],    // window that gets sub-frame motion blur
};

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  inOutCubic: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  inOutQuint: t => t < .5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2,
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outQuart: t => 1 - Math.pow(1 - t, 4),
};

/* ---------- paths (write-on masks) ---------- */
function mkPath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, L: cum[cum.length - 1] };
}
function strokeUpTo(ctx, P, s) {
  if (s <= 0) return;
  ctx.beginPath(); ctx.moveTo(P.pts[0][0], P.pts[0][1]);
  let i = 1;
  for (; i < P.pts.length && P.cum[i] <= s; i++) ctx.lineTo(P.pts[i][0], P.pts[i][1]);
  if (i < P.pts.length) {
    const f = (s - P.cum[i - 1]) / (P.cum[i] - P.cum[i - 1] || 1);
    ctx.lineTo(lerp(P.pts[i - 1][0], P.pts[i][0], f), lerp(P.pts[i - 1][1], P.pts[i][1], f));
  } else if (P.pts.length === 1 || s >= P.L) ctx.lineTo(P.pts[P.pts.length - 1][0] + .01, P.pts[P.pts.length - 1][1]);
  ctx.stroke();
}

/* ---------- canvas, assets ---------- */
const QS = new URLSearchParams(location.search);
const FORMAT = QS.get("format") || "16x9";
const W = FORMAT === "1x1" ? 1080 : 1920, H = 1080;
const cv = document.getElementById("cv"); cv.width = W; cv.height = H;
const ctx = cv.getContext("2d", { willReadFrequently: true });
const scratch = Object.assign(document.createElement("canvas"), { width: W, height: H });
const sctx = scratch.getContext("2d");
const IMG = {};
function loadImg(key, src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { IMG[key] = im; res(); }; im.onerror = () => rej(new Error("load " + src)); im.src = src; });
}
function tinted(im, color) {
  const c = Object.assign(document.createElement("canvas"), { width: im.width, height: im.height });
  const g = c.getContext("2d"); g.drawImage(im, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

/* ---------- camera + background ---------- */
function camera(t) { const [a, b, s0] = TIMING.camera; return lerp(s0, 1, E.inOutSine(seg(t, a, b))); }
function background(bg) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createRadialGradient(W / 2, H * .46, 0, W / 2, H * .46, Math.hypot(W, H) * .62);
  g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function withCamera(t, fn) {
  const c = camera(t);
  ctx.save(); ctx.setTransform(c, 0, 0, c, W / 2 * (1 - c), H / 2 * (1 - c)); fn(c); ctx.restore();
}

/* ---------- build-up flicker: frame-quantised, hard cuts like the reference ---------- */
function flashAt(seq, frame) {
  let f = 0;
  for (const s of seq) { if (frame < f + s.frames) return s; f += s.frames; }
  return null;
}

/* ---------- frame renderer with sub-frame motion blur (180° shutter) ---------- */
let BRAND = null;
let ACC = null;
function renderFrame(n) {
  const t = n / FPS;
  const N = (BRAND.blur || [TIMING.blur]).some(([a, b]) => t >= a && t <= b) ? 16 : 1;
  if (N === 1) { BRAND.draw(t, n); return; }
  if (!ACC) ACC = new Float32Array(W * H * 4);
  ACC.fill(0);
  for (let k = 0; k < N; k++) {
    const tk = t + ((k + .5) / N - .5) * (.5 / FPS);
    BRAND.draw(tk, n);
    const d = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < d.length; i++) ACC[i] += d[i];
  }
  const out = ctx.createImageData(W, H);
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.round(ACC[i] / N);
  ctx.putImageData(out, 0, 0);
}
window.renderFrame = renderFrame;
window.FRAMES = () => Math.round(TIMING.dur * FPS);
