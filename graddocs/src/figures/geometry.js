// Connector geometry: endpoint resolution (smart attachment to shapes),
// straight / orthogonal / curved routing, label placement and arrowheads.
import { getShape } from './shapes.js';

const STUB = 22;
const DIRS = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } };

export const center = (n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Point where the ray from the node centre toward `p` leaves the shape outline. */
export function boundaryPoint(node, p) {
  const c = center(node);
  const shape = getShape(node.shape);
  if (shape.outline === 'lifeline') {
    const top = node.y + Math.min(44, node.h);
    return { x: c.x, y: Math.max(top + 6, Math.min(node.y + node.h, p.y)) };
  }
  let dx = p.x - c.x; let dy = p.y - c.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const hw = Math.max(1, node.w / 2); const hh = Math.max(1, node.h / 2);
  let t;
  if (shape.outline === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
  else if (shape.outline === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  else t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  if (node.shape === 'actor') t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export function anchorPoint(node, anchor) {
  return { x: node.x + anchor.x * node.w, y: node.y + anchor.y * node.h };
}

/** Side of a node an anchor sits on (for orthogonal routing). */
export function anchorSide(anchor, node) {
  if (node && getShape(node.shape).outline === 'lifeline') return null;
  const d = { w: anchor.x, e: 1 - anchor.x, n: anchor.y, s: 1 - anchor.y };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}

export const PORTS = { n: { x: 0.5, y: 0 }, e: { x: 1, y: 0.5 }, s: { x: 0.5, y: 1 }, w: { x: 0, y: 0.5 } };

function sidePoint(node, side) { return anchorPoint(node, PORTS[side]); }

function dominantSide(from, to) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n');
}

const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

function chooseSides(a, b) {
  // Prefer the axis with the larger gap between the two boxes.
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const ca = center(a); const cb = center(b);
  if (gapX > gapY) { const s = cb.x >= ca.x ? 'e' : 'w'; return [s, OPP[s]]; }
  const s = cb.y >= ca.y ? 's' : 'n';
  return [s, OPP[s]];
}

/** Resolve an edge end → { node, point, side, fixed } (point may be null for floating ends). */
function endInfo(end, nodes) {
  const node = end?.id ? nodes.get(end.id) : null;
  if (node) {
    if (end.anchor) return { node, point: anchorPoint(node, end.anchor), side: anchorSide(end.anchor, node), fixed: true };
    return { node, point: null, side: null, fixed: false };
  }
  return { node: null, point: { x: end?.x ?? 0, y: end?.y ?? 0 }, side: null, fixed: true };
}

function simplify(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) continue;
    out.push({ x: p.x, y: p.y });
  }
  // Remove collinear middle points.
  for (let i = out.length - 2; i > 0; i -= 1) {
    const a = out[i - 1]; const b = out[i]; const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.5 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

function orthogonalMiddle(s1, d1, s2, d2) {
  const h1 = d1 && d1.x !== 0; const h2 = d2 && d2.x !== 0;
  if (!d2) return h1 ? [{ x: s2.x, y: s1.y }] : [{ x: s1.x, y: s2.y }];
  if (!d1) return h2 ? [{ x: s1.x, y: s2.y }] : [{ x: s2.x, y: s1.y }];
  // Both ends leave in the same direction: go around the outermost stub.
  if (d1.x === d2.x && d1.y === d2.y) {
    if (h1) { const X = d1.x > 0 ? Math.max(s1.x, s2.x) : Math.min(s1.x, s2.x); return [{ x: X, y: s1.y }, { x: X, y: s2.y }]; }
    const Y = d1.y > 0 ? Math.max(s1.y, s2.y) : Math.min(s1.y, s2.y);
    return [{ x: s1.x, y: Y }, { x: s2.x, y: Y }];
  }
  if (h1 && h2) {
    if ((s2.x - s1.x) * d1.x >= 0 || (s1.x - s2.x) * d2.x >= 0) {
      const midX = (s1.x + s2.x) / 2;
      return [{ x: midX, y: s1.y }, { x: midX, y: s2.y }];
    }
    const midY = (s1.y + s2.y) / 2;
    return [{ x: s1.x, y: midY }, { x: s2.x, y: midY }];
  }
  if (!h1 && !h2) {
    if ((s2.y - s1.y) * d1.y >= 0 || (s1.y - s2.y) * d2.y >= 0) {
      const midY = (s1.y + s2.y) / 2;
      return [{ x: s1.x, y: midY }, { x: s2.x, y: midY }];
    }
    const midX = (s1.x + s2.x) / 2;
    return [{ x: midX, y: s1.y }, { x: midX, y: s2.y }];
  }
  // Perpendicular: single bend.
  return h1 ? [{ x: s2.x, y: s1.y }] : [{ x: s1.x, y: s2.y }];
}

/**
 * Compute connector geometry.
 * Returns { points: [{x,y}], curve: null | { c1, c2 }, startDir, endDir }
 * where startDir/endDir are unit vectors pointing *into* each endpoint (for arrowheads).
 */
export function edgeGeometry(edge, nodes) {
  const a = endInfo(edge.source, nodes);
  const b = endInfo(edge.target, nodes);
  const routing = edge.routing || 'straight';

  // Self loop
  if (a.node && b.node && a.node === b.node && !a.fixed && !b.fixed) {
    const n = a.node; const p1 = sidePoint(n, 'e'); const p2 = sidePoint(n, 'n');
    const pts = [p1, { x: p1.x + 30, y: p1.y }, { x: p1.x + 30, y: n.y - 30 }, { x: p2.x, y: n.y - 30 }, p2];
    return finish(pts, null);
  }

  if (routing === 'orthogonal') {
    let sideA = a.side; let sideB = b.side;
    let pA = a.point; let pB = b.point;
    if (a.node && !a.fixed && b.node && !b.fixed) {
      [sideA, sideB] = chooseSides(a.node, b.node);
    } else {
      if (a.node && !a.fixed) sideA = dominantSide(center(a.node), pB || center(b.node));
      if (b.node && !b.fixed) sideB = dominantSide(center(b.node), pA || center(a.node));
    }
    if (a.node && !a.fixed) pA = sidePoint(a.node, sideA);
    if (b.node && !b.fixed) pB = sidePoint(b.node, sideB);
    const d1 = sideA ? DIRS[sideA] : null; const d2 = sideB ? DIRS[sideB] : null;
    const s1 = d1 ? { x: pA.x + d1.x * STUB, y: pA.y + d1.y * STUB } : pA;
    const s2 = d2 ? { x: pB.x + d2.x * STUB, y: pB.y + d2.y * STUB } : pB;
    // Straight line when already aligned and facing.
    if (d1 && d2 && sideA === OPP[sideB] && (Math.abs(pA.x - pB.x) < 1 || Math.abs(pA.y - pB.y) < 1)) {
      const facing = (pB.x - pA.x) * d1.x + (pB.y - pA.y) * d1.y > 0;
      if (facing) return finish([pA, pB], null);
    }
    const mid = orthogonalMiddle(s1, d1, s2, d2);
    return finish(simplify([pA, s1, ...mid, s2, pB]), null);
  }

  // Straight & curved: floating ends point toward the other end.
  const refA = a.point || center(a.node);
  const refB = b.point || center(b.node);
  const pA = a.point || boundaryPoint(a.node, refB);
  const pB = b.point || boundaryPoint(b.node, refA);

  if (routing === 'curved') {
    const L = dist(pA, pB);
    const normalOf = (info, p, other) => {
      if (info.side) return DIRS[info.side];
      if (info.node) { const c = center(info.node); const d = dist(c, p) || 1; return { x: (p.x - c.x) / d, y: (p.y - c.y) / d }; }
      const d = dist(p, other) || 1; return { x: (other.x - p.x) / d, y: (other.y - p.y) / d };
    };
    const n1 = normalOf(a, pA, pB); const n2 = normalOf(b, pB, pA);
    const k = Math.max(30, L / 2.6);
    const c1 = { x: pA.x + n1.x * k, y: pA.y + n1.y * k };
    const c2 = { x: pB.x + n2.x * k, y: pB.y + n2.y * k };
    return finish([pA, pB], { c1, c2 });
  }
  return finish([pA, pB], null);
}

function unit(from, to) {
  const d = dist(from, to) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

function finish(points, curve) {
  const n = points.length;
  const endDir = curve ? unit(curve.c2, points[n - 1]) : unit(points[n - 2] || points[0], points[n - 1]);
  const startDir = curve ? unit(curve.c1, points[0]) : unit(points[1] || points[0], points[0]);
  return { points, curve, startDir, endDir };
}

export function bezierPoint(p0, c1, c2, p1, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p1.y,
  };
}

/** Midpoint along the path (by length) — where the label goes. */
export function pathMidpoint(geom) {
  const { points, curve } = geom;
  if (curve) return bezierPoint(points[0], curve.c1, curve.c2, points[points.length - 1], 0.5);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  let half = total / 2;
  for (let i = 1; i < points.length; i += 1) {
    const seg = dist(points[i - 1], points[i]);
    if (half <= seg) {
      const t = seg ? half / seg : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    half -= seg;
  }
  return points[0];
}

/** Distance from point p to the polyline (used for hit-testing and drop targets). */
export function distanceToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return dist(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}

// ---------------------------------------------------------------------------
// Arrowheads (drawn as explicit paths so exported SVG renders in Word too).

export const ARROWS = [
  { id: 'none', label: 'None' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'triangle', label: 'Filled triangle' },
  { id: 'triangleOpen', label: 'Hollow triangle (inheritance)' },
  { id: 'diamond', label: 'Hollow diamond (aggregation)' },
  { id: 'diamondFilled', label: 'Filled diamond (composition)' },
  { id: 'circle', label: 'Circle' },
  { id: 'one', label: 'ERD: one' },
  { id: 'oneOne', label: 'ERD: one and only one' },
  { id: 'many', label: 'ERD: many' },
  { id: 'oneMany', label: 'ERD: one or many' },
  { id: 'zeroOne', label: 'ERD: zero or one' },
  { id: 'zeroMany', label: 'ERD: zero or many' },
];

/** How much to pull the line back from the tip so it does not poke through. */
export function arrowInset(type, sw) {
  const len = 9 + sw * 2;
  if (type === 'triangle' || type === 'triangleOpen') return len;
  if (type === 'diamond' || type === 'diamondFilled') return len * 1.7;
  if (type === 'circle') return 9 + sw;
  return 0;
}

/**
 * SVG for an arrowhead at `tip` with `dir` pointing toward the tip.
 * bg = background colour used to fill hollow heads.
 */
export function arrowSVG(type, tip, dir, stroke, sw, bg = '#ffffff') {
  if (!type || type === 'none') return '';
  const len = 9 + sw * 2; const hw = len * 0.45;
  const n = { x: -dir.y, y: dir.x };
  const at = (along, side) => ({ x: tip.x - dir.x * along + n.x * side, y: tip.y - dir.y * along + n.y * side });
  const P = (p) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;
  const line = `fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
  switch (type) {
    case 'arrow': return `<path d="M${P(at(len, hw))} L${P(tip)} L${P(at(len, -hw))}" ${line}/>`;
    case 'triangle': return `<path d="M${P(at(len, hw))} L${P(tip)} L${P(at(len, -hw))} Z" fill="${stroke}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case 'triangleOpen': return `<path d="M${P(at(len, hw * 1.1))} L${P(tip)} L${P(at(len, -hw * 1.1))} Z" fill="${bg}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    case 'diamond':
    case 'diamondFilled': {
      const L = len * 1.7;
      return `<path d="M${P(tip)} L${P(at(L / 2, hw))} L${P(at(L, 0))} L${P(at(L / 2, -hw))} Z" fill="${type === 'diamondFilled' ? stroke : bg}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }
    case 'circle': {
      const rad = 4 + sw / 2; const c = at(rad, 0);
      return `<circle cx="${c.x}" cy="${c.y}" r="${rad}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"/>`;
    }
    default: break;
  }
  // ERD crow's-foot family.
  const bar = (along) => `<path d="M${P(at(along, hw))} L${P(at(along, -hw))}" ${line}/>`;
  const crow = () => `<path d="M${P(at(0, hw * 1.2))} L${P(at(len, 0))} L${P(at(0, -hw * 1.2))}" ${line}/>`;
  const ring = (along) => { const c = at(along, 0); return `<circle cx="${c.x}" cy="${c.y}" r="${hw * 0.75}" fill="${bg}" stroke="${stroke}" stroke-width="${sw}"/>`; };
  switch (type) {
    case 'one': return bar(len * 0.7);
    case 'oneOne': return bar(len * 0.55) + bar(len * 1.05);
    case 'many': return crow();
    case 'oneMany': return crow() + bar(len * 1.25);
    case 'zeroOne': return bar(len * 0.6) + ring(len * 1.35);
    case 'zeroMany': return crow() + ring(len * 1.5);
    default: return '';
  }
}
