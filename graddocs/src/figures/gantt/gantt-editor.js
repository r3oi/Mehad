// Gantt editor (#/p/<id>/gantt/<figureId>): a project schedule edited as data — a table of tasks and dates — with a
// live preview of the chart. The schedule lives in figure.gantt; figure.diagram is rebuilt from it after every change
// (ganttDiagram), so thumbnails, Document Preview, Word and the SVG / PNG / PDF exports need no Gantt knowledge.
//
// Editing model: the editor works on `draft` (a copy of figure.gantt). Typing only touches the draft and is committed
// to the store after a short pause; structural edits (indent, move, insert, delete, paste, settings) run a pure
// operation from gantt-ops.js and commit at once. Undo / redo keeps snapshots of the draft.
import { esc, on, Disposer } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal, confirmDialog } from '../../ui/modal.js';
import { openMenu } from '../../ui/menu.js';
import { toast } from '../../ui/toast.js';
import { getNumbering } from '../../core/numbering.js';
import { findFigure } from '../../core/model.js';
import { clearPlacement } from '../../core/references.js';
import { clone, uid, isTypingTarget, modKey, modLabel } from '../../core/utils.js';
import { prefs } from '../../app/prefs.js';
import { t, isRTL } from '../../i18n/index.js';
import { renderFigureSVG } from '../render.js';
import { figureFonts } from '../types.js';
import { addVersion, isDirty } from '../versions.js';
import { History } from '../editor/history.js';
import { exportFigure, locationOptions, parseLocation } from '../figures-view.js';
import {
  normalizeGantt, ganttDiagram, isPhase, wbsNumbers, effectiveSpans, weekRange,
  isoOf, dayOf, isValidISO, durationDays,
} from './gantt-model.js';
import * as ops from './gantt-ops.js';
import { parseTaskRows } from './gantt-ops.js';

export { parseTaskRows };

const SRC = 'gantt-editor';
const MAX_WEEKS = 260; // a chart wider than 5 years is almost certainly a mistyped year
const MIN_DATE = '2000-01-01'; const MAX_DATE = '2100-12-31';
const COLORS = ['#0891B2', '#2563EB', '#7C3AED', '#16A34A', '#EA580C', '#DC2626', '#475569'];
const NAME_MAX = 100;
// Menus anchor to a physical edge: the end of the header is on the left in Arabic.
const MENU_END = isRTL ? 'start' : 'end';

const inRange = (iso) => isValidISO(iso) && iso >= MIN_DATE && iso <= MAX_DATE;
const sameGantt = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The stored form of a draft: repaired by normalizeGantt, phase dates following their sub-tasks. */
const finalize = (g) => { const n = normalizeGantt(g); ops.syncPhases(n.tasks); return n; };

