// "Updates from Claude" (src/inbox/inbox.js): validation, matching, placement and applying. Pure logic, no browser,
// no network (the image loader and fetch are injected). Run: node tests/inbox.mjs
import assert from 'node:assert/strict';
import { createProject, createChapter, createSection, createFigure } from '../src/core/model.js';
import { getNumbering, locationLabel } from '../src/core/numbering.js';
import { buildDocument } from '../src/core/document.js';
import { latestVersion } from '../src/figures/versions.js';
import {
  INBOX_URLS, normalizeInbox, normalizeItem, matchItems, findPlacement, describeDestination, applyItem, applyItems, undoApply, dismissItem,
  fetchInbox, resolveAssetUrl, figureParts, ensureInbox,
} from '../src/inbox/inbox.js';

// Text is measured with a canvas in the browser; a stand-in with fixed-width glyphs keeps the tests deterministic.
globalThis.document = { createElement: () => ({ getContext: () => ({ set font(v) { this._font = v; }, measureText(text) { return { width: String(text).length * (Number((/(\d+(?:\.\d+)?)px/.exec(this._font || '') || [])[1]) || 14) * 0.5 }; } }) }) };

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); process.exitCode = 1; }
};

const URL0 = INBOX_URLS[0];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A project with Chapter 1 (Introduction) and Chapter 2 (Planning Phase → 2.1 Project Schedule → 2.1.1 Gantt Chart). */
function sampleProject(fields = {}) {
  const gantt = createSection({ title: 'Gantt Chart' });
  const schedule = createSection({ title: 'Project Schedule', sections: [gantt] });
  const p = createProject({
    name: 'Meyar',
    chapters: [createChapter({ title: 'Introduction', sections: [createSection({ title: 'Background' })] }), createChapter({ title: 'Planning Phase', sections: [createSection({ title: 'Overview' }), schedule] })],
    ...fields,
  });
  return { p, ch1: p.chapters[0], ch2: p.chapters[1], schedule: p.chapters[1].sections[1], gantt: p.chapters[1].sections[1].sections[0] };
}

const box = (id, x, y, text) => ({ id, type: 'node', shape: 'rect', x, y, w: 120, h: 50, text, style: {} });
const diagram = (text = 'Hello') => ({ width: 800, height: 400, background: '#ffffff', elements: [box('a', 20, 20, text), box('b', 240, 20, 'World'), { id: 'e1', type: 'edge', source: { id: 'a' }, target: { id: 'b' }, routing: 'straight', text: '', style: {} }] });
const rawFigure = (over = {}) => ({
  id: 'claude-fig-1', project: 'Meyar', kind: 'figure', title: 'System overview', createdAt: '2026-05-01T10:00:00Z',
  figure: { id: 'fig-overview', title: 'System Overview', type: 'generic', description: 'The big picture.', diagram: diagram() },
  place: { sectionTitles: ['Project Schedule'] }, ...over,
});
const rawLogo = (over = {}) => ({ id: 'logo-1', project: 'Meyar', kind: 'projectLogo', title: 'Meyar logo', titleAr: 'شعار معيار', createdAt: '2026-05-01T09:00:00Z', asset: 'assets/meyar-logo.png', ...over });
const rawGantt = (over = {}) => ({
  id: 'claude-gantt-1', project: 'meyar', kind: 'figure', title: 'Schedule', createdAt: '2026-05-02T09:00:00Z',
  figure: {
    id: 'fig-gantt', title: 'Project Gantt Chart', type: 'gantt', description: '',
    gantt: { tasks: [{ id: 't1', name: 'Planning', start: '2026-02-01', end: '2026-02-14', level: 0 }, { id: 't2', name: 'Design', start: '2026-02-15', end: '2026-03-14', level: 0 }] },
  },
  place: { sectionTitles: ['gantt chart', 'Project Schedule'] }, ...over,
});
const inboxOf = (...items) => normalizeInbox({ version: 1, items }, URL0);

