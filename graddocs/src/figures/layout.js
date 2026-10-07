// Automatic diagram layout.
//
//   autoLayout(diagram, { mode: 'layered' | 'tree' | 'auto', direction: 'TB' | 'LR', ids?: Set<string>, routing?, frames? }) → diagram
//
// Mutates node positions (and, for frames that hold laid-out nodes, their size) and returns the diagram.
//
//  • layered  – Sugiyama-style: cycles are broken with DFS back edges, nodes get longest-path layers
//               (sources are pulled next to their first successor), long edges get dummy nodes,
//               crossings are reduced with barycenter sweeps + adjacent swaps, and the cross-axis
//               coordinates come from an iterative "centre over neighbours" pass that is solved
//               exactly per layer (pool-adjacent-violators), so layers stay centred and parents sit
//               roughly above their children.
//  • tree     – tidy tree: every parent is centred over its children and sibling subtrees never
//               overlap (contour based). A graph that is not a forest is reduced to a BFS spanning forest.
//  • auto     – tree when every node has at most one parent (and there is no cycle), otherwise layered.
//
// Connectors with a hollow-triangle end (UML inheritance / realisation) are laid out "general class first", so the
// superclass sits above its subclasses even though the arrow points from the subclass to the superclass.
//
// Stays put: points, locked nodes, nodes outside `ids` (when given) and free text labels/images that
// are not connected to anything. Frames (shape 'frame') are containers: a frame that contains laid-out
// nodes is shrink-wrapped around them and arranged with them (it is laid out as one block); a frame that
// is not in `ids` keeps its position and only grows when its contents no longer fit (`frames: 'keep'` applies
// that to every frame: none is moved or shrunk, only their contents are arranged inside). Disconnected parts of
// a graph are packed side by side; loose single nodes form one grid.
//
// Connectors between laid-out nodes lose their stale anchors and are routed orthogonally
// (routing: 'keep' | 'straight' | 'orthogonal'; lines touching an actor keep their straight routing). Each
// connector then gets floating ends when the router leaves along the flow and avoids other shapes; otherwise it
// is anchored bottom→top (TB) / right→left (LR), and connectors that run against the flow loop around the
// outer side. Labels and arrow styles are never touched.
import { isNode, isEdge, resolveEdgeStyle, resolveNodeStyle } from './render.js';
import { getShape } from './shapes.js';
import { layoutText } from './text-layout.js';
import { edgeGeometry, PORTS } from './geometry.js';

/** Figure types whose elements are placed by their own rules, not by a graph layout. */
export const LAYOUT_UNSUITED_TYPES = new Set(['fishbone', 'sequence', 'timeline']);

/** → null when auto layout makes sense, otherwise the reason ('fishbone' | 'sequence' | 'timeline'). */
export function layoutUnsuitedReason(diagram, figureType = null) {
  if (figureType && LAYOUT_UNSUITED_TYPES.has(figureType)) return figureType;
  if ((diagram?.elements || []).some((el) => isNode(el) && el.shape === 'lifeline')) return 'sequence';
  return null;
}

const NODE_GAP = 45;
const LAYER_GAP = 80;
const COMPONENT_GAP = 60;
const FRAME_PAD = 30;
const FRAME_HEADER = 42;
const DUMMY_SIZE = 6;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isContainer = (n) => !!getShape(n.shape).container;
const HAS_DOM = typeof document !== 'undefined';

// ---------------------------------------------------------------------------
// Text measurement (canvas in the browser, an estimate elsewhere, e.g. node tests)

