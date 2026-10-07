// Tables list (#/p/<id>/tables): search, chapter filter, grouped list with mini previews,
// the "New table" dialog (template gallery → details), duplicate / delete / reorder / export.
// Several helpers are exported for reuse by the table editor and other views.
import { esc, on, Disposer, highlight } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { getNumbering, moveInDocumentOrder } from '../core/numbering.js';
import { createTable } from '../core/model.js';
import { findUsages } from '../core/references.js';
import { uid, clone, relativeTime, slugify, pad, downloadBlob, downloadText } from '../core/utils.js';
import { svgToPngBlob } from '../export/png.js';
import { svgToPdfBlob } from '../export/pdf.js';
import { renderTableHTML, renderTableSVG, tableToCSV, tableToTSV, renderTableMiniHTML } from './table-render.js';
import { TABLE_TEMPLATES, templateById } from './table-templates.js';

// ---------------------------------------------------------------------------
// Export (shared with the editor)

export const tableFileBase = (project, table) => {
  const n = getNumbering(project).tables.get(table.id);
  return `Table-${pad(n?.index ?? 0, 2)}-${slugify(table.title).toLowerCase()}`;
};

/** Copy the table to the clipboard as HTML (+ plain text) so that pasting into Word gives a native table. */
export async function copyTableForWord(project, table) {
  const html = renderTableHTML(project, table, { caption: true, forWord: true });
  const text = tableToTSV(table);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Async clipboard unavailable');
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } catch (err) {
    // Fallback: select a rendered copy and use the legacy copy command.
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;background:#fff;color:#000';
    holder.innerHTML = html;
    document.body.append(holder);
    const range = document.createRange(); range.selectNodeContents(holder);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    sel.removeAllRanges(); holder.remove();
    if (!ok) throw new Error(`Could not copy to the clipboard (${err.message}). Try the HTML export instead.`);
  }
}

/** formats: png | svg | pdf | html | csv | word */
export async function exportTable(project, table, format) {
  const base = tableFileBase(project, table);
  const scale = project.settings.figureDefaults?.exportScale || 3;
  if (format === 'word') { await copyTableForWord(project, table); return 'Copied. Paste into Word with Ctrl+V.'; }
  if (format === 'csv') { downloadText(`﻿${tableToCSV(table)}`, `${base}.csv`, 'text/csv;charset=utf-8'); return `Saved ${base}.csv`; }
  if (format === 'html') {
    const doc = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(table.title)}</title></head>\n<body style="margin:24px">\n${renderTableHTML(project, table, { caption: true })}\n</body></html>\n`;
    downloadText(doc, `${base}.html`, 'text/html;charset=utf-8');
    return `Saved ${base}.html`;
  }
  const { svg, width, height } = renderTableSVG(project, table);
  if (format === 'svg') { downloadText(`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, `${base}.svg`, 'image/svg+xml;charset=utf-8'); return `Saved ${base}.svg`; }
  if (format === 'png') { downloadBlob(await svgToPngBlob(svg, width, height, { scale }), `${base}.png`); return `Saved ${base}.png`; }
  if (format === 'pdf') { downloadBlob(await svgToPdfBlob(svg, width, height, { scale, title: table.title }), `${base}.pdf`); return `Saved ${base}.pdf`; }
  throw new Error(`Unknown export format: ${format}`);
}

export async function runExport(project, table, format) {
  try {
    const message = await exportTable(project, table, format);
    toast(message, { type: 'success', duration: 2400 });
  } catch (err) { toastError(err, 'Export failed'); }
}

export function openExportMenu(anchor, project, table, { before } = {}) {
  const go = (format) => () => { before?.(); runExport(project, table, format); };
  openMenu(anchor, [
    { heading: 'Download' },
    { label: 'PNG image', icon: 'image', onClick: go('png') },
    { label: 'SVG (vector)', icon: 'figure', onClick: go('svg') },
    { label: 'PDF document', icon: 'fileText', onClick: go('pdf') },
    { label: 'HTML page', icon: 'file', onClick: go('html') },
    { label: 'CSV spreadsheet', icon: 'table', onClick: go('csv') },
    '-',
    { label: 'Copy for Word', icon: 'word', onClick: go('word') },
  ], { align: 'end' });
}

// ---------------------------------------------------------------------------
// Store actions (shared with the editor)