export default {
  title: 'Gantt Chart',
  layout: 'flush',
  mount(container, ctx) {
    const { store, shell } = ctx;
    const figureId = ctx.params.id;
    const getFigure = () => (store.project ? findFigure(store.project, figureId) : null);
    const figure0 = getFigure();

    if (!figure0 || figure0.type !== 'gantt' || !figure0.gantt) {
      if (figure0) { location.replace(ctx.href('figures', figureId)); return {}; } // not a Gantt chart (or one without a schedule): the drawing editor
      container.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('figure')}</div><h3>${t('Figure not found')}</h3><p>${t('It may have been deleted.')}</p><a class="btn btn-primary" href="${esc(ctx.href('figures'))}">${t('Back to Figures')}</a></div></div>`;
      return {};
    }

    const D = new Disposer();
    const history = new History(100);
    let draft = normalizeGantt(figure0.gantt);
    let lastStored = JSON.stringify(figure0.gantt ?? null);
    let commitTimer = 0; let previewTimer = 0; let noteTimer = 0; let fixedTimer = 0; let titleTimer = 0;
    let textDirty = false; // typed text not yet committed to the store
    let previewKey = '';
    let rendering = false;
    let deleted = false;
    let zoom = prefs.get('ganttZoom', 'fit') === '100' ? '100' : 'fit';

    // ----- Skeleton -------------------------------------------------------------------------------------------
    const hbtn = (act, ic, tip, kbd) => `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-head="${act}" data-tip="${esc(tip)}"${kbd ? ` data-kbd="${esc(kbd)}"` : ''} aria-label="${esc(tip)}">${icon(ic)}</button>`;
    container.innerHTML = `
      <div class="gt">
        <header class="gt-head">
          <div class="gt-head-row">
            <a class="btn btn-ghost btn-sm gt-back" href="${esc(ctx.href('figures'))}" data-tip="${esc(t('Back to Figures'))}" aria-label="${esc(t('Back to Figures'))}">${icon('arrowLeft')}<span>${t('Figures')}</span></a>
            <span class="badge badge-primary gt-label" data-label dir="auto"></span>
            <input class="gt-title" data-title dir="auto" aria-label="${esc(t('Figure title'))}" placeholder="${esc(t('Untitled figure'))}" maxlength="160" autocomplete="off" spellcheck="true">
            <div class="gt-head-actions">
              ${hbtn('undo', 'undo', t('Undo'), `${modLabel} Z`)}${hbtn('redo', 'redo', t('Redo'), `${modLabel} Y`)}
              <button class="btn btn-sm btn-primary" data-head="export" aria-haspopup="menu">${icon('export', 'icon-sm')}<span class="gt-btn-label">${t('Export')}</span>${icon('chevronDown', 'icon-sm')}</button>
              <button class="btn btn-sm btn-ghost btn-icon" data-head="more" data-tip="${esc(t('More actions'))}" aria-label="${esc(t('More actions'))}" aria-haspopup="menu">${icon('more')}</button>
            </div>
          </div>
          <div class="gt-head-row gt-meta">
            <label class="gt-field"><span>${t('Chapter / section')}</span><select class="select select-sm" data-location></select></label>
            <span class="gt-saved" data-saved></span>
          </div>
        </header>
        <div class="gt-body">
          <section class="gt-pane gt-pane-main">
            <div class="gt-card gt-tasks">
              <div class="gt-card-head">
                <h2>${t('Tasks')}</h2>
                <span class="gt-sub" data-summary></span>
                <span class="spacer"></span>
                <button class="btn btn-sm" data-do="paste" data-tip="${esc(t('Paste rows copied from Excel, Google Sheets or a Word table'))}">${icon('clipboard', 'icon-sm')}<span>${t('Paste from Excel')}</span></button>
              </div>
              <div class="gt-scroll" data-scroll>
                <table class="gt-table">
                  <thead><tr>
                    <th class="gt-c-wbs" scope="col">${t('WBS')}</th>
                    <th class="gt-c-name" scope="col">${t('Task name')}</th>
                    <th class="gt-c-date" scope="col">${t('Start')}</th>
                    <th class="gt-c-date" scope="col">${t('End')}</th>
                    <th class="gt-c-days" scope="col">${t('Days')}</th>
                    <th class="gt-c-actions" scope="col"><span class="sr-only">${t('Row actions')}</span></th>
                  </tr></thead>
                  <tbody data-rows></tbody>
                </table>
              </div>
              <div class="gt-empty" data-empty hidden>
                <div class="empty-icon">${icon('tTimeline')}</div>
                <h3>${t('No tasks yet')}</h3>
                <p>${t('Add your first task, or paste a schedule copied from Excel.')}</p>
                <div class="gt-empty-actions">
                  <button class="btn btn-primary" data-do="add-task">${icon('plus', 'icon-sm')} ${t('Add task')}</button>
                  <button class="btn" data-do="add-phase">${icon('plus', 'icon-sm')} ${t('Add phase')}</button>
                  <button class="btn" data-do="paste">${icon('clipboard', 'icon-sm')} ${t('Paste from Excel')}</button>
                </div>
              </div>
              <div class="gt-card-foot">
                <button class="btn btn-sm" data-do="add-task">${icon('plus', 'icon-sm')} ${t('Add task')}</button>
                <button class="btn btn-sm" data-do="add-phase" data-tip="${esc(t('A phase groups the tasks below it; its dates come from them'))}">${icon('plus', 'icon-sm')} ${t('Add phase')}</button>
                <span class="gt-note" data-note role="status" aria-live="polite" hidden></span>
                <span class="gt-hint">${t('Enter: next task · Tab: next field · {shortcut}: undo', { shortcut: `${modLabel}+Z` })}</span>
              </div>
            </div>
          </section>
          <section class="gt-pane gt-pane-side">
            <div class="gt-card gt-previewcard">
              <div class="gt-card-head">
                <h2>${t('Preview')}</h2>
                <span class="spacer"></span>
                <div class="segmented" role="group" aria-label="${esc(t('Zoom'))}">
                  <button type="button" data-zoom="fit">${t('Fit')}</button>
                  <button type="button" data-zoom="100">100%</button>
                </div>
              </div>
              <div class="gt-preview" data-preview></div>
            </div>
            <div class="gt-card gt-settings">
              <div class="gt-card-head"><h2>${t('Chart settings')}</h2></div>
              <div class="gt-set">
                <div class="field">
                  <label id="gt-l-week">${t('Week starts on')}</label>
                  <div class="segmented" role="group" aria-labelledby="gt-l-week">
                    <button type="button" data-weekstart="0">${t('Sunday')}</button>
                    <button type="button" data-weekstart="1">${t('Monday')}</button>
                  </div>
                </div>
                <div class="field">
                  <label id="gt-l-color">${t('Bar colour')}</label>
                  <div class="gt-swatches" role="group" aria-labelledby="gt-l-color">
                    ${COLORS.map((c) => `<button type="button" class="gt-swatch" style="--c:${c}" data-color="${c}" data-tip="${c}" aria-label="${c}"></button>`).join('')}
                    <label class="gt-custom" data-tip="${esc(t('Custom colour'))}"><input type="color" data-custom-color aria-label="${esc(t('Custom colour'))}"></label>
                  </div>
                </div>
                <div class="gt-flags">
                  <label class="switch"><input type="checkbox" data-flag="showIdle"><span class="track"></span><span>${t('Show grey weeks with no work')}</span></label>
                  <label class="switch"><input type="checkbox" data-flag="showWbs"><span class="track"></span><span>${t('Show WBS column')}</span></label>
                  <label class="switch"><input type="checkbox" data-flag="showDates"><span class="track"></span><span>${t('Show start and end columns')}</span></label>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>`;

    const $ = (sel) => container.querySelector(sel);
    const root = $('.gt'); const rowsEl = $('[data-rows]'); const scrollEl = $('[data-scroll]'); const emptyEl = $('[data-empty]');
    const footEl = $('.gt-card-foot'); const titleEl = $('[data-title]'); const locEl = $('[data-location]'); const noteEl = $('[data-note]'); const previewEl = $('[data-preview]');

    // ----- Store helpers ------------------------------------------------------------------------------------------
    const fonts = () => figureFonts(store.project);
    const activityOf = () => ({ text: `Edited figure “${getFigure()?.title ?? ''}”`, kind: 'edit', targetId: figureId });

    /** Write the draft to the store: figure.gantt, and figure.diagram rebuilt from it. */
    function commit() {
      clearTimeout(commitTimer); commitTimer = 0; textDirty = false;
      if (deleted || !getFigure()) return;
      const next = finalize(draft);
      store.update((p) => {
        const f = findFigure(p, figureId);
        if (!f) return;
        f.gantt = next;
        f.diagram = ganttDiagram(next, figureFonts(p));
        f.updatedAt = Date.now();
      }, { activity: activityOf(), source: SRC });
      lastStored = JSON.stringify(next);
      paintPreview(); refreshSummary(); refreshStatus();
    }
    /** Typing: commit after a pause (the preview follows sooner). */
    function scheduleCommit(wait = 400) {
      textDirty = true;
      clearTimeout(commitTimer); commitTimer = setTimeout(commit, wait);
      clearTimeout(previewTimer); previewTimer = setTimeout(paintPreview, 160);
      refreshStatus();
    }
    const flush = () => { settleAll(); if (textDirty || commitTimer) commit(); };

    // ----- Undo / redo ---------------------------------------------------------------------------------------------
    function updateHistoryButtons() {
      for (const [act, can] of [['undo', history.canUndo], ['redo', history.canRedo]]) {
        const b = $(`[data-head="${act}"]`); if (b) b.disabled = !can;
      }
    }
    function restore(snapshot) {
      const a = document.activeElement;
      const focus = a && rowsEl.contains(a) && a.closest('tr') ? { id: a.closest('tr').dataset.id, field: a.dataset.field || (a.dataset.act ? `act:${a.dataset.act}` : 'name') } : null;
      draft = clone(snapshot);
      commit(); renderAll(focus);
    }
    function undo() { flush(); const prev = history.undo(clone(draft)); if (prev) restore(prev); updateHistoryButtons(); }
    function redo() { flush(); const next = history.redo(clone(draft)); if (next) restore(next); updateHistoryButtons(); }

    /**
     * Apply a change to the schedule. `fn(draft)` returns the new gantt (or null / false to cancel). Records an undo step,
     * commits at once and redraws the table. Returns true when something changed.
     */
    function change(fn, { focus = null, mergeKey = null, quiet = false } = {}) {
      flush();
      const before = clone(draft);
      const result = fn(clone(draft));
      if (!result) return false;
      const next = finalize(result);
      if (sameGantt(next, finalize(before))) return false;
      if (weekRange(next).count > MAX_WEEKS) { toast(t('That would stretch the chart over more than {n} weeks. Check the dates.', { n: MAX_WEEKS }), { type: 'warning' }); return false; }
      history.record(before, mergeKey);
      draft = next;
      commit();
      if (!quiet) renderAll(focus);
      updateHistoryButtons();
      return true;
    }
    const indexOf = (id) => draft.tasks.findIndex((x) => x.id === id);

    // ----- Rendering: table ------------------------------------------------------------------------------------------
    // The row actions are one toolbar stop (Tab reaches "insert", the arrow keys move along the buttons) so that Tab
    // from the end date goes straight on to the next row instead of through six buttons.
    const actBtn = (act, ic, label, disabled) => `<button type="button" class="btn btn-ghost btn-icon btn-sm gt-act" data-act="${act}" tabindex="${act === 'insert' ? 0 : -1}" data-tip="${esc(label)}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>${icon(ic)}</button>`;

    function rowHTML(task, i, tasks, wbs, spans) {
      const phase = isPhase(tasks, i);
      const [s, e] = [isoOf(spans[i][0]), isoOf(spans[i][1])];
      const hint = phase ? ` data-tip="${esc(t('Dates come from the sub-tasks'))}"` : '';
      const dis = phase ? ' disabled' : '';
      const date = (field, value, label) => `<span class="gt-datewrap"${hint}><input type="date" class="gt-date" data-field="${field}" dir="ltr" value="${value}" min="${MIN_DATE}" max="${MAX_DATE}" aria-label="${esc(label)}"${dis}></span>`;
      return `<tr data-id="${esc(task.id)}" class="gt-row lvl-${task.level}${phase ? ' is-phase' : ''}">
        <td class="gt-c-wbs" dir="ltr">${esc(wbs[i])}</td>
        <td class="gt-c-name"><input class="gt-name" data-field="name" dir="auto" value="${esc(task.name)}" maxlength="${NAME_MAX}" aria-label="${esc(t('Task name'))}" spellcheck="false" autocomplete="off"></td>
        <td class="gt-c-date">${date('start', s, t('Start date'))}</td>
        <td class="gt-c-date">${date('end', e, t('End date'))}</td>
        <td class="gt-c-days" dir="ltr" data-days>${durationDays(s, e)}</td>
        <td class="gt-c-actions"><div class="gt-actions" role="toolbar" aria-label="${esc(t('Row actions'))}">
          ${actBtn('outdent', 'outdent', t('Outdent (move one level out)'), !ops.canOutdent(tasks, i))}
          ${actBtn('indent', 'indent', t('Indent (make a sub-task)'), !ops.canIndent(tasks, i))}
          ${actBtn('up', 'arrowUp', t('Move up'), !ops.canMoveUp(tasks, i))}
          ${actBtn('down', 'arrowDown', t('Move down'), !ops.canMoveDown(tasks, i))}
          ${actBtn('insert', 'plus', t('Insert a task below'), false)}
          ${actBtn('delete', 'trash', t('Delete'), false)}
        </div></td>
      </tr>`;
    }

    function renderRows(focus = null) {
      const tasks = draft.tasks;
      const wbs = wbsNumbers(tasks); const spans = effectiveSpans(tasks);
      rendering = true; // replacing the rows blurs the focused input: its focusout must not write the old text back
      try { rowsEl.innerHTML = tasks.map((task, i) => rowHTML(task, i, tasks, wbs, spans)).join(''); } finally { rendering = false; }
      scrollEl.hidden = !tasks.length; emptyEl.hidden = !!tasks.length; footEl.hidden = !tasks.length;
      if (focus) restoreFocus(focus);
    }

    function restoreFocus({ id, field = 'name', select = false }) {
      const tr = rowsEl.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (!tr) return;
      let el = field.startsWith('act:') ? tr.querySelector(`[data-act="${field.slice(4)}"]`) : tr.querySelector(`[data-field="${field}"]`);
      if (!el || el.disabled) el = tr.querySelector('[data-field="name"]');
      el.focus({ preventScroll: true });
      if (select && el.select) el.select();
      tr.scrollIntoView({ block: 'nearest' });
    }

    /** After a date or text edit: refresh what is computed (phase dates, day counts) without touching the inputs being typed in. */
    function refreshDerived() {
      const tasks = draft.tasks; const spans = effectiveSpans(tasks);
      [...rowsEl.rows].forEach((tr, i) => {
        if (!tasks[i]) return;
        const [s, e] = [isoOf(spans[i][0]), isoOf(spans[i][1])];
        for (const [field, value] of [['start', s], ['end', e]]) {
          const input = tr.querySelector(`[data-field="${field}"]`);
          if (input && input.value !== value && (document.activeElement !== input || tr.classList.contains('is-phase'))) input.value = value;
        }
        tr.querySelector('[data-days]').textContent = e >= s ? durationDays(s, e) : '–';
      });
      refreshSummary();
    }

    function refreshSummary() {
      const g = finalize(draft);
      const el = $('[data-summary]');
      if (!g.tasks.length) { el.textContent = ''; return; }
      const spans = effectiveSpans(g.tasks);
      const lo = Math.min(...spans.map((x) => x[0])); const hi = Math.max(...spans.map((x) => x[1]));
      el.innerHTML = `${esc(t('Tasks: {n}', { n: g.tasks.length }))} <span class="sep">·</span> ${esc(t('Weeks: {n}', { n: weekRange(g).count }))} <span class="sep">·</span> <bdi dir="ltr">${isoOf(lo)} → ${isoOf(hi)}</bdi>`;
    }

    // ----- Rendering: settings, preview, header -------------------------------------------------------------------------
    function renderSettings() {
      root.querySelectorAll('[data-weekstart]').forEach((b) => { const on = Number(b.dataset.weekstart) === draft.weekStart; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
      const color = draft.color.toLowerCase();
      root.querySelectorAll('[data-color]').forEach((b) => { const on = b.dataset.color.toLowerCase() === color; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
      const custom = $('[data-custom-color]');
      if (custom.value !== color) custom.value = color;
      $('.gt-custom').classList.toggle('active', !COLORS.some((c) => c.toLowerCase() === color));
      root.querySelectorAll('[data-flag]').forEach((cb) => { cb.checked = draft[cb.dataset.flag] !== false; });
      root.querySelectorAll('[data-zoom]').forEach((b) => { const on = b.dataset.zoom === zoom; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
      previewEl.dataset.zoom = zoom;
    }

    function paintPreview() {
      clearTimeout(previewTimer);
      const g = finalize(draft);
      const key = JSON.stringify([g, fonts()]);
      if (key === previewKey) return;
      previewKey = key;
      if (!g.tasks.length) { previewEl.innerHTML = `<div class="gt-preview-empty">${icon('tTimeline')}<p>${t('The chart appears here once you add a task.')}</p></div>`; return; }
      const { svg, width } = renderFigureSVG(ganttDiagram(g, fonts()));
      previewEl.innerHTML = `<div class="gt-paper" style="--w:${width}px">${svg}</div>`;
    }

    function refreshMeta() {
      const f = getFigure(); if (!f) return;
      const info = getNumbering(store.project).figures.get(figureId);
      $('[data-label]').textContent = info ? `${info.label} · ${info.code}` : t('Figure');
      if (document.activeElement !== titleEl) titleEl.value = f.title;
      locEl.innerHTML = locationOptions(store.project, f.sectionId ? `sec:${f.sectionId}` : f.chapterId ? `ch:${f.chapterId}` : '');
      shell.setBreadcrumbs([{ label: t('Figures'), href: ctx.href('figures') }, { label: info ? `${info.label}: ${f.title}` : f.title }]);
      document.title = `${info?.label || t('Figure')} · ${f.title} · GradDocs`;
    }

    function refreshStatus() {
      const el = $('[data-saved]');
      const saving = textDirty || store.status === 'saving';
      el.textContent = store.status === 'error' ? t('Not saved') : saving ? t('Saving…') : t('Saved');
      el.dataset.state = store.status === 'error' ? 'error' : saving ? 'saving' : 'saved';
    }

    function renderAll(focus = null) {
      renderRows(focus); renderSettings(); paintPreview(); refreshSummary(); refreshStatus(); updateHistoryButtons();
    }

    /** A gentle, self-clearing message next to the Add buttons. */
    function note(message, fixedInput = null) {
      noteEl.textContent = message; noteEl.hidden = false;
      clearTimeout(noteTimer); noteTimer = setTimeout(() => { noteEl.hidden = true; }, 5500);
      if (fixedInput) {
        fixedInput.classList.add('gt-fixed');
        clearTimeout(fixedTimer); fixedTimer = setTimeout(() => fixedInput.classList.remove('gt-fixed'), 2200);
      }
    }

    // ----- Header ----------------------------------------------------------------------------------------------------------
    function commitTitle() {
      clearTimeout(titleTimer);
      const value = titleEl.value.trim();
      const f = getFigure();
      if (!f || !value || value === f.title) return;
      store.update((p) => { const x = findFigure(p, figureId); x.title = value; x.updatedAt = Date.now(); }, { activity: { text: `Updated details of “${value}”`, targetId: figureId }, source: SRC });
      refreshMeta();
    }
    D.listen(titleEl, 'input', () => { clearTimeout(titleTimer); titleTimer = setTimeout(commitTitle, 350); });
    D.listen(titleEl, 'blur', () => { commitTitle(); if (!titleEl.value.trim() && getFigure()) titleEl.value = getFigure().title; });
    D.listen(titleEl, 'keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); titleEl.blur(); } });
    D.listen(locEl, 'change', () => {
      const loc = parseLocation(store.project, locEl.value);
      store.update((p) => {
        const f = findFigure(p, figureId);
        if (loc.chapterId !== f.chapterId || loc.sectionId !== f.sectionId) clearPlacement(p, 'figure', figureId); // the new location replaces any spot inside the text
        Object.assign(f, loc, { updatedAt: Date.now() });
      }, { activity: { text: `Updated details of “${getFigure().title}”`, targetId: figureId }, source: SRC });
      refreshMeta();
    });

    // ----- Row actions ------------------------------------------------------------------------------------------------------
    const nameOf = (id) => draft.tasks[indexOf(id)]?.name || '';

    function addTask() {
      let made = null;
      change((d) => { const r = ops.appendTask(d.tasks); made = r.task; return { ...d, tasks: r.tasks }; }, { focus: null });
      if (made) restoreFocus({ id: made.id, field: 'name', select: true });
    }
    function addPhase() {
      let made = null;
      change((d) => { const r = ops.appendPhase(d.tasks); made = r.task; return { ...d, tasks: r.tasks }; });
      if (made) restoreFocus({ id: made.id, field: 'name', select: true });
    }
    function insertBelow(id) {
      let made = null;
      change((d) => { const i = d.tasks.findIndex((x) => x.id === id); const r = ops.insertBelow(d.tasks, i); if (!r) return null; made = r.task; return { ...d, tasks: r.tasks }; });
      if (made) restoreFocus({ id: made.id, field: 'name', select: true });
    }
    function deleteRow(id) {
      const i = indexOf(id); if (i < 0) return;
      const subs = ops.blockEnd(draft.tasks, i) - i - 1;
      const name = nameOf(id);
      const done = (keepChildren) => {
        const removedAll = !keepChildren;
        if (change((d) => ({ ...d, tasks: ops.removeTask(d.tasks, d.tasks.findIndex((x) => x.id === id), { keepChildren }) }))) {
          const next = rowsEl.rows[Math.min(i, rowsEl.rows.length - 1)];
          next?.querySelector('[data-field="name"]')?.focus({ preventScroll: true });
          toast(removedAll && subs ? t('Deleted “{name}” and its {n} sub-tasks', { name, n: subs }) : t('Deleted “{name}”', { name }), { type: 'success', action: { label: t('Undo'), onClick: undo } });
        }
      };
      if (!subs) { done(false); return; }
      const modal = openModal({
        title: t('Delete the phase “{name}”?', { name }), size: 'sm',
        body: `<p style="color:var(--text-2)">${t('This phase has {n} sub-tasks. You can delete them with it, or keep them as ordinary tasks.', { n: subs })}</p>`,
        footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn" data-keep>${t('Keep the sub-tasks')}</button><button class="btn btn-danger" data-all>${t('Delete all')}</button>`,
      });
      modal.$('[data-keep]').addEventListener('click', () => { modal.close(); done(true); });
      modal.$('[data-all]').addEventListener('click', () => { modal.close(); done(false); });
    }

    D.add(on(rowsEl, 'click', '[data-act]', (e, el) => {
      if (el.disabled) return;
      const id = el.closest('tr').dataset.id; const act = el.dataset.act;
      const withRow = (fn) => (d) => { const i = d.tasks.findIndex((x) => x.id === id); const tasks = fn(d.tasks, i); return tasks ? { ...d, tasks } : null; };
      if (act === 'indent') change(withRow(ops.indentTask), { focus: { id, field: 'act:indent' } });
      else if (act === 'outdent') change(withRow(ops.outdentTask), { focus: { id, field: 'act:outdent' } });
      else if (act === 'up') change(withRow((tasks, i) => ops.moveTask(tasks, i, -1)), { focus: { id, field: 'act:up' } });
      else if (act === 'down') change(withRow((tasks, i) => ops.moveTask(tasks, i, 1)), { focus: { id, field: 'act:down' } });
      else if (act === 'insert') insertBelow(id);
      else if (act === 'delete') deleteRow(id);
    }));

    D.add(on(rowsEl, 'keydown', '.gt-act', (e, el) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      const group = [...el.closest('.gt-actions').querySelectorAll('.gt-act:not(:disabled)')];
      let k = group.indexOf(el);
      if (e.key === 'Home') k = 0; else if (e.key === 'End') k = group.length - 1;
      else k += (e.key === 'ArrowRight') === !isRTL ? 1 : -1; // in Arabic the toolbar runs right to left
      e.preventDefault();
      group[Math.max(0, Math.min(group.length - 1, k))].focus();
    }));

    // ----- Row inputs: names (debounced) and dates ----------------------------------------------------------------------------
    D.add(on(rowsEl, 'input', '[data-field="name"]', (e, el) => {
      const id = el.closest('tr').dataset.id; const i = indexOf(id);
      if (i < 0) return;
      history.record(clone(draft), `name:${id}`); updateHistoryButtons();
      draft.tasks[i].name = el.value;
      scheduleCommit();
    }));
    D.add(on(rowsEl, 'focusout', '[data-field="name"]', (e, el) => {
      if (rendering) return;
      const i = indexOf(el.closest('tr').dataset.id);
      if (i < 0) return;
      const value = el.value.trim() || 'Untitled task';
      if (el.value !== value) el.value = value;
      if (draft.tasks[i].name !== value) { draft.tasks[i].name = value; scheduleCommit(150); }
    }));
    D.add(on(rowsEl, 'keydown', '[data-field="name"]', (e, el) => {
      if (e.isComposing) return;
      const tr = el.closest('tr');
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = tr.nextElementSibling;
        if (next) { const input = next.querySelector('[data-field="name"]'); input.focus(); input.select(); next.scrollIntoView({ block: 'nearest' }); return; }
        insertBelow(tr.dataset.id); // the last row: start a new one
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const other = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
        if (!other) return;
        e.preventDefault();
        const input = other.querySelector('[data-field="name"]'); input.focus(); input.select();
      }
    }));

    // Dates. A date typed with the keyboard passes through half-finished values (month "01" before "11", years 0002 …), so
    // an end before the start is only repaired once the typing has settled or the field is left.
    const fixTimers = new Map();
    function settleDates(id) {
      clearTimeout(fixTimers.get(id)); fixTimers.delete(id);
      const i = indexOf(id);
      if (i < 0 || isPhase(draft.tasks, i)) return;
      const task = draft.tasks[i];
      if (dayOf(task.end) >= dayOf(task.start)) return;
      task.end = task.start;
      const endInput = rowsEl.rows[i]?.querySelector('[data-field="end"]');
      if (endInput) endInput.value = task.end;
      note(t('The end date cannot be before the start date, so it was set to the start date.'), endInput);
      refreshDerived(); scheduleCommit(150);
    }
    function settleAll() { for (const id of [...fixTimers.keys()]) settleDates(id); }

    D.add(on(rowsEl, 'change', '.gt-date', (e, el) => {
      const id = el.closest('tr').dataset.id; const field = el.dataset.field;
      const i = indexOf(id);
      if (i < 0 || isPhase(draft.tasks, i)) return;
      const value = el.value;
      if (!inRange(value)) return; // half-typed years and cleared fields wait for a complete date
      const task = draft.tasks[i];
      if (task[field] === value) return;
      const before = clone(draft);
      task[field] = value;
      if (weekRange(finalize(draft)).count > MAX_WEEKS) {
        draft = before; el.value = before.tasks[i][field];
        toast(t('That would stretch the chart over more than {n} weeks. Check the dates.', { n: MAX_WEEKS }), { type: 'warning' });
        return;
      }
      history.record(before, `date:${id}:${field}`);
      refreshDerived(); updateHistoryButtons();
      scheduleCommit(250);
      clearTimeout(fixTimers.get(id)); fixTimers.set(id, setTimeout(() => settleDates(id), 900));
    }));
    D.add(on(rowsEl, 'focusout', '.gt-date', (e, el) => {
      if (rendering) return;
      const tr = el.closest('tr'); const id = tr.dataset.id; const i = indexOf(id);
      if (i < 0) return;
      // A date left cleared or half-typed goes back to the stored one.
      const stored = isoOf(effectiveSpans(draft.tasks)[i][el.dataset.field === 'start' ? 0 : 1]);
      if (!inRange(el.value) || el.value !== stored) el.value = stored;
      const next = e.relatedTarget;
      if (next && tr.contains(next) && next.matches?.('.gt-date')) return; // moving from the start to the end date of the same task
      settleDates(id);
    }));

    // ----- Buttons: head, table, settings ------------------------------------------------------------------------------------------
    D.add(on(container, 'click', '[data-do]', (e, el) => {
      const act = el.dataset.do;
      if (act === 'add-task') addTask();
      else if (act === 'add-phase') addPhase();
      else if (act === 'paste') openPasteDialog();
    }));

    const fileExport = async (kind) => { flush(); await exportFigure(store.project, getFigure(), kind); };
    D.add(on(container, 'click', '[data-head]', (e, el) => {
      const act = el.dataset.head;
      if (act === 'undo') undo();
      else if (act === 'redo') redo();
      else if (act === 'export') {
        openMenu(el, [
          { heading: t('Download') },
          { label: t('SVG (vector)'), icon: 'image', onClick: () => fileExport('svg') },
          { label: t('PNG (high resolution)'), icon: 'image', onClick: () => fileExport('png') },
          { label: t('PDF'), icon: 'fileText', onClick: () => fileExport('pdf') },
          '-',
          { label: t('Copy image'), icon: 'clipboard', onClick: () => fileExport('copy') },
        ], { align: MENU_END });
      } else if (act === 'more') {
        openMenu(el, [
          { label: t('Duplicate figure'), icon: 'duplicate', onClick: duplicateFigure },
          { label: t('Convert to a free drawing…'), icon: 'diagram', onClick: convertToDrawing },
          '-',
          { label: t('Delete figure'), icon: 'trash', danger: true, onClick: deleteFigure },
        ], { align: MENU_END });
      }
    }));

    D.add(on(root, 'click', '[data-weekstart]', (e, el) => change((d) => ({ ...d, weekStart: Number(el.dataset.weekstart) }), { quiet: true }) && renderSettings()));
    D.add(on(root, 'click', '[data-color]', (e, el) => change((d) => ({ ...d, color: el.dataset.color }), { quiet: true }) && renderSettings()));
    D.add(on(root, 'change', '[data-flag]', (e, el) => { change((d) => ({ ...d, [el.dataset.flag]: el.checked }), { quiet: true }); renderSettings(); }));
    D.listen($('[data-custom-color]'), 'input', (e) => { // dragging in the colour picker: live preview, one undo step
      history.record(clone(draft), 'color'); updateHistoryButtons();
      draft.color = e.target.value.toUpperCase();
      renderSettings(); scheduleCommit(200);
    });
    D.add(on(root, 'click', '[data-zoom]', (e, el) => { zoom = el.dataset.zoom; prefs.set('ganttZoom', zoom); renderSettings(); }));

    // ----- Duplicate / convert / delete ---------------------------------------------------------------------------------------------
    function duplicateFigure() {
      flush();
      const src = getFigure();
      const copy = clone(src);
      copy.id = uid('fig'); copy.title = `${src.title} (copy)`; copy.versions = []; copy.comments = []; delete copy.imagePool;
      copy.createdAt = copy.updatedAt = Date.now();
      addVersion(copy, { force: true });
      store.update((p) => { const i = p.figures.findIndex((f) => f.id === figureId); p.figures.splice(i + 1, 0, copy); }, { activity: { text: `Duplicated figure “${src.title}”`, kind: 'create', targetId: copy.id } });
      toast(t('Figure duplicated'), { type: 'success' });
      ctx.navigate(ctx.href('gantt', copy.id));
    }
    async function convertToDrawing() {
      flush();
      const ok = await confirmDialog({
        title: t('Convert to a free drawing?'),
        message: t('The chart becomes ordinary shapes that you can move and edit in the figure editor. You will no longer be able to edit it as a table of tasks and dates.'),
        confirmText: t('Convert'),
      });
      if (!ok || !getFigure()) return;
      deleted = true; // leaving this editor: nothing more to save
      store.update((p) => { const f = findFigure(p, figureId); delete f.gantt; f.type = 'timeline'; f.updatedAt = Date.now(); }, { activity: { text: `Edited figure “${getFigure().title}”`, kind: 'edit', targetId: figureId }, source: SRC });
      ctx.navigate(ctx.href('figures', figureId));
    }
    async function deleteFigure() {
      flush();
      const f = getFigure();
      const info = getNumbering(store.project).figures.get(figureId);
      if (!(await confirmDialog({ title: t('Delete {label}?', { label: info?.label || t('figure') }), message: t('“{title}” and its version history will be deleted. Later figures are renumbered automatically and references to it will show as broken.', { title: esc(f.title) }), confirmText: t('Delete figure'), danger: true }))) return;
      deleted = true;
      store.update((p) => { p.figures = p.figures.filter((x) => x.id !== figureId); clearPlacement(p, 'figure', figureId); }, { activity: { text: `Deleted figure “${f.title}”`, kind: 'delete' } });
      toast(t('Figure deleted'), { type: 'success' });
      ctx.navigate(ctx.href('figures'));
    }

    // ----- Paste from Excel -----------------------------------------------------------------------------------------------------------
    const reasonText = (er) => {
      const v = `<bdi>${esc(er.value ?? '')}</bdi>`;
      switch (er.code) {
        case 'name': return t('The task has no name.');
        case 'start': return t('The start date “{value}” could not be read.', { value: v });
        case 'end': return t('The end date “{value}” could not be read.', { value: v });
        case 'order': return t('The end date is before the start date.');
        default: return t('The start and end dates are missing.');
      }
    };
    function openPasteDialog() {
      flush();
      const hasTasks = draft.tasks.length > 0;
      const modal = openModal({
        title: t('Paste from Excel'), subtitle: t('Paste rows copied from Excel, Google Sheets or a Word table.'), size: 'lg',
        body: `<div class="gt-paste">
          <textarea class="textarea gt-paste-text" rows="8" dir="ltr" spellcheck="false" autofocus data-text aria-label="${esc(t('Rows to import'))}" placeholder="Create Team, 2025-09-01, 2025-09-08&#10;Software Design, 2025-10-16, 2025-10-24&#10;  - Class diagrams, 2025-10-16, 2025-10-18&#10;  - Database design, 2025-10-19, 2025-10-24"></textarea>
          <details class="gt-help">
            <summary>${t('How should the rows look?')}</summary>
            <ul>
              <li>${t('One task per line: task name, start date, end date — separated by tabs (as copied from a spreadsheet) or commas.')}</li>
              <li>${t('Dates can be written as YYYY-MM-DD, DD/MM/YYYY or M/D/YYYY (or like 1 Sep 2025).')}</li>
              <li>${t('A sub-task is indented with spaces, starts with a dash (“- Task”) or starts with a WBS number such as 6.1.')}</li>
              <li>${t('A phase can have no dates: its dates come from the sub-tasks below it. A first row of column titles is skipped.')}</li>
            </ul>
          </details>
          <div class="gt-paste-opts">
            <label class="gt-field"><span>${t('Dates like 03/04/2025')}</span>
              <select class="select select-sm" data-order>
                <option value="auto">${t('Detect automatically')}</option>
                <option value="dmy">${t('Day / month / year')}</option>
                <option value="mdy">${t('Month / day / year')}</option>
              </select></label>
            <div class="gt-modes" role="radiogroup" aria-label="${esc(t('What to do with the rows'))}">
              <label class="checkbox"><input type="radio" name="gt-mode" value="replace" ${hasTasks ? 'checked' : ''}> ${hasTasks ? t('Replace the {n} current tasks', { n: draft.tasks.length }) : t('Replace all tasks')}</label>
              <label class="checkbox"><input type="radio" name="gt-mode" value="append" ${hasTasks ? '' : 'checked'}> ${t('Add after the last task')}</label>
            </div>
          </div>
          <div class="gt-paste-result" data-result aria-live="polite"></div>
        </div>`,
        footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-import disabled>${t('Import')}</button>`,
      });
      const ta = modal.$('[data-text]'); const orderEl = modal.$('[data-order]'); const result = modal.$('[data-result]'); const importBtn = modal.$('[data-import]');
      let parsed = null; let timer = 0;
      const mode = () => modal.root.querySelector('[name="gt-mode"]:checked')?.value || 'replace';

      function refresh() {
        const text = ta.value;
        parsed = null; importBtn.disabled = true; importBtn.textContent = t('Import');
        if (!text.trim()) { result.innerHTML = ''; return; }
        const res = parseTaskRows(text, { dateOrder: orderEl.value });
        const tasks = res.rows.map((r) => toTask(r));
        const merged = mode() === 'replace' ? tasks : [...draft.tasks, ...tasks];
        const tooLong = merged.length && weekRange(finalize({ ...draft, tasks: merged })).count > MAX_WEEKS;
        let html = '';
        if (tasks.length) {
          const fin = finalize({ ...draft, tasks });
          const wbs = wbsNumbers(fin.tasks);
          const shown = fin.tasks.slice(0, 8);
          html += `<div class="gt-ok">${icon('check', 'icon-sm')} ${esc(t('Tasks ready to import: {n}', { n: tasks.length }))}</div>
            <table class="gt-mini"><tbody>${shown.map((x, k) => `<tr><td dir="ltr">${esc(wbs[k])}</td><td style="padding-inline-start:${6 + x.level * 14}px" dir="auto">${esc(x.name)}</td><td dir="ltr">${x.start}</td><td dir="ltr">${x.end}</td></tr>`).join('')}</tbody></table>
            ${fin.tasks.length > shown.length ? `<div class="gt-more">${esc(t('…and {n} more', { n: fin.tasks.length - shown.length }))}</div>` : ''}`;
          if (res.ambiguous && orderEl.value === 'auto') html += `<div class="gt-warn">${icon('info', 'icon-sm')} ${esc(t('Dates such as 03/04/2025 were read as day / month / year. Choose “Month / day / year” above if that is wrong.'))}</div>`;
        }
        if (res.errors.length) {
          html += `<div class="gt-bad"><strong>${icon('alert', 'icon-sm')} ${esc(t('Rows that could not be imported: {n}', { n: res.errors.length }))}</strong><ul>${res.errors.slice(0, 12).map((er) => `<li><b>${esc(t('Row {n}', { n: er.line }))}</b> <bdi class="gt-src">${esc(er.text.length > 60 ? `${er.text.slice(0, 60)}…` : er.text)}</bdi><br>${reasonText(er)}</li>`).join('')}${res.errors.length > 12 ? `<li>${esc(t('…and {n} more', { n: res.errors.length - 12 }))}</li>` : ''}</ul></div>`;
        }
        if (tooLong) html += `<div class="gt-bad">${icon('alert', 'icon-sm')} ${esc(t('That would stretch the chart over more than {n} weeks. Check the dates.', { n: MAX_WEEKS }))}</div>`;
        result.innerHTML = html;
        if (tasks.length && !tooLong) { parsed = tasks; importBtn.disabled = false; importBtn.textContent = t('Import {n} tasks', { n: tasks.length }); }
      }
      const toTask = (r) => ({ id: uid('gt'), name: r.name, start: r.start, end: r.end, level: r.level });
      const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
      ta.addEventListener('input', later);
      orderEl.addEventListener('change', refresh);
      modal.root.addEventListener('change', (e) => { if (e.target.name === 'gt-mode') refresh(); });
      importBtn.addEventListener('click', () => {
        if (!parsed) return;
        const incoming = parsed; const count = incoming.length;
        const first = incoming[0];
        const ok = change((d) => ({ ...d, tasks: mode() === 'replace' ? incoming : [...d.tasks, ...incoming] }), { focus: { id: first.id, field: 'name' } });
        modal.close();
        if (ok) toast(t('Imported {n} tasks', { n: count }), { type: 'success', action: { label: t('Undo'), onClick: undo } });
      });
    }

    // ----- Keyboard -------------------------------------------------------------------------------------------------------------------------
    D.listen(document, 'keydown', (e) => {
      if (!modKey(e) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      if (e.target === titleEl) return; // the title field keeps its own text undo
      if (document.querySelector('.modal-root, .palette-root') || (isTypingTarget(e.target) && !root.contains(e.target))) return;
      if (k === 'z' && !e.shiftKey) undo(); else redo();
      e.preventDefault(); e.stopPropagation();
    }, true);
    // Ctrl+S (handled globally) must find the last typed text in the store.
    D.listen(document, 'keydown', (e) => { if (modKey(e) && !e.altKey && (e.key === 's' || e.key === 'S')) flush(); }, true);
    const leave = () => { flush(); commitTitle(); };
    D.listen(window, 'beforeunload', leave, true);
    D.listen(window, 'pagehide', leave, true);
    D.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });

    // ----- Store events ------------------------------------------------------------------------------------------------------------------------
    D.add(store.on('status', refreshStatus));
    D.add(store.on('change', ({ source }) => {
      if (deleted || source === SRC) return;
      const f = getFigure();
      if (!f) { toast(t('This figure was deleted.'), { type: 'warning' }); ctx.navigate(ctx.href('figures')); return; }
      refreshMeta();
      // The schedule was changed from outside this editor: take it over unless the user is typing.
      if (!textDirty && f.gantt && JSON.stringify(f.gantt) !== lastStored) {
        draft = normalizeGantt(f.gantt); lastStored = JSON.stringify(f.gantt);
        if (!isTypingTarget(document.activeElement) || !rowsEl.contains(document.activeElement)) renderAll();
      }
    }));

    // ----- Initial paint -------------------------------------------------------------------------------------------------------------------------
    refreshMeta();
    renderAll();
    if (!draft.tasks.length) emptyEl.querySelector('.btn-primary')?.focus({ preventScroll: true });

    return {
      unmount() {
        flush(); commitTitle();
        [commitTimer, previewTimer, noteTimer, fixedTimer, titleTimer].forEach(clearTimeout);
        // Every editing session ends as a version, like in the drawing editor, so the list's version badge stays accurate.
        const f = getFigure();
        if (!deleted && f && isDirty(f)) store.update((p) => { const x = findFigure(p, figureId); if (x) addVersion(x, { kind: 'auto' }); }, { source: SRC });
        D.dispose();
      },
    };
  },
};
