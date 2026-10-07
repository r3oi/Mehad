// Diagram spec → editable diagram (shapes, connectors, layout). See spec.js for the format.
import { builder } from '../templates/builder.js';
import { contextDiagram } from '../templates/index.js';
import { getShape } from '../shapes.js';
import { autoLayout, measureLabel } from '../layout.js';
import { normalizeSpec } from './spec.js';

const SOFT = { fill: '#eef2fb' };
const ZWSP = '​'; // keeps an empty class/entity compartment alive (compartments are split on blank lines)
const START_RE = /^(start|begin|beginning|بداية|البداية|ابدأ|بدء|البدء)$/i;
const END_RE = /^(end|stop|finish|finished|نهاية|النهاية|انتهاء|الانتهاء|إنهاء|انتهى)$/i;

const DEFAULT_KIND = { flowchart: 'process', activity: 'process', hierarchy: 'process', usecase: 'usecase', context: 'actor', class: 'class', erd: 'entity', state: 'state', architecture: 'service', component: 'component', generic: 'process' };
const DEFAULT_DIRECTION = { flowchart: 'TB', activity: 'TB', hierarchy: 'TB', usecase: 'LR', context: 'LR', class: 'TB', erd: 'LR', state: 'LR', architecture: 'TB', component: 'LR', generic: 'TB' };

const roundUp = (v, step = 10) => Math.ceil(v / step) * step;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Size a shape so its label fits (wrapping onto at most `maxLines` lines before growing wider). */
function fit(shapeId, text, font, { minW, minH, maxW = 300, maxLines = 2 } = {}) {
  const shape = getShape(shapeId);
  const w0 = minW ?? shape.defaults.w; const h0 = minH ?? shape.defaults.h;
  if (!text) return { w: w0, h: h0 };
  const probe = { x: 0, y: 0, w: 200, h: 200 };
  const tb = shape.textBox ? shape.textBox(probe) : probe;
  const fx = tb.w / 200; const fy = tb.h / 200;
  const pad = (shape.textPadding ?? 6) + 4;
  let W = roundUp(w0);
  let lay = measureLabel(text, font, Math.max(24, W * fx - 2 * pad));
  while (lay.lines.length > maxLines && W < maxW) {
    W += 10;
    lay = measureLabel(text, font, Math.max(24, W * fx - 2 * pad));
  }
  return { w: W, h: Math.max(h0, roundUp((lay.h + 2 * pad + 6) / fy)) };
}

/** Compartment shapes (class / entity): size from the longest line and the line count. */
function fitCompartments(lines, nameLines, font, { minW, fontSize = 13, maxW = 380 }) {
  const f = { fontFamily: font.fontFamily, fontSize, fontWeight: 'normal', fontStyle: 'normal' };
  const lh = fontSize * 1.25;
  const widest = Math.max(0, ...lines.flat().map((l) => measureLabel(l, { ...f, fontWeight: 'bold' }, 1000).w));
  const w = clamp(roundUp(widest + 32), minW, maxW);
  const head = Math.max(lh * nameLines + 12, 30);
  const body = lines.slice(1).reduce((s, part) => s + Math.max(1, part.length) * lh + 14, 0);
  return { w, h: roundUp(head + body + 4) };
}

function erdField(raw) {
  const f = String(raw).trim();
  let m = f.match(/^(PK|FK|UK)\b[\s:.\-)]*(.+)$/i);
  if (m) return `${m[1].toUpperCase()}  ${m[2].trim()}`;
  m = f.match(/^(.+?)[\s(,[]+\(?(PK|FK|UK)\)?\]?\s*$/i);
  if (m) return `${m[2].toUpperCase()}  ${m[1].trim()}`;
  return `    ${f}`;
}