export function duplicateTable(store, id) {
  let copyId = null;
  store.update((p) => {
    const i = p.tables.findIndex((t) => t.id === id);
    if (i < 0) return;
    const src = p.tables[i];
    const copy = clone(src);
    copy.id = uid('tbl');
    copy.title = `${src.title} (copy)`;
    copy.versions = [];
    copy.columns.forEach((c) => { c.id = uid('col'); });
    copy.createdAt = Date.now(); copy.updatedAt = Date.now();
    p.tables.splice(i + 1, 0, copy);
    copyId = copy.id;
  }, { activity: { text: 'Duplicated a table', kind: 'create' } });
  return copyId;
}

export async function deleteTableWithUndo(store, id, { onDeleted } = {}) {
  const project = store.project;
  const table = project.tables.find((t) => t.id === id);
  if (!table) return false;
  const info = getNumbering(project).tables.get(id);
  const usages = findUsages(project, 'tab', id);
  const refs = usages.length
    ? `It is referenced in ${usages.length} place${usages.length === 1 ? '' : 's'}; those references will show as broken (${esc(info?.label || 'Table')} → ??) until you remove or relink them.`
    : 'Any references to it will show as broken until you remove them.';
  const ok = await confirmDialog({
    title: 'Delete this table?',
    message: `<strong>${esc(info?.label || 'Table')}: ${esc(table.title)}</strong> will be removed from the document. ${refs} You can undo right after deleting.`,
    confirmText: 'Delete table', danger: true,
  });
  if (!ok) return false;
  let removed = null; let index = -1;
  store.update((p) => { index = p.tables.findIndex((t) => t.id === id); if (index >= 0) [removed] = p.tables.splice(index, 1); },
    { activity: { text: `Deleted table "${table.title}"`, kind: 'delete' } });
  onDeleted?.();
  toast(`Deleted "${table.title}"`, {
    type: 'success', duration: 6000,
    action: { label: 'Undo', onClick: () => store.update((p) => { p.tables.splice(Math.min(index, p.tables.length), 0, removed); }, { activity: `Restored table "${table.title}"` }) },
  });
  return true;
}

/** Why a table cannot move in this direction, or null when it can. */
function moveBlocker(project, id, dir) {
  const n = getNumbering(project);
  const idx = n.tableOrder.findIndex((t) => t.id === id);
  const other = n.tableOrder[idx + dir];
  if (!other) return dir < 0 ? 'top' : 'bottom';
  const a = n.tables.get(id); const b = n.tables.get(other.id);
  return a.sectionId === b.sectionId && a.chapterId === b.chapterId ? null : 'section';
}

export function moveTable(store, id, dir) {
  const blocked = moveBlocker(store.project, id, dir);
  if (blocked === 'section') { toast('Can only reorder within the same section', { type: 'info' }); return false; }
  if (blocked) return false;
  const title = store.project.tables.find((t) => t.id === id)?.title;
  return store.update((p) => moveInDocumentOrder(p, 'tables', id, dir), { activity: `Moved table "${title}" ${dir < 0 ? 'up' : 'down'}` });
}

// ---------------------------------------------------------------------------
// Location pickers + details form (used by "New table" and "Edit details")

const chapterOptions = (project, selected) => {
  const n = getNumbering(project);
  return `<option value="">Unassigned</option>${project.chapters.map((ch) => `<option value="${esc(ch.id)}" ${ch.id === selected ? 'selected' : ''}>${esc(`${n.chapters.get(ch.id).label} · ${ch.title}`)}</option>`).join('')}`;
};

