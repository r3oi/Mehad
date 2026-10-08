// Pure-logic tests (no browser) for auto layout and diagram generation:
// diagram spec validation, text / Mermaid parsers, specToDiagram, autoLayout and the AI request/response handling.
// Run: node tests/generate.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// prefs.js reads localStorage lazily; give Node a tiny in-memory one.
const memory = new Map();
globalThis.localStorage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)), removeItem: (k) => memory.delete(k) };

// Text is measured with a canvas in the browser; a stand-in with fixed-width glyphs keeps the tests deterministic.
globalThis.document = { createElement: () => ({ getContext: () => ({ set font(v) { this._font = v; }, measureText(text) { return { width: String(text).length * (Number((/(\d+(?:\.\d+)?)px/.exec(this._font || '') || [])[1]) || 14) * 0.5 }; } }) }) };

const { autoLayout, layoutUnsuitedReason, LAYOUT_UNSUITED_TYPES } = await import('../src/figures/layout.js');
const { builder } = await import('../src/figures/templates/builder.js');
const { flowchartTemplate, hierarchyTemplate, architectureTemplate, useCaseTemplate, erdTemplate, classTemplate, fishboneTemplate, sequenceTemplate } = await import('../src/figures/templates/index.js');
const { normalizeSpec, parseJsonLoose, SpecError, SPEC_JSON_SCHEMA, buildChatPrompt, buildImageChatPrompt, suggestTitle, compactSpec, SPEC_TYPES, NODE_KINDS, EDGE_KINDS } = await import('../src/figures/generate/spec.js');
const { specToDiagram, buildDiagramFromSpec } = await import('../src/figures/generate/to-diagram.js');
const { parseText, parseArrowList, parseOutline, parseMermaid, detectFormat } = await import('../src/figures/generate/text-parse.js');
const ai = await import('../src/figures/generate/ai.js');
const { AR } = await import('../src/i18n/ar/index.js');
const { PORTS } = await import('../src/figures/geometry.js');
const { renderFigureSVG } = await import('../src/figures/render.js');

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const section = (name) => tests.push([`§${name}`, null]);

// ---------------------------------------------------------------------------- helpers
const FONT = { fontFamily: 'Times New Roman', fontSize: 14 };
const nodesOf = (d) => d.elements.filter((e) => e.type === 'node');
const edgesOf = (d) => d.elements.filter((e) => e.type === 'edge');
const byText = (d, text) => nodesOf(d).find((n) => n.text.split('\n')[0] === text);
const cx = (n) => n.x + n.w / 2;
const cy = (n) => n.y + n.h / 2;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isFrame = (n) => n.shape === 'frame';
const inside = (n, f) => n.x >= f.x - 1 && n.y >= f.y - 1 && n.x + n.w <= f.x + f.w + 1 && n.y + n.h <= f.y + f.h + 1;

/** No two nodes overlap, except a frame and the nodes it holds. Actor captions are ignored. */
function assertNoOverlap(d, label = '') {
  const ns = nodesOf(d).filter((n) => n.shape !== 'point');
  for (let i = 0; i < ns.length; i += 1) {
    for (let j = i + 1; j < ns.length; j += 1) {
      const a = ns[i]; const b = ns[j];
      if ((a.shape === 'lifeline' && (b.shape === 'text' || b.shape === 'lifeline')) || (b.shape === 'lifeline' && a.shape === 'text')) { if (a.shape === 'lifeline' && b.shape === 'lifeline') assert.ok(!overlaps(a, b)); continue; }
      if ((isFrame(a) && inside(b, a)) || (isFrame(b) && inside(a, b))) continue;
      if (isFrame(a) && isFrame(b)) { if (!overlaps(a, b)) continue; if (inside(a, b) || inside(b, a)) continue; }
      assert.ok(!overlaps(a, b), `${label} nodes overlap: "${a.text}" (${a.x},${a.y},${a.w}x${a.h}) and "${b.text}" (${b.x},${b.y},${b.w}x${b.h})`);
    }
  }
}
function assertFinite(d) {
  for (const n of nodesOf(d)) for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(n[k]), `bad ${k} on ${n.text}`);
}
function assertEdgesValid(d) {
  const ids = new Set(nodesOf(d).map((n) => n.id));
  for (const e of edgesOf(d)) {
    for (const end of [e.source, e.target]) if (end.id) assert.ok(ids.has(end.id), 'edge refers to a missing node');
  }
}

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

/** A random diagram: n nodes of mixed sizes, ~1.4n edges (cycles allowed). */
function randomDiagram(seed, n, { dag = false, extra = 1.4 } = {}) {
  const rnd = lcg(seed);
  const b = builder(FONT);
  const shapes = [['rect', 160, 64], ['diamond', 150, 90], ['roundRect', 120, 50], ['ellipse', 190, 70], ['terminator', 140, 52], ['cylinder', 110, 90], ['class', 200, 130]];
  const nodes = [];
  for (let i = 0; i < n; i += 1) {
    const [shape, w, h] = shapes[Math.floor(rnd() * shapes.length)];
    nodes.push(b.node(shape, Math.round(rnd() * 900), Math.round(rnd() * 700), w, h, `N${i}`));
  }
  const count = Math.round(n * extra);
  for (let k = 0; k < count; k += 1) {
    let a = Math.floor(rnd() * n); let c = Math.floor(rnd() * n);
    if (a === c) continue;
    if (dag && a > c) [a, c] = [c, a];
    b.edge(nodes[a], nodes[c], { text: rnd() < 0.2 ? 'lbl' : '' });
  }
  return b.diagram();
}

// ============================================================================
section('spec validation');

