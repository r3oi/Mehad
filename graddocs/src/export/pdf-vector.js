// SVG → vector PDF. Converts the SVG our renderers emit (figures, tables) into real PDF drawing
// operators: paths stay paths, text stays selectable text (standard Times / Helvetica / Courier
// fonts), images are embedded once. No dependencies; runs in the browser (needs DOMParser, canvas
// for images / non-WinAnsi text, CompressionStream for FlateDecode).
//
//   svgToVectorPdf(svgString, { title, width, height, margin }) → Promise<Blob>
//
// Supported: svg/g/use (transform, opacity, clip-path), rect (rx/ry), circle, ellipse, line, polyline,
// polygon, path (M L H V C S Q T A Z, absolute and relative), image (data: URLs), text/tspan.
// Paint: fill/stroke colours, opacity, fill-opacity, stroke-opacity, stroke-width, dasharray, caps, joins.
// Text that WinAnsi cannot encode (Arabic, ✓, ✗, ← …) is drawn as a small hi-res raster of just that
// text chunk, so the rest of the drawing stays vector. Filters (drop shadows) are ignored.
import {
  pickFont, isBoldWeight, isItalicStyle, encodeWinAnsi, bytesWidth, cleanText, pdfLiteral, pdfTextString, decorationMetrics,
} from './pdf-fonts.js';

const PT = 0.75; // 1 CSS px = 0.75 pt
const KAPPA = 0.5522847498307936; // Bézier circle constant
const RASTER_SCALE = 4; // canvas px per SVG px for raster text chunks
const MAX_PAGE_PT = 14000; // PDF viewers cap pages at 14400 pt

// ---------------------------------------------------------------------------
// Small helpers

const latin1 = (s) => { const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff; return out; };

/** Number → PDF number token (max 3 decimals, never exponent notation). */
const f = (v) => {
  const r = Math.round(v * 1000) / 1000;
  if (!Number.isFinite(r) || r === 0) return '0';
  return String(r);
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const IDENT = [1, 0, 0, 1, 0, 0];
/** SVG-style matrix product: result applies `n` first, then `m`. */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const isIdentity = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const numbersIn = (s) => (String(s ?? '').match(NUM) || []).map(Number);

/** transform="translate(…) rotate(…) …" → [a b c d e f] */
export function parseTransform(value) {
  let m = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit;
  while ((hit = re.exec(String(value ?? '')))) {
    const a = numbersIn(hit[2]);
    let t = null;
    switch (hit[1]) {
      case 'matrix': if (a.length >= 6) t = a.slice(0, 6); break;
      case 'translate': t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case 'scale': t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r);
        t = [c, s, -s, c, 0, 0];
        if (a.length >= 3) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
      default: break;
    }
    if (t) m = mul(m, t);
  }
  return m;
}

const UNIT_PX = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, q: 96 / 101.6 };
const FONT_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32 };

/** "12", "12px", "9pt", "50%", "1.2em" → px. */
export function parseLength(value, { em = 16, ref = 0, fallback = 0 } = {}) {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]*)\s*$/.exec(String(value));
  if (!m) return fallback;
  const n = parseFloat(m[1]); const u = m[2].toLowerCase();
  if (!u || u === 'px') return n;
  if (u === '%') return (n / 100) * ref;
  if (u === 'em') return n * em;
  if (u === 'rem') return n * 16;
  if (u === 'ex') return n * em * 0.5;
  return UNIT_PX[u] ? n * UNIT_PX[u] : n;
}

// ---------------------------------------------------------------------------
// Colours

const NAMED = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080',
  gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000', olive: '808000', lime: '00ff00', aqua: '00ffff', cyan: '00ffff',
  teal: '008080', navy: '000080', fuchsia: 'ff00ff', magenta: 'ff00ff', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', indigo: '4b0082',
  violet: 'ee82ee', crimson: 'dc143c', coral: 'ff7f50', salmon: 'fa8072', khaki: 'f0e68c', tomato: 'ff6347', turquoise: '40e0d0',
  lightgray: 'd3d3d3', lightgrey: 'd3d3d3', darkgray: 'a9a9a9', darkgrey: 'a9a9a9', dimgray: '696969', dimgrey: '696969',
  lightblue: 'add8e6', lightgreen: '90ee90', lightyellow: 'ffffe0', lightpink: 'ffb6c1', darkblue: '00008b', darkgreen: '006400',
  darkred: '8b0000', darkorange: 'ff8c00', steelblue: '4682b4', skyblue: '87ceeb', royalblue: '4169e1', slategray: '708090',
  slategrey: '708090', whitesmoke: 'f5f5f5', gainsboro: 'dcdcdc', beige: 'f5f5dc', ivory: 'fffff0', lavender: 'e6e6fa', tan: 'd2b48c',
  chocolate: 'd2691e', firebrick: 'b22222', forestgreen: '228b22', seagreen: '2e8b57', midnightblue: '191970', orchid: 'da70d6',
  plum: 'dda0dd', wheat: 'f5deb3', aliceblue: 'f0f8ff', ghostwhite: 'f8f8ff', snow: 'fffafa', azure: 'f0ffff', mintcream: 'f5fffa',
};

let probeCtx = null;
const probe = () => {
  if (!probeCtx && typeof document !== 'undefined') probeCtx = document.createElement('canvas').getContext('2d');
  return probeCtx;
};

/** CSS colour → { r, g, b, a } (0..1), or null when it is `none`/transparent/unparseable. */
export function parseColor(value, currentColor = null) {
  if (value == null) return null;
  let s = String(value).trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent') return null;
  if (s === 'currentcolor') return currentColor ? parseColor(currentColor) : { r: 0, g: 0, b: 0, a: 1 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) {
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return a <= 0 ? null : { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a };
    }
    return null;
  }
  if (NAMED[s]) return parseColor(`#${NAMED[s]}`);
  m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const ch = (p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)) / 255;
      const a = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]));
      if (!(a > 0)) return null;
      return { r: clamp01(ch(parts[0])), g: clamp01(ch(parts[1])), b: clamp01(ch(parts[2])), a: clamp01(a) };
    }
    return null;
  }
  // hsl(), hwb(), lab(), system colours … → let the browser resolve them.
  const ctx = probe();
  if (ctx) {
    ctx.fillStyle = '#010203';
    ctx.fillStyle = s;
    const v = ctx.fillStyle;
    if (v !== '#010203' || s === '#010203') return parseColor(v);
  }
  return null;
}

const rgbOps = (c) => `${f(c.r)} ${f(c.g)} ${f(c.b)}`;

// ---------------------------------------------------------------------------
// Geometry: segments are absolute ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z']