/** The kind a node really gets (explicit kind, else inferred from the label and the diagram type). */
function resolveKind(node, spec) {
  const type = spec.type;
  let kind = node.kind;
  const label = node.label.trim();
  if (!kind) {
    if (['flowchart', 'activity', 'generic', 'state'].includes(type) && START_RE.test(label)) kind = 'start';
    else if (['flowchart', 'activity', 'generic', 'state'].includes(type) && END_RE.test(label)) kind = 'end';
    else if (['flowchart', 'activity', 'generic'].includes(type) && /[?؟]$/.test(label)) kind = 'decision';
    else kind = DEFAULT_KIND[type] || 'process';
  }
  if (type === 'activity' || type === 'state') { if (kind === 'start') kind = 'initial'; else if (kind === 'end') kind = 'final'; }
  else if (type === 'flowchart' || type === 'generic') { if (kind === 'initial') kind = 'start'; else if (kind === 'final') kind = 'end'; }
  return kind;
}

/** → { shape, w, h, text, style } for one node. */
function nodeDef(node, kind, spec, ctx) {
  const { font, dir } = ctx;
  const label = node.label;
  const type = spec.type;
  switch (kind) {
    case 'start': case 'end': {
      const text = label || (kind === 'start' ? 'Start' : 'End');
      return { shape: 'terminator', text, ...fit('terminator', text, font, { maxLines: 1, maxW: 260 }), style: {} };
    }
    case 'initial': return { shape: 'circle', text: '', w: 30, h: 30, style: { fill: '#111827', stroke: '#111827' } };
    case 'final': return { shape: 'final', text: '', w: 34, h: 34, style: {} };
    case 'fork': case 'join': {
      const long = dir === 'LR' ? { w: 8, h: 140 } : { w: 140, h: 8 };
      return { shape: 'rect', text: '', ...long, style: { fill: '#111827', stroke: '#111827' } };
    }
    case 'circle': return { shape: 'circle', text: label, ...fit('circle', label, font, { minW: 60, minH: 60, maxW: 140, maxLines: 3 }), style: {} };
    case 'decision': return { shape: 'diamond', text: label, ...fit('diamond', label, font, { minW: 150, minH: 90, maxW: 280, maxLines: 3 }), style: {} };
    case 'io': return { shape: 'parallelogram', text: label, ...fit('parallelogram', label, font, { minW: 170 }), style: {} };
    case 'database': return { shape: 'cylinder', text: label, ...fit('cylinder', label, font, { minW: 110, minH: 90, maxLines: 3 }), style: {} };
    case 'document': return { shape: 'document', text: label, ...fit('document', label, font, { minW: 150 }), style: {} };
    case 'subprocess': return { shape: 'predefined', text: label, ...fit('predefined', label, font, { minW: 170 }), style: {} };
    case 'actor': return { shape: 'actor', text: label, w: 44, h: 84, style: {} };
    case 'usecase': return { shape: 'ellipse', text: label, ...fit('ellipse', label, font, { minW: 190, minH: 70, maxW: 300, maxLines: 2 }), style: {} };
    case 'state': return { shape: 'roundRect', text: label, ...fit('roundRect', label, font, { minW: 140, minH: 56 }), style: { radius: 18 } };
    case 'note': return { shape: 'note', text: label, ...fit('note', label, font, { minW: 160, minH: 80, maxLines: 4 }), style: {} };
    case 'component': return { shape: 'component', text: label, ...fit('component', label, font, { minW: 180, minH: 70 }), style: {} };
    case 'service': return { shape: 'roundRect', text: label, ...fit('roundRect', label, font, { minW: 180, minH: 56 }), style: { ...SOFT, radius: 10 } };
    case 'browser': return { shape: 'browser', text: label, ...fit('browser', label, font, { minW: 180, minH: 110 }), style: {} };
    case 'mobile': return { shape: 'mobile', text: label, ...fit('mobile', label, font, { minW: 90, minH: 140, maxW: 140, maxLines: 3 }), style: {} };
    case 'cloud': return { shape: 'cloud', text: label, ...fit('cloud', label, font, { minW: 170, minH: 100, maxLines: 3 }), style: {} };
    case 'server': return { shape: 'node3d', text: label, ...fit('node3d', label, font, { minW: 200, minH: 120 }), style: {} };
    case 'boundary': {
      const arch = type === 'architecture' || type === 'component';
      return { shape: 'frame', text: label, w: 360, h: 260, style: arch ? { fill: '#f5f7fb', radius: 10 } : { fill: 'none' } };
    }
    case 'class': case 'interface': {
      const head = kind === 'interface' ? ['«interface»', label] : [label];
      // An interface without attributes has just the operations compartment.
      const parts = kind === 'interface' && !node.fields.length ? [node.methods] : [node.fields, node.methods];
      const text = [head.join('\n'), ...parts.map((p) => (p.length ? p : [ZWSP]).join('\n'))].join('\n--\n');
      return { shape: 'class', text, ...fitCompartments([head, ...parts], head.length, font, { minW: 170 }), style: {} };
    }
    case 'entity': {
      const fields = node.fields.length ? node.fields.map(erdField) : [ZWSP];
      const text = [label, fields.join('\n')].join('\n--\n');
      return { shape: 'entity', text, ...fitCompartments([[label], node.fields], 1, font, { minW: 180 }), style: { headerFill: '#e8edf7' } };
    }
    case 'process': default: {
      if (type === 'activity') return { shape: 'roundRect', text: label, ...fit('roundRect', label, font, { minW: 160, minH: 56 }), style: { radius: 18 } };
      return { shape: 'rect', text: label, ...fit('rect', label, font, { minW: 160, minH: 64 }), style: {} };
    }
  }
}

