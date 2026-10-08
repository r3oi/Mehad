// Vector PDF export test (Playwright + Chromium). Run: node tests/pdf-vector.mjs
//
//  * pure helpers (path parser, arcs, colours, transforms, WinAnsi, font mapping) are tested in Node
//  * every figure template, the demo figures, the demo tables, an image figure and an Arabic / ✓ ✗
//    figure are converted in the browser; each PDF is structurally validated (header, xref offsets,
//    stream lengths), inflated and checked for text operators and the expected labels
//  * the Figure editor and Export page PDF buttons must download vector PDFs
//  * PDFs and (with `poppler`) PNG renders are written to OUT_DIR (default /tmp/pdf-vector)
//
// Optional external tools (used when present): pdftotext, pdftoppm, pdfinfo.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 5204);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.OUT_DIR || '/tmp/pdf-vector';
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const check = async (name, fn) => {
  try { await fn(); ok(name); } catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const has = (cmd) => spawnSync('which', [cmd]).status === 0;

// ---------------------------------------------------------------------------
// PDF structure validator (no dependencies): header, xref offsets, stream lengths, page tree.

function validatePdf(buf) {
  const text = buf.toString('latin1');
  assert(text.startsWith('%PDF-1.'), 'missing %PDF header');
  assert(text.trimEnd().endsWith('%%EOF'), 'missing %%EOF');
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  assert(sx, 'missing startxref');
  const xrefPos = Number(sx[1]);
  assert(text.startsWith('xref', xrefPos), 'startxref does not point at "xref"');
  const head = /xref\s+0 (\d+)\s/.exec(text.slice(xrefPos, xrefPos + 40));
  assert(head, 'bad xref header');
  const count = Number(head[1]);
  const entries = text.slice(xrefPos).split('\n').slice(2, 2 + count);
  assert(entries.length === count && entries.every((e) => e.length === 19 || e.length === 20 || /^\d{10} \d{5} [nf]/.test(e)), 'xref entries malformed');
  const trailer = /trailer\s*<<([\s\S]*?)>>\s*startxref/.exec(text);
  assert(trailer && new RegExp(`/Size ${count}\\b`).test(trailer[1]), 'trailer /Size does not match the xref');
  const objects = [];
  for (let n = 1; n < count; n += 1) {
    const off = Number(entries[n].slice(0, 10));
    assert(entries[n].slice(11, 16) === '00000' && entries[n][17] === 'n', `xref entry ${n} not in use`);
    assert(text.startsWith(`${n} 0 obj`, off), `object ${n} is not at offset ${off}`);
    const end = text.indexOf('endobj', off);
    assert(end > off, `object ${n} has no endobj`);
    const body = text.slice(off, end);
    const len = /\/Length (\d+)/.exec(body);
    const s = body.indexOf('stream\n');
    if (s >= 0) {
      assert(len, `stream object ${n} has no /Length`);
      const dataStart = off + s + 7; const L = Number(len[1]);
      assert(text.slice(dataStart + L, dataStart + L + 10).startsWith('\nendstream'), `object ${n}: /Length ${L} does not match the stream`);
      objects.push({ n, dict: body.slice(0, s), data: buf.subarray(dataStart, dataStart + L) });
    } else objects.push({ n, dict: body, data: null });
  }
  const catalog = objects.find((o) => /\/Type \/Catalog/.test(o.dict));
  const page = objects.find((o) => /\/Type \/Page\b/.test(o.dict));
  assert(catalog && page, 'catalog/page missing');
  assert(/\/MediaBox \[0 0 [\d.]+ [\d.]+\]/.test(page.dict), 'page has no MediaBox');
  // Inflate every Flate stream; return all content streams joined.
  let content = '';
  for (const o of objects) {
    if (!o.data) continue;
    if (/\/Subtype \/Image/.test(o.dict)) continue;
    const bytes = /\/FlateDecode/.test(o.dict) ? inflateSync(o.data) : o.data;
    content += `${bytes.toString('latin1')}\n`;
  }
  return { objects, content, images: objects.filter((o) => /\/Subtype \/Image/.test(o.dict)).length, fonts: objects.filter((o) => /\/Type \/Font\b/.test(o.dict)).length };
}

/** Text shown by Tj operators in a decompressed content stream (WinAnsi bytes → string). */
function shownText(content) {
  const out = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m;
  while ((m = re.exec(content))) {
    out.push(m[1].replace(/\\(\d{3}|.)/g, (_, c) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c)));
  }
  return out;
}

