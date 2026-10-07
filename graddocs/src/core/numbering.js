// Derived numbering. Nothing here is persisted: chapter/section numbers,
// Figure N / Table N labels and FIG-00N codes are recomputed from document
// order whenever the project changes, so references never go stale.
import { pad } from './utils.js';

const cache = new WeakMap();

/** Called by the store after every mutation. */
export function invalidateNumbering(project) { if (project) cache.delete(project); }

/**
 * getNumbering(project) → {
 *   chapters: Map(id → { id, index, number, label, title }),
 *   sections: Map(id → { id, number, label, depth, chapterId, parentId, title }),
 *   outline:  [{ kind: 'chapter'|'section', id, number, depth, title, chapterId }],
 *   figures:  Map(id → { id, index, number, label, code, chapterId, sectionId, location }),
 *   tables:   Map(id → … same shape),
 *   figureOrder: Figure[],  tableOrder: Table[]
 * }
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
  return { chapters: new Map(), sections: new Map(), outline: [], figures: new Map(), tables: new Map(), figureOrder: [], tableOrder: [] };
}

function computeNumbering(project) {
  const chapters = new Map();
  const sections = new Map();
  const outline = [];
  const position = new Map(); // id → outline index

  project.chapters.forEach((chapter, ci) => {
    const number = String(ci + 1);
    chapters.set(chapter.id, { id: chapter.id, index: ci + 1, number, label: `Chapter ${number}`, title: chapter.title });
    position.set(chapter.id, outline.length);
    outline.push({ kind: 'chapter', id: chapter.id, number, depth: 0, title: chapter.title, chapterId: chapter.id });
    const visit = (list, prefix, depth, parentId) => {
      list.forEach((sec, si) => {
        const num = `${prefix}.${si + 1}`;
        sections.set(sec.id, { id: sec.id, number: num, label: `Section ${num}`, depth, chapterId: chapter.id, parentId, title: sec.title });
        position.set(sec.id, outline.length);
        outline.push({ kind: 'section', id: sec.id, number: num, depth, title: sec.title, chapterId: chapter.id });
        visit(sec.sections || [], num, depth + 1, sec.id);
      });
    };
    visit(chapter.sections || [], number, 1, chapter.id);
  });

  const placeItems = (items, caption, codePrefix) => {
    const keyed = items.map((item, arrayIndex) => {
      const sec = item.sectionId && sections.get(item.sectionId);
      const chapterId = sec ? sec.chapterId : (item.chapterId && chapters.has(item.chapterId) ? item.chapterId : null);
      const sectionId = sec ? item.sectionId : null;
      const pos = sectionId ? position.get(sectionId) : chapterId ? position.get(chapterId) : Number.POSITIVE_INFINITY;
      return { item, arrayIndex, pos, chapterId, sectionId };
    });
    keyed.sort((a, b) => (a.pos - b.pos) || (a.arrayIndex - b.arrayIndex));
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
      ].filter(Boolean).join(' · ') || 'Unassigned';
      map.set(k.item.id, { id: k.item.id, index, number, label, code: `${codePrefix === 'Figure' ? 'FIG' : 'TAB'}-${pad(index)}`, chapterId: k.chapterId, sectionId: k.sectionId, location });
    });
    return { map, order: keyed.map((k) => k.item) };
  };

  const figs = placeItems(project.figures, project.settings?.captions?.figure, 'Figure');
  const tabs = placeItems(project.tables, project.settings?.captions?.table, 'Table');

  return { chapters, sections, outline, figures: figs.map, tables: tabs.map, figureOrder: figs.order, tableOrder: tabs.order };
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
 * items that live in the same chapter/section. Mutates project[collection].
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
