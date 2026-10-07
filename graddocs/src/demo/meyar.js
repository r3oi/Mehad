// Demo project created on first launch: "Meyar", written to the Umm Al-Qura University (SWE Graduation Project 1)
// template: front matter, four chapters with writing hints, Conclusions and References.
import { createProject, createFigure, createTable, createAcronym, createCell, createComment, createReference } from '../core/model.js';
import { presetProjectFields, declarationText } from '../core/presets.js';
import { uid } from '../core/utils.js';
import { makeRef } from '../core/references.js';
import {
  fishboneDiagram, useCaseTemplate, flowchartTemplate, architectureTemplate, sequenceTemplate, erdTemplate, classTemplate, timelineTemplate,
} from '../figures/templates/index.js';
import { addVersion } from '../figures/versions.js';

const FONT = { fontFamily: 'Times New Roman', fontSize: 14 };
const DAY = 86400000;

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

  // ----- Structure: the UQU template (ids are needed for cross references) ---
  const fields = presetProjectFields('uqu-swe-gp1', {
    name: 'Meyar',
    description: 'A secure platform for storing, analysing and reporting on project data.',
    supervisor: 'Dr. Ahmed D. Alharthi',
    coSupervisor: 'Dr. Noura A. Alqahtani',
    academicYear: '2026',
    submissionDate: 'May 2026',
    students: 'Sara Khalid Alotaibi (443001234)\nReem Fahad Alzahrani (443005678)\nLama Saleh Alghamdi (443009012)',
    createdAt: now - 30 * DAY,
  });
  // `at('3.2.1')` finds a section by its number in the template, `chap('3')` a chapter. A section that is missing
  // (the template changed) gets a throw-away stand-in, so the demo can never break the first launch.
  const chap = (number) => fields.chapters[Number(String(number).split('.')[0]) - 1] || { id: null, body: '' };
  const at = (number) => {
    let node = chap(number);
    for (const i of String(number).split('.').slice(1)) node = node?.sections?.[Number(i) - 1];
    return node || { id: null, body: '' };
  };
  const write = (number, body, status = 'draft') => { const node = at(number); node.body = body; node.status = status; };
  const place = (item, number) => { item.sectionId = at(number).id; item.chapterId = chap(number).id; };

  // ----- Bibliography ------------------------------------------------------
  const refSommerville = createReference({ type: 'book', authors: 'Ian Sommerville', title: 'Software Engineering', edition: '10th', publisher: 'Pearson', place: 'Harlow, UK', year: '2015' });
  const refRbac = createReference({
    type: 'journal', authors: 'David F. Ferraiolo; Ravi Sandhu; Serban Gavrila; D. Richard Kuhn; Ramaswamy Chandramouli',
    title: 'Proposed NIST standard for role-based access control', container: 'ACM Transactions on Information and System Security', volume: '4', issue: '3', pages: '224–274', month: 'Aug', year: '2001',
  });
  const refOwasp = createReference({ type: 'web', authors: '{OWASP Foundation}', title: 'OWASP Top Ten', container: 'OWASP', year: '2021', url: 'https://owasp.org/www-project-top-ten/', accessed: 'Mar. 3, 2026' });
  const refUml = createReference({
    type: 'report', authors: '{Object Management Group}', title: 'OMG Unified Modeling Language (OMG UML), Version 2.5.1', container: 'Object Management Group',
    note: 'Standard formal/17-12-05', month: 'Dec', year: '2017', url: 'https://www.omg.org/spec/UML/2.5.1/',
  });
  const cite = (ref) => makeRef('cite', ref.id);

  // ----- Figures & tables ----------------------------------------------------
  const figFishbone = fishboneFigure(now);
  const figGantt = simpleFigure('Project Schedule (Gantt Chart)', 'timeline', timelineTemplate(FONT, {
    months: ['Feb', 'Mar', 'Apr', 'May'],
    tasks: [['Project Proposal', 0, 0.6], ['Requirements Analysis', 0.4, 1.2], ['System Design', 1.4, 1.6], ['UI Prototyping', 2.4, 1], ['Report Writing', 0.5, 3.2], ['Final Presentation', 3.3, 0.7]],
  }), now, 8, 'Planned schedule of Graduation Project 1.');
  const figUseCase = simpleFigure('Use Case Diagram', 'usecase', useCaseTemplate(FONT, { system: 'Meyar', actors: ['User', 'Administrator'] }), now, 6, 'Main interactions between users and Meyar.');
  const figLogin = simpleFigure('Login Process Flowchart', 'flowchart', flowchartTemplate(FONT), now, 5, 'Authentication flow for registered users.');
  const figArch = simpleFigure('System Architecture', 'architecture', architectureTemplate(FONT, { name: 'Meyar' }), now, 4, 'Three-tier architecture of Meyar.');
  const figSeq = simpleFigure('Login Sequence Diagram', 'sequence', sequenceTemplate(FONT), now, 3);
  const figClass = simpleFigure('Class Diagram', 'class', classTemplate(FONT), now, 3, 'Main classes of Meyar and their relations.');
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
  const tRisks = table('Project and Product Risks', ['Risk ID', 'Risk Description', 'Type', 'Probability', 'Impact', 'Mitigation Strategy'], [
    ['R-01', 'A team member becomes unavailable during exams, delaying tasks.', 'Project', 'Medium', 'High', 'Share knowledge between members and keep a buffer week in the schedule.'],
    ['R-02', 'Requirements change late after supervisor feedback.', 'Project', 'High', 'Medium', 'Review the requirements with the supervisor every two weeks and freeze them before design.'],
    ['R-03', 'Large datasets make the analysis module slow.', 'Product', 'Medium', 'High', 'Process datasets in the background and cache intermediate results.'],
  ], [8, 27, 10, 11, 9, 35], { template: 'risks', createdAt: now - 10 * DAY, updatedAt: now - 5 * DAY });
  tRisks.rows.forEach((row) => [0, 2, 3, 4].forEach((i) => { row[i].align = 'center'; }));
  const tUseCase = table('Use Case Description: Log In', ['Item', 'Description'], [
    ['Use Case ID', 'UC-02'],
    ['Use Case Name', 'Log In'],
    ['Actor(s)', 'User (primary), Administrator (secondary)'],
    ['Description', 'A registered user signs in to reach their private workspace.'],
    ['Preconditions', 'The user has a verified account.'],
    ['Postconditions', 'The user is signed in and sees the workspace dashboard.'],
    ['Main Flow', '1. The user opens the log-in page.\n2. The user enters the e-mail address and password.\n3. The system validates the credentials.\n4. The system opens the workspace dashboard.'],
    ['Alternative Flow(s)', '3a. The credentials are wrong: the system shows an error and returns to step 2.'],
    ['Exceptions', '3b. The account is locked after 5 failed attempts: the system asks the user to reset the password.'],
  ], [24, 76], { template: 'usecase', createdAt: now - 9 * DAY, updatedAt: now - 4 * DAY });
  tUseCase.rows.slice(1).forEach((row) => { row[0].bold = true; });
  const tNfr = table('Non-Functional Requirements', ['ID', 'Category', 'Requirement', 'Measure / Acceptance Criteria'], [
    ['NFR-01', 'Security', 'The system shall authenticate every user before giving access to any data.', 'Passwords are stored hashed; an account is locked after 5 failed log-in attempts.'],
    ['NFR-02', 'Performance', 'The system shall respond quickly to user actions.', '95% of pages load in under 3 seconds with 100 concurrent users.'],
    ['NFR-03', 'Usability', 'The interface shall be available in Arabic and English.', 'Every screen can be switched between both languages without losing data.'],
  ], [10, 16, 40, 34], { template: 'nfr', createdAt: now - 8 * DAY, updatedAt: now - 3 * DAY });

  // ----- Text ----------------------------------------------------------------
  const ch = (n) => makeRef('ch', chap(n).id);
  const sectionRef = (n) => makeRef('sec', at(n).id);

  write('1.1', `Meyar is a web-based platform that gives students and researchers a secure place to store, analyse and report on their data. This report documents the planning, analysis and design of the platform.\nThe report is organised as follows: ${ch('2')} plans the project, ${ch('3')} analyses the requirements and ${ch('4')} presents the system architecture and design. The proposed features are listed in ${sectionRef('3.2.1')}.`, 'done');
  write('1.2', 'Data-driven projects increasingly rely on Artificial Intelligence (AI) and shared datasets, yet many teams still exchange files over e-mail and analyse them with disconnected tools. Meyar is motivated by the need for one secure place where datasets can be shared safely, analysed and reported, with an interface in Arabic and English.', 'done');
  write('1.3', `Existing solutions either lack secure access control or require several external tools to analyse and report on data, which slows teams down and exposes sensitive information. The limitations identified in the reviewed projects are listed in ${makeRef('tab', tLimits.id)}.`, 'review');
  write('1.4', `The aim of this project is to design and implement Meyar. The objectives are:\n- Provide secure, role-based access to project data.\n- Offer built-in data analysis and visualization.\n- Generate reports that can be exported for submission.\nThe features that serve these objectives are grouped by module in ${makeRef('fig', figFishbone.id)}.`, 'review');
  write('1.5', `${makeRef('tab', tCompare.id)} compares the features of Meyar with three existing systems, which are reviewed in ${makeRef('tab', tLimits.id)}.`);
  write('2.1', 'Meyar covers secure workspaces, dataset upload, built-in analysis and report export for students and their supervisors. Real-time collaboration and the evaluation module are outside the scope of this release.');
  write('2.2', `The main risks identified for the project and the product are listed in ${makeRef('tab', tRisks.id)}, with the planned mitigation for each.`);
  write('2.3', `The project follows an iterative Software Development Life Cycle (SDLC) with two-week sprints ${cite(refSommerville)}. The planned schedule is shown in ${makeRef('fig', figGantt.id)}.`);
  write('2.4', '- Development: Visual Studio Code, Git and GitHub.\n- Hosting: a cloud virtual machine with a managed database.\n- Hardware: laptops with at least 8 GB of RAM.');
  write('3.1', `Requirements were collected through interviews with the supervisors, a questionnaire for students and a review of the existing systems in ${sectionRef('1.5')}.`);
  write('3.2', 'This section lists the functions of Meyar and models them with a use case diagram and use case descriptions.');
  write('3.2.1', `The main features of Meyar are summarised in ${makeRef('tab', tFeatures.id)} and illustrated in ${makeRef('fig', figFishbone.id)}. Each feature maps to one module of the system architecture presented in ${sectionRef('4.1')}.`);
  write('3.2.2', `${makeRef('fig', figUseCase.id)} shows the main use cases of the system, drawn with the Unified Modeling Language (UML) ${cite(refUml)}.`);
  write('3.2.3', `The login process is illustrated in ${makeRef('fig', figLogin.id)}; its description is given in ${makeRef('tab', tUseCase.id)}.`);
  write('3.3', `Modern platforms protect data with Role-Based Access Control (RBAC) ${cite(refRbac)}, and security requirements follow the common web-application risks listed by OWASP ${cite(refOwasp)}. The measurable requirements are summarised in ${makeRef('tab', tNfr.id)}.`);
  write('4.1', `${makeRef('fig', figArch.id)} presents the three-tier architecture of Meyar. The web client reaches the server through an Application Programming Interface (API).`);
  write('4.2', 'This section details the internal interactions, the classes and the data storage of Meyar.');
  write('4.2.1', `${makeRef('fig', figSeq.id)} shows the interaction between components during login.`);
  write('4.2.2', `The main classes of Meyar and their relations are shown in ${makeRef('fig', figClass.id)}.`);
  write('4.2.3', `The logical data model is shown in ${makeRef('fig', figErd.id)}.`);
  write('4.3', 'The login and workspace screens have been prototyped as clickable mock-ups; their snapshots will be added here.');
  chap('5').body = 'Meyar brings secure storage, analysis and reporting into one platform. The analysis and design completed in this project show that the proposed system addresses the limitations of the existing systems, and we recommend continuing with its implementation in Graduation Project 2.';

  // Place figures and tables in sections.
  place(figFishbone, '1.4'); place(figGantt, '2.3'); place(figUseCase, '3.2.2'); place(figLogin, '3.2.3'); place(figArch, '4.1');
  place(figSeq, '4.2.1'); place(figClass, '4.2.2'); place(figErd, '4.2.3');
  // Table 1 is the limitations table (plain text): tests export the first table as a vector PDF, and the comparison
  // table (✓ ✗ glyphs) needs raster text chunks.
  place(tLimits, '1.3'); place(tCompare, '1.5'); place(tRisks, '2.2'); place(tFeatures, '3.2.1'); place(tUseCase, '3.2.3'); place(tNfr, '3.3');

  const project = createProject({
    ...fields,
    figures: [figFishbone, figGantt, figUseCase, figLogin, figArch, figSeq, figClass, figErd],
    tables: [tFeatures, tCompare, tLimits, tRisks, tUseCase, tNfr],
    references: [refSommerville, refRbac, refOwasp, refUml],
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
  const page = (kind) => project.frontMatter.find((f) => f.kind === kind);
  page('declaration').body = declarationText(project);
  page('abstract').body = 'Meyar is a web platform that gives students and researchers a secure place to store, analyse and report on their data. Teams that exchange datasets by e-mail and analyse them with disconnected tools risk leaking sensitive information and losing time. The objectives of this project are to provide role-based access to project data, built-in data analysis and visualization, and reports that can be exported for submission. Unlike the existing systems reviewed, Meyar combines all three in one platform with an Arabic and English interface. It is intended for undergraduate students, supervisors and research teams. This report presents the planning, requirements analysis and architecture of Meyar, and concludes with the user interface prototype built so far.';
  page('acknowledgements').body = 'We thank our supervisor, Dr. Ahmed D. Alharthi, for his guidance throughout this project, and our families and friends for their constant support.';
  project.activity = [
    { id: uid('act'), at: now - 2 * DAY, kind: 'revision', text: 'Saved revision #3 of Feature Fishbone Diagram', targetId: figFishbone.id },
    { id: uid('act'), at: now - 6 * DAY, kind: 'edit', text: 'Updated System Features Comparison', targetId: tCompare.id },
    { id: uid('act'), at: now - 30 * DAY, kind: 'create', text: 'Created project' },
  ];
  return project;
}
