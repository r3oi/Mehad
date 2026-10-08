// The "diagram spec": a small JSON description of a diagram that people, text parsers
// and the AI can all produce. specToDiagram() (to-diagram.js) turns it into editable shapes.
//
// ---------------------------------------------------------------------------------------------
// SPEC FORMAT
//
//   {
//     "type": "flowchart | activity | hierarchy | usecase | context | sequence | class | erd | state | architecture | component | generic",
//     "title": "Short figure title",                  // optional
//     "direction": "TB | LR",                         // optional: top-to-bottom (default) or left-to-right
//     "nodes": [
//       { "id": "n1", "label": "Start", "kind": "start",
//         "fields": ["- id: int"],                    // class attributes / entity columns (optional)
//         "methods": ["+ login(): bool"],             // class operations (optional)
//         "parent": "b1" }                            // id of the boundary / layer / group that contains it (optional)
//     ],
//     "edges": [
//       { "from": "n1", "to": "n2", "label": "Yes", "kind": "arrow" }   // from / to = node ids
//     ],
//     "participants": ["User", "Web App"],            // sequence diagrams only (strings or { "id", "label" })
//     "messages": [
//       { "from": "User", "to": "Web App", "label": "login()", "reply": false, "async": false }
//     ]                                               // reply = dashed return message; async = open arrowhead (the sender does not wait)
//   }
//
//   node kinds : start, end, initial, final, process, decision, io, database, document, subprocess,
//                fork, join, circle, actor, usecase, class, interface, entity, state, note, component,
//                boundary, service, browser, mobile, cloud, server
//                (omit "kind" to get the usual symbol of the diagram type; a label ending in "?" becomes a decision)
//   edge kinds : arrow (default), line, dashed, inherit, realize, compose, aggregate, include, extend,
//                one-to-many, many-to-one, many-to-many, one-to-one
//   optional edge ends "fromEnd" / "toEnd": none, arrow, triangle, hollow-triangle, diamond, filled-diamond,
//                circle, one, one-only, many, one-many, zero-one, zero-many   (crow's-foot ends for ER diagrams)
//   hierarchy  : "parent" is the parent node (edges are created from it); "edges" may be left out.
//   context    : one "boundary" node is the system (else the node with most edges); every other node is an external
//                entity; edges are the labelled data flows between an entity and the system (one edge per direction).
//   other types: "parent" must point to a node that groups others (boundary, layer, composite state…).
//
// Labels stay in the language of the user (Arabic or English); ids are short ASCII strings.
// ---------------------------------------------------------------------------------------------
import { t } from '../../i18n/index.js';
import { ARROWS } from '../geometry.js';

export const SPEC_TYPES = ['flowchart', 'activity', 'hierarchy', 'usecase', 'context', 'sequence', 'class', 'erd', 'state', 'architecture', 'component', 'generic'];
export const NODE_KINDS = ['start', 'end', 'initial', 'final', 'process', 'decision', 'io', 'database', 'document', 'subprocess', 'fork', 'join', 'circle',
  'actor', 'usecase', 'class', 'interface', 'entity', 'state', 'note', 'component', 'boundary', 'service', 'browser', 'mobile', 'cloud', 'server'];
export const EDGE_KINDS = ['arrow', 'line', 'dashed', 'inherit', 'realize', 'compose', 'aggregate', 'include', 'extend',
  'one-to-many', 'many-to-one', 'many-to-many', 'one-to-one'];
export const EDGE_ENDS = ['none', 'arrow', 'triangle', 'hollow-triangle', 'diamond', 'filled-diamond', 'circle', 'one', 'one-only', 'many', 'one-many', 'zero-one', 'zero-many'];

export const MAX_NODES = 150;
export const MAX_EDGES = 300;
export const MAX_MESSAGES = 120;