/** → { w, h, lineHeight, lines: string[] } */
export function measureLabel(text, font, maxWidth = Infinity) {
  if (HAS_DOM) {
    try {
      const l = layoutText(text, font, maxWidth);
      return { w: l.width, h: l.height, lineHeight: l.lineHeight, lines: l.lines.map((x) => x.text) };
    } catch { /* fall back to the estimate */ }
  }
  const str = String(text ?? '');
  const cw = font.fontSize * (/[؀-ۿ]/.test(str) ? 0.56 : 0.52);
  const lineHeight = font.fontSize * 1.2;
  const lines = [];
  for (const para of str.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (cand.length * cw <= maxWidth || !cur) cur = cand; else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return { w: Math.max(0, ...lines.map((l) => l.length * cw)), h: lines.length * lineHeight, lineHeight, lines };
}

// ---------------------------------------------------------------------------
// Public entry point

export function autoLayout(diagram, options = {}) {
  const { mode = 'auto', direction = 'TB', ids = null, routing = 'orthogonal', frames: frameMode = 'wrap' } = options;
  const dir = direction === 'LR' ? 'LR' : 'TB';
  const nodes = (diagram.elements || []).filter(isNode);
  const edges = (diagram.elements || []).filter(isEdge);
  if (!nodes.length) return diagram;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const orig = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
  const inScope = (n) => !ids || ids.has(n.id);

  // Which nodes have a connector (ends attached to a node)?
  const connected = new Set();
  for (const e of edges) {
    if (e.source?.id && byId.has(e.source.id)) connected.add(e.source.id);
    if (e.target?.id && byId.has(e.target.id)) connected.add(e.target.id);
  }

  // Containment: the smallest frame that fully contains a node.
  const frames = nodes.filter(isContainer);
  const area = (n) => n.w * n.h;
  const parentOf = new Map();
  for (const n of nodes) {
    let best = null;
    for (const f of frames) {
      if (f === n || area(f) <= area(n)) continue;
      if (n.x >= f.x - 1 && n.y >= f.y - 1 && n.x + n.w <= f.x + f.w + 1 && n.y + n.h <= f.y + f.h + 1 && (!best || area(f) < area(best))) best = f;
    }
    parentOf.set(n.id, best ? best.id : null);
  }
  const kids = new Map();
  for (const n of nodes) { const p = parentOf.get(n.id); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }

  const decor = (n) => (n.shape === 'text' || n.shape === 'image') && !connected.has(n.id);
  const movableLeaf = (n) => !isContainer(n) && n.shape !== 'point' && !n.locked && inScope(n) && !decor(n);
  const frameMemo = new Map();
  const hasMovableDesc = (f) => (kids.get(f.id) || []).some((k) => (isContainer(k) ? movableFrame(k) : movableLeaf(k)) || (isContainer(k) && hasMovableDesc(k)));
  const movableFrame = (f) => {
    if (!frameMemo.has(f.id)) frameMemo.set(f.id, frameMode !== 'keep' && !f.locked && inScope(f) && hasMovableDesc(f));
    return frameMemo.get(f.id);
  };
  const isItem = (n) => (isContainer(n) ? movableFrame(n) : movableLeaf(n));
  const items = nodes.filter(isItem);
  if (!items.length) return diagram;

  // Gap scale follows the typical node size.
  const sizes = items.filter((n) => !isContainer(n)).map((n) => (n.w + n.h) / 2);
  const mean = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 110;
  const scale = clamp(mean / 110, 0.85, 1.5);
  const cfg = { mode, dir, nodeGap: NODE_GAP * scale, layerGap: LAYER_GAP * scale };

  const chain = (id) => { const out = []; let cur = id; while (cur != null) { out.push(cur); cur = parentOf.get(cur); } return out; };
  const itemAt = (scope, id) => {
    for (const cur of chain(id)) {
      if (parentOf.get(cur) === scope) return isItem(byId.get(cur)) ? cur : null;
    }
    return null;
  };

  // Item boxes. An actor's caption hangs below the figure, so it is part of the box.
  const frameTitleW = (f) => {
    const font = resolveNodeStyle(f, diagram);
    return measureLabel(f.text || '', font, 400).w + 28;
  };
  const leafBox = (n) => {
    if (n.shape === 'actor' && n.text) {
      const font = resolveNodeStyle(n, diagram);
      const lab = measureLabel(n.text, font, n.w + 100);
      const ew = Math.max(n.w, lab.w + 8);
      return { w: ew, h: n.h + 8 + lab.h, dx: (ew - n.w) / 2, dy: 0 };
    }
    return { w: n.w, h: n.h, dx: 0, dy: 0 };
  };

  const backEdges = new Set(); // connectors that run against the flow direction
  const solved = new Map(); // scope id (or null) → { pos: Map(itemId → {x, y}), w, h }
  const frameBox = new Map(); // movable frame id → { w, h }
  const solveScope = (scope) => {
    const members = items.filter((n) => parentOf.get(n.id) === scope);
    if (!members.length) return null;
    const boxes = members.map((n) => {
      if (isContainer(n)) {
        const sub = solveScope(n.id);
        const box = { w: Math.max(sub.w + FRAME_PAD * 2, frameTitleW(n)), h: sub.h + FRAME_HEADER + FRAME_PAD };
        frameBox.set(n.id, box);
        return { id: n.id, w: box.w, h: box.h, dx: 0, dy: 0, n };
      }
      const b = leafBox(n);
      return { id: n.id, ...b, n };
    });
    const pairs = [];
    for (const e of edges) {
      if (!e.source?.id || !e.target?.id) continue;
      const a = itemAt(scope, e.source.id); const b = itemAt(scope, e.target.id);
      if (!a || !b || a === b) continue;
      const font = resolveEdgeStyle(e, diagram);
      const lab = e.text ? measureLabel(e.text, font, 220) : { w: 0, h: 0 };
      // Inheritance / realisation arrows point at the general class, which belongs above (or before) the specific one.
      const general = e.style?.endArrow === 'triangleOpen';
      pairs.push({ a: general ? b : a, b: general ? a : b, lw: lab.w, lh: lab.h, edge: e });
    }
    const res = layoutItems(boxes.map((b) => ({ id: b.id, w: b.w, h: b.h, ox: orig.get(b.id).x + orig.get(b.id).w / 2, oy: orig.get(b.id).y + orig.get(b.id).h / 2 })), pairs, cfg);
    for (const b of boxes) { const p = res.pos.get(b.id); p.dx = b.dx; p.dy = b.dy; }
    for (const p of pairs) if (res.back.has(`${p.a}|${p.b}`) && !res.back.has(`${p.b}|${p.a}`)) backEdges.add(p.edge);
    const out = { pos: res.pos, w: res.w, h: res.h };
    solved.set(scope, out);
    return out;
  };

  // Scopes to solve: the root plus every frame that stays put but holds laid-out nodes.
  const inMovableFrame = (f) => { let cur = parentOf.get(f.id); while (cur != null) { if (movableFrame(byId.get(cur))) return true; cur = parentOf.get(cur); } return false; };
  const fixedScopes = frames.filter((f) => !movableFrame(f) && !inMovableFrame(f) && items.some((n) => parentOf.get(n.id) === f.id));
  solveScope(null);
  for (const f of fixedScopes) solveScope(f.id);

  const laidOut = new Set();
  const place = (scope, ox, oy) => {
    const s = solved.get(scope);
    if (!s) return;
    for (const [id, p] of s.pos) {
      const n = byId.get(id);
      laidOut.add(id);
      if (isContainer(n)) {
        const box = frameBox.get(id);
        n.x = Math.round(ox + p.x); n.y = Math.round(oy + p.y); n.w = Math.round(box.w); n.h = Math.round(box.h);
        place(id, n.x + FRAME_PAD, n.y + FRAME_HEADER);
      } else {
        n.x = Math.round(ox + p.x + p.dx); n.y = Math.round(oy + p.y + p.dy);
      }
    }
  };

  // Root: keep the diagram where it was (top-left of the laid-out items).
  const rootItems = items.filter((n) => parentOf.get(n.id) == null);
  if (rootItems.length) {
    const ox = Math.min(...rootItems.map((n) => orig.get(n.id).x));
    const oy = Math.min(...rootItems.map((n) => orig.get(n.id).y));
    place(null, ox, oy);
  }
  // Frames that keep their position: arrange their contents inside and grow them if needed.
  for (const f of fixedScopes) {
    const s = solved.get(f.id);
    if (!s) continue;
    place(f.id, f.x + FRAME_PAD, f.y + FRAME_HEADER);
    f.w = Math.max(f.w, Math.round(s.w + FRAME_PAD * 2));
    f.h = Math.max(f.h, Math.round(s.h + FRAME_HEADER + FRAME_PAD));
  }

  // Anything left behind inside a frame that moved (points, labels, nodes outside `ids`) travels with it.
  const movedFrames = items.filter((n) => isContainer(n));
  if (movedFrames.length) {
    for (const n of nodes) {
      if (laidOut.has(n.id)) continue;
      const o = orig.get(n.id);
      let best = null;
      for (const f of movedFrames) {
        const fo = orig.get(f.id);
        if (o.x >= fo.x - 1 && o.y >= fo.y - 1 && o.x + o.w <= fo.x + fo.w + 1 && o.y + o.h <= fo.y + fo.h + 1 && (!best || fo.w * fo.h < orig.get(best.id).w * orig.get(best.id).h)) best = f;
      }
      if (best) { n.x += best.x - orig.get(best.id).x; n.y += best.y - orig.get(best.id).y; }
    }
  }

  // Connectors between laid-out nodes: stale anchors are dropped (floating ends) and the route is orthogonal.
  if (routing !== 'keep') {
    const routed = [];
    for (const e of edges) {
      if (!laidOut.has(e.source?.id) || !laidOut.has(e.target?.id)) continue;
      e.source = { id: e.source.id };
      e.target = { id: e.target.id };
      // Use-case style lines (anything touching an actor) stay as straight/curved lines.
      const keepLine = routing === 'orthogonal' && e.routing && e.routing !== 'orthogonal' && (byId.get(e.source.id)?.shape === 'actor' || byId.get(e.target.id)?.shape === 'actor');
      if (!keepLine) e.routing = routing === 'straight' ? 'straight' : 'orthogonal';
      if (e.routing === 'orthogonal' && e.source.id !== e.target.id) routed.push(e);
    }
    routeConnectors(routed, byId, dir, backEdges);
  }
  return diagram;
}

// ---------------------------------------------------------------------------
// Connector routing after a layout

/** Does the segment p→q touch the rectangle r (inflated by `pad`)? Liang–Barsky clipping. */
function segmentHitsRect(p, q, r, pad = 2) {
  const x0 = r.x - pad; const x1 = r.x + r.w + pad; const y0 = r.y - pad; const y1 = r.y + r.h + pad;
  let t0 = 0; let t1 = 1;
  const dx = q.x - p.x; const dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

/**
 * Pick the end anchors of every connector so that its orthogonal route follows the flow and stays clear of other shapes:
 *   forward   floating ends when the router leaves along the flow, else bottom→top (TB) / right→left (LR), else around the side
 *   backward  around the outer side (right for TB, bottom for LR)
 * Candidates are tried in that order; the first route that crosses no other shape wins (otherwise the one crossing fewest).
 */
function routeConnectors(edges, byId, dir, backEdges) {
  const tb = dir === 'TB';
  const obstacles = [...byId.values()].filter((n) => !isContainer(n) && n.shape !== 'point' && n.shape !== 'text' && n.shape !== 'image');
  const out = tb ? 's' : 'e'; const into = tb ? 'n' : 'w';
  const sides = tb ? ['e', 'w'] : ['s', 'n'];
  for (const e of edges) {
    const a = byId.get(e.source.id); const b = byId.get(e.target.id);
    if (!a || !b) continue;
    // Inheritance-style connectors are laid out general-class-first, so their natural direction is "against" the arrow.
    const reversed = e.style?.endArrow === 'triangleOpen';
    const [first, second] = reversed ? [b, a] : [a, b];
    const forward = tb ? second.y >= first.y + first.h - 1 : second.x >= first.x + first.w - 1;
    const backward = tb ? second.y + second.h <= first.y + 1 : second.x + second.w <= first.x + 1;
    const loop = (side) => ({ source: { id: a.id, anchor: { ...PORTS[side] } }, target: { id: b.id, anchor: { ...PORTS[side] } } });
    const flow = {
      source: { id: a.id, anchor: { ...PORTS[reversed ? into : out] } },
      target: { id: b.id, anchor: { ...PORTS[reversed ? out : into] } },
    };
    const floating = { source: { id: a.id }, target: { id: b.id } };
    const isBack = backEdges.has(e) || backward;
    let candidates;
    if (isBack) candidates = [loop(sides[0]), loop(sides[1]), floating];
    else if (forward) candidates = [floating, flow, loop(sides[0]), loop(sides[1])];
    else candidates = [floating];
    let best = null;
    for (const cand of candidates) {
      let geom;
      try { geom = edgeGeometry({ ...e, ...cand, routing: 'orthogonal' }, byId); } catch { continue; }
      const pts = geom.points;
      // A floating route must leave along the flow, otherwise a wide layout would exit sideways.
      if (forward && !isBack && cand === floating) {
        const sign = reversed ? -1 : 1;
        const dx = (pts[1].x - pts[0].x) * sign; const dy = (pts[1].y - pts[0].y) * sign;
        const along = tb ? Math.abs(dx) < 0.5 && dy > 0.5 : Math.abs(dy) < 0.5 && dx > 0.5;
        if (!along) continue;
      }
      let hits = 0;
      for (const o of obstacles) {
        if (o === a || o === b) continue;
        for (let k = 1; k < pts.length; k += 1) if (segmentHitsRect(pts[k - 1], pts[k], o)) { hits += 1; break; }
      }
      if (!best || hits < best.hits) best = { cand, hits };
      if (hits === 0) break;
    }
    if (best) { e.source = best.cand.source; e.target = best.cand.target; }
  }
}

// ---------------------------------------------------------------------------
// Graph helpers shared by both layouts

/** Weakly connected components → arrays of item indexes (stable order). */
function components(n, pairs) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const [a, b] of pairs) { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; }
  const groups = new Map();
  for (let i = 0; i < n; i += 1) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()];
}

