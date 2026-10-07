// Pure-logic tests (no browser): numbering, cross references, acronym
// detection, diagram diff and versions. Run: node tests/unit.mjs
import assert from 'node:assert/strict';
import { createProject, createChapter, createSection, createFigure, createTable, createAcronym, normalizeProject } from '../src/core/model.js';
import { getNumbering, invalidateNumbering, moveInDocumentOrder, captionText } from '../src/core/numbering.js';
import { makeRef, resolveText, linkPlainReferences, findBrokenReferences, parseBlocks } from '../src/core/references.js';
import { scanText, detectAcronymSuggestions } from '../src/acronyms/detection.js';
import { diffDiagrams, summarizeDiff } from '../src/figures/diff.js';
import { addVersion, isDirty, restoreVersion } from '../src/figures/versions.js';
import { buildDocument } from '../src/core/document.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
};

function sampleProject() {
  const s11 = createSection({ title: 'Introduction' });
  const s142 = createSection({ title: 'Proposed System Features' });
  const s14 = createSection({ title: 'Proposed System', sections: [createSection({ title: 'Aims and Objectives' }), s142] });
  const ch1 = createChapter({ title: 'Introduction', sections: [s11, createSection({ title: 'Problem Domain' }), createSection({ title: 'Problem Statement' }), s14] });
  const s42 = createSection({ title: 'System Architecture' });
  const ch2 = createChapter({ title: 'Design', sections: [createSection({ title: 'Overview' }), s42] });
  const fishbone = createFigure({ title: 'Feature Fishbone Diagram', chapterId: ch1.id, sectionId: s142.id });
  const arch = createFigure({ title: 'System Architecture', chapterId: ch2.id, sectionId: s42.id });
  const features = createTable({ title: 'Proposed System Features', chapterId: ch1.id, sectionId: s142.id });
  const p = createProject({ name: 'Test', chapters: [ch1, ch2], figures: [arch, fishbone], tables: [features] });
  // createProject normalises (copies) the tree, so hand back the project's own section objects.
  return { p, ch1: p.chapters[0], ch2: p.chapters[1], s11: p.chapters[0].sections[0], s142: p.chapters[0].sections[3].sections[1], s42: p.chapters[1].sections[1], fishbone, arch, features };
}

console.log('numbering');
test('sections are numbered hierarchically', () => {
  const { p, s142, s42 } = sampleProject();
  const n = getNumbering(p);
  assert.equal(n.sections.get(s142.id).number, '1.4.2');
  assert.equal(n.sections.get(s42.id).number, '2.2');
});
test('figures follow document order, not array order', () => {
  const { p, fishbone, arch } = sampleProject();
  const n = getNumbering(p);
  assert.equal(n.figures.get(fishbone.id).label, 'Figure 1');
  assert.equal(n.figures.get(arch.id).label, 'Figure 2');
  assert.equal(n.figures.get(arch.id).code, 'FIG-002');
});
test('inserting a figure earlier renumbers later figures; ids stay stable', () => {
  const { p, s11, fishbone, arch } = sampleProject();
  const early = createFigure({ title: 'Context Diagram', chapterId: p.chapters[0].id, sectionId: s11.id });
  p.figures.push(early); invalidateNumbering(p);
  const n = getNumbering(p);
  assert.equal(n.figures.get(early.id).label, 'Figure 1');
  assert.equal(n.figures.get(fishbone.id).label, 'Figure 2');
  assert.equal(n.figures.get(arch.id).label, 'Figure 3');
});
test('deleting a figure closes the gap (FIG-001, FIG-002)', () => {
  const { p, fishbone, arch } = sampleProject();
  p.figures = p.figures.filter((f) => f.id !== fishbone.id); invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).code, 'FIG-001');
});
test('per-chapter numbering (Figure 2.1)', () => {
  const { p, arch } = sampleProject();
  p.settings.captions.figure.numbering = 'chapter'; invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).label, 'Figure 2.1');
});
test('caption text uses settings', () => {
  const { p, features } = sampleProject();
  assert.equal(captionText(p, 'table', features), 'Table 1: Proposed System Features');
});
test('move within the same section only', () => {
  const { p, s142, fishbone } = sampleProject();
  const second = createFigure({ title: 'Second', chapterId: p.chapters[0].id, sectionId: s142.id });
  p.figures.push(second); invalidateNumbering(p);
  assert.equal(moveInDocumentOrder(p, 'figures', second.id, -1), true);
  assert.equal(getNumbering(p).figures.get(second.id).label, 'Figure 1');
  assert.equal(getNumbering(p).figures.get(fishbone.id).label, 'Figure 2');
  assert.equal(moveInDocumentOrder(p, 'figures', second.id, -1), false);
});

