// Export page (#/p/<id>/export): documentation package, Word, figures, tables, printable lists, backup.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';
import {
  downloadBlob, downloadText, pickFile, readFileAsText, slugify, formatBytes, plural, relativeTime,
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
  figureSVG, tableSVG, tableHTMLDocument,
} from './package.js';
import {
  printHTML, wrapHTMLDocument, tocHTML, listOfFiguresHTML, listOfTablesHTML, acronymsHTML, structureHTML,
} from './print.js';

const LISTS = [
  { id: 'toc', icon: 'structure', title: 'Table of Contents', file: 'table-of-contents', build: tocHTML, count: (d) => plural(d.toc.length, 'entry', 'entries') },
  { id: 'lof', icon: 'figure', title: 'List of Figures', file: 'list-of-figures', build: listOfFiguresHTML, count: (d) => plural(d.figures.length, 'figure') },
  { id: 'lot', icon: 'table', title: 'List of Tables', file: 'list-of-tables', build: listOfTablesHTML, count: (d) => plural(d.tables.length, 'table') },
  { id: 'loa', icon: 'acronym', title: 'List of Acronyms and Abbreviations', file: 'list-of-acronyms', build: acronymsHTML, count: (d) => plural(d.acronyms.length, 'acronym') },
  { id: 'structure', icon: 'layers', title: 'Document Structure', file: 'document-structure', build: structureHTML, count: (d, p) => `${plural(p.chapters.length, 'chapter')} with status` },
];

const isoDate = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

/** Accept a raw project object (or one wrapped as { project }) and refuse anything else. */
function parseProjectFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (data && !Array.isArray(data) && typeof data.project === 'object' && data.project && !Array.isArray(data.chapters)) data = data.project;
  const looksRight = data && typeof data === 'object' && !Array.isArray(data)
    && (typeof data.name === 'string' || typeof data.id === 'string')
    && ['chapters', 'figures', 'tables'].some((k) => Array.isArray(data[k]));
  if (!looksRight) throw new Error('This file does not look like a GradDocs project export.');
  return data;
}

