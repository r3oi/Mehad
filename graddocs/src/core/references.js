// Cross references. Section bodies store references as tokens:
//   {{ref:fig:<figureId>}}  {{ref:tab:<tableId>}}  {{ref:sec:<sectionId>}}  {{ref:ch:<chapterId>}}
// Tokens are resolved against the live numbering at render time, so
// "Figure 3" becomes "Figure 4" automatically when a figure is inserted before it.
//
// Placement lines. A body line that contains ONLY {{figure:<id>}} or {{table:<id>}} places that figure/table
// at exactly that spot between the paragraphs (see numbering.js and document.js). Figures and tables that are
// assigned to a section but not placed still go at the end of the section.
// (numbering.js imports placementsIn from here and we import getNumbering from there: the cycle is harmless
// because both modules only call each other's functions at run time, never while loading.)
import { getNumbering, invalidateNumbering } from './numbering.js';
import { walkSections } from './model.js';
import { esc } from '../ui/dom.js';

export const REF_RE = /\{\{ref:(fig|tab|sec|ch):([A-Za-z0-9_-]+)\}\}/g;
export const REF_KINDS = { fig: 'Figure', tab: 'Table', sec: 'Section', ch: 'Chapter' };

export const makeRef = (kind, id) => `{{ref:${kind}:${id}}}`;

// ---------------------------------------------------------------------------
// Placement lines: {{figure:<id>}} / {{table:<id>}} alone on a line.

/** One whole body line that is a placement token (anchored, not global: safe with test()/exec()). */
export const PLACE_RE = /^\s*\{\{(figure|table):([A-Za-z0-9_-]+)\}\}\s*$/;
export const PLACE_KINDS = ['figure', 'table'];

export const makePlacement = (kind, id) => `{{${kind}:${id}}}`;
export const isPlacementLine = (line) => PLACE_RE.test(String(line ?? ''));

const mayHavePlacement = (text) => text.includes('{{figure:') || text.includes('{{table:');

/** Every placement line of a body → [{ kind: 'figure' | 'table', id, line }] (`line` = zero-based index among body.split('\n')). */
export function placementsIn(body) {
  const text = String(body ?? '');
  if (!mayHavePlacement(text)) return [];
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = PLACE_RE.exec(line);
    if (m) out.push({ kind: m[1], id: m[2], line: i });
  });
  return out;
}

/** Body without its placement lines (what a reader would call "the text"). */
export function stripPlacements(body) {
  const text = String(body ?? '');
  if (!mayHavePlacement(text)) return text;
  return text.split('\n').filter((line) => !PLACE_RE.test(line)).join('\n');
}