/** The Arrow ids understood by the connector renderer (geometry.js). */
const ARROW_IDS = new Set(ARROWS.map((a) => a.id));
const END_ALIASES = {
  none: 'none', arrow: 'arrow', open: 'arrow', triangle: 'triangle', filled: 'triangle', 'hollow-triangle': 'triangleOpen', hollowtriangle: 'triangleOpen', triangleopen: 'triangleOpen',
  diamond: 'diamond', 'hollow-diamond': 'diamond', 'filled-diamond': 'diamondFilled', filleddiamond: 'diamondFilled', diamondfilled: 'diamondFilled', circle: 'circle',
  one: 'one', 'one-only': 'oneOne', 'exactly-one': 'oneOne', oneone: 'oneOne', many: 'zeroMany', 'zero-many': 'zeroMany', zeromany: 'zeroMany', 'zero-or-many': 'zeroMany',
  'one-many': 'oneMany', 'one-or-many': 'oneMany', onemany: 'oneMany', 'zero-one': 'zeroOne', 'zero-or-one': 'zeroOne', zeroone: 'zeroOne',
};

const TYPE_ALIASES = {
  flow: 'flowchart', 'flow chart': 'flowchart', flowchart: 'flowchart', process: 'flowchart',
  activity: 'activity', 'activity diagram': 'activity', hierarchy: 'hierarchy', org: 'hierarchy', orgchart: 'hierarchy', 'org chart': 'hierarchy', wbs: 'hierarchy', tree: 'hierarchy', organization: 'hierarchy',
  usecase: 'usecase', 'use case': 'usecase', 'use-case': 'usecase', 'use_case': 'usecase', 'use case diagram': 'usecase',
  context: 'context', 'context diagram': 'context', 'context-diagram': 'context', 'system context': 'context', 'level 0': 'context', 'dfd level 0': 'context', 'level 0 dfd': 'context',
  sequence: 'sequence', seq: 'sequence', 'sequence diagram': 'sequence',
  class: 'class', 'class diagram': 'class', uml: 'class',
  erd: 'erd', er: 'erd', 'er diagram': 'erd', entity: 'erd', 'entity relationship': 'erd', 'entity-relationship': 'erd',
  state: 'state', statemachine: 'state', 'state machine': 'state', 'state diagram': 'state',
  architecture: 'architecture', arch: 'architecture', system: 'architecture', 'system architecture': 'architecture', deployment: 'architecture',
  component: 'component', 'component diagram': 'component', generic: 'generic', diagram: 'generic', graph: 'generic', auto: 'generic',
};

const KIND_ALIASES = {
  start: 'start', begin: 'start', 'start/end': 'start', terminator: 'start', terminal: 'start', end: 'end', stop: 'end', finish: 'end',
  initial: 'initial', 'initial node': 'initial', final: 'final', 'final node': 'final', 'end node': 'final',
  process: 'process', step: 'process', action: 'process', task: 'process', rect: 'process', rectangle: 'process', box: 'process', activity: 'process', operation: 'process', node: 'process', default: 'process',
  decision: 'decision', condition: 'decision', if: 'decision', diamond: 'decision', branch: 'decision', gateway: 'decision',
  io: 'io', input: 'io', output: 'io', 'input/output': 'io', data: 'io', parallelogram: 'io',
  database: 'database', db: 'database', storage: 'database', datastore: 'database', cylinder: 'database', store: 'database',
  document: 'document', doc: 'document', report: 'document', file: 'document',
  subprocess: 'subprocess', subroutine: 'subprocess', predefined: 'subprocess', 'sub-process': 'subprocess',
  fork: 'fork', join: 'join', bar: 'fork', synchronization: 'fork', circle: 'circle', connector: 'circle', junction: 'circle',
  actor: 'actor', user: 'actor', person: 'actor', role: 'actor', stakeholder: 'actor', external: 'actor',
  usecase: 'usecase', 'use case': 'usecase', 'use-case': 'usecase', use_case: 'usecase', ellipse: 'usecase', oval: 'usecase',
  class: 'class', interface: 'interface', abstract: 'class', entity: 'entity', table: 'entity',
  state: 'state', rounded: 'state', roundrect: 'state', note: 'note', comment: 'note',
  component: 'component', module: 'component', boundary: 'boundary', frame: 'boundary', group: 'boundary', 'system-boundary': 'boundary', system: 'boundary', subsystem: 'boundary', package: 'boundary', layer: 'boundary', container: 'boundary', swimlane: 'boundary', lane: 'boundary',
  service: 'service', api: 'service', server: 'server', node: 'process', cloud: 'cloud', internet: 'cloud', browser: 'browser', client: 'browser', web: 'browser', webapp: 'browser', 'web client': 'browser', frontend: 'browser',
  mobile: 'mobile', 'mobile app': 'mobile', phone: 'mobile',
};

