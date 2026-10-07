// Table editor (#/p/<id>/tables/<tableId>): a Word-like grid with a formatting toolbar.
//
// Rendering: the grid is a CSS grid (not a <table>) so that a column-letter strip and a row-number gutter
// share the same tracks and always line up. Every visible cell holds a <textarea> that auto-sizes through
// a hidden mirror element, so the whole grid is directly editable.
//
// Editing model: typing is debounced into store.update(); structural edits (rows, columns, merges, styles)
// run a pure operation from table-ops.js on a *draft* clone, and only a successful result is committed.
// Undo/redo keeps up to 100 snapshots of the table content; versions are named snapshots stored on the table.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, formDialog } from '../ui/modal.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { getNumbering } from '../core/numbering.js';
import { clearPlacement } from '../core/references.js';
import { uid, clone, clamp, formatDateTime, modKey, modLabel, isTypingTarget } from '../core/utils.js';
import { prefs } from '../app/prefs.js';
// `t` is a local variable (the table) all over this file, so the translator is imported as `tr`.
import { t as tr } from '../i18n/index.js';
import { fontStack } from '../figures/text-layout.js';
import * as ops from './table-ops.js';
import { captionParts, pageTextWidthPx, renderTableMiniHTML } from './table-render.js';
import { openExportMenu, duplicateTable, deleteTableWithUndo, openEditDetailsDialog, bdi, isolate, ltr } from './tables-view.js';

const SRC = 'table-editor';
const GUTTER = 32; // px, row-number column
const MAX_UNDO = 100;
const MAX_VERSIONS = 40;
const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16];
const ZOOMS = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75];

// Toolbar glyphs that the shared icon set does not have.
const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const GLYPH = {
  rowAbove: svg('<rect x="3" y="10" width="18" height="11" rx="2"/><path d="M3 15.5h18"/><path d="M12 2v5"/><path d="M9.5 4.5h5"/>'),
  rowBelow: svg('<rect x="3" y="3" width="18" height="11" rx="2"/><path d="M3 8.5h18"/><path d="M12 17v5"/><path d="M9.5 19.5h5"/>'),
  rowDelete: svg('<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="m10 10.5 4 3"/><path d="m14 10.5-4 3"/>'),
  colLeft: svg('<rect x="10" y="3" width="11" height="18" rx="2"/><path d="M15.5 3v18"/><path d="M2 12h5"/><path d="M4.5 9.5v5"/>'),
  colRight: svg('<rect x="3" y="3" width="11" height="18" rx="2"/><path d="M8.5 3v18"/><path d="M17 12h5"/><path d="M19.5 9.5v5"/>'),
  colDelete: svg('<rect x="8" y="3" width="8" height="18" rx="1.5"/><path d="m10.5 9.5 3 3.5"/><path d="m13.5 9.5-3 3.5"/>'),
  merge: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 12 3-2.5v5z" fill="currentColor"/><path d="m17 12-3-2.5v5z" fill="currentColor"/>'),
  unmerge: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/><path d="M5.5 12H9"/><path d="M15 12h3.5"/>'),
};

/** "3 rows × 4 columns" (English keeps its singular forms; Arabic uses label-first patterns that need no plural rules). */
const dimsText = (rows, cols) => {
  if (rows === 1 && cols === 1) return tr('1 row × 1 column');
  if (rows === 1) return tr('1 row × {cols} columns', { cols });
  if (cols === 1) return tr('{rows} rows × 1 column', { rows });
  return tr('{rows} rows × {cols} columns', { rows, cols });
};

