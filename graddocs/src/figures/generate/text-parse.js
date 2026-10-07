// Plain text → diagram spec (no AI needed). Three input styles are understood:
//
//   1. Arrow lists   "Start -> User Login"            one connection per line, chains allowed:
//                    "Valid? -> Dashboard : Yes"       "A -> B -> C", label after " : "
//                    "A --> B" / "A ..> B"             dashed arrows; names ending in "?" become decisions,
//                                                      Start / End / Begin / Stop / بداية / نهاية become terminators
//   2. Outlines      indented lines (2+ spaces or tabs, bullets and numbers allowed) → a hierarchy tree
//   3. Mermaid       flowchart / graph (A[text], B{text}, C((text)), D[(text)], E([text]), -->, ---, -.->, ==>,
//                    -->|label|, A -- text --> B, subgraph), sequenceDiagram, classDiagram, erDiagram, stateDiagram
//
// Every parser returns a raw spec (see spec.js) — pass it to buildDiagramFromSpec().
import { t } from '../../i18n/index.js';
import { SpecError } from './spec.js';

const ARROW_RE = /\s*(-{1,3}>|={1,3}>|-\.+->|\.{2,}>|→|⟶|⇒|⟹)\s*/;
const KEYWORD_LINE = /^\s*(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?)\b/i;

const unquote = (s) => {
  const v = String(s).trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) return v.slice(1, -1).trim();
  return v;
};
const keyOf = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const BIDI_MARKS = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g; // invisible direction marks that come along when text is copied from Arabic sources
const cleanLabel = (s) => unquote(String(s).replace(BIDI_MARKS, '')).replace(/<br\s*\/?>/gi, '\n').replace(/#quot;|&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Strip markdown fences and a leading front-matter block. */
function stripFences(text) {
  let src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const fence = src.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fence) src = fence[1];
  src = src.replace(/^\s*---\n[\s\S]*?\n---\n/, '');
  return src;
}

/** → 'json' | 'mermaid' | 'arrows' | 'outline' | 'list' (a plain list) | 'empty' */
export function detectFormat(text) {
  const src = stripFences(text);
  const lines = src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('%%'));
  if (!lines.length) return 'empty';
  if (src.trim().startsWith('{')) return 'json';
  if (KEYWORD_LINE.test(lines[0])) return 'mermaid';
  if (lines.some((l) => ARROW_RE.test(l) && !l.trim().startsWith('#') && !l.trim().startsWith('//'))) return 'arrows';
  if (lines.some((l) => /^(\t| {2,})\S/.test(l))) return 'outline';
  return 'list';
}

/**
 * Parse text in any supported style.
 * → { spec (raw), format, warnings }.  options: { type } – diagram type chosen by the user ('auto' lets the format decide).
 */
export function parseText(text, { type = 'auto' } = {}) {
  const format = detectFormat(text);
  const src = stripFences(text);
  if (format === 'empty') throw new SpecError([t('Type or paste some text first.')]);
  if (format === 'json') throw new SpecError([t('This looks like JSON — use the “Paste JSON” tab.')]);
  if (format === 'mermaid') return { ...parseMermaid(src), format };
  if (format === 'arrows') return { ...parseArrowList(src, { type }), format };
  if (format === 'outline') return { ...parseOutline(src), format };
  // A plain list: steps of a process when a process-like diagram was requested.
  if (['flowchart', 'activity', 'generic'].includes(type)) return { ...parseSteps(src, type), format: 'steps' };
  throw new SpecError([t('No arrows or indentation found. Write one connection per line (Start -> Login), indent lines to build a tree, or use Mermaid.')]);
}

// ---------------------------------------------------------------------------
// Arrow lists

const START_WORDS = /^(start|begin|beginning|بداية|البداية|ابدأ|بدء|البدء)$/i;
const END_WORDS = /^(end|stop|finish|finished|نهاية|النهاية|انتهاء|الانتهاء|إنهاء|انتهى)$/i;

class Graph {
  constructor() { this.nodes = []; this.byKey = new Map(); this.edges = []; this.extra = 0; }

