// Demo project created on first launch: "Meyar".
import { createProject, createChapter, createSection, createFigure, createTable, createAcronym, createCell, createComment } from '../core/model.js';
import { uid } from '../core/utils.js';
import { makeRef } from '../core/references.js';
import {
  fishboneDiagram, useCaseTemplate, flowchartTemplate, architectureTemplate, sequenceTemplate, erdTemplate,
} from '../figures/templates/index.js';
import { addVersion } from '../figures/versions.js';

const FONT = { fontFamily: 'Times New Roman', fontSize: 14 };
const DAY = 86400000;

const sec = (title, fields = {}) => createSection({ title, ...fields });

function table(title, header, rows, widths, fields = {}) {
  const columns = widths.map((width) => ({ id: uid('col'), width }));
  return createTable({
    title,
    columns,
    rows: [header.map((h) => createCell(h, { bold: true })), ...rows.map((r) => r.map((c) => createCell(c)))],
    headerRows: 1,
    ...fields,
  });
}

/** Fishbone feature diagram with a realistic revision history (v1 → v4). */
function fishboneFigure(now) {
  const cat = (key, name, causes) => ({ key, name, causes });
  const users = cat('users', 'User Management', ['Registration & Login', 'Roles & Permissions', 'Profile Settings']);
  const workspace = cat('workspace', 'Secure Data Workspace', ['Encrypted Storage', 'Dataset Upload', 'Access Control']);
  const evaluation = cat('evaluation', 'Evaluation Module', ['Scoring Rules', 'Benchmarks']);
  const reports = cat('reports', 'Reporting & Visualization', ['Dashboards', 'Export to PDF', 'Charts']);
  const analysis = (name) => cat('analysis', name, ['Data Cleaning', 'Statistical Analysis', 'AI Insights']);
  const head = 'Meyar Platform Features';

  const figure = createFigure({ title: 'Feature Fishbone Diagram', type: 'fishbone', description: 'Breakdown of the proposed system features of Meyar.', createdAt: now - 21 * DAY });
  const steps = [
    { cats: [users, workspace, evaluation, reports], label: 'Initial diagram', at: now - 21 * DAY },
    { cats: [users, workspace, analysis('Data Analysis'), evaluation, reports], label: 'Added Data Analysis', at: now - 14 * DAY, kind: 'revision', note: 'Supervisor asked to show the analysis feature.', requestedBy: 'Dr. Ahmed D. Alharthi' },
    { cats: [users, workspace, analysis('Data Analysis'), reports], label: 'Removed Evaluation Module', at: now - 9 * DAY, kind: 'revision', note: 'Evaluation moved out of scope for this release.', requestedBy: 'Dr. Ahmed D. Alharthi' },
    { cats: [users, workspace, analysis('Data & Analysis Management'), reports], label: 'Updated labels', at: now - 2 * DAY, kind: 'revision', note: 'Renamed to match the features table.', requestedBy: 'Dr. Ahmed D. Alharthi' },
  ];
  for (const step of steps) {
    figure.diagram = fishboneDiagram(FONT, { head, categories: step.cats });
    addVersion(figure, { label: step.label, kind: step.kind || 'version', note: step.note || '', requestedBy: step.requestedBy || '', at: step.at, force: true });
  }
  figure.updatedAt = now - 2 * DAY;
  figure.comments.push(createComment({ elementId: 'fb-cat-analysis', text: 'Doctor requested changing this label to match Table 1 (“Data & Analysis Management”).', author: 'You', createdAt: now - 3 * DAY, resolved: true }));
  figure.comments.push(createComment({ elementId: 'fb-head', text: 'Check whether the head should say “Meyar” only.', author: 'You', createdAt: now - DAY }));
  return figure;
}

function simpleFigure(title, type, diagram, now, ageDays, description = '') {
  const figure = createFigure({ title, type, description, diagram, createdAt: now - ageDays * DAY, updatedAt: now - ageDays * DAY });
  addVersion(figure, { at: now - ageDays * DAY, force: true });
  return figure;
}