/** Insert a placement line before line `at` (default: after the last non-blank line). Pure: returns the new body. */
export function insertPlacement(body, kind, id, at) {
  const lines = String(body ?? '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const index = Number.isInteger(at) ? Math.max(0, Math.min(at, lines.length)) : lines.length;
  lines.splice(index, 0, makePlacement(kind, id));
  return lines.join('\n');
}

/** Remove every placement line of one item. Pure: returns the new body (the same string when nothing matched). */
export function removePlacements(body, kind, id) {
  const text = String(body ?? '');
  if (!text.includes(makePlacement(kind, id))) return text;
  return text.split('\n').filter((line) => { const m = PLACE_RE.exec(line); return !(m && m[1] === kind && m[2] === id); }).join('\n');
}

/** Remove one line by index. Pure. */
export function removeLine(body, index) {
  const lines = String(body ?? '').split('\n');
  if (index < 0 || index >= lines.length) return String(body ?? '');
  lines.splice(index, 1);
  return lines.join('\n');
}

/**
 * Move line `index` one non-blank line up (dir < 0) or down (dir > 0). Blank lines are skipped, so a
 * figure jumps over one paragraph at a time. Pure → { body, line } (`line` = new index), or null at the edge.
 */
export function moveLine(body, index, dir) {
  const lines = String(body ?? '').split('\n');
  if (index < 0 || index >= lines.length) return null;
  const [moved] = lines.splice(index, 1);
  let at;
  if (dir < 0) {
    let k = index - 1;
    while (k >= 0 && !lines[k].trim()) k -= 1;
    if (k < 0) return null;
    at = k;
  } else {
    let k = index;
    while (k < lines.length && !lines[k].trim()) k += 1;
    if (k >= lines.length) return null;
    at = k + 1;
  }
  lines.splice(at, 0, moved);
  return { body: lines.join('\n'), line: at };
}

/** Where is this figure/table placed in the text? → { ownerId, ownerKind, line } | null (not placed, or a duplicate). */
export function placementOf(project, kind, id) {
  const n = getNumbering(project);
  return (kind === 'figure' ? n.figures : n.tables).get(id)?.placement || null;
}

/**
 * Placement lines that do not work: the figure/table was deleted ('missing') or the same item is
 * placed again after its first placement ('duplicate').
 * → [{ ownerId, ownerKind, ownerTitle, kind, id, line, reason }]
 */
export function findBrokenPlacements(project) {
  return getNumbering(project).brokenPlacements.map((b) => ({ ...b }));
}

/**
 * Take a figure/table out of the text: removes its placement lines from every body (it stays assigned to its section,
 * i.e. at the end of it). Run inside store.update. Returns how many bodies changed.
 */
export function clearPlacement(project, kind, id) {
  let changed = 0;
  const strip = (node) => {
    const next = removePlacements(node.body, kind, id);
    if (next !== (node.body ?? '')) { node.body = next; changed += 1; }
  };
  project.chapters.forEach(strip);
  walkSections(project, strip);
  if (changed) invalidateNumbering(project);
  return changed;
}

/** Resolve one reference → { text, ok, title }. */
export function refInfo(project, kind, id) {
  const n = getNumbering(project);
  if (kind === 'fig') {
    const info = n.figures.get(id); const fig = project.figures.find((f) => f.id === id);
    return info ? { text: info.label, ok: true, title: fig?.title || '' } : { text: `${project.settings.captions.figure.label} ??`, ok: false, title: 'Missing figure' };
  }
  if (kind === 'tab') {
    const info = n.tables.get(id); const tab = project.tables.find((t) => t.id === id);
    return info ? { text: info.label, ok: true, title: tab?.title || '' } : { text: `${project.settings.captions.table.label} ??`, ok: false, title: 'Missing table' };
  }
  if (kind === 'sec') {
    const info = n.sections.get(id);
    return info ? { text: `Section ${info.number}`, ok: true, title: info.title } : { text: 'Section ??', ok: false, title: 'Missing section' };
  }
  if (kind === 'ch') {
    const info = n.chapters.get(id);
    return info ? { text: info.label, ok: true, title: info.title } : { text: 'Chapter ??', ok: false, title: 'Missing chapter' };
  }
  return { text: '??', ok: false, title: 'Unknown reference' };
}

/** Body text with every token replaced by its current label (plain text). */
export function resolveText(project, body) {
  return stripPlacements(body).replace(REF_RE, (_, kind, id) => refInfo(project, kind, id).text);
}

/** Escaped HTML with tokens rendered as spans (`ref-chip` for the editor, `doc-ref` for previews). */
export function resolveHTML(project, body, { chipClass = 'doc-ref', editable = false } = {}) {
  const text = String(body || '');
  let out = ''; let last = 0;
  for (const m of text.matchAll(REF_RE)) {
    out += esc(text.slice(last, m.index));
    const info = refInfo(project, m[1], m[2]);
    out += `<span class="${chipClass}${info.ok ? '' : ' broken'}" data-ref="${m[1]}:${m[2]}" title="${esc(info.title)}"${editable ? ' contenteditable="false"' : ''}>${esc(info.text)}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/**
 * Split a body into blocks: paragraphs, bullet items (lines starting with "- " or "• ") and placement lines.
 * Returns [{ type: 'p' | 'li', text } | { type: 'figure' | 'table', id }]; text still contains tokens.
 */
export function parseBlocks(body) {
  return String(body || '').split(/\n/).map((line) => line.trimEnd()).filter((line) => line.trim())
    .map((line) => {
      const place = PLACE_RE.exec(line);
      if (place) return { type: place[1], id: place[2] };
      return /^\s*[-•*]\s+/.test(line) ? { type: 'li', text: line.replace(/^\s*[-•*]\s+/, '') } : { type: 'p', text: line.trim() };
    });
}

const PLAIN_RE = /\b(Figure|Fig\.|Table|Section|Chapter)\s+(\d+(?:\.\d+)*)\b/g;

/**
 * Find plain-text references ("Figure 3") that match an existing item under the
 * current numbering. Returns [{ index, length, match, kind, id, label, title }].
 */
export function findPlainReferences(project, body) {
  const n = getNumbering(project);
  const text = String(body || '');
  const results = [];
  // Ignore anything that is inside a token.
  const tokenRanges = [...text.matchAll(REF_RE)].map((m) => [m.index, m.index + m[0].length]);
  const figLabel = project.settings.captions.figure.label;
  const tabLabel = project.settings.captions.table.label;
  for (const m of text.matchAll(PLAIN_RE)) {
    if (tokenRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const word = m[1]; const num = m[2];
    let hit = null;
    if (word === 'Figure' || word === 'Fig.' || word === figLabel) {
      for (const [id, info] of n.figures) if (info.number === num) hit = { kind: 'fig', id, title: project.figures.find((f) => f.id === id)?.title };
    } else if (word === 'Table' || word === tabLabel) {
      for (const [id, info] of n.tables) if (info.number === num) hit = { kind: 'tab', id, title: project.tables.find((t) => t.id === id)?.title };
    } else if (word === 'Section') {
      for (const [id, info] of n.sections) if (info.number === num) hit = { kind: 'sec', id, title: info.title };
    } else if (word === 'Chapter') {
      for (const [id, info] of n.chapters) if (info.number === num) hit = { kind: 'ch', id, title: info.title };
    }
    if (hit) results.push({ index: m.index, length: m[0].length, match: m[0], label: m[0], ...hit });
  }
  return results;
}

/** Replace plain references with live tokens. Returns { body, count }. */
export function linkPlainReferences(project, body) {
  const found = findPlainReferences(project, body);
  let text = String(body || '');
  for (const hit of [...found].reverse()) {
    text = text.slice(0, hit.index) + makeRef(hit.kind, hit.id) + text.slice(hit.index + hit.length);
  }
  return { body: text, count: found.length };
}

/** All text containers that may hold references: [{ owner, ownerKind, body, setBody }]. */
export function bodyOwners(project) {
  const owners = [];
  for (const fm of project.frontMatter) owners.push({ id: fm.id, kind: 'front', title: fm.title, body: fm.body || '' });
  for (const ch of project.chapters) {
    owners.push({ id: ch.id, kind: 'chapter', title: ch.title, body: ch.body || '' });
  }
  walkSections(project, (sec) => { owners.push({ id: sec.id, kind: 'section', title: sec.title, body: sec.body || '' }); });
  return owners;
}

/** Every broken reference in the project: [{ ownerId, ownerKind, ownerTitle, kind, id }]. */
export function findBrokenReferences(project) {
  const broken = [];
  for (const owner of bodyOwners(project)) {
    for (const m of owner.body.matchAll(REF_RE)) {
      if (!refInfo(project, m[1], m[2]).ok) broken.push({ ownerId: owner.id, ownerKind: owner.kind, ownerTitle: owner.title, kind: m[1], id: m[2] });
    }
  }
  return broken;
}

/** Where is an item referenced? → [{ ownerId, ownerKind, ownerTitle }] */
export function findUsages(project, kind, id) {
  const token = makeRef(kind, id);
  return bodyOwners(project).filter((o) => o.body.includes(token)).map((o) => ({ ownerId: o.id, ownerKind: o.kind, ownerTitle: o.title }));
}