const EDGE_KIND_ALIASES = {
  arrow: 'arrow', directed: 'arrow', flow: 'arrow', association: 'arrow', transition: 'arrow', message: 'arrow', solid: 'arrow', default: 'arrow', '->': 'arrow', '-->': 'arrow',
  line: 'line', none: 'line', undirected: 'line', plain: 'line', link: 'line', '--': 'line', '---': 'line',
  dashed: 'dashed', dotted: 'dashed', dependency: 'dashed', depends: 'dashed', uses: 'dashed', dash: 'dashed', '-.->': 'dashed', '..>': 'dashed',
  inherit: 'inherit', inheritance: 'inherit', generalization: 'inherit', generalisation: 'inherit', extends: 'inherit', 'is-a': 'inherit',
  realize: 'realize', realization: 'realize', implements: 'realize', implementation: 'realize',
  compose: 'compose', composition: 'compose', 'part-of': 'compose', aggregate: 'aggregate', aggregation: 'aggregate',
  include: 'include', includes: 'include', '«include»': 'include', extend: 'extend', '«extend»': 'extend',
  'one-to-many': 'one-to-many', '1-n': 'one-to-many', '1:n': 'one-to-many', onetomany: 'one-to-many', 'one to many': 'one-to-many', '1..*': 'one-to-many',
  'many-to-one': 'many-to-one', 'n-1': 'many-to-one', 'n:1': 'many-to-one', manytoone: 'many-to-one', 'many to one': 'many-to-one',
  'many-to-many': 'many-to-many', 'n-n': 'many-to-many', 'm:n': 'many-to-many', 'n:m': 'many-to-many', manytomany: 'many-to-many', 'many to many': 'many-to-many',
  'one-to-one': 'one-to-one', '1-1': 'one-to-one', '1:1': 'one-to-one', onetoone: 'one-to-one', 'one to one': 'one-to-one',
};

/** Thrown for input that cannot be turned into a diagram. `messages` lists every problem found. */
export class SpecError extends Error {
  constructor(messages) {
    const list = [].concat(messages);
    super(list[0]);
    this.name = 'SpecError';
    this.messages = list;
  }
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const keyOf = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/** Pull a JSON object out of text that may include a markdown fence or chatter around it. */
export function parseJsonLoose(text) {
  let src = String(text ?? '').replace(/^﻿/, '').trim();
  if (!src) throw new SpecError([t('Nothing to read — paste the JSON first.')]);
  const fence = src.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) src = fence[1].trim();
  const first = src.indexOf('{');
  const last = src.lastIndexOf('}');
  if (first === -1 || last <= first) throw new SpecError([t('No JSON object found. The text must contain something like {"type": "flowchart", "nodes": […]}.')]);
  src = src.slice(first, last + 1);
  try { return JSON.parse(src); } catch (err) {
    // Common chatbot slips: smart quotes and trailing commas.
    const repaired = src.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(repaired); } catch { /* report the original error */ }
    throw new SpecError([t('Could not read the JSON: {reason}', { reason: err.message })]);
  }
}

function endName(value, warnings, where) {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = String(value).trim();
  const k = raw.toLowerCase();
  if (ARROW_IDS.has(raw)) return raw;
  if (END_ALIASES[k]) return END_ALIASES[k];
  warnings.push(t('{where}: unknown line end “{value}” was ignored.', { where, value: raw }));
  return undefined;
}