  node(name) {
    const label = cleanLabel(name);
    const key = keyOf(label);
    let n = this.byKey.get(key);
    if (!n) { n = { id: `n${this.nodes.length + 1}`, label }; this.nodes.push(n); this.byKey.set(key, n); }
    return n;
  }

  /** A fresh node that is never merged with another one (for [*] markers). */
  fresh(kind, label = '') {
    const n = { id: `n${this.nodes.length + 1}`, label, kind };
    this.nodes.push(n);
    return n;
  }
}

const isMarker = (s) => /^(\[\*\]|\(\*\)|●)$/.test(s.trim());

function parseSteps(src, type) {
  const lines = src.split('\n').map((l) => l.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
  const g = new Graph();
  let prev = null;
  for (const line of lines) {
    const n = g.node(line);
    if (prev && prev !== n) g.edges.push({ from: prev.id, to: n.id });
    prev = n;
  }
  return { spec: { type: type === 'generic' ? 'flowchart' : type, direction: 'TB', nodes: g.nodes, edges: g.edges }, warnings: [] };
}

export function parseArrowList(text, { type = 'auto' } = {}) {
  const src = stripFences(text);
  const g = new Graph();
  const warnings = [];
  const messages = [];
  const people = [];
  const errors = [];
  const seq = type === 'sequence';
  const person = (name) => {
    const label = cleanLabel(name);
    if (!people.some((p) => keyOf(p) === keyOf(label))) people.push(label);
    return label;
  };

  src.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;
    const parts = line.split(new RegExp(ARROW_RE.source, 'g'));
    // parts = [text, arrow, text, arrow, text …]
    if (parts.length < 3) { warnings.push(t('Line {n} has no arrow — skipped.', { n: i + 1 })); return; }
    // The label ("A -> B : label") belongs to the last connection.
    let label = '';
    const last = parts[parts.length - 1];
    const lm = last.match(/^(.*?)\s+[:：]\s*(.*)$/);
    if (lm) { parts[parts.length - 1] = lm[1]; label = lm[2].trim(); }
    else if (/\s*[:：]\s*$/.test(last)) parts[parts.length - 1] = last.replace(/\s*[:：]\s*$/, '');
    for (let k = 0; k < parts.length; k += 2) {
      parts[k] = parts[k].trim();
      if (!parts[k]) { errors.push(t('Line {n}: a name is missing next to an arrow.', { n: i + 1 })); return; }
    }
    for (let k = 0; k + 2 < parts.length; k += 2) {
      const arrow = parts[k + 1];
      const from = parts[k]; const to = parts[k + 2];
      const isLast = k + 2 === parts.length - 1;
      const dashed = arrow.includes('.');
      if (seq) {
        messages.push({ from: person(from), to: person(to), label: isLast ? label : '', reply: dashed || /^-{2,}>/.test(arrow) });
        continue;
      }
      const a = isMarker(from) ? g.fresh('initial') : g.node(from);
      const b = isMarker(to) ? g.fresh('final') : g.node(to);
      g.edges.push({ from: a.id, to: b.id, label: isLast ? label : '', kind: dashed ? 'dashed' : undefined });
    }
  });
  if (errors.length) throw new SpecError(errors);
  if (seq) return { spec: { type: 'sequence', participants: people, messages }, warnings };

  const resolved = type === 'auto' ? 'flowchart' : type;
  if (resolved === 'usecase') {
    const incoming = new Set(g.edges.map((e) => e.to));
    const outgoing = new Set(g.edges.map((e) => e.from));
    for (const n of g.nodes) if (!n.kind && outgoing.has(n.id) && !incoming.has(n.id)) n.kind = 'actor';
  }
  if (resolved === 'hierarchy') for (const e of g.edges) e.kind = 'line';
  return { spec: { type: resolved, nodes: g.nodes, edges: g.edges }, warnings };
}

// ---------------------------------------------------------------------------
// Indented outline → hierarchy

