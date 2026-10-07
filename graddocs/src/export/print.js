// Printable lists (TOC, list of figures / tables / acronyms, document structure).
// The HTML builders are shared by "Open printable PDF" (a print window, use "Save as PDF" in the
// print dialog) and by the documentation package, which ships them as standalone .html files.
// Page numbers are shown as an em dash: real page numbers come from Word's field update.
// The lists themselves are the report (English, left-to-right paper) and are never translated; only the
// print window's own toolbar and the pop-up error follow the app language.
import { esc } from '../ui/dom.js';
import { t, isRTL } from '../i18n/index.js';
import { buildDocument } from '../core/document.js';
import { getNumbering } from '../core/numbering.js';
import { findNode, DEFAULT_SETTINGS, SECTION_STATUSES, FRONT_MATTER_KINDS } from '../core/model.js';

const PAGE_HOLDER = '\u2014';
/** Report-language status names (SECTION_STATUSES labels follow the app language, the printed list must not). */
const STATUS_LABELS = { todo: 'Not started', draft: 'Draft', review: 'In review', done: 'Done' };

const cfgOf = (settings) => ({
  page: { ...DEFAULT_SETTINGS.page, ...(settings?.page || {}), margins: { ...DEFAULT_SETTINGS.page.margins, ...(settings?.page?.margins || {}) } },
  typography: { ...DEFAULT_SETTINGS.typography, ...(settings?.typography || {}), headingSizes: { ...DEFAULT_SETTINGS.typography.headingSizes, ...(settings?.typography?.headingSizes || {}) } },
  chapterTitle: { ...DEFAULT_SETTINGS.chapterTitle, ...(settings?.chapterTitle || {}) },
});

/** Heading for a generated list: the front-matter item's own title when present. */
function listTitle(project, kind) {
  const item = project.frontMatter?.find((f) => f.kind === kind);
  const title = item?.title || FRONT_MATTER_KINDS[kind]?.title || kind;
  return cfgOf(project.settings).chapterTitle.style === 'upper' ? title.toUpperCase() : title;
}