console.log('validation');
await test('a well-formed file keeps its items; malformed items are ignored', () => {
  const inbox = inboxOf(rawLogo(), rawFigure(), rawGantt(),
    { id: 'x', project: 'Meyar', kind: 'unknown' }, { project: 'Meyar', kind: 'figure' }, null, 'nope',
    rawFigure({ id: 'bad-diagram', figure: { id: 'f', title: 'x', type: 'generic', diagram: { elements: [{ id: 'n', type: 'node' }] } } }),
    rawLogo({ id: 'bad-logo', asset: 'javascript:alert(1)' }), rawLogo({ id: 'http-logo', asset: 'http://example.com/x.png' }),
    rawFigure({ id: 'gantt-without-data', figure: { id: 'g', title: 'g', type: 'gantt' } }));
  assert.deepEqual(inbox.items.map((i) => i.id).sort(), ['claude-fig-1', 'claude-gantt-1', 'logo-1']);
  assert.equal(normalizeInbox({ version: 2, items: [rawLogo()] }, URL0).items.length, 0, 'a newer file format is ignored');
  assert.equal(normalizeInbox('garbage', URL0).items.length, 0);
});
await test('asset paths are resolved against the inbox URL; only https: and data: images are accepted', () => {
  assert.equal(resolveAssetUrl('assets/meyar-logo.png', URL0), 'https://raw.githubusercontent.com/r3oi/Mehad/claude/modest-johnson-7im24n/graddocs/inbox/assets/meyar-logo.png');
  assert.equal(resolveAssetUrl('../other/logo.svg', URL0), 'https://raw.githubusercontent.com/r3oi/Mehad/claude/modest-johnson-7im24n/graddocs/other/logo.svg');
  assert.equal(resolveAssetUrl(PNG, URL0), PNG);
  assert.equal(resolveAssetUrl('data:text/html;base64,PHNjcmlwdD4=', URL0), '');
  assert.equal(resolveAssetUrl('javascript:alert(1)', URL0), '');
  assert.equal(resolveAssetUrl('file:///etc/passwd', URL0), '');
  assert.equal(resolveAssetUrl('', URL0), '');
});
await test('image sources inside a diagram are limited to data: images; the copy shares nothing with the file', () => {
  const raw = rawFigure();
  raw.figure.diagram.elements.push({ id: 'img', type: 'node', shape: 'image', x: 0, y: 0, w: 50, h: 50, src: 'https://tracker.example/pixel.png' });
  raw.figure.diagram.elements.push({ id: 'img2', type: 'node', shape: 'image', x: 0, y: 0, w: 50, h: 50, src: PNG });
  const item = normalizeItem(raw, URL0);
  assert.equal(item.figure.diagram.elements.find((e) => e.id === 'img').src, '');
  assert.equal(item.figure.diagram.elements.find((e) => e.id === 'img2').src, PNG);
  assert.notEqual(item.figure.diagram, raw.figure.diagram);
});
await test('a duplicate id keeps the newest item', () => {
  const inbox = inboxOf(rawLogo({ title: 'old', createdAt: '2026-01-01T00:00:00Z' }), rawLogo({ title: 'new', createdAt: '2026-03-01T00:00:00Z' }), rawLogo({ title: 'older', createdAt: '2025-01-01T00:00:00Z' }));
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].title, 'new');
});

