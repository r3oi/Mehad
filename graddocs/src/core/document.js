// Linear document model shared by Document Preview and the Word (.docx) export.
// It decides *what* goes where; renderers decide how it looks.
import { getNumbering, captionText, chapterHeading } from './numbering.js';
import { parseBlocks } from './references.js';
import { FRONT_MATTER_KINDS } from './model.js';
import { compareText } from './utils.js';

export const sortAcronyms = (list) => [...list].sort((a, b) => compareText(a.acronym, b.acronym));

/**
 * buildDocument(project) → {
 *   titlePage: { name, type, description, university, college, department, supervisor, students[], academicYear },
 *   front:   [{ id, kind, title, generated, blocks: [{type:'p'|'li', text}] }]   (only included items, in order)
 *   toc:     [{ id, kind: 'chapter'|'section', level: 1..4, number, title, text }]
 *   figures: [{ id, figure, label, number, code, caption, chapterId, sectionId, placed }]   (document order)
 *   tables:  [{ id, table,  label, number, code, caption, chapterId, sectionId, placed }]
 *   acronyms:[{ id, acronym, meaning, description }]           (alphabetical)
 *   body:    blocks in reading order:
 *     { type: 'chapter', id, number, title, heading }
 *     { type: 'heading', id, level: 2|3|4, number, title, text }
 *     { type: 'paragraph' | 'bullet', text, ownerId }          (text may contain {{ref:…}} tokens)
 *     { type: 'figure', id, figure, label, number, caption }
 *     { type: 'table',  id, table,  label, number, caption }
 * }
 *
 * A figure/table whose placement line ({{figure:id}} / {{table:id}} alone on a line) is in a chapter/section body is
 * emitted exactly there, between the paragraphs. The ones merely assigned to a chapter/section follow the text of
 * that chapter/section (figures first, then tables). Every figure/table is emitted exactly once.
 */
export function buildDocument(project) {
  const n = getNumbering(project);
  const tocDepth = project.settings.toc?.depth ?? 3;

  const figures = n.figureOrder.map((figure) => {
    const info = n.figures.get(figure.id);
    return { id: figure.id, figure, label: info.label, number: info.number, code: info.code, caption: captionText(project, 'figure', figure), chapterId: info.chapterId, sectionId: info.sectionId, placed: info.placed };
  });
  const tables = n.tableOrder.map((table) => {
    const info = n.tables.get(table.id);
    return { id: table.id, table, label: info.label, number: info.number, code: info.code, caption: captionText(project, 'table', table), chapterId: info.chapterId, sectionId: info.sectionId, placed: info.placed };
  });

  const figureById = new Map(figures.map((f) => [f.id, f]));
  const tableById = new Map(tables.map((tb) => [tb.id, tb]));
  // Items assigned to a chapter/section that are not placed in its text (placed ones were emitted in the text).
  const itemsAt = (list, chapterId, sectionId) => list.filter((x) => !x.placed && x.sectionId === sectionId && (sectionId || x.chapterId === chapterId));

  const toc = [];
  const body = [];
  const emitted = new Set(); // 'figure:id' / 'table:id' already placed in a body
  const pushBody = (ownerId, text) => {
    for (const b of parseBlocks(text)) {
      if (b.type === 'figure' || b.type === 'table') {
        // Only the item's effective placement counts (first line in document order); anything else is ignored.
        const entry = (b.type === 'figure' ? figureById : tableById).get(b.id);
        const info = (b.type === 'figure' ? n.figures : n.tables).get(b.id);
        const key = `${b.type}:${b.id}`;
        if (!entry || info?.placement?.ownerId !== ownerId || emitted.has(key)) continue;
        emitted.add(key);
        body.push({ type: b.type, ...entry });
      } else body.push({ type: b.type === 'li' ? 'bullet' : 'paragraph', text: b.text, ownerId });
    }
  };
  // A section's figures follow its text, then its tables (each in numbering order).
  const pushItemsOrdered = (chapterId, sectionId) => {
    for (const f of itemsAt(figures, chapterId, sectionId)) body.push({ type: 'figure', ...f });
    for (const t of itemsAt(tables, chapterId, sectionId)) body.push({ type: 'table', ...t });
  };

  for (const chapter of project.chapters) {
    const info = n.chapters.get(chapter.id);
    toc.push({ id: chapter.id, kind: 'chapter', level: 1, number: info.number, title: chapter.title, text: chapterHeading(project, chapter) });
    body.push({ type: 'chapter', id: chapter.id, number: info.number, title: chapter.title, heading: chapterHeading(project, chapter) });
    pushBody(chapter.id, chapter.body);
    pushItemsOrdered(chapter.id, null);
    const visit = (list) => {
      for (const sec of list) {
        const s = n.sections.get(sec.id);
        const level = s.depth + 1; // 2 = section, 3 = subsection, 4 = sub-subsection
        if (level <= tocDepth) toc.push({ id: sec.id, kind: 'section', level, number: s.number, title: sec.title, text: `${s.number} ${sec.title}` });
        body.push({ type: 'heading', id: sec.id, level, number: s.number, title: sec.title, text: `${s.number} ${sec.title}` });
        pushBody(sec.id, sec.body);
        pushItemsOrdered(chapter.id, sec.id);
        visit(sec.sections || []);
      }
    };
    visit(chapter.sections || []);
  }

  const unassigned = [
    ...figures.filter((f) => !f.chapterId).map((f) => ({ type: 'figure', ...f })),
    ...tables.filter((t) => !t.chapterId).map((t) => ({ type: 'table', ...t })),
  ];
  if (unassigned.length) {
    body.push({ type: 'chapter', id: '__unassigned', number: '', title: 'Unassigned Figures and Tables', heading: 'UNASSIGNED FIGURES AND TABLES', unassigned: true });
    body.push(...unassigned);
  }

  const front = project.frontMatter.filter((f) => f.include !== false).map((f) => ({
    // Placement lines only mean something in chapter / section text; front-matter pages show text only.
    id: f.id, kind: f.kind, title: f.title, generated: !!FRONT_MATTER_KINDS[f.kind]?.generated, blocks: parseBlocks(f.body).filter((b) => b.type === 'p' || b.type === 'li'),
  }));

  return {
    titlePage: {
      name: project.name, type: project.type, description: project.description, university: project.university,
      college: project.college, department: project.department, supervisor: project.supervisor,
      students: String(project.students || '').split(/\n|,/).map((s) => s.trim()).filter(Boolean),
      academicYear: project.academicYear,
    },
    front, toc, figures, tables, acronyms: sortAcronyms(project.acronyms), body,
  };
}