export function parseOutline(text) {
  const src = stripFences(text);
  const nodes = []; const edges = [];
  const stack = []; // { indent, id }
  const warnings = [];
  src.split('\n').forEach((raw) => {
    if (!raw.trim() || raw.trim().startsWith('#') && !/^#+\s*\S/.test(raw.trim())) return;
    const expanded = raw.replace(/\t/g, '    ');
    const lead = expanded.match(/^ */)[0].length;
    const indent = lead >= 2 ? lead : 0;
    const label = cleanLabel(expanded.trim().replace(/^(?:[-*+•–·]|\d+(?:\.\d+)*[.)]?)\s+/, ''));
    if (!label) return;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const node = { id: `n${nodes.length + 1}`, label };
    nodes.push(node);
    if (stack.length) edges.push({ from: stack[stack.length - 1].id, to: node.id, kind: 'line' });
    stack.push({ indent, id: node.id });
  });
  const roots = nodes.filter((n) => !edges.some((e) => e.to === n.id));
  if (roots.length > 1) warnings.push(t('The outline has {n} top-level items, so it is drawn as separate trees. Indent them under one root to join them.', { n: roots.length }));
  return { spec: { type: 'hierarchy', direction: 'TB', nodes, edges }, warnings };
}

// ---------------------------------------------------------------------------
// Mermaid

/** Split on ";" outside quotes and brackets, drop comments. */
function statements(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/\s%%.*$/, '').replace(/^\s*%%.*$/, '');
    let depth = 0; let quote = null; let cur = '';
    for (const ch of line) {
      if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
      if (ch === '"') { quote = ch; cur += ch; continue; }
      if ('[({'.includes(ch)) depth += 1;
      if ('])}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseMermaid(text) {
  const src = stripFences(text);
  const lines = src.split('\n');
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('%%'));
  const head = (first || '').trim();
  const body = lines.slice(lines.indexOf(first) + 1);
  if (/^(flowchart|graph)\b/i.test(head)) return mermaidFlow(head, body);
  if (/^sequenceDiagram/i.test(head)) return mermaidSequence(body);
  if (/^classDiagram/i.test(head)) return mermaidClass(body);
  if (/^erDiagram/i.test(head)) return mermaidER(body);
  if (/^stateDiagram/i.test(head)) return mermaidState(body);
  throw new SpecError([t('Unsupported Mermaid diagram. Supported: flowchart / graph, sequenceDiagram, classDiagram, erDiagram, stateDiagram.')]);
}

const dirOf = (word) => (/^(LR|RL)$/i.test(word || '') ? 'LR' : 'TB');

// ---- flowchart / graph

const SHAPES = [
  { open: '[[', close: ']]', kind: 'subprocess' },
  { open: '[(', close: ')]', kind: 'database' },
  { open: '[/', close: '/]', kind: 'io' },
  { open: '[\\', close: '\\]', kind: 'io' },
  { open: '[/', close: '\\]', kind: 'io' },
  { open: '[\\', close: '/]', kind: 'io' },
  { open: '((', close: '))', kind: 'circle' },
  { open: '([', close: '])', kind: 'start' },
  { open: '{{', close: '}}', kind: undefined },
  { open: '[', close: ']', kind: undefined },
  { open: '{', close: '}', kind: 'decision' },
  { open: '(', close: ')', kind: 'state' },
  { open: '>', close: ']', kind: undefined },
];
const ID_RE = /^[\p{L}\p{N}_$]+/u;

function readShape(s, pos) {
  for (const sh of SHAPES) {
    if (!s.startsWith(sh.open, pos)) continue;
    let i = pos + sh.open.length;
    let text;
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      if (end === -1) continue;
      text = s.slice(i + 1, end);
      i = end + 1;
      while (s[i] === ' ') i += 1;
      if (!s.startsWith(sh.close, i)) continue;
      return { kind: sh.kind, label: cleanLabel(text), end: i + sh.close.length };
    }
    const end = s.indexOf(sh.close, i);
    if (end === -1) continue;
    return { kind: sh.kind, label: cleanLabel(s.slice(i, end)), end: end + sh.close.length };
  }
  return null;
}