console.log('cross references');
test('tokens resolve to live labels and update after renumbering', () => {
  const { p, s11, s142, arch } = sampleProject();
  const body = `As shown in ${makeRef('fig', arch.id)} and ${makeRef('sec', s142.id)}.`;
  assert.equal(resolveText(p, body), 'As shown in Figure 2 and Section 1.4.2.');
  p.figures.push(createFigure({ title: 'New', chapterId: p.chapters[0].id, sectionId: s11.id })); invalidateNumbering(p);
  assert.equal(resolveText(p, body), 'As shown in Figure 3 and Section 1.4.2.');
});
test('plain references can be linked', () => {
  const { p, arch, features } = sampleProject();
  const { body, count } = linkPlainReferences(p, 'See Figure 2 and Table 1, not Figure 9.');
  assert.equal(count, 2);
  assert.ok(body.includes(makeRef('fig', arch.id)) && body.includes(makeRef('tab', features.id)));
});
test('broken references are reported', () => {
  const { p, s11 } = sampleProject();
  s11.body = `See ${makeRef('fig', 'fig_missing')}.`;
  assert.equal(findBrokenReferences(p).length, 1);
  assert.equal(resolveText(p, s11.body), 'See Figure ??.');
});
test('blocks: paragraphs and bullets', () => {
  assert.deepEqual(parseBlocks('One\n- two\n\nthree').map((b) => b.type), ['p', 'li', 'p']);
});

console.log('acronym detection');
test('detects multi-word acronyms with hyphens and stop words', () => {
  const hits = scanText('We use Artificial Intelligence (AI) and Role-Based Access Control (RBAC) via an Application Programming Interface (API). The Department of Defense (DoD).');
  const map = Object.fromEntries(hits.map((h) => [h.acronym, h.meaning]));
  assert.equal(map.AI, 'Artificial Intelligence');
  assert.equal(map.RBAC, 'Role-Based Access Control');
  assert.equal(map.API, 'Application Programming Interface');
  assert.equal(map.DoD, 'Department of Defense');
});
test('ignores parentheses that are not acronyms', () => {
  assert.equal(scanText('the results (see below) were good (N=5)').length, 0);
});
test('suggestions exclude existing and dismissed acronyms', () => {
  const { p, s11 } = sampleProject();
  s11.body = 'Artificial Intelligence (AI) and Software Development Life Cycle (SDLC) and User Interface (UI).';
  p.acronyms.push(createAcronym({ acronym: 'AI', meaning: 'Artificial Intelligence' }));
  p.dismissedSuggestions.push('UI');
  assert.deepEqual(detectAcronymSuggestions(p).map((s) => s.acronym), ['SDLC']);
});

console.log('diagram diff & versions');
const node = (id, text, x = 0) => ({ id, type: 'node', shape: 'rect', x, y: 0, w: 100, h: 40, text, style: {} });
test('diff reports added, removed, renamed and moved', () => {
  const a = { elements: [node('a', 'Data Analysis'), node('b', 'Evaluation Module'), node('c', 'Users')] };
  const b = { elements: [node('a', 'Data & Analysis Management'), node('c', 'Users', 50), node('d', 'Reports')] };
  const lines = summarizeDiff(diffDiagrams(a, b));
  assert.ok(lines.includes('Added “Reports”'));
  assert.ok(lines.includes('Removed “Evaluation Module”'));
  assert.ok(lines.includes('Changed “Data Analysis” → “Data & Analysis Management”'));
  assert.ok(lines.includes('Moved 1 element'));
});
test('versions: dirty tracking, labels and restore', () => {
  const fig = createFigure({ diagram: { elements: [node('a', 'One')] } });
  addVersion(fig, { force: true });
  assert.equal(isDirty(fig), false);
  fig.diagram.elements.push(node('b', 'Two'));
  assert.equal(isDirty(fig), true);
  const v2 = addVersion(fig, { kind: 'revision', note: 'Supervisor asked' });
  assert.equal(v2.number, 2); assert.equal(v2.revision, 1); assert.equal(v2.label, 'Added Two');
  assert.equal(addVersion(fig), null, 'no-op version is skipped');
  restoreVersion(fig, fig.versions[0].id);
  assert.equal(fig.diagram.elements.length, 1);
  assert.equal(fig.versions.at(-1).label, 'Restored v1');
});

console.log('document model & import safety');
test('document body places figures and tables under their sections', () => {
  const { p, s142 } = sampleProject();
  const doc = buildDocument(p);
  const i = doc.body.findIndex((b) => b.type === 'heading' && b.id === s142.id);
  assert.equal(doc.body[i + 1].type, 'figure');
  assert.equal(doc.body[i + 2].type, 'table');
  assert.ok(doc.toc.some((t) => t.text === '1.4.2 Proposed System Features'));
});
test('normalizeProject repairs partial imports', () => {
  const p = normalizeProject({ name: 'Imported', chapters: [{ title: 'Only title' }], figures: [{ title: 'F' }], tables: [{ title: 'T', columns: [{ width: 50 }, { width: 50 }], rows: [[{ text: 'a' }]] }] });
  assert.ok(p.chapters[0].id && Array.isArray(p.chapters[0].sections));
  assert.ok(Array.isArray(p.figures[0].diagram.elements));
  assert.equal(p.tables[0].rows[0].length, 2);
  assert.equal(p.settings.captions.figure.label, 'Figure');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