const sectionOptions = (project, chapterId, selected) => {
  if (!chapterId) return '<option value="">Choose a chapter first</option>';
  const secs = getNumbering(project).outline.filter((o) => o.kind === 'section' && o.chapterId === chapterId);
  return `<option value="">Whole chapter (no section)</option>${secs.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(`${s.number} ${s.title}`)}</option>`).join('')}`;
};

function detailsFormHTML(project, v) {
  return `
    <div class="field">
      <label for="td-title">Title <span style="color:var(--danger)">*</span></label>
      <input class="input" id="td-title" name="title" value="${esc(v.title)}" placeholder="e.g. Proposed System Features" autocomplete="off" maxlength="160">
      <div class="error-text" data-error="title"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="td-chapter">Chapter</label><select class="select" id="td-chapter" name="chapter">${chapterOptions(project, v.chapterId)}</select></div>
      <div class="field"><label for="td-section">Section</label><select class="select" id="td-section" name="section" ${v.chapterId ? '' : 'disabled'}>${sectionOptions(project, v.chapterId, v.sectionId)}</select></div>
    </div>
    <div class="field">
      <label for="td-desc">Description</label>
      <textarea class="textarea" id="td-desc" name="description" rows="3" placeholder="What does this table show? (optional)">${esc(v.description || '')}</textarea>
    </div>
    <div class="tbl-hint" data-hint></div>`;
}

function wireDetailsForm(root, project, { replaceId = null } = {}) {
  const chapter = root.querySelector('[name=chapter]');
  const section = root.querySelector('[name=section]');
  const hint = root.querySelector('[data-hint]');
  const read = () => {
    const sectionId = section.value || null;
    const sec = sectionId ? getNumbering(project).sections.get(sectionId) : null;
    return {
      title: root.querySelector('[name=title]').value.trim(),
      chapterId: sec ? sec.chapterId : (chapter.value || null),
      sectionId,
      description: root.querySelector('[name=description]').value.trim(),
    };
  };
  const refresh = () => {
    const loc = read();
    // A temporary project object (new identity → no stale numbering cache) shows the number this table would get.
    const probe = { id: replaceId || '__new__', ...loc };
    const tmp = { ...project, tables: replaceId ? project.tables.map((t) => (t.id === replaceId ? { ...t, ...loc } : t)) : [...project.tables, probe] };
    const info = getNumbering(tmp).tables.get(probe.id);
    hint.innerHTML = info
      ? `${icon('info', 'icon-sm')}<span>${replaceId ? 'This table will be' : 'This will be'} <strong>${esc(info.label)}</strong> <span class="muted">(${esc(info.code)}) · ${esc(info.location)}</span></span>`
      : '';
  };
  chapter.addEventListener('change', () => {
    section.innerHTML = sectionOptions(project, chapter.value, '');
    section.disabled = !chapter.value;
    refresh();
  });
  section.addEventListener('change', refresh);
  refresh();
  return { read, refresh };
}

function showTitleError(root, message) {
  root.querySelector('[data-error=title]').textContent = message || '';
  root.querySelector('[name=title]').classList.toggle('invalid', !!message);
}

export function openEditDetailsDialog(ctx, id) {
  const { store } = ctx;
  const table = store.project.tables.find((t) => t.id === id);
  if (!table) return null;
  const modal = openModal({
    title: 'Table details', subtitle: 'Title, location and description',
    body: `<form class="form-grid" novalidate>${detailsFormHTML(store.project, table)}<button type="submit" hidden></button></form>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
  });
  const form = modal.$('form');
  const wired = wireDetailsForm(form, store.project, { replaceId: id });
  const save = () => {
    const v = wired.read();
    if (!v.title) { showTitleError(form, 'Title is required.'); form.elements.title.focus(); return; }
    store.update((p) => {
      const t = p.tables.find((x) => x.id === id);
      Object.assign(t, { title: v.title, chapterId: v.chapterId, sectionId: v.sectionId, description: v.description, updatedAt: Date.now() });
    }, { activity: { text: `Edited details of table "${v.title}"`, targetId: id } });
    modal.close();
    toast('Table details saved', { type: 'success', duration: 1800 });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  modal.$('[data-save]').addEventListener('click', save);
  return modal;
}

// ---------------------------------------------------------------------------
// New table dialog

