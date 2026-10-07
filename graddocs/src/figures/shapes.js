// Shape registry. Each shape knows how to draw its body, where its text goes
// and which outline connectors should attach to. Add a shape with
// registerShape({...}) — the editor, library, renderer and exports pick it up.
import { r, textSVG, xmlEscape } from './text-layout.js';

export const BASE_NODE_STYLE = {
  fill: '#ffffff', stroke: '#1f2937', strokeWidth: 1.5, dash: 'solid', radius: 0,
  fontFamily: null, fontSize: null, fontWeight: 'normal', fontStyle: 'normal', underline: false,
  textColor: '#111827', align: 'center', vAlign: 'middle', opacity: 1, shadow: false,
};

export const BASE_EDGE_STYLE = {
  stroke: '#1f2937', strokeWidth: 1.5, dash: 'solid', startArrow: 'none', endArrow: 'arrow',
  fontFamily: null, fontSize: null, textColor: '#111827', fontWeight: 'normal', fontStyle: 'normal',
};

const SHAPES = new Map();

/**
 * registerShape({
 *   id, name,
 *   defaults: { w, h, text, style },
 *   outline: 'rect' | 'ellipse' | 'diamond' | 'lifeline',
 *   aspect: bool (keep ratio when resizing), container: bool (drags enclosed nodes),
 *   textBox(el) → { x, y, w, h },  textPadding,
 *   draw(el, style, ctx) → SVG string,  drawText?(el, style, ctx) → SVG string (custom text),
 *   hit?(el) → SVG string for pointer hit area (editor only)
 * })
 */
export function registerShape(def) {
  SHAPES.set(def.id, { outline: 'rect', textPadding: 6, ...def });
}

export const getShape = (id) => SHAPES.get(id) || SHAPES.get('rect');
export const allShapes = () => [...SHAPES.values()];

export function dashArray(dash, sw = 1.5) {
  const k = Math.max(1, sw / 1.5);
  if (dash === 'dashed') return `${r(7 * k)} ${r(4.5 * k)}`;
  if (dash === 'dotted') return `${r(1.6 * k)} ${r(3.2 * k)}`;
  return '';
}

/** fill/stroke attributes for a resolved style. */
export function paint(s, { fill = s.fill, stroke = s.stroke } = {}) {
  const da = s.dash && s.dash !== 'solid' ? dashArray(s.dash, s.strokeWidth) : '';
  const hasStroke = stroke && stroke !== 'none' && s.strokeWidth > 0;
  return [
    `fill="${fill && fill !== 'none' ? xmlEscape(fill) : 'none'}"`,
    hasStroke ? `stroke="${xmlEscape(stroke)}" stroke-width="${s.strokeWidth}"` : 'stroke="none"',
    hasStroke && da ? `stroke-dasharray="${da}"` : '',
    hasStroke && s.dash === 'dotted' ? 'stroke-linecap="round"' : '',
    'stroke-linejoin="round"',
  ].filter(Boolean).join(' ');
}

const inset = (el, pad = 0) => ({ x: el.x + pad, y: el.y + pad, w: Math.max(1, el.w - pad * 2), h: Math.max(1, el.h - pad * 2) });
const poly = (pts) => pts.map((p) => `${r(p[0])},${r(p[1])}`).join(' ');

// ---------------------------------------------------------------------------
// Basic shapes
registerShape({
  id: 'rect', name: 'Rectangle',
  defaults: { w: 160, h: 64, text: 'Process' },
  draw: (el, s) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${s.radius || 0}" ${paint(s)}/>`,
});

registerShape({
  id: 'roundRect', name: 'Rounded Rectangle',
  defaults: { w: 160, h: 64, text: 'Step', style: { radius: 12 } },
  draw: (el, s) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${Math.min(s.radius ?? 12, el.h / 2, el.w / 2)}" ${paint(s)}/>`,
});

registerShape({
  id: 'circle', name: 'Circle', outline: 'ellipse', aspect: true,
  defaults: { w: 80, h: 80, text: '' },
  textBox: (el) => inset(el, el.w * 0.15),
  draw: (el, s) => `<ellipse cx="${r(el.x + el.w / 2)}" cy="${r(el.y + el.h / 2)}" rx="${r(el.w / 2)}" ry="${r(el.h / 2)}" ${paint(s)}/>`,
});