console.log('matching');
await test('items are matched by project name (trimmed, case-insensitive) or "*"', () => {
  const { p } = sampleProject();
  const inbox = inboxOf(rawLogo({ project: '  MEYAR ' }), rawFigure({ id: 'other', project: 'Another project' }), rawFigure({ id: 'any', project: '*' }));
  assert.deepEqual(matchItems(p, inbox).map((i) => i.id).sort(), ['any', 'logo-1']);
  p.name = '  meyar';
  assert.equal(matchItems(p, inbox).length, 2);
  p.name = 'Different';
  assert.deepEqual(matchItems(p, inbox).map((i) => i.id), ['any']);
});
await test('pending, applied, dismissed and re-sent (newer) items', () => {
  const { p } = sampleProject();
  const v1 = inboxOf(rawLogo({ createdAt: '2026-05-01T09:00:00Z' }), rawFigure({ createdAt: '2026-05-01T10:00:00Z' }));
  assert.equal(matchItems(p, v1).length, 2);
  assert.ok(matchItems(p, v1).every((i) => i.status === 'new'));

  const t0 = Date.parse('2026-05-02T00:00:00Z');
  const ib = ensureInbox(p);
  ib.applied['logo-1'] = t0;
  ib.dismissed['claude-fig-1'] = t0;
  assert.equal(matchItems(p, v1).length, 0, 'applied and dismissed items are not offered again');

  const v2 = inboxOf(rawLogo({ createdAt: '2026-05-03T09:00:00Z', title: 'Meyar logo v2' }), rawFigure({ createdAt: '2026-05-03T10:00:00Z' }));
  const again = matchItems(p, v2);
  assert.deepEqual(again.map((i) => i.id).sort(), ['claude-fig-1', 'logo-1'], 'a newer createdAt makes them pending again');
  assert.equal(again.find((i) => i.id === 'logo-1').status, 'update', 'applied before = an update');
  assert.equal(again.find((i) => i.id === 'claude-fig-1').status, 'new', 'dismissed before, never applied');

  const sameAgain = inboxOf(rawLogo({ createdAt: '2026-05-01T09:00:00Z' }));
  assert.equal(matchItems(p, sameAgain).length, 0, 'the same (or an older) version is not offered again');
});
await test('a figure that already exists is offered as an update', () => {
  const { p } = sampleProject();
  p.figures.push(createFigure({ id: 'fig-overview', title: 'Mine' }));
  const [m] = matchItems(p, inboxOf(rawFigure()));
  assert.equal(m.status, 'update');
});
await test('items are listed oldest first', () => {
  const { p } = sampleProject();
  const ids = matchItems(p, inboxOf(rawFigure({ id: 'b', createdAt: '2026-05-02T00:00:00Z' }), rawFigure({ id: 'a', createdAt: '2026-05-01T00:00:00Z', figure: { ...rawFigure().figure, id: 'f2' } }))).map((i) => i.id);
  assert.deepEqual(ids, ['a', 'b']);
});

console.log('placement');
await test('sections are matched by title at any depth, case-insensitively, first listed title first', () => {
  const { p, ch2, schedule, gantt } = sampleProject();
  assert.deepEqual(findPlacement(p, { sectionTitles: ['  project SCHEDULE '] }), { chapterId: ch2.id, sectionId: schedule.id });
  assert.deepEqual(findPlacement(p, { sectionTitles: ['Gantt Chart', 'Project Schedule'] }), { chapterId: ch2.id, sectionId: gantt.id });
  assert.deepEqual(findPlacement(p, { sectionTitles: ['Nothing like this', 'Project Schedule'] }), { chapterId: ch2.id, sectionId: schedule.id });
});
await test('chapters are tried after all sections; no match = unassigned', () => {
  const { p, ch1, ch2, schedule } = sampleProject();
  assert.deepEqual(findPlacement(p, { sectionTitles: ['Project Schedule'], chapterTitles: ['Introduction'] }), { chapterId: ch2.id, sectionId: schedule.id });
  assert.deepEqual(findPlacement(p, { sectionTitles: ['Nope'], chapterTitles: ['introduction'] }), { chapterId: ch1.id, sectionId: null });
  assert.equal(findPlacement(p, { sectionTitles: ['Nope'], chapterTitles: ['Nope'] }), null);
  assert.equal(findPlacement(p, undefined), null);
});
await test('destination labels use the report numbering ("Chapter 2 · 2.2 Project Schedule") or Unassigned', () => {
  const { p } = sampleProject();
  const [fig, other] = matchItems(p, inboxOf(rawFigure(), rawFigure({ id: 'lost', place: { sectionTitles: ['Nope'] }, figure: { ...rawFigure().figure, id: 'f-lost' } })));
  const d = describeDestination(p, fig);
  assert.equal(d.kind, 'new');
  assert.equal(locationLabel(p, d.chapterId, d.sectionId), 'Chapter 2 · 2.2 Project Schedule');
  const lost = describeDestination(p, other);
  assert.equal(locationLabel(p, lost.chapterId, lost.sectionId), 'Unassigned');
});

