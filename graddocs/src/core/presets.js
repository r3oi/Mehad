// Report templates ("presets"): a ready structure (front matter, chapters, sections with writing hints) plus the
// formatting a university asks for. Content (titles, hints, declaration text) is document content, so it stays
// English whatever the interface language. Pure data + functions that run inside store.update / createProject.
import { createChapter, createSection, createFrontMatterItem, DEFAULT_DEGREE_STATEMENT } from './model.js';
import { clone } from './utils.js';
import { invalidateNumbering } from './numbering.js';

// ---------------------------------------------------------------------------
// Umm Al-Qura University — College of Computing — Software Engineering — Graduation Project 1 report template.

const UQU_FRONT = [
  { kind: 'declaration', title: 'Declaration', signatures: true, signatureNote: 'Note: sign across your name', autoBody: true,
    hint: 'Declares that the project is your original work and has not been submitted elsewhere. Each student signs across their name.' },
  { kind: 'abstract', title: 'ABSTRACT', wordLimit: 150,
    hint: 'A summary of the project (150 words or less): Introduction (brief background and problem statement), Objectives (main goals), Motivation (why the project is needed and how it differs from others), Users (who will use the product), Results (key findings or outcomes, if any) and Conclusion (main takeaways and significance).' },
  { kind: 'acknowledgements', title: 'ACKNOWLEDGMENT',
    hint: 'A statement of gratitude for assistance in accomplishing the project. It may mention the people the project members want to thank for their support (usually parents, friends, instructors).' },
  { kind: 'toc', title: 'CONTENT' },
  { kind: 'lot', title: 'LIST OF TABLES' },
  { kind: 'lof', title: 'LIST OF FIGURES' },
  { kind: 'loa', title: 'LIST OF ACRONYMS AND ABBREVIATIONS' },
];

// [title, hint, children?]
const UQU_CHAPTERS = [
  ['Introduction', 'This chapter comprises the background of the project, the reasons for taking it, the problems addressed by the project and the expected outcomes. Provide the background needed to establish the context, highlight the motivation and significance, state the problem crisply, then the scope (with any limitations or exclusions) and the specific objectives. A roadmap of the report concludes the chapter.', [
    ['Overview', 'A general review or summary of the project: the master blueprint for the project as a whole.'],
    ['Project Motivation', 'What are the reasons behind your choice to develop this project? Why is your project important? What is the new idea proposed by this project?'],
    ['Problem Statement', 'The issues addressed by this project and the conditions to be improved upon: the gap between the current (problem) state and the desired (goal) state of a process or product.'],
    ['Project Aim and Objectives', 'The overall purposes of the project, clearly and concisely defined. Objectives are what you plan to achieve by the end of the project: attainable, time-bound, specific and measurable. Answer: Q1. What is the goal that this project wants to achieve? Q2. How can this project achieve this goal?'],
    ['Related Existing Systems', 'A survey of existing systems or works related to your project, and how your project is distinguished from them (a comparison table works well).'],
  ]],
  ['Planning Phase', '', [
    ['Scope of the Project', 'The boundaries of the project: what it is going to accomplish (Context Diagram). Explain the boundaries, specified features and functions, external entities (stakeholders and other systems in the environment), the responsibilities of each team member and how completed work will be verified and approved.'],
    ['Project Risks and Product Risks', 'Uncertain events or conditions that, if they occur, have a positive or negative effect on the project objectives. Identify, evaluate and plan how to prevent or mitigate each risk (a risk table works well).'],
    ['Project Schedule', 'A timetable with the start and end dates and the milestones that must be met for the project to be completed on time. You must present it as a GANTT chart.'],
    ['Project Software and Hardware Requirements', 'The prerequisite software and hardware of this project: development tools, external software and cloud services, hardware equipment, etc.'],
  ]],
  ['Requirement Engineering and Analysis', '', [
    ['Used Techniques for Requirements Collection', 'The techniques you used to elicit (gather, collect) requirements, with a sample of each. First identify the stakeholders\' needs, then document these needs and requirements.'],
    ['Functional Requirements & Modelling', 'A Functional Requirement (FR) describes a service that the software must offer: the inputs to the system, its behavior and its outputs.', [
      ['List of System Functions (Features)', 'List all features of your system.'],
      ['Use Case Diagram', 'Draw all use cases using a UML use case diagram.'],
      ['Use Cases: Description & Details', 'Document each use case of the use case diagram: mainly its main flow and alternative flows (one use case description table per use case).'],
    ]],
    ['Nonfunctional Requirements: Quality & Constraints', 'Nonfunctional Requirements (NFRs) define system attributes such as security, reliability, performance, maintainability, scalability and usability. They also serve as constraints or restrictions on the design of the system.'],
  ]],
  ['System Architecture & Design', '', [
    ['Software Architecture', 'Describe the software architecture with any type of model, for example UML component diagrams showing the subsystems and their interactions.'],
    ['Software Detailed Design', '', [
      ['Use Cases Internal Interactions as Sequence Diagrams', 'A UML sequence (or communication) diagram for each use case of the requirements chapter. The diagrams must show whether each communication is synchronous or asynchronous. Explain your diagrams as needed.'],
      ['Class Diagram', 'The UML class diagram, including attributes and methods, consistent with the work above. Explain your diagram as needed.'],
      ['Data Storage Organization', 'A class diagram (or ERD) showing the data structure in your database.'],
    ]],
    ['User Interface Prototyping', 'Explain the already implemented parts of the system and provide snapshots of the graphical user interface screens (Project 1 only).'],
  ]],
];