registerShape({
  id: 'ellipse', name: 'Ellipse', outline: 'ellipse',
  defaults: { w: 170, h: 70, text: 'Use Case' },
  textBox: (el) => ({ x: el.x + el.w * 0.12, y: el.y + el.h * 0.12, w: el.w * 0.76, h: el.h * 0.76 }),
  draw: (el, s) => `<ellipse cx="${r(el.x + el.w / 2)}" cy="${r(el.y + el.h / 2)}" rx="${r(el.w / 2)}" ry="${r(el.h / 2)}" ${paint(s)}/>`,
});

registerShape({
  id: 'diamond', name: 'Diamond', outline: 'diamond',
  defaults: { w: 150, h: 90, text: 'Decision?' },
  textBox: (el) => ({ x: el.x + el.w * 0.2, y: el.y + el.h * 0.2, w: el.w * 0.6, h: el.h * 0.6 }),
  draw: (el, s) => `<polygon points="${poly([[el.x + el.w / 2, el.y], [el.x + el.w, el.y + el.h / 2], [el.x + el.w / 2, el.y + el.h], [el.x, el.y + el.h / 2]])}" ${paint(s)}/>`,
});

registerShape({
  id: 'text', name: 'Text',
  defaults: { w: 160, h: 36, text: 'Text', style: { fill: 'none', stroke: 'none' } },
  textPadding: 2,
  draw: (el, s) => (s.fill !== 'none' || (s.stroke !== 'none' && s.strokeWidth > 0)
    ? `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${s.radius || 0}" ${paint(s)}/>` : ''),
  hit: (el) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" fill="transparent"/>`,
});

// ---------------------------------------------------------------------------
// Flowchart
registerShape({
  id: 'terminator', name: 'Start / End',
  defaults: { w: 140, h: 52, text: 'Start' },
  draw: (el, s) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${r(el.h / 2)}" ${paint(s)}/>`,
});

registerShape({
  id: 'parallelogram', name: 'Input / Output',
  defaults: { w: 170, h: 64, text: 'Input / Output' },
  textBox: (el) => ({ x: el.x + el.w * 0.14, y: el.y, w: el.w * 0.72, h: el.h }),
  draw: (el, s) => {
    const k = Math.min(el.w * 0.18, el.h * 0.6);
    return `<polygon points="${poly([[el.x + k, el.y], [el.x + el.w, el.y], [el.x + el.w - k, el.y + el.h], [el.x, el.y + el.h]])}" ${paint(s)}/>`;
  },
});

registerShape({
  id: 'document', name: 'Document',
  defaults: { w: 150, h: 76, text: 'Document' },
  textBox: (el) => ({ x: el.x, y: el.y, w: el.w, h: el.h * 0.84 }),
  draw: (el, s) => {
    const { x, y, w, h } = el; const wave = h * 0.12;
    return `<path d="M${r(x)},${r(y)} H${r(x + w)} V${r(y + h - wave)} C${r(x + w * 0.75)},${r(y + h - wave * 2.6)} ${r(x + w * 0.5)},${r(y + h + wave * 0.6)} ${r(x)},${r(y + h - wave)} Z" ${paint(s)}/>`;
  },
});

registerShape({
  id: 'cylinder', name: 'Database',
  defaults: { w: 110, h: 90, text: 'Database' },
  textBox: (el) => ({ x: el.x, y: el.y + Math.min(el.h * 0.2, 24), w: el.w, h: el.h - Math.min(el.h * 0.2, 24) }),
  draw: (el, s) => {
    const { x, y, w, h } = el; const ry = Math.min(h * 0.12, 14); const rx = w / 2;
    return `<path d="M${r(x)},${r(y + ry)} A${r(rx)},${r(ry)} 0 0 1 ${r(x + w)},${r(y + ry)} V${r(y + h - ry)} A${r(rx)},${r(ry)} 0 0 1 ${r(x)},${r(y + h - ry)} Z" ${paint(s)}/>`
      + `<path d="M${r(x)},${r(y + ry)} A${r(rx)},${r(ry)} 0 0 0 ${r(x + w)},${r(y + ry)}" ${paint(s, { fill: 'none' })}/>`;
  },
});