/** True when every node has at most one parent and there is no cycle. */
export function isForestGraph(n, pairs) {
  const indeg = new Array(n).fill(0);
  const out = Array.from({ length: n }, () => new Set());
  for (const [a, b] of pairs) { if (a === b || out[a].has(b)) continue; out[a].add(b); indeg[b] += 1; }
  if (indeg.some((d) => d > 1)) return false;
  // Acyclic? Kahn.
  const d = [...indeg]; const q = []; let seen = 0;
  d.forEach((x, i) => { if (!x) q.push(i); });
  while (q.length) { const u = q.pop(); seen += 1; for (const v of out[u]) { d[v] -= 1; if (!d[v]) q.push(v); } }
  return seen === n;
}

/**
 * items: [{ id, w, h, ox, oy }] (ox/oy = original centre), pairs: [{ a, b, lw, lh }] (item ids, label size).
 * → { pos: Map(id → { x, y } top-left, min at 0), w, h }
 */
function layoutItems(items, pairs, cfg) {
  const idx = new Map(items.map((it, i) => [it.id, i]));
  const tb = cfg.dir === 'TB';
  const nodes = items.map((it) => ({
    id: it.id, cs: tb ? it.w : it.h, ms: tb ? it.h : it.w, oc: tb ? it.ox : it.oy, om: tb ? it.oy : it.ox,
  }));
  const prs = [];
  const seen = new Set();
  const ext = new Map(); // "a|b" → label extent along the main axis
  for (const p of pairs) {
    const a = idx.get(p.a); const b = idx.get(p.b);
    if (a === undefined || b === undefined || a === b) continue;
    const k = `${a}|${b}`;
    ext.set(k, Math.max(ext.get(k) || 0, tb ? p.lh : p.lw));
    if (seen.has(k)) continue;
    seen.add(k);
    prs.push([a, b]);
  }
  let mode = cfg.mode;
  if (mode === 'auto') mode = isForestGraph(nodes.length, prs) ? 'tree' : 'layered';

  const parts = [];
  const back = new Set(); // "fromId|toId" of connectors that run against the flow
  if (mode === 'tree') {
    for (const tree of buildForest(nodes, prs)) parts.push({ ...treeLayout(tree, nodes, ext, cfg), singleton: tree.order.length === 1, key: nodes[tree.root].oc });
  } else {
    for (const comp of components(nodes.length, prs)) {
      const local = new Map(comp.map((g, i) => [g, i]));
      const cn = comp.map((g) => nodes[g]);
      const ce = prs.filter(([a, b]) => local.has(a) && local.has(b)).map(([a, b]) => ({ a: local.get(a), b: local.get(b), ext: ext.get(`${a}|${b}`) || 0 }));
      const lay = layeredLayout(cn, ce, cfg);
      for (const k of lay.back) { const [a, b] = k.split('|').map(Number); back.add(`${items[comp[a]].id}|${items[comp[b]].id}`); }
      parts.push({ ...lay, pos: new Map([...lay.pos].map(([li, p]) => [comp[li], p])), singleton: comp.length === 1, key: Math.min(...cn.map((x) => x.oc)) });
    }
  }
  // Loose single nodes form one tidy grid; larger structures come first in their original left-to-right order.
  const singles = parts.filter((p) => p.singleton);
  const groups = parts.filter((p) => !p.singleton).sort((p, q) => p.key - q.key);
  if (singles.length > 1) groups.push(gridPart(singles.map((p) => [...p.pos.keys()][0]), nodes, cfg));
  else groups.push(...singles);
  const offsets = packBoxes(groups.map((p) => ({ w: tb ? p.cw : p.mw, h: tb ? p.mw : p.cw })), COMPONENT_GAP);
  const pos = new Map();
  groups.forEach((part, i) => {
    const o = offsets.offsets[i];
    for (const [g, p] of part.pos) {
      // p = { c: cross centre, m: main top } relative to the part's top-left.
      const n = nodes[g];
      pos.set(items[g].id, tb ? { x: o.x + p.c - n.cs / 2, y: o.y + p.m } : { x: o.x + p.m, y: o.y + p.c - n.cs / 2 });
    }
  });
  return { pos, w: offsets.w, h: offsets.h, back };
}