test('a minimal spec is accepted and normalised', () => {
  const { spec, warnings } = normalizeSpec({ type: 'flowchart', nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Work' }], edges: [{ from: 'a', to: 'b', label: 'go' }] });
  assert.equal(spec.type, 'flowchart');
  assert.equal(spec.nodes.length, 2);
  assert.deepEqual(spec.edges[0], { from: 'a', to: 'b', label: 'go', kind: undefined, fromEnd: undefined, toEnd: undefined });
  assert.deepEqual(warnings, []);
});
test('type is inferred from the content when missing', () => {
  assert.equal(normalizeSpec({ nodes: [{ id: 'c', label: 'A', kind: 'class' }] }).spec.type, 'class');
  assert.equal(normalizeSpec({ nodes: [{ id: 'e', label: 'A', kind: 'entity' }] }).spec.type, 'erd');
  assert.equal(normalizeSpec({ nodes: [{ id: 'u', label: 'A', kind: 'actor' }] }).spec.type, 'usecase');
  assert.equal(normalizeSpec({ participants: ['a', 'b'], messages: [{ from: 'a', to: 'b' }] }).spec.type, 'sequence');
});
test('type, kind and direction synonyms are understood', () => {
  const { spec } = normalizeSpec({ type: 'ER Diagram', direction: 'left-to-right', nodes: [{ label: 'X', kind: 'table' }, { label: 'Y', kind: 'db' }], edges: [{ from: 'X', to: 'Y', kind: '1:N' }] });
  assert.equal(spec.type, 'erd');
  assert.equal(spec.direction, 'LR');
  assert.deepEqual(spec.nodes.map((n) => n.kind), ['entity', 'database']);
  assert.equal(spec.edges[0].kind, 'one-to-many');
  assert.equal(spec.edges[0].from, 'x', 'edges may refer to nodes by label');
});
test('missing ids are generated and duplicates are rejected', () => {
  const { spec } = normalizeSpec({ type: 'generic', nodes: [{ label: 'Login page' }, { label: 'Login page' }] });
  assert.deepEqual(spec.nodes.map((n) => n.id), ['login_page', 'login_page_2']);
  assert.throws(() => normalizeSpec({ nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }), (e) => e instanceof SpecError && /Duplicate node id/.test(e.message));
});
test('clear errors for unknown nodes, bad types and broken structure', () => {
  assert.throws(() => normalizeSpec({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'zzz' }] }), (e) => e.messages.some((m) => /Edge 1/.test(m) && /zzz/.test(m)));
  assert.throws(() => normalizeSpec({ type: 'banana', nodes: [{ id: 'a', label: 'A' }] }), (e) => /Unknown diagram type/.test(e.message));
  assert.throws(() => normalizeSpec({ type: 'flowchart' }), (e) => /no nodes/.test(e.message));
  assert.throws(() => normalizeSpec([1, 2]), (e) => /JSON object/.test(e.message));
  assert.throws(() => normalizeSpec({ nodes: 'x' }), (e) => e.messages.some((m) => /list/.test(m)));
  assert.throws(() => normalizeSpec({ type: 'sequence' }), (e) => /participants/.test(e.message));
  const many = { nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, label: 'x' })) };
  assert.throws(() => normalizeSpec(many), (e) => /Too many nodes/.test(e.message));
});
test('all problems are reported together', () => {
  try { normalizeSpec({ nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'q' }, { from: 'r', to: 'a' }, { to: 'a' }] }); assert.fail('should throw'); } catch (e) {
    assert.ok(e instanceof SpecError); assert.equal(e.messages.length, 3);
  }
});
test('unknown kinds and parents only produce warnings', () => {
  const { spec, warnings } = normalizeSpec({ type: 'flowchart', nodes: [{ id: 'a', label: 'A', kind: 'hexagonal-thing', parent: 'nope' }], edges: [] });
  assert.equal(spec.nodes[0].kind, undefined);
  assert.equal(spec.nodes[0].parent, undefined);
  assert.equal(warnings.length, 2);
});
test('parent cycles are broken', () => {
  const { spec, warnings } = normalizeSpec({ type: 'architecture', nodes: [{ id: 'a', label: 'A', parent: 'b' }, { id: 'b', label: 'B', parent: 'a' }] });
  assert.ok(warnings.some((w) => /circular/.test(w)));
  assert.ok(spec.nodes.some((n) => !n.parent));
});
test('JSON text: code fences, chatter and trailing commas are tolerated', () => {
  const obj = parseJsonLoose('Sure! Here you go:\n```json\n{ "type": "flowchart", "nodes": [ {"id":"a","label":"A"}, ], }\n```\nHope it helps');
  assert.equal(obj.nodes[0].id, 'a');
  assert.throws(() => parseJsonLoose('   '), SpecError);
  assert.throws(() => parseJsonLoose('no json here'), (e) => /No JSON object/.test(e.message));
  assert.throws(() => parseJsonLoose('{ "a": }'), (e) => /Could not read the JSON/.test(e.message));
  assert.equal(normalizeSpec('{"nodes":[{"id":"a","label":"A"}]}').spec.nodes.length, 1);
  assert.equal(normalizeSpec({ diagram: { nodes: [{ id: 'a', label: 'A' }] } }).spec.nodes.length, 1, 'a { diagram } wrapper is unwrapped');
});
test('hierarchy: parent links become edges', () => {
  const { spec } = normalizeSpec({ type: 'hierarchy', nodes: [{ id: 'r', label: 'Root' }, { id: 'a', label: 'A', parent: 'r' }, { id: 'b', label: 'B', parent: 'a' }] });
  assert.deepEqual(spec.edges.map((e) => `${e.from}>${e.to}`), ['r>a', 'a>b']);
  assert.ok(spec.nodes.every((n) => !n.parent));
});
test('sequence: participants may be implicit; nodes/edges are accepted too', () => {
  const a = normalizeSpec({ type: 'sequence', messages: [{ from: 'User', to: 'App', label: 'hi' }, { from: 'App', to: 'DB' }] }).spec;
  assert.deepEqual(a.participants.map((p) => p.label), ['User', 'App', 'DB']);
  const b = normalizeSpec({ type: 'sequence', nodes: [{ id: 'u', label: 'User' }, { id: 'a', label: 'App' }], edges: [{ from: 'u', to: 'a', label: 'x' }] }).spec;
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].from, 'u');
});
test('end names and ER cardinalities map onto the connector arrow ids', async () => {
  const { spec, warnings } = normalizeSpec({ type: 'erd', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b', fromEnd: 'one-only', toEnd: 'zero-many' }, { from: 'b', to: 'a', toEnd: 'weird' }] });
  assert.equal(spec.edges[0].fromEnd, 'oneOne');
  assert.equal(spec.edges[0].toEnd, 'zeroMany');
  assert.equal(warnings.length, 1);
});
test('JSON schema for structured output is closed (additionalProperties:false) and lists every enum', () => {
  const walk = (s) => { if (s && typeof s === 'object') { if (s.type === 'object') assert.equal(s.additionalProperties, false); Object.values(s).forEach(walk); } };
  walk(SPEC_JSON_SCHEMA);
  assert.deepEqual(SPEC_JSON_SCHEMA.properties.type.enum, SPEC_TYPES);
  assert.deepEqual(SPEC_JSON_SCHEMA.properties.nodes.items.properties.kind.enum, NODE_KINDS);
  assert.deepEqual(SPEC_JSON_SCHEMA.properties.edges.items.properties.kind.enum, EDGE_KINDS);
  assert.ok(!JSON.stringify(SPEC_JSON_SCHEMA).match(/"(minimum|maximum|minLength|maxLength|\$ref)"/), 'no unsupported keywords');
});
test('prompt text contains the format, the rules and the user description', () => {
  const p = buildChatPrompt('A login flow', 'flowchart');
  assert.match(p, /SPEC FORMAT/); assert.match(p, /"participants"/); assert.match(p, /DESCRIPTION:\nA login flow/); assert.match(p, /Diagram type: flowchart/);
  assert.match(buildChatPrompt('', 'auto'), /write what the diagram should show/);
  assert.equal(suggestTitle({ title: '  Login   flow ' }), 'Login flow');
  assert.equal(suggestTitle({}, 'Login flowchart with retry. More text'), 'Login flowchart with retry');
  assert.deepEqual(compactSpec({ type: 'x', nodes: [{ id: 'a', fields: [], parent: undefined }], edges: [] }), { type: 'x', nodes: [{ id: 'a' }] });
});

// ============================================================================
section('text parsers');

test('arrow list: nodes are shared by name, labels follow " : "', () => {
  const { spec } = parseArrowList('Start -> User Login\nUser Login -> Valid?\nValid? -> Dashboard : Yes\nValid? -> Error : No\nError -> User Login\nDashboard -> End');
  assert.equal(spec.type, 'flowchart');
  assert.deepEqual(spec.nodes.map((n) => n.label), ['Start', 'User Login', 'Valid?', 'Dashboard', 'Error', 'End']);
  assert.equal(spec.edges.length, 6);
  assert.deepEqual(spec.edges.filter((e) => e.label).map((e) => e.label), ['Yes', 'No']);
  const d = specToDiagram(spec);
  assert.equal(byText(d, 'Valid?').shape, 'diamond', 'a trailing ? makes a decision');
  assert.equal(byText(d, 'Start').shape, 'terminator');
  assert.equal(byText(d, 'End').shape, 'terminator');
  assert.equal(byText(d, 'User Login').shape, 'rect');
});
test('arrow list: Arabic terminators and decisions, chains, other arrow styles', () => {
  const { spec } = parseArrowList('بداية → إدخال البيانات → هل صحيحة؟\nهل صحيحة؟ => نهاية : نعم\nA ..> B\nA ---> C');
  const d = specToDiagram(spec);
  assert.equal(byText(d, 'بداية').shape, 'terminator');
  assert.equal(byText(d, 'نهاية').shape, 'terminator');
  assert.equal(byText(d, 'هل صحيحة؟').shape, 'diamond');
  assert.equal(spec.edges.length, 5);
  assert.equal(spec.edges[2].label, 'نعم', 'label sits on the last hop');
  assert.equal(spec.edges[3].kind, 'dashed');
});
test('arrow list: invisible direction marks from copied Arabic text do not split names', () => {
  const { spec } = parseArrowList('\u200Fبداية\u200F -> هل صحيحة؟\n\u200Fبداية -> نهاية');
  assert.deepEqual(spec.nodes.map((n) => n.label), ['بداية', 'هل صحيحة؟', 'نهاية']);
});
test('arrow list: names with a colon but no space before it stay whole; comments are skipped', () => {
  const { spec } = parseArrowList('# a comment\nStep 1: Login -> Step 2: Pay\n// another');
  assert.deepEqual(spec.nodes.map((n) => n.label), ['Step 1: Login', 'Step 2: Pay']);
});
test('arrow list as sequence, usecase and state', () => {
  const seq = parseArrowList('User -> Web App : login()\nWeb App --> User : token', { type: 'sequence' }).spec;
  assert.deepEqual(seq.participants, ['User', 'Web App']);
  assert.deepEqual(seq.messages.map((m) => m.reply), [false, true]);
  const uc = parseArrowList('Student -> Register\nStudent -> Login\nAdmin -> Manage users', { type: 'usecase' }).spec;
  assert.deepEqual(uc.nodes.filter((n) => n.kind === 'actor').map((n) => n.label), ['Student', 'Admin']);
  const st = specToDiagram(parseArrowList('[*] -> Idle\nIdle -> Busy : start\nBusy -> [*]', { type: 'state' }).spec);
  assert.equal(nodesOf(st).filter((n) => n.shape === 'final').length, 1);
});
test('arrow list errors are specific', () => {
  assert.throws(() => parseArrowList('A ->'), (e) => /Line 1/.test(e.message));
});
test('outline: indentation (spaces, tabs, bullets, numbers) builds a tree', () => {
  const { spec, warnings } = parseOutline('System\n  Users\n    Students\n\tStaff\n  - Books\n  1. Loans\n');
  assert.deepEqual(warnings, []);
  assert.equal(spec.type, 'hierarchy');
  const label = (id) => spec.nodes.find((n) => n.id === id).label;
  const kids = (name) => spec.edges.filter((e) => label(e.from) === name).map((e) => label(e.to));
  assert.deepEqual(kids('System'), ['Users', 'Books', 'Loans']);
  assert.deepEqual(kids('Users'), ['Students', 'Staff']);
});
test('outline: several top-level items give a warning but still work', () => {
  const { spec, warnings } = parseOutline('A\n  a1\nB\n  b1');
  assert.equal(warnings.length, 1);
  assert.equal(spec.edges.length, 2);
});
test('format detection', () => {
  assert.equal(detectFormat('flowchart TD\n A-->B'), 'mermaid');
  assert.equal(detectFormat('```mermaid\nsequenceDiagram\n A->>B: hi\n```'), 'mermaid');
  assert.equal(detectFormat('A -> B'), 'arrows');
  assert.equal(detectFormat('Root\n  Child'), 'outline');
  assert.equal(detectFormat('{"a":1}'), 'json');
  assert.equal(detectFormat('Just\nwords'), 'list');
  assert.equal(detectFormat('   \n'), 'empty');
  assert.throws(() => parseText('Just\nwords', { type: 'auto' }), (e) => /No arrows or indentation/.test(e.message));
  assert.equal(parseText('Open app\nLogin\nDone', { type: 'flowchart' }).spec.edges.length, 2, 'plain list = steps for a process diagram');
  assert.throws(() => parseText('', {}), SpecError);
  assert.throws(() => parseText('{"a":1}', {}), (e) => /Paste JSON/.test(e.message));
});

section('Mermaid');
test('flowchart: node shapes', () => {
  const { spec } = parseMermaid('flowchart LR\n  A[Start] --> B{Is it?}\n  B --> C((Round))\n  C --> D[(Store)]\n  D --> E([Stadium])\n  E --> F[[Sub]]\n  F --> G[/Data/]\n  G --> H(Soft)');
  assert.equal(spec.direction, 'LR');
  const kind = (id) => spec.nodes.find((n) => n.id === id).kind;
  assert.deepEqual(['B', 'C', 'D', 'E', 'F', 'G', 'H'].map(kind), ['decision', 'circle', 'database', 'start', 'subprocess', 'io', 'state']);
  assert.equal(spec.nodes.find((n) => n.id === 'A').label, 'Start');
  const d = specToDiagram(spec);
  assert.deepEqual(['Is it?', 'Round', 'Store'].map((t) => byText(d, t).shape), ['diamond', 'circle', 'cylinder']);
});
test('flowchart: link styles and labels', () => {
  const { spec } = parseMermaid('graph TD\n A --> B\n B --- C\n C -.-> D\n D ==> E\n E -->|yes| F\n F -- no --> G\n G -. maybe .-> H\n H <--> A\n A --o I\n A --x J');
  const e = (from, to) => spec.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e('A', 'B').kind, undefined);
  assert.equal(e('B', 'C').kind, 'line');
  assert.equal(e('C', 'D').kind, 'dashed');
  assert.equal(e('D', 'E').kind, undefined);
  assert.equal(e('E', 'F').label, 'yes');
  assert.equal(e('F', 'G').label, 'no');
  assert.equal(e('G', 'H').label, 'maybe');
  assert.equal(e('G', 'H').kind, 'dashed');
  assert.equal(e('H', 'A').fromEnd, 'arrow');
  assert.equal(e('A', 'I').toEnd, 'circle');
  assert.equal(spec.edges.length, 10);
});
test('flowchart: chains, & groups, quotes, <br/>, subgraphs, ignored styling', () => {
  const { spec } = parseMermaid('flowchart TB\n  A["Say #quot;hi#quot; (x)"] --> B & C --> D\n  X[line1<br/>line2]\n  classDef big fill:#f9f\n  class A big\n  style B fill:#fff\n  subgraph sg1 [Backend]\n    D --> E\n    subgraph inner\n      F\n    end\n  end\n  %% comment\n  E --> F');
  assert.equal(spec.nodes.find((n) => n.id === 'X').label, 'line1\nline2');
  assert.equal(spec.nodes.find((n) => n.id === 'A').label, 'Say "hi" (x)');
  assert.equal(spec.edges.filter((e) => e.from === 'A').length, 2);
  assert.equal(spec.edges.filter((e) => e.to === 'D').length, 2);
  const sg = spec.nodes.find((n) => n.id === 'sg1');
  assert.equal(sg.kind, 'boundary'); assert.equal(sg.label, 'Backend');
  assert.equal(spec.nodes.find((n) => n.id === 'E').parent, 'sg1');
  assert.ok(spec.nodes.find((n) => n.parent === 'sg1' && n.kind === 'boundary'), 'nested subgraph');
  const d = buildDiagramFromSpec(spec).diagram;
  assertNoOverlap(d); assertEdgesValid(d);
  assert.ok(nodesOf(d).some((n) => n.shape === 'frame'));
});
test('flowchart: "subgraph name" gives the subgraph that id, so edges can end on it', () => {
  const { spec } = parseMermaid('flowchart TD\n  subgraph Backend\n    A --> B\n  end\n  C --> Backend\n  subgraph Two words\n    D\n  end');
  assert.equal(spec.nodes.filter((n) => n.label === 'Backend').length, 1);
  assert.equal(spec.nodes.find((n) => n.id === 'Backend').kind, 'boundary');
  assert.ok(spec.edges.some((e) => e.from === 'C' && e.to === 'Backend'));
  assert.equal(spec.nodes.find((n) => n.label === 'Two words').kind, 'boundary');
});
test('sequenceDiagram', () => {
  const { spec, warnings } = parseMermaid('sequenceDiagram\n  autonumber\n  participant U as User\n  actor A as Admin\n  U->>W: login\n  W-->>U: token\n  alt ok\n    W->>W: ping\n  end\n  Note over U,W: hi');
  assert.deepEqual(spec.participants.map((p) => p.label), ['User', 'Admin', 'W']);
  assert.deepEqual(spec.messages.map((m) => [m.from, m.to, m.reply, m.label]), [['U', 'W', false, '1: login'], ['W', 'U', true, '2: token'], ['W', 'W', false, '3: ping']]);
  assert.ok(warnings.length >= 1);
  const d = specToDiagram(spec);
  assert.equal(nodesOf(d).filter((n) => n.shape === 'lifeline').length, 3);
});
test('sequenceDiagram: -) and --) are asynchronous (open arrowhead), ->> synchronous (filled)', () => {
  const { spec } = parseMermaid('sequenceDiagram\n  A->>B: sync\n  A-)B: async\n  B-->>A: back');
  assert.deepEqual(spec.messages.map((m) => [!!m.async, !!m.reply]), [[false, false], [true, false], [false, true]]);
  const edges = specToDiagram(spec).elements.filter((el) => el.type === 'edge' && el.text);
  const byText = (t) => edges.find((e) => e.text.includes(t));
  assert.equal(byText('sync').style.endArrow, 'triangle');
  assert.equal(byText('async').style.endArrow, 'arrow');
  assert.equal(byText('back').style.dash, 'dashed');
});
test('context diagram: the system sits in the middle, every flow is attached', () => {
  const { diagram } = buildDiagramFromSpec({ type: 'context', nodes: [{ id: 's', label: 'Meyar System', kind: 'boundary' }, { id: 'a', label: 'Student' }, { id: 'b', label: 'Supervisor' }],
    edges: [{ from: 'a', to: 's', label: 'Project data' }, { from: 's', to: 'b', label: 'Reports' }] });
  const nodes = nodesOf(diagram); const edges = diagram.elements.filter((el) => el.type === 'edge');
  assert.equal(edges.length, 2);
  for (const e of edges) assert.ok(nodes.some((n) => n.id === e.source?.id) && nodes.some((n) => n.id === e.target?.id), 'attached');
  const sys = nodes.find((n) => n.text === 'Meyar System');
  const others = nodes.filter((n) => n !== sys && (n.text === 'Student' || n.text === 'Supervisor'));
  const cx = (n) => n.x + n.w / 2;
  assert.ok(others.some((n) => cx(n) < cx(sys)) && others.some((n) => cx(n) > cx(sys)) || others.every((n) => Math.abs(cx(n) - cx(sys)) > 1), 'entities around the system');
  assert.equal(layoutUnsuitedReason(diagram, 'context'), 'context');
});
test('classDiagram: members, stereotypes, relations and multiplicities', () => {
  const { spec } = parseMermaid('classDiagram\n  class Animal {\n    +String name\n    +eat() void\n  }\n  class Dog\n  Animal <|-- Dog\n  Animal "1" --> "*" Food : eats\n  Dog *-- Tail\n  Dog o-- Toy\n  Dog ..> Bone\n  Cat ..|> Pet\n  Dog : +bark()\n  <<interface>> Pet');
  const cls = (id) => spec.nodes.find((n) => n.id === id);
  assert.deepEqual(cls('Animal').fields, ['+String name']);
  assert.deepEqual(cls('Animal').methods, ['+eat() void']);
  assert.deepEqual(cls('Dog').methods, ['+bark()']);
  assert.equal(cls('Pet').kind, 'interface');
  const e = (from, to) => spec.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e('Dog', 'Animal').kind, 'inherit', 'child → parent');
  assert.equal(e('Animal', 'Food').label, '1 eats *');
  assert.equal(e('Dog', 'Tail').kind, 'compose');
  assert.equal(e('Dog', 'Toy').kind, 'aggregate');
  assert.equal(e('Dog', 'Bone').kind, 'dashed');
  assert.equal(e('Cat', 'Pet').kind, 'realize');
});
test('erDiagram: cardinalities become crow\'s-foot ends', () => {
  const { spec } = parseMermaid('erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER }|..|{ LINE : contains\n  CUSTOMER {\n    string name PK\n    int age\n  }');
  assert.equal(spec.type, 'erd');
  const e = spec.edges[0];
  assert.deepEqual([e.from, e.to, e.label, e.fromEnd, e.toEnd], ['CUSTOMER', 'ORDER', 'places', 'one-only', 'zero-many']);
  assert.equal(spec.edges[1].fromEnd, 'one-many'); assert.equal(spec.edges[1].kind, 'dashed');
  assert.deepEqual(spec.nodes.find((n) => n.id === 'CUSTOMER').fields, ['PK name: string', 'age: int']);
  const d = specToDiagram(spec);
  assert.equal(edgesOf(d)[0].style.startArrow, 'oneOne');
  assert.equal(edgesOf(d)[0].style.endArrow, 'zeroMany');
});
test('stateDiagram: [*] markers and composite states', () => {
  const { spec } = parseMermaid('stateDiagram-v2\n  [*] --> Still\n  Still --> Moving : motion\n  Moving --> [*]\n  state Moving {\n    [*] --> Fast\n  }\n  state "Long name" as L\n  direction TB');
  assert.equal(spec.direction, 'TB');
  assert.equal(spec.nodes.filter((n) => n.kind === 'initial').length, 2);
  assert.equal(spec.nodes.find((n) => n.id === 'Fast').parent, 'Moving');
  assert.equal(spec.nodes.find((n) => n.id === 'L').label, 'Long name');
  const d = buildDiagramFromSpec(spec).diagram;
  assertNoOverlap(d);
});
test('unsupported Mermaid gives a clear message', () => {
  assert.throws(() => parseMermaid('pie title Pets\n "Dogs": 5'), (e) => /Unsupported Mermaid/.test(e.message));
});