registerShape({
  id: 'hexagon', name: 'Preparation',
  defaults: { w: 160, h: 64, text: 'Preparation' },
  textBox: (el) => ({ x: el.x + el.w * 0.14, y: el.y, w: el.w * 0.72, h: el.h }),
  draw: (el, s) => {
    const k = Math.min(el.w * 0.18, el.h * 0.5);
    return `<polygon points="${poly([[el.x + k, el.y], [el.x + el.w - k, el.y], [el.x + el.w, el.y + el.h / 2], [el.x + el.w - k, el.y + el.h], [el.x + k, el.y + el.h], [el.x, el.y + el.h / 2]])}" ${paint(s)}/>`;
  },
});

registerShape({
  id: 'predefined', name: 'Subprocess',
  defaults: { w: 170, h: 64, text: 'Subprocess' },
  textBox: (el) => ({ x: el.x + 14, y: el.y, w: el.w - 28, h: el.h }),
  draw: (el, s) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" ${paint(s)}/>`
    + `<path d="M${r(el.x + 10)},${r(el.y)} V${r(el.y + el.h)} M${r(el.x + el.w - 10)},${r(el.y)} V${r(el.y + el.h)}" ${paint(s, { fill: 'none' })}/>`,
});

// ---------------------------------------------------------------------------
// UML
registerShape({
  id: 'actor', name: 'Actor',
  defaults: { w: 44, h: 84, text: 'Actor' },
  textBox: (el) => ({ x: el.x - 50, y: el.y + el.h + 2, w: el.w + 100, h: 22 }),
  textPadding: 0,
  draw: (el, s) => {
    const { x, y, w, h } = el; const cx = x + w / 2;
    const head = Math.min(w * 0.42, h * 0.16);
    const neck = y + head * 2; const hip = y + h * 0.62;
    return `<g ${paint(s)}><circle cx="${r(cx)}" cy="${r(y + head)}" r="${r(head)}"/>`
      + `<path fill="none" d="M${r(cx)},${r(neck)} V${r(hip)} M${r(x)},${r(neck + (hip - neck) * 0.28)} H${r(x + w)} M${r(cx)},${r(hip)} L${r(x + w * 0.06)},${r(y + h)} M${r(cx)},${r(hip)} L${r(x + w * 0.94)},${r(y + h)}"/></g>`;
  },
  hit: (el) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h + 24)}" fill="transparent"/>`,
});

registerShape({
  id: 'note', name: 'Note',
  defaults: { w: 160, h: 80, text: 'Note', style: { fill: '#fffbea' } },
  textBox: (el) => inset(el, 4),
  draw: (el, s) => {
    const { x, y, w, h } = el; const f = Math.min(16, w * 0.2, h * 0.3);
    return `<path d="M${r(x)},${r(y)} H${r(x + w - f)} L${r(x + w)},${r(y + f)} V${r(y + h)} H${r(x)} Z" ${paint(s)}/>`
      + `<path d="M${r(x + w - f)},${r(y)} V${r(y + f)} H${r(x + w)}" ${paint(s, { fill: 'none' })}/>`;
  },
});

registerShape({
  id: 'package', name: 'Package',
  defaults: { w: 200, h: 120, text: 'Package', style: { vAlign: 'top' } },
  textBox: (el) => ({ x: el.x, y: el.y + 22, w: el.w, h: el.h - 22 }),
  draw: (el, s) => {
    const { x, y, w, h } = el; const tw = Math.min(w * 0.4, 90);
    return `<path d="M${r(x)},${r(y)} H${r(x + tw)} V${r(y + 18)} H${r(x)} Z" ${paint(s)}/><rect x="${r(x)}" y="${r(y + 18)}" width="${r(w)}" height="${r(h - 18)}" ${paint(s)}/>`;
  },
});

registerShape({
  id: 'frame', name: 'Boundary / Group', container: true,
  defaults: { w: 360, h: 260, text: 'System', style: { fill: 'none', vAlign: 'top', align: 'center', fontWeight: 'bold' } },
  textBox: (el) => ({ x: el.x + 8, y: el.y + 6, w: el.w - 16, h: 28 }),
  textPadding: 2,
  draw: (el, s) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${s.radius || 0}" ${paint(s)}/>`,
  // Only the border and title band are clickable so shapes inside stay reachable.
  hit: (el) => `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" fill="none" stroke="transparent" stroke-width="12" style="pointer-events:stroke"/>`
    + `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="34" fill="transparent"/>`,
});