/** Stylesheet used by the print window and the standalone HTML files. */
export function printCSS(settings) {
  const { page, typography: typo } = cfgOf(settings);
  const m = page.margins;
  const font = String(typo.fontFamily || 'Times New Roman').replace(/["\\]/g, '');
  const size = page.size === 'Letter' ? 'Letter' : 'A4';
  const [w, h] = size === 'Letter' ? [21.59, 27.94] : [21, 29.7];
  const sheetW = page.orientation === 'landscape' ? h : w;
  return `
@page { size: ${size} ${page.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "${font}", "Times New Roman", Times, "Liberation Serif", serif; font-size: ${typo.fontSize}pt; line-height: ${typo.lineSpacing > 1.3 ? 1.35 : typo.lineSpacing}; color: #000; background: #fff; }
h1, h2, h3 { font-weight: 700; margin: 0; line-height: 1.25; }
.doc-title { text-align: center; font-size: ${typo.headingSizes.h1}pt; margin: 0 0 1.1em; text-transform: none; }
.doc-subtitle { text-align: center; font-size: ${Math.max(10, typo.fontSize - 1)}pt; color: #555; margin: -0.7em 0 1.4em; }
.doc-note { color: #555; font-style: italic; margin: 0; }
.toolbar { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #f2f4f7; border-bottom: 1px solid #d0d5dd; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #344054; }
.toolbar button { font: 600 13px system-ui, sans-serif; padding: 7px 14px; border-radius: 7px; border: 1px solid #4f46e5; background: #4f46e5; color: #fff; cursor: pointer; }
.toolbar button:hover { background: #4338ca; }

/* Dotted-leader lines */
.toc-line { display: flex; align-items: baseline; gap: 0.35em; margin: 0 0 0.38em; line-height: 1.3; break-inside: avoid; }
.toc-line .t { flex: 0 1 auto; min-width: 0; }
.toc-line .dots { flex: 1 1 1.2em; min-width: 1em; border-bottom: 1.5px dotted #333; transform: translateY(-0.28em); }
.toc-line .pg { flex: none; min-width: 1.6em; text-align: right; font-variant-numeric: tabular-nums; }
.toc-l1 { font-weight: 700; margin-top: 0.85em; }
.toc-l1:first-of-type { margin-top: 0; }
.toc-l2 { padding-left: 1.5em; }
.toc-l3 { padding-left: 3em; }
.toc-l4 { padding-left: 4.5em; }

/* Acronyms */
table.acr { width: 100%; border-collapse: collapse; }
table.acr td { padding: 5px 10px 5px 0; vertical-align: top; break-inside: avoid; }
table.acr td.a { width: 28%; font-weight: 700; }

/* Document structure */
.st-line { display: flex; align-items: baseline; gap: 0.6em; margin: 0 0 0.3em; line-height: 1.3; break-inside: avoid; }
.st-line .num { flex: none; min-width: 2.6em; font-variant-numeric: tabular-nums; }
.st-line .tt { flex: 0 1 auto; min-width: 0; }
.st-line .dots { flex: 1 1 1em; min-width: 0.8em; border-bottom: 1.5px dotted #999; transform: translateY(-0.28em); }
.st-line .meta { flex: none; font-size: 0.8em; color: #555; }
.st-d0 { font-weight: 700; margin-top: 0.95em; font-size: 1.04em; }
.st-d1 { padding-left: 1.2em; }
.st-d2 { padding-left: 2.4em; }
.st-d3 { padding-left: 3.6em; }
.st-item { display: block; margin: 0 0 0.2em; color: #444; font-size: 0.86em; font-style: italic; line-height: 1.3; break-inside: avoid; }
.st-i1 { padding-left: 2.4em; } .st-i2 { padding-left: 3.6em; } .st-i3 { padding-left: 4.8em; } .st-i4 { padding-left: 6em; }
.status { display: inline-block; font-size: 0.72em; font-weight: 700; line-height: 1; padding: 3px 8px; border-radius: 99px; border: 1px solid #bbb; color: #555; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
.status.s-draft { color: #9a5b00; border-color: #e5b567; background: #fff7e6; }
.status.s-review { color: #1d4ed8; border-color: #9db8f5; background: #eff6ff; }
.status.s-done { color: #047857; border-color: #7dd3ae; background: #ecfdf3; }
.st-summary { display: flex; flex-wrap: wrap; gap: 1.4em; justify-content: center; margin: 0 0 1.6em; font-size: 0.9em; color: #444; }
.st-summary b { color: #000; }

@media screen {
  body { background: #e9ecf1; }
  .sheet { width: ${sheetW}cm; max-width: calc(100% - 32px); margin: 24px auto; padding: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; background: #fff; box-shadow: 0 1px 3px rgba(16,24,40,.15), 0 10px 28px rgba(16,24,40,.12); min-height: 12cm; }
}
@media print {
  .toolbar, .no-print { display: none !important; }
  body { background: #fff; }
  .sheet { width: auto; max-width: none; margin: 0; padding: 0; box-shadow: none; }
}`;
}

/** Complete standalone HTML document (inline CSS) around a body fragment. */
export function wrapHTMLDocument(title, bodyHTML, settings, { toolbar = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${printCSS(settings)}</style>
</head>
<body>
${toolbar ? `<div class="toolbar"${isRTL ? ' dir="rtl" lang="ar"' : ''}><span>${t('Use {saveAsPdf} as the destination in the print dialog.', { saveAsPdf: `<b>${esc(t('Save as PDF'))}</b>` })}</span><button type="button" onclick="window.print()">${esc(t('Print / Save as PDF'))}</button></div>` : ''}
<main class="sheet">
${bodyHTML}
</main>
</body>
</html>
`;
}

/**
 * Open a print window with `bodyHTML` and start printing once fonts and images have loaded.
 * Throws an Error when the browser blocked the pop-up (callers show it in a toast).
 */
export function printHTML(title, bodyHTML, { settings, autoPrint = true } = {}) {
  const win = window.open('', '_blank');
  if (!win) throw new Error(t('The print window was blocked by your browser. Allow pop-ups for this site and try again.'));
  win.document.open();
  win.document.write(wrapHTMLDocument(title, bodyHTML, settings, { toolbar: true }));
  win.document.close();
  if (autoPrint) {
    const go = async () => {
      try {
        await win.document.fonts?.ready;
        await Promise.all([...win.document.images].map((img) => (img.complete ? null : new Promise((res) => { img.onload = res; img.onerror = res; }))));
      } catch { /* print anyway */ }
      setTimeout(() => { try { win.focus(); win.print(); } catch (err) { console.warn('[print]', err); } }, 200);
    };
    if (win.document.readyState === 'complete') go();
    else win.addEventListener('load', go, { once: true });
  }
  return win;
}

// ---------------------------------------------------------------------------
// HTML builders

const line = (cls, text) => `<div class="toc-line ${cls}"><span class="t">${esc(text)}</span><span class="dots"></span><span class="pg">${PAGE_HOLDER}</span></div>`;

export function tocHTML(project) {
  const doc = buildDocument(project);
  const body = doc.toc.length
    ? doc.toc.map((e) => line(`toc-l${Math.min(4, e.level)}`, e.text)).join('\n')
    : '<p class="doc-note">The document has no chapters yet.</p>';
  return `<h1 class="doc-title">${esc(listTitle(project, 'toc'))}</h1>\n${body}`;
}

export function listOfFiguresHTML(project) {
  const doc = buildDocument(project);
  const body = doc.figures.length
    ? doc.figures.map((f) => line('toc-flat', f.caption)).join('\n')
    : '<p class="doc-note">The document has no figures yet.</p>';
  return `<h1 class="doc-title">${esc(listTitle(project, 'lof'))}</h1>\n${body}`;
}

export function listOfTablesHTML(project) {
  const doc = buildDocument(project);
  const body = doc.tables.length
    ? doc.tables.map((tb) => line('toc-flat', tb.caption)).join('\n')
    : '<p class="doc-note">The document has no tables yet.</p>';
  return `<h1 class="doc-title">${esc(listTitle(project, 'lot'))}</h1>\n${body}`;
}

export function acronymsHTML(project) {
  const doc = buildDocument(project);
  const body = doc.acronyms.length
    ? `<table class="acr"><tbody>\n${doc.acronyms.map((a) => `<tr><td class="a">${esc(a.acronym)}</td><td>${esc(a.meaning)}</td></tr>`).join('\n')}\n</tbody></table>`
    : '<p class="doc-note">No acronyms or abbreviations have been defined yet.</p>';
  return `<h1 class="doc-title">${esc(listTitle(project, 'loa'))}</h1>\n${body}`;
}

/** The outline with numbers and writing status, plus the figures and tables placed in each part. */
export function structureHTML(project) {
  const n = getNumbering(project);
  const doc = buildDocument(project);
  const statusOf = (value) => SECTION_STATUSES.find((s) => s.value === value) || SECTION_STATUSES[0];

  // Figures / tables per owning node.
  const owned = new Map();
  const add = (key, label) => { if (!owned.has(key)) owned.set(key, []); owned.get(key).push(label); };
  for (const f of doc.figures) add(f.sectionId || f.chapterId || '__none', f.caption);
  for (const tb of doc.tables) add(tb.sectionId || tb.chapterId || '__none', tb.caption);

  // Counters for the summary and the chapter-level "n of m sections done".
  let totalSections = 0; let doneSections = 0;
  const perChapter = new Map();
  for (const entry of n.outline) {
    if (entry.kind !== 'section') continue;
    const node = findNode(project, entry.id)?.node;
    const done = node?.status === 'done';
    totalSections += 1; if (done) doneSections += 1;
    const c = perChapter.get(entry.chapterId) || { total: 0, done: 0 };
    c.total += 1; if (done) c.done += 1;
    perChapter.set(entry.chapterId, c);
  }

  const lines = [];
  for (const entry of n.outline) {
    const node = findNode(project, entry.id)?.node;
    let meta = '';
    if (entry.kind === 'section') {
      const st = statusOf(node?.status);
      meta = `<span class="status s-${esc(st.value)}">${esc(STATUS_LABELS[st.value] || st.label)}</span>`;
    } else {
      const c = perChapter.get(entry.id);
      meta = c && c.total ? `<span class="meta">${c.done} of ${c.total} sections done</span>` : '';
    }
    lines.push(`<div class="st-line st-d${Math.min(3, entry.depth)}"><span class="num">${esc(entry.number)}</span><span class="tt">${esc(entry.title)}</span><span class="dots"></span>${meta}</div>`);
    for (const label of owned.get(entry.id) || []) lines.push(`<span class="st-item st-i${Math.min(4, entry.depth + 1)}">${esc(label)}</span>`);
  }
  const loose = owned.get('__none') || [];
  if (loose.length) {
    lines.push('<div class="st-line st-d0"><span class="num"></span><span class="tt">Unassigned figures and tables</span></div>');
    for (const label of loose) lines.push(`<span class="st-item st-i1">${esc(label)}</span>`);
  }
  const pct = totalSections ? Math.round((doneSections / totalSections) * 100) : 0;
  const summary = `<div class="st-summary"><span><b>${project.chapters.length}</b> chapters</span><span><b>${totalSections}</b> sections</span><span><b>${doc.figures.length}</b> figures</span><span><b>${doc.tables.length}</b> tables</span><span><b>${pct}%</b> of sections done</span></div>`;
  return `<h1 class="doc-title">Document Structure</h1>\n<p class="doc-subtitle">${esc(project.name)}</p>\n${summary}\n${lines.join('\n') || '<p class="doc-note">The document has no chapters yet.</p>'}`;
}