/** Read one link at the start of `rest`. → { len, label, dashed, directed, both, endCircle } | null */
function readLink(rest) {
  // "-- text -->", "== text ==>", "-. text .->"
  const open = rest.match(/^(<)?(--|==|-\.)(?=\s+[^\s\-=.>])/);
  if (open) {
    const after = rest.slice(open[0].length);
    const term = after.match(/\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)(?=\s|$|[\p{L}\p{N}_])/u);
    if (term) {
      const tok = term[1];
      return {
        len: open[0].length + term.index + term[0].length,
        label: cleanLabel(after.slice(0, term.index)),
        dashed: open[2] === '-.', directed: tok.endsWith('>'), both: !!open[1], endCircle: false,
      };
    }
  }
  const m = rest.match(/^(<|o|x)?(-\.+-|-{2,}|={2,}|~{3,})(>|o|x)?/);
  if (!m) return null;
  let len = m[0].length;
  let label = '';
  const pipe = rest.slice(len).match(/^\s*\|([^|]*)\|/);
  if (pipe) { label = cleanLabel(pipe[1]); len += pipe[0].length; }
  return { len, label, dashed: m[2].includes('.'), directed: m[3] === '>' || m[3] === 'x', both: m[1] === '<', endCircle: m[3] === 'o', invisible: m[2].startsWith('~') };
}

function mermaidFlow(head, body) {
  const nodes = new Map();
  const edges = [];
  const warnings = [];
  const groupStack = [];
  let direction = dirOf((head.match(/\b(TB|TD|BT|LR|RL)\b/i) || [])[1]);

  const touch = (id, shape) => {
    let n = nodes.get(id);
    if (!n) {
      n = { id, label: '', explicit: false, kind: undefined, parent: groupStack[groupStack.length - 1] };
      nodes.set(id, n);
    }
    if (shape && (!n.explicit || shape.label)) {
      n.label = shape.label; n.kind = shape.kind; n.explicit = true;
    }
    return n;
  };

  const readNode = (s, pos) => {
    let p = pos;
    while (s[p] === ' ') p += 1;
    const m = s.slice(p).match(ID_RE);
    if (!m) return null;
    const id = m[0];
    p += id.length;
    const shape = readShape(s, p);
    if (shape) p = shape.end;
    touch(id, shape);
    return { id, end: p };
  };

  for (const st of statements(body)) {
    if (/^(classDef|class|style|linkStyle|click|accTitle|accDescr|direction\b)/i.test(st)) {
      const dm = st.match(/^direction\s+(\w+)/i);
      if (dm && !groupStack.length) direction = dirOf(dm[1]);
      continue;
    }
    const sg = st.match(/^subgraph\s+(.+)$/i);
    if (sg) {
      const spec = sg[1].trim();
      const withTitle = spec.match(/^([\p{L}\p{N}_$]+)\s*\[(.*)\]$/u);
      // "subgraph one" has the id and the title "one"; a title with spaces gets a generated id.
      const id = withTitle ? withTitle[1] : /^[\p{L}\p{N}_$]+$/u.test(spec) ? spec : `sg_${nodes.size + 1}`;
      const label = withTitle ? cleanLabel(withTitle[2]) : cleanLabel(spec);
      const n = { id, label, explicit: true, kind: 'boundary', parent: groupStack[groupStack.length - 1] };
      nodes.set(id, n);
      groupStack.push(id);
      continue;
    }
    if (/^end$/i.test(st)) { groupStack.pop(); continue; }

    // chain: group (link group)*
    let pos = 0;
    const readGroup = () => {
      const ids = [];
      const n = readNode(st, pos);
      if (!n) return null;
      ids.push(n.id); pos = n.end;
      for (;;) {
        const amp = st.slice(pos).match(/^\s*&\s*/);
        if (!amp) break;
        pos += amp[0].length;
        const n2 = readNode(st, pos);
        if (!n2) break;
        ids.push(n2.id); pos = n2.end;
      }
      return ids;
    };
    let left = readGroup();
    if (!left) { warnings.push(t('Could not read “{text}”.', { text: st.slice(0, 40) })); continue; }
    for (;;) {
      while (st[pos] === ' ') pos += 1;
      if (pos >= st.length) break;
      const link = readLink(st.slice(pos));
      if (!link) { warnings.push(t('Could not read “{text}”.', { text: st.slice(pos, pos + 40) })); break; }
      pos += link.len;
      const right = readGroup();
      if (!right) break;
      if (!link.invisible) {
        for (const a of left) for (const b of right) {
          const e = { from: a, to: b, label: link.label };
          if (!link.directed && !link.both) e.kind = link.dashed ? 'dashed' : 'line';
          else if (link.dashed) e.kind = 'dashed';
          if (!link.directed && link.dashed) e.toEnd = 'none';
          if (link.both) e.fromEnd = 'arrow';
          if (link.endCircle) e.toEnd = 'circle';
          edges.push(e);
        }
      }
      left = right;
    }
  }
  const list = [...nodes.values()].map((n) => ({ id: n.id, label: n.label || n.id, kind: n.kind, parent: n.parent }));
  return { spec: { type: 'flowchart', direction, nodes: list, edges }, warnings };
}

