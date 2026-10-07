// Export page (#/p/<id>/export): documentation package, Word, figures, tables, references, printable lists, backup.
import { esc, on, Disposer } from '../ui/dom.js';
import { t, isRTL } from '../i18n/index.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import {
  downloadBlob, downloadText, pickFile, readFileAsText, slugify, formatBytes, relativeTime,
} from '../core/utils.js';
import { buildDocument } from '../core/document.js';
import { getNumbering } from '../core/numbering.js';
import { renderThumbnail } from '../figures/render.js';
import { renderTableHTML, tableToCSV, tableToTSV } from '../tables/table-render.js';
import { href } from '../app/routes.js';
import { svgToPngBlob, copyPngToClipboard } from './png.js';
import { svgToPdfBlob } from './pdf.js';
import { buildDocx } from './docx.js';
import {
  buildPackage, buildFiguresZip, figureImagesForDocx, figureFileBase, tableFileBase, exportScale,
  figureSVG, tableSVG, tableHTMLDocument, referencesText,
} from './package.js';
import {
  printHTML, wrapHTMLDocument, tocHTML, listOfFiguresHTML, listOfTablesHTML, acronymsHTML, referencesHTML, structureHTML,
} from './print.js';

// `title` / `file` are the report's own names (print window title, .html files): they stay English.
// The export page shows t(title) and the counts below in the app language.
const count = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));
const LISTS = [
  { id: 'toc', icon: 'structure', title: 'Table of Contents', file: 'table-of-contents', build: tocHTML, count: (d) => count(d.toc.length, '1 entry', '{n} entries') },
  { id: 'lof', icon: 'figure', title: 'List of Figures', file: 'list-of-figures', build: listOfFiguresHTML, count: (d) => count(d.figures.length, '1 figure', '{n} figures') },
  { id: 'lot', icon: 'table', title: 'List of Tables', file: 'list-of-tables', build: listOfTablesHTML, count: (d) => count(d.tables.length, '1 table', '{n} tables') },
  { id: 'loa', icon: 'acronym', title: 'List of Acronyms and Abbreviations', file: 'list-of-acronyms', build: acronymsHTML, count: (d) => count(d.acronyms.length, '1 acronym', '{n} acronyms') },
  { id: 'structure', icon: 'layers', title: 'Document Structure', file: 'document-structure', build: structureHTML, count: (d, p) => count(p.chapters.length, '1 chapter with status', '{n} chapters with status') },
];

/** Keep file names, extensions, sizes and shortcuts left-to-right inside Arabic text (markup contexts). */
const ltr = (html) => (isRTL ? `<bdi dir="ltr">${html}</bdi>` : html);
/** Same for plain-text contexts (toasts, labels): Unicode LRI … PDI isolates. */
const ltrText = (text) => (isRTL ? `\u2066${text}\u2069` : String(text));
/** "5×" scale factor. */
const times = (n) => ltr(`${n}&times;`);

const isoDate = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

/** Accept a raw project object (or one wrapped as { project }) and refuse anything else. */
function parseProjectFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(t('This file is not valid JSON.')); }
  if (data && !Array.isArray(data) && typeof data.project === 'object' && data.project && !Array.isArray(data.chapters)) data = data.project;
  const looksRight = data && typeof data === 'object' && !Array.isArray(data)
    && (typeof data.name === 'string' || typeof data.id === 'string')
    && ['chapters', 'figures', 'tables'].some((k) => Array.isArray(data[k]));
  if (!looksRight) throw new Error(t('This file does not look like a GradDocs project export.'));
  return data;
}

function askImportMode(name) {
  return new Promise((resolve) => {
    let choice = null;
    const modal = openModal({
      title: t('This project already exists'),
      size: 'sm',
      body: `<p style="color:var(--text-2)">${t('A project with the same ID ({name}) is already stored in this browser. Replace it with the imported version, or keep both by importing a copy?', { name: `<b>${esc(name)}</b>` })}</p>`,
      footer: `<button class="btn" data-close>${esc(t('Cancel'))}</button><button class="btn" data-choice="copy">${esc(t('Import as copy'))}</button><button class="btn btn-danger" data-choice="replace">${esc(t('Replace existing'))}</button>`,
      onClose: () => resolve(choice),
    });
    modal.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choice]');
      if (btn) { choice = btn.dataset.choice; modal.close(); }
    });
  });
}

