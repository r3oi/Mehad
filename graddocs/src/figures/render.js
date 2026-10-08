// Diagram → SVG. The same renderer drives the editor canvas, thumbnails,
// Document Preview and every export, so what you edit is what you export.
import { getShape, BASE_NODE_STYLE, BASE_EDGE_STYLE, paint, dashArray } from './shapes.js';
import { textSVG, layoutText, r, xmlEscape, fontStack } from './text-layout.js';
import { edgeGeometry, pathMidpoint, arrowSVG, arrowInset, bezierPoint } from './geometry.js';

export const DEFAULT_FONT = { fontFamily: 'Times New Roman', fontSize: 14 };

const diagramDefaults = (diagram) => ({ ...DEFAULT_FONT, ...(diagram?.defaults || {}) });

export function resolveNodeStyle(el, diagram) {
  const shape = getShape(el.shape);
  const d = diagramDefaults(diagram);
  const s = { ...BASE_NODE_STYLE, ...(shape.defaults?.style || {}), ...(el.style || {}) };
  s.fontFamily = s.fontFamily || d.fontFamily;
  s.fontSize = Number(s.fontSize) || d.fontSize;
  return s;
}

export function resolveEdgeStyle(el, diagram) {
  const d = diagramDefaults(diagram);
  const s = { ...BASE_EDGE_STYLE, ...(el.style || {}) };
  s.fontFamily = s.fontFamily || d.fontFamily;
  s.fontSize = Number(s.fontSize) || Math.round(d.fontSize * 0.86);
  return s;
}

export const isNode = (el) => el?.type === 'node';
export const isEdge = (el) => el?.type === 'edge';

export function nodeMap(diagram) {
  const map = new Map();
  for (const el of diagram.elements) if (isNode(el)) map.set(el.id, el);
  return map;
}

export function textBoxOf(el) {
  const shape = getShape(el.shape);
  return shape.textBox ? shape.textBox(el) : { x: el.x, y: el.y, w: el.w, h: el.h };
}

// ---------------------------------------------------------------------------

function renderNode(el, diagram, ctx) {
  const shape = getShape(el.shape);
  const s = resolveNodeStyle(el, diagram);
  const body = shape.draw(el, s, ctx);
  let text = '';
  if (ctx.hideTextId !== el.id) {
    text = shape.drawText ? shape.drawText(el, s, ctx) : textSVG(el.text, textBoxOf(el), s, { padding: shape.textPadding });
  }
  const edit = ctx.mode === 'edit';
  const hit = edit ? (shape.hit ? shape.hit(el) : '') : '';
  const opacity = s.opacity < 1 ? ` opacity="${s.opacity}"` : '';
  const filter = s.shadow ? ' filter="url(#gd-shadow)"' : '';
  const hl = ctx.highlights?.get(el.id);
  const highlight = hl ? `<rect x="${r(el.x - 5)}" y="${r(el.y - 5)}" width="${r(el.w + 10)}" height="${r(el.h + 10)}" rx="6" class="rev-${hl}" fill="none" stroke-width="2.5" stroke-dasharray="5 3"/>` : '';
  const attrs = edit ? ` data-id="${el.id}" data-type="node" class="el${el.locked ? ' locked' : ''}"` : '';
  return `<g${attrs}${opacity}><g${filter}>${body}</g>${text}${hit}${highlight}</g>`;
}

function renderEdge(el, diagram, nodes, ctx) {
  const s = resolveEdgeStyle(el, diagram);
  const geom = edgeGeometry(el, nodes);
  const pts = geom.points.map((p) => ({ ...p }));
  const sw = Number(s.strokeWidth) || 1.5;
  const n = pts.length;
  const bg = diagram.background && diagram.background !== 'transparent' ? diagram.background : '#ffffff';
  // Pull line ends back under solid arrowheads.
  const inEnd = arrowInset(s.endArrow, sw); const inStart = arrowInset(s.startArrow, sw);
  const tipEnd = { ...pts[n - 1] }; const tipStart = { ...pts[0] };
  if (inEnd) { pts[n - 1] = { x: tipEnd.x - geom.endDir.x * inEnd, y: tipEnd.y - geom.endDir.y * inEnd }; }
  if (inStart) { pts[0] = { x: tipStart.x - geom.startDir.x * inStart, y: tipStart.y - geom.startDir.y * inStart }; }
  let d;
  if (geom.curve) {
    const { c1, c2 } = geom.curve;
    d = `M${r(pts[0].x)},${r(pts[0].y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(pts[n - 1].x)},${r(pts[n - 1].y)}`;
  } else {
    d = pts.map((p, i) => `${i ? 'L' : 'M'}${r(p.x)},${r(p.y)}`).join(' ');
  }
  const da = s.dash && s.dash !== 'solid' ? ` stroke-dasharray="${dashArray(s.dash, sw)}"` : '';
  const stroke = xmlEscape(s.stroke);
  let out = '';
  const edit = ctx.mode === 'edit';
  if (edit) out += `<path d="${d}" class="hit" fill="none" stroke="transparent" stroke-width="${Math.max(12, sw + 10)}"/>`;
  out += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}"${da} stroke-linejoin="round" stroke-linecap="${s.dash === 'dotted' ? 'round' : 'butt'}"/>`;
  out += arrowSVG(s.endArrow, tipEnd, geom.endDir, stroke, sw, bg);
  out += arrowSVG(s.startArrow, tipStart, geom.startDir, stroke, sw, bg);
  if (el.text && ctx.hideTextId !== el.id) {
    const mid = pathMidpoint(geom);
    const font = { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle };
    const lay = layoutText(el.text, font, 220);
    const w = lay.width + 8; const h = lay.height + 4;
    const box = { x: mid.x - w / 2, y: mid.y - h / 2, w, h };
    out += `<rect x="${r(box.x)}" y="${r(box.y)}" width="${r(w)}" height="${r(h)}" fill="${bg}" rx="2"/>`;
    out += textSVG(el.text, box, { ...s, align: 'center', vAlign: 'middle', underline: false }, { padding: 0 });
  }
  const hl = ctx.highlights?.get(el.id);
  if (hl) out += `<path d="${d}" class="rev-${hl}" fill="none" stroke-width="${sw + 6}" stroke-opacity=".35"/>`;
  const attrs = edit ? ` data-id="${el.id}" data-type="edge" class="el edge"` : '';
  return `<g${attrs}>${out}</g>`;
}