/** Loose nodes in tidy lines (rows for top-to-bottom, columns for left-to-right). → part { pos, cw, mw } */
function gridPart(indexes, nodes, cfg) {
  // Reading order, treating items whose original positions are close on the cross-axis band as one row.
  const bandSize = Math.max(40, ...indexes.map((i) => nodes[i].ms)) * 0.8;
  const band = (i) => Math.round(nodes[i].om / bandSize);
  const list = [...indexes].sort((i, j) => (band(i) - band(j)) || (nodes[i].oc - nodes[j].oc) || i - j);
  const n = list.length;
  const perLine = n <= 6 ? n : Math.ceil(n / Math.ceil(n / 6));
  const gap = cfg.nodeGap;
  const lines = [];
  for (let i = 0; i < n; i += perLine) lines.push(list.slice(i, i + perLine));
  const lineCross = lines.map((ln) => ln.reduce((s, g) => s + nodes[g].cs, 0) + gap * (ln.length - 1));
  const cw = Math.max(...lineCross);
  const pos = new Map();
  let m = 0;
  lines.forEach((ln, li) => {
    const thick = Math.max(...ln.map((g) => nodes[g].ms));
    let c = (cw - lineCross[li]) / 2;
    for (const g of ln) { pos.set(g, { c: c + nodes[g].cs / 2, m: m + (thick - nodes[g].ms) / 2 }); c += nodes[g].cs + gap; }
    m += thick + cfg.layerGap * 0.6;
  });
  return { pos, cw, mw: m - cfg.layerGap * 0.6 };
}

