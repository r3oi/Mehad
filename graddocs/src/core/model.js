// Data model: factories, defaults and normalisation for every entity.
// Numbers (Figure 3, Table 2, 1.4.2 …) are never stored; see numbering.js.
import { uid, clone } from './utils.js';
import { t } from '../i18n/index.js';

export const SCHEMA_VERSION = 1;

export const FRONT_MATTER_KINDS = {
  declaration: { title: 'Declaration', hasBody: true },
  acknowledgements: { title: 'Acknowledgements', hasBody: true },
  abstract: { title: 'Abstract', hasBody: true },
  toc: { title: 'Table of Contents', generated: true },
  lot: { title: 'List of Tables', generated: true },
  lof: { title: 'List of Figures', generated: true },
  loa: { title: 'List of Acronyms and Abbreviations', generated: true },
  custom: { title: 'Untitled Page', hasBody: true },
};

export const SECTION_STATUSES = [
  { value: 'todo', label: t('Not started'), weight: 0 },
  { value: 'draft', label: t('Draft'), weight: 0.4 },
  { value: 'review', label: t('In review'), weight: 0.75 },
  { value: 'done', label: t('Done'), weight: 1 },
];

export const DEFAULT_SETTINGS = {
  page: {
    size: 'A4', // A4 | Letter
    orientation: 'portrait', // portrait | landscape
    margins: { top: 2.54, bottom: 2.54, left: 3.0, right: 2.54 }, // centimetres
  },
  typography: {
    fontFamily: 'Times New Roman',
    fontSize: 12,
    lineSpacing: 1.5,
    paragraphSpacing: 6, // pt after paragraph
    justify: true,
    headingSizes: { h1: 18, h2: 16, h3: 14 },
    headingFontFamily: '', // '' = same font as the body text
    firstLineIndent: 0, // cm, first line of every body paragraph
    subheadingItalic: false, // level-3+ headings (1.2.3) in bold italic
  },
  chapterTitle: { style: 'upper', newPage: true }, // upper: "CHAPTER 1: INTRODUCTION" | title: "Chapter 1: Introduction"
  captions: {
    figure: { label: 'Figure', separator: ':', position: 'below', numbering: 'global', align: 'center', labelBold: true, titleBold: false, titleItalic: false },
    table: { label: 'Table', separator: ':', position: 'above', numbering: 'global', align: 'center', labelBold: true, titleBold: false, titleItalic: false },
  },
  figureDefaults: { fontFamily: 'Times New Roman', fontSize: 14, exportScale: 3, transparentBackground: false },
  // includeFrontMatter: list the front-matter pages that come after the TOC (Abstract, List of Figures …) in it.
  // style: 'plain' | 'academic' (chapters bold, front matter and sections in small caps, as many university templates).
  toc: { depth: 3, includeFrontMatter: false, style: 'plain' },
  // classic: name, rules, "Prepared by" / "Supervised by" / academic year.
  // submission: logo, "A project submitted in partial fulfillment …", "by", students, supervisors, month and year.
  titlePage: { layout: 'classic' },
  // Bibliography. style: 'ieee' | 'compact' (Surname I., "Title", … as in many department templates).
  // order: 'citation' (first citation in the text, IEEE) | 'alphabetical' (first author) | 'manual' (list order).
  references: { include: true, title: 'References', style: 'ieee', order: 'citation' },
};

/** Default sentence of the 'submission' title page. */
export const DEFAULT_DEGREE_STATEMENT = 'A project submitted in partial fulfillment of the requirements for the degree of Bachelor in Software Engineering';

const now = () => Date.now();

export function createProject(fields = {}) {
  const ts = now();
  return normalizeProject({
    id: uid('prj'),
    name: 'Untitled Project',
    description: '',
    type: 'Software Engineering Graduation Project',
    university: '',
    college: '',
    department: '',
    supervisor: '',
    coSupervisor: '',
    students: '',
    academicYear: String(new Date().getFullYear()),
    submissionDate: '', // free text for the title page, e.g. "May 2026"
    degreeStatement: '', // '' = DEFAULT_DEGREE_STATEMENT
    logo: '', // data: URL shown at the top of the title page ('' = none)
    createdAt: ts,
    updatedAt: ts,
    frontMatter: defaultFrontMatter(),
    chapters: [],
    figures: [],
    tables: [],
    acronyms: [],
    references: [],
    settings: clone(DEFAULT_SETTINGS),
    activity: [],
    dismissedSuggestions: [],
    ...fields,
  });
}