// ---- sequenceDiagram

function mermaidSequence(body) {
  const people = []; const byId = new Map();
  const messages = [];
  const warnings = [];
  let title = '';
  let numbering = false; let counter = 0; let blocks = false;
  const ensure = (id, label) => {
    const key = id.trim();
    let p = byId.get(key);
    if (!p) { p = { id: key, label: cleanLabel(label || key) }; byId.set(key, p); people.push(p); } else if (label) p.label = cleanLabel(label);
    return p;
  };
  for (const st of statements(body)) {
    let m;
    if ((m = st.match(/^(?:participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/i))) { ensure(m[1], m[2]); continue; }
    if (/^autonumber\b/i.test(st)) { numbering = true; continue; }
    if ((m = st.match(/^title\s*:?\s*(.+)$/i))) { title = cleanLabel(m[1]); continue; }
    if (/^end$/i.test(st) || /^(activate|deactivate|box|else|and|option)(\s|$)/i.test(st)) continue;
    if (/^(loop|alt|opt|par|critical|break|rect)(\s|$)/i.test(st)) { blocks = true; continue; }
    if (/^note\b/i.test(st)) { warnings.push(t('Notes in sequence diagrams are not drawn.')); continue; }
    m = st.match(/^(.+?)\s*(--?)(>>|>|x|\))\s*([+-])?\s*([^:]+?)\s*(?::\s*(.*))?$/);
    if (m) {
      const a = ensure(m[1]); const b = ensure(m[5]);
      counter += 1;
      const text = cleanLabel(m[6] || '');
      // ->> and -->> are synchronous / return messages; -) and --) (open arrow) are asynchronous.
      messages.push({ from: a.id, to: b.id, label: numbering ? `${counter}: ${text}`.replace(/: $/, '') : text, reply: m[2] === '--', ...(m[3] === ')' ? { async: true } : {}) });
      continue;
    }
    warnings.push(t('Could not read “{text}”.', { text: st.slice(0, 40) }));
  }
  if (blocks) warnings.push(t('Loop / alt / opt blocks are not drawn; their messages are kept in order.'));
  return { spec: { type: 'sequence', title, participants: people, messages }, warnings };
}

// ---- classDiagram

const CLASS_OPS = [
  ['<|--', 'inherit', true], ['--|>', 'inherit', false], ['*--', 'compose', false], ['--*', 'compose', true],
  ['o--', 'aggregate', false], ['--o', 'aggregate', true], ['..|>', 'realize', false], ['<|..', 'realize', true],
  ['<--', 'arrow', true], ['-->', 'arrow', false], ['<..', 'dashed', true], ['..>', 'dashed', false], ['..', 'dashed-line', false], ['--', 'line', false],
];
const CLASS_REL = new RegExp(`^([\\w$.~-]+)\\s*(?:"([^"]*)")?\\s*(${CLASS_OPS.map(([op]) => op.replace(/[|*.]/g, '\\$&')).join('|')})\\s*(?:"([^"]*)")?\\s*([\\w$.~-]+)\\s*(?::\\s*(.*))?$`);