export function openNewTableDialog(ctx, preset = {}) {
  const { store } = ctx;
  const project = store.project;
  const nums = getNumbering(project);
  let chapterId = preset.chapterId || null; let sectionId = preset.sectionId || null;
  if (sectionId && nums.sections.has(sectionId)) chapterId = nums.sections.get(sectionId).chapterId; else sectionId = null;
  if (chapterId && !nums.chapters.has(chapterId)) chapterId = null;
  const values = { title: '', chapterId, sectionId, description: '' };
  let template = preset.template ? templateById(preset.template) : null;
  let wired = null;

  const modal = openModal({
    title: 'New table', subtitle: 'Choose a starting point',
    size: 'lg', className: 'tbl-new',
    body: '', footer: '<span></span>',
  });
  const subtitleEl = modal.root.querySelector('.modal-header p');

  const renderGallery = () => {
    subtitleEl.textContent = 'Choose a starting point';
    modal.body.innerHTML = `<div class="tpl-grid">${TABLE_TEMPLATES.map((tpl) => {
      const content = tpl.build();
      const preview = renderTableMiniHTML({ ...content, style: { ...createTable().style, ...(content.style || {}) } }, { rows: 3, cols: 6 });
      return `<button type="button" class="tpl-card ${template?.id === tpl.id ? 'selected' : ''}" data-tpl="${tpl.id}">
        <div class="tpl-preview">${preview}</div>
        <div class="tpl-name">${esc(tpl.name)}</div>
        <div class="tpl-desc">${esc(tpl.description)}</div>
      </button>`;
    }).join('')}</div>`;
    modal.footer.innerHTML = '<button class="btn" data-close>Cancel</button>';
  };

  const renderDetails = () => {
    subtitleEl.textContent = `${template.name} · add a title and choose where it belongs`;
    modal.body.innerHTML = `<form class="form-grid" novalidate>${detailsFormHTML(project, values)}<button type="submit" hidden></button></form>`;
    modal.footer.innerHTML = `<div class="left"><button class="btn btn-ghost" data-back>${icon('arrowLeft')}Templates</button></div>
      <button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-create>${icon('plus')}Create table</button>`;
    const form = modal.$('form');
    wired = wireDetailsForm(form, project);
    form.addEventListener('submit', (e) => { e.preventDefault(); create(); });
    form.elements.title.focus();
  };

  const stash = () => { if (wired) Object.assign(values, wired.read()); };

  const create = () => {
    const v = wired.read();
    const form = modal.$('form');
    if (!v.title) { showTitleError(form, 'Title is required.'); form.elements.title.focus(); return; }
    const content = template.build();
    const table = createTable({
      title: v.title, chapterId: v.chapterId, sectionId: v.sectionId, description: v.description,
      template: template.id, columns: content.columns, rows: content.rows, headerRows: content.headerRows,
      style: { ...createTable().style, ...(content.style || {}) },
    });
    store.update((p) => { p.tables.push(table); }, { activity: { text: `Created table "${v.title}"`, kind: 'create', targetId: table.id } });
    modal.close();
    ctx.navigate(ctx.href('tables', table.id));
  };

  modal.root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-tpl]');
    if (card) { template = templateById(card.dataset.tpl); renderDetails(); return; }
    if (e.target.closest('[data-back]')) { stash(); wired = null; renderGallery(); return; }
    if (e.target.closest('[data-create]')) create();
  });
  modal.root.addEventListener('dblclick', (e) => {
    const card = e.target.closest('[data-tpl]');
    if (card) { template = templateById(card.dataset.tpl); renderDetails(); }
  });

  if (template) renderDetails(); else renderGallery();
  return modal;
}

// ---------------------------------------------------------------------------
// The list view

const dims = (t) => `${t.rows.length} × ${t.columns.length}`;
const searchText = (t, info) => [t.title, t.description, info?.label, info?.code, ...t.rows.flat().map((c) => c.text)].join('\n').toLowerCase();