const ER = {
  'one-to-many': ['oneOne', 'zeroMany'], 'many-to-one': ['zeroMany', 'oneOne'], 'many-to-many': ['zeroMany', 'zeroMany'], 'one-to-one': ['oneOne', 'oneOne'],
};

/** → { style, text } for an edge of the given kind. */
function edgeLook(edge, kind) {
  let style = { endArrow: 'arrow' };
  let text = edge.label;
  switch (kind) {
    case 'line': style = { endArrow: 'none' }; break;
    case 'dashed': style = { dash: 'dashed', endArrow: 'arrow' }; break;
    case 'inherit': style = { endArrow: 'triangleOpen' }; break;
    case 'realize': style = { dash: 'dashed', endArrow: 'triangleOpen' }; break;
    case 'compose': style = { startArrow: 'diamondFilled', endArrow: 'none' }; break;
    case 'aggregate': style = { startArrow: 'diamond', endArrow: 'none' }; break;
    case 'include': style = { dash: 'dashed', endArrow: 'arrow' }; text = text || '«include»'; break;
    case 'extend': style = { dash: 'dashed', endArrow: 'arrow' }; text = text || '«extend»'; break;
    default:
      if (ER[kind]) style = { startArrow: ER[kind][0], endArrow: ER[kind][1] };
  }
  if (edge.fromEnd) style.startArrow = edge.fromEnd;
  if (edge.toEnd) style.endArrow = edge.toEnd;
  return { style, text };
}

function defaultEdgeKind(edge, spec, kindOf) {
  if (edge.kind) return edge.kind;
  if (spec.type === 'hierarchy') return 'line';
  if (spec.type === 'erd') return 'one-to-many';
  if (spec.type === 'usecase' && (kindOf(edge.from) === 'actor' || kindOf(edge.to) === 'actor')) return 'line';
  return 'arrow';
}

// ---------------------------------------------------------------------------
// Graph diagrams (everything except sequence)

/**
 * Seed positions so the layout keeps the order of the spec and containment is known:
 * leaves sit on a widely spaced diagonal; a group's frame encloses its children.
 */
