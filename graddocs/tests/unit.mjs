// Pure-logic tests (no browser): numbering, cross references, acronym
// detection, diagram diff and versions. Run: node tests/unit.mjs
import assert from 'node:assert/strict';
import { createProject, createChapter, createSection, createFigure, createTable, createAcronym, normalizeProject } from '../src/core/model.js';
import { getNumbering, invalidateNumbering, moveInDocumentOrder, captionText } from '../src/core/numbering.js';
import {
  makeRef, resolveText, linkPlainReferences, findBrokenReferences, parseBlocks,
  PLACE_RE, makePlacement, placementsIn, stripPlacements, insertPlacement, removePlacements, removeLine, moveLine, clearPlacement, findBrokenPlacements, placementOf,
} from '../src/core/references.js';
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

console.log('placement in the text');
/** sampleProject + a second figure `second` stored in 1.4.2 (after `fishbone`). */
function placementProject() {
  const base = sampleProject();
  const { p, s142 } = base;
  const second = createFigure({ title: 'Second Figure', chapterId: p.chapters[0].id, sectionId: s142.id });
  p.figures.push(second); invalidateNumbering(p);
  const A = p.figures.find((f) => f.title === 'Feature Fishbone Diagram');
  return { ...base, second, A, B: second };
}
const fig = (id) => makePlacement('figure', id);
test('PLACE_RE and helpers: a line holding only the token', () => {
  assert.ok(PLACE_RE.test('{{figure:fig_1}}') && PLACE_RE.test('  {{table:tbl-2}}  '));
  assert.ok(!PLACE_RE.test('see {{figure:fig_1}}') && !PLACE_RE.test('{{ref:fig:fig_1}}') && !PLACE_RE.test('{{figure:fig_1}} text'));
  assert.equal(makePlacement('table', 'tbl_9'), '{{table:tbl_9}}');
  assert.deepEqual(placementsIn('a\n{{figure:f1}}\n\n{{table:t1}}\nb {{figure:f2}}'), [{ kind: 'figure', id: 'f1', line: 1 }, { kind: 'table', id: 't1', line: 3 }]);
  assert.deepEqual(placementsIn(''), []);
  assert.equal(stripPlacements('a\n{{figure:f1}}\nb'), 'a\nb');
});
test('numbering follows the placement order inside a section', () => {
  const { p, s142, A, B } = placementProject();
  assert.equal(getNumbering(p).figures.get(A.id).label, 'Figure 1');
  assert.equal(getNumbering(p).figures.get(B.id).label, 'Figure 2');
  s142.body = `Intro\n${fig(B.id)}\nMiddle\n${fig(A.id)}\nEnd`; invalidateNumbering(p);
  const n = getNumbering(p);
  assert.equal(n.figures.get(B.id).label, 'Figure 1', 'B is placed first');
  assert.equal(n.figures.get(A.id).label, 'Figure 2');
  assert.equal(n.figures.get(B.id).code, 'FIG-001');
  assert.deepEqual(n.figureOrder.slice(0, 2).map((f) => f.id), [B.id, A.id]);
  assert.equal(n.figures.get(B.id).placed, true);
  assert.equal(n.figures.get(B.id).placement.ownerId, s142.id);
  assert.equal(n.figures.get(B.id).placement.line, 1);
});
test('placed items come before items that are only assigned to the section', () => {
  const { p, s142, A, B } = placementProject();
  s142.body = `Text\n${fig(B.id)}\nMore text`; invalidateNumbering(p);
  const n = getNumbering(p);
  assert.equal(n.figures.get(B.id).label, 'Figure 1');
  assert.equal(n.figures.get(A.id).label, 'Figure 2', 'unplaced A follows at the end of the section');
  assert.equal(n.figures.get(A.id).placed, false);
  assert.equal(n.figures.get(A.id).placement, null);
});
test('a placement in another section moves the item there (it wins over sectionId)', () => {
  const { p, s11, ch1, arch } = sampleProject();
  s11.body = `Intro\n${fig(arch.id)}\nMore`; invalidateNumbering(p);
  const info = getNumbering(p).figures.get(arch.id);
  assert.equal(info.sectionId, s11.id);
  assert.equal(info.chapterId, ch1.id);
  assert.equal(info.location, 'Chapter 1 · Section 1.1');
  assert.equal(info.label, 'Figure 1', 'section 1.1 comes before 1.4.2');
  assert.equal(getNumbering(p).figures.get(p.figures.find((f) => f.title === 'Feature Fishbone Diagram').id).label, 'Figure 2');
  // the stored location is untouched, so removing the line sends it back to the end of its own section
  assert.equal(p.figures.find((f) => f.id === arch.id).sectionId, p.chapters[1].sections[1].id);
  s11.body = 'Intro\nMore'; invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).label, 'Figure 2');
  assert.equal(getNumbering(p).figures.get(arch.id).placed, false);
});
test('chapter bodies place items before the chapter\'s section items; per-chapter numbering uses the placement', () => {
  const { p, ch2, fishbone, arch } = sampleProject();
  ch2.body = `Chapter intro\n${fig(arch.id)}`; invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).sectionId, null);
  assert.equal(getNumbering(p).figures.get(arch.id).chapterId, ch2.id);
  assert.equal(getNumbering(p).figures.get(arch.id).location, 'Chapter 2');
  // the fishbone joins chapter 2's intro after arch: numbered right after it, before the chapter's own sections
  ch2.body = `${fig(arch.id)}\n${fig(fishbone.id)}`; invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).label, 'Figure 1');
  assert.equal(getNumbering(p).figures.get(fishbone.id).label, 'Figure 2');
  p.settings.captions.figure.numbering = 'chapter'; invalidateNumbering(p);
  assert.equal(getNumbering(p).figures.get(arch.id).label, 'Figure 2.1');
  assert.equal(getNumbering(p).figures.get(fishbone.id).label, 'Figure 2.2');
});
test('duplicates and missing items are ignored but reported', () => {
  const { p, s11, s142, s42, A, B } = placementProject();
  s42.body = fig(A.id); // later in the document than 1.4.2: ignored
  s142.body = `${fig(B.id)}\n${fig('fig_gone')}\n${fig(A.id)}\n${fig(A.id)}\n${makePlacement('table', A.id)}`; // missing, duplicate in same body, a "table" with a figure id
  s11.body = `${fig('fig_gone')}`;
  invalidateNumbering(p);
  const n = getNumbering(p);
  assert.equal(n.figures.get(B.id).label, 'Figure 1');
  assert.equal(n.figures.get(A.id).label, 'Figure 2');
  assert.equal(n.figures.get(A.id).placement.ownerId, s142.id);
  const broken = findBrokenPlacements(p);
  assert.deepEqual(broken.map((b) => `${b.ownerId === s11.id ? '1.1' : b.ownerId === s142.id ? '1.4.2' : '2.2'}:${b.kind}:${b.reason}`).sort(),
    ['1.1:figure:missing', '1.4.2:figure:duplicate', '1.4.2:figure:missing', '1.4.2:table:missing', '2.2:figure:duplicate'].sort());
  assert.equal(findBrokenReferences(p).length, 0, 'placements are not cross references');
  assert.equal(placementOf(p, 'figure', A.id).ownerId, s142.id);
});
test('the same id as a figure and a table are different items', () => {
  const { p, s142, features } = sampleProject();
  s142.body = `${makePlacement('table', features.id)}`; invalidateNumbering(p);
  assert.equal(getNumbering(p).tables.get(features.id).placed, true);
  assert.equal(getNumbering(p).figures.size, 2);
});
test('moveInDocumentOrder swaps the placement lines of two placed items', () => {
  const { p, s142, A, B } = placementProject();
  s142.body = `x\n${fig(A.id)}\ny\n${fig(B.id)}`; invalidateNumbering(p);
  assert.equal(moveInDocumentOrder(p, 'figures', B.id, -1), true);
  assert.equal(s142.body, `x\n${fig(B.id)}\ny\n${fig(A.id)}`);
  assert.equal(getNumbering(p).figures.get(B.id).label, 'Figure 1');
  // a placed item cannot jump over an unplaced one
  s142.body = `x\n${fig(A.id)}`; invalidateNumbering(p);
  assert.equal(moveInDocumentOrder(p, 'figures', A.id, 1), false);
});
test('body helpers: insert, remove, move and clear placement lines', () => {
  assert.equal(insertPlacement('a\nb\n\n', 'figure', 'f1'), 'a\nb\n{{figure:f1}}');
  assert.equal(insertPlacement('a\nb', 'table', 't1', 1), 'a\n{{table:t1}}\nb');
  assert.equal(insertPlacement('', 'figure', 'f1'), '{{figure:f1}}');
  assert.equal(removePlacements('a\n{{figure:f1}}\nb\n{{figure:f1}}\n{{figure:f2}}', 'figure', 'f1'), 'a\nb\n{{figure:f2}}');
  assert.equal(removeLine('a\nb\nc', 1), 'a\nc');
  const up = moveLine('a\n\nb\n{{figure:f1}}\nc', 3, -1);
  assert.deepEqual(up, { body: 'a\n\n{{figure:f1}}\nb\nc', line: 2 });
  assert.deepEqual(moveLine('a\n{{figure:f1}}\n\nb\nc', 1, 1), { body: 'a\n\nb\n{{figure:f1}}\nc', line: 3 });
  assert.equal(moveLine('{{figure:f1}}\na', 0, -1), null);
  assert.equal(moveLine('a\n{{figure:f1}}', 1, 1), null);
  const { p, s11, s142, A } = placementProject();
  s11.body = `t\n${fig(A.id)}`; s142.body = `${fig(A.id)}\nu`; invalidateNumbering(p);
  assert.equal(clearPlacement(p, 'figure', A.id), 2);
  assert.equal(s11.body, 't'); assert.equal(s142.body, 'u');
  assert.equal(getNumbering(p).figures.get(A.id).placed, false);
});
test('resolveText leaves placement lines out (search, word count, acronym scan)', () => {
  const { p, s11, A } = placementProject();
  s11.body = `One\n${fig(A.id)}\nTwo`;
  assert.equal(resolveText(p, s11.body), 'One\nTwo');
});
test('parseBlocks: placement lines become figure/table blocks', () => {
  assert.deepEqual(parseBlocks('Intro\n{{figure:fig_1}}\n  {{table:tbl_2}}  \n- item\ninline {{figure:fig_1}} text\n{{ref:fig:fig_1}}'),
    [{ type: 'p', text: 'Intro' }, { type: 'figure', id: 'fig_1' }, { type: 'table', id: 'tbl_2' }, { type: 'li', text: 'item' },
      { type: 'p', text: 'inline {{figure:fig_1}} text' }, { type: 'p', text: '{{ref:fig:fig_1}}' }]);
  assert.deepEqual(parseBlocks('One\n- two\n\nthree').map((b) => b.type), ['p', 'li', 'p'], 'old behaviour unchanged');
});
test('buildDocument emits placed figures/tables at the placement, unplaced ones at the end of the section', () => {
  const { p, s142, A, B, features } = placementProject();
  s142.body = `One\n${fig(B.id)}\nTwo\n- bullet\n${makePlacement('table', features.id)}\nThree`; invalidateNumbering(p);
  const doc = buildDocument(p);
  const i = doc.body.findIndex((b) => b.type === 'heading' && b.id === s142.id);
  const shape = doc.body.slice(i + 1, i + 8).map((b) => (b.type === 'figure' || b.type === 'table' ? `${b.type}:${b.id}` : `${b.type}:${b.text}`));
  assert.deepEqual(shape, ['paragraph:One', `figure:${B.id}`, 'paragraph:Two', 'bullet:bullet', `table:${features.id}`, 'paragraph:Three', `figure:${A.id}`]);
  // captions carry the numbers that follow the placement order
  assert.equal(doc.body[i + 2].caption, 'Figure 1: Second Figure');
  assert.equal(doc.body[i + 7].caption, 'Figure 2: Feature Fishbone Diagram');
  // nothing twice, nothing lost; the lists (LoF/LoT) are in the same order as the body
  const emitted = (type) => doc.body.filter((b) => b.type === type).map((b) => b.id);
  assert.deepEqual(emitted('figure'), doc.figures.map((f) => f.id));
  assert.deepEqual(emitted('table'), doc.tables.map((x) => x.id));
  assert.equal(new Set(emitted('figure')).size, p.figures.length);
  assert.ok(!doc.body.some((b) => b.type === 'chapter' && b.unassigned));
});
test('buildDocument: duplicate / missing / foreign placements emit nothing extra', () => {
  const { p, s11, s142, s42, A, B } = placementProject();
  s142.body = `${fig(A.id)}\n${fig(A.id)}\n${fig('nope')}`;
  s42.body = `${fig(A.id)}\n${fig(B.id)}`; // A is already placed in 1.4.2; B moves to 2.2
  s11.body = `${fig(B.id)}`; // B placed first in 1.1 (earlier in the document), so 2.2's copy is the duplicate
  invalidateNumbering(p);
  const doc = buildDocument(p);
  const count = (id) => doc.body.filter((b) => b.type === 'figure' && b.id === id).length;
  assert.equal(count(A.id), 1); assert.equal(count(B.id), 1);
  const at = (secId) => doc.body.findIndex((b) => b.type === 'heading' && b.id === secId);
  assert.equal(doc.body[at(s11.id) + 1].id, B.id);
  assert.equal(doc.body[at(s142.id) + 1].id, A.id);
  assert.equal(doc.body[at(s42.id) + 1].type === 'figure', true, 'arch (assigned to 2.2, unplaced) is still emitted there');
  assert.equal(doc.figures.length, p.figures.length);
});
test('front-matter text never receives placement blocks', () => {
  const { p, A } = placementProject();
  p.frontMatter.find((f) => f.kind === 'abstract').body = `Abstract.\n${fig(A.id)}`;
  const abstract = buildDocument(p).front.find((f) => f.kind === 'abstract');
  assert.deepEqual(abstract.blocks, [{ type: 'p', text: 'Abstract.' }]);
});
test('numbering stays cached between calls and is invalidated by changes', () => {
  const { p, s142, B } = placementProject();
  assert.equal(getNumbering(p), getNumbering(p));
  const before = getNumbering(p);
  s142.body = fig(B.id); invalidateNumbering(p);
  assert.notEqual(getNumbering(p), before);
});
test('numbering a large document with many placements stays fast', () => {
  const sections = Array.from({ length: 300 }, (_, i) => createSection({ title: `S${i}` }));
  const figures = sections.map((s, i) => createFigure({ title: `F${i}` }));
  sections.forEach((s, i) => { s.body = `text\n${fig(figures[299 - i].id)}\nmore`; });
  const p = createProject({ chapters: [createChapter({ title: 'Big', sections })], figures });
  const t0 = Date.now(); const n = getNumbering(p);
  assert.ok(Date.now() - t0 < 500, 'numbering took too long');
  assert.equal(n.figures.get(figures[299].id).label, 'Figure 1');
  assert.equal(n.figures.get(figures[0].id).label, 'Figure 300');
});