function textList(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split('\n');
  return list.map((item) => {
    if (isObject(item)) {
      const name = str(item.name ?? item.label ?? item.text);
      const type = str(item.type);
      const key = str(item.key ?? item.constraint);
      return [key, name && type ? `${name}: ${type}` : name || type].filter(Boolean).join(' ');
    }
    return str(item);
  }).filter(Boolean);
}

/** Guess the diagram type from the content when none is given. */
function inferType(raw) {
  if (Array.isArray(raw.messages) && raw.messages.length) return 'sequence';
  const kinds = new Set((Array.isArray(raw.nodes) ? raw.nodes : []).map((n) => KIND_ALIASES[keyOf(isObject(n) ? n.kind : '')]).filter(Boolean));
  if (kinds.has('class') || kinds.has('interface')) return 'class';
  if (kinds.has('entity')) return 'erd';
  if (kinds.has('usecase') || kinds.has('actor')) return 'usecase';
  if (kinds.has('state')) return 'state';
  if (kinds.has('decision') || kinds.has('start') || kinds.has('end') || kinds.has('process')) return 'flowchart';
  if (kinds.has('service') || kinds.has('browser') || kinds.has('server') || kinds.has('cloud')) return 'architecture';
  return 'generic';
}

/**
 * Validate and normalise a spec (object or JSON text).
 * → { spec, warnings }  (throws SpecError with a list of messages when it cannot be used)
 * options: { type } forces the diagram type.
 */