/** Shelf packing in reading order. → { offsets: [{x, y}], w, h } */
function packBoxes(boxes, gap) {
  if (!boxes.length) return { offsets: [], w: 0, h: 0 };
  const maxW = Math.max(...boxes.map((b) => b.w));
  const target = Math.max(maxW, Math.sqrt(boxes.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0)) * 2);
  const offsets = [];
  let x = 0; let y = 0; let rowH = 0; let width = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > target) { y += rowH + gap; x = 0; rowH = 0; }
    offsets.push({ x, y });
    x += b.w + gap; rowH = Math.max(rowH, b.h); width = Math.max(width, x - gap);
  }
  return { offsets, w: width, h: y + rowH };
}

// ---------------------------------------------------------------------------
// Layered layout

/** Isotonic placement: minimise Σ weight·(x − desired)² with x[i+1] − x[i] ≥ sep[i]. */
function placeLayer(desired, weight, sep) {
  const n = desired.length;
  const c = new Array(n); c[0] = 0;
  for (let i = 1; i < n; i += 1) c[i] = c[i - 1] + sep[i - 1];
  const blocks = [];
  for (let i = 0; i < n; i += 1) {
    blocks.push({ w: weight[i], s: weight[i] * (desired[i] - c[i]), from: i, to: i, mean: desired[i] - c[i] });
    while (blocks.length > 1 && blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean) {
      const b = blocks.pop(); const a = blocks[blocks.length - 1];
      a.w += b.w; a.s += b.s; a.to = b.to; a.mean = a.s / a.w;
    }
  }
  const x = new Array(n);
  for (const b of blocks) for (let i = b.from; i <= b.to; i += 1) x[i] = b.mean + c[i];
  return x;
}