const UQU_CONCLUSIONS = ['Conclusions', 'Closes the document with a summary of the study, including the problems found and the proposed solution. Most importantly, recommend to the readers the benefits of pursuing the project based on your analysis.'];

/** Formatting measured from the template: US Letter, 1.5" binding margin, Times New Roman 12 double-spaced, Arial headings. */
const UQU_SETTINGS = {
  page: { size: 'Letter', orientation: 'portrait', margins: { top: 2.54, bottom: 2.54, left: 3.81, right: 2.54 } },
  typography: {
    fontFamily: 'Times New Roman', fontSize: 12, lineSpacing: 2, paragraphSpacing: 0, justify: true,
    headingSizes: { h1: 16, h2: 14, h3: 12 }, headingFontFamily: 'Arial', firstLineIndent: 1.27, subheadingItalic: true,
  },
  chapterTitle: { style: 'upper', newPage: true },
  captions: {
    figure: { label: 'Figure', separator: ':', position: 'below', numbering: 'global', align: 'left', labelBold: true, titleBold: true, titleItalic: false },
    table: { label: 'Table', separator: ':', position: 'above', numbering: 'global', align: 'left', labelBold: true, titleBold: true, titleItalic: false },
  },
  toc: { depth: 3, includeFrontMatter: true, style: 'academic' },
  titlePage: { layout: 'submission' },
  references: { include: true, title: 'REFERENCES', style: 'compact', order: 'alphabetical' },
};

export const PRESETS = [
  {
    id: 'uqu-swe-gp1',
    name: 'Umm Al-Qura University — Software Engineering — Graduation Project 1',
    short: 'UQU – SWE GP1',
    description: 'Declaration, Abstract (≤ 150 words), Acknowledgment, Content, lists; 4 chapters (Introduction, Planning Phase, Requirement Engineering and Analysis, System Architecture & Design), Conclusions and References, with the department formatting.',
    fields: { university: 'Umm Al-Qura University', college: 'College of Computing', department: 'Software Engineering Department', type: 'Software Engineering Graduation Project 1' },
    front: UQU_FRONT, chapters: UQU_CHAPTERS, closing: [UQU_CONCLUSIONS], settings: UQU_SETTINGS,
  },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

// ---------------------------------------------------------------------------

/** "Bachelor in Software Engineering" from "… requirements for the degree of Bachelor in Software Engineering". */
export function degreeName(project) {
  const statement = String(project?.degreeStatement || DEFAULT_DEGREE_STATEMENT);
  const m = /degree\s+of\s+(.+?)\.?$/i.exec(statement.trim());
  return m ? m[1].trim() : 'Bachelor in Software Engineering';
}

/** Declaration text built from the project details (two paragraphs separated by a blank line). */
export function declarationText(project) {
  const where = [project?.department, project?.college, project?.university].map((s) => String(s || '').trim()).filter(Boolean).join(', ');
  return `This is to declare that the project entitled “${String(project?.name || 'Project Title').trim()}” is an original work done by the undersigned, in partial fulfillment of the requirements for the degree “${degreeName(project)}”${where ? ` at ${where}` : ''}.\n\n`
    + 'All the analysis, design and system development have been accomplished by the undersigned. Moreover, this project has not been submitted to any other college or university.';
}

function buildSection([title, hint, children]) {
  return createSection({ title, ...(hint ? { hint } : {}), sections: (children || []).map(buildSection) });
}

function buildChapter([title, hint, children], extra = {}) {
  return createChapter({ title, ...(hint ? { hint } : {}), sections: (children || []).map(buildSection), ...extra });
}

function frontItem(spec, project) {
  const { autoBody, kind, ...fields } = spec;
  return createFrontMatterItem(kind, { ...fields, body: autoBody ? declarationText(project) : '' });
}

/**
 * Fields for store.createProject(...) that create a project from a preset. `fields` are the details typed in the
 * New Project dialog (name, students …); they win over the preset defaults (university, college …).
 */
export function presetProjectFields(presetId, fields = {}) {
  const preset = presetById(presetId);
  if (!preset) return { ...fields };
  const details = { ...preset.fields, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v != null)) };
  return {
    ...details,
    frontMatter: preset.front.map((spec) => frontItem(spec, details)),
    chapters: [...preset.chapters.map((c) => buildChapter(c)), ...preset.closing.map((c) => buildChapter(c, { numbered: false }))],
    settings: clone(preset.settings),
    preset: preset.id,
  };
}