/** Copy a table as rich HTML (pastes into Word with its formatting) plus tab-separated text. */
async function copyTableForWord(project, table) {
  const html = renderTableHTML(project, table, { caption: true, forWord: true });
  const text = tableToTSV(table);
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    return;
  }
  const holder = document.createElement('div');
  holder.contentEditable = 'true';
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
  holder.innerHTML = html;
  document.body.append(holder);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection.removeAllRanges(); selection.addRange(range);
  const ok = document.execCommand('copy');
  selection.removeAllRanges(); holder.remove();
  if (!ok) throw new Error(t('This browser blocked copying. Download the HTML file instead.'));
}

/** Plain text to the clipboard (falls back to a hidden textarea where the async API is blocked). */
async function copyPlainText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* use the fallback below */ }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error(t('This browser blocked copying. Download the HTML file instead.'));
}

export default {
  title: 'Export',
  mount(container, ctx) {
    const { store } = ctx;
    const disposer = new Disposer();
    let busy = 0;
    let dirty = false;
    let backupInfo = undefined; // undefined = loading, null = none

    const project = () => store.project;
    const slug = () => slugify(project().name);

    // ------------------------------------------------------------------ view
    const tile = (name, cls = '') => `<span class="exp-tile ${cls}">${icon(name)}</span>`;
    // `title` and `sub` are markup built from t() strings (never user text).
    const cardHead = (iconName, title, sub, actions = '') => `
      <div class="card-header exp-card-head">
        ${tile(iconName)}
        <div class="exp-head-text"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
        ${actions ? `<div class="exp-head-actions">${actions}</div>` : ''}
      </div>`;
    /** "Download" + a file type / name that stays left-to-right inside Arabic text. */
    const downloadLabel = (what) => `${esc(t('Download'))} ${ltr(what)}`;

    function figureRows(doc, numbering) {
      if (!doc.figures.length) {
        return `<div class="exp-empty"><div class="exp-empty-icon">${icon('figure')}</div><div><b>${esc(t('No figures yet'))}</b><p>${esc(t('Create a figure and it will appear here, ready to export as SVG, PNG or PDF.'))}</p></div><a class="btn btn-sm" href="${esc(ctx.href('figures'))}">${esc(t('Go to Figures'))}</a></div>`;
      }
      return doc.figures.map((f) => {
        const info = numbering.figures.get(f.id);
        return `<div class="list-item exp-row" data-row="${esc(f.id)}">
          <div class="thumb exp-thumb">${renderThumbnail(f.figure)}</div>
          <div class="exp-row-main">
            <div class="title truncate" dir="auto">${esc(f.figure.title)}</div>
            <div class="meta"><span class="badge badge-primary">${esc(f.label)}</span><span class="sep">&middot;</span><span class="truncate">${esc(info?.location || t('Unassigned'))}</span></div>
          </div>
          <div class="actions exp-actions">
            <div class="btn-group">
              <button class="btn btn-sm" data-action="fig-svg" data-id="${esc(f.id)}" data-tip="${esc(t('Vector image, scales without quality loss'))}">SVG</button>
              <button class="btn btn-sm" data-action="fig-png" data-id="${esc(f.id)}" data-tip="${esc(t('High-resolution image for Word'))}">PNG</button>
              <button class="btn btn-sm" data-action="fig-pdf" data-id="${esc(f.id)}">PDF</button>
            </div>
            <button class="btn btn-sm btn-soft" data-action="fig-copy" data-id="${esc(f.id)}" data-tip="${esc(t('Copy the image, then paste it into Word'))}">${icon('copy', 'icon-sm')}${esc(t('Copy image'))}</button>
          </div>
        </div>`;
      }).join('');
    }

    function tableRows(doc, numbering) {
      if (!doc.tables.length) {
        return `<div class="exp-empty"><div class="exp-empty-icon">${icon('table')}</div><div><b>${esc(t('No tables yet'))}</b><p>${esc(t('Create a table and it will appear here, ready to export as an image, HTML or CSV.'))}</p></div><a class="btn btn-sm" href="${esc(ctx.href('tables'))}">${esc(t('Go to Tables'))}</a></div>`;
      }
      return doc.tables.map((tb) => {
        const info = numbering.tables.get(tb.id);
        return `<div class="list-item exp-row" data-row="${esc(tb.id)}">
          <span class="exp-tile exp-tile-lg">${icon('table')}</span>
          <div class="exp-row-main">
            <div class="title truncate" dir="auto">${esc(tb.table.title)}</div>
            <div class="meta"><span class="badge badge-primary">${esc(tb.label)}</span><span class="sep">&middot;</span><span class="truncate">${esc(info?.location || t('Unassigned'))}</span><span class="sep">&middot;</span><span>${ltr(`${tb.table.rows.length} &times; ${tb.table.columns.length}`)}</span></div>
          </div>
          <div class="actions exp-actions">
            <div class="btn-group">
              <button class="btn btn-sm" data-action="tab-svg" data-id="${esc(tb.id)}">SVG</button>
              <button class="btn btn-sm" data-action="tab-png" data-id="${esc(tb.id)}">PNG</button>
              <button class="btn btn-sm" data-action="tab-pdf" data-id="${esc(tb.id)}">PDF</button>
              <button class="btn btn-sm" data-action="tab-html" data-id="${esc(tb.id)}">HTML</button>
              <button class="btn btn-sm" data-action="tab-csv" data-id="${esc(tb.id)}">CSV</button>
            </div>
            <button class="btn btn-sm btn-soft" data-action="tab-copy" data-id="${esc(tb.id)}" data-tip="${esc(t('Copies the table with its formatting, then paste it into Word'))}">${icon('clipboard', 'icon-sm')}${esc(t('Copy for Word'))}</button>
          </div>
        </div>`;
      }).join('');
    }

    function referenceRows(doc) {
      const entries = doc.references.entries;
      if (!entries.length) {
        return `<div class="exp-empty"><div class="exp-empty-icon">${icon('book')}</div><div><b>${esc(t('No references yet'))}</b><p>${esc(t('Add the books, papers and websites you cite and they will appear here, ready to copy or save as text.'))}</p></div><a class="btn btn-sm" href="${esc(ctx.href('references'))}">${esc(t('Go to References'))}</a></div>`;
      }
      return entries.map((e) => `<div class="list-item exp-row exp-ref">
          <span class="badge badge-primary exp-ref-n">${esc(e.label)}</span>
          <div class="exp-row-main"><div class="exp-ref-text" dir="auto">${e.runs.map((r) => (r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('')}</div></div>
        </div>`).join('');
    }

    function listRows(doc, p) {
      return LISTS.map((l) => `<div class="list-item exp-row">
          ${tile(l.icon, 'exp-tile-lg')}
          <div class="exp-row-main">
            <div class="title">${esc(t(l.title))}</div>
            <div class="meta"><span>${esc(l.count(doc, p))} &middot; ${esc(t('page numbers are filled in by Word'))}</span></div>
          </div>
          <div class="actions exp-actions">
            <button class="btn btn-sm btn-soft" data-action="list-print" data-list="${l.id}">${icon('printer', 'icon-sm')}${esc(t('Open printable PDF'))}</button>
            <button class="btn btn-sm" data-action="list-html" data-list="${l.id}">${icon('export', 'icon-sm')}${downloadLabel('.html')}</button>
          </div>
        </div>`).join('');
    }

    function backupLine() {
      if (backupInfo === undefined) return `${esc(t('Checking for automatic backups…'))}`;
      if (!backupInfo) return esc(t('No automatic backup yet. One is saved every 15 minutes while you work.'));
      return `${t('Latest automatic backup: {time}', { time: `<b>${esc(relativeTime(backupInfo.at))}</b>` })} &middot; ${esc(t(backupInfo.reason || 'Automatic backup'))}`;
    }

    function render() {
      const p = project();
      const doc = buildDocument(p);
      const numbering = getNumbering(p);
      const scale = times(exportScale(p));
      const includes = [
        ['word', ltr('documentation.docx'), t('Editable Word report: title page, front matter, chapters, numbered figures and tables')],
        ['figure', ltr(`figures/ <span class="exp-count">${doc.figures.length}</span>`), t('Every figure as SVG and {scale} PNG', { scale })],
        ['table', ltr(`tables/ <span class="exp-count">${doc.tables.length}</span>`), t('Every table as SVG, PNG, HTML (paste into Word) and CSV')],
        ['fileText', ltr('lists/'), t('Contents, figures, tables, acronyms and structure as printable HTML')],
        ...(doc.references.entries.length ? [['book', ltr('references.txt'), t('The references as plain text, one line per entry')]] : []),
        ['database', ltr('project.json'), t('A full backup you can import again')],
        ['info', ltr('README.txt'), t('How to insert everything into Word')],
      ];
      const statChips = [
        [p.chapters.length, 'chapters'], [doc.figures.length, 'figures'], [doc.tables.length, 'tables'], [doc.acronyms.length, 'acronyms'],
      ].map(([n, label]) => `<span><b>${n}</b> ${esc(t(label))}</span>`).join('');
      container.innerHTML = `
      <div class="page exp-page">
        <div class="page-header">
          <div class="titles">
            <h1>${esc(t('Export'))}</h1>
            <p class="subtitle">${esc(t('Take your documentation out of GradDocs — a Word document, figures and tables as images, printable lists and a full backup.'))}</p>
          </div>
        </div>

        <section class="card exp-featured" data-section="package">
          <div class="exp-feat-head">
            <span class="exp-tile exp-tile-xl">${icon('archive')}</span>
            <div class="exp-head-text">
              <div class="exp-kicker"><span class="badge badge-primary">${esc(t('Recommended'))}</span></div>
              <h2>${esc(t('Complete Documentation Package'))}</h2>
              <p>${t('Everything in a single {zip} — ready to hand in, share with your supervisor, or build your Word document from.', { zip: ltr('.zip') })}</p>
            </div>
          </div>
          <ul class="exp-includes">
            ${includes.map(([ic, name, text]) => `<li>${icon(ic)}<div><b>${name}</b><span>${text}</span></div></li>`).join('')}
          </ul>
          <div class="exp-feat-action">
            <button class="btn btn-primary btn-lg" data-action="package">${icon('export')}${esc(t('Download package'))} ${ltr('(.zip)')}</button>
            <div class="exp-progress" data-progress hidden>
              <div class="progress"><span style="width:0%"></span></div>
              <div class="exp-progress-label" data-progress-label>${esc(t('Preparing…'))}</div>
            </div>
            <div class="exp-note" data-package-note>${ltr(esc(`${slug()}-documentation-package.zip`))}</div>
            <div class="exp-stats">${statChips}</div>
          </div>
        </section>

        <div class="exp-grid-2">
          <section class="card" data-section="word">
            ${cardHead('word', `${esc(t('Word document'))} ${ltr('(.docx)')}`, t('A real {docx} with styles, headings and native tables.', { docx: ltr('.docx') }))}
            <div class="card-body exp-stack">
              <ul class="exp-ticks">
                <li>${icon('check', 'icon-sm')}${esc(t('Title page, front matter, chapters and numbered captions'))}</li>
                <li>${icon('check', 'icon-sm')}${esc(t('Table of contents, lists of figures and tables as Word fields'))}</li>
                <li>${icon('check', 'icon-sm')}${esc(t('Cross-references stay linked (press F9 after edits)'))}</li>
              </ul>
              <div class="callout callout-info">${icon('info')}<div>${t('Word asks {question} when it opens the file. Choose {yes} to fill in the page numbers.', { question: `<b>${esc(t('“Update fields?”'))}</b>`, yes: `<b>${esc(t('Yes'))}</b>` })}</div></div>
              <div><button class="btn btn-primary" data-action="docx">${icon('export')}${downloadLabel('.docx')}</button></div>
            </div>
          </section>

          <section class="card" data-section="backup">
            ${cardHead('database', esc(t('Project backup')), esc(t('Move your project between browsers or keep a safe copy.')))}
            <div class="card-body exp-stack">
              <div class="exp-backup-actions">
                <button class="btn" data-action="json">${icon('export')}${esc(t('Export Project'))} ${ltr('(.json)')}</button>
                <button class="btn" data-action="import">${icon('upload')}${esc(t('Import Project'))}</button>
                <button class="btn" data-action="backup-download" data-backup-button ${backupInfo ? '' : 'disabled'}>${icon('history')}${esc(t('Download latest automatic backup'))}</button>
              </div>
              <div class="exp-note" data-backup-line>${backupLine()}</div>
              <div class="exp-note">${icon('settings', 'icon-sm')}<span>${t('Backup and storage options live in {link}.', { link: `<a href="${esc(ctx.href('settings', null, { tab: 'storage' }))}">${esc(t('Settings'))} ${isRTL ? '&larr;' : '&rarr;'} ${esc(t('Storage'))}</a>` })}</span></div>
            </div>
          </section>
        </div>

        <section class="card exp-section" data-section="figures">
          ${cardHead('figure', esc(t('Figures')), t('{count} in document order. PNG files are {scale} resolution and carry their DPI.', { count: esc(count(doc.figures.length, '1 figure', '{n} figures')), scale }),
            `<button class="btn btn-sm" data-action="figures-zip" ${doc.figures.length ? '' : 'disabled'}>${icon('archive', 'icon-sm')}${esc(t('Download all figures'))} ${ltr('(.zip)')}</button>`)}
          <div class="exp-rows">${figureRows(doc, numbering)}</div>
        </section>

        <section class="card exp-section" data-section="tables">
          ${cardHead('table', esc(t('Tables')), t('{count} in document order. {copy} keeps the table formatting when you paste.', { count: esc(count(doc.tables.length, '1 table', '{n} tables')), copy: `<b>${esc(t('Copy for Word'))}</b>` }))}
          <div class="exp-rows">${tableRows(doc, numbering)}</div>
        </section>

        <section class="card exp-section" data-section="references">
          ${cardHead('book', esc(t('References')), t('{count} in the order of the References page. Copy the list or save it as a text file.', { count: esc(count(doc.references.entries.length, '1 reference', '{n} references')) }),
            `<button class="btn btn-sm" data-action="refs-copy" ${doc.references.entries.length ? '' : 'disabled'}>${icon('copy', 'icon-sm')}${esc(t('Copy list'))}</button>
             <button class="btn btn-sm" data-action="refs-txt" ${doc.references.entries.length ? '' : 'disabled'}>${icon('export', 'icon-sm')}${downloadLabel('.txt')}</button>
             <button class="btn btn-sm btn-soft" data-action="refs-print" ${doc.references.entries.length ? '' : 'disabled'}>${icon('printer', 'icon-sm')}${esc(t('Open printable PDF'))}</button>`)}
          <div class="exp-rows">${referenceRows(doc)}</div>
        </section>

        <section class="card exp-section" data-section="lists">
          ${cardHead('printer', esc(t('Lists & structure → PDF')), t('Open a clean print view and choose {saveAsPdf} as the printer, or download the page as HTML.', { saveAsPdf: `<b>${esc(t('Save as PDF'))}</b>` }))}
          <div class="exp-rows">${listRows(doc, p)}</div>
        </section>
      </div>`;
    }

    // ------------------------------------------------------------- busy state
    async function run(btn, task, { success, failure = t('Export failed') } = {}) {
      if (btn?.disabled) return;
      busy += 1;
      if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
      try {
        const result = await task();
        const message = typeof success === 'function' ? success(result) : success;
        if (message) toast(message, { type: 'success' });
        return result;
      } catch (err) {
        toastError(err, failure);
        return undefined;
      } finally {
        busy -= 1;
        if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
        if (!busy && dirty) { dirty = false; render(); }
      }
    }

    const findFigure = (id) => project().figures.find((f) => f.id === id);
    const findTable = (id) => project().tables.find((t) => t.id === id);

    async function loadBackupInfo() {
      try {
        const list = await store.repo.listBackups(project().id);
        backupInfo = list[0] ? { at: list[0].at, reason: list[0].reason, data: list[0].data } : null;
      } catch { backupInfo = null; }
      const line = container.querySelector('[data-backup-line]');
      if (line) line.innerHTML = backupLine();
      const button = container.querySelector('[data-backup-button]');
      if (button) button.disabled = !backupInfo;
    }

    // ---------------------------------------------------------------- actions
    const actions = {
      async package(btn) {
        const bar = container.querySelector('[data-progress]');
        const fill = bar?.querySelector('.progress > span');
        const label = container.querySelector('[data-progress-label]');
        const note = container.querySelector('[data-package-note]');
        const p = project();
        if (bar) bar.hidden = false;
        const onProgress = ({ label: text, value }) => {
          if (fill) fill.style.width = `${Math.round(value * 100)}%`;
          if (label) label.textContent = `${text}`;
        };
        await run(btn, async () => {
          await store.flush();
          const blob = await buildPackage(p, { onProgress });
          const name = `${slugify(p.name)}-documentation-package.zip`;
          downloadBlob(blob, name);
          if (note) note.innerHTML = `${t('Last package: {name}', { name: `<b>${ltr(esc(name))}</b>` })} &middot; ${ltr(esc(formatBytes(blob.size)))}`;
          return { name, size: blob.size };
        }, { success: (r) => t('Package ready: {name} ({size})', { name: ltrText(r.name), size: ltrText(formatBytes(r.size)) }), failure: t('Could not build the package') });
        if (bar) setTimeout(() => { if (!busy) bar.hidden = true; }, 1600);
      },

      async docx(btn) {
        const p = project();
        await run(btn, async () => {
          await store.flush();
          const images = await figureImagesForDocx(p);
          const blob = await buildDocx(p, { figureImages: images });
          const name = `${slugify(p.name)}-documentation.docx`;
          downloadBlob(blob, name);
          return { name, size: blob.size };
        }, { success: (r) => t('Saved {name} ({size}). Choose "Yes" when Word asks to update fields.', { name: ltrText(r.name), size: ltrText(formatBytes(r.size)) }), failure: t('Could not build the Word document') });
      },

      async 'figures-zip'(btn) {
        const p = project();
        await run(btn, async () => {
          const blob = await buildFiguresZip(p);
          const name = `${slugify(p.name)}-figures.zip`;
          downloadBlob(blob, name);
          return { name, size: blob.size };
        }, { success: (r) => t('Saved {name} ({size})', { name: ltrText(r.name), size: ltrText(formatBytes(r.size)) }), failure: t('Could not build the figures archive') });
      },

      // ----- one figure -----
      async 'fig-svg'(btn) {
        const fig = findFigure(btn.dataset.id); if (!fig) return;
        await run(btn, async () => {
          const name = `${figureFileBase(project(), fig)}.svg`;
          downloadText(figureSVG(project(), fig).svg, name, 'image/svg+xml;charset=utf-8');
          return name;
        });
      },
      async 'fig-png'(btn) {
        const fig = findFigure(btn.dataset.id); if (!fig) return;
        await run(btn, async () => {
          const { svg, width, height } = figureSVG(project(), fig);
          const blob = await svgToPngBlob(svg, width, height, { scale: exportScale(project()) });
          const name = `${figureFileBase(project(), fig)}.png`;
          downloadBlob(blob, name);
          return name;
        });
      },
      async 'fig-pdf'(btn) {
        const fig = findFigure(btn.dataset.id); if (!fig) return;
        await run(btn, async () => {
          const { svg, width, height } = figureSVG(project(), fig);
          const blob = await svgToPdfBlob(svg, width, height, { scale: exportScale(project()), title: fig.title });
          const name = `${figureFileBase(project(), fig)}.pdf`;
          downloadBlob(blob, name);
          return name;
        });
      },
      async 'fig-copy'(btn) {
        const fig = findFigure(btn.dataset.id); if (!fig) return;
        await run(btn, async () => {
          const { svg, width, height } = figureSVG(project(), fig);
          await copyPngToClipboard(await svgToPngBlob(svg, width, height, { scale: exportScale(project()) }));
        }, { success: t('Image copied. Paste it into Word with {keys}.', { keys: ltrText('Ctrl+V') }), failure: t('Could not copy the image') });
      },

      // ----- one table -----
      async 'tab-svg'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, async () => {
          const name = `${tableFileBase(project(), table)}.svg`;
          downloadText(tableSVG(project(), table).svg, name, 'image/svg+xml;charset=utf-8');
          return name;
        });
      },
      async 'tab-png'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, async () => {
          const { svg, width, height } = tableSVG(project(), table);
          const blob = await svgToPngBlob(svg, width, height, { scale: exportScale(project()) });
          const name = `${tableFileBase(project(), table)}.png`;
          downloadBlob(blob, name);
          return name;
        });
      },
      async 'tab-pdf'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, async () => {
          const { svg, width, height } = tableSVG(project(), table);
          const blob = await svgToPdfBlob(svg, width, height, { scale: exportScale(project()), title: table.title });
          const name = `${tableFileBase(project(), table)}.pdf`;
          downloadBlob(blob, name);
          return name;
        });
      },
      async 'tab-html'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, async () => {
          const name = `${tableFileBase(project(), table)}.html`;
          downloadText(tableHTMLDocument(project(), table), name, 'text/html;charset=utf-8');
          return name;
        });
      },
      async 'tab-csv'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, async () => {
          const name = `${tableFileBase(project(), table)}.csv`;
          downloadText(`﻿${tableToCSV(table)}`, name, 'text/csv;charset=utf-8'); // BOM keeps Unicode intact in Excel
          return name;
        });
      },
      async 'tab-copy'(btn) {
        const table = findTable(btn.dataset.id); if (!table) return;
        await run(btn, () => copyTableForWord(project(), table), { success: t('Table copied. Paste it into Word with {keys}.', { keys: ltrText('Ctrl+V') }), failure: t('Could not copy the table') });
      },

      // ----- references -----
      async 'refs-copy'(btn) {
        await run(btn, () => copyPlainText(referencesText(project())), { success: t('References copied. Paste them with {keys}.', { keys: ltrText('Ctrl+V') }), failure: t('Could not copy the references') });
      },
      async 'refs-txt'(btn) {
        await run(btn, async () => {
          const name = `${slug()}-references.txt`;
          downloadText(`\uFEFF${referencesText(project())}\n`, name, 'text/plain;charset=utf-8'); // BOM keeps Arabic names intact in Notepad
          return name;
        }, { success: (n) => t('Saved {name}', { name: ltrText(n) }) });
      },
      async 'refs-print'() {
        try {
          printHTML('References', referencesHTML(project()), { settings: project().settings });
        } catch (err) { toastError(err, t('Could not open the print view')); }
      },

      // ----- lists -----
      async 'list-print'(btn) {
        const list = LISTS.find((l) => l.id === btn.dataset.list); if (!list) return;
        try {
          printHTML(list.title, list.build(project()), { settings: project().settings });
        } catch (err) { toastError(err, t('Could not open the print view')); }
      },
      async 'list-html'(btn) {
        const list = LISTS.find((l) => l.id === btn.dataset.list); if (!list) return;
        await run(btn, async () => {
          const name = `${list.file}.html`;
          downloadText(wrapHTMLDocument(list.title, list.build(project()), project().settings), name, 'text/html;charset=utf-8');
          return name;
        });
      },

      // ----- backup -----
      async json(btn) {
        await run(btn, async () => {
          const data = await store.exportProjectData(project().id);
          const name = `${slug()}-project.json`;
          downloadText(JSON.stringify(data, null, 2), name, 'application/json;charset=utf-8');
          return name;
        }, { success: (n) => t('Saved {name}', { name: ltrText(n) }), failure: t('Could not export the project') });
      },
      async 'backup-download'(btn) {
        await run(btn, async () => {
          const list = await store.repo.listBackups(project().id);
          const latest = list[0];
          if (!latest) throw new Error(t('No automatic backup yet. One is saved every 15 minutes while you work.'));
          const name = `${slug()}-backup-${isoDate(latest.at)}.json`;
          downloadText(JSON.stringify(latest.data, null, 2), name, 'application/json;charset=utf-8');
          return name;
        }, { success: (n) => t('Saved {name}', { name: ltrText(n) }), failure: t('Could not download the backup') });
      },
      async import(btn) {
        const file = await pickFile('.json,application/json');
        if (!file) return;
        await run(btn, async () => {
          const data = parseProjectFile(await readFileAsText(file));
          let asCopy = false;
          const existing = data.id ? store.projects.find((p) => p.id === data.id) : null;
          if (existing) {
            const choice = await askImportMode(existing.name);
            if (!choice) return null;
            asCopy = choice === 'copy';
            if (!asCopy && store.project?.id === existing.id) await store.createBackup('Before importing a project');
          }
          const saved = await store.saveImportedProject(data, { asCopy });
          toast(t('Imported "{name}".', { name: saved.name }), { type: 'success' });
          ctx.navigate(href(saved.id, 'dashboard'));
          return saved;
        }, { failure: t('Could not import the project') });
      },
    };

    disposer.add(on(container, 'click', '[data-action]', (event, btn) => {
      const handler = actions[btn.dataset.action];
      if (!handler || btn.disabled) return;
      event.preventDefault();
      handler(btn);
    }));

    disposer.add(store.on('change', () => {
      if (busy) { dirty = true; return; }
      render();
    }));

    render();
    loadBackupInfo();

    // /export?action=json opens straight into a project export.
    if (ctx.params?.query?.action === 'json') {
      try { history.replaceState(null, '', ctx.href('export')); } catch { /* ignore */ }
      queueMicrotask(() => {
        const btn = container.querySelector('[data-action="json"]');
        if (btn) actions.json(btn);
      });
    }

    return { unmount() { disposer.dispose(); } };
  },
};