/** SVG elliptical arc → cubic Bézier segments (each ≤ 90°). Returns [] for coincident endpoints. */
export function arcToCubics(x1, y1, rxIn, ryIn, phiDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn); let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [['L', x2, y2]];
  const phi = (((phiDeg % 360) + 360) % 360 * Math.PI) / 180;
  const cosP = Math.cos(phi); const sinP = Math.sin(phi);
  const dx2 = (x1 - x2) / 2; const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2; const y1p = -sinP * dx2 + cosP * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const k = Math.sqrt(lambda); rx *= k; ry *= k; }
  const rx2 = rx * rx; const ry2 = ry * ry;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p) / den));
  if (!!largeArc === !!sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry; const cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2; const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const ux = (x1p - cxp) / rx; const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx; const vy = (-y1p - cyp) / ry;
  const theta1 = ang(1, 0, ux, uy);
  let dTheta = ang(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / n;
  const t = (4 / 3) * Math.tan(delta / 4);
  const pt = (th) => [cx + cosP * rx * Math.cos(th) - sinP * ry * Math.sin(th), cy + sinP * rx * Math.cos(th) + cosP * ry * Math.sin(th)];
  const dv = (th) => [-cosP * rx * Math.sin(th) - sinP * ry * Math.cos(th), -sinP * rx * Math.sin(th) + cosP * ry * Math.cos(th)];
  const out = [];
  let th = theta1;
  for (let i = 0; i < n; i += 1) {
    const th2 = th + delta;
    const p1 = pt(th); const p2 = i === n - 1 ? [x2, y2] : pt(th2);
    const d1 = dv(th); const d2 = dv(th2);
    out.push(['C', p1[0] + t * d1[0], p1[1] + t * d1[1], p2[0] - t * d2[0], p2[1] - t * d2[1], p2[0], p2[1]]);
    th = th2;
  }
  return out;
}

/** Parse SVG path data into absolute M/L/C/Z segments (arcs, quadratics, shorthands expanded). */
export function parsePathData(d) {
  const s = String(d ?? ''); const n = s.length;
  const numRe = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  let i = 0;
  const out = [];
  const skip = () => { while (i < n && /[\s,]/.test(s[i])) i += 1; };
  const readNum = () => {
    skip(); numRe.lastIndex = i;
    const m = numRe.exec(s);
    if (!m) return NaN;
    i += m[0].length; return parseFloat(m[0]);
  };
  const readFlag = () => { skip(); const c = s[i]; if (c === '0' || c === '1') { i += 1; return Number(c); } return NaN; };
  const hasNumber = () => { skip(); return i < n && /[-+.\d]/.test(s[i]); };

  let cx = 0; let cy = 0; let sx = 0; let sy = 0;
  let prevCmd = ''; let ctlX = 0; let ctlY = 0; // last control point for S/T reflection
  let needMove = false;
  const line = (x, y) => { if (needMove) { out.push(['M', sx, sy]); needMove = false; } out.push(['L', x, y]); cx = x; cy = y; };
  const cubic = (x1, y1, x2, y2, x, y) => { if (needMove) { out.push(['M', sx, sy]); needMove = false; } out.push(['C', x1, y1, x2, y2, x, y]); cx = x; cy = y; };
  const bad = (...v) => v.some((x) => Number.isNaN(x));

  let cmd = '';
  while (true) {
    skip();
    if (i >= n) break;
    const ch = s[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) { cmd = ch; i += 1; } else if (!cmd || !hasNumber()) break; else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    else if (cmd === 'Z' || cmd === 'z') break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0; const oy = rel ? cy : 0;
    if (C === 'Z') {
      if (out.length) { out.push(['Z']); cx = sx; cy = sy; needMove = true; }
      prevCmd = 'Z'; continue;
    }
    if (C === 'M') {
      const x = readNum(); const y = readNum();
      if (bad(x, y)) break;
      cx = ox + x; cy = oy + y; sx = cx; sy = cy; needMove = false;
      out.push(['M', cx, cy]);
      prevCmd = 'M'; continue;
    }
    if (C === 'L') {
      const x = readNum(); const y = readNum(); if (bad(x, y)) break;
      line(ox + x, oy + y);
    } else if (C === 'H') {
      const x = readNum(); if (bad(x)) break;
      line(ox + x, cy);
    } else if (C === 'V') {
      const y = readNum(); if (bad(y)) break;
      line(cx, oy + y);
    } else if (C === 'C') {
      const a = [readNum(), readNum(), readNum(), readNum(), readNum(), readNum()]; if (bad(...a)) break;
      cubic(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]);
      ctlX = ox + a[2]; ctlY = oy + a[3];
    } else if (C === 'S') {
      const a = [readNum(), readNum(), readNum(), readNum()]; if (bad(...a)) break;
      const reflect = prevCmd === 'C' || prevCmd === 'S';
      const x1 = reflect ? 2 * cx - ctlX : cx; const y1 = reflect ? 2 * cy - ctlY : cy;
      cubic(x1, y1, ox + a[0], oy + a[1], ox + a[2], oy + a[3]);
      ctlX = ox + a[0]; ctlY = oy + a[1];
    } else if (C === 'Q' || C === 'T') {
      let qx; let qy; let x; let y;
      if (C === 'Q') {
        const a = [readNum(), readNum(), readNum(), readNum()]; if (bad(...a)) break;
        qx = ox + a[0]; qy = oy + a[1]; x = ox + a[2]; y = oy + a[3];
      } else {
        const a = [readNum(), readNum()]; if (bad(...a)) break;
        const reflect = prevCmd === 'Q' || prevCmd === 'T';
        qx = reflect ? 2 * cx - ctlX : cx; qy = reflect ? 2 * cy - ctlY : cy;
        x = ox + a[0]; y = oy + a[1];
      }
      cubic(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      ctlX = qx; ctlY = qy;
    } else if (C === 'A') {
      const rx = readNum(); const ry = readNum(); const rot = readNum();
      const fa = readFlag(); const fs = readFlag(); const x = readNum(); const y = readNum();
      if (bad(rx, ry, rot, fa, fs, x, y)) break;
      const segs = arcToCubics(cx, cy, rx, ry, rot, fa, fs, ox + x, oy + y);
      if (!segs.length) { /* zero-length arc: nothing */ } else {
        for (const sg of segs) { if (sg[0] === 'L') line(sg[1], sg[2]); else cubic(sg[1], sg[2], sg[3], sg[4], sg[5], sg[6]); }
      }
      cx = ox + x; cy = oy + y;
    }
    prevCmd = C;
  }
  return out;
}

const ellipseSegs = (cx, cy, rx, ry) => {
  const kx = rx * KAPPA; const ky = ry * KAPPA;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ['Z'],
  ];
};

const rectSegs = (x, y, w, h, rxIn, ryIn) => {
  let rx = Math.min(Math.max(rxIn || 0, 0), w / 2); let ry = Math.min(Math.max(ryIn || 0, 0), h / 2);
  if (!rx || !ry) { rx = 0; ry = 0; }
  if (!rx) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
  const kx = rx * KAPPA; const ky = ry * KAPPA;
  return [
    ['M', x + rx, y], ['L', x + w - rx, y],
    ['C', x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry],
    ['L', x + w, y + h - ry],
    ['C', x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h],
    ['L', x + rx, y + h],
    ['C', x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry],
    ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y],
    ['Z'],
  ];
};