console.log('bibliography and templates');
const { createReference } = await import('../src/core/model.js');
const { formatReference, parseBibTeX, parseNames, findDuplicateReference } = await import('../src/core/bibliography.js');
const { presetProjectFields, applyPresetFormatting, mergePresetStructure, declarationText } = await import('../src/core/presets.js');
const { studentName, studentLines } = await import('../src/core/document.js');
test('author names: "First Last", "Last, First", "Last I." and particles', () => {
  const n = parseNames('Ahmed D. Alharthi; Smith, John\nBooth D.\nLudwig van Beethoven');
  assert.deepEqual(n.map((x) => x.last), ['Alharthi', 'Smith', 'Booth', 'van Beethoven']);
  assert.equal(n[2].first, 'D.');
});
test('IEEE and compact formatting', () => {
  const ref = createReference({ type: 'journal', authors: 'Ahmed D. Alharthi\nJohn Smith', title: 'A Study', container: 'IEEE Access', volume: '9', issue: '2', pages: '100-110', year: '2021' });
  assert.equal(formatReference(ref, 'ieee'), 'A. D. Alharthi and J. Smith, “A Study,” IEEE Access, vol. 9, no. 2, pp. 100–110, 2021.');
  assert.equal(formatReference(ref, 'compact'), 'Alharthi A.D., Smith J., “A Study”, IEEE Access, vol. 9, no. 2, pp. 100–110. 2021.');
  assert.equal(formatReference({ ...ref, custom: 'Verbatim entry.' }, 'ieee'), 'Verbatim entry.');
});
test('BibTeX import and duplicate detection', () => {
  const refs = parseBibTeX('@inproceedings{a, author={Babineau, W. and Barry, P.}, title={{Automated Testing}}, booktitle={Proc. SIW}, year={1998}}\n@book{b, author="Sommerville, Ian", title="Software Engineering", publisher={Pearson}, year=2016}');
  assert.equal(refs.length, 2);
  assert.equal(refs[0].type, 'conference');
  assert.equal(refs[0].authors, 'Babineau, W.\nBarry, P.');
  assert.equal(refs[1].container, '');
  const web = parseBibTeX('@misc{w, title={OWASP}, howpublished={\\url{https://owasp.org/top10}}, url={https://x.org/a--b\\_c}}')[0];
  assert.equal(web.container, 'https://owasp.org/top10');
  assert.equal(web.url, 'https://x.org/a--b_c');
  const list = refs.map((r) => createReference(r));
  assert.ok(findDuplicateReference(list, createReference({ title: 'software  engineering!', year: '2016' })));
  assert.equal(findDuplicateReference(list, createReference({ title: 'Software Engineering', year: '2020' })), null);
});
test('citations are numbered by first citation, alphabetically or manually', () => {
  const { p, s11, s42 } = sampleProject();
  const a = createReference({ authors: 'Zed, A.', title: 'Zeta' });
  const b = createReference({ authors: 'Alpha, B.', title: 'Alpha' });
  const c = createReference({ authors: 'Mid, C.', title: 'Never cited' });
  p.references = [a, b, c];
  s42.body = `Later ${makeRef('cite', a.id)}.`;
  s11.body = `First ${makeRef('cite', b.id)} then ${makeRef('cite', a.id)}.`;
  invalidateNumbering(p);
  assert.equal(resolveText(p, s11.body), 'First [1] then [2].');
  assert.equal(getNumbering(p).references.get(c.id).label, '[3]');
  assert.equal(getNumbering(p).references.get(c.id).cited, false);
  p.settings.references.order = 'alphabetical'; invalidateNumbering(p);
  assert.equal(resolveText(p, s11.body), 'First [1] then [3].');
  p.settings.references.order = 'manual'; invalidateNumbering(p);
  assert.equal(resolveText(p, s11.body), 'First [2] then [1].');
  p.references = [a, c]; invalidateNumbering(p);
  assert.equal(resolveText(p, s11.body), 'First [?] then [1].');
  assert.deepEqual(findBrokenReferences(p).map((x) => x.kind), ['cite']);
});
test('unnumbered chapters keep later chapter numbers and have unnumbered sections', () => {
  const { p, ch2 } = sampleProject();
  const concl = createChapter({ title: 'Conclusions', numbered: false, sections: [createSection({ title: 'Future Work' })] });
  p.chapters.splice(1, 0, concl);
  invalidateNumbering(p);
  const n = getNumbering(p);
  assert.equal(n.chapters.get(ch2.id).number, '2');
  assert.equal(n.chapters.get(concl.id).number, '');
  assert.equal(n.sections.get(concl.sections[0].id).number, '');
  const doc = buildDocument(p);
  assert.ok(doc.toc.some((e) => e.text === 'CONCLUSIONS' && e.number === ''));
  assert.ok(doc.toc.some((e) => e.text === 'Future Work'));
  assert.ok(doc.body.some((b) => b.type === 'chapter' && b.heading === 'CONCLUSIONS' && b.numbered === false));
});
test('UQU preset: structure, settings, TOC with front matter and references', () => {
  const p = createProject(presetProjectFields('uqu-swe-gp1', { name: 'Meyar', students: 'Ahmed Ali (443001234)\nSara Omar (443005678)', university: '' }));
  assert.equal(p.university, 'Umm Al-Qura University');
  assert.deepEqual(p.frontMatter.map((f) => f.kind), ['declaration', 'abstract', 'acknowledgements', 'toc', 'lot', 'lof', 'loa']);
  assert.equal(p.frontMatter[1].wordLimit, 150);
  assert.ok(p.frontMatter[0].body.includes('“Meyar”') && p.frontMatter[0].body.includes('Umm Al-Qura University'));
  assert.equal(p.settings.typography.lineSpacing, 2);
  assert.equal(p.settings.page.size, 'Letter');
  p.references = [createReference({ title: 'X', authors: 'Y, Z.' })];
  invalidateNumbering(p);
  const doc = buildDocument(p);
  const texts = doc.toc.map((e) => e.text);
  assert.equal(texts[0], 'Declaration');
  assert.ok(texts.includes('CHAPTER 3: REQUIREMENT ENGINEERING AND ANALYSIS'));
  assert.ok(texts.includes('3.2.3 Use Cases: Description & Details'));
  assert.ok(texts.includes('3.3 Nonfunctional Requirements: Quality & Constraints'));
  assert.deepEqual(texts.slice(-2), ['CONCLUSIONS', 'REFERENCES']);
  assert.ok(!texts.includes('CONTENT'));
  assert.deepEqual(doc.titlePage.studentNames, ['Ahmed Ali', 'Sara Omar']);
  assert.equal(doc.titlePage.layout, 'submission');
});
test('applying the preset to an existing project never deletes anything', () => {
  const { p, ch1, s11 } = sampleProject();
  s11.body = 'Keep me.';
  p.chapters.push(createChapter({ title: 'Conclusion' }));
  const before = p.chapters.length;
  const r1 = applyPresetFormatting(p, 'uqu-swe-gp1');
  assert.equal(r1.added, 1); // acknowledgment page
  assert.equal(p.frontMatter.find((f) => f.kind === 'toc').title, 'CONTENT');
  assert.equal(p.chapters[p.chapters.length - 1].numbered, false);
  const r2 = mergePresetStructure(p, 'uqu-swe-gp1');
  assert.equal(r2.chapters, 3);
  assert.equal(p.chapters.length, before + 3);
  assert.equal(p.chapters[0].id, ch1.id);
  assert.equal(p.chapters[0].sections[0].body, 'Keep me.');
  assert.equal(p.chapters[p.chapters.length - 1].title, 'Conclusion');
  assert.deepEqual(mergePresetStructure(p, 'uqu-swe-gp1'), { chapters: 0, sections: 0 });
});
test('students: IDs are stripped for signature lines', () => {
  assert.deepEqual(studentLines('A (1)\nB - 22'), ['A (1)', 'B - 22']);
  assert.equal(studentName('Ahmed Ali Alharbi (443001234)'), 'Ahmed Ali Alharbi');
  assert.equal(studentName('Sara Omar - 443005678'), 'Sara Omar');
  assert.ok(declarationText({ name: 'X', department: 'SE Dept' }).includes('at SE Dept.'));
});

console.log('translations');
const { AR } = await import('../src/i18n/ar/index.js');
test('every Arabic translation keeps the English placeholders', () => {
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(AR).filter(([en, ar]) => typeof ar !== 'string' || !ar.trim() || ph(en) !== ph(ar));
  assert.deepEqual(bad.map(([en]) => en), []);
});
const { t } = await import('../src/i18n/index.js');
test('t() falls back to English and fills placeholders', () => {
  assert.equal(t('Last saved {time}', { time: 'now' }), 'Last saved now');
  assert.equal(t('No such key'), 'No such key');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