console.log('applying');
await test('a new figure is added at its place with a first version, and numbered in the report', () => {
  const { p, ch2, schedule } = sampleProject();
  const [item] = matchItems(p, inboxOf(rawFigure()));
  const result = applyItem(p, item, {}, { now: 5_000_000_000_000 });
  assert.deepEqual(result, { kind: 'figure', figureId: 'fig-overview', created: true });
  const fig = p.figures.find((f) => f.id === 'fig-overview');
  assert.equal(fig.title, 'System Overview');
  assert.equal(fig.description, 'The big picture.');
  assert.equal(fig.chapterId, ch2.id);
  assert.equal(fig.sectionId, schedule.id);
  assert.equal(fig.versions.length, 1);
  assert.equal(fig.versions[0].label, 'Added by Claude');
  assert.equal(fig.diagram.elements.length, 3);
  assert.equal(fig.diagram.defaults.fontFamily, p.settings.figureDefaults.fontFamily, 'new figures take the project font defaults');
  assert.equal(getNumbering(p).figures.get('fig-overview').label, 'Figure 1');
  assert.ok(buildDocument(p).figures.some((f) => f.id === 'fig-overview'));
  assert.equal(p.inbox.applied['claude-fig-1'], 5_000_000_000_000);
  assert.equal(matchItems(p, inboxOf(rawFigure())).length, 0, 'applied items are no longer pending');
});
await test('an unplaceable figure is added unassigned', () => {
  const { p } = sampleProject();
  const [item] = matchItems(p, inboxOf(rawFigure({ place: { sectionTitles: ['Nope'] } })));
  applyItem(p, item, {});
  const fig = p.figures[0];
  assert.equal(fig.chapterId, null);
  assert.equal(fig.sectionId, null);
});
await test('an update replaces title, description, type and drawing but keeps the location; the old drawing stays in the versions', () => {
  const { p, ch1 } = sampleProject();
  const [first] = matchItems(p, inboxOf(rawFigure()));
  applyItem(p, first, {}, { now: 1000 });
  const fig = p.figures[0];
  // The student moves it and edits it.
  const s11 = ch1.sections[0];
  fig.chapterId = ch1.id; fig.sectionId = s11.id;
  fig.diagram.elements[0].text = 'Edited by the student';
  fig.comments.push({ id: 'c1', text: 'check', resolved: false });

  const sent = rawFigure({
    createdAt: '2026-06-01T00:00:00Z', title: 'System overview v2', place: { sectionTitles: ['Project Schedule'] },
    figure: { id: 'fig-overview', title: 'System Overview (v2)', type: 'architecture', description: 'Now with a database.', diagram: diagram('Rewritten') },
  });
  const [update] = matchItems(p, inboxOf(sent));
  assert.equal(update.status, 'update');
  assert.equal(describeDestination(p, update).sectionId, s11.id, 'the update stays where the figure is');
  applyItem(p, update, {}, { now: Date.parse('2026-06-02T00:00:00Z') });

  assert.equal(p.figures.length, 1);
  assert.equal(fig.title, 'System Overview (v2)');
  assert.equal(fig.type, 'architecture');
  assert.equal(fig.description, 'Now with a database.');
  assert.equal(fig.diagram.elements[0].text, 'Rewritten');
  assert.equal(fig.chapterId, ch1.id, 'chapter kept');
  assert.equal(fig.sectionId, s11.id, 'section kept');
  assert.equal(fig.comments.length, 1, 'comments kept');
  assert.deepEqual(fig.versions.map((v) => v.label), ['Added by Claude', 'Before update from Claude', 'Updated by Claude']);
  assert.equal(fig.versions[1].snapshot.elements[0].text, 'Edited by the student', 'the student’s drawing is restorable');
  assert.equal(latestVersion(fig).label, 'Updated by Claude');
});
await test('a gantt figure gets a generated diagram (and keeps its schedule data)', () => {
  const { p, ch2, gantt } = sampleProject();
  const [item] = matchItems(p, inboxOf(rawGantt()));
  const parts = figureParts(p, item);
  assert.ok(parts.diagram.elements.length > 20, 'the chart is drawn from the data');
  assert.ok(parts.diagram.elements.some((e) => e.text === 'Planning') && parts.diagram.elements.some((e) => e.text === 'Design'));
  applyItem(p, item, {}, { now: 1000 });
  const fig = p.figures[0];
  assert.equal(fig.type, 'gantt');
  assert.equal(fig.gantt.tasks.length, 2);
  assert.equal(fig.gantt.weekStart, 0, 'normalised (defaults filled in)');
  assert.ok(fig.diagram.elements.length > 20);
  assert.equal(fig.sectionId, gantt.id, 'placed by the first matching title, case-insensitively');
  assert.equal(fig.chapterId, ch2.id);

  // An updated schedule regenerates the picture and keeps the place.
  const sent = rawGantt({ createdAt: '2026-07-01T00:00:00Z' });
  sent.figure.gantt.tasks.push({ id: 't3', name: 'Testing', start: '2026-03-15', end: '2026-04-15', level: 0 });
  const [update] = matchItems(p, inboxOf(sent));
  applyItem(p, update, {}, { now: Date.parse('2026-07-02T00:00:00Z') });
  assert.equal(p.figures.length, 1);
  assert.equal(fig.gantt.tasks.length, 3);
  assert.ok(fig.diagram.elements.some((e) => e.text === 'Testing'));
  assert.equal(fig.sectionId, gantt.id);
});
await test('a project logo is taken from the provided data URL', () => {
  const { p } = sampleProject();
  const [item] = matchItems(p, inboxOf(rawLogo()));
  assert.equal(describeDestination(p, item).kind, 'titlePage');
  assert.throws(() => applyItem(p, item, {}), /missing/);
  assert.equal(p.projectLogo, '', 'nothing changed when the image is missing');
  assert.equal(p.inbox, undefined);
  assert.throws(() => applyItem(p, item, { 'logo-1': 'https://example.com/x.png' }), /missing/, 'only data: images are stored');
  assert.throws(() => applyItem(p, item, new Map([['logo-1', 'data:text/html;base64,AAAA']])), /missing/);
  applyItem(p, item, new Map([['logo-1', PNG]]), { now: 1000 });
  assert.equal(p.projectLogo, PNG);
  assert.equal(buildDocument(p).titlePage.projectLogo, PNG);
  assert.equal(matchItems(p, inboxOf(rawLogo())).length, 0);
  // Claude sends a new logo under the same id.
  const [again] = matchItems(p, inboxOf(rawLogo({ createdAt: '2026-08-01T00:00:00Z' })));
  assert.equal(again.status, 'update');
});
await test('the applied time is never earlier than createdAt (a slow clock cannot re-offer an item)', () => {
  const { p } = sampleProject();
  const items = inboxOf(rawLogo({ createdAt: '2030-01-01T00:00:00Z' }));
  const [item] = matchItems(p, items);
  applyItem(p, item, { 'logo-1': PNG }, { now: 1000 });
  assert.equal(p.inbox.applied['logo-1'], Date.parse('2030-01-01T00:00:00Z'));
  assert.equal(matchItems(p, items).length, 0);
});
await test('dismissing hides an item until Claude sends a newer one; applying clears a dismissal', () => {
  const { p } = sampleProject();
  const items = inboxOf(rawFigure());
  const [item] = matchItems(p, items);
  dismissItem(p, item, { now: Date.parse('2026-05-05T00:00:00Z') });
  assert.equal(matchItems(p, items).length, 0);
  assert.equal(matchItems(p, inboxOf(rawFigure({ createdAt: '2026-05-06T00:00:00Z' }))).length, 1);
  applyItem(p, item, {}, { now: Date.parse('2026-05-07T00:00:00Z') });
  assert.equal(p.inbox.dismissed['claude-fig-1'], undefined);
});