// ============================================================================
section('specToDiagram');

const SPECS = {
  flowchart: { type: 'flowchart', nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Enter credentials', kind: 'io' }, { id: 'c', label: 'Valid?' }, { id: 'd', label: 'Dashboard' }, { id: 'e', label: 'Show error' }, { id: 'f', label: 'End' }, { id: 'g', label: 'Customer database', kind: 'database' }, { id: 'h', label: 'Receipt', kind: 'document' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: 'Yes' }, { from: 'c', to: 'e', label: 'No' }, { from: 'e', to: 'b' }, { from: 'd', to: 'g' }, { from: 'd', to: 'h' }, { from: 'h', to: 'f' }] },
  activity: { type: 'activity', nodes: [{ id: 'i', label: '', kind: 'initial' }, { id: 'a', label: 'Receive order' }, { id: 'f', label: '', kind: 'fork' }, { id: 'b', label: 'Pack' }, { id: 'c', label: 'Charge' }, { id: 'j', label: '', kind: 'join' }, { id: 'e', label: '', kind: 'final' }],
    edges: [{ from: 'i', to: 'a' }, { from: 'a', to: 'f' }, { from: 'f', to: 'b' }, { from: 'f', to: 'c' }, { from: 'b', to: 'j' }, { from: 'c', to: 'j' }, { from: 'j', to: 'e' }] },
  hierarchy: { type: 'hierarchy', nodes: [{ id: 'r', label: 'Project' }, { id: 'a', label: 'Analysis', parent: 'r' }, { id: 'b', label: 'Design', parent: 'r' }, { id: 'c', label: 'Build', parent: 'r' }, { id: 'a1', label: 'Requirements', parent: 'a' }, { id: 'a2', label: 'Use cases', parent: 'a' }, { id: 'b1', label: 'Database', parent: 'b' }] },
  usecase: { type: 'usecase', title: 'Library', nodes: [{ id: 'u1', label: 'Member', kind: 'actor' }, { id: 'u2', label: 'Librarian', kind: 'actor' }, { id: 'sys', label: 'Library System', kind: 'boundary' },
    ...['Search catalogue', 'Borrow book', 'Return book', 'Check membership', 'Manage books', 'Manage members'].map((l, i) => ({ id: `c${i}`, label: l, parent: 'sys' }))],
    edges: [{ from: 'u1', to: 'c0', kind: 'line' }, { from: 'u1', to: 'c1', kind: 'line' }, { from: 'u1', to: 'c2', kind: 'line' }, { from: 'u2', to: 'c4', kind: 'line' }, { from: 'u2', to: 'c5', kind: 'line' }, { from: 'c1', to: 'c3', kind: 'include' }] },
  usecaseImplicit: { type: 'usecase', title: 'Shop', nodes: [{ id: 'u', label: 'Customer', kind: 'actor' }, { id: 'a', label: 'Browse products' }, { id: 'b', label: 'Pay' }], edges: [{ from: 'u', to: 'a' }, { from: 'u', to: 'b' }] },
  sequence: { type: 'sequence', participants: ['User', 'Web App', 'Database'], messages: [{ from: 'User', to: 'Web App', label: 'login()' }, { from: 'Web App', to: 'Database', label: 'find user' }, { from: 'Database', to: 'Web App', label: 'record', reply: true }, { from: 'Web App', to: 'Web App', label: 'check hash' }, { from: 'Web App', to: 'User', label: 'token', reply: true }] },
  class: { type: 'class', nodes: [{ id: 'p', label: 'Person', fields: ['- name: String'], methods: ['+ getName(): String'] }, { id: 's', label: 'Student' }, { id: 't', label: 'Teacher' }, { id: 'c', label: 'Course', fields: ['- code: String'] }, { id: 'g', label: 'Gradable', kind: 'interface', methods: ['+ grade(): int'] }],
    edges: [{ from: 's', to: 'p', kind: 'inherit' }, { from: 't', to: 'p', kind: 'inherit' }, { from: 't', to: 'c', label: 'teaches' }, { from: 'c', to: 'g', kind: 'realize' }, { from: 'p', to: 'c', kind: 'compose' }] },
  erd: { type: 'erd', nodes: [{ id: 'u', label: 'USER', fields: ['PK user_id', 'name'] }, { id: 'o', label: 'ORDER', fields: ['PK order_id', 'user_id FK', 'total'] }, { id: 'p', label: 'PRODUCT', fields: ['PK id'] }],
    edges: [{ from: 'u', to: 'o', label: 'places', kind: 'one-to-many' }, { from: 'o', to: 'p', label: 'has', kind: 'many-to-many' }] },
  state: { type: 'state', nodes: [{ id: 'i', label: '', kind: 'initial' }, { id: 'a', label: 'Idle' }, { id: 'b', label: 'Busy' }, { id: 'e', label: '', kind: 'final' }], edges: [{ from: 'i', to: 'a' }, { from: 'a', to: 'b', label: 'start' }, { from: 'b', to: 'a', label: 'done' }, { from: 'b', to: 'e', label: 'stop' }] },
  architecture: { type: 'architecture', nodes: [{ id: 'l1', label: 'Presentation', kind: 'boundary' }, { id: 'l2', label: 'Application', kind: 'boundary' }, { id: 'l3', label: 'Data', kind: 'boundary' },
    { id: 'w', label: 'Web app', kind: 'browser', parent: 'l1' }, { id: 'm', label: 'Mobile app', kind: 'mobile', parent: 'l1' }, { id: 'api', label: 'REST API', parent: 'l2' }, { id: 'auth', label: 'Auth service', parent: 'l2' }, { id: 'db', label: 'PostgreSQL', kind: 'database', parent: 'l3' }],
    edges: [{ from: 'w', to: 'api' }, { from: 'm', to: 'api' }, { from: 'api', to: 'auth' }, { from: 'api', to: 'db' }] },
  component: { type: 'component', direction: 'LR', nodes: [{ id: 'a', label: 'Web UI' }, { id: 'b', label: 'API' }, { id: 'c', label: 'Data layer' }, { id: 'd', label: 'DB', kind: 'database' }], edges: [{ from: 'a', to: 'b', kind: 'dashed' }, { from: 'b', to: 'c', kind: 'dashed' }, { from: 'c', to: 'd' }] },
  generic: { type: 'generic', nodes: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Three' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }] },
  arabic: { type: 'flowchart', nodes: [{ id: 'a', label: 'بداية' }, { id: 'b', label: 'إدخال اسم المستخدم وكلمة المرور' }, { id: 'c', label: 'هل البيانات صحيحة؟' }, { id: 'd', label: 'عرض لوحة التحكم' }, { id: 'e', label: 'نهاية' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd', label: 'نعم' }, { from: 'c', to: 'b', label: 'لا' }, { from: 'd', to: 'e' }] },
};

for (const [name, spec] of Object.entries(SPECS)) {
  test(`${name}: builds a valid diagram without overlapping shapes`, () => {
    const { diagram, spec: norm, warnings } = buildDiagramFromSpec(spec, FONT);
    assert.deepEqual(warnings, []);
    assert.ok(nodesOf(diagram).length >= (norm.nodes.length || norm.participants.length));
    assertFinite(diagram); assertNoOverlap(diagram, name); assertEdgesValid(diagram);
    assert.deepEqual(diagram.defaults, FONT);
    const { svg, width, height } = renderFigureSVG(diagram);
    assert.match(svg, /^<svg/); assert.ok(width > 100 && height > 50);
    for (const n of nodesOf(diagram)) assert.ok(n.x >= 0 && n.y >= 0, `${name}: node left of / above the origin`);
  });
}

test('flowchart symbols follow the node kinds', () => {
  const d = specToDiagram(SPECS.flowchart, FONT);
  const shape = (t) => byText(d, t).shape;
  assert.deepEqual(['Start', 'Enter credentials', 'Valid?', 'Dashboard', 'Customer database', 'Receipt', 'End'].map(shape), ['terminator', 'parallelogram', 'diamond', 'rect', 'cylinder', 'document', 'terminator']);
  assert.deepEqual(edgesOf(d).filter((e) => e.text).map((e) => e.text).sort(), ['No', 'Yes']);
});
test('activity diagrams use initial/final nodes, action boxes and bars', () => {
  const d = specToDiagram(SPECS.activity, FONT);
  assert.equal(nodesOf(d).filter((n) => n.shape === 'final').length, 1);
  assert.equal(byText(d, 'Receive order').shape, 'roundRect');
  const bars = nodesOf(d).filter((n) => n.shape === 'rect' && n.h === 8);
  assert.equal(bars.length, 2);
  assert.equal(nodesOf(d).find((n) => n.shape === 'circle' && n.w === 30).style.fill, '#111827');
});
test('flow direction: TB layers go down, LR layers go right', () => {
  for (const [direction, axis] of [['TB', 'y'], ['LR', 'x']]) {
    const d = specToDiagram({ ...SPECS.generic, type: 'flowchart', direction, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }, FONT);
    const [a, b, c] = ['One', 'Two', 'Three'].map((t) => byText(d, t));
    assert.ok(a[axis] < b[axis] && b[axis] < c[axis], `${direction} chain order`);
  }
});
test('hierarchy: a parent is centred over its children, siblings keep spec order', () => {
  const d = specToDiagram(SPECS.hierarchy, FONT);
  const root = byText(d, 'Project'); const [a, b, c] = ['Analysis', 'Design', 'Build'].map((t) => byText(d, t));
  assert.ok(Math.abs(cx(root) - (cx(a) + cx(c)) / 2) <= 1);
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(a.y > root.y && a.y === b.y && b.y === c.y);
  const [r1, r2] = ['Requirements', 'Use cases'].map((t) => byText(d, t));
  assert.ok(Math.abs(cx(a) - (cx(r1) + cx(r2)) / 2) <= 1);
  assert.ok(edgesOf(d).every((e) => e.style.endArrow === 'none'), 'hierarchy lines have no arrowheads');
  assert.ok(byText(d, 'Project').style.fontWeight === 'bold', 'root is emphasised');
});
test('use case: actors stay outside, use cases sit inside one system boundary', () => {
  for (const key of ['usecase', 'usecaseImplicit']) {
    const d = specToDiagram(SPECS[key], FONT);
    const frames = nodesOf(d).filter(isFrame);
    assert.equal(frames.length, 1, key);
    const actors = nodesOf(d).filter((n) => n.shape === 'actor');
    const cases = nodesOf(d).filter((n) => n.shape === 'ellipse');
    assert.ok(actors.length >= 1 && cases.length >= 2);
    for (const a of actors) assert.ok(!overlaps(a, frames[0]), `${key}: actor inside the boundary`);
    for (const c of cases) assert.ok(inside(c, frames[0]), `${key}: use case outside the boundary`);
    assert.ok(edgesOf(d).filter((e) => e.text === '').every((e) => e.routing === 'straight'));
  }
  const d = specToDiagram(SPECS.usecase, FONT);
  assert.deepEqual(edgesOf(d).filter((e) => e.text).map((e) => [e.text, e.style.dash]), [['«include»', 'dashed']]);
  assert.equal(nodesOf(d).find(isFrame).text, 'Library System');
  assert.equal(nodesOf(specToDiagram(SPECS.usecaseImplicit, FONT)).find(isFrame).text, 'Shop', 'implicit boundary takes the title');
});
test('sequence: lifelines, anchored messages in time order, replies dashed', () => {
  const d = specToDiagram(SPECS.sequence, FONT);
  const lines = nodesOf(d).filter((n) => n.shape === 'lifeline');
  assert.deepEqual(lines.map((l) => l.text), ['User', 'Web App', 'Database']);
  assert.ok(lines[0].x < lines[1].x && lines[1].x < lines[2].x);
  assert.ok(lines.every((l) => l.y === lines[0].y && l.h === lines[0].h));
  const msgs = edgesOf(d).filter((e) => e.text && e.source.anchor);
  assert.deepEqual(msgs.map((m) => m.text), ['login()', 'find user', 'record', 'token']);
  const ys = msgs.map((m) => m.source.anchor.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys, 'messages go down the page');
  assert.ok(msgs.every((m) => m.source.anchor.y === m.target.anchor.y), 'messages are horizontal');
  assert.deepEqual(msgs.map((m) => m.style.dash || 'solid'), ['solid', 'solid', 'dashed', 'dashed']);
  assert.ok(edgesOf(d).length > msgs.length, 'self message draws a loop');
});
test('sequence: long labels widen the gap between lifelines', () => {
  const short = specToDiagram({ type: 'sequence', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'hi' }] }, FONT);
  const long = specToDiagram({ type: 'sequence', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'a very long message label that needs room' }] }, FONT);
  const gap = (d) => { const [a, b] = nodesOf(d); return b.x - a.x; };
  assert.ok(gap(long) > gap(short));
});
test('class: compartments, stereotypes and UML arrow ends; superclass above subclass', () => {
  const d = specToDiagram(SPECS.class, FONT);
  const person = byText(d, 'Person');
  assert.equal(person.shape, 'class');
  assert.equal(person.text, 'Person\n--\n- name: String\n--\n+ getName(): String');
  assert.match(byText(d, '«interface»').text, /^«interface»\nGradable\n--\n\+ grade\(\): int$/);
  const ends = edgesOf(d).map((e) => `${e.style.startArrow || ''}/${e.style.endArrow}`);
  assert.ok(ends.includes('/triangleOpen'));
  assert.ok(ends.includes('diamondFilled/none'));
  assert.ok(byText(d, 'Student').y > person.y && byText(d, 'Teacher').y > person.y, 'subclasses sit below');
  assert.ok(edgesOf(d).find((e) => e.style.dash === 'dashed' && e.style.endArrow === 'triangleOpen'), 'realization is dashed');
});
test('erd: entities with key markers and crow\'s-foot ends', () => {
  const d = specToDiagram(SPECS.erd, FONT);
  const order = nodesOf(d).find((n) => n.text.startsWith('ORDER'));
  assert.equal(order.shape, 'entity');
  assert.match(order.text, /^ORDER\n--\nPK {2}order_id\nFK {2}user_id\n/);
  const [one, many] = edgesOf(d);
  assert.deepEqual([one.style.startArrow, one.style.endArrow], ['oneOne', 'zeroMany']);
  assert.deepEqual([many.style.startArrow, many.style.endArrow], ['zeroMany', 'zeroMany']);
});
test('architecture: boundaries hold their members; layers run top to bottom', () => {
  const d = specToDiagram(SPECS.architecture, FONT);
  const [l1, l2, l3] = ['Presentation', 'Application', 'Data'].map((t) => byText(d, t));
  assert.ok(l1.y < l2.y && l2.y < l3.y);
  for (const [name, frame] of [['Web app', l1], ['Mobile app', l1], ['REST API', l2], ['Auth service', l2], ['PostgreSQL', l3]]) assert.ok(inside(byText(d, name), frame), `${name} outside its layer`);
  assert.deepEqual(['Web app', 'Mobile app', 'PostgreSQL'].map((t) => byText(d, t).shape), ['browser', 'mobile', 'cylinder']);
});
test('state: initial and final markers', () => {
  const d = specToDiagram(SPECS.state, FONT);
  assert.equal(nodesOf(d).filter((n) => n.shape === 'final').length, 1);
  assert.equal(byText(d, 'Idle').style.radius, 18);
});
test('node size grows with the label; long labels wrap onto at most a few lines', () => {
  const d = specToDiagram({ type: 'flowchart', nodes: [{ id: 'a', label: 'OK' }, { id: 'b', label: 'A rather long process description that must wrap inside the box' }] }, FONT);
  const [a, b] = nodesOf(d);
  assert.ok(b.h >= a.h && b.w >= a.w);
  assert.ok(b.w <= 320);
});
test('unknown kinds are reported as warnings and the diagram is still built', () => {
  const { diagram, warnings } = buildDiagramFromSpec({ type: 'flowchart', nodes: [{ id: 'a', label: 'A', kind: 'blob' }] });
  assert.equal(nodesOf(diagram).length, 1);
  assert.equal(warnings.length, 1);
});
test('forcing the type overrides the spec', () => {
  const { spec } = buildDiagramFromSpec({ type: 'flowchart', nodes: [{ id: 'a', label: 'Person' }, { id: 'b', label: 'Student' }], edges: [{ from: 'b', to: 'a' }] }, { type: 'class' });
  assert.equal(spec.type, 'class');
  assert.equal(nodesOf(specToDiagram({ type: 'flowchart', nodes: [{ id: 'a', label: 'A' }], edges: [] }, { type: 'class' }))[0].shape, 'class');
});
test('a boundary with no members is drawn as a plain box; a group member is not lost', () => {
  const d = specToDiagram({ type: 'architecture', nodes: [{ id: 'g', label: 'Empty group', kind: 'boundary' }, { id: 'a', label: 'A' }] }, FONT);
  assert.equal(nodesOf(d).filter(isFrame).length, 0);
  assert.equal(nodesOf(d).length, 2);
});
test('the generated figure is deterministic', () => {
  const strip = (d) => JSON.stringify(nodesOf(d).map((n) => [n.shape, n.x, n.y, n.w, n.h, n.text]));
  assert.equal(strip(specToDiagram(SPECS.flowchart, FONT)), strip(specToDiagram(SPECS.flowchart, FONT)));
});
test('node ids are unique and fresh, so a generated diagram can be added to an existing one', () => {
  const a = specToDiagram(SPECS.flowchart, FONT); const b = specToDiagram(SPECS.flowchart, FONT);
  const ids = new Set([...a.elements, ...b.elements].map((e) => e.id));
  assert.equal(ids.size, a.elements.length + b.elements.length);
});

// ============================================================================
section('autoLayout');

test('layered TB: every connector points down; layers are ordered', () => {
  const d = flowchartTemplate(FONT);
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok(ns.Start.y < ns['User Login'].y && ns['User Login'].y < ns['Validate Credentials'].y && ns['Validate Credentials'].y < ns['Credentials Valid?'].y);
  assert.ok(ns['Credentials Valid?'].y < ns.Dashboard.y && ns.Dashboard.y === ns['Error Message'].y && ns.Dashboard.y < ns.End.y);
  assert.ok(ns.Dashboard.x < ns['Error Message'].x, 'Yes branch stays left of No branch (original order kept)');
  assertNoOverlap(d);
});
test('layered LR: the same graph flows left to right', () => {
  const d = flowchartTemplate(FONT);
  autoLayout(d, { mode: 'layered', direction: 'LR' });
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  const chain = ['Start', 'User Login', 'Validate Credentials', 'Credentials Valid?', 'Dashboard', 'End'];
  for (let i = 1; i < chain.length; i += 1) assert.ok(ns[chain[i - 1]].x + ns[chain[i - 1]].w < ns[chain[i]].x, `${chain[i - 1]} before ${chain[i]}`);
  assert.equal(ns.Dashboard.x, ns['Error Message'].x);
  assert.ok(ns.Dashboard.y < ns['Error Message'].y);
  assertNoOverlap(d);
});
test('layered: layers are centred on each other and the spine runs straight', () => {
  const d = flowchartTemplate(FONT);
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok(Math.abs(cx(ns.Start) - cx(ns['User Login'])) <= 1);
  assert.ok(Math.abs(cx(ns['Validate Credentials']) - cx(ns['Credentials Valid?'])) <= 1);
  assert.ok(Math.abs(cx(ns['Credentials Valid?']) - (cx(ns.Dashboard) + cx(ns['Error Message'])) / 2) <= 2, 'decision centred over its branches');
});
test('spacing follows the brief (≈45 between nodes, ≈80 between layers)', () => {
  const d = flowchartTemplate(FONT);
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  const layerGap = ns['User Login'].y - (ns.Start.y + ns.Start.h);
  assert.ok(layerGap >= 70 && layerGap <= 130, `layer gap ${layerGap}`);
  const nodeGap = ns['Error Message'].x - (ns.Dashboard.x + ns.Dashboard.w);
  assert.ok(nodeGap >= 40 && nodeGap <= 90, `node gap ${nodeGap}`);
});
test('crossing reduction untangles crossed connectors', () => {
  const b = builder(FONT);
  const [p, q] = [b.node('rect', 0, 0, 100, 40, 'P'), b.node('rect', 300, 0, 100, 40, 'Q')];
  const [r, sNode] = [b.node('rect', 0, 300, 100, 40, 'R'), b.node('rect', 300, 300, 100, 40, 'S')];
  b.edge(p, sNode); b.edge(q, r); // drawn crossed
  const d = b.diagram();
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const m = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok((cx(m.P) - cx(m.Q)) * (cx(m.S) - cx(m.R)) > 0, 'P→S and Q→R no longer cross');
  // three layers, a shuffled input with a planar solution: A→{C,D}, B→{E,F}
  const b2 = builder(FONT);
  const top = ['A', 'B'].map((t, i) => b2.node('rect', i * 200, 0, 100, 40, t));
  const mid = ['C', 'D', 'E', 'F'].map((t, i) => b2.node('rect', [300, 0, 150, 450][i], 200, 100, 40, t));
  b2.edge(top[0], mid[0]); b2.edge(top[0], mid[2]); b2.edge(top[1], mid[1]); b2.edge(top[1], mid[3]);
  const d2 = b2.diagram();
  autoLayout(d2, { mode: 'layered', direction: 'TB' });
  const k = Object.fromEntries(nodesOf(d2).map((n) => [n.text, n]));
  const segs = [['A', 'C'], ['A', 'E'], ['B', 'D'], ['B', 'F']];
  let crossings = 0;
  for (let i = 0; i < segs.length; i += 1) for (let j = i + 1; j < segs.length; j += 1) {
    if ((cx(k[segs[i][0]]) - cx(k[segs[j][0]])) * (cx(k[segs[i][1]]) - cx(k[segs[j][1]])) < 0) crossings += 1;
  }
  assert.equal(crossings, 0, 'planar graph is drawn without crossings');
});
test('cycles are broken: back edges never throw and still get routed', () => {
  const d = specToDiagram({ type: 'generic', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'b', to: 'b' }] }, FONT);
  const [a, b, c] = ['A', 'B', 'C'].map((t) => byText(d, t));
  assert.ok(a.y < b.y && b.y < c.y);
  assertNoOverlap(d);
  assert.ok(edgesOf(d).every((e) => e.routing === 'orthogonal'));
});
test('tree: children are centred under their parent and subtrees never overlap (TB)', () => {
  const d = hierarchyTemplate(FONT);
  autoLayout(d, { mode: 'tree', direction: 'TB' });
  assertNoOverlap(d);
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  const root = ns['Graduation Project'];
  const phases = ['Planning', 'Analysis', 'Design', 'Implementation', 'Testing'].map((t) => ns[t]);
  assert.ok(Math.abs(cx(root) - (cx(phases[0]) + cx(phases[4])) / 2) <= 1);
  const kids = { Planning: ['Proposal', 'Schedule'], Analysis: ['Requirements', 'Use Cases'], Design: ['Architecture', 'Database'], Implementation: ['Frontend', 'Backend'], Testing: ['Unit Tests', 'User Testing'] };
  for (const [p, [k1, k2]] of Object.entries(kids)) assert.ok(Math.abs(cx(ns[p]) - (cx(ns[k1]) + cx(ns[k2])) / 2) <= 1, `${p} centred`);
  for (let i = 1; i < phases.length; i += 1) assert.ok(phases[i - 1].x + phases[i - 1].w < phases[i].x);
  assert.ok(phases.every((p) => p.y === phases[0].y && p.y > root.y));
});
test('tree LR: the same tree grows to the right with parents centred vertically', () => {
  const d = hierarchyTemplate(FONT);
  autoLayout(d, { mode: 'tree', direction: 'LR' });
  assertNoOverlap(d);
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok(ns['Graduation Project'].x < ns.Planning.x && ns.Planning.x < ns.Proposal.x);
  assert.ok(Math.abs(cy(ns.Planning) - (cy(ns.Proposal) + cy(ns.Schedule)) / 2) <= 1);
  assert.ok(Math.abs(cy(ns['Graduation Project']) - (cy(ns.Planning) + cy(ns.Testing)) / 2) <= 1);
});
test('tree: wide subtrees push neighbours apart (contours, not just widths)', () => {
  const spec = { type: 'hierarchy', nodes: [{ id: 'r', label: 'Root' }, { id: 'a', label: 'A', parent: 'r' }, { id: 'b', label: 'B', parent: 'r' },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, label: `Leaf ${i}`, parent: 'a' })), { id: 'b0', label: 'B0', parent: 'b' }] };
  const d = specToDiagram(spec, FONT);
  assertNoOverlap(d);
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok(ns.B.x > ns['Leaf 5'].x - ns.B.w, 'B is not squeezed under A\'s leaves');
  assert.ok(Math.abs(cx(ns.A) - (cx(ns['Leaf 0']) + cx(ns['Leaf 5'])) / 2) <= 1);
});
test('auto: a forest becomes a tree, a graph with a merge becomes layered', () => {
  const forest = hierarchyTemplate(FONT);
  const copy = JSON.parse(JSON.stringify(forest));
  autoLayout(forest, { mode: 'auto', direction: 'TB' }); autoLayout(copy, { mode: 'tree', direction: 'TB' });
  assert.deepEqual(nodesOf(forest).map((n) => [n.x, n.y]), nodesOf(copy).map((n) => [n.x, n.y]), 'auto = tree for a forest');
  const merge = specToDiagram({ type: 'generic', nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })), edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }] }, FONT);
  const ns = Object.fromEntries(nodesOf(merge).map((n) => [n.text, n]));
  assert.ok(ns.A.y === ns.B.y && ns.C.y > ns.A.y && ns.D.y > ns.C.y);
  assert.ok(Math.abs(cx(ns.C) - (cx(ns.A) + cx(ns.B)) / 2) <= 1);
});
test('tree mode on a graph that is not a forest still lays out every node once', () => {
  const d = specToDiagram({ type: 'generic', nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() })), edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }, { from: 'd', to: 'a' }] }, FONT);
  autoLayout(d, { mode: 'tree', direction: 'TB' });
  assertNoOverlap(d); assertFinite(d);
});
test('disconnected parts sit side by side without touching', () => {
  const b = builder(FONT);
  const chain1 = ['A1', 'A2', 'A3'].map((t, i) => b.node('rect', 10, 10 + i * 5, 160, 64, t));
  const chain2 = ['B1', 'B2'].map((t, i) => b.node('rect', 20, 300 + i * 5, 160, 64, t));
  const lone = [b.node('rect', 30, 700, 160, 64, 'L1'), b.node('rect', 40, 740, 160, 64, 'L2')];
  b.edge(chain1[0], chain1[1]); b.edge(chain1[1], chain1[2]); b.edge(chain2[0], chain2[1]);
  const d = b.diagram();
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  assertNoOverlap(d);
  const box = (names) => { const ns = names.map((t) => byText(d, t)); const x = Math.min(...ns.map((n) => n.x)); const y = Math.min(...ns.map((n) => n.y)); return { x, y, w: Math.max(...ns.map((n) => n.x + n.w)) - x, h: Math.max(...ns.map((n) => n.y + n.h)) - y }; };
  const c1 = box(['A1', 'A2', 'A3']); const c2 = box(['B1', 'B2']);
  assert.ok(!overlaps(c1, c2));
  assert.ok(c2.x >= c1.x + c1.w + 30, 'second component starts to the right of the first');
  assert.equal(byText(d, 'L1').y, byText(d, 'L2').y, 'loose nodes share a row');
});
test('ids: only the selected nodes move; everything else keeps its exact position', () => {
  const d = flowchartTemplate(FONT);
  const before = Object.fromEntries(nodesOf(d).map((n) => [n.text, [n.x, n.y]]));
  const picked = nodesOf(d).filter((n) => ['Validate Credentials', 'Credentials Valid?', 'Dashboard'].includes(n.text));
  autoLayout(d, { mode: 'layered', direction: 'TB', ids: new Set(picked.map((n) => n.id)) });
  for (const n of nodesOf(d)) {
    if (picked.includes(n)) continue;
    assert.deepEqual([n.x, n.y], before[n.text], `${n.text} must not move`);
  }
  assert.ok(picked.some((n) => [n.x, n.y].join() !== before[n.text].join()), 'selected nodes were arranged');
  // edges that touch an unselected node keep their anchors
  const kept = edgesOf(d).filter((e) => e.source.anchor || e.target.anchor);
  assert.ok(kept.length >= 1);
});
test('points, locked nodes and free text labels stay put', () => {
  const b = builder(FONT);
  const a = b.node('rect', 0, 0, 160, 64, 'A'); const c = b.node('rect', 0, 0, 160, 64, 'C');
  const point = b.node('point', 500, 500, 8, 8, ''); const label = b.node('text', 600, 40, 120, 30, 'Legend'); const locked = b.node('rect', 800, 300, 160, 64, 'Pinned');
  locked.locked = true;
  b.edge(a, c);
  const d = b.diagram();
  autoLayout(d, { mode: 'auto', direction: 'TB' });
  assert.deepEqual([point.x, point.y], [500, 500]);
  assert.deepEqual([label.x, label.y], [600, 40]);
  assert.deepEqual([locked.x, locked.y], [800, 300]);
  assert.ok(a.y !== c.y);
});
test('a text label that is connected to something is laid out like any node', () => {
  const b = builder(FONT);
  const a = b.node('rect', 0, 0, 160, 64, 'A'); const t = b.node('text', 0, 0, 120, 30, 'note');
  b.edge(a, t);
  autoLayout(b.diagram(), { mode: 'layered', direction: 'TB' });
  assert.ok(t.y > a.y);
});
test('frames: contents are arranged inside and the frame wraps them (and moves with them)', () => {
  const d = architectureTemplate(FONT);
  autoLayout(d, { mode: 'auto', direction: 'TB' });
  assertNoOverlap(d);
  const frames = nodesOf(d).filter(isFrame);
  assert.equal(frames.length, 3);
  const ns = Object.fromEntries(nodesOf(d).map((n) => [n.text, n]));
  assert.ok(inside(ns['Web Application'], byText(d, 'Presentation Layer')));
  assert.ok(inside(ns['Business Logic'], byText(d, 'Application Layer')));
  assert.ok(inside(ns['Relational Database'], byText(d, 'Data Layer')));
  assert.ok(byText(d, 'Presentation Layer').y < byText(d, 'Application Layer').y && byText(d, 'Application Layer').y < byText(d, 'Data Layer').y);
});
test("frames: 'keep' never moves or shrinks a frame; its contents are arranged inside it", () => {
  const d = architectureTemplate(FONT);
  const before = nodesOf(d).filter(isFrame).map((f) => [f.text, f.x, f.y, f.w, f.h]);
  autoLayout(d, { mode: 'auto', direction: 'TB', frames: 'keep' });
  for (const [text, x, y, w, h] of before) { const f = byText(d, text); assert.deepEqual([f.x, f.y], [x, y], `${text} moved`); assert.ok(f.w >= w && f.h >= h, `${text} shrank`); }
  for (const [name, frame] of [['Web Application', 'Presentation Layer'], ['Business Logic', 'Application Layer'], ['Relational Database', 'Data Layer']]) assert.ok(inside(byText(d, name), byText(d, frame)), `${name} left its layer`);
  // (frames that must grow to hold their contents may then touch their neighbours: that is the price of not moving them)
});
test('a frame that is not selected keeps its position and only grows', () => {
  const b = builder(FONT);
  const frame = b.node('frame', 100, 100, 200, 100, 'Box', { fill: 'none' });
  const a = b.node('rect', 120, 140, 160, 40, 'A'); const c = b.node('rect', 120, 140, 160, 40, 'C'); const out = b.node('rect', 600, 100, 160, 64, 'Out');
  b.edge(a, c);
  const d = b.diagram();
  autoLayout(d, { mode: 'layered', direction: 'TB', ids: new Set([a.id, c.id]) });
  assert.deepEqual([frame.x, frame.y], [100, 100]);
  assert.ok(frame.h > 100, 'grew to hold both nodes');
  assert.ok(inside(a, frame) && inside(c, frame));
  assert.deepEqual([out.x, out.y], [600, 100]);
});
test('connectors: orthogonal, labels and arrow styles kept, ends floating or on the flow sides', () => {
  const d = flowchartTemplate(FONT);
  const labels = edgesOf(d).map((e) => e.text);
  const styles = edgesOf(d).map((e) => JSON.stringify(e.style));
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  assert.deepEqual(edgesOf(d).map((e) => e.text), labels);
  assert.deepEqual(edgesOf(d).map((e) => JSON.stringify(e.style)), styles);
  const ports = Object.values(PORTS).map((p) => JSON.stringify(p));
  for (const e of edgesOf(d)) {
    assert.equal(e.routing, 'orthogonal');
    for (const end of [e.source, e.target]) assert.ok(!end.anchor || ports.includes(JSON.stringify(end.anchor)), 'anchors are reset to side ports');
  }
  assert.ok(edgesOf(d).filter((e) => !e.source.anchor && !e.target.anchor).length >= 4, 'most connectors float');
  // routing 'keep' leaves connectors alone
  const k = flowchartTemplate(FONT); const before = JSON.stringify(edgesOf(k));
  autoLayout(k, { mode: 'layered', direction: 'TB', routing: 'keep' });
  assert.equal(JSON.stringify(edgesOf(k)), before);
});
test('connector ends that are free points are left alone', () => {
  const b = builder(FONT);
  const a = b.node('rect', 0, 0, 160, 64, 'A'); const c = b.node('rect', 0, 0, 160, 64, 'C');
  b.edge(a, c); const free = b.edge({ x: 500, y: 500 }, a, { routing: 'straight' });
  const d = b.diagram();
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  assert.deepEqual(free.source, { x: 500, y: 500 });
  assert.equal(free.routing, 'straight');
});
test('use-case lines keep their straight routing; inheritance puts the general class on top', () => {
  const uc = useCaseTemplate(FONT);
  autoLayout(uc, { mode: 'auto', direction: 'LR' });
  assert.ok(edgesOf(uc).filter((e) => e.text === '').every((e) => e.routing === 'straight'));
  const cls = classTemplate(FONT);
  autoLayout(cls, { mode: 'auto', direction: 'TB' });
  const ns = Object.fromEntries(nodesOf(cls).map((n) => [n.text.split('\n')[0], n]));
  assert.ok(ns.User.y < ns.Administrator.y, 'User (superclass) above Administrator');
});
test('ERD template lays out as a clean chain in either direction', () => {
  for (const direction of ['TB', 'LR']) {
    const d = erdTemplate(FONT);
    autoLayout(d, { mode: 'auto', direction });
    assertNoOverlap(d);
    const [u, w, ds, r] = ['USER', 'WORKSPACE', 'DATASET', 'REPORT'].map((t) => nodesOf(d).find((n) => n.text.startsWith(t)));
    const k = direction === 'TB' ? 'y' : 'x';
    assert.ok(u[k] < w[k] && w[k] < ds[k] && ds[k] < r[k]);
  }
});
test('auto layout is deterministic and (almost) idempotent', () => {
  const run = () => { const d = flowchartTemplate(FONT); autoLayout(d, { mode: 'layered', direction: 'TB' }); return nodesOf(d).map((n) => [n.x, n.y]); };
  assert.deepEqual(run(), run());
  const d = flowchartTemplate(FONT);
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const first = nodesOf(d).map((n) => [n.x, n.y]);
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  const second = nodesOf(d).map((n) => [n.x, n.y]);
  first.forEach(([x, y], i) => assert.ok(Math.abs(x - second[i][0]) <= 60 && y === second[i][1], 'second pass keeps the layering'));
});
test('empty and tiny diagrams are fine', () => {
  assert.deepEqual(autoLayout({ elements: [] }, {}).elements, []);
  const b = builder(FONT); b.node('rect', 50, 60, 160, 64, 'Only');
  const d = b.diagram(); autoLayout(d, {});
  assert.equal(nodesOf(d).length, 1);
  assertFinite(d);
});
test('randomised graphs (cycles, mixed sizes, labels): no overlaps, no NaN, edges intact', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const n = 3 + (seed * 7) % 38;
    for (const [mode, direction] of [['layered', 'TB'], ['layered', 'LR'], ['tree', 'TB'], ['auto', 'LR']]) {
      const d = randomDiagram(seed, n, { dag: seed % 3 === 0 });
      const edgesBefore = edgesOf(d).length;
      autoLayout(d, { mode, direction });
      assertFinite(d); assertNoOverlap(d, `seed ${seed} ${mode}/${direction}`); assertEdgesValid(d);
      assert.equal(edgesOf(d).length, edgesBefore);
    }
  }
});
test('randomised DAGs: layers are ordered along the flow (no connector points backwards)', () => {
  for (let seed = 100; seed < 130; seed += 1) {
    const d = randomDiagram(seed, 4 + (seed % 25), { dag: true });
    const ids = new Map(nodesOf(d).map((x) => [x.id, x]));
    autoLayout(d, { mode: 'layered', direction: 'TB' });
    for (const e of edgesOf(d)) {
      const a = ids.get(e.source.id); const c = ids.get(e.target.id);
      assert.ok(a.y + a.h <= c.y + 0.5, `seed ${seed}: ${a.text} → ${c.text} runs against the flow`);
    }
  }
});
test('large diagrams stay fast', () => {
  const d = randomDiagram(7, 150, { extra: 1.3 });
  const t0 = Date.now();
  autoLayout(d, { mode: 'layered', direction: 'TB' });
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  assertNoOverlap(d);
});
test('unsuited figure types are recognised', () => {
  assert.ok(['fishbone', 'sequence', 'timeline'].every((t) => LAYOUT_UNSUITED_TYPES.has(t)));
  assert.equal(layoutUnsuitedReason(fishboneTemplate(FONT), 'fishbone'), 'fishbone');
  assert.equal(layoutUnsuitedReason(sequenceTemplate(FONT)), 'sequence', 'lifelines give it away even without a type');
  assert.equal(layoutUnsuitedReason(flowchartTemplate(FONT), 'flowchart'), null);
});