/** nodes: [{ id, cs, ms, oc, om }], edges: [{ a, b, ext }] (indexes into nodes). → { pos: Map(index → { c, m }), cw, mw } */
function layeredLayout(nodes, edges, cfg) {
  const N = nodes.length;
  if (N === 1) return { pos: new Map([[0, { c: nodes[0].cs / 2, m: 0 }]]), cw: nodes[0].cs, mw: nodes[0].ms, back: new Set() };

  // --- 1. cycle removal (DFS back edges are reversed)
  const out = nodes.map(() => new Set());
  for (const e of edges) if (e.a !== e.b) out[e.a].add(e.b);
  const order = [...nodes.keys()].sort((i, j) => (nodes[i].om - nodes[j].om) || (nodes[i].oc - nodes[j].oc) || i - j);
  const outSorted = out.map((s) => [...s].sort((i, j) => (nodes[i].oc - nodes[j].oc) || i - j));
  const indeg = new Array(N).fill(0);
  out.forEach((s) => s.forEach((v) => { indeg[v] += 1; }));
  const state = new Array(N).fill(0);
  const back = new Set();
  const dfs = (u) => {
    state[u] = 1;
    for (const v of outSorted[u]) {
      if (state[v] === 1) back.add(`${u}|${v}`);
      else if (state[v] === 0) dfs(v);
    }
    state[u] = 2;
  };
  for (const r of [...order.filter((i) => indeg[i] === 0), ...order]) if (state[r] === 0) dfs(r);
  const succ = nodes.map(() => new Set());
  const pred = nodes.map(() => new Set());
  for (let u = 0; u < N; u += 1) {
    for (const v of out[u]) {
      const [a, b] = back.has(`${u}|${v}`) ? [v, u] : [u, v];
      succ[a].add(b); pred[b].add(a);
    }
  }

  // --- 2. longest-path layering (Kahn), then pull sources next to their first successor
  const layer = new Array(N).fill(0);
  const deg = pred.map((s) => s.size);
  const queue = order.filter((i) => deg[i] === 0);
  const topo = [];
  while (queue.length) {
    const u = queue.shift();
    topo.push(u);
    for (const v of succ[u]) { layer[v] = Math.max(layer[v], layer[u] + 1); deg[v] -= 1; if (deg[v] === 0) queue.push(v); }
  }
  for (let i = topo.length - 1; i >= 0; i -= 1) {
    const u = topo[i];
    if (pred[u].size === 0 && succ[u].size > 0) layer[u] = Math.min(...[...succ[u]].map((v) => layer[v])) - 1;
  }
  const minLayer = Math.min(...layer);
  for (let i = 0; i < N; i += 1) layer[i] -= minLayer;
  // compact empty layers
  const used = [...new Set(layer)].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  for (let i = 0; i < N; i += 1) layer[i] = remap.get(layer[i]);
  const L = used.length;

  // --- 3. dummy nodes for edges that span several layers
  const V = nodes.map((n, i) => ({ ...n, g: i, dummy: false, layer: layer[i], up: [], down: [], ord: 0, x: 0 }));
  const layers = Array.from({ length: L }, () => []);
  V.forEach((v) => layers[v.layer].push(v));
  const extByGap = new Array(Math.max(0, L - 1)).fill(0);
  const link = (a, b) => { a.down.push(b); b.up.push(a); };
  for (let u = 0; u < N; u += 1) {
    for (const v of succ[u]) {
      const span = layer[v] - layer[u];
      if (span === 1) {
        link(V[u], V[v]);
        const e = edges.find((q) => (q.a === u && q.b === v) || (q.a === v && q.b === u));
        if (e) extByGap[layer[u]] = Math.max(extByGap[layer[u]], e.ext);
      } else {
        let prev = V[u];
        for (let l = layer[u] + 1; l < layer[v]; l += 1) {
          const d = { dummy: true, cs: DUMMY_SIZE, ms: 0, layer: l, up: [], down: [], ord: 0, x: 0, oc: nodes[u].oc + ((nodes[v].oc - nodes[u].oc) * (l - layer[u])) / span };
          layers[l].push(d); link(prev, d); prev = d;
        }
        link(prev, V[v]);
      }
    }
  }

  // --- 4. crossing reduction
  layers.forEach((lay) => lay.sort((p, q) => (p.oc - q.oc) || ((p.g ?? 1e9) - (q.g ?? 1e9))));
  const setOrd = () => layers.forEach((lay) => lay.forEach((v, i) => { v.ord = i; }));
  const crossingsBetween = (l) => {
    const pairs = [];
    for (const u of layers[l]) for (const v of u.down) pairs.push([u.ord, v.ord]);
    let c = 0;
    for (let i = 0; i < pairs.length; i += 1) for (let j = i + 1; j < pairs.length; j += 1) {
      if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) c += 1;
    }
    return c;
  };
  const totalCrossings = () => { let c = 0; for (let l = 0; l < L - 1; l += 1) c += crossingsBetween(l); return c; };
  setOrd();
  const snapshot = () => layers.map((lay) => lay.slice());
  let best = snapshot(); let bestC = totalCrossings(); let stale = 0;
  const sortBy = (lay, key) => {
    const withKey = lay.map((v, i) => ({ v, k: key(v), i }));
    withKey.sort((p, q) => (p.k - q.k) || (p.i - q.i));
    withKey.forEach((o, i) => { lay[i] = o.v; });
  };
  const bary = (v, list) => (list.length ? list.reduce((s, u) => s + u.ord, 0) / list.length : v.ord);
  for (let it = 0; it < 14 && bestC > 0 && stale < 4; it += 1) {
    if (it % 2 === 0) for (let l = 1; l < L; l += 1) { sortBy(layers[l], (v) => bary(v, v.up)); layers[l].forEach((v, i) => { v.ord = i; }); }
    else for (let l = L - 2; l >= 0; l -= 1) { sortBy(layers[l], (v) => bary(v, v.down)); layers[l].forEach((v, i) => { v.ord = i; }); }
    const c = totalCrossings();
    if (c < bestC) { bestC = c; best = snapshot(); stale = 0; } else stale += 1;
  }
  best.forEach((lay, l) => { layers[l] = lay; });
  setOrd();
  // adjacent transposition
  const pairCross = (a, b) => {
    let c = 0;
    for (const x of a.up) for (const y of b.up) if (x.ord > y.ord) c += 1;
    for (const x of a.down) for (const y of b.down) if (x.ord > y.ord) c += 1;
    return c;
  };
  if (layers.reduce((s, lay) => s + lay.length, 0) < 400) {
    for (let pass = 0; pass < 6; pass += 1) {
      let improved = false;
      for (const lay of layers) {
        for (let i = 0; i < lay.length - 1; i += 1) {
          const a = lay[i]; const b = lay[i + 1];
          if (pairCross(a, b) > pairCross(b, a)) { lay[i] = b; lay[i + 1] = a; a.ord = i + 1; b.ord = i; improved = true; }
        }
      }
      if (!improved) break;
    }
  }

  // --- 5. cross-axis coordinates
  const gap = cfg.nodeGap;
  const sepOf = (a, b) => (a.cs + b.cs) / 2 + ((a.dummy || b.dummy) ? gap * 0.35 : gap);
  const seps = layers.map((lay) => lay.slice(0, -1).map((v, i) => sepOf(v, lay[i + 1])));
  layers.forEach((lay, l) => {
    const xs = placeLayer(lay.map(() => 0), lay.map(() => 1), seps[l]);
    const mid = (xs[0] + xs[xs.length - 1]) / 2;
    lay.forEach((v, i) => { v.x = xs[i] - mid; });
  });
  const relax = (l, which) => {
    const lay = layers[l];
    const desired = []; const weight = [];
    for (const v of lay) {
      let list = which === 'up' ? v.up : which === 'down' ? v.down : [...v.up, ...v.down];
      if (!v.dummy && list.some((u) => !u.dummy)) list = list.filter((u) => !u.dummy); // real neighbours decide; long-edge dummies only follow
      if (!list.length) { desired.push(v.x); weight.push(0.02); continue; }
      // Dummy nodes follow the real nodes they connect (and each other); real nodes are barely pulled aside by them.
      let s = 0; let w = 0;
      for (const u of list) { const k = v.dummy ? (u.dummy ? 4 : 1) : 1; s += k * u.x; w += k; }
      desired.push(s / w); weight.push(w);
    }
    const xs = placeLayer(desired, weight, seps[l]);
    lay.forEach((v, i) => { v.x = xs[i]; });
  };
  for (let it = 0; it < 5; it += 1) {
    for (let l = 1; l < L; l += 1) relax(l, 'up');
    for (let l = L - 2; l >= 0; l -= 1) relax(l, 'down');
  }
  for (let it = 0; it < 3; it += 1) {
    for (let l = 0; l < L; l += 1) relax(l, 'both');
    for (let l = L - 1; l >= 0; l -= 1) relax(l, 'both');
  }
  for (let l = L - 2; l >= 0; l -= 1) relax(l, 'down'); // parents end up centred over their children

  // A node whose only (real) parent has no other child is moved under it when there is room, so chains run straight.
  const room = (v) => {
    const lay = layers[v.layer]; const i = lay.indexOf(v);
    return [i > 0 ? lay[i - 1].x + sepOf(lay[i - 1], v) : -Infinity, i < lay.length - 1 ? lay[i + 1].x - sepOf(v, lay[i + 1]) : Infinity];
  };
  for (let pass = 0; pass < 2; pass += 1) {
    for (let l = 1; l < L; l += 1) {
      for (const v of layers[l]) {
        if (v.dummy) continue;
        const parents = v.up.filter((u) => !u.dummy);
        if (parents.length !== 1 || parents[0].down.filter((k) => !k.dummy).length !== 1) continue;
        const [lo, hi] = room(v);
        if (parents[0].x >= lo - 0.01 && parents[0].x <= hi + 0.01) v.x = parents[0].x;
      }
    }
  }

  // --- 6. main-axis positions
  const band = layers.map((lay) => Math.max(0, ...lay.filter((v) => !v.dummy).map((v) => v.ms)));
  const tops = [];
  let m = 0; let lastGap = 0;
  for (let l = 0; l < L; l += 1) {
    tops.push(m);
    const labelRoom = cfg.dir === 'LR' ? (extByGap[l] || 0) + 40 : (extByGap[l] || 0) + 24;
    lastGap = Math.max(cfg.layerGap, labelRoom);
    m += band[l] + lastGap;
  }
  const real = V;
  const minC = Math.min(...real.map((v) => v.x - v.cs / 2));
  const maxC = Math.max(...real.map((v) => v.x + v.cs / 2));
  const pos = new Map();
  for (const v of real) pos.set(v.g, { c: v.x - minC, m: tops[v.layer] + (band[v.layer] - v.ms) / 2 });
  return { pos, cw: maxC - minC, mw: m - lastGap, back };
}