// ---------------------------------------------------------------------------
console.log('pure helpers');
const V = await import('../src/export/pdf-vector.js');
const F = await import('../src/export/pdf-fonts.js');

await check('path parser: all commands, implicit repeats, compact numbers and arc flags', () => {
  const segs = V.parsePathData('M10,20 L30 20 40 30 H50 V60 h-5 v-5 C1 2 3 4 5 6 S7 8 9 10 Q1 1 2 2 T3 3 m1 1 l1 1 z');
  assert(segs.filter((s) => s[0] === 'C').length >= 3, 'cubics missing');
  assert(segs.filter((s) => s[0] === 'Z').length === 1, 'close missing');
  const arc = V.parsePathData('M0 0a10 10 0 00 20 0');
  assert(arc.length === 3 && arc.every((s) => s.every((v) => Number.isFinite(v) || typeof v === 'string')), 'compact arc flags');
  const last = arc[arc.length - 1];
  assert(Math.abs(last[5] - 20) < 1e-6 && Math.abs(last[6]) < 1e-6, 'arc end point');
  assert(V.parsePathData('M0 0 L10 10 L oops').length === 2, 'parser must stop at the first error');
});
await check('arcs: half circle = two quarter Béziers, endpoints exact, bulge correct', () => {
  const cs = V.arcToCubics(0, 0, 10, 10, 0, 0, 1, 20, 0);
  assert(cs.length === 2, `expected 2 segments, got ${cs.length}`);
  assert(Math.abs(cs[0][5] - 10) < 1e-6 && Math.abs(Math.abs(cs[0][6]) - 10) < 1e-6, 'mid point of the arc');
  assert(cs[0][6] < 0, 'sweep=1 from left to right bulges upwards (negative y)');
  assert(V.arcToCubics(0, 0, 5, 5, 0, 0, 1, 0, 0).length === 0, 'zero-length arc');
});
await check('colours: hex, rgb(), rgba(), names, none/transparent', () => {
  const c = V.parseColor('#1f2937'); assert(Math.abs(c.r - 0x1f / 255) < 1e-9 && c.a === 1, 'hex6');
  assert(V.parseColor('#fff').g === 1, 'hex3');
  assert(V.parseColor('rgb(255, 0, 0)').r === 1, 'rgb');
  assert(Math.abs(V.parseColor('rgba(0,0,0,.5)').a - 0.5) < 1e-9, 'rgba');
  assert(V.parseColor('navy').b > 0.49, 'named');
  assert(V.parseColor('none') === null && V.parseColor('transparent') === null && V.parseColor('rgba(0,0,0,0)') === null, 'none');
});
await check('transforms: translate/scale/rotate/matrix compose left to right', () => {
  const m = V.parseTransform('translate(10 20) scale(2)');
  assert(m[0] === 2 && m[3] === 2 && m[4] === 10 && m[5] === 20, 'translate+scale');
  const r = V.parseTransform('rotate(90 10 10)');
  assert(Math.abs(r[0]) < 1e-9 && Math.abs(r[1] - 1) < 1e-9 && Math.abs(r[4] - 20) < 1e-9 && Math.abs(r[5]) < 1e-9, 'rotate about a point');
  assert(V.parseTransform('matrix(1 2 3 4 5 6)').join() === '1,2,3,4,5,6', 'matrix');
});
await check('WinAnsi encoding, widths and font mapping', () => {
  assert(F.encodeWinAnsi('a–b “q” • … € é')?.join() === [97, 150, 98, 32, 147, 113, 148, 32, 149, 32, 133, 32, 128, 32, 233].join(), 'punctuation bytes');
  assert(F.encodeWinAnsi('✓') === null && F.encodeWinAnsi('مرحبا') === null && F.encodeWinAnsi('←') === null, 'non-WinAnsi must be null');
  const times = F.pickFont("'Times New Roman', Times, serif"); assert(times.base === 'Times-Roman', 'times');
  assert(F.pickFont('Cambria, Caladea, Georgia, serif', true, true).base === 'Times-BoldItalic', 'cambria → times bold italic');
  assert(F.pickFont("Calibri, Carlito, 'Segoe UI', Arial, sans-serif", true).base === 'Helvetica-Bold', 'calibri → helvetica bold');
  assert(F.pickFont('Inter, sans-serif', false, true).base === 'Helvetica-Oblique', 'inter → helvetica oblique');
  assert(F.pickFont("'Courier New', Courier, monospace").base === 'Courier', 'courier');
  assert(Math.abs(F.textWidth('Hello', times, 10) - 22.22) < 1e-6, 'AFM Times width of "Hello"');
  assert(F.textWidth('iiii', F.pickFont('Courier'), 10) === 24, 'Courier is 600/1000');
  assert(F.pdfLiteral(new Uint8Array([0x28, 0x29, 0x5c, 0xe9])) === '(\\(\\)\\\\\\351)', 'string escaping');
  assert(F.pdfTextString('Figure 1') === '(Figure 1)' && F.pdfTextString('عربي').startsWith('<FEFF'), 'info strings');
});