test('subgraphs: members stay inside their frame, frames never overlap, edges may end on a frame', () => {
  const { spec } = parseMermaid('flowchart LR\n  subgraph Front\n    A[UI] --> B[Router]\n    subgraph Widgets\n      W1[Chart]\n      W2[Table]\n    end\n  end\n  subgraph Back\n    C[API] --> D[(DB)]\n  end\n  B --> C\n  Widgets --> C\n  W1 --> W2\n  Back --> A');
  const d = buildDiagramFromSpec(spec, FONT).diagram;
  assertNoOverlap(d); assertEdgesValid(d);
  const front = byText(d, 'Front'); const back = byText(d, 'Back'); const widgets = byText(d, 'Widgets');
  assert.ok(!overlaps(front, back));
  assert.ok(inside(widgets, front));
  for (const t of ['UI', 'Router']) assert.ok(inside(byText(d, t), front), `${t} outside Front`);
  for (const t of ['Chart', 'Table']) assert.ok(inside(byText(d, t), widgets), `${t} outside Widgets`);
  for (const t of ['API', 'DB']) assert.ok(inside(byText(d, t), back), `${t} outside Back`);
});

section('robustness');

test('random text never crashes the parsers (only clear SpecErrors)', () => {
  const rnd = lcg(12345);
  const frags = ['A', 'B', '->', '-->', '-.->', '==>', '---', '|x|', '[', ']', '(', ')', '{', '}', '((', '))', '[(', ')]', '([', '])', '"', ' ', '\t', '\n', ':', ';', '&', 'subgraph', 'end', 'flowchart TD', 'sequenceDiagram', 'classDiagram', 'erDiagram', 'stateDiagram-v2', 'participant', 'class', '<|--', '*--', '||--o{', '[*]', 'state', '%%', '#', '؟', 'بداية', 'Note over A', 'loop', '<<interface>>', '+f()', 'A->>B: hi', '1.', '- ', '..>', '|', '<br/>'];
  let built = 0;
  for (let i = 0; i < 1200; i += 1) {
    let text = rnd() < 0.5 ? ['flowchart TD\n', 'sequenceDiagram\n', 'classDiagram\n', 'erDiagram\n', 'stateDiagram-v2\n'][Math.floor(rnd() * 5)] : '';
    for (let k = 0, n = 1 + Math.floor(rnd() * 22); k < n; k += 1) text += frags[Math.floor(rnd() * frags.length)] + (rnd() < 0.3 ? ' ' : '');
    for (const type of ['auto', 'sequence', 'hierarchy']) {
      try { buildDiagramFromSpec(parseText(text, { type }).spec, FONT); built += 1; } catch (e) { assert.ok(e instanceof SpecError, `non-SpecError for ${JSON.stringify(text)}: ${e.stack}`); }
    }
  }
  assert.ok(built > 200, 'a fair share of the random inputs should still produce diagrams');
});
test('mutated specs never crash specToDiagram (only clear SpecErrors)', () => {
  const rnd = lcg(99);
  const junk = [null, undefined, 0, -1, 1e9, NaN, '', ' ', 'x', [], {}, [null], [[]], true, 'A'.repeat(500), '{{}}', { a: 1 }, ['a', 'b'], '<script>', 'constructor', '__proto__'];
  const mutate = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const keys = Object.keys(obj); if (!keys.length) return;
    const k = keys[Math.floor(rnd() * keys.length)]; const r = rnd();
    if (r < 0.35) obj[k] = junk[Math.floor(rnd() * junk.length)];
    else if (r < 0.45) delete obj[k];
    else if (Array.isArray(obj) && r < 0.55) obj.splice(Math.floor(rnd() * obj.length), 1);
    else mutate(obj[k]);
  };
  const bases = Object.values(SPECS);
  let built = 0;
  for (let i = 0; i < 1500; i += 1) {
    const spec = JSON.parse(JSON.stringify(bases[i % bases.length]));
    for (let t = 0, n = 1 + Math.floor(rnd() * 4); t < n; t += 1) mutate(spec);
    try { buildDiagramFromSpec(spec, FONT); built += 1; } catch (e) { assert.ok(e instanceof SpecError, `non-SpecError for ${JSON.stringify(spec).slice(0, 200)}: ${e.stack}`); }
  }
  assert.ok(built > 200);
});