export default {
  title: 'Tables',
  mount(container, ctx) {
    const { store } = ctx;
    const state = { query: '', chapter: '' };
    const disposer = new Disposer();

    container.innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="titles">
            <h1>Tables <span class="badge" data-count></span></h1>
            <p class="subtitle">Tables are numbered automatically from their place in the document.</p>
          </div>
          <div class="actions"><button class="btn btn-primary" data-action="new">${icon('plus')}New Table</button></div>
        </div>
        <div class="toolbar">
          <div class="input-group">${icon('search')}<input class="input" type="search" data-search placeholder="Search title, description or cell text…" aria-label="Search tables" autocomplete="off"></div>
          <select class="select" style="width:auto;min-width:180px" data-chapter aria-label="Filter by chapter"></select>
        </div>
        <div data-list></div>
      </div>`;
    const listEl = container.querySelector('[data-list]');
    const countEl = container.querySelector('[data-count]');
    const chapterEl = container.querySelector('[data-chapter]');
    const searchEl = container.querySelector('[data-search]');

    const itemHTML = (t, n) => {
      const info = n.tables.get(t.id);
      const meta = [info.label, info.code, info.location, dims(t), `Last modified: ${relativeTime(t.updatedAt)}`].map(esc).join(' · ').replace(/ · /g, ' <span class="sep">·</span> ');
      const href = ctx.href('tables', t.id);
      return `
        <div class="list-item tbl-item" data-id="${esc(t.id)}">
          <a class="tbl-thumb" href="${esc(href)}" tabindex="-1" aria-hidden="true">${renderTableMiniHTML(t, { rows: 4, cols: 4 })}</a>
          <div class="grow tbl-main">
            <a class="title tbl-title" href="${esc(href)}"><span class="tbl-index">#${info.index}</span> ${highlight(t.title, state.query.trim())}</a>
            <div class="meta">${meta}</div>
            ${t.description ? `<div class="tbl-desc-line truncate">${esc(t.description)}</div>` : ''}
          </div>
          <div class="actions">
            <a class="btn btn-sm" href="${esc(href)}">${icon('edit')}Open</a>
            <button class="btn btn-sm btn-ghost btn-icon" data-action="duplicate" data-tip="Duplicate" aria-label="Duplicate table">${icon('duplicate')}</button>
            <button class="btn btn-sm btn-ghost" data-action="export" aria-label="Export table">${icon('export')}Export${icon('chevronDown', 'icon-sm')}</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-action="more" data-tip="More actions" aria-label="More actions">${icon('more')}</button>
          </div>
        </div>`;
    };

    const render = () => {
      const project = store.project;
      const n = getNumbering(project);
      countEl.textContent = project.tables.length;
      const keep = chapterEl.value || state.chapter;
      chapterEl.innerHTML = `<option value="">All chapters</option>${project.chapters.map((ch) => `<option value="${esc(ch.id)}">${esc(`${n.chapters.get(ch.id).label} · ${ch.title}`)}</option>`).join('')}<option value="__none">Unassigned</option>`;
      chapterEl.value = [...chapterEl.options].some((o) => o.value === keep) ? keep : '';
      state.chapter = chapterEl.value;

      if (!project.tables.length) {
        listEl.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('table')}</div><h3>No tables yet</h3>
          <p>Start from a template (features, comparison, requirements, test cases…) and fill it in with a Word-like editor.</p>
          <button class="btn btn-primary" data-action="new">${icon('plus')}Create your first table</button></div></div>`;
        return;
      }
      const q = state.query.trim().toLowerCase();
      const items = n.tableOrder.filter((t) => {
        const info = n.tables.get(t.id);
        if (state.chapter === '__none' ? info.chapterId : (state.chapter && info.chapterId !== state.chapter)) return false;
        return !q || searchText(t, info).includes(q);
      });
      if (!items.length) {
        listEl.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>No matching tables</h3><p>Try a different search or clear the chapter filter.</p>
          <button class="btn" data-action="clear">Clear filters</button></div></div>`;
        return;
      }
      let html = ''; let lastKey;
      for (const t of items) {
        const info = n.tables.get(t.id);
        const key = info.chapterId || '__none';
        if (key !== lastKey) {
          lastKey = key;
          html += `<div class="list-group-title">${info.chapterId ? esc(`${n.chapters.get(info.chapterId).label} · ${n.chapters.get(info.chapterId).title}`) : 'Unassigned'}</div>`;
        }
        html += itemHTML(t, n);
      }
      listEl.innerHTML = `<div class="list">${html}</div>`;
    };

    render();
    disposer.add(store.on('change', render));
    disposer.listen(searchEl, 'input', () => { state.query = searchEl.value; render(); });
    disposer.listen(chapterEl, 'change', () => { state.chapter = chapterEl.value; render(); });

    const idOf = (el) => el.closest('[data-id]')?.dataset.id;
    disposer.add(on(container, 'click', '[data-action]', (e, el) => {
      const action = el.dataset.action;
      const id = idOf(el);
      const table = id && store.project.tables.find((t) => t.id === id);
      if (action === 'new') openNewTableDialog(ctx, { chapterId: state.chapter && state.chapter !== '__none' ? state.chapter : null });
      else if (action === 'clear') { state.query = ''; state.chapter = ''; searchEl.value = ''; chapterEl.value = ''; render(); } else if (action === 'duplicate' && table) {
        const copyId = duplicateTable(store, id);
        toast(`Duplicated "${table.title}"`, { type: 'success', action: { label: 'Open copy', onClick: () => ctx.navigate(ctx.href('tables', copyId)) } });
      } else if (action === 'export' && table) openExportMenu(el, store.project, table);
      else if (action === 'more' && table) {
        const up = moveBlocker(store.project, id, -1); const down = moveBlocker(store.project, id, 1);
        openMenu(el, [
          { label: 'Move up', icon: 'arrowUp', disabled: up === 'top', onClick: () => moveTable(store, id, -1) },
          { label: 'Move down', icon: 'arrowDown', disabled: down === 'bottom', onClick: () => moveTable(store, id, 1) },
          '-',
          { label: 'Edit details…', icon: 'edit', onClick: () => openEditDetailsDialog(ctx, id) },
          { label: 'Open editor', icon: 'table', onClick: () => ctx.navigate(ctx.href('tables', id)) },
          '-',
          { label: 'Delete…', icon: 'trash', danger: true, onClick: () => deleteTableWithUndo(store, id) },
        ], { align: 'end' });
      }
    }));

    if (ctx.params.query?.new === '1') {
      const sectionId = ctx.params.query.section || null;
      const chapterId = ctx.params.query.chapter || null;
      openNewTableDialog(ctx, { sectionId, chapterId });
      // Drop ?new=1 from the URL once the dialog is open (after mount has finished).
      setTimeout(() => ctx.navigate(ctx.href('tables'), { replace: true }), 0);
    }

    return { unmount() { disposer.dispose(); } };
  },
};
