// Linear document model shared by Document Preview and the Word (.docx) export.
// It decides *what* goes where; renderers decide how it looks.
import { getNumbering, captionText, chapterHeading } from './numbering.js';
import { parseBlocks } from './references.js';
import { FRONT_MATTER_KINDS, DEFAULT_DEGREE_STATEMENT } from './model.js';
import { compareText } from './utils.js';
import { formatReferenceRuns } from './bibliography.js';

export const sortAcronyms = (list) => [...list].sort((a, b) => compareText(a.acronym, b.acronym));

/**
 * buildDocument(project) → {
 *   titlePage: { layout: 'classic'|'submission', name, type, description, university, college, department, supervisor,
 *                coSupervisor, students[] (lines as typed, e.g. "Ahmed Ali (443001234)"), studentNames[] (IDs stripped),
 *                academicYear, submissionDate, degreeStatement, logo (university, data URL or ''),
 *                projectLogo (the project's own logo, shown above the title; data URL or '') },
 *   front:   [{ id, kind, title, generated, blocks: [{type:'p'|'li', text}], wordLimit, signatures, signatureNote }]
 *            (only included items, in order; `signatures` → render one signature line per titlePage.studentNames)
 *   toc:     [{ id, kind: 'front'|'chapter'|'section'|'references', level: 1..4, number, title, text }]
 *            'front' entries (settings.toc.includeFrontMatter) are the included front-matter pages except the TOC itself;
 *            number is '' for front matter, unnumbered chapters and their sections, and the References page.
 *   references: { include, title, style, entries: [{ id, ref, number, label: '[1]', runs: [{text, italic}], text }] }
 *            The References page comes after the last chapter (and after the unassigned items) when include && entries.length.
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
    body.push({ type: 'chapter', id: chapter.id, number: info.number, title: chapter.title, heading: chapterHeading(project, chapter), numbered: info.numbered });
    pushBody(chapter.id, chapter.body);
    pushItemsOrdered(chapter.id, null);
    const visit = (list) => {
      for (const sec of list) {
        const s = n.sections.get(sec.id);
        const level = s.depth + 1; // 2 = section, 3 = subsection, 4 = sub-subsection
        const text = s.number ? `${s.number} ${sec.title}` : sec.title;
        if (level <= tocDepth) toc.push({ id: sec.id, kind: 'section', level, number: s.number, title: sec.title, text });
        body.push({ type: 'heading', id: sec.id, level, number: s.number, title: sec.title, text });
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
    wordLimit: Number(f.wordLimit) || 0, signatures: !!f.signatures, signatureNote: String(f.signatureNote ?? ''),
  }));

  if (project.settings.toc?.includeFrontMatter) {
    const entries = front.filter((f) => f.kind !== 'toc').map((f) => ({ id: f.id, kind: 'front', level: 1, number: '', title: f.title, text: f.title }));
    toc.unshift(...entries);
  }

  const refSettings = project.settings.references || {};
  const style = refSettings.style || 'ieee';
  const entries = n.referenceOrder.map((ref) => {
    const info = n.references.get(ref.id);
    const runs = formatReferenceRuns(ref, style);
    return { id: ref.id, ref, number: info.number, label: info.label, runs, text: runs.map((r) => r.text).join('') };
  });
  const references = { include: refSettings.include !== false, title: refSettings.title || 'References', style, entries };
  if (references.include && entries.length) toc.push({ id: '__references', kind: 'references', level: 1, number: '', title: references.title, text: references.title });

  const students = studentLines(project.students);
  return {
    titlePage: {
      layout: project.settings.titlePage?.layout === 'submission' ? 'submission' : 'classic',
      name: project.name, type: project.type, description: project.description, university: project.university,
      college: project.college, department: project.department, supervisor: project.supervisor,
      coSupervisor: project.coSupervisor || '',
      students, studentNames: students.map(studentName),
      academicYear: project.academicYear, submissionDate: project.submissionDate || '',
      degreeStatement: project.degreeStatement || DEFAULT_DEGREE_STATEMENT, logo: project.logo || '', projectLogo: project.projectLogo || '',
    },
    front, toc, figures, tables, acronyms: sortAcronyms(project.acronyms), body, references,
  };
}

/** Students field → one entry per line (or comma-separated when written on one line). */
export function studentLines(text) {
  const raw = String(text || '');
  return (raw.includes('\n') ? raw.split('\n') : raw.split(',')).map((s) => s.trim()).filter(Boolean);
}

/** "Ahmed Ali Alharbi (443001234)" / "Ahmed Ali Alharbi - 443001234" → "Ahmed Ali Alharbi". */
export const studentName = (line) => String(line || '').replace(/\s*[([][^)\]]*[)\]]\s*$/, '').replace(/\s*[-–—|:]\s*\d[\d\s]*$/, '').trim();