function seed(spec, elOf) {
  const kids = new Map();
  for (const n of spec.nodes) { const p = n.parent || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n.id); }
  const step = 1000;
  const placeGroup = (ids, ox, oy) => {
    let cx = ox; let cy = oy;
    for (const id of ids) {
      const el = elOf(id);
      const children = kids.get(id);
      if (children?.length) {
        const end = placeGroup(children, cx + 400, cy + 400);
        el.x = cx; el.y = cy; el.w = end.x - cx + 400; el.h = end.y - cy + 400;
        cx = el.x + el.w + step; cy = el.y + el.h + step;
      } else { el.x = cx; el.y = cy; cx += step; cy += step; }
    }
    return { x: cx, y: cy };
  };
  placeGroup(kids.get(null) || [], 0, 0);
}

function buildGraph(spec, ctx) {
  const { fontFamily, fontSize } = ctx;
  const b = builder({ fontFamily, fontSize });
  const font = { fontFamily, fontSize, fontWeight: 'normal', fontStyle: 'normal' };
  const dir = spec.direction || DEFAULT_DIRECTION[spec.type] || 'TB';
  const nodes = spec.nodes.map((n) => ({ ...n }));

  // Groups: anything used as a parent becomes a frame; a boundary nobody uses is just a box.
  const parents = new Set(nodes.map((n) => n.parent).filter(Boolean));
  for (const n of nodes) {
    if (parents.has(n.id)) n.kind = 'boundary';
    else if (n.kind === 'boundary') n.kind = 'process';
  }
  // Use-case diagrams: use cases live inside one system boundary.
  if (spec.type === 'usecase') {
    const kindsNow = new Map(nodes.map((n) => [n.id, resolveKind(n, spec)]));
    const boundaries = nodes.filter((n) => kindsNow.get(n.id) === 'boundary');
    const inner = nodes.filter((n) => kindsNow.get(n.id) !== 'actor' && kindsNow.get(n.id) !== 'boundary' && !n.parent);
    if (!boundaries.length && inner.length && nodes.some((n) => kindsNow.get(n.id) === 'actor')) {
      const sys = { id: '__system', label: spec.title || 'System', kind: 'boundary', fields: [], methods: [], parent: undefined };
      nodes.unshift(sys);
      for (const n of inner) n.parent = sys.id;
    } else if (boundaries.length === 1) {
      for (const n of inner) n.parent = boundaries[0].id;
    }
  }
  const view = { ...spec, nodes };
  const kindOf = new Map(nodes.map((n) => [n.id, resolveKind(n, view)]));

  const hierarchyRoots = spec.type === 'hierarchy' ? new Set(nodes.map((n) => n.id)) : null;
  if (hierarchyRoots) for (const e of spec.edges) hierarchyRoots.delete(e.to);

  const els = new Map();
  for (const n of nodes) {
    const kind = kindOf.get(n.id);
    const def = nodeDef(n, kind, view, { font, dir });
    const style = { ...def.style };
    if (hierarchyRoots?.has(n.id) && kind === 'process' && hierarchyRoots.size <= 3) Object.assign(style, { fill: '#eef2fb', fontWeight: 'bold' });
    els.set(n.id, b.node(def.shape, 0, 0, def.w, def.h, def.text, style));
  }
  seed(view, (id) => els.get(id));

  for (const e of spec.edges) {
    const look = edgeLook(e, defaultEdgeKind(e, view, (id) => kindOf.get(id)));
    b.edge(els.get(e.from), els.get(e.to), { text: look.text, style: look.style, routing: 'orthogonal' });
  }
  const diagram = b.diagram();
  autoLayout(diagram, {
    mode: spec.type === 'hierarchy' ? 'tree' : 'layered',
    direction: dir,
    routing: spec.type === 'usecase' ? 'straight' : 'orthogonal',
  });
  margin(diagram, 40, 30);
  return diagram;
}

