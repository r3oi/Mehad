// Pure tree operations for the chapter / section outline.
// Every function that changes the project is meant to run inside `store.update(...)`.
// Numbers are never stored; these helpers only move nodes around and keep the
// figure/table placements consistent.
import { createSection, createChapter, findNode, walkSections, SECTION_STATUSES } from '../core/model.js';
import { REF_RE, bodyOwners } from '../core/references.js';
import { t, isRTL } from '../i18n/index.js';

/** Deepest allowed section level: chapter → 1.4 (1) → 1.4.2 (2) → 1.4.2.1 (3). */
export const MAX_SECTION_DEPTH = 3;

/** { node, kind, chapter, parent, siblings, index, depth } (depth: chapter 0, top-level section 1). */
export function locate(project, id) {
  const hit = findNode(project, id);
  if (!hit) return null;
  return { ...hit, depth: hit.kind === 'chapter' ? 0 : hit.depth };
}

/** Number of levels in a section subtree (a leaf is 1). */
export function subtreeHeight(section) {
  return 1 + Math.max(0, ...(section.sections || []).map(subtreeHeight));
}

/** Ids of a node and everything below it. */
export function subtreeIds(node) {
  const ids = new Set();
  const visit = (n) => { ids.add(n.id); (n.sections || []).forEach(visit); };
  visit(node);
  return ids;
}

/** Is `id` somewhere below `node`? */
export function containsId(node, id) {
  return (node.sections || []).some((s) => s.id === id || containsId(s, id));
}

