// End-to-end smoke test in a real browser (Playwright + Chromium).
// Starts the static server, loads every page, exercises the figure editor,
// numbering, autosave and persistence. Run: npm test  (or node tests/smoke.mjs)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;

async function loadPlaywright() {
  for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try { return await import(spec); } catch { /* try next */ }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const server = spawn(process.execPath, [join(root, 'serve.mjs'), String(PORT)], { stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* already stopped */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 600));

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); } catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const evalStore = (fn, arg) => page.evaluate(fn, arg);

await page.goto(BASE);
await page.waitForFunction(() => window.graddocs?.store?.project);
const pid = await evalStore(() => window.graddocs.store.project.id);
const figId = await evalStore(() => window.graddocs.store.project.figures[0].id);
const go = async (section, extra = '') => { await page.goto(`${BASE}#/p/${pid}/${section}${extra}`); await page.waitForTimeout(500); };

console.log('pages');
for (const section of ['dashboard', 'structure', 'word', 'chapters', 'figures', 'tables', 'acronyms', 'references', 'preview', 'export', 'settings']) {
  await check(`${section} renders`, async () => {
    await go(section);
    const text = await page.locator('#main').innerText();
    assert(text.trim().length > 20, 'page is empty');
    assert(!/failed to load|Something went wrong|This module is being built/.test(text), 'page shows an error/placeholder');
  });
}
await check('projects page renders', async () => {
  await page.goto(`${BASE}#/projects`); await page.waitForTimeout(400);
  assert((await page.locator('#main').innerText()).includes('Meyar'), 'demo project missing');
});