/** Segments → PDF path operators (optionally transformed by matrix m). */
function segsToOps(segs, m = null) {
  const P = (x, y) => { const [a, b] = m ? apply(m, x, y) : [x, y]; return `${f(a)} ${f(b)}`; };
  const out = [];
  for (const sg of segs) {
    switch (sg[0]) {
      case 'M': out.push(`${P(sg[1], sg[2])} m`); break;
      case 'L': out.push(`${P(sg[1], sg[2])} l`); break;
      case 'C': out.push(`${P(sg[1], sg[2])} ${P(sg[3], sg[4])} ${P(sg[5], sg[6])} c`); break;
      case 'Z': out.push('h'); break;
      default: break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PDF object writer

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** PNG-style row filters (None / Sub / Up, best per row) so Flate compresses bitmaps well (/Predictor 15). */
function pngPredict(data, columns, colors) {
  const rowLen = columns * colors; const rows = Math.floor(data.length / rowLen);
  const out = new Uint8Array((rowLen + 1) * rows);
  const sub = new Uint8Array(rowLen); const up = new Uint8Array(rowLen);
  const mag = (v) => (v < 128 ? v : 256 - v);
  for (let y = 0; y < rows; y += 1) {
    const off = y * rowLen; const prev = off - rowLen;
    let sNone = 0; let sSub = 0; let sUp = 0;
    for (let i = 0; i < rowLen; i += 1) {
      const v = data[off + i];
      const dSub = (v - (i >= colors ? data[off + i - colors] : 0)) & 255;
      const dUp = (v - (y > 0 ? data[prev + i] : 0)) & 255;
      sub[i] = dSub; up[i] = dUp;
      sNone += mag(v); sSub += mag(dSub); sUp += mag(dUp);
    }
    const o = y * (rowLen + 1);
    if (sUp <= sSub && sUp <= sNone) { out[o] = 2; out.set(up, o + 1); } else if (sSub <= sNone) { out[o] = 1; out.set(sub, o + 1); } else { out[o] = 0; out.set(data.subarray(off, off + rowLen), o + 1); }
  }
  return out;
}

class PdfWriter {
  constructor() {
    this.objs = [null];
    this.pending = [];
    this.canCompress = typeof CompressionStream !== 'undefined';
  }

  reserve() { this.objs.push(null); return this.objs.length - 1; }

  set(n, ...parts) { this.objs[n] = parts; }

  add(...parts) { const n = this.reserve(); this.set(n, ...parts); return n; }

  /** Stream object; `dict` holds the extra dictionary entries (no << >>). Compressed unless `filter` is given. */
  stream(dict, data, { num, filter = '', predict = null } = {}) {
    const n = num ?? this.reserve();
    const raw = typeof data === 'string' ? latin1(data) : data;
    this.pending.push((async () => {
      let bytes = raw; let flt = filter;
      if (!filter && this.canCompress) {
        bytes = await deflate(raw);
        flt = ' /Filter /FlateDecode';
        if (predict) { // keep whichever of plain / PNG-predicted Flate is smaller
          const filtered = await deflate(pngPredict(raw, predict.columns, predict.colors));
          if (filtered.length < bytes.length) {
            bytes = filtered;
            flt += ` /DecodeParms << /Predictor 15 /Colors ${predict.colors} /BitsPerComponent 8 /Columns ${predict.columns} >>`;
          }
        }
      }
      this.set(n, `<< ${dict}${flt} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream');
    })());
    return n;
  }

  async build(rootNum, infoNum) {
    await Promise.all(this.pending);
    const chunks = []; let size = 0; const offsets = [0];
    const push = (d) => { const b = typeof d === 'string' ? latin1(d) : d; chunks.push(b); size += b.length; };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // %PDF-1.4 + binary marker
    for (let n = 1; n < this.objs.length; n += 1) {
      if (!this.objs[n]) throw new Error(`PDF object ${n} was never written`);
      offsets[n] = size;
      push(`${n} 0 obj\n`);
      for (const part of this.objs[n]) push(part);
      push('\nendobj\n');
    }
    const xref = size; const total = this.objs.length;
    let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n += 1) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    push(table);
    const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    push(`trailer\n<< /Size ${total} /Root ${rootNum} 0 R /Info ${infoNum} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }
}

// ---------------------------------------------------------------------------
// Style resolution

const NON_RENDERING = new Set(['defs', 'clipPath', 'mask', 'marker', 'symbol', 'pattern', 'linearGradient', 'radialGradient', 'style', 'title', 'desc', 'metadata', 'filter', 'script', 'foreignObject', 'animate', 'set', 'animateTransform']);

const ROOT_PROPS = {
  fill: '#000000', fillOpacity: 1, fillRule: 'nonzero', stroke: 'none', strokeWidth: 1, strokeOpacity: 1,
  dash: null, dashOffset: 0, cap: 0, join: 0, miter: 4, color: '#000000',
  fontFamily: 'Times New Roman, serif', fontSize: 16, fontWeight: 'normal', fontStyle: 'normal',
  anchor: 'start', decoration: 'none', direction: 'ltr', hidden: false, preserve: false,
};

const styleCache = new WeakMap();
function inlineStyle(node) {
  let map = styleCache.get(node);
  if (map) return map;
  map = new Map();
  const raw = node.getAttribute('style');
  if (raw) for (const decl of raw.split(';')) { const k = decl.indexOf(':'); if (k > 0) map.set(decl.slice(0, k).trim().toLowerCase(), decl.slice(k + 1).trim()); }
  styleCache.set(node, map);
  return map;
}

/** Presentation attribute or inline style declaration (style wins), trimmed; '' when absent. */
function prop(node, name) {
  const st = inlineStyle(node).get(name);
  if (st !== undefined && st !== '') return st;
  const a = node.getAttribute(name);
  return a == null ? '' : a.trim();
}

const opacityValue = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v).trim();
  const n = s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  return Number.isFinite(n) ? clamp01(n) : null;
};

function parseDash(value, em) {
  const s = String(value ?? '').trim();
  if (!s || s === 'none') return null;
  const parts = s.split(/[\s,]+/).filter(Boolean).map((p) => parseLength(p, { em, fallback: NaN }));
  if (!parts.length || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.reduce((a, b) => a + b, 0) <= 0) return null;
  return parts.length % 2 ? parts.concat(parts) : parts;
}

/** Inherited properties of `node` given its parent's resolved properties. */
function resolveProps(node, parent) {
  const p = { ...parent };
  const set = (name, fn) => { const v = prop(node, name); if (v !== '' && v !== 'inherit') fn(v); };
  set('color', (v) => { p.color = v; });
  set('font-size', (v) => {
    const kw = FONT_KEYWORDS[v];
    if (kw) p.fontSize = kw;
    else if (v === 'smaller') p.fontSize = parent.fontSize / 1.2;
    else if (v === 'larger') p.fontSize = parent.fontSize * 1.2;
    else p.fontSize = parseLength(v, { em: parent.fontSize, ref: parent.fontSize, fallback: parent.fontSize });
  });
  set('font-family', (v) => { p.fontFamily = v; });
  set('font-weight', (v) => { p.fontWeight = v; });
  set('font-style', (v) => { p.fontStyle = v; });
  set('text-anchor', (v) => { p.anchor = v; });
  set('text-decoration', (v) => { p.decoration = v; });
  set('direction', (v) => { p.direction = v; });
  set('fill', (v) => { p.fill = v; });
  set('fill-opacity', (v) => { p.fillOpacity = opacityValue(v) ?? p.fillOpacity; });
  set('fill-rule', (v) => { p.fillRule = v; });
  set('stroke', (v) => { p.stroke = v; });
  set('stroke-opacity', (v) => { p.strokeOpacity = opacityValue(v) ?? p.strokeOpacity; });
  set('stroke-width', (v) => { p.strokeWidth = Math.max(0, parseLength(v, { em: p.fontSize, fallback: p.strokeWidth })); });
  set('stroke-dasharray', (v) => { p.dash = parseDash(v, p.fontSize); });
  set('stroke-dashoffset', (v) => { p.dashOffset = parseLength(v, { em: p.fontSize, fallback: 0 }); });
  set('stroke-linecap', (v) => { p.cap = v === 'round' ? 1 : v === 'square' ? 2 : 0; });
  set('stroke-linejoin', (v) => { p.join = v === 'round' ? 1 : v === 'bevel' ? 2 : 0; });
  set('stroke-miterlimit', (v) => { const n = parseFloat(v); if (n >= 1) p.miter = n; });
  set('visibility', (v) => { p.hidden = v === 'hidden' || v === 'collapse'; });
  const space = node.getAttribute('xml:space');
  if (space) p.preserve = space === 'preserve';
  const ws = prop(node, 'white-space');
  if (ws) p.preserve = /^pre/.test(ws);
  return p;
}

// ---------------------------------------------------------------------------
// Conversion context

class Converter {
  constructor(doc, opts) {
    this.doc = doc;
    this.opts = opts;
    this.pdf = new PdfWriter();
    this.fonts = new Map(); // font key → { name, obj }
    this.gstates = new Map(); // "ca|CA" → name
    this.xobjects = []; // { name, obj }
    this.imageCache = new Map();
    this.measureCache = new Map();
    this.rasterCache = new Map();
    this.ids = new Map();
    for (const el of doc.querySelectorAll('[id]')) this.ids.set(el.getAttribute('id'), el);
    this.stats = { vectorTextRuns: 0, rasterTextChunks: 0, images: 0, groups: 0, shapes: 0, warnings: [] };
    this.resObj = this.pdf.reserve(); // /Resources dictionary shared by the page and all forms
    this.viewport = { w: 100, h: 100 };
  }

  warn(msg) { if (!this.stats.warnings.includes(msg)) this.stats.warnings.push(msg); }

  byHref(node) {
    const href = node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? node.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
    if (!href) return null;
    return href.startsWith('#') ? this.ids.get(href.slice(1)) || null : null;
  }

  urlRef(value) {
    const m = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(String(value ?? '').trim());
    return m ? this.ids.get(m[1]) || null : null;
  }

  fontName(font) {
    let rec = this.fonts.get(font.key);
    if (!rec) {
      const obj = this.pdf.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding /WinAnsiEncoding >>`);
      rec = { name: `F${this.fonts.size + 1}`, obj };
      this.fonts.set(font.key, rec);
    }
    return rec.name;
  }

  /** ExtGState name for fill/stroke constant alpha, or '' when both are 1. */
  gs(fillA = 1, strokeA = 1) {
    const ca = Math.round(clamp01(fillA) * 1000) / 1000; const CA = Math.round(clamp01(strokeA) * 1000) / 1000;
    if (ca === 1 && CA === 1) return '';
    const key = `${ca}|${CA}`;
    let name = this.gstates.get(key);
    if (!name) { name = `G${this.gstates.size + 1}`; this.gstates.set(key, name); }
    return name;
  }

  /** Wrap ops into a transparency group (Form XObject) painted with constant alpha `opacity`. */
  group(ops, opacity) {
    const obj = this.pdf.stream(
      `/Type /XObject /Subtype /Form /FormType 1 /BBox [-100000 -100000 100000 100000] /Matrix [1 0 0 1 0 0] /Group << /S /Transparency /I false /K false >> /Resources ${this.resObj} 0 R`,
      ops.join('\n'),
    );
    const name = `Fm${this.xobjects.length + 1}`;
    this.xobjects.push({ name, obj });
    this.stats.groups += 1;
    const gs = this.gs(opacity, opacity);
    return gs ? ['q', `/${gs} gs`, `/${name} Do`, 'Q'] : ['q', `/${name} Do`, 'Q'];
  }

  addXObject(prefix, obj) {
    const name = `${prefix}${this.xobjects.length + 1}`;
    this.xobjects.push({ name, obj });
    return name;
  }

  // ----- paint -------------------------------------------------------------

  /** Resolve a fill/stroke value to { r, g, b, a } or null. */
  paint(value, props) {
    const v = String(value ?? '').trim();
    if (!v || v === 'none') return null;
    if (v.startsWith('url(')) {
      const ref = this.urlRef(v);
      if (ref && /gradient$/i.test(ref.localName)) { // approximation: first stop colour
        const stop = ref.querySelector('stop') || (this.byHref(ref)?.querySelector('stop'));
        if (stop) {
          const c = parseColor(prop(stop, 'stop-color') || '#000000', props.color);
          if (c) { const so = opacityValue(prop(stop, 'stop-opacity')); return so == null ? c : { ...c, a: c.a * so }; }
        }
        this.warn('gradient fill approximated by its first stop');
      } else this.warn('unsupported paint server');
      const fallback = /\)\s*(\S.*)$/.exec(v);
      return fallback ? this.paint(fallback[1], props) : null;
    }
    return parseColor(v, props.color);
  }

  /** Paint a path (array of PDF path ops) with the element's fill/stroke. */
  paintPath(ops, pathOps, props, { fillable = true } = {}) {
    if (props.hidden) return;
    const fill = fillable ? this.paint(props.fill, props) : null;
    const stroke = props.strokeWidth > 0 ? this.paint(props.stroke, props) : null;
    if (!fill && !stroke) return;
    const fa = fill ? fill.a * props.fillOpacity : 1;
    const sa = stroke ? stroke.a * props.strokeOpacity : 1;
    if ((fill && fa <= 0) && (!stroke || sa <= 0)) return;
    const g = ['q'];
    const gs = this.gs(fa, sa);
    if (gs) g.push(`/${gs} gs`);
    if (fill) g.push(`${rgbOps(fill)} rg`);
    if (stroke) {
      g.push(`${rgbOps(stroke)} RG`, `${f(props.strokeWidth)} w`, `${props.cap} J`, `${props.join} j`, `${f(props.miter)} M`);
      if (props.dash) g.push(`[${props.dash.map(f).join(' ')}] ${f(props.dashOffset)} d`);
    }
    g.push(...pathOps);
    const evenOdd = props.fillRule === 'evenodd';
    if (fill && stroke) g.push(evenOdd ? 'B*' : 'B');
    else if (fill) g.push(evenOdd ? 'f*' : 'f');
    else g.push('S');
    g.push('Q');
    for (const op of g) ops.push(op);
    this.stats.shapes += 1;
  }

  // ----- shapes ------------------------------------------------------------

  len(node, name, props, ref = 0, fallback = 0) {
    return parseLength(node.getAttribute(name), { em: props.fontSize, ref, fallback });
  }

  shapeSegments(tag, node, props) {
    const L = (name, ref, fb = 0) => this.len(node, name, props, ref, fb);
    const { w: vw, h: vh } = this.viewport;
    switch (tag) {
      case 'rect': {
        const w = L('width', vw); const h = L('height', vh);
        if (!(w > 0) || !(h > 0)) return null;
        let rx = node.getAttribute('rx') == null ? NaN : L('rx', vw, NaN);
        let ry = node.getAttribute('ry') == null ? NaN : L('ry', vh, NaN);
        if (Number.isNaN(rx) && Number.isNaN(ry)) { rx = 0; ry = 0; } else if (Number.isNaN(rx)) rx = ry; else if (Number.isNaN(ry)) ry = rx;
        return rectSegs(L('x', vw), L('y', vh), w, h, rx, ry);
      }
      case 'circle': {
        const r = L('r', Math.hypot(vw, vh) / Math.SQRT2);
        return r > 0 ? ellipseSegs(L('cx', vw), L('cy', vh), r, r) : null;
      }
      case 'ellipse': {
        const rx = L('rx', vw); const ry = L('ry', vh);
        return rx > 0 && ry > 0 ? ellipseSegs(L('cx', vw), L('cy', vh), rx, ry) : null;
      }
      case 'line': return [['M', L('x1', vw), L('y1', vh)], ['L', L('x2', vw), L('y2', vh)]];
      case 'polyline':
      case 'polygon': {
        const nums = numbersIn(node.getAttribute('points'));
        if (nums.length < 4) return null;
        const segs = [];
        for (let i = 0; i + 1 < nums.length; i += 2) segs.push([i ? 'L' : 'M', nums[i], nums[i + 1]]);
        if (tag === 'polygon') segs.push(['Z']);
        return segs;
      }
      case 'path': {
        const segs = parsePathData(node.getAttribute('d'));
        return segs.length > 1 || (segs.length === 1 && segs[0][0] !== 'M') ? segs : null;
      }
      default: return null;
    }
  }

  drawShape(tag, node, props, ops) {
    const segs = this.shapeSegments(tag, node, props);
    if (!segs) return;
    this.paintPath(ops, segsToOps(segs), props, { fillable: tag !== 'line' });
  }

  // ----- clipping ----------------------------------------------------------

  clipOps(node, props) {
    const ref = this.urlRef(prop(node, 'clip-path'));
    if (!ref || ref.localName !== 'clipPath') return [];
    const base = parseTransform(ref.getAttribute('transform'));
    const ops = [];
    const collect = (parent, matrix) => {
      for (const child of parent.children) {
        const tag = child.localName;
        const m = mul(matrix, parseTransform(child.getAttribute('transform')));
        if (tag === 'g') { collect(child, m); continue; }
        const segs = this.shapeSegments(tag, child, props);
        if (segs) ops.push(...segsToOps(segs, m));
      }
    };
    collect(ref, base);
    if (!ops.length) return [];
    return [...ops, prop(ref.firstElementChild || ref, 'clip-rule') === 'evenodd' ? 'W*' : 'W', 'n'];
  }

  // ----- text --------------------------------------------------------------

  /** Browser-measured advance of `text` in CSS font `run` (null when no canvas is available). */
  browserWidth(run, text) {
    const ctx = probe();
    if (!ctx) return null;
    const key = `${this.canvasFont(run, 1)}|${run.dir}|${text}`;
    let w = this.measureCache.get(key);
    if (w === undefined) {
      try { ctx.font = this.canvasFont(run, 1); ctx.direction = run.dir; w = ctx.measureText(text).width; } catch { w = null; }
      if (!(w > 0)) w = null;
      if (this.measureCache.size > 5000) this.measureCache.clear();
      this.measureCache.set(key, w);
    }
    return w;
  }

  makeRun(text, props) {
    const font = pickFont(props.fontFamily, isBoldWeight(props.fontWeight), isItalicStyle(props.fontStyle));
    const fill = props.hidden ? null : this.paint(props.fill, props);
    const stroke = !props.hidden && props.strokeWidth > 0 ? this.paint(props.stroke, props) : null;
    const clean = cleanText(text);
    const bytes = encodeWinAnsi(clean);
    const run = {
      text: clean, raw: text, font, size: props.fontSize, family: props.fontFamily, bytes,
      fill, stroke, fillOpacity: props.fillOpacity, strokeOpacity: props.strokeOpacity, strokeWidth: props.strokeWidth,
      under: /underline/.test(props.decoration), strike: /line-through/.test(props.decoration),
      dir: props.direction === 'rtl' ? 'rtl' : 'ltr', anchor: props.anchor, hscale: 1, width: 0, props, preserve: props.preserve,
    };
    if (bytes) {
      // Standard-font (AFM) width; if the browser's font for this CSS family is clearly narrower/wider
      // (Calibri, Verdana, Cambria …), squeeze/stretch the run so line breaks and anchors match the app.
      const afm = (bytesWidth(bytes, font) * props.fontSize) / 1000;
      const own = this.browserWidth(run, clean);
      let ratio = own && afm > 0 ? own / afm : 1;
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.015) ratio = 1;
      run.hscale = Math.min(1.6, Math.max(0.6, ratio));
      run.width = afm * run.hscale;
    } else {
      run.width = this.browserWidth(run, clean) ?? clean.length * props.fontSize * 0.5;
    }
    return run;
  }

  canvasFont(run, scale) {
    return `${run.font.italic ? 'italic' : 'normal'} ${run.font.bold ? 'bold' : 'normal'} ${run.size * scale}px ${run.family}`;
  }

  /** Collect text content events (text pieces and absolute/relative position changes). */
  gatherText(node, props, items) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 4) {
        items.push({ kind: 'text', text: child.nodeValue, props });
      } else if (child.nodeType === 1) {
        const tag = child.localName;
        if (tag !== 'tspan' && tag !== 'a' && tag !== 'textPath') continue;
        if (prop(child, 'display') === 'none') continue;
        const p = resolveProps(child, props);
        const first = (name) => { const n = numbersIn(child.getAttribute(name)); return n.length ? n[0] : null; };
        items.push({ kind: 'pos', x: first('x'), y: first('y'), dx: first('dx'), dy: first('dy') });
        this.gatherText(child, p, items);
      }
    }
  }

  drawText(node, props, ops) {
    const items = [];
    this.gatherText(node, props, items);
    const first = (name) => { const n = numbersIn(node.getAttribute(name)); return n.length ? n[0] : 0; };
    let curX = first('x') + first('dx'); let curY = first('y') + first('dy');
    const chunks = []; let cur = null; let lastSpace = !props.preserve;

    // A chunk = text laid out from one absolute position; text-anchor applies to the chunk as a whole.
    const closeChunk = () => {
      const c = cur; cur = null;
      if (!c) return;
      const last = c.runs[c.runs.length - 1];
      if (!last.preserve && /\s$/.test(last.text)) c.runs[c.runs.length - 1] = this.makeRun(last.raw.replace(/\s+$/, ''), last.props);
      const runs = c.runs.filter((r) => r.text !== '');
      if (!runs.length) return;
      const chunk = { runs, x: c.x, y: c.y, width: runs.reduce((a, r) => a + r.width, 0) };
      this.placeChunk(chunk);
      curX = c.x + chunk.width; curY = c.y;
      if (!runs.every((r) => /^\s*$/.test(r.text))) chunks.push(chunk);
    };

    for (const it of items) {
      if (it.kind === 'pos') {
        if (it.x != null || it.y != null || it.dx || it.dy) {
          closeChunk();
          if (it.x != null) curX = it.x;
          if (it.y != null) curY = it.y;
          if (it.dx) curX += it.dx;
          if (it.dy) curY += it.dy;
        }
        continue;
      }
      let t = it.text.replace(/[\r\n\t]/g, ' ');
      if (!it.props.preserve) {
        t = t.replace(/ {2,}/g, ' ');
        if (lastSpace && t.startsWith(' ')) t = t.slice(1);
        if (t) lastSpace = t.endsWith(' ');
      }
      if (!t) continue;
      if (!cur) cur = { x: curX, y: curY, runs: [] };
      cur.runs.push(this.makeRun(t, it.props));
    }
    closeChunk();
    for (const chunk of chunks) this.emitChunk(chunk, ops);
  }

  placeChunk(chunk) {
    const run0 = chunk.runs[0];
    const rtl = run0.dir === 'rtl';
    // In right-to-left text "start" is the right-hand end.
    const anchor = run0.anchor === 'middle' ? 'middle' : (run0.anchor === 'end') !== rtl ? 'end' : 'start';
    chunk.startX = anchor === 'middle' ? chunk.x - chunk.width / 2 : anchor === 'end' ? chunk.x - chunk.width : chunk.x;
  }

  emitChunk(chunk, ops) {
    if (chunk.runs.every((r) => r.bytes)) {
      let x = chunk.startX;
      for (const run of chunk.runs) { this.emitVectorRun(run, x, chunk.y, ops); x += run.width; }
    } else {
      this.emitRasterChunk(chunk, ops);
    }
  }

  emitVectorRun(run, x, y, ops) {
    if (!run.bytes.length) return;
    const visible = run.fill || run.stroke;
    if (!visible) return;
    const g = ['q'];
    const fa = run.fill ? run.fill.a * run.fillOpacity : 1; const sa = run.stroke ? run.stroke.a * run.strokeOpacity : 1;
    const gs = this.gs(fa, sa);
    if (gs) g.push(`/${gs} gs`);
    if (run.fill) g.push(`${rgbOps(run.fill)} rg`);
    if (run.stroke) g.push(`${rgbOps(run.stroke)} RG`, `${f(run.strokeWidth)} w`);
    g.push('BT', `/${this.fontName(run.font)} ${f(run.size)} Tf`);
    const mode = run.fill && run.stroke ? 2 : run.stroke ? 1 : 0;
    if (mode) g.push(`${mode} Tr`);
    if (run.hscale !== 1) g.push(`${f(run.hscale * 100)} Tz`);
    // The page CTM is y-flipped; flipping the text matrix again keeps glyphs upright.
    g.push(`1 0 0 -1 ${f(x)} ${f(y)} Tm`, `${pdfLiteral(run.bytes)} Tj`, 'ET');
    if (run.fill && (run.under || run.strike)) {
      const dm = decorationMetrics(run.font);
      const th = Math.max(0.3, run.size * dm.thickness);
      if (run.under) g.push(`${f(x)} ${f(y + run.size * dm.underlineOffset - th / 2)} ${f(run.width)} ${f(th)} re f`);
      if (run.strike) g.push(`${f(x)} ${f(y - run.size * dm.strikeOffset - th / 2)} ${f(run.width)} ${f(th)} re f`);
    }
    g.push('Q');
    for (const op of g) ops.push(op);
    this.stats.vectorTextRuns += 1;
  }

  /** Text the standard fonts cannot encode: draw the whole chunk to a canvas and embed it as an image. */
  emitRasterChunk(chunk, ops) {
    if (typeof document === 'undefined') { this.warn('raster text needs a browser'); return; }
    const visibleRuns = chunk.runs.filter((r) => r.fill);
    if (!visibleRuns.length) return;
    let S = RASTER_SCALE;
    const measure = document.createElement('canvas').getContext('2d');
    let asc = 0; let desc = 0; let size = 0;
    for (const run of chunk.runs) {
      measure.font = this.canvasFont(run, 1); measure.direction = run.dir;
      const m = measure.measureText(run.text);
      asc = Math.max(asc, m.actualBoundingBoxAscent || 0, run.size * 0.85);
      desc = Math.max(desc, m.actualBoundingBoxDescent || 0, run.size * 0.3);
      size = Math.max(size, run.size);
    }
    const padX = Math.ceil(size * 0.3) + 1; const padY = 2;
    const boxW = chunk.width + padX * 2; const boxH = asc + desc + padY * 2;
    S = Math.min(S, 8192 / boxW, 8192 / boxH);
    const cw = Math.max(1, Math.ceil(boxW * S)); const ch = Math.max(1, Math.ceil(boxH * S));
    const key = [cw, ch, S, asc, ...chunk.runs.map((r) => `${this.canvasFont(r, 1)}|${r.dir}|${r.text}|${r.under}|${r.strike}|${r.fill ? rgbOps(r.fill) : ''}|${r.width}`)].join('~');
    let img = this.rasterCache.get(key);
    if (!img) { img = this.drawRasterChunk(chunk, { S, asc, padX, padY, cw, ch, visibleRuns }); this.rasterCache.set(key, img); }
    const w = cw / S; const h = ch / S;
    const left = chunk.startX - padX; const top = chunk.y - asc - padY;
    const fa = visibleRuns[0].fill.a * visibleRuns[0].fillOpacity;
    const g = ['q'];
    const gs = this.gs(fa, 1);
    if (gs) g.push(`/${gs} gs`);
    g.push(`${f(w)} 0 0 ${f(-h)} ${f(left)} ${f(top + h)} cm`, `/${img} Do`, 'Q');
    for (const op of g) ops.push(op);
    this.stats.rasterTextChunks += 1;
  }

  /** Draw a text chunk to a canvas and return the image XObject name. */
  drawRasterChunk(chunk, { S, asc, padX, padY, cw, ch, visibleRuns }) {
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let x = padX * S; const base = (padY + asc) * S;
    const colors = new Set();
    for (const run of chunk.runs) {
      const c = run.fill || { r: 0, g: 0, b: 0, a: 1 };
      ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
      colors.add(ctx.fillStyle);
      ctx.font = this.canvasFont(run, S); ctx.direction = run.dir;
      ctx.fillText(run.text, x, base);
      if (run.under || run.strike) {
        const th = Math.max(1, run.size * 0.05 * S);
        if (run.under) ctx.fillRect(x, base + run.size * 0.1 * S - th / 2, run.width * S, th);
        if (run.strike) ctx.fillRect(x, base - run.size * 0.27 * S - th / 2, run.width * S, th);
      }
      x += run.width * S;
    }
    const { data } = ctx.getImageData(0, 0, cw, ch);
    const alpha = new Uint8Array(cw * ch);
    const rgb = new Uint8Array(cw * ch * 3);
    const base0 = visibleRuns[0].fill;
    const r8 = Math.round(base0.r * 255); const g8 = Math.round(base0.g * 255); const b8 = Math.round(base0.b * 255);
    // Single-colour text: flat colour plane (compresses to nothing). Coloured glyphs (emoji, several runs): real pixels.
    let flat = colors.size === 1;
    if (flat) {
      for (let i = 0; i < cw * ch; i += 1) {
        if (data[i * 4 + 3] > 200 && (Math.abs(data[i * 4] - r8) > 40 || Math.abs(data[i * 4 + 1] - g8) > 40 || Math.abs(data[i * 4 + 2] - b8) > 40)) { flat = false; break; }
      }
    }
    for (let i = 0; i < cw * ch; i += 1) {
      alpha[i] = data[i * 4 + 3];
      if (flat) { rgb[i * 3] = r8; rgb[i * 3 + 1] = g8; rgb[i * 3 + 2] = b8; } else { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; }
    }
    return this.addRgbImage(cw, ch, rgb, alpha, { predict: false });
  }

  // ----- images ------------------------------------------------------------

  /** Add a decoded RGB (+ optional alpha) bitmap as an image XObject; returns its resource name. */
  addRgbImage(w, h, rgb, alpha, { predict = true } = {}) {
    let smask = '';
    if (alpha && alpha.some((a) => a !== 255)) {
      const maskObj = this.pdf.stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate true`, alpha, { predict: predict ? { colors: 1, columns: w } : null });
      smask = ` /SMask ${maskObj} 0 R`;
    }
    const obj = this.pdf.stream(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate true${smask}`, rgb, { predict: predict ? { colors: 3, columns: w } : null });
    this.stats.images += 1;
    return this.addXObject('Im', obj);
  }

  async loadImage(href) {
    if (this.imageCache.has(href)) return this.imageCache.get(href);
    const p = this.decodeImage(href).catch((err) => { this.warn(`image skipped: ${err.message}`); return null; });
    this.imageCache.set(href, p);
    return p;
  }

  async decodeImage(href) {
    const dataUrl = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/s.exec(href);
    let bytes = null; let mime = '';
    if (dataUrl) {
      mime = dataUrl[1].toLowerCase();
      if (/;base64/i.test(dataUrl[2])) {
        const bin = atob(dataUrl[3].replace(/\s+/g, ''));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      } else bytes = new TextEncoder().encode(decodeURIComponent(dataUrl[3]));
    }
    if (bytes && (mime === 'image/jpeg' || mime === 'image/jpg')) {
      const info = parseJpeg(bytes);
      if (info && info.bits === 8 && info.orientation === 1 && (info.comps === 1 || info.comps === 3) && info.w > 0 && info.h > 0) {
        const cs = info.comps === 1 ? 'DeviceGray' : 'DeviceRGB';
        const obj = this.pdf.stream(`/Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace /${cs} /BitsPerComponent 8 /Interpolate true`, bytes, { filter: ' /Filter /DCTDecode' });
        this.stats.images += 1;
        return { name: this.addXObject('Im', obj), w: info.w, h: info.h };
      }
    }
    if (typeof document === 'undefined') throw new Error('no canvas');
    const img = new Image();
    img.decoding = 'sync';
    img.src = bytes ? URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' })) : href;
    try { await img.decode(); } finally { if (bytes) URL.revokeObjectURL(img.src); }
    const isSvg = /svg/.test(mime);
    const k = isSvg ? 2 : 1;
    const w = Math.max(1, Math.round((img.naturalWidth || 300) * k)); const h = Math.max(1, Math.round((img.naturalHeight || 150) * k));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const rgb = new Uint8Array(w * h * 3); const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i += 1) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; alpha[i] = data[i * 4 + 3]; }
    return { name: this.addRgbImage(w, h, rgb, alpha), w: img.naturalWidth || w, h: img.naturalHeight || h };
  }

  async drawImage(node, props, ops) {
    if (props.hidden) return;
    const href = node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? node.getAttributeNS?.('http://www.w3.org/1999/xlink', 'href');
    if (!href) return;
    const img = await this.loadImage(href.trim());
    if (!img) return;
    const { w: vw, h: vh } = this.viewport;
    const x = this.len(node, 'x', props, vw); const y = this.len(node, 'y', props, vh);
    let w = this.len(node, 'width', props, vw, NaN); let h = this.len(node, 'height', props, vh, NaN);
    if (Number.isNaN(w) && Number.isNaN(h)) { w = img.w; h = img.h; } else if (Number.isNaN(w)) w = (h * img.w) / img.h; else if (Number.isNaN(h)) h = (w * img.h) / img.w;
    if (!(w > 0) || !(h > 0)) return;
    const par = (node.getAttribute('preserveAspectRatio') || 'xMidYMid meet').trim().split(/\s+/);
    let dx = x; let dy = y; let dw = w; let dh = h; let clip = false;
    if (par[0] !== 'none') {
      const slice = par[1] === 'slice';
      const s = slice ? Math.max(w / img.w, h / img.h) : Math.min(w / img.w, h / img.h);
      dw = img.w * s; dh = img.h * s;
      const al = par[0];
      dx = x + (/xMin/.test(al) ? 0 : /xMax/.test(al) ? w - dw : (w - dw) / 2);
      dy = y + (/YMin/.test(al) ? 0 : /YMax/.test(al) ? h - dh : (h - dh) / 2);
      clip = slice;
    }
    const g = ['q'];
    if (clip) g.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n`);
    g.push(`${f(dw)} 0 0 ${f(-dh)} ${f(dx)} ${f(dy + dh)} cm`, `/${img.name} Do`, 'Q');
    for (const op of g) ops.push(op);
  }

  // ----- tree walk ---------------------------------------------------------

  async renderChildren(node, props, ops, depth) {
    for (const child of node.children) await this.renderElement(child, props, ops, depth);
  }

  viewportMatrix(viewBox, par, w, h) {
    const vb = numbersIn(viewBox);
    if (vb.length < 4 || !(vb[2] > 0) || !(vb[3] > 0)) return IDENT;
    const [vx, vy, vwid, vhei] = vb;
    const parts = String(par || 'xMidYMid meet').trim().split(/\s+/);
    if (parts[0] === 'none') return [w / vwid, 0, 0, h / vhei, -vx * (w / vwid), -vy * (h / vhei)];
    const s = parts[1] === 'slice' ? Math.max(w / vwid, h / vhei) : Math.min(w / vwid, h / vhei);
    const al = parts[0];
    const ox = /xMin/.test(al) ? 0 : /xMax/.test(al) ? w - vwid * s : (w - vwid * s) / 2;
    const oy = /YMin/.test(al) ? 0 : /YMax/.test(al) ? h - vhei * s : (h - vhei * s) / 2;
    return [s, 0, 0, s, ox - vx * s, oy - vy * s];
  }

  async renderElement(node, parent, out, depth = 0) {
    if (node.nodeType !== 1 || depth > 64) return;
    const tag = node.localName;
    if (NON_RENDERING.has(tag)) return;
    if (prop(node, 'display') === 'none') return;
    const props = resolveProps(node, parent);
    let ops = [];
    let inner = IDENT;

    switch (tag) {
      case 'g':
      case 'a':
      case 'switch':
        await this.renderChildren(node, props, ops, depth + 1);
        break;
      case 'svg': { // nested viewport
        const { w: vw, h: vh } = this.viewport;
        const x = this.len(node, 'x', props, vw); const y = this.len(node, 'y', props, vh);
        const w = this.len(node, 'width', props, vw, vw); const h = this.len(node, 'height', props, vh, vh);
        const vbm = this.viewportMatrix(node.getAttribute('viewBox'), node.getAttribute('preserveAspectRatio'), w, h);
        const inside = [];
        await this.renderChildren(node, props, inside, depth + 1);
        if (inside.length) {
          ops.push('q');
          if (x || y) ops.push(`1 0 0 1 ${f(x)} ${f(y)} cm`);
          if (prop(node, 'overflow') !== 'visible') ops.push(`0 0 ${f(w)} ${f(h)} re W n`);
          if (!isIdentity(vbm)) ops.push(`${vbm.map(f).join(' ')} cm`);
          for (const op of inside) ops.push(op);
          ops.push('Q');
        }
        break;
      }
      case 'use': {
        const target = this.byHref(node);
        if (!target) break;
        const x = this.len(node, 'x', props); const y = this.len(node, 'y', props);
        if (x || y) inner = [1, 0, 0, 1, x, y];
        await this.renderElement(target, props, ops, depth + 1);
        break;
      }
      case 'rect': case 'circle': case 'ellipse': case 'line': case 'polyline': case 'polygon': case 'path':
        this.drawShape(tag, node, props, ops);
        break;
      case 'image':
        await this.drawImage(node, props, ops);
        break;
      case 'text':
        if (!props.hidden) this.drawText(node, props, ops);
        break;
      default:
        this.warn(`unsupported element <${tag}>`);
        return;
    }
    if (prop(node, 'filter') && prop(node, 'filter') !== 'none') this.warn('filters are ignored');
    if (!ops.length) return;

    const opacity = opacityValue(prop(node, 'opacity'));
    if (opacity != null && opacity <= 0) return;
    if (opacity != null && opacity < 1) ops = this.group(ops, opacity);
    const clip = this.clipOps(node, props);
    const own = mul(parseTransform(node.getAttribute('transform')), inner);
    if (clip.length) ops = ['q', ...clip, ...ops, 'Q'];
    if (!isIdentity(own)) { out.push('q', `${own.map(f).join(' ')} cm`); for (const op of ops) out.push(op); out.push('Q'); } else for (const op of ops) out.push(op);
  }
}

/** EXIF orientation (1 = upright) from an APP1 segment whose length field starts at `i`. */
function exifOrientation(bytes, i) {
  const d = i + 2;
  if (!(bytes[d] === 0x45 && bytes[d + 1] === 0x78 && bytes[d + 2] === 0x69 && bytes[d + 3] === 0x66 && bytes[d + 4] === 0 && bytes[d + 5] === 0)) return 1;
  const t = d + 6; const le = bytes[t] === 0x49;
  const u16 = (p) => (le ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
  const u32 = (p) => (le ? bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536 + bytes[p + 3] * 16777216 : bytes[p] * 16777216 + bytes[p + 1] * 65536 + bytes[p + 2] * 256 + bytes[p + 3]);
  const ifd = t + u32(t + 4);
  const n = u16(ifd);
  if (!(n > 0 && n < 200)) return 1;
  for (let k = 0; k < n; k += 1) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

function parseJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2; let orientation = 1;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    let marker = bytes[i + 1]; i += 2;
    while (marker === 0xff && i < bytes.length) { marker = bytes[i]; i += 1; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const len = (bytes[i] << 8) | bytes[i + 1];
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(bytes, i);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { bits: bytes[i + 2], h: (bytes[i + 3] << 8) | bytes[i + 4], w: (bytes[i + 5] << 8) | bytes[i + 6], comps: bytes[i + 7], orientation };
    }
    if (marker === 0xda) return null;
    i += len;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * Convert an SVG string to a vector PDF. Returns { blob, stats }.
 * opts: { title, width, height (px; default: the SVG's own size), margin (pt, default 12) }
 */
export async function convertSvgToPdf(svg, opts = {}) {
  if (typeof DOMParser === 'undefined') throw new Error('Vector PDF export needs a browser (DOMParser).');
  const doc = new DOMParser().parseFromString(String(svg), 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('The SVG could not be parsed.');

  const vb = numbersIn(root.getAttribute('viewBox'));
  const hasVB = vb.length >= 4 && vb[2] > 0 && vb[3] > 0;
  const attrW = parseLength(root.getAttribute('width'), { ref: hasVB ? vb[2] : 0, fallback: NaN });
  const attrH = parseLength(root.getAttribute('height'), { ref: hasVB ? vb[3] : 0, fallback: NaN });
  const widthPx = opts.width > 0 ? opts.width : (attrW > 0 ? attrW : hasVB ? vb[2] : 300);
  const heightPx = opts.height > 0 ? opts.height : (attrH > 0 ? attrH : hasVB ? vb[3] : 150);
  const margin = opts.margin ?? 12;

  let k = 1;
  const maxContent = Math.max(widthPx, heightPx) * PT + margin * 2;
  if (maxContent > MAX_PAGE_PT) k = (MAX_PAGE_PT - margin * 2) / (Math.max(widthPx, heightPx) * PT);
  const pageW = widthPx * PT * k + margin * 2; const pageH = heightPx * PT * k + margin * 2;

  const cv = new Converter(doc, opts);
  const vbRect = hasVB ? vb : [0, 0, widthPx, heightPx];
  cv.viewport = { w: vbRect[2], h: vbRect[3] };
  // user space → CSS px (viewBox fit) → points, flipped so y grows upward.
  const fit = hasVB ? cv.viewportMatrix(root.getAttribute('viewBox'), root.getAttribute('preserveAspectRatio'), widthPx, heightPx) : IDENT;
  const toPdf = [PT * k, 0, 0, -PT * k, margin, margin + heightPx * PT * k];
  const base = mul(toPdf, fit);

  const rootProps = resolveProps(root, ROOT_PROPS);
  const ops = ['q', `${base.map(f).join(' ')} cm`, `${f(vbRect[0])} ${f(vbRect[1])} ${f(vbRect[2])} ${f(vbRect[3])} re W n`];
  await cv.renderChildren(root, rootProps, ops, 0);
  ops.push('Q');

  const pdf = cv.pdf;
  const catalog = pdf.reserve(); const pages = pdf.reserve(); const info = pdf.reserve(); const page = pdf.reserve(); const content = pdf.reserve();
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
  pdf.set(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  const now = new Date();
  const stamp = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  pdf.set(info, `<< /Title ${pdfTextString(opts.title || 'GradDocs export')} /Producer (GradDocs) /Creator (GradDocs) /CreationDate (${stamp}) >>`);
  pdf.set(page, `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] /Resources ${cv.resObj} 0 R /Contents ${content} 0 R >>`);
  pdf.stream('', ops.join('\n'), { num: content });

  const fontsDict = [...cv.fonts.values()].map((r) => `/${r.name} ${r.obj} 0 R`).join(' ');
  const gsDict = [...cv.gstates.entries()].map(([key, name]) => { const [ca, CA] = key.split('|'); return `/${name} << /Type /ExtGState /ca ${ca} /CA ${CA} >>`; }).join(' ');
  const xoDict = cv.xobjects.map((x) => `/${x.name} ${x.obj} 0 R`).join(' ');
  pdf.set(cv.resObj, `<< /ProcSet [/PDF /Text /ImageB /ImageC]${fontsDict ? ` /Font << ${fontsDict} >>` : ''}${gsDict ? ` /ExtGState << ${gsDict} >>` : ''}${xoDict ? ` /XObject << ${xoDict} >>` : ''} >>`);

  const blob = await pdf.build(catalog, info);
  return { blob, stats: { ...cv.stats, bytes: blob.size, width: widthPx, height: heightPx } };
}

export async function svgToVectorPdf(svg, opts = {}) {
  return (await convertSvgToPdf(svg, opts)).blob;
}