/** ids from the chapter down to the direct parent of `id`. */
export function ancestorIds(project, id) {
  const out = [];
  const info = locate(project, id);
  if (!info) return out;
  if (info.kind === 'section') {
    out.push(info.chapter.id);
    const trail = [];
    let cur = info.parent;
    while (cur) { trail.unshift(cur.id); cur = locate(project, cur.id)?.parent; }
    out.push(...trail);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Capability checks (used to enable/disable actions).

export function canMoveUp(project, id) { const i = locate(project, id); return !!i && i.index > 0; }
export function canMoveDown(project, id) { const i = locate(project, id); return !!i && i.index < i.siblings.length - 1; }
export function canIndent(project, id) {
  const i = locate(project, id);
  if (!i || i.kind !== 'section' || i.index === 0) return false;
  return i.depth + 1 + subtreeHeight(i.node) - 1 <= MAX_SECTION_DEPTH;
}
export function canOutdent(project, id) {
  const i = locate(project, id);
  return !!i && i.kind === 'section' && !!i.parent;
}
export function canAddChild(project, id) {
  const i = locate(project, id);
  return !!i && (i.kind === 'chapter' || i.depth < MAX_SECTION_DEPTH);
}

// ---------------------------------------------------------------------------
// Mutations

/** Keep figure/table chapterId in step with the chapter that contains their section. */
export function syncPlacements(project) {
  const chapterOf = new Map();
  for (const ch of project.chapters) {
    const visit = (list) => list.forEach((s) => { chapterOf.set(s.id, ch.id); visit(s.sections || []); });
    visit(ch.sections || []);
  }
  for (const item of [...project.figures, ...project.tables]) {
    if (!item.sectionId) continue;
    if (chapterOf.has(item.sectionId)) item.chapterId = chapterOf.get(item.sectionId);
    else item.sectionId = null; // dangling pointer
  }
}

export function addChapter(project, title = 'Untitled Chapter') {
  const chapter = createChapter({ title });
  project.chapters.push(chapter);
  return chapter;
}

/** Add a section under a chapter or section. Returns the new section, or null when the depth limit is hit. */
export function addSection(project, parentId, title = 'Untitled Section') {
  const parent = locate(project, parentId);
  if (!parent || !canAddChild(project, parentId)) return null;
  const section = createSection({ title });
  (parent.node.sections ||= []).push(section);
  return section;
}

/** Numbered chapter ("Chapter 3") or unnumbered one (e.g. CONCLUSIONS: no "Chapter N", its sections have no numbers). */
export function setChapterNumbered(project, id, numbered) {
  const chapter = project.chapters.find((c) => c.id === id);
  if (!chapter) return false;
  chapter.numbered = !!numbered;
  return true;
}

/** Activity-log sentence (stored in English; translated for display by the dashboard). */
export const numberingActivity = (title, numbered) => (numbered ? `Numbered chapter “${title}”` : `Made chapter “${title}” unnumbered`);

export function moveBy(project, id, delta) {
  const i = locate(project, id);
  if (!i) return false;
  const j = i.index + delta;
  if (j < 0 || j >= i.siblings.length) return false;
  [i.siblings[i.index], i.siblings[j]] = [i.siblings[j], i.siblings[i.index]];
  return true;
}

/** Become the last child of the previous sibling. */
export function indent(project, id) {
  if (!canIndent(project, id)) return false;
  const i = locate(project, id);
  const prev = i.siblings[i.index - 1];
  i.siblings.splice(i.index, 1);
  (prev.sections ||= []).push(i.node);
  syncPlacements(project);
  return true;
}

/** Move to just after the parent. */
export function outdent(project, id) {
  if (!canOutdent(project, id)) return false;
  const i = locate(project, id);
  const p = locate(project, i.parent.id);
  i.siblings.splice(i.index, 1);
  p.siblings.splice(p.index + 1, 0, i.node);
  syncPlacements(project);
  return true;
}

/**
 * Can `id` be dropped relative to `targetId`?
 * position: 'before' | 'after' | 'inside' (last child) | 'first' (first child)
 * → { ok, reason? }
 */
export function validateMove(project, id, targetId, position) {
  const bad = (reason) => ({ ok: false, reason });
  if (!id || !targetId || id === targetId) return bad('self');
  const src = locate(project, id);
  const dst = locate(project, targetId);
  if (!src || !dst) return bad('missing');
  const beside = position === 'before' || position === 'after';

  if (src.kind === 'chapter') {
    if (dst.kind !== 'chapter' || !beside) return bad('chapters only move among chapters');
    const noop = (position === 'after' && dst.index === src.index - 1) || (position === 'before' && dst.index === src.index + 1);
    return noop ? bad('noop') : { ok: true };
  }

  if (containsId(src.node, targetId)) return bad('descendant');
  let newDepth;
  if (dst.kind === 'chapter') {
    if (beside) return bad('sections cannot become chapters');
    newDepth = 1;
  } else newDepth = beside ? dst.depth : dst.depth + 1;
  if (newDepth + subtreeHeight(src.node) - 1 > MAX_SECTION_DEPTH) return bad('depth');

  // Dropping where it already is.
  if (beside && dst.siblings === src.siblings) {
    if ((position === 'after' && dst.index === src.index - 1) || (position === 'before' && dst.index === src.index + 1)) return bad('noop');
  }
  if (position === 'inside' && src.siblings === dst.node.sections && src.index === src.siblings.length - 1) return bad('noop');
  if (position === 'first' && src.siblings === dst.node.sections && src.index === 0) return bad('noop');
  return { ok: true };
}

/** Drag-and-drop style move. Returns true when something moved. */
export function moveNode(project, id, targetId, position) {
  if (!validateMove(project, id, targetId, position).ok) return false;
  const src = locate(project, id);
  src.siblings.splice(src.index, 1);
  const dst = locate(project, targetId);
  if (position === 'inside') (dst.node.sections ||= []).push(src.node);
  else if (position === 'first') (dst.node.sections ||= []).unshift(src.node);
  else dst.siblings.splice(dst.index + (position === 'after' ? 1 : 0), 0, src.node);
  syncPlacements(project);
  return true;
}

// ---------------------------------------------------------------------------
// Deleting

function placedIn(project, info, ids) {
  const inChapter = (item) => info.kind === 'chapter' && item.chapterId === info.node.id;
  const inSection = (item) => item.sectionId && ids.has(item.sectionId);
  return {
    figures: project.figures.filter((f) => inChapter(f) || inSection(f)),
    tables: project.tables.filter((t) => inChapter(t) || inSection(t)),
  };
}

/** What deleting `id` would affect: { kind, subsections, figures, tables, brokenRefs, destination } */
export function deletionImpact(project, id) {
  const info = locate(project, id);
  if (!info) return null;
  const ids = subtreeIds(info.node);
  const placed = placedIn(project, info, ids);
  let brokenRefs = 0;
  for (const owner of bodyOwners(project)) {
    if (ids.has(owner.id)) continue;
    for (const m of owner.body.matchAll(REF_RE)) if ((m[1] === 'sec' || m[1] === 'ch') && ids.has(m[2])) brokenRefs += 1;
  }
  return {
    kind: info.kind,
    subsections: ids.size - 1,
    figures: placed.figures.length,
    tables: placed.tables.length,
    brokenRefs,
    parentId: info.kind === 'section' ? (info.parent ? info.parent.id : info.chapter.id) : null,
  };
}

/** Delete a chapter/section; its figures and tables move to the parent (chapter → unassigned). */
export function deleteNode(project, id) {
  const info = locate(project, id);
  if (!info) return null;
  const ids = subtreeIds(info.node);
  const impact = deletionImpact(project, id);
  const placed = placedIn(project, info, ids);
  for (const item of [...placed.figures, ...placed.tables]) {
    if (info.kind === 'chapter') { item.chapterId = null; item.sectionId = null; } else {
      item.chapterId = info.chapter.id;
      item.sectionId = info.parent ? info.parent.id : null;
    }
  }
  info.siblings.splice(info.index, 1);
  return impact;
}

// ---------------------------------------------------------------------------
// Statistics

/** Counts of figures/tables per section (direct) and per chapter (whole chapter). */
export function placementCounts(numbering) {
  const section = new Map();
  const chapter = new Map();
  const bump = (map, key, field) => {
    if (!key) return;
    const e = map.get(key) || { figures: 0, tables: 0 };
    e[field] += 1;
    map.set(key, e);
  };
  for (const info of numbering.figures.values()) { bump(section, info.sectionId, 'figures'); bump(chapter, info.chapterId, 'figures'); }
  for (const info of numbering.tables.values()) { bump(section, info.sectionId, 'tables'); bump(chapter, info.chapterId, 'tables'); }
  return { section, chapter };
}

const WEIGHT = Object.fromEntries(SECTION_STATUSES.map((s) => [s.value, s.weight]));

/** Weighted completion of a list of sections (recursive). → { total, done, percent } */
export function progressOf(sections) {
  let total = 0; let weighted = 0; let done = 0;
  const visit = (list) => list.forEach((s) => {
    total += 1; weighted += WEIGHT[s.status] ?? 0; if (s.status === 'done') done += 1;
    visit(s.sections || []);
  });
  visit(sections || []);
  return { total, done, percent: total ? Math.round((weighted / total) * 100) : 0 };
}

export function projectProgress(project) {
  let total = 0; let weighted = 0; let done = 0;
  walkSections(project, (s) => { total += 1; weighted += WEIGHT[s.status] ?? 0; if (s.status === 'done') done += 1; });
  return { total, done, percent: total ? Math.round((weighted / total) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// i18n helpers shared by the structure views and the body editor.

/** "3 figures" / "1 figure" — grammar-safe in Arabic ("الأشكال: 3", "شكل واحد"). Report text is never passed through here. */
export function countLabel(n, kind) {
  const one = n === 1;
  switch (kind) {
    case 'chapter': return one ? t('1 chapter') : t('{n} chapters', { n });
    case 'section': return one ? t('1 section') : t('{n} sections', { n });
    case 'subsection': return one ? t('1 subsection') : t('{n} subsections', { n });
    case 'figure': return one ? t('1 figure') : t('{n} figures', { n });
    case 'table': return one ? t('1 table') : t('{n} tables', { n });
    case 'acronym': return one ? t('1 acronym') : t('{n} acronyms', { n });
    case 'word': return one ? t('1 word') : t('{n} words', { n });
    case 'reference': return one ? t('1 reference') : t('{n} references', { n });
    default: return String(n);
  }
}

/** Words in a text (tokens already resolved to their labels). */
export const countWords = (text) => (String(text).trim() ? String(text).trim().split(/\s+/).length : 0);

/** "Chapter 2: Planning Phase", or just "Conclusions" for an unnumbered chapter. */
export function chapterName(numbering, chapter) {
  const info = numbering.chapters.get(chapter.id);
  return info && info.numbered ? `${info.label}: ${chapter.title}` : chapter.title;
}

/** "3 of 12 sections done" for the chapter progress line. */
export function progressText(pr) {
  if (!pr.total) return t('No sections yet');
  return pr.total === 1
    ? t('{done} of 1 section done', { done: pr.done })
    : t('{done} of {n} sections done', { done: pr.done, n: pr.total });
}

/** Wrap user text embedded in a translated plain-text sentence so it keeps its own direction (Arabic mode only). */
export const isolate = (text) => (isRTL ? `\u2068${text}\u2069` : String(text));

/** List separator: "," in English, "،" in Arabic. */
export const LIST_SEP = isRTL ? '، ' : ', ';

/** Arrow keys that mean "go deeper" (expand / indent) and "go back" (collapse / outdent) for the current direction. */
export const KEY_FORWARD = isRTL ? 'ArrowLeft' : 'ArrowRight';
export const KEY_BACK = isRTL ? 'ArrowRight' : 'ArrowLeft';
export const ARROW_FORWARD = isRTL ? '←' : '→';
export const ARROW_BACK = isRTL ? '→' : '←';

/** Keep a short LTR snippet (shortcut hints such as "Alt ↑") intact inside right-to-left text. */
export const ltr = (text) => (isRTL ? `⁦${text}⁩` : String(text));