const colLetter = (i) => { let s = ''; let n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

const luminance = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export default {
  title: 'Table Editor',
  layout: 'flush',
  mount(container, ctx) {
    const { store, shell } = ctx;
    const tableId = ctx.params.id;
    const project0 = store.project;
    const findT = () => store.project?.tables.find((t) => t.id === tableId) || null;
    const T = () => findT();

    if (!findT()) {
      container.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('table')}</div><h3>${tr('Table not found')}</h3><p>${tr('It may have been deleted.')}</p><a class="btn btn-primary" href="${esc(ctx.href('tables'))}">${tr('Back to tables')}</a></div></div>`;
      return {};
    }

    const D = new Disposer();
    const undoStack = []; const redoStack = [];
    const pending = new Map(); // "r,c" → text typed but not yet committed to the store
    let commitTimer = 0; let typingTimer = 0; let typingActive = false;
    let sel = { a: { r: 0, c: 0 }, b: { r: 0, c: 0 } };
    let cellEls = new Map();
    let drag = null; let resizing = null; let historyModal = null;
    const narrow = window.matchMedia?.('(max-width: 720px)').matches;
    let zoom = ZOOMS.includes(Number(prefs.get('tableZoom'))) ? Number(prefs.get('tableZoom')) : (narrow ? 0.9 : 1.15);

    // ----- Skeleton ---------------------------------------------------------
    const btn = (act, glyph, tip, kbd) => `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="${act}" data-tip="${esc(tip)}"${kbd ? ` data-kbd="${esc(kbd)}"` : ''} aria-label="${esc(tip)}">${glyph}</button>`;
    container.innerHTML = `
      <div class="te">
        <header class="te-head">
          <div class="te-head-row">
            <a class="btn btn-ghost btn-sm te-back" href="${esc(ctx.href('tables'))}" data-tip="${esc(tr('Back to all tables'))}">${icon('arrowLeft')}<span>${tr('Tables')}</span></a>
            <span class="badge badge-primary te-label" data-label dir="auto"></span>
            <input class="te-title" data-title aria-label="${esc(tr('Table title'))}" placeholder="${esc(tr('Untitled table'))}" maxlength="160" autocomplete="off">
            <div class="te-head-actions">
              <button class="btn btn-sm" data-action="history" data-tip="${esc(tr('Version history'))}">${icon('history')}<span class="te-btn-label">${tr('History')}</span><span class="te-count" data-version-count></span></button>
              <button class="btn btn-sm" data-action="save-version" data-tip="${esc(tr('Save a named version'))}" data-kbd="${modLabel} S">${icon('save')}<span class="te-btn-label">${tr('Save version')}</span></button>
              <button class="btn btn-sm btn-primary" data-action="export" aria-label="${esc(tr('Export'))}">${icon('export')}<span class="te-btn-label">${tr('Export')}</span>${icon('chevronDown', 'icon-sm')}</button>
              <button class="btn btn-sm btn-ghost btn-icon" data-action="more" data-tip="${esc(tr('More actions'))}" aria-label="${esc(tr('More actions'))}">${icon('more')}</button>
            </div>
          </div>
          <div class="te-head-row te-meta">
            <label class="te-field"><span>${tr('Chapter')}</span><select class="select select-sm" data-chapter></select></label>
            <label class="te-field"><span>${tr('Section')}</span><select class="select select-sm" data-section></select></label>
            <button class="btn btn-ghost btn-sm" data-action="toggle-desc" aria-expanded="false">${icon('chevronRight', 'icon-sm te-chev')}<span data-desc-label>${tr('Description')}</span></button>
            <span class="te-code" data-code></span>
          </div>
          <div class="te-desc" data-desc hidden><textarea class="textarea" rows="2" data-description placeholder="${esc(tr('What does this table show? (optional)'))}"></textarea></div>
        </header>
        <div class="te-toolbar" role="toolbar" aria-label="${esc(tr('Table formatting'))}">
          ${btn('undo', icon('undo'), tr('Undo'), `${modLabel} Z`)}${btn('redo', icon('redo'), tr('Redo'), `${modLabel} Y`)}
          <span class="tb-sep"></span>
          ${btn('rowAbove', GLYPH.rowAbove, tr('Add row above'))}${btn('rowBelow', GLYPH.rowBelow, tr('Add row below'))}${btn('rowDelete', GLYPH.rowDelete, tr('Delete row'))}
          <span class="tb-sep"></span>
          ${btn('colLeft', GLYPH.colLeft, tr('Add column left'))}${btn('colRight', GLYPH.colRight, tr('Add column right'))}${btn('colDelete', GLYPH.colDelete, tr('Delete column'))}
          <span class="tb-sep"></span>
          ${btn('merge', GLYPH.merge, tr('Merge cells'))}${btn('unmerge', GLYPH.unmerge, tr('Unmerge cells'))}
          <span class="tb-sep"></span>
          ${btn('bold', icon('bold'), tr('Bold'), `${modLabel} B`)}${btn('italic', icon('italic'), tr('Italic'), `${modLabel} I`)}
          ${btn('alignLeft', icon('alignLeft'), tr('Align left'))}${btn('alignCenter', icon('alignCenter'), tr('Align centre'))}${btn('alignRight', icon('alignRight'), tr('Align right'))}
          <span class="tb-sep"></span>
          <label class="tb-ctl" data-tip="${esc(tr('Number of header rows'))}"><span>${tr('Header rows')}</span>
            <select class="select select-sm" data-ctl="headerRows"><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
          <label class="tb-ctl" data-tip="${esc(tr('Header fill colour'))}"><span>${tr('Header')}</span><input type="color" class="input-color" data-ctl="fill" aria-label="${esc(tr('Header colour'))}"></label>
          ${btn('zebra', icon('layers'), tr('Zebra stripes'))}
          <label class="tb-ctl" data-tip="${esc(tr('Cell borders'))}"><span>${tr('Borders')}</span>
            <select class="select select-sm" data-ctl="borders"><option value="all">${tr('All')}</option><option value="horizontal">${tr('Horizontal')}</option></select></label>
          <label class="tb-ctl" data-tip="${esc(tr('Font size'))}"><span>${tr('Size')}</span>
            <select class="select select-sm" data-ctl="fontSize"></select></label>
        </div>
        <div class="te-canvas" data-canvas>
          <div class="te-sheet" data-sheet>
            <div class="te-caption" data-cap="above" dir="auto"></div>
            <div class="te-grid" data-grid role="grid" aria-label="${esc(tr('Table cells'))}"></div>
            <div class="te-caption" data-cap="below" dir="auto"></div>
          </div>
        </div>
        <footer class="te-status">
          <span data-dims></span><span class="sep">·</span><span class="te-saved" data-saved></span>
          <span class="te-hint">${tr('Tab / Enter to move · Shift+click or drag to select · {shortcut} undo', { shortcut: `${modLabel}+Z` })}</span>
          <span class="spacer"></span><span data-selinfo class="muted"></span>
          <span class="te-zoom"><button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-out" data-tip="${esc(tr('Zoom out'))}" aria-label="${esc(tr('Zoom out'))}">${icon('zoomOut')}</button><span data-zoom-label></span><button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-in" data-tip="${esc(tr('Zoom in'))}" aria-label="${esc(tr('Zoom in'))}">${icon('zoomIn')}</button></span>
        </footer>
      </div>`;

    const $ = (sel2) => container.querySelector(sel2);
    const root = $('.te'); const toolbar = $('.te-toolbar'); const gridEl = $('[data-grid]'); const sheet = $('[data-sheet]');
    const titleEl = $('[data-title]'); const chapterEl = $('[data-chapter]'); const sectionEl = $('[data-section]');
    const canvasEl = $('[data-canvas]');
    const descWrap = $('[data-desc]'); const descEl = $('[data-description]');

    // ----- Store helpers ------------------------------------------------------
    const stamp = (t) => { t.updatedAt = Date.now(); };
    const commitContent = (content, activity) => {
      store.update((p) => {
        const t = p.tables.find((x) => x.id === tableId);
        if (!t) return;
        ops.applyContent(t, content); stamp(t);
      }, { activity: activity || `Edited table "${T().title}"`, source: SRC });
      refreshStatus();
    };
    const patchTable = (fn, activity) => {
      store.update((p) => { const t = p.tables.find((x) => x.id === tableId); if (t) { fn(t); stamp(t); } }, { activity, source: SRC });
      refreshStatus();
    };

    function commitPending() {
      clearTimeout(commitTimer);
      if (!pending.size || store.project !== project0) { pending.clear(); return; }
      const entries = [...pending]; pending.clear();
      patchTable((t) => {
        for (const [key, text] of entries) {
          const [r, c] = key.split(',').map(Number);
          const cell = t.rows[r]?.[c];
          if (cell) cell.text = text;
        }
      }, `Edited table "${T().title}"`);
    }
    const flushPending = commitPending;

    // ----- Undo / redo ----------------------------------------------------------
    const pushUndo = (snap) => { undoStack.push(snap); if (undoStack.length > MAX_UNDO) undoStack.shift(); redoStack.length = 0; };
    function undo() {
      flushPending(); typingActive = false;
      if (!undoStack.length) return;
      redoStack.push(ops.snapshotContent(T()));
      commitContent(undoStack.pop(), `Undo in table "${T().title}"`);
      afterContentChange();
    }
    function redo() {
      flushPending(); typingActive = false;
      if (!redoStack.length) return;
      undoStack.push(ops.snapshotContent(T()));
      commitContent(redoStack.pop(), `Redo in table "${T().title}"`);
      afterContentChange();
    }
    function afterContentChange() { clampSel(); renderGrid({ focus: true }); }

    /** Run a pure operation on a draft; commit only if it succeeded and changed something. */
    function structural(fn, { activity, focus = true } = {}) {
      flushPending(); typingActive = false;
      const before = ops.snapshotContent(T());
      const draft = clone(before);
      const res = fn(draft, selRect(), rawRect());
      if (res === false || res?.ok === false) { if (res?.reason) toast(res.reason, { type: 'info', duration: 2800 }); return false; }
      ops.normalizeMerges(draft);
      if (ops.contentKey(draft) === ops.contentKey(before)) return false;
      pushUndo(before);
      commitContent(draft, activity);
      const pick = res?.select;
      if (pick) sel = { a: { r: pick.r1, c: pick.c1 }, b: { r: pick.r2, c: pick.c2 } }; else clampSel();
      sel.a = anchorOf(sel.a);
      renderGrid({ focus });
      return true;
    }

    // ----- Selection --------------------------------------------------------------
    function anchorOf(rc) { const g = ops.regionAt(T(), rc.r, rc.c); return { r: g.r1, c: g.c1 }; }
    function selRect() { return ops.expandRect(T(), ops.rectOf(sel.a, sel.b)); }
    /** The rectangle as dragged, without growing to whole merged regions (used for row / column insert and delete). */
    function rawRect() { return ops.clampRect(T(), ops.rectOf(sel.a, sel.b)); }
    function clampSel() {
      const t = T(); const maxR = t.rows.length - 1; const maxC = t.columns.length - 1;
      const fix = (p) => ({ r: clamp(p.r, 0, maxR), c: clamp(p.c, 0, maxC) });
      sel = { a: anchorOf(fix(sel.a)), b: fix(sel.b) };
    }
    function setSel(a, b = a) { sel = { a: anchorOf(a), b }; paintSelection(); updateToolbar(); }
    const isMulti = () => { const g = selRect(); return g.r1 !== g.r2 || g.c1 !== g.c2; };

    function paintSelection() {
      const t = T(); const rect = selRect(); const multi = isMulti();
      gridEl.classList.toggle('multi', multi);
      for (const el of cellEls.values()) {
        const r = +el.dataset.r; const c = +el.dataset.c; const rs = +el.dataset.rs; const cs = +el.dataset.cs;
        const inside = r >= rect.r1 && r + rs - 1 <= rect.r2 && c >= rect.c1 && c + cs - 1 <= rect.c2;
        el.classList.toggle('sel', inside);
        el.classList.toggle('et', inside && r === rect.r1);
        el.classList.toggle('eb', inside && r + rs - 1 === rect.r2);
        el.classList.toggle('el', inside && c === rect.c1);
        el.classList.toggle('er', inside && c + cs - 1 === rect.c2);
        el.classList.toggle('active', r === sel.a.r && c === sel.a.c && multi);
      }
      const allRows = rect.r1 === 0 && rect.r2 === t.rows.length - 1; const allCols = rect.c1 === 0 && rect.c2 === t.columns.length - 1;
      gridEl.querySelectorAll('.colhead').forEach((h) => h.classList.toggle('sel', allRows && +h.dataset.col >= rect.c1 && +h.dataset.col <= rect.c2));
      gridEl.querySelectorAll('.rowhead').forEach((h) => h.classList.toggle('sel', allCols && +h.dataset.row >= rect.r1 && +h.dataset.row <= rect.r2));
      const info = $('[data-selinfo]');
      info.textContent = multi ? tr('{rows} × {cols} cells selected', { rows: rect.r2 - rect.r1 + 1, cols: rect.c2 - rect.c1 + 1 }) : '';
    }

    function focusCell(rc, caret = 'end', { scroll = false } = {}) {
      const g = ops.regionAt(T(), rc.r, rc.c);
      const el = cellEls.get(`${g.r1},${g.c1}`);
      const ta = el?.querySelector('textarea');
      if (!ta) return;
      ta.focus({ preventScroll: true });
      if (caret === 'end') ta.setSelectionRange(ta.value.length, ta.value.length);
      else if (caret === 'start') ta.setSelectionRange(0, 0);
      else if (caret === 'all') ta.select();
      else if (caret === 'edge-left' || caret === 'edge-right') {
        // The visual edge of the text: in right-to-left cell text the logical start is on the right.
        const atStart = (caret === 'edge-left') === (getComputedStyle(ta).direction !== 'rtl');
        const pos = atStart ? 0 : ta.value.length;
        ta.setSelectionRange(pos, pos);
      }
      if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // ----- Grid rendering -----------------------------------------------------------
    function renderGrid({ focus = false } = {}) {
      const t = T();
      const active = document.activeElement;
      const hadFocus = gridEl.contains(active) && active.tagName === 'TEXTAREA';
      const caret = hadFocus ? [active.selectionStart, active.selectionEnd] : null;
      const st = t.style; const header = t.headerRows;
      const rows = t.rows.length; const cols = t.columns.length;

      const font = fontStack(project0.settings.typography?.fontFamily || 'Times New Roman');
      sheet.style.setProperty('--te-font', font);
      sheet.style.setProperty('--te-fs', `${Number(st.fontSize) || 11}pt`);
      sheet.style.setProperty('--te-hdr-fill', st.headerFill || '#D9E2F3');
      sheet.style.setProperty('--te-hdr-ink', st.headerTextColor || '#000000');
      sheet.style.setProperty('--tz', String(zoom));
      const pageW = pageTextWidthPx(project0) * zoom;
      // Page-sized on wide screens; on phones the sheet shrinks to the screen until columns would get too narrow.
      const chrome = GUTTER + (narrow ? 24 : 56);
      const available = Math.max(0, canvasEl.clientWidth - (narrow ? 20 : 48));
      sheet.style.width = `${Math.round(Math.max(Math.min(pageW + chrome, available || Infinity), cols * 78 + chrome))}px`;
      gridEl.classList.toggle('horizontal', st.borders === 'horizontal');
      gridEl.style.gridTemplateColumns = `${GUTTER}px ${t.columns.map((c) => `minmax(0, ${Math.max(1, c.width)}fr)`).join(' ')}`;

      const parts = [`<div class="corner" data-corner data-tip="${esc(tr('Select all'))}" style="grid-row:1;grid-column:1"></div>`];
      t.columns.forEach((_, c) => {
        parts.push(`<div class="colhead" data-col="${c}" style="grid-row:1;grid-column:${c + 2}">${colLetter(c)}${c < cols - 1 ? `<span class="col-resize" data-resize="${c}" data-tip="${esc(tr('Drag to resize · double-click to equalise'))}"></span>` : ''}</div>`);
      });
      for (let r = 0; r < rows; r += 1) {
        parts.push(`<div class="rowhead ${r < header ? 'hdr' : ''}" data-row="${r}" style="grid-row:${r + 2};grid-column:1">${r + 1}</div>`);
        for (let c = 0; c < cols; c += 1) {
          const cell = t.rows[r][c];
          if (cell.hidden) continue;
          const g = ops.regionAt(t, r, c);
          const rs = g.r2 - g.r1 + 1; const cs = g.c2 - g.c1 + 1;
          const cls = ['cell'];
          if (r < header) cls.push('hdr'); else if (st.zebra && (r - header) % 2 === 1) cls.push('z');
          if (ops.isCellBold(t, r, cell)) cls.push('b');
          if (cell.italic) cls.push('i');
          const text = String(cell.text ?? '');
          parts.push(`<div class="${cls.join(' ')}" role="gridcell" data-r="${r}" data-c="${c}" data-rs="${rs}" data-cs="${cs}" style="grid-row:${r + 2}/span ${rs};grid-column:${c + 2}/span ${cs};text-align:${cell.align || 'left'}">`
        + `<div class="cell-wrap" data-value="${esc(text)}"><textarea rows="1" data-r="${r}" data-c="${c}" dir="auto" aria-label="${esc(tr('Row {r}, column {c}', { r: r + 1, c: c + 1 }))}">${text.startsWith('\n') ? '\n' : ''}${esc(text)}</textarea></div></div>`);
        }
      }
      gridEl.innerHTML = parts.join('');
      cellEls = new Map([...gridEl.querySelectorAll('.cell')].map((el) => [`${el.dataset.r},${el.dataset.c}`, el]));
      paintSelection(); updateToolbar(); refreshStatus(); renderCaption();
      if (hadFocus || focus) {
        focusCell(sel.a, 'end');
        const ta = cellEls.get(`${sel.a.r},${sel.a.c}`)?.querySelector('textarea');
        if (ta && caret && hadFocus) { try { ta.setSelectionRange(Math.min(caret[0], ta.value.length), Math.min(caret[1], ta.value.length)); } catch { /* ignore */ } }
      }
    }

    function renderCaption(titleOverride) {
      const t = T();
      const { label, title, cfg } = captionParts(project0, { ...t, title: titleOverride ?? t.title });
      const above = cfg.position !== 'below';
      for (const el of container.querySelectorAll('[data-cap]')) {
        const mine = (el.dataset.cap === 'above') === above;
        el.hidden = !mine;
        if (!mine) continue;
        el.style.textAlign = cfg.align || 'center';
        el.innerHTML = `${cfg.labelBold ? `<b>${esc(label)}</b>` : esc(label)} ${cfg.titleItalic ? `<i>${esc(title)}</i>` : esc(title)}`;
      }
    }

    // ----- Header / meta / status ---------------------------------------------------------------
    function refreshMeta() {
      const t = T(); const n = getNumbering(store.project); const info = n.tables.get(t.id);
      $('[data-label]').textContent = info?.label || 'Table';
      $('[data-code]').innerHTML = info ? `${bdi(esc(info.code), 'ltr')} · ${bdi(esc(info.location))}` : '';
      if (document.activeElement !== titleEl) titleEl.value = t.title;
      const chapterId = info?.chapterId || '';
      chapterEl.innerHTML = `<option value="">${tr('Unassigned')}</option>${store.project.chapters.map((ch) => `<option value="${esc(ch.id)}">${esc(`${n.chapters.get(ch.id).label} · ${ch.title}`)}</option>`).join('')}`;
      chapterEl.value = chapterId;
      fillSections(chapterId, info?.sectionId || '');
      if (document.activeElement !== descEl) descEl.value = t.description || '';
      $('[data-desc-label]').textContent = t.description ? tr('Description') : tr('Add description');
      $('[data-version-count]').textContent = t.versions.length || '';
      shell.setBreadcrumbs([{ label: tr('Tables'), href: ctx.href('tables') }, { label: `${info?.label || 'Table'} · ${t.title}` }]);
      document.title = `${t.title} · ${tr('Table editor')} · ${store.project.name} · GradDocs`;
      renderCaption();
    }
    function fillSections(chapterId, sectionId) {
      const n = getNumbering(store.project);
      const secs = n.outline.filter((o) => o.kind === 'section' && o.chapterId === chapterId);
      sectionEl.disabled = !chapterId;
      sectionEl.innerHTML = chapterId
        ? `<option value="">${tr('Whole chapter')}</option>${secs.map((s) => `<option value="${esc(s.id)}">${esc(`${s.number} ${s.title}`)}</option>`).join('')}`
        : `<option value="">${tr('Choose a chapter first')}</option>`;
      sectionEl.value = sectionId || '';
    }
    function refreshStatus() {
      const t = T(); if (!t) return;
      $('[data-dims]').textContent = dimsText(t.rows.length, t.columns.length);
      const saving = pending.size || store.status === 'saving';
      const el = $('[data-saved]');
      el.textContent = store.status === 'error' ? tr('Not saved') : saving ? tr('Saving…') : tr('Saved');
      el.dataset.state = store.status === 'error' ? 'error' : saving ? 'saving' : 'saved';
      $('[data-version-count]').textContent = t.versions.length || '';
      $('[data-zoom-label]').textContent = `${Math.round(zoom * 100)}%`;
    }

    function updateToolbar() {
      const t = T(); if (!t) return;
      const rect = selRect(); const anchors = ops.anchorsIn(t, rect);
      const set = (act, { active, disabled }) => {
        const b = toolbar.querySelector(`[data-act="${act}"]`);
        if (!b) return;
        if (active !== undefined) b.classList.toggle('active', !!active);
        if (disabled !== undefined) b.disabled = !!disabled;
      };
      set('undo', { disabled: !undoStack.length }); set('redo', { disabled: !redoStack.length });
      const raw = rawRect();
      set('rowDelete', { disabled: raw.r2 - raw.r1 + 1 >= t.rows.length });
      set('colDelete', { disabled: raw.c2 - raw.c1 + 1 >= t.columns.length });
      set('merge', { disabled: anchors.length < 2 });
      set('unmerge', { disabled: !anchors.some((a) => ops.isMerged(a.cell)) });
      set('bold', { active: anchors.length > 0 && anchors.every((a) => ops.isCellBold(t, a.r, a.cell)) });
      set('italic', { active: anchors.length > 0 && anchors.every((a) => a.cell.italic) });
      for (const al of ['left', 'center', 'right']) set(`align${al[0].toUpperCase()}${al.slice(1)}`, { active: anchors.length > 0 && anchors.every((a) => (a.cell.align || 'left') === al) });
      set('zebra', { active: t.style.zebra });
      const ctl = (name) => toolbar.querySelector(`[data-ctl="${name}"]`);
      const hr = ctl('headerRows');
      if (t.headerRows > 2 && !hr.querySelector(`[value="${t.headerRows}"]`)) hr.insertAdjacentHTML('beforeend', `<option value="${t.headerRows}">${t.headerRows}</option>`);
      hr.value = String(t.headerRows);
      ctl('borders').value = t.style.borders === 'horizontal' ? 'horizontal' : 'all';
      if (document.activeElement !== ctl('fill')) ctl('fill').value = /^#[0-9a-f]{6}$/i.test(t.style.headerFill) ? t.style.headerFill.toLowerCase() : '#d9e2f3';
      const fs = ctl('fontSize'); const size = Number(t.style.fontSize) || 11;
      const sizes = FONT_SIZES.includes(size) ? FONT_SIZES : [...FONT_SIZES, size].sort((a, b) => a - b);
      if (fs.options.length !== sizes.length) fs.innerHTML = sizes.map((s) => `<option value="${s}">${s} pt</option>`).join('');
      fs.value = String(size);
    }

    // ----- Actions ----------------------------------------------------------------------------------
    const formatCells = (apply) => structural((d, rect) => { for (const { r, cell } of ops.anchorsIn(d, rect)) apply(d, r, cell); return {}; }, { activity: `Formatted table "${T().title}"` });
    const actions = {
      undo, redo,
      rowAbove: () => structural((d, rect, raw) => { const i = ops.insertRow(d, raw.r1); return { select: { r1: i, c1: raw.c1, r2: i, c2: raw.c1 } }; }, { activity: 'Added a table row' }),
      rowBelow: () => structural((d, rect, raw) => { const i = ops.insertRow(d, raw.r2 + 1); return { select: { r1: i, c1: raw.c1, r2: i, c2: raw.c1 } }; }, { activity: 'Added a table row' }),
      rowDelete: () => structural((d, rect, raw) => {
        if (!ops.deleteRows(d, raw.r1, raw.r2)) return { ok: false, reason: tr('A table needs at least one row.') };
        const r = Math.min(raw.r1, d.rows.length - 1);
        return { select: { r1: r, c1: raw.c1, r2: r, c2: raw.c1 } };
      }, { activity: 'Deleted a table row' }),
      colLeft: () => structural((d, rect, raw) => { const i = ops.insertColumn(d, raw.c1); return { select: { r1: raw.r1, c1: i, r2: raw.r1, c2: i } }; }, { activity: 'Added a table column' }),
      colRight: () => structural((d, rect, raw) => { const i = ops.insertColumn(d, raw.c2 + 1); return { select: { r1: raw.r1, c1: i, r2: raw.r1, c2: i } }; }, { activity: 'Added a table column' }),
      colDelete: () => structural((d, rect, raw) => {
        if (!ops.deleteColumns(d, raw.c1, raw.c2)) return { ok: false, reason: tr('A table needs at least one column.') };
        const c = Math.min(raw.c1, d.columns.length - 1);
        return { select: { r1: raw.r1, c1: c, r2: raw.r1, c2: c } };
      }, { activity: 'Deleted a table column' }),
      merge: () => structural((d, rect) => { const res = ops.mergeCells(d, rect); return res.ok ? { select: res.rect } : res; }, { activity: 'Merged table cells' }),
      unmerge: () => structural((d, rect) => (ops.unmergeCells(d, rect) ? {} : { ok: false, reason: tr('There are no merged cells in the selection.') }), { activity: 'Unmerged table cells' }),
      bold: () => {
        const t = T(); const anchors = ops.anchorsIn(t, selRect());
        const on = !anchors.every((a) => ops.isCellBold(t, a.r, a.cell));
        formatCells((d, r, cell) => ops.setCellBold(d, r, cell, on));
      },
      italic: () => {
        const anchors = ops.anchorsIn(T(), selRect());
        const on = !anchors.every((a) => a.cell.italic);
        formatCells((d, r, cell) => { if (on) cell.italic = true; else delete cell.italic; });
      },
      align: (al) => formatCells((d, r, cell) => { if (al === 'left') delete cell.align; else cell.align = al; }),
      alignLeft: () => actions.align('left'), alignCenter: () => actions.align('center'), alignRight: () => actions.align('right'),
      zebra: () => structural((d) => { d.style.zebra = !d.style.zebra; return {}; }, { activity: `Changed styling of table "${T().title}"` }),
    };

    function setStyle(key, value) {
      structural((d) => {
        d.style[key] = value;
        if (key === 'headerFill') d.style.headerTextColor = luminance(value) > 0.5 ? '#000000' : '#FFFFFF';
        return {};
      }, { activity: `Changed styling of table "${T().title}"` });
    }

    // ----- Versions -------------------------------------------------------------------------------------
    function saveVersion({ label = '' } = {}) {
      flushPending();
      const t = T(); const snap = ops.snapshotContent(t); const last = t.versions[t.versions.length - 1];
      if (last && ops.contentKey(last.snapshot) === ops.contentKey(snap)) { toast(tr('No changes since version {n}', { n: last.number }), { type: 'info', duration: 2200 }); return null; }
      const number = (last?.number || 0) + 1;
      const version = { id: uid('ver'), number, label: label || `Version ${number}`, kind: 'version', createdAt: Date.now(), snapshot: snap };
      patchTable((tt) => {
        tt.versions.push(version);
        if (tt.versions.length > MAX_VERSIONS) tt.versions.splice(1, tt.versions.length - MAX_VERSIONS);
      }, `Saved version ${number} of table "${t.title}"`);
      toast(tr('Saved version {n}', { n: number }), { type: 'success', duration: 1800 });
      return version;
    }

    function restoreVersion(versionId) {
      flushPending();
      const t = T(); const v = t.versions.find((x) => x.id === versionId);
      if (!v) return;
      const current = ops.snapshotContent(t);
      const last = t.versions[t.versions.length - 1];
      const dirty = !last || ops.contentKey(last.snapshot) !== ops.contentKey(current);
      pushUndo(current); typingActive = false;
      patchTable((tt) => {
        if (dirty) tt.versions.push({ id: uid('ver'), number: (last?.number || 0) + 1, label: `Before restoring v${v.number}`, kind: 'auto', createdAt: Date.now(), snapshot: current });
        ops.applyContent(tt, v.snapshot);
        tt.versions.push({ id: uid('ver'), number: (tt.versions[tt.versions.length - 1]?.number || 0) + 1, label: `Restored v${v.number}`, kind: 'restore', createdAt: Date.now(), snapshot: clone(v.snapshot) });
        if (tt.versions.length > MAX_VERSIONS) tt.versions.splice(1, tt.versions.length - MAX_VERSIONS);
      }, `Restored version ${v.number} of table "${t.title}"`);
      afterContentChange();
      toast(tr('Restored version {n}. Undo with {shortcut}.', { n: v.number, shortcut: ltr(`${modLabel}+Z`) }), { type: 'success' });
    }

    function openHistory() {
      flushPending();
      const t = T();
      if (!t.versions.length) {
        openModal({
          title: tr('Version history'), size: 'lg',
          body: `<div class="empty-state"><div class="empty-icon">${icon('history')}</div><h3>${tr('No versions yet')}</h3><p>${tr('Press {keys} or “Save version” to keep a snapshot you can restore later. For example, before changing a table a supervisor already approved.', { keys: bdi(`<kbd>${modLabel}</kbd> <kbd>S</kbd>`, 'ltr') })}</p></div>`,
          footer: `<button class="btn" data-close>${tr('Close')}</button>`,
        });
        return;
      }
      const currentKey = ops.contentKey(ops.snapshotContent(t));
      const list = [...t.versions].reverse().map((v) => {
        const isCurrent = ops.contentKey(v.snapshot) === currentKey;
        return `<div class="ver-item">
          <div class="ver-preview">${renderTableMiniHTML(v.snapshot, { rows: 3, cols: 5 })}</div>
          <div class="grow">
            <div class="ver-title"><strong>${bdi(`v${v.number}`, 'ltr')}</strong> · ${bdi(esc(v.label))} ${isCurrent ? `<span class="badge badge-success">${tr('Current')}</span>` : ''}${v.kind === 'auto' ? `<span class="badge">${tr('Automatic')}</span>` : ''}</div>
            <div class="meta">${bdi(esc(formatDateTime(v.createdAt)))} <span class="sep">·</span> ${bdi(`${v.snapshot.rows.length} × ${v.snapshot.columns.length}`, 'ltr')}</div>
          </div>
          <button class="btn btn-sm" data-restore="${esc(v.id)}" ${isCurrent ? 'disabled' : ''}>${icon('undo')}${tr('Restore')}</button>
        </div>`;
      }).join('');
      const modal = openModal({
        title: tr('Version history'), size: 'lg',
        subtitle: t.versions.length === 1 ? tr('{title} · 1 saved version', { title: isolate(t.title) }) : tr('{title} · {n} saved versions', { title: isolate(t.title), n: t.versions.length }),
        body: `<div class="ver-list">${list}</div>`, footer: `<button class="btn" data-close>${tr('Close')}</button>`,
        onClose: () => { historyModal = null; },
      });
      historyModal = modal;
      modal.root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-restore]');
        if (!b || b.disabled) return;
        modal.close();
        restoreVersion(b.dataset.restore);
      });
    }

    // ----- Events: header + toolbar ------------------------------------------------------------------------
    let titleTimer = 0;
    D.listen(titleEl, 'input', () => {
      renderCaption(titleEl.value.trim() || 'Untitled Table');
      clearTimeout(titleTimer);
      titleTimer = setTimeout(commitTitle, 350);
    });
    function commitTitle() {
      clearTimeout(titleTimer);
      const value = titleEl.value.trim();
      if (!value || value === T().title) return;
      patchTable((t) => { t.title = value; }, `Renamed table "${value}"`);
      refreshMeta();
    }
    D.listen(titleEl, 'blur', () => { commitTitle(); if (!titleEl.value.trim()) { titleEl.value = T().title; renderCaption(); } });
    D.listen(titleEl, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); focusCell(sel.a, 'end'); } });
    D.add(on(container, 'click', '[data-cap]', () => titleEl.focus()));

    const applyLocation = () => {
      const sectionId = sectionEl.value || null;
      const sec = sectionId ? getNumbering(store.project).sections.get(sectionId) : null;
      store.update((p) => { clearPlacement(p, 'table', tableId); }, { source: SRC });
      patchTable((t) => { t.sectionId = sectionId; t.chapterId = sec ? sec.chapterId : (chapterEl.value || null); }, `Moved table "${T().title}"`);
      refreshMeta();
    };
    D.listen(chapterEl, 'change', () => { fillSections(chapterEl.value, ''); applyLocation(); });
    D.listen(sectionEl, 'change', applyLocation);

    let descTimer = 0;
    D.listen(descEl, 'input', () => {
      clearTimeout(descTimer);
      descTimer = setTimeout(() => { patchTable((t) => { t.description = descEl.value.trim(); }, `Edited description of table "${T().title}"`); $('[data-desc-label]').textContent = descEl.value.trim() ? tr('Description') : tr('Add description'); }, 400);
    });

    D.add(on(container, 'click', '[data-action]', async (e, el) => {
      const action = el.dataset.action;
      if (action === 'toggle-desc') {
        const open = descWrap.hidden;
        descWrap.hidden = !open; el.setAttribute('aria-expanded', String(open)); el.classList.toggle('open', open);
        if (open) descEl.focus();
      } else if (action === 'history') openHistory();
      else if (action === 'save-version') {
        const v = await formDialog({
          title: tr('Save version'), subtitle: tr('A snapshot of the table you can restore later.'), submitText: tr('Save version'),
          fields: [{ name: 'label', label: tr('Version name (optional)'), placeholder: tr('e.g. After supervisor review'), value: '' }],
        });
        if (v) saveVersion({ label: v.label });
      } else if (action === 'export') { flushPending(); openExportMenu(el, store.project, T()); }
      else if (action === 'more') {
        openMenu(el, [
          { label: tr('Edit details…'), icon: 'edit', onClick: () => { flushPending(); openEditDetailsDialog(ctx, tableId); } },
          { label: tr('Duplicate table'), icon: 'duplicate', onClick: () => { flushPending(); const id = duplicateTable(store, tableId); if (id) { toast(tr('Duplicated. Opening the copy…'), { type: 'success', duration: 1600 }); ctx.navigate(ctx.href('tables', id)); } } },
          '-',
          { label: tr('Delete table…'), icon: 'trash', danger: true, onClick: async () => { flushPending(); if (await deleteTableWithUndo(store, tableId)) ctx.navigate(ctx.href('tables'), { replace: true }); } },
        ], { align: 'end' });
      } else if (action === 'zoom-in' || action === 'zoom-out') {
        const i = ZOOMS.indexOf(zoom) + (action === 'zoom-in' ? 1 : -1);
        zoom = ZOOMS[clamp(i, 0, ZOOMS.length - 1)]; prefs.set('tableZoom', zoom);
        renderGrid();
      }
    }));

    // Keep the caret in the cell when pressing toolbar buttons.
    D.listen(toolbar, 'mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    D.add(on(toolbar, 'click', '[data-act]', (e, el) => { if (!el.disabled) actions[el.dataset.act]?.(); }));
    D.listen(toolbar, 'change', (e) => {
      const ctl = e.target.dataset?.ctl;
      if (!ctl) return;
      if (ctl === 'headerRows') structural((d) => { ops.setHeaderRows(d, Number(e.target.value)); return {}; }, { activity: `Changed header rows of table "${T().title}"` });
      else if (ctl === 'borders') setStyle('borders', e.target.value);
      else if (ctl === 'fontSize') setStyle('fontSize', Number(e.target.value));
      else if (ctl === 'fill') setStyle('headerFill', e.target.value.toUpperCase());
    });
    D.listen(toolbar, 'input', (e) => {
      if (e.target.dataset?.ctl === 'fill') {
        sheet.style.setProperty('--te-hdr-fill', e.target.value);
        sheet.style.setProperty('--te-hdr-ink', luminance(e.target.value) > 0.5 ? '#000000' : '#FFFFFF');
      }
    });

    // ----- Events: grid ----------------------------------------------------------------------------------------
    const rcOf = (el) => ({ r: Number(el.dataset.r), c: Number(el.dataset.c) });

    function selectColumns(c, extend) {
      const last = T().rows.length - 1;
      const from = extend && sel.a ? sel.a.c : c;
      setSel({ r: 0, c: Math.min(from, c) }, { r: last, c: Math.max(from, c) });
      focusCell(sel.a, 'end');
    }
    function selectRows(r, extend) {
      const last = T().columns.length - 1;
      const from = extend && sel.a ? sel.a.r : r;
      setSel({ r: Math.min(from, r), c: 0 }, { r: Math.max(from, r), c: last });
      focusCell(sel.a, 'end');
    }

    D.listen(gridEl, 'mousedown', (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest('[data-resize]');
      if (handle) { startResize(e, Number(handle.dataset.resize)); return; }
      const colhead = e.target.closest('.colhead');
      if (colhead) { e.preventDefault(); selectColumns(Number(colhead.dataset.col), e.shiftKey); return; }
      const rowhead = e.target.closest('.rowhead');
      if (rowhead) { e.preventDefault(); selectRows(Number(rowhead.dataset.row), e.shiftKey); return; }
      if (e.target.closest('.corner')) { e.preventDefault(); const t = T(); setSel({ r: 0, c: 0 }, { r: t.rows.length - 1, c: t.columns.length - 1 }); focusCell({ r: 0, c: 0 }, 'end'); return; }
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const rc = rcOf(cell);
      if (e.shiftKey) { e.preventDefault(); const a = sel.a; setSel(a, rc); focusCell(a, 'keep'); return; }
      drag = { start: rc, moved: false };
      setSel(rc);
      if (e.target.tagName !== 'TEXTAREA') { e.preventDefault(); focusCell(rc, 'end'); }
    });

    D.listen(document, 'mousemove', (e) => {
      if (resizing) {
        const delta = ((e.clientX - resizing.startX) / resizing.dataW) * 100;
        resizing.widths = ops.resizeBoundary(resizing.start, resizing.i, delta);
        gridEl.style.gridTemplateColumns = `${GUTTER}px ${resizing.widths.map((w) => `minmax(0, ${Math.max(1, w)}fr)`).join(' ')}`;
        resizing.moved = true;
        return;
      }
      if (!drag) return;
      if (!(e.buttons & 1)) { drag = null; gridEl.classList.remove('selecting'); return; }
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.cell');
      if (!hit || !gridEl.contains(hit)) return;
      const rc = rcOf(hit);
      if (!drag.moved) {
        const a = anchorOf(drag.start); const b = anchorOf(rc);
        if (a.r === b.r && a.c === b.c) return;
        drag.moved = true; gridEl.classList.add('selecting');
      }
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
      const ta = document.activeElement;
      if (ta?.tagName === 'TEXTAREA') ta.setSelectionRange(ta.selectionEnd, ta.selectionEnd);
      setSel(drag.start, rc);
    });
    D.listen(document, 'mouseup', () => {
      if (resizing) finishResize();
      if (drag?.moved) gridEl.classList.remove('selecting');
      drag = null;
    });

    function startResize(e, i) {
      e.preventDefault();
      flushPending();
      const t = T();
      resizing = { i, startX: e.clientX, start: t.columns.map((c) => c.width), widths: t.columns.map((c) => c.width), dataW: Math.max(50, gridEl.getBoundingClientRect().width - GUTTER), moved: false };
      document.body.classList.add('te-resizing');
    }
    function finishResize() {
      const r = resizing; resizing = null;
      document.body.classList.remove('te-resizing');
      if (!r?.moved) return;
      structural((d) => { d.columns.forEach((c, k) => { c.width = r.widths[k]; }); ops.normaliseWidths(d.columns); return {}; }, { activity: `Resized columns of table "${T().title}"` });
    }
    D.listen(gridEl, 'dblclick', (e) => {
      if (!e.target.closest('[data-resize]')) return;
      structural((d) => { ops.equaliseWidths(d.columns); return {}; }, { activity: `Resized columns of table "${T().title}"` });
    });

    D.listen(gridEl, 'focusin', (e) => {
      if (e.target.tagName !== 'TEXTAREA') return;
      const rc = rcOf(e.target);
      if (isMulti() && ops.rectContains(selRect(), rc.r, rc.c)) return;
      if (sel.a.r !== rc.r || sel.a.c !== rc.c || isMulti()) { typingActive = false; setSel(rc); }
    });
    D.listen(gridEl, 'focusout', (e) => { if (e.target.tagName === 'TEXTAREA') commitPending(); });

    D.listen(gridEl, 'input', (e) => {
      const ta = e.target;
      if (ta.tagName !== 'TEXTAREA') return;
      ta.parentElement.dataset.value = ta.value;
      if (!typingActive) { flushPending(); pushUndo(ops.snapshotContent(T())); typingActive = true; updateToolbar(); }
      clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingActive = false; }, 1500);
      pending.set(`${ta.dataset.r},${ta.dataset.c}`, ta.value);
      clearTimeout(commitTimer); commitTimer = setTimeout(commitPending, 400);
      refreshStatus();
    });

    // Navigation helpers
    function neighbour(rc, dr, dc) {
      const t = T(); const g = ops.regionAt(t, rc.r, rc.c);
      let r = rc.r; let c = rc.c;
      if (dr < 0) r = g.r1 - 1; else if (dr > 0) r = g.r2 + 1;
      if (dc < 0) c = g.c1 - 1; else if (dc > 0) c = g.c2 + 1;
      if (r < 0 || c < 0 || r >= t.rows.length || c >= t.columns.length) return null;
      return anchorOf({ r, c });
    }
    function go(rc, dr, dc, caret) {
      const target = neighbour(rc, dr, dc);
      if (!target) return false;
      setSel(target); focusCell(target, caret, { scroll: true });
      return true;
    }
    function goNext(rc) {
      const t = T(); const g = ops.regionAt(t, rc.r, rc.c);
      let r = g.r1; let c = g.c2 + 1;
      for (;;) {
        if (c >= t.columns.length) { r += 1; c = 0; }
        if (r >= t.rows.length) break;
        if (!t.rows[r][c].hidden) { setSel({ r, c }); focusCell({ r, c }, 'all', { scroll: true }); return; }
        c += 1;
      }
      structural((d) => { const i = ops.insertRow(d, d.rows.length); return { select: { r1: i, c1: 0, r2: i, c2: 0 } }; }, { activity: 'Added a table row' });
    }
    function goPrev(rc) {
      const t = T(); const g = ops.regionAt(t, rc.r, rc.c);
      let r = g.r1; let c = g.c1 - 1;
      for (;;) {
        if (c < 0) { r -= 1; c = t.columns.length - 1; }
        if (r < 0) return;
        if (!t.rows[r][c].hidden) { setSel({ r, c }); focusCell({ r, c }, 'all', { scroll: true }); return; }
        c -= 1;
      }
    }
    const singleLine = (ta) => {
      const cs = getComputedStyle(ta); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      return ta.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < lh * 1.6;
    };

    D.listen(gridEl, 'keydown', (e) => {
      const ta = e.target;
      if (ta.tagName !== 'TEXTAREA' || e.isComposing || modKey(e) || e.altKey) return;
      const rc = rcOf(ta); const collapsed = ta.selectionStart === ta.selectionEnd;
      // Cell text uses dir="auto": Arabic text runs right-to-left inside the (left-to-right) grid, so the
      // left / right arrows leave the cell at the *visual* edge of the text.
      const rtlText = getComputedStyle(ta).direction === 'rtl';
      switch (e.key) {
        case 'Tab': e.preventDefault(); if (e.shiftKey) goPrev(rc); else goNext(rc); break;
        case 'Enter':
          // Phones have no Shift key: there Enter keeps inserting a line break.
          if (e.shiftKey || window.matchMedia?.('(pointer: coarse)').matches) return;
          e.preventDefault(); go(rc, 1, 0, 'end'); break;
        case 'Escape': if (isMulti()) { e.preventDefault(); setSel(sel.a); } break;
        case 'ArrowUp': if (!e.shiftKey && (singleLine(ta) || (collapsed && ta.selectionStart === 0)) && go(rc, -1, 0, 'end')) e.preventDefault(); break;
        case 'ArrowDown': if (!e.shiftKey && (singleLine(ta) || (collapsed && ta.selectionEnd === ta.value.length)) && go(rc, 1, 0, 'end')) e.preventDefault(); break;
        case 'ArrowLeft': if (!e.shiftKey && collapsed && ta.selectionStart === (rtlText ? ta.value.length : 0) && go(rc, 0, -1, 'edge-right')) e.preventDefault(); break;
        case 'ArrowRight': if (!e.shiftKey && collapsed && ta.selectionEnd === (rtlText ? 0 : ta.value.length) && go(rc, 0, 1, 'edge-left')) e.preventDefault(); break;
        case 'Delete': case 'Backspace':
          if (isMulti()) { e.preventDefault(); structural((d, rect) => { ops.clearCells(d, rect); return {}; }, { activity: `Cleared cells in table "${T().title}"` }); }
          break;
        default:
      }
    });

    // Copy / cut / paste of cell ranges (TSV, compatible with Excel and Word)
    D.listen(gridEl, 'copy', (e) => {
      if (!isMulti()) return;
      e.clipboardData.setData('text/plain', ops.rectToTSV(T(), selRect())); e.preventDefault();
    });
    D.listen(gridEl, 'cut', (e) => {
      if (!isMulti()) return;
      e.clipboardData.setData('text/plain', ops.rectToTSV(T(), selRect())); e.preventDefault();
      structural((d, rect) => { ops.clearCells(d, rect); return {}; }, { activity: `Cut cells in table "${T().title}"` });
    });
    D.listen(gridEl, 'paste', (e) => {
      const text = e.clipboardData?.getData('text/plain') || '';
      const grid = text.includes('\t') || (isMulti() && text.includes('\n'));
      if (!grid) return;
      e.preventDefault();
      const matrix = ops.parseDelimited(text).filter((row, i, all) => !(i === all.length - 1 && row.length === 1 && row[0] === ''));
      structural((d, rect) => { const filled = ops.pasteMatrix(d, rect.r1, rect.c1, matrix); return filled ? { select: filled } : false; }, { activity: `Pasted cells into table "${T().title}"` });
    });

    // Shortcuts that work anywhere inside the editor (except while typing in the title / description fields).
    D.listen(root, 'keydown', (e) => {
      if (!modKey(e) || e.altKey) return;
      const inGrid = !!e.target.closest?.('.te-grid');
      if (isTypingTarget(e.target) && !inGrid) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
      else if (k === 'b') actions.bold();
      else if (k === 'i') actions.italic();
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    // Ctrl+S saves a version here (captured so the global "save now" handler does not also run).
    D.listen(document, 'keydown', (e) => {
      if (modKey(e) && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); e.stopPropagation();
        saveVersion();
      }
    }, true);

    // Flush typing before the page goes away.
    const leave = () => commitPending();
    D.listen(window, 'beforeunload', leave, true);
    D.listen(window, 'pagehide', leave, true);
    D.listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });

    // ----- Store events -------------------------------------------------------------------------------------------------
    D.add(store.on('status', refreshStatus));
    D.add(store.on('change', ({ source }) => {
      if (source === SRC) return;
      if (!findT()) { ctx.navigate(ctx.href('tables'), { replace: true }); return; }
      refreshMeta();
      if (!gridEl.contains(document.activeElement)) { clampSel(); renderGrid(); }
    }));

    // ----- Initial paint ----------------------------------------------------------------------------------------------------
    refreshMeta();
    renderGrid();

    return {
      unmount() {
        commitPending();
        clearTimeout(typingTimer); clearTimeout(titleTimer); clearTimeout(descTimer);
        document.body.classList.remove('te-resizing');
        historyModal?.close();
        D.dispose();
      },
    };
  },
};
