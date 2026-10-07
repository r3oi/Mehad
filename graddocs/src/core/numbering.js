// Derived numbering. Nothing here is persisted: chapter/section numbers,
// Figure N / Table N labels and FIG-00N codes are recomputed from document
// order whenever the project changes, so references never go stale.
import { pad } from './utils.js';
import { findNode } from './model.js';
import { placementsIn, REF_RE } from './references.js';
import { referenceSortKey } from './bibliography.js';
import { t } from '../i18n/index.js';

const cache = new WeakMap();

/** Called by the store after every mutation. */
export function invalidateNumbering(project) { if (project) cache.delete(project); }

/**
 * getNumbering(project) → {
 *   chapters: Map(id → { id, index, number, label, title, numbered }),
 *   sections: Map(id → { id, number, label, depth, chapterId, parentId, title }),
 *   references: Map(id → { id, index, number, label: '[3]', cited: boolean }),  referenceOrder: Reference[],
 *   outline:  [{ kind: 'chapter'|'section', id, number, depth, title, chapterId }],
 *   figures:  Map(id → { id, index, number, label, code, chapterId, sectionId, location, placed, placement }),
 *   tables:   Map(id → … same shape),
 *   figureOrder: Figure[],  tableOrder: Table[],
 *   brokenPlacements: [{ ownerId, ownerKind, ownerTitle, kind, id, line, reason: 'missing' | 'duplicate' }]
 * }
 *
 * Order: chapter → sections depth-first. Inside a chapter/section body the items whose placement line
 * ({{figure:id}} / {{table:id}} alone on a line) is in that body come first, in line order; items that are merely
 * assigned to that chapter/section (chapterId/sectionId) follow, in array order. A placement line wins over
 * chapterId/sectionId: chapterId, sectionId and location of a placed item are where its line is
 * (`placed: true`, `placement: { ownerId, ownerKind, line }`). If an item is placed twice only the first line
 * (in document order) counts; lines whose item does not exist are ignored. Both are listed in brokenPlacements.
 *
 * Unnumbered chapters (`numbered: false`, e.g. CONCLUSIONS) get number '' and label = their title; they do not
 * consume a chapter number, and their sections have number '' too (label = title).
 *
 * References ([1], [2] …) follow settings.references.order: 'citation' = order of the first {{ref:cite:id}} token
 * (front matter, then chapters/sections in document order) with never-cited references after them in list order;
 * 'alphabetical' = first author's surname; 'manual' = list order.
 */
export function getNumbering(project) {
  if (!project) return emptyNumbering();
  const hit = cache.get(project);
  if (hit) return hit;
  const result = computeNumbering(project);
  cache.set(project, result);
  return result;
}

function emptyNumbering() {
  return { chapters: new Map(), sections: new Map(), outline: [], figures: new Map(), tables: new Map(), figureOrder: [], tableOrder: [], brokenPlacements: [], references: new Map(), referenceOrder: [] };
}