export function createDemoProject() {
  const now = Date.now();

  // ----- Figures & tables (ids are needed for cross references) -----------
  const figFishbone = fishboneFigure(now);
  const figUseCase = simpleFigure('Use Case Diagram', 'usecase', useCaseTemplate(FONT, { system: 'Meyar', actors: ['User', 'Administrator'] }), now, 6, 'Main interactions between users and Meyar.');
  const figLogin = simpleFigure('Login Process Flowchart', 'flowchart', flowchartTemplate(FONT), now, 5, 'Authentication flow for registered users.');
  const figArch = simpleFigure('System Architecture', 'architecture', architectureTemplate(FONT, { name: 'Meyar' }), now, 4, 'Three-tier architecture of Meyar.');
  const figSeq = simpleFigure('Login Sequence Diagram', 'sequence', sequenceTemplate(FONT), now, 3);
  const figErd = simpleFigure('Entity Relationship Diagram', 'erd', erdTemplate(FONT), now, 3, 'Logical data model.');

  const tFeatures = table('Proposed System Features', ['Feature ID', 'Feature Name', 'Description'], [
    ['F-1', 'User Management', 'Registration, secure login and role-based permissions for users and administrators.'],
    ['F-2', 'Secure Data Workspace', 'A private, access-controlled workspace for uploading and organising datasets.'],
    ['F-3', 'Data & Analysis Management', 'Cleaning, exploring and analysing datasets, with saved analysis sessions.'],
    ['F-4', 'Reporting & Visualization', 'Interactive dashboards, charts and exportable reports.'],
  ], [16, 28, 56], { template: 'feature', createdAt: now - 20 * DAY, updatedAt: now - 2 * DAY });
  const tCompare = table('System Features Comparison', ['Feature', 'Meyar', 'System A', 'System B', 'System C'], [
    ['Secure data workspace', '✓', '✓', '✗', '✗'],
    ['Role-based access control', '✓', '✗', '✓', '✗'],
    ['Built-in data analysis', '✓', '✓', '✗', '✓'],
    ['Exportable reports', '✓', '✗', '✓', '✓'],
    ['Arabic interface', '✓', '✗', '✗', '✓'],
  ], [36, 16, 16, 16, 16], { template: 'comparison', createdAt: now - 12 * DAY, updatedAt: now - 7 * DAY });
  tCompare.rows.slice(1).forEach((row) => row.slice(1).forEach((c) => { c.align = 'center'; }));
  tCompare.rows[0].slice(1).forEach((c) => { c.align = 'center'; });
  const tLimits = table('Limitations of Existing Projects', ['Existing Project', 'Limitation', 'How Meyar Addresses It'], [
    ['System A', 'No access control on shared datasets.', 'Role-based permissions per workspace.'],
    ['System B', 'Analysis requires external tools.', 'Built-in analysis and visualization.'],
    ['System C', 'Reports cannot be exported.', 'One-click export to PDF and Word.'],
  ], [22, 39, 39], { template: 'comparison', createdAt: now - 11 * DAY, updatedAt: now - 6 * DAY });

  // ----- Structure -------------------------------------------------------
  const s1_1 = sec('Introduction', { status: 'done', body: `Meyar is a web-based platform that gives students and researchers a secure place to store, analyse and report on their data. This chapter introduces the problem domain, the problem statement and the proposed system, and outlines the methodology followed throughout the project.\nThe remainder of the report is organised as described in ${'{{SEC_LAYOUT}}'}.` });
  const s1_2 = sec('Problem Domain', { status: 'done', body: 'Data-driven projects increasingly rely on Artificial Intelligence (AI) and shared datasets, yet many teams still exchange files over e-mail and analyse them with disconnected tools.' });
  const s1_3 = sec('Problem Statement', { status: 'review', body: 'Existing solutions either lack secure access control or require several external tools to analyse and report on data, which slows teams down and exposes sensitive information.' });
  const s1_4_1 = sec('Aims and Objectives', { status: 'review', body: 'The aim of this project is to design and implement Meyar. The objectives are:\n- Provide secure, role-based access to project data.\n- Offer built-in data analysis and visualization.\n- Generate reports that can be exported for submission.' });
  const s1_4_2 = sec('Proposed System Features', { status: 'draft', body: `The main features of Meyar are summarised in ${makeRef('tab', tFeatures.id)} and illustrated in ${makeRef('fig', figFishbone.id)}. Each feature maps to one module of the system architecture presented in ${'{{SEC_ARCH}}'}.` });
  const s1_4 = sec('Proposed System', { status: 'review', body: 'Meyar combines a secure data workspace with analysis and reporting tools in one platform.', sections: [s1_4_1, s1_4_2] });
  const s1_8 = sec('Report Layout');
  const ch1 = createChapter({ title: 'Introduction', sections: [s1_1, s1_2, s1_3, s1_4, sec('Project Methodology', { status: 'draft', body: 'The project follows an iterative Software Development Life Cycle (SDLC) with two-week sprints.' }), sec('Gantt Chart'), sec('Resource Requirement'), s1_8] });

  const s2_4 = sec('Comparison of Existing Systems', { status: 'draft', body: `${makeRef('tab', tCompare.id)} compares the features of Meyar with three existing systems.` });
  const s2_5 = sec('Limitations of Existing Projects', { status: 'draft', body: `The limitations identified in the reviewed projects are listed in ${makeRef('tab', tLimits.id)}.` });
  const ch2 = createChapter({ title: 'Background / Existing Work', sections: [
    sec('Introduction', { status: 'draft' }),
    sec('Background', { status: 'draft', body: 'Modern platforms protect data with Role-Based Access Control (RBAC) and expose features to clients through an Application Programming Interface (API).' }),
    sec('Existing Systems'), s2_4, s2_5, sec('Summary'),
  ] });

  const s3_4 = sec('Use Case Diagram', { body: `${makeRef('fig', figUseCase.id)} shows the main use cases of the system.` });
  const s3_5 = sec('Activity Diagrams', { body: `The login process is illustrated in ${makeRef('fig', figLogin.id)}.` });
  const ch3 = createChapter({ title: 'System Analysis', sections: [sec('Introduction'), sec('Functional Requirements'), sec('Non-Functional Requirements'), s3_4, s3_5] });

  const s4_2 = sec('System Architecture', { body: `${makeRef('fig', figArch.id)} presents the three-tier architecture of Meyar.` });
  const ch4 = createChapter({ title: 'System Design', sections: [sec('Introduction'), s4_2, sec('Sequence Diagrams', { body: `${makeRef('fig', figSeq.id)} shows the interaction between components during login.` }), sec('Database Design', { body: `The logical data model is shown in ${makeRef('fig', figErd.id)}.` })] });
  const ch5 = createChapter({ title: 'Implementation', sections: [sec('Introduction'), sec('Development Environment'), sec('Implementation Details')] });
  const ch6 = createChapter({ title: 'Testing and Conclusion', sections: [sec('Testing Strategy'), sec('Test Cases'), sec('Conclusion'), sec('Future Work')] });

  // Resolve placeholder section references now that ids exist.
  s1_1.body = s1_1.body.replace('{{SEC_LAYOUT}}', makeRef('sec', s1_8.id));
  s1_4_2.body = s1_4_2.body.replace('{{SEC_ARCH}}', makeRef('sec', s4_2.id));
  s1_8.body = `Chapter 2 reviews existing work. Chapter 3 analyses the requirements and ${makeRef('ch', ch4.id)} presents the system design. Chapters 5 and 6 cover implementation, testing and conclusions.`;
  s1_8.status = 'draft';

  // Place figures and tables in sections.
  figFishbone.sectionId = s1_4_2.id; figFishbone.chapterId = ch1.id;
  figUseCase.sectionId = s3_4.id; figUseCase.chapterId = ch3.id;
  figLogin.sectionId = s3_5.id; figLogin.chapterId = ch3.id;
  figArch.sectionId = s4_2.id; figArch.chapterId = ch4.id;
  figSeq.sectionId = ch4.sections[2].id; figSeq.chapterId = ch4.id;
  figErd.sectionId = ch4.sections[3].id; figErd.chapterId = ch4.id;
  tFeatures.sectionId = s1_4_2.id; tFeatures.chapterId = ch1.id;
  tCompare.sectionId = s2_4.id; tCompare.chapterId = ch2.id;
  tLimits.sectionId = s2_5.id; tLimits.chapterId = ch2.id;

  const project = createProject({
    name: 'Meyar',
    description: 'A secure platform for storing, analysing and reporting on project data.',
    type: 'Software Engineering Graduation Project',
    university: '',
    college: '',
    department: 'Software Engineering',
    supervisor: 'Dr. Ahmed D. Alharthi',
    students: '',
    academicYear: '2026',
    createdAt: now - 30 * DAY,
    chapters: [ch1, ch2, ch3, ch4, ch5, ch6],
    figures: [figFishbone, figUseCase, figLogin, figArch, figSeq, figErd],
    tables: [tFeatures, tCompare, tLimits],
    acronyms: [
      ['AI', 'Artificial Intelligence'],
      ['API', 'Application Programming Interface'],
      ['DBMS', 'Database Management System'],
      ['ERD', 'Entity Relationship Diagram'],
      ['SDLC', 'Software Development Life Cycle'],
      ['UI', 'User Interface'],
      ['UML', 'Unified Modeling Language'],
    ].map(([acronym, meaning]) => createAcronym({ acronym, meaning })),
  });
  project.frontMatter.find((f) => f.kind === 'declaration').body = 'We hereby declare that this report is our own work and has not been submitted for any other degree.';
  project.frontMatter.find((f) => f.kind === 'abstract').body = 'Meyar is a web platform that combines a secure data workspace with built-in analysis and reporting. This report documents its analysis, design, implementation and testing.';
  project.activity = [
    { id: uid('act'), at: now - 2 * DAY, kind: 'revision', text: 'Saved revision #3 of Feature Fishbone Diagram', targetId: figFishbone.id },
    { id: uid('act'), at: now - 6 * DAY, kind: 'edit', text: 'Updated System Features Comparison', targetId: tCompare.id },
    { id: uid('act'), at: now - 30 * DAY, kind: 'create', text: 'Created project' },
  ];
  return project;
}