console.log('applying through the store');
/** The smallest store the apply path needs: update() runs the mutator and logs the activity like core/store.js. */
function fakeStore(project) {
  const store = {
    project, updates: 0, activity: [],
    update(mutator, options = {}) {
      const result = mutator(store.project);
      store.updates += 1;
      if (options.activity) store.activity.push(typeof options.activity === 'string' ? options.activity : options.activity.text);
      return result;
    },
  };
  return store;
}
await test('several items are applied in ONE update with one activity entry; Undo puts everything back', async () => {
  const { p } = sampleProject();
  const store = fakeStore(p);
  // An existing figure that will be replaced, plus a logo that is already set.
  p.projectLogo = 'data:image/png;base64,OLD';
  const old = createFigure({ id: 'fig-overview', title: 'Old title', chapterId: p.chapters[0].id });
  p.figures.push(old);
  const before = JSON.stringify(p);

  const items = matchItems(p, inboxOf(rawLogo(), rawFigure(), rawGantt()));
  assert.equal(items.length, 3);
  const res = await applyItems(store, items, { getAsset: async () => PNG, now: 1000 });
  assert.equal(store.updates, 1, 'one store.update for the whole click');
  assert.deepEqual(store.activity, ['Applied 3 updates from Claude']);
  assert.equal(res.applied.length, 3);
  assert.equal(res.failed.length, 0);
  assert.equal(p.projectLogo, PNG);
  assert.equal(p.figures.length, 2, 'the existing figure was updated, the gantt added');
  assert.equal(p.figures[0].title, 'System Overview');
  assert.equal(p.figures[0].chapterId, p.chapters[0].id, 'location kept');
  assert.equal(matchItems(p, inboxOf(rawLogo(), rawFigure(), rawGantt())).length, 0);

  assert.equal(undoApply(store, res.snapshot), true);
  assert.equal(store.updates, 2);
  assert.equal(JSON.stringify(p.figures), JSON.stringify(JSON.parse(before).figures), 'figures are back as they were');
  assert.equal(p.projectLogo, 'data:image/png;base64,OLD');
  assert.equal(matchItems(p, inboxOf(rawLogo(), rawFigure(), rawGantt())).length, 3, 'undone items are pending again');
});
await test('a single item names itself in the activity; a failing image is skipped, the rest is applied', async () => {
  const { p } = sampleProject();
  const store = fakeStore(p);
  const [fig] = matchItems(p, inboxOf(rawFigure()));
  await applyItems(store, [fig], { now: 1000 });
  assert.deepEqual(store.activity, ['Applied an update from Claude: System overview']);

  const items = matchItems(p, inboxOf(rawLogo(), rawGantt()));
  const res = await applyItems(store, items, { getAsset: async () => { throw new Error('offline'); }, now: 2000 });
  assert.equal(res.applied.length, 1);
  assert.equal(res.applied[0].id, 'claude-gantt-1');
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].item.id, 'logo-1');
  assert.equal(p.projectLogo, '');
  assert.equal(matchItems(p, inboxOf(rawLogo(), rawGantt())).map((i) => i.id).join(), 'logo-1', 'the failed item stays pending');
});
await test('Undo of a newly added figure removes it again; undo is refused for another project', async () => {
  const { p } = sampleProject();
  const store = fakeStore(p);
  const res = await applyItems(store, matchItems(p, inboxOf(rawFigure())), { now: 1000 });
  assert.equal(p.figures.length, 1);
  assert.equal(undoApply({ project: { id: 'other' }, update() { throw new Error('should not run'); } }, res.snapshot), false);
  assert.equal(undoApply(store, res.snapshot), true);
  assert.equal(p.figures.length, 0);
});