export function defaultFrontMatter() {
  return ['declaration', 'abstract', 'toc', 'lot', 'lof', 'loa'].map((kind) => createFrontMatterItem(kind));
}

/**
 * Front-matter page. Optional fields: wordLimit (number, 0 = none; shown as a counter, e.g. Abstract ≤ 150 words),
 * signatures (declaration: one signature line per student), signatureNote (text under the signature lines).
 */
export function createFrontMatterItem(kind = 'custom', fields = {}) {
  return { id: uid('fm'), kind, title: FRONT_MATTER_KINDS[kind]?.title || 'Untitled Page', include: true, body: '', ...fields };
}

/**
 * Chapter. `numbered: false` makes an unnumbered chapter (e.g. CONCLUSIONS): no "Chapter N", its sections have no numbers.
 * Chapters and sections may carry a `hint` (writing guidance shown in the editor while the text is empty; never exported).
 */
export function createChapter(fields = {}) {
  return { id: uid('ch'), title: 'Untitled Chapter', body: '', numbered: true, sections: [], ...fields };
}

export function createSection(fields = {}) {
  return { id: uid('sec'), title: 'Untitled Section', body: '', status: 'todo', sections: [], ...fields };
}

export function createDiagram(fields = {}) {
  return { width: 1200, height: 800, background: '#ffffff', elements: [], ...fields };
}

export function createFigure(fields = {}) {
  const ts = now();
  return {
    id: uid('fig'),
    title: 'Untitled Figure',
    type: 'generic',
    chapterId: null,
    sectionId: null,
    description: '',
    diagram: createDiagram(),
    versions: [],
    comments: [],
    createdAt: ts,
    updatedAt: ts,
    ...fields,
  };
}

export function createCell(text = '', fields = {}) { return { text: String(text), ...fields }; }

export function createTable(fields = {}) {
  const ts = now();
  const columns = fields.columns || [{ id: uid('col'), width: 33.34 }, { id: uid('col'), width: 33.33 }, { id: uid('col'), width: 33.33 }];
  return {
    id: uid('tbl'),
    title: 'Untitled Table',
    chapterId: null,
    sectionId: null,
    description: '',
    template: 'generic',
    columns,
    rows: [
      columns.map((_, i) => createCell(`Column ${i + 1}`)),
      columns.map(() => createCell('')),
    ],
    headerRows: 1,
    style: { headerFill: '#D9E2F3', headerTextColor: '#000000', fontSize: 11, zebra: false, borders: 'all' },
    versions: [],
    createdAt: ts,
    updatedAt: ts,
    ...fields,
  };
}

export function createAcronym(fields = {}) {
  return { id: uid('acr'), acronym: '', meaning: '', description: '', createdAt: now(), ...fields };
}

/**
 * Bibliography entry. `authors` / `editors`: one name per line (or separated by ";" or " and "),
 * "First Middle Last" or "Last, First". `custom`: when not blank it is used verbatim instead of the formatted text.
 * type: journal | conference | book | chapter | web | thesis | report | other (see bibliography.js).
 */
export function createReference(fields = {}) {
  return {
    id: uid('ref'), type: 'journal', authors: '', title: '', container: '', editors: '', publisher: '', place: '',
    year: '', month: '', volume: '', issue: '', pages: '', edition: '', doi: '', url: '', accessed: '', note: '',
    custom: '', createdAt: now(), ...fields,
  };
}

export function createComment(fields = {}) {
  return { id: uid('cmt'), elementId: null, text: '', author: 'You', createdAt: now(), resolved: false, ...fields };
}

// ---------------------------------------------------------------------------
// Normalisation: makes imported / older data safe to use.

function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

function normalizeSection(sec) {
  return {
    ...createSection(),
    ...sec,
    id: sec?.id || uid('sec'),
    title: String(sec?.title ?? 'Untitled Section'),
    body: String(sec?.body ?? ''),
    sections: Array.isArray(sec?.sections) ? sec.sections.map(normalizeSection) : [],
  };
}