function mermaidClass(body) {
  const classes = new Map(); const edges = []; const warnings = [];
  let direction = 'TB';
  const cls = (name) => {
    const id = name.replace(/~.*$/, '');
    let c = classes.get(id);
    if (!c) { c = { id, label: id, kind: 'class', fields: [], methods: [] }; classes.set(id, c); }
    return c;
  };
  const member = (c, text) => {
    const v = text.trim();
    if (!v) return;
    const stereo = v.match(/^<<\s*(\w+)\s*>>$/);
    if (stereo) { if (/interface/i.test(stereo[1])) c.kind = 'interface'; return; }
    (v.includes('(') ? c.methods : c.fields).push(v.replace(/\s*\$$|\*$/, ''));
  };
  let open = null;
  for (const raw of body) {
    const st = raw.replace(/\s%%.*$/, '').trim();
    if (!st || st.startsWith('%%')) continue;
    if (open) { if (st === '}') open = null; else member(open, st); continue; }
    let m;
    if ((m = st.match(/^direction\s+(\w+)/i))) { direction = dirOf(m[1]); continue; }
    if ((m = st.match(/^class\s+([\w$.~-]+)(?:\s*\[\s*"?([^\]"]*)"?\s*\])?\s*(\{)?\s*(.*?)$/))) {
      const c = cls(m[1]);
      if (m[2]) c.label = m[2];
      if (m[3]) { open = c; if (m[4] && m[4] !== '}') member(c, m[4].replace(/\}\s*$/, '')); if (/\}\s*$/.test(m[4] || '')) open = null; }
      continue;
    }
    if ((m = st.match(/^<<\s*(\w+)\s*>>\s+([\w$.~-]+)$/))) { if (/interface/i.test(m[1])) cls(m[2]).kind = 'interface'; continue; }
    if ((m = st.match(CLASS_REL))) {
      const [, left, c1, op, c2, right, label] = m;
      const [, kind, reversed] = CLASS_OPS.find(([o]) => o === op);
      cls(left); cls(right);
      const text = [c1, label && cleanLabel(label), c2].filter(Boolean).join(' ');
      let from = left; let to = right;
      if (reversed) [from, to] = [right, left];
      const e = { from: cls(from).id, to: cls(to).id, label: text, kind };
      if (kind === 'dashed-line') { e.kind = 'dashed'; e.toEnd = 'none'; }
      edges.push(e);
      continue;
    }
    if ((m = st.match(/^([\w$.~-]+)\s*:\s*(.+)$/))) { member(cls(m[1]), m[2]); continue; }
    warnings.push(t('Could not read “{text}”.', { text: st.slice(0, 40) }));
  }
  return { spec: { type: 'class', direction, nodes: [...classes.values()], edges }, warnings };
}

// ---- erDiagram

const ER_LEFT = { '||': 'one-only', '|o': 'zero-one', '}o': 'zero-many', '}|': 'one-many' };
const ER_RIGHT = { '||': 'one-only', 'o|': 'zero-one', 'o{': 'zero-many', '|{': 'one-many' };