export function normalizeSpec(input, options = {}) {
  let raw = typeof input === 'string' ? parseJsonLoose(input) : input;
  if (!isObject(raw)) throw new SpecError([t('The diagram spec must be a JSON object.')]);
  if (isObject(raw.spec)) raw = raw.spec;
  else if (isObject(raw.diagram) && (raw.diagram.nodes || raw.diagram.messages)) raw = raw.diagram;
  const errors = [];
  const warnings = [];

  // ---- type & direction
  let type;
  const typeText = options.type && options.type !== 'auto' ? options.type : raw.type;
  if (typeText === undefined || typeText === null || typeText === '') type = inferType(raw);
  else {
    type = TYPE_ALIASES[keyOf(typeText)];
    if (!type) errors.push(t('Unknown diagram type “{type}”. Use one of: {list}.', { type: str(typeText), list: SPEC_TYPES.join(', ') }));
  }
  const dirText = keyOf(raw.direction ?? '');
  const direction = ['lr', 'rl', 'horizontal', 'left-to-right', 'left to right'].includes(dirText) ? 'LR' : ['tb', 'td', 'bt', 'vertical', 'top-to-bottom', 'top to bottom', 'down'].includes(dirText) ? 'TB' : null;
  if (dirText && !direction) warnings.push(t('Unknown direction “{value}” — using the default.', { value: str(raw.direction) }));
  const title = clip(str(raw.title ?? raw.name), 120);

  // ---- sequence participants & messages (may be derived from nodes/edges)
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  if (raw.nodes !== undefined && !Array.isArray(raw.nodes)) errors.push(t('“nodes” must be a list.'));
  if (raw.edges !== undefined && !Array.isArray(raw.edges)) errors.push(t('“edges” must be a list.'));

  if (type === 'sequence') {
    let rawParticipants = Array.isArray(raw.participants) ? raw.participants : [];
    let rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    if (!rawParticipants.length && !rawMessages.length && (rawNodes.length || rawEdges.length)) {
      rawParticipants = rawNodes.map((n) => (isObject(n) ? { id: n.id, label: n.label ?? n.name ?? n.id } : n));
      rawMessages = rawEdges.map((e) => (isObject(e) ? { from: e.from ?? e.source, to: e.to ?? e.target, label: e.label ?? e.text, reply: e.reply ?? /dash|reply|return/.test(str(e.kind)), async: e.async ?? /async/.test(str(e.kind)) } : e));
    }
    const participants = [];
    const byKey = new Map();
    const addParticipant = (idRaw, labelRaw) => {
      const label = clip(str(labelRaw) || str(idRaw), 80);
      if (!label) return null;
      const known = byKey.get(keyOf(idRaw ?? label)) || byKey.get(keyOf(label));
      if (known) return known;
      const p = { id: str(idRaw) || `p${participants.length + 1}`, label };
      participants.push(p);
      byKey.set(keyOf(p.id), p); byKey.set(keyOf(p.label), p);
      return p;
    };
    rawParticipants.forEach((p, i) => {
      if (isObject(p)) addParticipant(p.id, p.label ?? p.name ?? p.id);
      else if (str(p)) addParticipant(str(p), str(p));
      else errors.push(t('Participant {n} is empty.', { n: i + 1 }));
    });
    const messages = [];
    rawMessages.forEach((m, i) => {
      if (!isObject(m)) { errors.push(t('Message {n} must be an object with “from” and “to”.', { n: i + 1 })); return; }
      const from = str(m.from ?? m.source); const to = str(m.to ?? m.target);
      if (!from || !to) { errors.push(t('Message {n} needs both “from” and “to”.', { n: i + 1 })); return; }
      const a = byKey.get(keyOf(from)) || addParticipant(from, from);
      const b = byKey.get(keyOf(to)) || addParticipant(to, to);
      const isAsync = m.async === true || m.async === 'true' || /^async(hronous)?$/i.test(str(m.kind));
      messages.push({ from: a.id, to: b.id, label: clip(str(m.label ?? m.text ?? m.name ?? m.message), 120), reply: m.reply === true || m.reply === 'true' || /^(reply|return|response)$/i.test(str(m.kind)), ...(isAsync ? { async: true } : {}) });
    });
    if (!participants.length) errors.push(t('A sequence diagram needs “participants” or “messages”.'));
    if (messages.length > MAX_MESSAGES) errors.push(t('Too many messages ({n}); the limit is {max}.', { n: messages.length, max: MAX_MESSAGES }));
    if (errors.length) throw new SpecError(errors);
    return { spec: { type, title, direction: direction || 'TB', nodes: [], edges: [], participants, messages }, warnings };
  }

  // ---- nodes
  const nodes = [];
  const idKeys = new Map();
  const labelKeys = new Map();
  rawNodes.forEach((n, i) => {
    const where = t('Node {n}', { n: i + 1 });
    let obj = n;
    if (typeof n === 'string' || typeof n === 'number') obj = { label: String(n) };
    if (!isObject(obj)) { errors.push(t('{where} must be an object with at least a “label”.', { where })); return; }
    let kind;
    if (obj.kind !== undefined && obj.kind !== null && str(obj.kind) !== '') {
      kind = KIND_ALIASES[keyOf(obj.kind)];
      if (!kind) warnings.push(t('{where}: unknown kind “{kind}” — the default symbol is used.', { where, kind: str(obj.kind) }));
    }
    let id = str(obj.id);
    const label = clip(str(obj.label ?? obj.name ?? obj.text ?? obj.title), 200);
    if (!id) id = slug(label) || `n${i + 1}`;
    if (idKeys.has(id)) {
      if (obj.id !== undefined && str(obj.id) !== '') { errors.push(t('Duplicate node id “{id}”.', { id })); return; }
      let k = 2; while (idKeys.has(`${id}_${k}`)) k += 1; id = `${id}_${k}`;
    }
    const emptyOk = ['start', 'end', 'initial', 'final', 'fork', 'join', 'circle', 'note', 'boundary'].includes(kind);
    if (!label && !emptyOk) warnings.push(t('{where} has no label.', { where }));
    const node = { id, label: label || (emptyOk ? '' : id), kind, fields: textList(obj.fields ?? obj.attributes ?? obj.columns), methods: textList(obj.methods ?? obj.operations), parent: str(obj.parent) || undefined };
    nodes.push(node);
    idKeys.set(id, node);
    if (label && !labelKeys.has(keyOf(label))) labelKeys.set(keyOf(label), node);
  });
  if (nodes.length > MAX_NODES) errors.push(t('Too many nodes ({n}); the limit is {max}.', { n: nodes.length, max: MAX_NODES }));

  // parents
  for (const node of nodes) {
    if (!node.parent) continue;
    const target = idKeys.get(node.parent) || labelKeys.get(keyOf(node.parent));
    if (!target || target === node) { warnings.push(t('Node “{id}”: parent “{parent}” does not exist — ignored.', { id: node.id, parent: node.parent })); node.parent = undefined; continue; }
    node.parent = target.id;
  }
  for (const node of nodes) { // break parent cycles
    const seen = new Set([node.id]);
    let cur = node;
    while (cur.parent) {
      if (seen.has(cur.parent)) { warnings.push(t('Node “{id}”: circular parent ignored.', { id: node.id })); node.parent = undefined; break; }
      seen.add(cur.parent); cur = idKeys.get(cur.parent);
    }
  }

  // ---- edges
  const edges = [];
  const resolve = (value) => {
    const v = str(value);
    if (!v) return null;
    return idKeys.get(v) || labelKeys.get(keyOf(v)) || null;
  };
  rawEdges.forEach((e, i) => {
    const where = t('Edge {n}', { n: i + 1 });
    if (!isObject(e)) { errors.push(t('{where} must be an object with “from” and “to”.', { where })); return; }
    const fromRaw = e.from ?? e.source; const toRaw = e.to ?? e.target;
    if (str(fromRaw) === '' || str(toRaw) === '') { errors.push(t('{where} needs both “from” and “to”.', { where })); return; }
    const from = resolve(fromRaw); const to = resolve(toRaw);
    if (!from) { errors.push(t('{where}: there is no node “{ref}”.', { where, ref: str(fromRaw) })); return; }
    if (!to) { errors.push(t('{where}: there is no node “{ref}”.', { where, ref: str(toRaw) })); return; }
    let kind;
    if (e.kind !== undefined && e.kind !== null && str(e.kind) !== '') {
      kind = EDGE_KIND_ALIASES[keyOf(e.kind)];
      if (!kind) warnings.push(t('{where}: unknown kind “{kind}” — a plain arrow is used.', { where, kind: str(e.kind) }));
    }
    edges.push({
      from: from.id, to: to.id, label: clip(str(e.label ?? e.text ?? e.name), 120), kind,
      fromEnd: endName(e.fromEnd ?? e.startArrow, warnings, where), toEnd: endName(e.toEnd ?? e.endArrow, warnings, where),
    });
  });
  if (edges.length > MAX_EDGES) errors.push(t('Too many edges ({n}); the limit is {max}.', { n: edges.length, max: MAX_EDGES }));

  if (!nodes.length && !errors.length) {
    if (Array.isArray(raw.messages) && raw.messages.length) return normalizeSpec({ ...raw, type: 'sequence' }, options);
    errors.push(t('The spec has no nodes.'));
  }

  // hierarchy: "parent" means the tree parent
  if (type === 'hierarchy') {
    const has = new Set(edges.map((e) => `${e.from}>${e.to}`));
    for (const n of nodes) {
      if (!n.parent) continue;
      if (!has.has(`${n.parent}>${n.id}`)) { edges.push({ from: n.parent, to: n.id, label: '', kind: 'line' }); has.add(`${n.parent}>${n.id}`); }
      n.parent = undefined;
    }
  }
  if (errors.length) throw new SpecError(errors);
  return { spec: { type, title, direction: direction || null, nodes, edges, participants: [], messages: [] }, warnings };
}