export function normalizeProject(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid project data.');
  const p = { ...input };
  p.schemaVersion = SCHEMA_VERSION;
  p.id = p.id || uid('prj');
  p.name = String(p.name || 'Untitled Project');
  for (const key of ['description', 'type', 'university', 'college', 'department', 'supervisor', 'coSupervisor', 'students', 'academicYear', 'submissionDate', 'degreeStatement', 'logo']) p[key] = String(p[key] ?? '');
  p.createdAt = Number(p.createdAt) || now();
  p.updatedAt = Number(p.updatedAt) || p.createdAt;
  p.frontMatter = Array.isArray(p.frontMatter) ? p.frontMatter.map((f) => ({ ...createFrontMatterItem(f.kind || 'custom'), ...f })) : defaultFrontMatter();
  p.chapters = Array.isArray(p.chapters) ? p.chapters.map((c) => ({
    ...createChapter(), ...c, id: c.id || uid('ch'), numbered: c.numbered !== false, sections: Array.isArray(c.sections) ? c.sections.map(normalizeSection) : [],
  })) : [];
  p.figures = Array.isArray(p.figures) ? p.figures.map((f) => ({
    ...createFigure(), ...f,
    diagram: { ...createDiagram(), ...(f.diagram || {}), elements: Array.isArray(f.diagram?.elements) ? f.diagram.elements : [] },
    versions: Array.isArray(f.versions) ? f.versions : [],
    comments: Array.isArray(f.comments) ? f.comments : [],
  })) : [];
  p.tables = Array.isArray(p.tables) ? p.tables.map((t) => {
    const table = { ...createTable(), ...t };
    table.columns = Array.isArray(t.columns) && t.columns.length ? t.columns.map((c) => ({ id: c.id || uid('col'), width: Number(c.width) || 20, ...c })) : createTable().columns;
    table.rows = Array.isArray(t.rows) ? t.rows.map((row) => table.columns.map((_, i) => ({ text: '', ...(row?.[i] || {}) }))) : [];
    table.headerRows = Math.max(0, Number(t.headerRows ?? 1));
    table.style = { ...createTable().style, ...(t.style || {}) };
    table.versions = Array.isArray(t.versions) ? t.versions : [];
    return table;
  }) : [];
  p.acronyms = Array.isArray(p.acronyms) ? p.acronyms.filter((a) => a && a.acronym).map((a) => ({ ...createAcronym(), ...a })) : [];
  p.references = Array.isArray(p.references) ? p.references.filter((r) => r && typeof r === 'object').map((r) => {
    const ref = { ...createReference(), ...r, id: r.id || uid('ref') };
    for (const key of Object.keys(createReference())) if (key !== 'createdAt' && typeof ref[key] !== 'string') ref[key] = String(ref[key] ?? '');
    return ref;
  }) : [];
  p.settings = deepMerge(clone(DEFAULT_SETTINGS), p.settings || {});
  p.activity = Array.isArray(p.activity) ? p.activity.slice(0, 60) : [];
  p.dismissedSuggestions = Array.isArray(p.dismissedSuggestions) ? p.dismissedSuggestions : [];
  return p;
}

// ---------------------------------------------------------------------------
// Tree helpers for chapters / sections.

/** Visit every section depth-first. cb(section, { chapter, parent, depth, siblings, index }) */
export function walkSections(project, cb) {
  const visit = (list, chapter, parent, depth) => {
    list.forEach((sec, index) => {
      if (cb(sec, { chapter, parent, depth, siblings: list, index }) === false) return;
      visit(sec.sections || [], chapter, sec, depth + 1);
    });
  };
  for (const chapter of project.chapters) visit(chapter.sections || [], chapter, null, 1);
}

/** Locate a chapter or section by id. Returns { node, kind, chapter, parent, siblings, index } or null. */
export function findNode(project, id) {
  if (!id) return null;
  const chIndex = project.chapters.findIndex((c) => c.id === id);
  if (chIndex >= 0) return { node: project.chapters[chIndex], kind: 'chapter', chapter: project.chapters[chIndex], parent: null, siblings: project.chapters, index: chIndex };
  let found = null;
  walkSections(project, (sec, ctx) => {
    if (found) return false;
    if (sec.id === id) found = { node: sec, kind: 'section', ...ctx };
    return undefined;
  });
  return found;
}

export const findFigure = (project, id) => project?.figures.find((f) => f.id === id) || null;
export const findTable = (project, id) => project?.tables.find((t) => t.id === id) || null;

/** Every section id contained in a chapter (any depth). */
export function sectionIdsOfChapter(chapter) {
  const ids = [];
  const visit = (list) => list.forEach((s) => { ids.push(s.id); visit(s.sections || []); });
  visit(chapter?.sections || []);
  return ids;
}

/** Returns the chapter that contains a section id. */
export function chapterOfSection(project, sectionId) {
  return project.chapters.find((c) => sectionIdsOfChapter(c).includes(sectionId)) || null;
}