// ============================================================================
section('AI request and responses');

const OK = (text, extra = {}) => ({ ok: true, status: 200, json: async () => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 }, ...extra }) });
const FAIL = (status, message = 'boom') => ({ ok: false, status, json: async () => ({ type: 'error', error: { type: 'x', message } }) });
const fakeFetch = (...responses) => { const calls = []; const fn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const r = responses[Math.min(calls.length - 1, responses.length - 1)]; if (r instanceof Error) throw r; return typeof r === 'function' ? r(init) : r; }; fn.calls = calls; return fn; };
const CONFIG = { apiKey: 'sk-ant-test-123', model: 'claude-sonnet-5-5' };
const SPEC_JSON = JSON.stringify({ type: 'flowchart', title: 'T', nodes: [{ id: 'a', label: 'A' }], edges: [] });

test('settings: defaults, validation and persistence in prefs only', () => {
  memory.clear();
  assert.deepEqual(ai.getAIConfig(), { apiKey: '', model: 'claude-sonnet-5-5' });
  assert.equal(ai.hasAIKey(), false);
  ai.setAIConfig({ apiKey: '  sk-ant-abc  ', model: 'claude-haiku-5-5' });
  assert.deepEqual(ai.getAIConfig(), { apiKey: 'sk-ant-abc', model: 'claude-haiku-5-5' });
  assert.deepEqual(JSON.parse(memory.get('graddocs:prefs')).ai, { apiKey: 'sk-ant-abc', model: 'claude-haiku-5-5' });
  ai.setAIConfig({ model: 'not-a-model' });
  assert.equal(ai.getAIConfig().model, 'claude-sonnet-5-5', 'unknown models fall back to the default');
  assert.equal(ai.getAIConfig().apiKey, 'sk-ant-abc');
  assert.equal(ai.maskKey('sk-ant-api03-abcdefghijklmnop-WXYZ'), 'sk-ant-api…WXYZ');
  memory.clear();
});
test('model list: Sonnet 5.5 is the default, with a faster and a stronger choice', () => {
  assert.deepEqual(ai.AI_MODELS.map((m) => m.id), ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
  assert.equal(ai.DEFAULT_MODEL, 'claude-sonnet-5-5');
  assert.equal(ai.AI_MODELS[0].tier, 'balanced');
});
test('request body: structured output, no sampling or forced tool use, description and type in the prompt', () => {
  const body = ai.buildRequest('Draw a login flow', { type: 'flowchart', model: 'claude-sonnet-5-5' });
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.ok(body.max_tokens >= 8000);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema, SPEC_JSON_SCHEMA);
  assert.equal(body.output_config.effort, 'medium');
  assert.equal(body.fallbacks, 'default');
  assert.ok(body.system.includes('SPEC FORMAT'));
  assert.match(body.messages[0].content, /Diagram type: flowchart/);
  assert.match(body.messages[0].content, /Draw a login flow/);
  for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'thinking', 'prefill']) assert.ok(!(k in body), `${k} must not be sent`);
  const haiku = ai.buildRequest('x', { model: 'claude-haiku-5-5' });
  assert.equal(haiku.output_config.effort, 'low');
  assert.ok(!('fallbacks' in haiku), 'Haiku has no server-side fallback');
  const plain = ai.buildRequest('x', { plain: true });
  assert.ok(!plain.output_config && !plain.fallbacks);
  assert.ok(!ai.buildRequest('Hi', { type: 'auto' }).messages[0].content.includes('Diagram type'));
});
test('generateSpec: headers, endpoint and result', async () => {
  const f = fakeFetch(OK(SPEC_JSON));
  const r = await ai.generateSpec('Describe a thing', { config: CONFIG, fetchImpl: f });
  assert.equal(r.spec.type, 'flowchart');
  const call = f.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-api-key'], 'sk-ant-test-123');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(call.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(buildDiagramFromSpec(r.spec).spec.nodes.length, 1);
});
test('generateSpec: Arabic descriptions are passed through unchanged', async () => {
  const f = fakeFetch(OK(SPEC_JSON));
  await ai.generateSpec('مخطط انسيابي لتسجيل الدخول', { config: CONFIG, fetchImpl: f });
  assert.match(f.calls[0].body.messages[0].content, /مخطط انسيابي لتسجيل الدخول/);
});
test('generateSpec: JSON wrapped in a fence is still understood', async () => {
  const r = await ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(OK('```json\n' + SPEC_JSON + '\n```')) });
  assert.equal(r.spec.nodes[0].id, 'a');
});
test('generateSpec: no key / empty description are caught before any request', async () => {
  const f = fakeFetch(OK(SPEC_JSON));
  await assert.rejects(ai.generateSpec('x', { config: { apiKey: '', model: 'claude-sonnet-5-5' }, fetchImpl: f }), (e) => e instanceof ai.AIError && e.code === 'no-key');
  await assert.rejects(ai.generateSpec('   ', { config: CONFIG, fetchImpl: f }), (e) => e.code === 'bad-request');
  assert.equal(f.calls.length, 0);
});
const rejectsWith = (status, code, re, message) => ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(FAIL(status, message)) }).then(() => assert.fail('should reject'), (e) => {
  assert.ok(e instanceof ai.AIError, String(e)); assert.equal(e.code, code); assert.match(e.message, re); assert.equal(e.status, status);
});
test('errors: 401, 403, 404, 413, 429, 5xx, billing', async () => {
  await rejectsWith(401, 'auth', /401.*Settings/);
  await rejectsWith(403, 'auth', /403/);
  await rejectsWith(404, 'bad-request', /model was not found/);
  await rejectsWith(413, 'bad-request', /too long/);
  await rejectsWith(429, 'rate-limit', /429/);
  await rejectsWith(500, 'overloaded', /temporarily unavailable/);
  await rejectsWith(529, 'overloaded', /529/);
  await rejectsWith(418, 'http', /418/);
  await ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(FAIL(400, 'Your credit balance is too low to access the Anthropic API')) }).then(() => assert.fail(), (e) => assert.equal(e.code, 'billing'));
});
test('errors: network failure, cancellation', async () => {
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(new TypeError('Failed to fetch')) }), (e) => e.code === 'network' && /internet/.test(e.message));
  const ctl = new AbortController(); ctl.abort();
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, signal: ctl.signal, fetchImpl: async (u, init) => { if (init.signal.aborted) { const err = new Error('aborted'); err.name = 'AbortError'; throw err; } return OK(SPEC_JSON); } }), (e) => e.code === 'aborted');
});
test('errors: refusal, truncation, unreadable answers', async () => {
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(OK('', { content: [], stop_reason: 'refusal' })) }), (e) => e.code === 'refused');
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(OK('{"type":"flowchart","nodes":[{"id":"a"', { stop_reason: 'max_tokens' })) }), (e) => e.code === 'truncated');
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(OK('Sorry, I cannot do that.')) }), (e) => e.code === 'bad-response');
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) }), (e) => e.code === 'bad-response');
});
test('a 400 triggers one plain retry (no schema, no fallbacks, no beta header)', async () => {
  const f = fakeFetch(FAIL(400, 'output_config.format: schema not supported'), OK(SPEC_JSON));
  const r = await ai.generateSpec('x', { config: CONFIG, fetchImpl: f });
  assert.equal(r.spec.type, 'flowchart');
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].body.output_config);
  assert.ok(!f.calls[1].body.output_config && !f.calls[1].body.fallbacks && !f.calls[1].init.headers['anthropic-beta']);
  const g = fakeFetch(FAIL(400, 'bad'), FAIL(400, 'still bad'));
  await assert.rejects(ai.generateSpec('x', { config: CONFIG, fetchImpl: g }), (e) => e.code === 'bad-request' && /still bad/.test(e.message));
  assert.equal(g.calls.length, 2, 'only one retry');
});
test('from image: the picture goes as a base64 image block before the instructions', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const f = fakeFetch(OK(SPEC_JSON));
  const r = await ai.generateSpecFromImage(png, { type: 'usecase', note: 'ignore the handwriting', config: CONFIG, fetchImpl: f });
  assert.equal(r.spec.type, 'flowchart');
  const [img, txt] = f.calls[0].body.messages[0].content;
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.equal(txt.type, 'text');
  assert.match(txt.text, /Diagram type: usecase/);
  assert.match(txt.text, /exact text/);
  assert.match(txt.text, /ignore the handwriting/);
  assert.ok(f.calls[0].body.output_config?.format, 'structured output');
  assert.match(f.calls[0].body.system, /JSON/);
});
test('from image: unusable pictures, a missing key and a 400 retry', async () => {
  assert.deepEqual(ai.imageFromDataURL('data:image/jpg;base64,QUJD'), { mediaType: 'image/jpeg', data: 'QUJD' });
  assert.equal(ai.imageFromDataURL('data:image/svg+xml;base64,PHN2Zz4='), null, 'SVG must be rasterised first');
  await assert.rejects(ai.generateSpecFromImage('not an image', { config: CONFIG, fetchImpl: fakeFetch(OK(SPEC_JSON)) }), (e) => e.code === 'bad-request');
  await assert.rejects(ai.generateSpecFromImage('data:image/png;base64,QUJD', { config: { apiKey: '', model: 'claude-sonnet-5-5' }, fetchImpl: fakeFetch(OK(SPEC_JSON)) }), (e) => e.code === 'no-key');
  const big = `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024 + 4)}`;
  await assert.rejects(ai.generateSpecFromImage(big, { config: CONFIG, fetchImpl: fakeFetch(OK(SPEC_JSON)) }), (e) => e.code === 'bad-request' && /too large/.test(e.message));
  const f = fakeFetch(FAIL(400, 'schema not supported'), OK(SPEC_JSON));
  await ai.generateSpecFromImage('data:image/png;base64,QUJD', { config: CONFIG, fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.messages[0].content[0].type, 'image', 'the plain retry still sends the picture');
  assert.ok(!f.calls[1].body.output_config);
});
test('from image: the copy-paste prompt asks to recreate the attached diagram', () => {
  const p = buildImageChatPrompt('erd', 'it is an ERD of a shop');
  assert.match(p, /Diagram type: erd/);
  assert.match(p, /image is attached/);
  assert.match(p, /it is an ERD of a shop/);
  assert.match(p, /Reply with the JSON object only/);
});
test('a usable answer that fails validation is reported by the spec checker, not swallowed', async () => {
  const r = await ai.generateSpec('x', { config: CONFIG, fetchImpl: fakeFetch(OK(JSON.stringify({ type: 'flowchart', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'ghost' }] }))) });
  assert.throws(() => buildDiagramFromSpec(r.spec), (e) => e instanceof SpecError && /ghost/.test(e.message));
});
test('API key never ends up in a diagram, spec or prompt', () => {
  const key = 'sk-ant-secret-key-9999';
  ai.setAIConfig({ apiKey: key });
  const { diagram, spec } = buildDiagramFromSpec(SPECS.flowchart);
  assert.ok(!JSON.stringify(diagram).includes(key) && !JSON.stringify(spec).includes(key) && !buildChatPrompt('x').includes(key));
  memory.clear();
});