// ---------------------------------------------------------------------------
// Tree layout

/** BFS spanning forest. → [{ root, order: [index…], kids: Map(index → [index…]), depth: Map }] */
function buildForest(nodes, prs) {
  const N = nodes.length;
  const out = nodes.map(() => []);
  const indeg = new Array(N).fill(0);
  for (const [a, b] of prs) { out[a].push(b); indeg[b] += 1; }
  out.forEach((l) => l.sort((p, q) => (nodes[p].oc - nodes[q].oc) || p - q));
  const byOrig = [...nodes.keys()].sort((i, j) => (nodes[i].om - nodes[j].om) || (nodes[i].oc - nodes[j].oc) || i - j);
  const rootsFirst = byOrig.filter((i) => indeg[i] === 0).sort((p, q) => (nodes[p].oc - nodes[q].oc) || p - q);
  const visited = new Array(N).fill(false);
  const trees = [];
  const grow = (root) => {
    const tree = { root, order: [root], kids: new Map([[root, []]]), depth: new Map([[root, 0]]) };
    visited[root] = true;
    const q = [root];
    while (q.length) {
      const u = q.shift();
      for (const v of out[u]) {
        if (visited[v]) continue;
        visited[v] = true;
        tree.kids.get(u).push(v); tree.kids.set(v, []); tree.depth.set(v, tree.depth.get(u) + 1); tree.order.push(v);
        q.push(v);
      }
    }
    trees.push(tree);
  };
  for (const r of rootsFirst) if (!visited[r]) grow(r);
  for (const r of byOrig) if (!visited[r]) grow(r); // leftovers of pure cycles
  return trees;
}