function mermaidER(body) {
  const entities = new Map(); const edges = []; const warnings = [];
  const ent = (name) => {
    const id = name.replace(/^"|"$/g, '');
    let e = entities.get(id);
    if (!e) { e = { id, label: id, kind: 'entity', fields: [] }; entities.set(id, e); }
    return e;
  };
  let open = null;
  for (const raw of body) {
    const st = raw.replace(/\s%%.*$/, '').trim();
    if (!st || st.startsWith('%%')) continue;
    if (open) {
      if (st === '}') { open = null; continue; }
      const m = st.match(/^(\S+)\s+(\S+)(?:\s+([A-Za-z, ]+?))?(?:\s+"[^"]*")?$/);
      if (m) {
        const keys = (m[3] || '').split(/[,\s]+/).filter((k) => /^(PK|FK|UK)$/i.test(k)).map((k) => k.toUpperCase());
        open.fields.push(`${keys.length ? `${keys.join(',')} ` : ''}${m[2]}: ${m[1]}`);
      } else open.fields.push(st);
      continue;
    }
    let m = st.match(/^("?[\w-]+"?)\s*\{\s*$/);
    if (m) { open = ent(m[1]); continue; }
    m = st.match(/^("?[\w-]+"?)\s+([|}o]{1,2})(--|\.\.)([|{o]{1,2})\s+("?[\w-]+"?)\s*(?::\s*(.*))?$/);
    if (m) {
      const [, a, l, line, r, b, label] = m;
      const e = { from: ent(a).id, to: ent(b).id, label: cleanLabel(label || ''), fromEnd: ER_LEFT[l], toEnd: ER_RIGHT[r], kind: line === '..' ? 'dashed' : undefined };
      if (!e.fromEnd || !e.toEnd) warnings.push(t('Unknown relationship symbol in “{text}”.', { text: st.slice(0, 40) }));
      edges.push(e);
      continue;
    }
    if (/^direction\b/i.test(st) || /^title\b/i.test(st)) continue;
    if ((m = st.match(/^("?[\w-]+"?)$/))) { ent(m[1]); continue; }
    warnings.push(t('Could not read “{text}”.', { text: st.slice(0, 40) }));
  }
  return { spec: { type: 'erd', direction: 'LR', nodes: [...entities.values()], edges }, warnings };
}

// ---- stateDiagram

function mermaidState(body) {
  const nodes = new Map(); const edges = []; const warnings = [];
  const stack = [];
  let direction = 'LR';
  let markers = 0;
  const parent = () => stack[stack.length - 1];
  const state = (id) => {
    let n = nodes.get(id);
    if (!n) { n = { id, label: id, kind: 'state', parent: parent() }; nodes.set(id, n); }
    return n;
  };
  const endpoint = (name, asSource) => {
    if (name === '[*]') {
      markers += 1;
      const n = { id: `__${asSource ? 'start' : 'end'}${markers}`, label: '', kind: asSource ? 'initial' : 'final', parent: parent() };
      nodes.set(n.id, n);
      return n.id;
    }
    return state(name).id;
  };
  for (const raw of body) {
    const st = raw.replace(/\s%%.*$/, '').trim();
    if (!st || st.startsWith('%%')) continue;
    let m;
    if ((m = st.match(/^direction\s+(\w+)/i))) { direction = dirOf(m[1]); continue; }
    if (st === '}') { stack.pop(); continue; }
    if (st === '--' || /^(note|title|classDef|class|style)\b/i.test(st)) continue;
    if ((m = st.match(/^state\s+"([^"]*)"\s+as\s+(\S+)$/))) { state(m[2]).label = m[1]; continue; }
    if ((m = st.match(/^state\s+(\S+)\s*<<\s*(choice|fork|join)\s*>>$/i))) { const n = state(m[1]); n.label = ''; n.kind = m[2].toLowerCase() === 'choice' ? 'decision' : m[2].toLowerCase(); continue; }
    if ((m = st.match(/^state\s+(\S+)\s*\{$/))) { const n = state(m[1]); n.kind = 'boundary'; stack.push(n.id); continue; }
    if ((m = st.match(/^(\[\*\]|[\w-]+)\s*-->\s*(\[\*\]|[\w-]+)\s*(?::\s*(.*))?$/))) {
      edges.push({ from: endpoint(m[1], true), to: endpoint(m[2], false), label: cleanLabel(m[3] || '') });
      continue;
    }
    if ((m = st.match(/^([\w-]+)\s*:\s*(.+)$/))) { state(m[1]).label = cleanLabel(m[2]); continue; }
    if ((m = st.match(/^([\w-]+)$/))) { state(m[1]); continue; }
    warnings.push(t('Could not read “{text}”.', { text: st.slice(0, 40) }));
  }
  return { spec: { type: 'state', direction, nodes: [...nodes.values()], edges }, warnings };
}