/** Compartment shapes: text sections separated by a line containing only "--". */
function compartments(text) {
  return String(text ?? '').split(/\n\s*--+\s*\n|\n\s*--+\s*$/).map((t) => t.replace(/^\n+|\n+$/g, ''));
}

function compartmentShape(id, name, defaults, headerFillDefault) {
  registerShape({
    id, name, defaults,
    textPadding: 6,
    draw: (el, s, ctx) => {
      const parts = compartments(el.text);
      const lh = s.fontSize * 1.25;
      const headH = Math.max(lh * Math.max(1, parts[0].split('\n').length) + 12, 30);
      let out = `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${s.radius || 0}" ${paint(s)}/>`;
      const headerFill = s.headerFill || headerFillDefault;
      if (headerFill && headerFill !== 'none') out += `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(headH)}" ${paint({ ...s, dash: 'solid' }, { fill: headerFill })}/>`;
      let y = el.y + headH;
      const rest = parts.slice(1);
      const free = el.h - headH;
      const lineCounts = rest.map((p) => Math.max(1, p.split('\n').length));
      const totalLines = lineCounts.reduce((a, b) => a + b, 0) || 1;
      rest.forEach((part, i) => {
        out += `<path d="M${r(el.x)},${r(y)} H${r(el.x + el.w)}" ${paint({ ...s, dash: 'solid' }, { fill: 'none' })}/>`;
        const h = i === rest.length - 1 ? el.y + el.h - y : Math.max(lh + 10, (free * lineCounts[i]) / totalLines);
        if (ctx.hideTextId !== el.id) out += textSVG(part, { x: el.x, y, w: el.w, h }, { ...s, align: 'left', vAlign: 'top', fontWeight: 'normal' }, { padding: 6 });
        y += h;
      });
      if (ctx.hideTextId !== el.id) out += textSVG(parts[0], { x: el.x, y: el.y, w: el.w, h: headH }, { ...s, align: 'center', vAlign: 'middle', fontWeight: 'bold' }, { padding: 6 });
      return out;
    },
    drawText: () => '',
  });
}

compartmentShape('class', 'Class', { w: 200, h: 130, text: 'ClassName\n--\n- attribute: Type\n--\n+ operation(): void', style: { fontSize: 13 } }, null);
compartmentShape('entity', 'Entity (table)', { w: 190, h: 140, text: 'Entity\n--\nPK  id\n    name\nFK  other_id', style: { fontSize: 13, headerFill: '#e8edf7' } }, null);

registerShape({
  id: 'lifeline', name: 'Lifeline', outline: 'lifeline',
  defaults: { w: 130, h: 360, text: ':Object' },
  textBox: (el) => ({ x: el.x, y: el.y, w: el.w, h: Math.min(44, el.h) }),
  draw: (el, s) => {
    const hh = Math.min(44, el.h); const cx = el.x + el.w / 2;
    return `<path d="M${r(cx)},${r(el.y + hh)} V${r(el.y + el.h)}" fill="none" stroke="${xmlEscape(s.stroke)}" stroke-width="${s.strokeWidth}" stroke-dasharray="${dashArray('dashed', s.strokeWidth)}"/>`
      + `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(hh)}" rx="${s.radius || 0}" ${paint({ ...s, dash: 'solid' })}/>`;
  },
  hit: (el) => {
    const hh = Math.min(44, el.h); const cx = el.x + el.w / 2;
    return `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(hh)}" fill="transparent"/><rect x="${r(cx - 8)}" y="${r(el.y + hh)}" width="16" height="${r(el.h - hh)}" fill="transparent"/>`;
  },
});

registerShape({
  id: 'final', name: 'Final Node', outline: 'ellipse', aspect: true,
  defaults: { w: 34, h: 34, text: '', style: { fill: '#ffffff' } },
  draw: (el, s) => {
    const cx = el.x + el.w / 2; const cy = el.y + el.h / 2;
    return `<ellipse cx="${r(cx)}" cy="${r(cy)}" rx="${r(el.w / 2)}" ry="${r(el.h / 2)}" ${paint(s)}/>`
      + `<ellipse cx="${r(cx)}" cy="${r(cy)}" rx="${r(el.w * 0.3)}" ry="${r(el.h * 0.3)}" fill="${xmlEscape(s.stroke)}" stroke="none"/>`;
  },
});