// ============================================================================
section('translations');

test('every interface string in the generator, layout and AI modules has an Arabic translation', () => {
  const dir = join(here, '..', 'src', 'figures');
  const files = [...readdirSync(join(dir, 'generate')).map((f) => join(dir, 'generate', f)), join(dir, 'layout.js')];
  const missing = new Set();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) { const k = m[1].replace(/\\'/g, "'"); if (!(k in AR)) missing.add(k); }
  }
  assert.deepEqual([...missing], []);
});
test('strings added to the editor, New Figure dialog and settings are translated', () => {
  const need = ['Auto layout', 'Generate from text…', 'Top to bottom', 'Left to right', 'Tree', 'Diagram arranged', 'Already arranged.', 'Nothing to arrange yet.', 'Arrange the whole diagram', 'Arranged {n} selected shapes',
    'Auto layout is not suited to this kind of figure (fishbone, sequence, timeline, context diagram or image) — it keeps its own layout.', 'Diagram replaced', 'Diagram added to the canvas', 'Generate from description',
    'Generated diagram — pick a type to start from a template instead', 'AI', 'AI diagram generation', 'Claude API key', 'Remove key', 'Model', 'Where to get a key', 'Model changed.', 'Key removed from this browser.'];
  assert.deepEqual(need.filter((k) => !(k in AR)), []);
  for (const file of ['editor/editor-view.js', 'figures-view.js']) {
    const src = readFileSync(join(here, '..', 'src', 'figures', file), 'utf8');
    for (const k of ['Auto layout', 'Generate from text…', 'Generate from description']) if (src.includes(`t('${k}')`)) assert.ok(k in AR);
  }
});

// ---------------------------------------------------------------------------- run
let failed = 0;
for (const [name, fn] of tests) {
  if (!fn) { console.log(`\n${name.slice(1)}`); continue; }
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (err) { failed += 1; console.error(`  ✗ ${name}\n    ${String(err.message).split('\n').join('\n    ')}`); }
}
console.log(`\n${passed} passed${failed ? `, ${failed} failed` : ''}.`);
if (failed) process.exitCode = 1;