console.log('fetching');
await test('fetchInbox reads every URL with cache: no-store, merges items and survives failures', async () => {
  const calls = [];
  const files = {
    'https://a.example/inbox.json': { version: 1, items: [rawLogo({ asset: 'assets/a.png' }), rawFigure()] },
    'https://b.example/inbox.json': { version: 1, items: [rawLogo({ asset: 'assets/b.png', createdAt: '2026-09-01T00:00:00Z' })] },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://down.example/inbox.json') throw new TypeError('network down');
    if (url === 'https://gone.example/inbox.json') return { ok: false, status: 404, text: async () => '' };
    if (url === 'https://broken.example/inbox.json') return { ok: true, status: 200, text: async () => '{not json' };
    return { ok: true, status: 200, text: async () => JSON.stringify(files[url]) };
  };
  const result = await fetchInbox(['https://a.example/inbox.json', 'https://b.example/inbox.json', 'https://down.example/inbox.json', 'https://broken.example/inbox.json', 'https://gone.example/inbox.json'], { fetchImpl });
  assert.equal(result.reached, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.init.cache === 'no-store'));
  assert.deepEqual(result.items.map((i) => i.id).sort(), ['claude-fig-1', 'logo-1']);
  assert.equal(result.items.find((i) => i.id === 'logo-1').assetUrl, 'https://b.example/assets/b.png', 'the newest copy wins; its asset is relative to its own file');

  const down = await fetchInbox(['https://down.example/inbox.json'], { fetchImpl });
  assert.deepEqual(down, { reached: false, items: [] });
  const none = await fetchInbox(['https://gone.example/inbox.json'], { fetchImpl });
  assert.deepEqual(none, { reached: true, items: [] }, 'a missing inbox file just means nothing to offer');
});