// ---------------------------------------------------------------------------
// Architecture / deployment
registerShape({
  id: 'cloud', name: 'Cloud',
  defaults: { w: 170, h: 100, text: 'Internet' },
  textBox: (el) => ({ x: el.x + el.w * 0.18, y: el.y + el.h * 0.25, w: el.w * 0.64, h: el.h * 0.6 }),
  draw: (el, s) => {
    const { x, y, w, h } = el;
    const p = (a, b) => `${r(x + w * a)},${r(y + h * b)}`;
    return `<path d="M${p(0.25, 0.9)} C${p(0.04, 0.9)} ${p(0.0, 0.62)} ${p(0.16, 0.54)} C${p(0.08, 0.3)} ${p(0.3, 0.16)} ${p(0.44, 0.27)} C${p(0.52, 0.04)} ${p(0.86, 0.06)} ${p(0.84, 0.36)} C${p(1.02, 0.38)} ${p(1.02, 0.86)} ${p(0.8, 0.9)} Z" ${paint(s)}/>`;
  },
});

registerShape({
  id: 'node3d', name: 'Node (3D)',
  defaults: { w: 200, h: 120, text: 'Server', style: { vAlign: 'top' } },
  textBox: (el) => { const d = Math.min(14, el.w * 0.1, el.h * 0.15); return { x: el.x, y: el.y + d + 4, w: el.w - d, h: el.h - d - 4 }; },
  draw: (el, s) => {
    const { x, y, w, h } = el; const d = Math.min(14, w * 0.1, h * 0.15);
    return `<polygon points="${poly([[x, y + d], [x + d, y], [x + w, y], [x + w, y + h - d], [x + w - d, y + h], [x, y + h]])}" ${paint(s)}/>`
      + `<path d="M${r(x)},${r(y + d)} H${r(x + w - d)} V${r(y + h)} M${r(x + w - d)},${r(y + d)} L${r(x + w)},${r(y)}" ${paint(s, { fill: 'none' })}/>`;
  },
});

registerShape({
  id: 'component', name: 'Component',
  defaults: { w: 180, h: 70, text: 'Component' },
  textBox: (el) => ({ x: el.x + 4, y: el.y, w: el.w - 30, h: el.h }),
  draw: (el, s) => {
    const ix = el.x + el.w - 24; const iy = el.y + 8;
    return `<rect x="${r(el.x)}" y="${r(el.y)}" width="${r(el.w)}" height="${r(el.h)}" rx="${s.radius || 0}" ${paint(s)}/>`
      + `<g ${paint({ ...s, strokeWidth: 1, dash: 'solid' })}><rect x="${r(ix + 3)}" y="${r(iy)}" width="13" height="16"/><rect x="${r(ix)}" y="${r(iy + 3)}" width="7" height="3.5"/><rect x="${r(ix)}" y="${r(iy + 9.5)}" width="7" height="3.5"/></g>`;
  },
});