const SHADOW_DEF = '<filter id="gd-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0f172a" flood-opacity="0.18"/></filter>';

export function defsFor(diagram) {
  return diagram.elements.some((el) => isNode(el) && el.style?.shadow) ? `<defs>${SHADOW_DEF}</defs>` : '';
}

/**
 * Render all elements (in z-order) as an SVG fragment.
 * ctx: { mode: 'edit' | 'export', hideTextId, highlights: Map(id → 'added'|'changed') }
 */
export function renderElements(diagram, ctx = { mode: 'export' }) {
  const nodes = nodeMap(diagram);
  return diagram.elements.map((el) => {
    try {
      return isEdge(el) ? renderEdge(el, diagram, nodes, ctx) : renderNode(el, diagram, ctx);
    } catch (err) {
      console.warn('[render] element failed', el, err);
      return '';
    }
  }).join('');
}

/** Bounding box of everything that is drawn (nodes, labels below actors, connectors, labels). */
export function computeBounds(diagram) {
  const nodes = nodeMap(diagram);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const el of diagram.elements) {
    if (isNode(el)) {
      add(el.x, el.y); add(el.x + el.w, el.y + el.h);
      if (el.shape === 'actor' && el.text) {
        const s = resolveNodeStyle(el, diagram);
        const lay = layoutText(el.text, s, el.w + 100);
        add(el.x + el.w / 2 - lay.width / 2, el.y + el.h + 2 + lay.height);
        add(el.x + el.w / 2 + lay.width / 2, el.y + el.h + 2);
      }
    } else if (isEdge(el)) {
      try {
        const g = edgeGeometry(el, nodes);
        if (g.curve) {
          for (let t = 0; t <= 1; t += 0.1) { const p = bezierPoint(g.points[0], g.curve.c1, g.curve.c2, g.points[g.points.length - 1], t); add(p.x, p.y); }
        } else g.points.forEach((p) => add(p.x, p.y));
        if (el.text) {
          const s = resolveEdgeStyle(el, diagram);
          const mid = pathMidpoint(g); const lay = layoutText(el.text, s, 220);
          add(mid.x - lay.width / 2 - 4, mid.y - lay.height / 2 - 2); add(mid.x + lay.width / 2 + 4, mid.y + lay.height / 2 + 2);
        }
      } catch { /* ignore broken edges */ }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 400, h: 260, empty: true };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const diagramOf = (input) => (input?.diagram ? input.diagram : input);

/**
 * Standalone SVG for export / preview.
 * options: { padding = 24, background (default diagram background; null/'transparent' = none) }
 * → { svg, width, height }
 */
export function renderFigureSVG(input, { padding = 24, background } = {}) {
  const diagram = diagramOf(input);
  const b = computeBounds(diagram);
  const x = Math.floor(b.x - padding); const y = Math.floor(b.y - padding);
  const width = Math.ceil(b.w + padding * 2); const height = Math.ceil(b.h + padding * 2);
  const bg = background === undefined ? (diagram.background || '#ffffff') : background;
  const bgRect = bg && bg !== 'transparent' ? `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${xmlEscape(bg)}"/>` : '';
  const font = fontStack(diagramDefaults(diagram).fontFamily);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" font-family="${xmlEscape(font)}">${defsFor(diagram)}${bgRect}${renderElements(diagram, { mode: 'export' })}</svg>`;
  return { svg, width, height };
}

/** Scalable thumbnail markup (fills its container). */
export function renderThumbnail(input, { padding = 16 } = {}) {
  const diagram = diagramOf(input);
  if (!diagram?.elements?.length) return '<svg viewBox="0 0 160 100"><text x="80" y="54" text-anchor="middle" font-size="11" fill="#98a2b3" font-family="sans-serif">Empty figure</text></svg>';
  const b = computeBounds(diagram);
  return `<svg viewBox="${r(b.x - padding)} ${r(b.y - padding)} ${r(b.w + padding * 2)} ${r(b.h + padding * 2)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${defsFor(diagram)}${renderElements(diagram, { mode: 'export' })}</svg>`;
}

export { paint };