/** Figure type id (types.js) for a spec type. */
export const figureTypeOf = (specType) => (SPEC_TYPES.includes(specType) ? specType : 'generic');

// ---------------------------------------------------------------------------------------------
// JSON Schema for structured output (the API then guarantees a parseable spec)

const strArray = { type: 'array', items: { type: 'string' } };
export const SPEC_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: SPEC_TYPES },
    title: { type: 'string' },
    direction: { type: 'string', enum: ['TB', 'LR'] },
    nodes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: NODE_KINDS },
          fields: strArray, methods: strArray, parent: { type: 'string' },
        },
        required: ['id', 'label'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: EDGE_KINDS },
          fromEnd: { type: 'string', enum: EDGE_ENDS }, toEnd: { type: 'string', enum: EDGE_ENDS },
        },
        required: ['from', 'to'],
      },
    },
    participants: strArray,
    messages: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, reply: { type: 'boolean' }, async: { type: 'boolean' } },
        required: ['from', 'to'],
      },
    },
  },
  required: ['type', 'title'],
};

// ---------------------------------------------------------------------------------------------
// Instructions for a language model (used as the API system prompt and in the "copy prompt" text)

export const SPEC_INSTRUCTIONS = `You turn a description of a software-engineering diagram into a JSON "diagram spec" for a graduation-project documentation tool. The tool draws and lays out the diagram itself, so you only describe WHAT is in it, never coordinates or sizes.

OUTPUT: exactly one JSON object and nothing else (no markdown fence, no explanation).

SPEC FORMAT
{
  "type": "flowchart | activity | hierarchy | usecase | context | sequence | class | erd | state | architecture | component | generic",
  "title": "short figure title",
  "direction": "TB | LR",
  "nodes": [ { "id": "n1", "label": "Start", "kind": "start", "fields": [], "methods": [], "parent": "<id of a boundary/layer/group>" } ],
  "edges": [ { "from": "n1", "to": "n2", "label": "Yes", "kind": "arrow" } ],
  "participants": ["User", "Web App"],
  "messages": [ { "from": "User", "to": "Web App", "label": "login()", "reply": false, "async": false } ]
}
- node kinds: start, end, initial, final, process, decision, io, database, document, subprocess, fork, join, circle, actor, usecase, class, interface, entity, state, note, component, boundary, service, browser, mobile, cloud, server. Leave "kind" out for the usual symbol of the diagram type (process in a flowchart, usecase in a use-case diagram, class in a class diagram...).
- edge kinds: arrow (default), line, dashed, inherit, realize, compose, aggregate, include, extend, one-to-many, many-to-one, many-to-many, one-to-one.
- "fromEnd"/"toEnd" are optional line ends: none, arrow, triangle, hollow-triangle, diamond, filled-diamond, circle, one, one-only, many, one-many, zero-one, zero-many (use them only to override the kind).
- "participants" and "messages" are used only by sequence diagrams (nodes and edges stay empty there). Messages are listed in time order; set "reply": true for return messages (dashed line) and "async": true for asynchronous messages (open arrowhead: the sender does not wait for an answer, e.g. sending an email or writing a log). Normal calls are synchronous (filled arrowhead). Participants may be written as plain strings.

RULES BY TYPE
- flowchart / activity: one "start" (flowchart) or "initial" (activity) node, one "end" (flowchart) or "final" (activity) node. A decision is kind "decision" with a question label and one outgoing edge per answer, labelled (Yes / No ...). Use "io" for input/output, "database" for stored data. Activity diagrams may use "fork" and "join" for parallel work.
- hierarchy (org chart, WBS, module tree): one root; give every other node a "parent" (the id of its parent node). Edges can be left out.
- usecase: kind "actor" for people/external systems, "usecase" for functions. Put every use case in ONE "boundary" node (the system) using "parent". Connect actors to use cases with kind "line". Use "include"/"extend" edges between use cases (from the including/extending one to the other).
- context (context diagram, DFD level 0): ONE node of kind "boundary" for the whole system (label like "Library System") and one node per external entity (kind "actor" or no kind). Every edge connects an entity with the system and is labelled with the data that flows (e.g. "Book request", "Receipt"); use two edges when data flows both ways. No other nodes.
- sequence: type "sequence" with participants and messages only.
- class: kind "class" (or "interface"); put attributes in "fields" and operations in "methods" with UML visibility (+ - #). Relations: inherit (from the subclass to the superclass), realize, compose / aggregate (from the whole to the part), arrow or line for associations (put multiplicities such as "1..*" in the label).
- erd: kind "entity" with "fields" as column names; mark keys by starting the field with "PK " or "FK ". Relations use one-to-many, many-to-one, many-to-many or one-to-one, label = verb ("places", "contains").
- state: kind "state" nodes, "initial" and "final" for the start and end, edges are transitions labelled "event [guard] / action".
- architecture / component: kinds service, component, browser, mobile, database, cloud, server; group them in "boundary" nodes (layers such as Presentation / Application / Data) with "parent".
- generic: anything else; use process nodes and arrows.

STYLE
- Keep all labels in the language of the description (Arabic stays Arabic, English stays English) unless the user asks otherwise. Do not translate.
- Labels are short: 1-5 words for nodes, 1-3 words for edges. Put the nodes in logical reading order.
- ids are short ASCII strings (n1, n2, b1...). Every edge "from"/"to" must be the id of a node that exists.
- Choose "type" from the description. Typical size: 5-25 nodes. Do not invent features the user did not mention, but do complete obvious steps (start, end, error paths) when the user asks for a complete flow.`;