registerShape({
  id: 'browser', name: 'Web Client',
  defaults: { w: 180, h: 110, text: 'Web Browser' },
  textBox: (el) => ({ x: el.x, y: el.y + 20, w: el.w, h: el.h - 20 }),
  draw: (el, s) => {
    const { x, y, w, h } = el;
    return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="6" ${paint(s)}/>`
      + `<path d="M${r(x)},${r(y + 20)} H${r(x + w)}" ${paint(s, { fill: 'none' })}/>`
      + [0, 1, 2].map((i) => `<circle cx="${r(x + 11 + i * 10)}" cy="${r(y + 10)}" r="3" fill="${xmlEscape(s.stroke)}"/>`).join('');
  },
});

registerShape({
  id: 'mobile', name: 'Mobile Client',
  defaults: { w: 80, h: 140, text: 'Mobile App' },
  textBox: (el) => ({ x: el.x + 4, y: el.y + 18, w: el.w - 8, h: el.h - 36 }),
  textPadding: 2,
  draw: (el, s) => {
    const { x, y, w, h } = el;
    return `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="12" ${paint(s)}/>`
      + `<path d="M${r(x + w * 0.38)},${r(y + 9)} H${r(x + w * 0.62)} M${r(x + w * 0.42)},${r(y + h - 9)} H${r(x + w * 0.58)}" ${paint({ ...s, strokeWidth: 2 }, { fill: 'none' })} stroke-linecap="round"/>`;
  },
});

registerShape({
  id: 'point', name: 'Junction', aspect: true,
  defaults: { w: 8, h: 8, text: '', style: { fill: '#1f2937', stroke: 'none' } },
  outline: 'ellipse',
  draw: (el, s, ctx) => (ctx.mode === 'edit' || s.fill !== 'none'
    ? `<circle cx="${r(el.x + el.w / 2)}" cy="${r(el.y + el.h / 2)}" r="${r(el.w / 2)}" fill="${ctx.mode === 'edit' && s.fill === 'none' ? 'rgba(79,70,229,.5)' : xmlEscape(s.fill)}"/>` : ''),
  hit: (el) => `<circle cx="${r(el.x + el.w / 2)}" cy="${r(el.y + el.h / 2)}" r="${Math.max(7, el.w / 2 + 3)}" fill="transparent"/>`,
});

// ---------------------------------------------------------------------------
// Library presets shown in the editor's Elements panel.
// Each preset = a shape + defaults; templates use the same shapes.
export const LIBRARY = [
  { group: 'Basic', items: [
    { name: 'Rectangle', shape: 'rect' },
    { name: 'Rounded', shape: 'roundRect' },
    { name: 'Circle', shape: 'circle', text: '' },
    { name: 'Ellipse', shape: 'ellipse', text: 'Ellipse' },
    { name: 'Diamond', shape: 'diamond' },
    { name: 'Text', shape: 'text' },
    { name: 'Note', shape: 'note' },
    { name: 'Group / Boundary', shape: 'frame', text: 'Group' },
  ] },
  { group: 'Flowchart', items: [
    { name: 'Start / End', shape: 'terminator' },
    { name: 'Process', shape: 'rect', text: 'Process' },
    { name: 'Decision', shape: 'diamond', text: 'Condition?' },
    { name: 'Input / Output', shape: 'parallelogram' },
    { name: 'Document', shape: 'document' },
    { name: 'Database', shape: 'cylinder' },
    { name: 'Subprocess', shape: 'predefined' },
    { name: 'Preparation', shape: 'hexagon' },
  ] },
  { group: 'UML', items: [
    { name: 'Actor', shape: 'actor', text: 'User' },
    { name: 'Use Case', shape: 'ellipse', text: 'Use Case' },
    { name: 'System Boundary', shape: 'frame', text: 'System', w: 320, h: 300 },
    { name: 'Class', shape: 'class' },
    { name: 'Interface', shape: 'class', text: '«interface»\nName\n--\n+ method(): void', h: 100 },
    { name: 'Package', shape: 'package' },
    { name: 'Lifeline', shape: 'lifeline' },
    { name: 'Activation', shape: 'rect', text: '', w: 14, h: 80 },
    { name: 'Initial Node', shape: 'circle', text: '', w: 30, h: 30, style: { fill: '#111827', stroke: '#111827' } },
    { name: 'Final Node', shape: 'final' },
    { name: 'Action / State', shape: 'roundRect', text: 'Action', style: { radius: 18 } },
    { name: 'Fork / Join', shape: 'rect', text: '', w: 160, h: 8, style: { fill: '#111827', stroke: '#111827' } },
    { name: 'Component', shape: 'component' },
    { name: 'Node', shape: 'node3d' },
  ] },
  { group: 'ERD', items: [
    { name: 'Entity Table', shape: 'entity' },
    { name: 'Entity', shape: 'rect', text: 'Entity', w: 140, h: 56 },
    { name: 'Weak Entity', shape: 'rect', text: 'Weak Entity', w: 150, h: 56, style: { strokeWidth: 3 } },
    { name: 'Attribute', shape: 'ellipse', text: 'attribute', w: 130, h: 50 },
    { name: 'Key Attribute', shape: 'ellipse', text: 'id', w: 110, h: 46, style: { underline: true } },
    { name: 'Relationship', shape: 'diamond', text: 'has', w: 130, h: 76 },
  ] },
  { group: 'Architecture', items: [
    { name: 'Web Client', shape: 'browser' },
    { name: 'Mobile Client', shape: 'mobile' },
    { name: 'Server / Node', shape: 'node3d' },
    { name: 'Service', shape: 'roundRect', text: 'Service' },
    { name: 'Database', shape: 'cylinder' },
    { name: 'Cloud', shape: 'cloud' },
    { name: 'Layer', shape: 'frame', text: 'Layer', w: 520, h: 140, style: { fill: '#f5f7fb', radius: 10 } },
    { name: 'Junction', shape: 'point' },
  ] },
];