function askImportMode(name) {
  return new Promise((resolve) => {
    let choice = null;
    const modal = openModal({
      title: 'This project already exists',
      size: 'sm',
      body: `<p style="color:var(--text-2)">A project with the same ID (<b>${esc(name)}</b>) is already stored in this browser. Replace it with the imported version, or keep both by importing a copy?</p>`,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn" data-choice="copy">Import as copy</button><button class="btn btn-danger" data-choice="replace">Replace existing</button>',
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
  if (!ok) throw new Error('This browser blocked copying. Download the HTML file instead.');
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
    const cardHead = (iconName, title, sub, actions = '') => `
      <div class="card-header exp-card-head">
        ${tile(iconName)}
        <div class="exp-head-text"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
        ${actions ? `<div class="exp-head-actions">${actions}</div>` : ''}
      </div>`;

    function figureRows(doc, numbering) {
      if (!doc.figures.length) {
        return `<div class="exp-empty"><div class="exp-empty-icon">${icon('figure')}</div><div><b>No figures yet</b><p>Create a figure and it will appear here, ready to export as SVG, PNG or PDF.</p></div><a class="btn btn-sm" href="${esc(ctx.href('figures'))}">Go to Figures</a></div>`;
      }
      return doc.figures.map((f) => {
        const info = numbering.figures.get(f.id);
        return `<div class="list-item exp-row" data-row="${esc(f.id)}">
          <div class="thumb exp-thumb">${renderThumbnail(f.figure)}</div>
          <div class="exp-row-main">
            <div class="title truncate">${esc(f.figure.title)}</div>
            <div class="meta"><span class="badge badge-primary">${esc(f.label)}</span><span class="sep">&middot;</span><span class="truncate">${esc(info?.location || 'Unassigned')}</span></div>
          </div>
          <div class="actions exp-actions">
            <div class="btn-group">
              <button class="btn btn-sm" data-action="fig-svg" data-id="${esc(f.id)}" data-tip="Vector image, scales without quality loss">SVG</button>
              <button class="btn btn-sm" data-action="fig-png" data-id="${esc(f.id)}" data-tip="High-resolution image for Word">PNG</button>
              <button class="btn btn-sm" data-action="fig-pdf" data-id="${esc(f.id)}">PDF</button>
            </div>
            <button class="btn btn-sm btn-soft" data-action="fig-copy" data-id="${esc(f.id)}" data-tip="Copy the image, then paste it into Word">${icon('copy', 'icon-sm')}Copy image</button>
          </div>
        </div>`;
      }).join('');
    }

    function tableRows(doc, numbering) {
      if (!doc.tables.length) {
        return `<div class="exp-empty"><div class="exp-empty-icon">${icon('table')}</div><div><b>No tables yet</b><p>Create a table and it will appear here, ready to export as an image, HTML or CSV.</p></div><a class="btn btn-sm" href="${esc(ctx.href('tables'))}">Go to Tables</a></div>`;
      }
      return doc.tables.map((t) => {
        const info = numbering.tables.get(t.id);
        return `<div class="list-item exp-row" data-row="${esc(t.id)}">
          <span class="exp-tile exp-tile-lg">${icon('table')}</span>
          <div class="exp-row-main">
            <div class="title truncate">${esc(t.table.title)}</div>
            <div class="meta"><span class="badge badge-primary">${esc(t.label)}</span><span class="sep">&middot;</span><span class="truncate">${esc(info?.location || 'Unassigned')}</span><span class="sep">&middot;</span><span>${t.table.rows.length} &times; ${t.table.columns.length}</span></div>
          </div>
          <div class="actions exp-actions">
            <div class="btn-group">
              <button class="btn btn-sm" data-action="tab-svg" data-id="${esc(t.id)}">SVG</button>
              <button class="btn btn-sm" data-action="tab-png" data-id="${esc(t.id)}">PNG</button>
              <button class="btn btn-sm" data-action="tab-pdf" data-id="${esc(t.id)}">PDF</button>
              <button class="btn btn-sm" data-action="tab-html" data-id="${esc(t.id)}">HTML</button>
              <button class="btn btn-sm" data-action="tab-csv" data-id="${esc(t.id)}">CSV</button>
            </div>
            <button class="btn btn-sm btn-soft" data-action="tab-copy" data-id="${esc(t.id)}" data-tip="Copies the table with its formatting, then paste it into Word">${icon('clipboard', 'icon-sm')}Copy for Word</button>
          </div>
        </div>`;
      }).join('');
    }

    function listRows(doc, p) {
      return LISTS.map((l) => `<div class="list-item exp-row">
          ${tile(l.icon, 'exp-tile-lg')}
          <div class="exp-row-main">
            <div class="title">${esc(l.title)}</div>
            <div class="meta"><span>${esc(l.count(doc, p))} &middot; page numbers are filled in by Word</span></div>
          </div>
          <div class="actions exp-actions">
            <button class="btn btn-sm btn-soft" data-action="list-print" data-list="${l.id}">${icon('printer', 'icon-sm')}Open printable PDF</button>
            <button class="btn btn-sm" data-action="list-html" data-list="${l.id}">${icon('export', 'icon-sm')}Download .html</button>
          </div>
        </div>`).join('');
    }

    function backupLine() {
      if (backupInfo === undefined) return 'Checking for automatic backups&hellip;';
      if (!backupInfo) return 'No automatic backup yet. One is saved every 15 minutes while you work.';
      return `Latest automatic backup: <b>${esc(relativeTime(backupInfo.at))}</b> &middot; ${esc(backupInfo.reason || 'Automatic backup')}`;
    }

    function render() {
      const p = project();
      const doc = buildDocument(p);
      const numbering = getNumbering(p);
      const includes = [
        ['word', 'documentation.docx', 'Editable Word report: title page, front matter, chapters, numbered figures and tables'],
        ['figure', `figures/ <span class="exp-count">${doc.figures.length}</span>`, `Every figure as SVG and ${exportScale(p)}× PNG`],
        ['table', `tables/ <span class="exp-count">${doc.tables.length}</span>`, 'Every table as SVG, PNG, HTML (paste into Word) and CSV'],
        ['fileText', 'lists/', 'Contents, figures, tables, acronyms and structure as printable HTML'],
        ['database', 'project.json', 'A full backup you can import again'],
        ['info', 'README.txt', 'How to insert everything into Word'],
      ];
      container.innerHTML = `
      <div class="page exp-page">
        <div class="page-header">
          <div class="titles">
            <h1>Export</h1>
            <p class="subtitle">Take your documentation out of GradDocs &mdash; a Word document, figures and tables as images, printable lists and a full backup.</p>
          </div>
        </div>

        <section class="card exp-featured" data-section="package">
          <div class="exp-feat-head">
            <span class="exp-tile exp-tile-xl">${icon('archive')}</span>
            <div class="exp-head-text">
              <div class="exp-kicker"><span class="badge badge-primary">Recommended</span></div>
              <h2>Complete Documentation Package</h2>
              <p>Everything in a single .zip &mdash; ready to hand in, share with your supervisor, or build your Word document from.</p>
            </div>
          </div>
          <ul class="exp-includes">
            ${includes.map(([ic, name, text]) => `<li>${icon(ic)}<div><b>${name}</b><span>${text}</span></div></li>`).join('')}
          </ul>
          <div class="exp-feat-action">
            <button class="btn btn-primary btn-lg" data-action="package">${icon('export')}Download package (.zip)</button>
            <div class="exp-progress" data-progress hidden>
              <div class="progress"><span style="width:0%"></span></div>
              <div class="exp-progress-label" data-progress-label>Preparing&hellip;</div>
            </div>
            <div class="exp-note" data-package-note>${esc(`${slug()}-documentation-package.zip`)}</div>
            <div class="exp-stats">
              <span><b>${p.chapters.length}</b> chapters</span><span><b>${doc.figures.length}</b> figures</span><span><b>${doc.tables.length}</b> tables</span><span><b>${doc.acronyms.length}</b> acronyms</span>
            </div>
          </div>
        </section>

        <div class="exp-grid-2">
          <section class="card" data-section="word">
            ${cardHead('word', 'Word document (.docx)', 'A real .docx with styles, headings and native tables.')}
            <div class="card-body exp-stack">
              <ul class="exp-ticks">
                <li>${icon('check', 'icon-sm')}Title page, front matter, chapters and numbered captions</li>
                <li>${icon('check', 'icon-sm')}Table of contents, lists of figures and tables as Word fields</li>
                <li>${icon('check', 'icon-sm')}Cross-references stay linked (press F9 after edits)</li>
              </ul>
              <div class="callout callout-info">${icon('info')}<div>Word asks <b>&ldquo;Update fields?&rdquo;</b> when it opens the file. Choose <b>Yes</b> to fill in the page numbers.</div></div>
              <div><button class="btn btn-primary" data-action="docx">${icon('export')}Download .docx</button></div>
            </div>
          </section>

          <section class="card" data-section="backup">
            ${cardHead('database', 'Project backup', 'Move your project between browsers or keep a safe copy.')}
            <div class="card-body exp-stack">
              <div class="exp-backup-actions">
                <button class="btn" data-action="json">${icon('export')}Export Project (.json)</button>
                <button class="btn" data-action="import">${icon('upload')}Import Project</button>
                <button class="btn" data-action="backup-download" data-backup-button ${backupInfo ? '' : 'disabled'}>${icon('history')}Download latest automatic backup</button>
              </div>
              <div class="exp-note" data-backup-line>${backupLine()}</div>
              <div class="exp-note">${icon('settings', 'icon-sm')}<span>Backup and storage options live in <a href="${esc(ctx.href('settings', null, { tab: 'storage' }))}">Settings &rarr; Storage</a>.</span></div>
            </div>
          </section>
        </div>

        <section class="card exp-section" data-section="figures">
          ${cardHead('figure', 'Figures', `${plural(doc.figures.length, 'figure')} in document order. PNG files are ${exportScale(p)}&times; resolution and carry their DPI.`,
            `<button class="btn btn-sm" data-action="figures-zip" ${doc.figures.length ? '' : 'disabled'}>${icon('archive', 'icon-sm')}Download all figures (.zip)</button>`)}
          <div class="exp-rows">${figureRows(doc, numbering)}</div>
        </section>

        <section class="card exp-section" data-section="tables">
          ${cardHead('table', 'Tables', `${plural(doc.tables.length, 'table')} in document order. <b>Copy for Word</b> keeps the table formatting when you paste.`)}
          <div class="exp-rows">${tableRows(doc, numbering)}</div>
        </section>

        <section class="card exp-section" data-section="lists">
          ${cardHead('printer', 'Lists & structure → PDF', 'Open a clean print view and choose <b>Save as PDF</b> as the printer, or download the page as HTML.')}
          <div class="exp-rows">${listRows(doc, p)}</div>
        </section>
      </div>`;
    }

    // ------------------------------------------------------------- busy state
    async function run(btn, task, { success, failure = 'Export failed' } = {}) {
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
          if (note) note.innerHTML = `Last package: <b>${esc(name)}</b> &middot; ${esc(formatBytes(blob.size))}`;
          return { name, size: blob.size };
        }, { success: (r) => `Package ready: ${r.name} (${formatBytes(r.size)})`, failure: 'Could not build the package' });
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
        }, { success: (r) => `Saved ${r.name} (${formatBytes(r.size)}). Choose "Yes" when Word asks to update fields.`, failure: 'Could not build the Word document' });
      },

      async 'figures-zip'(btn) {
        const p = project();
        await run(btn, async () => {
          const blob = await buildFiguresZip(p);
          const name = `${slugify(p.name)}-figures.zip`;
          downloadBlob(blob, name);
          return { name, size: blob.size };
        }, { success: (r) => `Saved ${r.name} (${formatBytes(r.size)})`, failure: 'Could not build the figures archive' });
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
        }, { success: 'Image copied. Paste it into Word with Ctrl+V.', failure: 'Could not copy the image' });
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
        await run(btn, () => copyTableForWord(project(), table), { success: 'Table copied. Paste it into Word with Ctrl+V.', failure: 'Could not copy the table' });
      },

      // ----- lists -----
      async 'list-print'(btn) {
        const list = LISTS.find((l) => l.id === btn.dataset.list); if (!list) return;
        try {
          printHTML(list.title, list.build(project()), { settings: project().settings });
        } catch (err) { toastError(err, 'Could not open the print view'); }
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
        }, { success: (n) => `Saved ${n}`, failure: 'Could not export the project' });
      },
      async 'backup-download'(btn) {
        await run(btn, async () => {
          const list = await store.repo.listBackups(project().id);
          const latest = list[0];
          if (!latest) throw new Error('There is no automatic backup yet. One is saved every 15 minutes while you work.');
          const name = `${slug()}-backup-${isoDate(latest.at)}.json`;
          downloadText(JSON.stringify(latest.data, null, 2), name, 'application/json;charset=utf-8');
          return name;
        }, { success: (n) => `Saved ${n}`, failure: 'Could not download the backup' });
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
          toast(`Imported "${saved.name}".`, { type: 'success' });
          ctx.navigate(href(saved.id, 'dashboard'));
          return saved;
        }, { failure: 'Could not import the project' });
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
