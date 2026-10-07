// Derived numbering. Nothing here is persisted: chapter/section numbers,
// Figure N / Table N labels and FIG-00N codes are recomputed from document
// order whenever the project changes, so references never go stale.
import { pad } from './utils.js';
import { findNode } from './model.js';
import { placementsIn } from './references.js';
import { t } from '../i18n/index.js';

const cache = new WeakMap();

/** Called by the store after every mutation. */
export function invalidateNumbering(project) { if (project) cache.delete(project); }

/**
 * getNumbering(project) → {
 *   chapters: Map(id → { id, index, number, label, title }),
 *   sections: Map(id → { id, number, label, depth, chapterId, parentId, title }),
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
  return { chapters: new Map(), sections: new Map(), outline: [], figures: new Map(), tables: new Map(), figureOrder: [], tableOrder: [], brokenPlacements: [] };
}

function computeNumbering(project) {
  const chapters = new Map();
  const sections = new Map();
  const outline = [];
  const position = new Map(); // id → outline index
  const owners = []; // chapter / section bodies in document order: { id, kind, title, chapterId, sectionId, pos, body }

  project.chapters.forEach((chapter, ci) => {
    const number = String(ci + 1);
    chapters.set(chapter.id, { id: chapter.id, index: ci + 1, number, label: `Chapter ${number}`, title: chapter.title });
    position.set(chapter.id, outline.length);
    owners.push({ id: chapter.id, kind: 'chapter', title: chapter.title, chapterId: chapter.id, sectionId: null, pos: outline.length, body: chapter.body });
    outline.push({ kind: 'chapter', id: chapter.id, number, depth: 0, title: chapter.title, chapterId: chapter.id });
    const visit = (list, prefix, depth, parentId) => {
      list.forEach((sec, si) => {
        const num = `${prefix}.${si + 1}`;
        sections.set(sec.id, { id: sec.id, number: num, label: `Section ${num}`, depth, chapterId: chapter.id, parentId, title: sec.title });
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
      if (caption?.numbering === 'chapter' && k.chapterId) {
        const n = (perChapter.get(k.chapterId) || 0) + 1;
        perChapter.set(k.chapterId, n);
        number = `${chapters.get(k.chapterId).number}.${n}`;
      }
      const label = `${caption?.label || codePrefix} ${number}`;
      const location = [
        k.chapterId ? chapters.get(k.chapterId).label : null,
        k.sectionId ? `Section ${sections.get(k.sectionId).number}` : null,
      ].filter(Boolean).join(' · ') || t('Unassigned');
      const placement = k.claim ? { ownerId: k.claim.ownerId, ownerKind: k.claim.ownerKind, line: k.claim.line } : null;
      map.set(k.item.id, { id: k.item.id, index, number, label, code: `${codePrefix === 'Figure' ? 'FIG' : 'TAB'}-${pad(index)}`, chapterId: k.chapterId, sectionId: k.sectionId, location, placed: !!placement, placement });
    });
    return { map, order: keyed.map((k) => k.item) };
  };

  const figs = placeItems(project.figures, project.settings?.captions?.figure, 'Figure', 'figure');
  const tabs = placeItems(project.tables, project.settings?.captions?.table, 'Table', 'table');

  return { chapters, sections, outline, figures: figs.map, tables: tabs.map, figureOrder: figs.order, tableOrder: tabs.order, brokenPlacements };
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
  const text = `Chapter ${n?.number ?? '?'}: ${chapter.title}`;
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
  if (!ch) return 'Unassigned';
  return sec ? `${ch.label} · ${sec.number} ${sec.title}` : `${ch.label} · ${ch.title}`;
}