console.log('translations');
await test('every interface string of the project logo and inbox features has an Arabic text with the same placeholders', async () => {
  const { readFileSync } = await import('node:fs');
  const { AR } = await import('../src/i18n/ar/index.js');
  const { default: mine } = await import('../src/i18n/ar/inbox.js');
  const ph = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
  for (const [key, value] of Object.entries(mine)) assert.equal(ph(value), ph(key), `placeholders of "${key}"`);
  // t('…') / count(…, '…', '…') literals of the files that make up the features (strings shared with other screens come from their dictionaries).
  const files = ['src/inbox/inbox-dialog.js', 'src/inbox/logo-image.js', 'src/app/shell.js', 'src/dashboard/dashboard-view.js', 'src/settings/settings-view.js'];
  const wanted = new Set(['Updates from Claude', 'Updates from Claude ({n})', 'Review the updates Claude left in your repository', 'University logo', 'Project logo', 'Project logo updated.', 'Project logo removed.',
    '1 update from Claude is waiting.', '{n} updates from Claude are waiting.', 'Applied an update from Claude: {title}', 'Applied {n} updates from Claude', 'Undid an update from Claude']);
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [, text] of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) if (/Claude|logo|Logo|repository|updates?\b/i.test(text) || file.includes('inbox')) wanted.add(text.replace(/\\'/g, "'"));
  }
  for (const key of wanted) assert.ok(AR[key], `missing Arabic for "${key}"`);
  assert.ok(wanted.size > 40, 'the scan found the strings');
});

console.log(`\n${passed} inbox tests passed${process.exitCode ? ' (with failures)' : ''}`);