function computeNumbering(project) {
  const chapters = new Map();
  const sections = new Map();
  const outline = [];
  const position = new Map(); // id → outline index
  const owners = []; // chapter / section bodies in document order: { id, kind, title, chapterId, sectionId, pos, body }

  let chapterCount = 0;
  project.chapters.forEach((chapter) => {
    const numbered = chapter.numbered !== false;
    if (numbered) chapterCount += 1;
    const number = numbered ? String(chapterCount) : '';
    chapters.set(chapter.id, { id: chapter.id, index: numbered ? chapterCount : 0, number, label: numbered ? `Chapter ${number}` : chapter.title, title: chapter.title, numbered });
    position.set(chapter.id, outline.length);
    owners.push({ id: chapter.id, kind: 'chapter', title: chapter.title, chapterId: chapter.id, sectionId: null, pos: outline.length, body: chapter.body });
    outline.push({ kind: 'chapter', id: chapter.id, number, depth: 0, title: chapter.title, chapterId: chapter.id });
    const visit = (list, prefix, depth, parentId) => {
      list.forEach((sec, si) => {
        const num = numbered ? `${prefix}.${si + 1}` : '';
        sections.set(sec.id, { id: sec.id, number: num, label: numbered ? `Section ${num}` : sec.title, depth, chapterId: chapter.id, parentId, title: sec.title });
        position.set(sec.id, outline.length);
        owners.push({ id: sec.id, kind: 'section', title: sec.title, chapterId: chapter.id, sectionId: sec.id, pos: outline.length, body: sec.body });
        outline.push({ kind: 'section', id: sec.id, number: num, depth, title: sec.title, chapterId: chapter.id });
        visit(sec.sections || [], num, depth + 1, sec.id);
      });
    };
    visit(chapter.sections || [], number, 1, chapter.id);
  });

  // Placement lines: every body is scanned exactly once. The first placement of an item (document order) wins.
  const exists = { figure: new Set(project.figures.map((f) => f.id)), table: new Set(project.tables.map((tb) => tb.id)) };
  const claims = { figure: new Map(), table: new Map() }; // item id → { ownerId, ownerKind, chapterId, sectionId, pos, line, seq }
  const brokenPlacements = [];
  let seq = 0;
  for (const owner of owners) {
    for (const place of placementsIn(owner.body)) {
      const broken = (reason) => brokenPlacements.push({ ownerId: owner.id, ownerKind: owner.kind, ownerTitle: owner.title, kind: place.kind, id: place.id, line: place.line, reason });
      if (!exists[place.kind].has(place.id)) broken('missing');
      else if (claims[place.kind].has(place.id)) broken('duplicate');
      else claims[place.kind].set(place.id, { ownerId: owner.id, ownerKind: owner.kind, chapterId: owner.chapterId, sectionId: owner.sectionId, pos: owner.pos, line: place.line, seq: seq++ });
    }
  }

  const placeItems = (items, caption, codePrefix, kind) => {
    const keyed = items.map((item, arrayIndex) => {
      const claim = claims[kind].get(item.id);
      // Placed: the item lives where its line is, and comes before the unplaced items of that body, in line order.
      if (claim) return { item, arrayIndex, pos: claim.pos, group: 0, order: claim.seq, chapterId: claim.chapterId, sectionId: claim.sectionId, claim };
      const sec = item.sectionId && sections.get(item.sectionId);
      const chapterId = sec ? sec.chapterId : (item.chapterId && chapters.has(item.chapterId) ? item.chapterId : null);
      const sectionId = sec ? item.sectionId : null;
      const pos = sectionId ? position.get(sectionId) : chapterId ? position.get(chapterId) : Number.POSITIVE_INFINITY;
      return { item, arrayIndex, pos, group: 1, order: arrayIndex, chapterId, sectionId, claim: null };
    });
    keyed.sort((a, b) => (a.pos - b.pos) || (a.group - b.group) || (a.order - b.order));
    const map = new Map();
    const perChapter = new Map();
    keyed.forEach((k, i) => {
      const index = i + 1;
      let number = String(index);
      if (caption?.numbering === 'chapter' && k.chapterId && chapters.get(k.chapterId).numbered) {
        const n = (perChapter.get(k.chapterId) || 0) + 1;
        perChapter.set(k.chapterId, n);
        number = `${chapters.get(k.chapterId).number}.${n}`;
      }
      const label = `${caption?.label || codePrefix} ${number}`;
      const location = [
        k.chapterId ? chapters.get(k.chapterId).label : null,
        k.sectionId ? sections.get(k.sectionId).label : null,
      ].filter(Boolean).join(' · ') || t('Unassigned');
      const placement = k.claim ? { ownerId: k.claim.ownerId, ownerKind: k.claim.ownerKind, line: k.claim.line } : null;
      map.set(k.item.id, { id: k.item.id, index, number, label, code: `${codePrefix === 'Figure' ? 'FIG' : 'TAB'}-${pad(index)}`, chapterId: k.chapterId, sectionId: k.sectionId, location, placed: !!placement, placement });
    });
    return { map, order: keyed.map((k) => k.item) };
  };

  const figs = placeItems(project.figures, project.settings?.captions?.figure, 'Figure', 'figure');
  const tabs = placeItems(project.tables, project.settings?.captions?.table, 'Table', 'table');
  const refs = numberReferences(project, owners);

  return { chapters, sections, outline, figures: figs.map, tables: tabs.map, figureOrder: figs.order, tableOrder: tabs.order, brokenPlacements, references: refs.map, referenceOrder: refs.order };
}