/** Move the whole diagram so its top-left corner sits at (x, y). */
function margin(diagram, x, y) {
  const nodes = diagram.elements.filter((e) => e.type === 'node');
  if (!nodes.length) return;
  const dx = x - Math.min(...nodes.map((n) => n.x));
  const dy = y - Math.min(...nodes.map((n) => n.y));
  for (const n of nodes) { n.x = Math.round(n.x + dx); n.y = Math.round(n.y + dy); }
  for (const e of diagram.elements) {
    if (e.type !== 'edge') continue;
    for (const end of [e.source, e.target]) if (end && !end.id) { end.x += dx; end.y += dy; }
  }
}

// ---------------------------------------------------------------------------
// Context diagrams: the system in the middle, external entities in two columns, one arrow per data flow

function buildContext(spec, ctx) {
  const { fontFamily, fontSize } = ctx;
  const font = { fontFamily, fontSize, fontWeight: 'normal', fontStyle: 'normal' };
  const view = { ...spec, nodes: spec.nodes };
  const ids = new Set(spec.nodes.map((n) => n.id));
  const degree = new Map(spec.nodes.map((n) => [n.id, 0]));
  for (const e of spec.edges) { degree.set(e.from, (degree.get(e.from) || 0) + 1); degree.set(e.to, (degree.get(e.to) || 0) + 1); }
  // The system is the boundary / circle node, else the node most flows go through.
  const system = spec.nodes.find((n) => ['boundary', 'circle'].includes(resolveKind(n, view)))
    || [...spec.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))[0];
  const others = spec.nodes.filter((n) => n !== system);
  const lookOf = (e) => {
    const look = edgeLook(e, e.kind || 'arrow');
    const style = { ...look.style };
    if (!e.kind && !e.toEnd) style.endArrow = 'triangle';
    return { style, text: look.text };
  };
  const entities = others.map((n) => {
    const box = fit('rect', n.label, font, { minW: 190, minH: 72, maxW: 300 });
    const flows = spec.edges.filter((e) => (e.from === n.id && e.to === system.id) || (e.to === n.id && e.from === system.id))
      .map((e) => { const look = lookOf(e); return { label: look.text, dir: e.from === n.id ? 'out' : 'in', style: look.style }; });
    return { name: n.label, w: box.w, h: box.h, flows, id: n.id };
  });
  const size = Math.max(240, fit('circle', system.label, font, { minW: 240, minH: 240, maxW: 330, maxLines: 4 }).w);
  const diagram = contextDiagram({ fontFamily, fontSize }, { system: system.label, systemId: system.id, entities, systemSize: size });
  // Flows between two entities (not part of a context diagram, but kept): a plain arrow between the boxes.
  for (const e of spec.edges) {
    if (e.from === system.id || e.to === system.id || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const look = lookOf(e);
    diagram.elements.push({ id: `flow_${diagram.elements.length}`, type: 'edge', source: { id: e.from }, target: { id: e.to }, routing: 'straight', text: look.text, style: look.style });
  }
  margin(diagram, 40, 30);
  return diagram;
}

// ---------------------------------------------------------------------------
// Sequence diagrams