/** Tidy tree for one spanning tree. → { pos: Map(index → { c, m }), cw, mw } */
function treeLayout(tree, nodes, ext, cfg) {
  const gap = cfg.nodeGap;
  // Contours per depth, relative to the subtree root's centre.
  const place = new Map(); // node → offset of its centre relative to its parent's centre
  const contour = (u) => {
    const kids = tree.kids.get(u);
    const half = nodes[u].cs / 2;
    if (!kids.length) return { left: [-half], right: [half] };
    const subs = kids.map(contour);
    const offs = [0];
    let accL = subs[0].left.slice(); let accR = subs[0].right.slice();
    for (let i = 1; i < kids.length; i += 1) {
      const s = subs[i];
      let shift = -Infinity;
      for (let d = 0; d < Math.min(accR.length, s.left.length); d += 1) shift = Math.max(shift, accR[d] - s.left[d] + gap);
      offs.push(shift);
      for (let d = 0; d < s.left.length; d += 1) {
        if (d < accL.length) { accL[d] = Math.min(accL[d], s.left[d] + shift); accR[d] = Math.max(accR[d], s.right[d] + shift); }
        else { accL.push(s.left[d] + shift); accR.push(s.right[d] + shift); }
      }
    }
    const centre = (offs[0] + offs[offs.length - 1]) / 2;
    kids.forEach((k, i) => place.set(k, offs[i] - centre));
    return { left: [-half, ...accL.map((v) => v - centre)], right: [half, ...accR.map((v) => v - centre)] };
  };
  const cont = contour(tree.root);
  const c = new Map([[tree.root, 0]]);
  for (const u of tree.order) for (const k of tree.kids.get(u)) c.set(k, c.get(u) + place.get(k));
  // Depth bands.
  const maxDepth = Math.max(...tree.order.map((u) => tree.depth.get(u)));
  const band = new Array(maxDepth + 1).fill(0);
  const labelRoom = new Array(maxDepth + 1).fill(0);
  for (const u of tree.order) {
    const d = tree.depth.get(u);
    band[d] = Math.max(band[d], nodes[u].ms);
    for (const k of tree.kids.get(u)) labelRoom[d] = Math.max(labelRoom[d], ext.get(`${u}|${k}`) || 0);
  }
  const tops = []; let m = 0; let lastGap = 0;
  for (let d = 0; d <= maxDepth; d += 1) {
    tops.push(m);
    const room = cfg.dir === 'LR' ? labelRoom[d] + 40 : labelRoom[d] + 24;
    lastGap = Math.max(cfg.layerGap, room);
    m += band[d] + lastGap;
  }
  const minC = Math.min(...cont.left); const maxC = Math.max(...cont.right);
  const pos = new Map();
  for (const u of tree.order) {
    const d = tree.depth.get(u);
    pos.set(u, { c: c.get(u) - minC, m: tops[d] + (band[d] - nodes[u].ms) / 2 });
  }
  return { pos, cw: maxC - minC, mw: m - lastGap };
}