function numberReferences(project, owners) {
  const list = Array.isArray(project.references) ? project.references : [];
  const map = new Map();
  if (!list.length) return { map, order: [] };
  const byId = new Map(list.map((r) => [r.id, r]));
  const firstCite = new Map(); // id → sequence of its first citation
  const bodies = [...(project.frontMatter || []).map((f) => f.body), ...owners.map((o) => o.body)];
  for (const body of bodies) {
    const text = String(body ?? '');
    if (!text.includes('{{ref:cite:')) continue;
    for (const m of text.matchAll(REF_RE)) if (m[1] === 'cite' && byId.has(m[2]) && !firstCite.has(m[2])) firstCite.set(m[2], firstCite.size);
  }
  const mode = project.settings?.references?.order || 'citation';
  let order;
  if (mode === 'alphabetical') {
    order = list.map((r, i) => ({ r, i, key: referenceSortKey(r) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i)).map((x) => x.r);
  } else if (mode === 'manual') order = [...list];
  else {
    const cited = list.filter((r) => firstCite.has(r.id)).sort((a, b) => firstCite.get(a.id) - firstCite.get(b.id));
    order = [...cited, ...list.filter((r) => !firstCite.has(r.id))];
  }
  order.forEach((r, i) => map.set(r.id, { id: r.id, index: i + 1, number: String(i + 1), label: `[${i + 1}]`, cited: firstCite.has(r.id) }));
  return { map, order };
}

/** "Figure 3: Feature Fishbone Diagram" using the project caption settings. */
export function captionText(project, kind, item) {
  const n = getNumbering(project)[kind === 'figure' ? 'figures' : 'tables'].get(item.id);
  const cfg = project.settings.captions[kind];
  const sep = cfg.separator === ' —' ? ' —' : cfg.separator;
  return `${n ? n.label : `${cfg.label} ?`}${sep} ${item.title}`;
}

/** Chapter heading text according to settings, e.g. "CHAPTER 1: INTRODUCTION". */
export function chapterHeading(project, chapter) {
  const n = getNumbering(project).chapters.get(chapter.id);
  const text = chapter.numbered === false ? chapter.title : `Chapter ${n?.number ?? '?'}: ${chapter.title}`;
  return project.settings.chapterTitle.style === 'upper' ? text.toUpperCase() : text;
}

/**
 * Move a figure/table one step up or down in document order, but only among
 * items that live in the same chapter/section. Mutates project[collection] — or,
 * for two items placed in the text of the same body, swaps their placement lines.
 * An item placed in the text cannot be moved past one that is not (placed items always come first).
 * Returns true if something moved.
 */
export function moveInDocumentOrder(project, collection, id, direction) {
  const numbering = getNumbering(project);
  const order = collection === 'figures' ? numbering.figureOrder : numbering.tableOrder;
  const info = collection === 'figures' ? numbering.figures : numbering.tables;
  const idx = order.findIndex((item) => item.id === id);
  const neighbour = order[idx + (direction < 0 ? -1 : 1)];
  if (idx < 0 || !neighbour) return false;
  const a = info.get(id); const b = info.get(neighbour.id);
  if (a.sectionId !== b.sectionId || a.chapterId !== b.chapterId) return false;
  if (a.placed !== b.placed) return false;
  if (a.placed) {
    // Both are placed in this body (same chapter/section ⇒ same owner): swap their lines.
    const owner = findNode(project, a.placement.ownerId)?.node;
    if (!owner || a.placement.ownerId !== b.placement.ownerId) return false;
    const lines = String(owner.body || '').split('\n');
    const la = a.placement.line; const lb = b.placement.line;
    [lines[la], lines[lb]] = [lines[lb], lines[la]];
    owner.body = lines.join('\n');
    invalidateNumbering(project);
    return true;
  }
  const list = project[collection];
  const ia = list.findIndex((x) => x.id === id);
  const ib = list.findIndex((x) => x.id === neighbour.id);
  [list[ia], list[ib]] = [list[ib], list[ia]];
  invalidateNumbering(project);
  return true;
}

/** Location label for chapter/section pickers: "Chapter 1 · 1.4.2 Proposed System Features". */
export function locationLabel(project, chapterId, sectionId) {
  const n = getNumbering(project);
  const sec = sectionId && n.sections.get(sectionId);
  const ch = n.chapters.get(sec ? sec.chapterId : chapterId);
  if (!ch) return t('Unassigned');
  if (!ch.numbered) return sec ? `${ch.title} · ${sec.title}` : ch.title;
  return sec ? `${ch.label} · ${sec.number} ${sec.title}` : `${ch.label} · ${ch.title}`;
}