// ---------------------------------------------------------------------------
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
await page.goto(BASE);
await page.waitForFunction(() => window.graddocs?.store?.project);

console.log('conversion in the browser');
const items = await page.evaluate(async () => {
  const { figureTypes, buildTemplate } = await import('/src/figures/types.js');
  const { renderFigureSVG } = await import('/src/figures/render.js');
  const { tableSVG, figureSVG } = await import('/src/export/package.js');
  const { convertSvgToPdf } = await import('/src/export/pdf-vector.js');
  const { svgToPdfBlob, rasterSvgToPdfBlob } = await import('/src/export/pdf.js');
  const project = window.graddocs.store.project;
  const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
  const list = [];
  const labelsOf = (diagram) => diagram.elements.map((e) => e.text).filter(Boolean).flatMap((t) => String(t).split('\n')).map((t) => t.trim()).filter((t) => t && !/^-+$/.test(t));
  for (const t of figureTypes()) { const d = buildTemplate(t.id, project); list.push({ name: `tpl-${t.id}`, ...renderFigureSVG(d), title: t.name, labels: labelsOf(d) }); }
  project.figures.forEach((f, i) => list.push({ name: `demo-fig-${i + 1}`, ...figureSVG(project, f), title: f.title, labels: labelsOf(f.diagram) }));
  project.tables.forEach((tb, i) => list.push({ name: `demo-table-${i + 1}`, ...tableSVG(project, tb), title: tb.title, labels: tb.rows.flat().filter((c) => !c.hidden).flatMap((c) => String(c.text ?? '').split('\n')).map((s) => s.trim()).filter(Boolean) }));
  // Figure with image nodes (PNG with alpha + JPEG) and an opacity group.
  const canvasURL = (w, h, draw, type, q) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c.toDataURL(type, q); };
  const png = canvasURL(160, 100, (x, w, h) => { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#4f46e5'); g.addColorStop(1, '#22c55e'); x.fillStyle = g; x.beginPath(); x.roundRect(10, 10, w - 20, h - 20, 20); x.fill(); }, 'image/png');
  const jpg = canvasURL(120, 120, (x) => { x.fillStyle = '#fde68a'; x.fillRect(0, 0, 120, 120); x.fillStyle = '#b91c1c'; x.fillRect(20, 20, 80, 80); }, 'image/jpeg', 0.9);
  const imgDiagram = { background: '#ffffff', defaults: { fontFamily: 'Arial', fontSize: 14 }, elements: [
    { id: 'a', type: 'node', shape: 'image', x: 40, y: 40, w: 240, h: 150, text: '', src: png, style: { stroke: '#111827', strokeWidth: 1 } },
    { id: 'b', type: 'node', shape: 'image', x: 340, y: 40, w: 150, h: 150, text: '', src: jpg, style: {} },
    { id: 'c', type: 'node', shape: 'rect', x: 40, y: 240, w: 200, h: 60, text: 'Caption under image', style: { opacity: 0.5, fill: '#fde68a', shadow: true } },
    { id: 'd', type: 'edge', source: { id: 'a', anchor: { x: 0.5, y: 1 } }, target: { id: 'c', anchor: { x: 0.5, y: 0 } }, routing: 'orthogonal', text: 'uses', style: {} },
  ] };
  list.push({ name: 'image-figure', ...renderFigureSVG(imgDiagram), title: 'Image figure', labels: ['Caption under image', 'uses'], images: 2 });
  // Arabic labels, ✓ ✗ ← (raster chunks) mixed with ordinary vector text.
  const arDiagram = { background: '#ffffff', defaults: { fontFamily: 'Times New Roman', fontSize: 16 }, elements: [
    { id: 'a', type: 'node', shape: 'roundRect', x: 40, y: 40, w: 200, h: 70, text: 'تسجيل الدخول', style: {} },
    { id: 'b', type: 'node', shape: 'rect', x: 340, y: 40, w: 220, h: 70, text: 'Check ✓ passed\nSecond line', style: { fontFamily: 'Arial' } },
    { id: 'c', type: 'node', shape: 'rect', x: 40, y: 200, w: 220, h: 70, text: 'Failed ✗ retry ←', style: { fontWeight: 'bold' } },
    { id: 'd', type: 'node', shape: 'ellipse', x: 340, y: 200, w: 220, h: 80, text: 'الاسم: Ahmed محمد\nVector line', style: { fontFamily: 'Calibri', fontSize: 18 } },
    { id: 'e', type: 'edge', source: { id: 'a' }, target: { id: 'b' }, routing: 'straight', text: 'نعم ✓', style: { endArrow: 'triangle' } },
  ] };
  list.push({ name: 'arabic-figure', ...renderFigureSVG(arDiagram), title: 'شكل عربي – Arabic', labels: ['Second line', 'Vector line'], rasterChunks: 5 });

  const out = [];
  for (const it of list) {
    const rec = { name: it.name, labels: it.labels, images: it.images, rasterChunks: it.rasterChunks, width: it.width, height: it.height };
    try {
      const { blob, stats } = await convertSvgToPdf(it.svg, { title: it.title, width: it.width, height: it.height });
      rec.pdf = await b64(blob); rec.stats = stats;
      rec.viaApi = (await svgToPdfBlob(it.svg, it.width, it.height, { scale: 3, title: it.title })).size;
    } catch (e) { rec.error = e.stack || e.message; }
    try { rec.rasterSize = (await rasterSvgToPdfBlob(it.svg, it.width, it.height, { scale: 3, title: it.title })).size; } catch { /* optional */ }
    rec.svg = it.svg;
    out.push(rec);
  }
  return out;
});

const rows = [];
for (const it of items) {
  await check(`${it.name}: valid vector PDF`, async () => {
    assert(!it.error, `conversion threw: ${it.error}`);
    const buf = Buffer.from(it.pdf, 'base64');
    writeFileSync(join(OUT, `${it.name}.pdf`), buf);
    writeFileSync(join(OUT, `${it.name}.svg`), it.svg);
    const v = validatePdf(buf);
    const shown = shownText(v.content);
    const WINANSI = /^[\x20-\x7e\xa0-\xff–—‘’“”•…€]*$/;
    const textual = it.labels.filter((l) => WINANSI.test(l));
    const needsRaster = it.labels.some((l) => !WINANSI.test(l));
    if (textual.length) assert(/\bBT\b/.test(v.content) && shown.length > 0, 'no text operators (Tj) in the PDF');
    const squash = (str) => str.replace(/\s+/g, '');
    const joined = squash(shown.join(''));
    for (const label of textual) assert(joined.includes(squash(label)), `label "${label}" is not selectable text in the PDF`);
    if (it.images) assert(v.images >= it.images, `expected ${it.images} image XObjects, found ${v.images}`);
    if (it.rasterChunks) assert(it.stats.rasterTextChunks === it.rasterChunks, `expected ${it.rasterChunks} raster chunks, got ${it.stats.rasterTextChunks}`);
    if (!it.images && !needsRaster && !it.rasterChunks) assert(v.images === 0, 'plain figures must not embed images');
    if (needsRaster && !it.images) assert(it.stats.rasterTextChunks > 0, 'non-WinAnsi text should be drawn as raster chunks');
    assert(it.viaApi === buf.length || Math.abs(it.viaApi - buf.length) < 64, 'svgToPdfBlob did not use the vector path');
    rows.push([it.name, buf.length, it.rasterSize || 0]);
  });
}

console.log('size: vector vs previous raster PDF');
for (const [name, v, r] of rows) if (r) console.log(`  ${name.padEnd(22)} ${String(v).padStart(7)} B   (raster ${String(r).padStart(7)} B, ${(r / v).toFixed(0)}x larger)`);

console.log('external tools');
if (has('pdftotext')) {
  await check('pdftotext extracts the labels of a table and a figure', () => {
    const t = spawnSync('pdftotext', ['-layout', join(OUT, 'demo-table-1.pdf'), '-'], { encoding: 'utf8' }).stdout;
    assert(/Feature ID/.test(t) && /Feature Name/.test(t), 'table text not extractable');
    const f = spawnSync('pdftotext', ['-layout', join(OUT, 'tpl-erd.pdf'), '-'], { encoding: 'utf8' }).stdout;
    assert(/WORKSPACE/.test(f) && /owns/.test(f), 'figure text not extractable');
  });
} else console.log('  (pdftotext not installed — skipped)');
if (has('pdftoppm')) {
  await check('pdftoppm renders every PDF without errors', () => {
    for (const it of items) {
      if (!it.pdf) continue;
      const r = spawnSync('pdftoppm', ['-r', '96', '-png', '-singlefile', join(OUT, `${it.name}.pdf`), join(OUT, `${it.name}.render`)], { encoding: 'utf8' });
      assert(r.status === 0 && !r.stderr.trim(), `${it.name}: ${r.stderr}`);
    }
  });
} else console.log('  (pdftoppm not installed — skipped)');

console.log('raster fallback');
await check('svgToPdfBlob falls back to a raster PDF when the vector conversion throws', async () => {
  const r = await page.evaluate(async () => {
    const { svgToPdfBlob } = await import('/src/export/pdf.js');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#f00"/></svg>';
    const warn = console.warn; let warned = false; console.warn = () => { warned = true; };
    const D = window.DOMParser; window.DOMParser = class { parseFromString() { throw new Error('boom'); } };
    let blob; try { blob = await svgToPdfBlob(svg, 40, 30, { scale: 2, title: 't' }); } finally { window.DOMParser = D; console.warn = warn; }
    const forced = await svgToPdfBlob(svg, 40, 30, { scale: 2, title: 't', vector: false });
    const text = async (b) => new TextDecoder('latin1').decode(new Uint8Array(await b.arrayBuffer()));
    return { warned, fallbackIsImage: /\/Subtype \/Image/.test(await text(blob)), forcedIsImage: /\/Subtype \/Image/.test(await text(forced)), vectorHasImage: /\/Subtype \/Image/.test(await text(await svgToPdfBlob(svg, 40, 30))) };
  });
  assert(r.warned && r.fallbackIsImage && r.forcedIsImage, `fallback not used: ${JSON.stringify(r)}`);
  assert(!r.vectorHasImage, 'the default path must be vector');
});

console.log('PDF buttons in the app');
const pid = await page.evaluate(() => window.graddocs.store.project.id);
const figId = await page.evaluate(() => window.graddocs.store.project.figures[0].id);
const sizeOf = (buf) => buf.length;
const download = async (trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), trigger()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), buf: readFileSync(path) };
};
const assertVector = (buf, minText) => {
  const v = validatePdf(buf);
  assert(/\bBT\b/.test(v.content) && /Tj/.test(v.content), 'PDF has no text operators — still a bitmap?');
  assert(v.images === 0, `PDF contains ${v.images} image(s)`);
  assert(shownText(v.content).length >= minText, 'too little selectable text');
  return v;
};
await check('Figure editor → Export → PDF downloads a vector PDF', async () => {
  await page.goto(`${BASE}#/p/${pid}/figures/${figId}`);
  await page.waitForFunction(() => window.graddocs.editor);
  const { name, buf } = await download(async () => {
    await page.click('[data-action="export"]');
    await page.getByText('PDF', { exact: true }).first().click();
  });
  assert(name.endsWith('.pdf'), `unexpected file name ${name}`);
  writeFileSync(join(OUT, `ui-editor-${name}`), buf);
  assertVector(buf, 5);
  assert(sizeOf(buf) < 40000, `PDF is ${sizeOf(buf)} bytes`);
  console.log(`    ${name}: ${sizeOf(buf)} bytes`);
});
await check('Export page → figure PDF and table PDF download vector PDFs', async () => {
  await page.goto(`${BASE}#/p/${pid}/export`); await page.waitForTimeout(600);
  const fig = await download(() => page.locator('[data-action="fig-pdf"]').first().click());
  writeFileSync(join(OUT, `ui-export-${fig.name}`), fig.buf);
  assertVector(fig.buf, 5);
  const tab = await download(() => page.locator('[data-action="tab-pdf"]').first().click());
  writeFileSync(join(OUT, `ui-export-${tab.name}`), tab.buf);
  assertVector(tab.buf, 5);
  assert(fig.buf.length < 40000 && tab.buf.length < 40000, `sizes ${fig.buf.length} / ${tab.buf.length}`);
  console.log(`    ${fig.name}: ${fig.buf.length} bytes, ${tab.name}: ${tab.buf.length} bytes`);
});
await check('Figures list → PDF and Tables list → PDF download vector PDFs', async () => {
  const exported = await page.evaluate(async () => {
    const { exportFigure } = await import('/src/figures/figures-view.js');
    const { exportTable } = await import('/src/tables/tables-view.js');
    const p = window.graddocs.store.project;
    window.__dl = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() { window.__dl.push({ name: this.download, href: this.href }); };
    try { await exportFigure(p, p.figures[0], 'pdf'); await exportTable(p, p.tables[0], 'pdf'); } finally { HTMLAnchorElement.prototype.click = origClick; }
    const out = [];
    for (const d of window.__dl) { const buf = new Uint8Array(await (await fetch(d.href)).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); out.push({ name: d.name, b64: btoa(s) }); }
    return out;
  });
  assert(exported.length === 2, `expected 2 downloads, got ${exported.length}`);
  for (const d of exported) assertVector(Buffer.from(d.b64, 'base64'), 5);
});

await browser.close();
stop();
if (errors.length) { console.error('\nbrowser errors:\n  ' + errors.slice(0, 8).join('\n  ')); failures += 1; }
console.log(failures ? `\n${failures} check(s) failed` : '\nall vector PDF checks passed');
process.exit(failures ? 1 : 0);