function buildSequence(spec, ctx) {
  const { fontFamily, fontSize } = ctx;
  const b = builder({ fontFamily, fontSize });
  const font = { fontFamily, fontSize, fontWeight: 'normal', fontStyle: 'normal' };
  const edgeFont = { ...font, fontSize: Math.round(fontSize * 0.86) };
  const people = spec.participants;
  const top = 30; const headH = 44; const rowH = 58;
  const widths = people.map((p) => clamp(roundUp(measureLabel(p.label, font, 210).w + 28), 120, 220));
  const index = new Map(people.map((p, i) => [p.id, i]));
  // Space between lifelines grows when a message label needs more room.
  const gaps = widths.slice(0, -1).map((w, i) => (w + widths[i + 1]) / 2 + 70);
  for (const m of spec.messages) {
    const i = index.get(m.from); const j = index.get(m.to);
    // A message to itself draws a loop and a label to the right of the lifeline: keep the next lifeline clear of it.
    if (i === j && m.label && i < gaps.length) gaps[i] = Math.max(gaps[i], 44 + 16 + measureLabel(m.label, edgeFont, 220).w + 30);
    if (i === j || !m.label) continue;
    const [lo, hi] = i < j ? [i, j] : [j, i];
    const need = measureLabel(m.label, edgeFont, 220).w + 44;
    const have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
    if (need > have) for (let k = lo; k < hi; k += 1) gaps[k] += (need - have) / (hi - lo);
  }
  const centers = []; let cx = 40 + widths[0] / 2;
  people.forEach((_, i) => { centers.push(cx); cx += gaps[i] ?? 0; });
  const rows = Math.max(1, spec.messages.length);
  const h = headH + 40 + rows * rowH + 30;
  const lifelines = people.map((p, i) => b.node('lifeline', Math.round(centers[i] - widths[i] / 2), top, widths[i], h, p.label));
  spec.messages.forEach((m, k) => {
    const y = top + headH + 40 + k * rowH + rowH / 2;
    const a = lifelines[index.get(m.from)]; const c = lifelines[index.get(m.to)];
    const frac = (v) => ({ x: 0.5, y: (v - top) / h });
    // UML message kinds: synchronous = filled head, asynchronous = open head, return = dashed with an open head.
    const style = m.reply ? { dash: 'dashed', endArrow: 'arrow' } : m.async ? { endArrow: 'arrow' } : { endArrow: 'triangle' };
    if (a === c) {
      // Message to itself: a small loop to the right of the lifeline, label beside it.
      const lx = a.x + a.w / 2 + 44;
      const p1 = b.node('point', lx - 1, y - 1, 2, 2, '', { fill: 'none', stroke: 'none' });
      const p2 = b.node('point', lx - 1, y + 22 - 1, 2, 2, '', { fill: 'none', stroke: 'none' });
      b.edge(a, p1, { routing: 'straight', from: frac(y), style: { endArrow: 'none', dash: m.reply ? 'dashed' : 'solid' } });
      b.edge(p1, p2, { routing: 'straight', style: { endArrow: 'none', dash: m.reply ? 'dashed' : 'solid' } });
      b.edge(p2, a, { routing: 'straight', to: frac(y + 22), style });
      if (m.label) b.node('text', lx + 10, y - 2, Math.min(220, roundUp(measureLabel(m.label, edgeFont, 220).w + 16)), 26, m.label, { align: 'left', fontSize: edgeFont.fontSize });
      return;
    }
    b.edge(a, c, { routing: 'straight', text: m.label, from: frac(y), to: frac(y), style });
  });
  const diagram = b.diagram();
  margin(diagram, 40, 30);
  return diagram;
}

// ---------------------------------------------------------------------------

/**
 * Validate a spec (object or JSON text) and build the diagram.
 * → { diagram, spec (normalised), warnings }   — throws SpecError for unusable input.
 * options: { fontFamily, fontSize, type }  (type forces the diagram type)
 */
export function buildDiagramFromSpec(input, { fontFamily = 'Times New Roman', fontSize = 14, type } = {}) {
  const { spec, warnings } = normalizeSpec(input, { type });
  const ctx = { fontFamily, fontSize };
  const diagram = spec.type === 'sequence' ? buildSequence(spec, ctx) : spec.type === 'context' ? buildContext(spec, ctx) : buildGraph(spec, ctx);
  return { diagram, spec, warnings };
}

/** specToDiagram(spec, { fontFamily, fontSize }) → diagram (see buildDiagramFromSpec for warnings and the normalised spec). */
export function specToDiagram(spec, options = {}) {
  return buildDiagramFromSpec(spec, options).diagram;
}