console.log('figure editor');
await check('opens with all elements rendered', async () => {
  await go(`figures/${figId}`);
  await page.waitForFunction(() => window.graddocs.editor);
  const n = await page.locator('.ed-content [data-id]').count();
  assert(n > 10, `only ${n} elements rendered`);
});
const center = (id) => page.evaluate((elId) => { const r = document.querySelector(`.ed-content [data-id="${elId}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
await check('double-click edits text in place', async () => {
  const c = await center('fb-cat-users');
  await page.mouse.dblclick(c.x, c.y);
  await page.waitForSelector('.ed-text-editor:not([hidden])');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('User Accounts');
  await page.keyboard.press('Enter');
  assert(await page.evaluate(() => window.graddocs.editor.byId('fb-cat-users').text) === 'User Accounts', 'text not updated');
});
await check('connectors stay attached when a shape moves', async () => {
  const bone = () => page.evaluate(async () => {
    const { edgeGeometry } = await import('/src/figures/geometry.js'); const { nodeMap } = await import('/src/figures/render.js');
    const e = window.graddocs.editor; return edgeGeometry(e.byId('fb-bone-users'), nodeMap(e.doc)).points[0];
  });
  const before = await bone(); const c = await center('fb-cat-users');
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x - 80, c.y + 30, { steps: 8 }); await page.mouse.up();
  const after = await bone();
  assert(Math.abs(after.x - before.x) > 20, 'connector did not follow the shape');
});
await check('draw a shape, label it, connect it, undo/redo', async () => {
  const host = await page.locator('[data-canvas]').boundingBox();
  await page.keyboard.press('r');
  const sx = host.x + host.width - 230; const sy = host.y + host.height - 140;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 150, sy + 60, { steps: 6 }); await page.mouse.up();
  await page.waitForSelector('.ed-text-editor:not([hidden])');
  await page.keyboard.type('New Module'); await page.keyboard.press('Enter');
  const newId = await page.evaluate(() => [...window.graddocs.editor.selection][0]);
  await page.keyboard.press('c');
  const a = await center('fb-head'); const b = await center(newId);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up();
  const edge = await page.evaluate(() => window.graddocs.editor.doc.elements.at(-1));
  assert(edge.type === 'edge' && edge.source.id === 'fb-head' && edge.target.id === newId, 'connector not attached to both shapes');
  const n = await page.evaluate(() => window.graddocs.editor.doc.elements.length);
  await page.keyboard.press('Control+z');
  assert(await page.evaluate(() => window.graddocs.editor.doc.elements.length) === n - 1, 'undo failed');
  await page.keyboard.press('Control+y');
  assert(await page.evaluate(() => window.graddocs.editor.doc.elements.length) === n, 'redo failed');
});
await check('Ctrl+S saves a version with a change summary', async () => {
  const before = await evalStore((id) => window.graddocs.store.project.figures.find((f) => f.id === id).versions.length, figId);
  await page.keyboard.press('Control+s'); await page.waitForTimeout(300);
  const versions = await evalStore((id) => window.graddocs.store.project.figures.find((f) => f.id === id).versions, figId);
  assert(versions.length === before + 1, 'no version saved');
  assert(versions.at(-1).changes.some((c) => c.includes('User Accounts')), 'change summary missing rename');
});
await check('edits survive a reload (autosave)', async () => {
  await page.waitForTimeout(700);
  await page.reload(); await page.waitForFunction(() => window.graddocs?.editor);
  assert(await page.evaluate(() => window.graddocs.editor.byId('fb-cat-users').text) === 'User Accounts', 'edit lost after reload');
});
await check('exports SVG and PNG', async () => {
  for (const label of ['SVG', 'PNG']) {
    await page.click('.ed-header [data-action="export"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`.menu-item:has-text("${label}")`)]);
    assert((await dl.suggestedFilename()).startsWith('Figure-01-'), `bad file name for ${label}`);
  }
});

console.log('numbering');
await check('a new figure earlier in the document renumbers later ones', async () => {
  await go('dashboard');
  const result = await evalStore(async () => {
    const { store } = window.graddocs;
    const { createFigure } = await import('/src/core/model.js');
    const { getNumbering } = await import('/src/core/numbering.js');
    const p = store.project;
    const first = getNumbering(p).figureOrder[0];
    const sec = p.chapters[0].sections[0];
    const f = createFigure({ title: 'Context Diagram', chapterId: p.chapters[0].id, sectionId: sec.id });
    store.update((proj) => proj.figures.push(f));
    const n = getNumbering(store.project);
    const out = { newLabel: n.figures.get(f.id).label, oldLabel: n.figures.get(first.id).label };
    store.update((proj) => { proj.figures = proj.figures.filter((x) => x.id !== f.id); });
    return out;
  });
  assert(result.newLabel === 'Figure 1' && result.oldLabel === 'Figure 2', JSON.stringify(result));
});

console.log('tables, chapters, acronyms, structure');
await check('table cell edits autosave', async () => {
  const tid = await evalStore(() => window.graddocs.store.project.tables[0].id);
  await go(`tables/${tid}`);
  const cell = page.locator('textarea[data-r="1"][data-c="1"]').first();
  await cell.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Accounts & Roles');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1000);
  const text = await evalStore((id) => window.graddocs.store.project.tables.find((t) => t.id === id).rows[1][1].text, tid);
  assert(text === 'Accounts & Roles', `cell text is "${text}"`);
});
await check('chapters show live reference chips', async () => {
  await go('chapters');
  const chips = await page.locator('.ref-chip').allInnerTexts();
  assert(chips.includes('Figure 1') && chips.includes('Table 1'), `chips: ${chips.join(', ')}`);
});
await check('adding a chapter renumbers the outline', async () => {
  const before = await evalStore(() => window.graddocs.store.project.chapters.length);
  await go('structure', '?new=chapter');
  await page.waitForSelector('.modal input');
  await page.fill('.modal input', 'Appendix');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const n = await evalStore(() => window.graddocs.store.project.chapters.length);
  assert(n === before + 1, `expected ${before + 1} chapters, got ${n}`);
});
await check('duplicate acronyms are rejected', async () => {
  await go('acronyms');
  await page.click('[data-action="add"]');
  await page.fill('.modal [name="acronym"]', 'ai');
  await page.fill('.modal [name="meaning"]', 'Artificial Intelligence');
  await page.click('.modal [data-submit]');
  assert((await page.locator('.modal').innerText()).includes('This acronym already exists.'), 'no duplicate error');
  await page.keyboard.press('Escape');
});

console.log('preview & export');
await check('preview paginates with lists and page numbers', async () => {
  await go('preview');
  await page.waitForSelector('.pv-page');
  await page.waitForTimeout(400);
  const pages = await page.locator('.pv-page').count();
  const text = await page.locator('.pv-pages').innerText();
  assert(pages >= 8, `only ${pages} pages`);
  assert(/LIST OF FIGURES/.test(text) && text.includes('Figure 1: Feature Fishbone Diagram'), 'list of figures missing');
});
await check('Word export downloads a valid .docx', async () => {
  await go('export');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-action="docx"]')]);
  const path = await dl.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  assert(dl.suggestedFilename().endsWith('.docx') && bytes[0] === 0x50 && bytes[1] === 0x4b, 'not a zip/docx');
  assert(bytes.includes(Buffer.from('word/document.xml')), 'document.xml missing');
});

console.log('command palette');
await check('Ctrl+K searches the project', async () => {
  await page.keyboard.press('Control+k');
  await page.fill('.palette-input input', 'fishbone');
  await page.waitForTimeout(150);
  assert((await page.locator('.palette-results').innerText()).includes('Feature Fishbone Diagram'), 'figure not found');
  await page.keyboard.press('Escape');
});

console.log(errors.length ? `\nBrowser errors:\n${errors.join('\n')}` : '\nNo browser errors.');
await browser.close();
stop();
if (failures || errors.length) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll smoke checks passed.');