function mergeSettings(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      mergeSettings(target[k], v);
    } else target[k] = v;
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
/** Same title ignoring case, punctuation, "&"/"and" and a plural "s" ("Conclusion" = "Conclusions"). */
const sameTitle = (a, b) => { const x = norm(a); const y = norm(b); return x === y || x.replace(/s$/, '') === y.replace(/s$/, ''); };

/**
 * Apply a preset's formatting to an existing project (run inside store.update). Never deletes anything:
 *  - settings (page, typography, captions, TOC, title page, references) are set to the preset's;
 *  - front-matter pages of the preset are added when missing, renamed, given their options (word limit, signatures)
 *    and put in the preset order (other pages keep their relative order after them); an empty declaration is filled;
 *  - chapters whose title matches an unnumbered preset chapter (e.g. Conclusions) become unnumbered.
 * Returns { added: number of front-matter pages added }.
 */
export function applyPresetFormatting(project, presetId) {
  const preset = presetById(presetId);
  if (!preset) return { added: 0 };
  mergeSettings(project.settings, clone(preset.settings));
  if (!project.preset) project.preset = preset.id;
  let added = 0;
  const used = new Set();
  const ordered = preset.front.map((spec) => {
    let item = project.frontMatter.find((f) => f.kind === spec.kind && !used.has(f.id));
    if (!item) { item = frontItem(spec, project); added += 1; } else {
      const { autoBody, kind, hint, ...fields } = spec;
      Object.assign(item, fields, { include: true });
      if (hint && !item.hint) item.hint = hint;
      if (autoBody && !String(item.body || '').trim()) item.body = declarationText(project);
    }
    used.add(item.id);
    return item;
  });
  project.frontMatter = [...ordered, ...project.frontMatter.filter((f) => !used.has(f.id))];
  for (const ch of project.chapters) if (preset.closing.some(([title]) => sameTitle(title, ch.title))) ch.numbered = false;
  invalidateNumbering(project);
  return { added };
}

/**
 * Add the preset's chapters and sections that are missing (matched by title, ignoring case and punctuation; run inside
 * store.update). Existing chapters, sections and text are never removed or reordered; hints are added where missing.
 * New numbered chapters go before the first trailing unnumbered chapter, closing chapters (Conclusions) at the end.
 * Returns { chapters, sections } = how many were added.
 */
export function mergePresetStructure(project, presetId) {
  const preset = presetById(presetId);
  if (!preset) return { chapters: 0, sections: 0 };
  let chapters = 0; let sections = 0;
  const mergeSections = (list, specs) => {
    for (const spec of specs) {
      const [title, hint, children] = spec;
      let sec = list.find((s) => sameTitle(s.title, title));
      if (!sec) { sec = buildSection(spec); list.push(sec); sections += 1 + countSections(sec.sections); continue; }
      if (hint && !sec.hint) sec.hint = hint;
      if (!Array.isArray(sec.sections)) sec.sections = [];
      mergeSections(sec.sections, children || []);
    }
  };
  const insertAt = () => {
    let i = project.chapters.length;
    while (i > 0 && project.chapters[i - 1].numbered === false) i -= 1;
    return i;
  };
  for (const spec of preset.chapters) {
    const ch = project.chapters.find((c) => sameTitle(c.title, spec[0]));
    if (!ch) {
      const chapter = buildChapter(spec);
      project.chapters.splice(insertAt(), 0, chapter);
      chapters += 1; sections += countSections(chapter.sections);
      continue;
    }
    if (spec[1] && !ch.hint) ch.hint = spec[1];
    mergeSections(ch.sections, spec[2] || []);
  }
  for (const spec of preset.closing) {
    const ch = project.chapters.find((c) => sameTitle(c.title, spec[0]));
    if (!ch) { project.chapters.push(buildChapter(spec, { numbered: false })); chapters += 1; } else {
      ch.numbered = false;
      if (spec[1] && !ch.hint) ch.hint = spec[1];
    }
  }
  invalidateNumbering(project);
  return { chapters, sections };
}

function countSections(list) {
  return (list || []).reduce((n, s) => n + 1 + countSections(s.sections), 0);
}