/** Text a student can paste into any chatbot (ChatGPT, Claude…) together with their description. */
/** What to do with an attached picture of a diagram (API request and the copy-paste prompt). */
export const IMAGE_TASK = `The attached image shows an existing diagram: a screenshot, a scan, a photo or a hand drawing. Recreate it as the JSON diagram spec.
- Keep the same diagram type and every element in it: each shape with its exact text (same language, spelling and line breaks), each connector with its direction, arrowhead style and label, and every grouping box, boundary, swimlane or package as a boundary node.
- Use the node and edge kinds that match what is drawn (decision diamonds, actors, use-case ovals, classes with their fields and methods, entities, lifelines and messages, inheritance or crow's-foot ends …).
- Do not add anything that is not in the picture and do not "improve" it. If some text cannot be read, write your best reading followed by " (?)".
- Ignore the picture's colours, fonts, exact positions and any page decoration around the diagram.`;

/** The prompt for a chatbot when the student has no API key: the student attaches the image next to it. */
export function buildImageChatPrompt(type = 'auto', note = '') {
  const hint = type && type !== 'auto' ? `Diagram type: ${type}.\n` : '';
  const extra = String(note || '').trim() ? `\nNOTE FROM THE STUDENT:\n${String(note).trim()}\n` : '';
  return `${SPEC_INSTRUCTIONS}\n\n${hint}${IMAGE_TASK}\n(The image is attached to this message.)\n${extra}\nReply with the JSON object only.`;
}

export function buildChatPrompt(description, type = 'auto') {
  const hint = type && type !== 'auto' ? `Diagram type: ${type}.\n` : '';
  return `${SPEC_INSTRUCTIONS}\n\n${hint}DESCRIPTION:\n${String(description || '').trim() || '(write what the diagram should show here)'}\n\nReply with the JSON object only.`;
}

/** Suggested figure title for a spec (falls back to a trimmed line of the description). */
export function suggestTitle(spec, fallbackText = '') {
  const cleaned = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (cleaned(spec?.title)) return clip(cleaned(spec.title), 80);
  const line = cleaned(String(fallbackText).split(/[\n.!?؟]/)[0]);
  return line ? clip(line, 60) : '';
}

/** A normalised spec without empty fields — the form shown to people who want to edit it as JSON. */
export function compactSpec(spec) {
  const out = {};
  for (const [key, value] of Object.entries(spec || {})) {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) continue;
    out[key] = Array.isArray(value) ? value.map((item) => (isObject(item) ? compactSpec(item) : item)) : value;
  }
  if (out.nodes) out.nodes = out.nodes.map((n) => ({ ...n }));
  return out;
}
