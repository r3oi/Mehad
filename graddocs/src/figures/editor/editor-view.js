// Figure Editor page: header, tool bar, element library, canvas, inspector,
// status bar, autosave, versions/revision mode, comments and exports.
import { DiagramEditor } from './canvas.js';
import { renderLibrary } from './library.js';
import { designPanelHTML, bindDesignPanel, figurePanelHTML, historyPanelHTML, commentsPanelHTML, displayLabel, shapesConnectorsText } from './panels.js';
import { esc, on } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { toast, toastError } from '../../ui/toast.js';
import { openMenu } from '../../ui/menu.js';
import { openModal, confirmDialog } from '../../ui/modal.js';
import { debounce, clone, isTypingTarget, modKey, slugify, downloadBlob, downloadText, uid, formatDateTime } from '../../core/utils.js';
import { findFigure, createComment } from '../../core/model.js';
import { getNumbering } from '../../core/numbering.js';
import { renderFigureSVG, renderThumbnail, computeBounds, isNode, isEdge } from '../render.js';
import { autoLayout, layoutUnsuitedReason } from '../layout.js';
import { getFigureType, buildTemplate } from '../types.js';
import { diffDiagrams, summarizeDiff, autoLabel, hasChanges } from '../diff.js';
import { addVersion, isDirty, latestVersion, revisionCount } from '../versions.js';
import { svgToPngBlob, copyPngToClipboard } from '../../export/png.js';
import { svgToPdfBlob } from '../../export/pdf.js';
import { t, isRTL } from '../../i18n/index.js';

// Menus anchor to a physical edge: the end of the header is on the left in Arabic.
const MENU_END = isRTL ? 'start' : 'end';
// User-typed text (titles, notes, change summaries) picks its own direction in Arabic mode.
const AUTO = isRTL ? ' dir="auto"' : '';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: t('Select'), key: 'V' },
  { id: 'hand', icon: 'hand', label: t('Hand (pan)'), key: 'H' },
  '|',
  { id: 'text', icon: 'type', label: t('Text'), key: 'T' },
  { id: 'rect', icon: 'square', label: t('Rectangle'), key: 'R' },
  { id: 'roundRect', icon: 'roundSquare', label: t('Rounded rectangle'), key: 'U' },
  { id: 'circle', icon: 'circle', label: t('Circle') },
  { id: 'ellipse', icon: 'ellipse', label: t('Ellipse'), key: 'O' },
  { id: 'diamond', icon: 'diamond', label: t('Diamond'), key: 'D' },
  '|',
  { id: 'line', icon: 'line', label: t('Line'), key: 'L' },
  { id: 'arrow', icon: 'arrow', label: t('Arrow'), key: 'A' },
  { id: 'connector', icon: 'connector', label: t('Connector (smart, orthogonal)'), key: 'C' },
];
const ROUTING_MENU = { straight: t('Straight line'), orthogonal: t('Orthogonal line'), curved: t('Curved line') };
const TOOL_KEYS = Object.fromEntries(TOOLS.filter((t) => t.key).map((t) => [t.key.toLowerCase(), t.id]));

export default {
  title: 'Figure Editor', // translated by the shell
  layout: 'flush',
  mount(container, ctx) {
    const { store, params, shell } = ctx;
    const figureId = params.id;
    const getFigure = () => findFigure(store.project, figureId);
    const figure = getFigure();
    if (!figure) {
      container.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('figure')}</div><h3>${t('Figure not found')}</h3><p>${t('It may have been deleted.')}</p><a class="btn btn-primary" href="${ctx.href('figures')}">${t('Back to Figures')}</a></div></div>`;
      return {};
    }
    const project = () => store.project;
    let revisionMode = params.query?.revision === '1';
    let activeTab = 'design';
    let commentFilter = 'open';
    const typeDef = getFigureType(figure.type);

    container.innerHTML = `
      <div class="editor" data-panels="">
        <header class="ed-header">
          <a class="btn btn-ghost btn-icon btn-sm" href="${ctx.href('figures')}" data-tip="${t('Back to Figures')}" aria-label="${t('Back to Figures')}">${icon('arrowLeft')}</a>
          <span class="badge badge-primary ed-fig-label" data-fig-label></span>
          <input class="ed-title-input" data-title${AUTO} value="${esc(figure.title)}" aria-label="${t('Figure title')}" spellcheck="true">
          <span class="badge ed-version-badge" data-version></span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-ghost ed-mobile-toggle" data-action="toggle-left" aria-label="${t('Elements')}">${icon('layers')}</button>
          <button class="btn btn-sm btn-ghost ed-mobile-toggle" data-action="toggle-right" aria-label="${t('Properties')}">${icon('settings')}</button>
          <button class="btn btn-sm ${revisionMode ? 'active' : ''}" data-action="toggle-revision" data-tip="${t('Highlight changes since the last version and save them as a supervisor revision')}">${icon('flag', 'icon-sm')}<span class="hide-sm">${t('Revision mode')}</span></button>
          <button class="btn btn-sm" data-action="save-version" data-tip="${t('Save a named version')}" data-kbd="Ctrl S">${icon('save', 'icon-sm')}<span class="hide-sm">${t('Save version')}</span></button>
          <button class="btn btn-sm btn-primary" data-action="export">${icon('export', 'icon-sm')}<span class="hide-sm">${t('Export')}</span></button>
          <button class="btn btn-sm btn-ghost btn-icon" data-action="more" aria-label="${t('More actions')}">${icon('moreV')}</button>
        </header>
        <div class="ed-revision-banner" data-revision-banner hidden></div>
        <div class="ed-body">
          <aside class="ed-left" data-library></aside>
          <section class="ed-center">
            <div class="ed-toolbar" role="toolbar" aria-label="${t('Drawing tools')}">
              ${TOOLS.map((tool) => (tool === '|' ? '<span class="ed-tb-sep"></span>' : `<button class="ed-tool" data-tool="${tool.id}" data-tip="${esc(tool.label)}" ${tool.key ? `data-kbd="${tool.key}"` : ''} aria-label="${esc(tool.label)}">${icon(tool.icon)}</button>`)).join('')}
              <span class="ed-tb-sep"></span>
              <button class="ed-tool" data-action="duplicate" data-tip="${t('Duplicate')}" data-kbd="Ctrl D" aria-label="${t('Duplicate')}">${icon('duplicate')}</button>
              <button class="ed-tool" data-action="delete" data-tip="${t('Delete')}" data-kbd="Del" aria-label="${t('Delete')}">${icon('trash')}</button>
              <span class="ed-tb-sep"></span>
              <button class="ed-tool" data-action="auto-layout" data-tip="${t('Auto layout')}" aria-label="${t('Auto layout')}" aria-haspopup="menu">${icon('diagram')}</button>
              <button class="ed-tool" data-action="generate" data-tip="${t('Generate from text…')}" aria-label="${t('Generate from text…')}">${icon('sparkles')}</button>
              <span class="ed-tb-sep"></span>
              <button class="ed-tool" data-action="undo" data-tip="${t('Undo')}" data-kbd="Ctrl Z" aria-label="${t('Undo')}">${icon('undo')}</button>
              <button class="ed-tool" data-action="redo" data-tip="${t('Redo')}" data-kbd="Ctrl Y" aria-label="${t('Redo')}">${icon('redo')}</button>
            </div>
            <div class="ed-canvas-host" data-canvas></div>
            <div class="ed-statusbar">
              <span data-status-info class="truncate"></span>
              <span class="spacer"></span>
              <span class="ed-save" data-save></span>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="grid" data-tip="${t('Toggle grid')}" aria-label="${t('Toggle grid')}">${icon('grid')}</button>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="snap" data-tip="${t('Toggle snapping')}" aria-label="${t('Toggle snapping')}">${icon('magnet')}</button>
              <span class="ed-tb-sep"></span>
              <span class="ed-zoom-group">
                <button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-out" data-tip="${t('Zoom out')}" data-kbd="Ctrl −" aria-label="${t('Zoom out')}">${icon('zoomOut')}</button>
                <button class="btn btn-ghost btn-sm ed-zoom" data-action="zoom-menu" aria-label="${t('Zoom level')}"></button>
                <button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-in" data-tip="${t('Zoom in')}" data-kbd="Ctrl +" aria-label="${t('Zoom in')}">${icon('zoomIn')}</button>
              </span>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="fit" data-tip="${t('Fit to screen')}" data-kbd="⇧ 1" aria-label="${t('Fit to screen')}">${icon('maximize')}</button>
            </div>
          </section>
          <aside class="ed-right">
            <div class="tabs ed-tabs" role="tablist">
              <button class="tab" data-tab="design" role="tab">${t('Design')}</button>
              <button class="tab" data-tab="figure" role="tab">${t('Figure')}</button>
              <button class="tab" data-tab="history" role="tab">${t('History')}</button>
              <button class="tab" data-tab="comments" role="tab">${t('Comments')} <span class="badge" data-comment-count></span></button>
            </div>
            <div class="ed-panel" data-panel></div>
          </aside>
        </div>
      </div>`;

    const root = container.querySelector('.editor');
    const q = (sel) => root.querySelector(sel);
    const panel = q('[data-panel]');
    const editor = new DiagramEditor(q('[data-canvas]'), figure.diagram);
    window.graddocs && (window.graddocs.editor = editor);
    const cleanups = [];

    // ---------------------------------------------------------- persistence
    const persist = debounce(() => {
      if (!getFigure()) return;
      store.update((p) => {
        const f = findFigure(p, figureId);
        if (!f) return;
        f.diagram = clone(editor.doc);
        f.updatedAt = Date.now();
      }, { activity: { text: `Edited figure “${getFigure().title}”`, kind: 'edit', targetId: figureId }, source: 'editor' });
    }, 350);
    const flushPersist = () => persist.flush();

    function saveVersion({ label = '', note = '', kind = 'version', requestedBy = '', silent = false } = {}) {
      persist.cancel();
      let version = null;
      store.update((p) => {
        const f = findFigure(p, figureId);
        f.diagram = clone(editor.doc);
        f.updatedAt = Date.now();
        version = addVersion(f, { label, note, kind, requestedBy });
      }, { activity: { text: kind === 'revision' ? `Saved revision of “${getFigure().title}”` : `Saved version of “${getFigure().title}”`, kind: kind === 'revision' ? 'revision' : 'version', targetId: figureId }, source: 'editor-meta' });
      if (!silent) {
        if (version) toast(version.kind === 'revision' ? t('Revision #{n} saved — {label}', { n: version.revision, label: version.label }) : t('Version v{n} saved — {label}', { n: version.number, label: version.label }), { type: 'success' });
        else toast(t('No changes since the last version.'), { type: 'info' });
      }
      if (revisionMode) refreshHighlights();
      return version;
    }

    // ---------------------------------------------------------- header etc.
    function refreshHeader() {
      const f = getFigure();
      if (!f) return;
      const info = getNumbering(project()).figures.get(figureId);
      q('[data-fig-label]').textContent = info ? `${info.label} · ${info.code}` : t('Figure');
      const titleInput = q('[data-title]');
      if (document.activeElement !== titleInput) titleInput.value = f.title;
      const last = latestVersion(f);
      const dirty = isDirty({ ...f, diagram: editor.doc });
      const vb = q('[data-version]');
      vb.textContent = `${last ? `v${last.number}` : 'v0'}${dirty ? ` · ${t('edited')}` : ''}`;
      vb.className = `badge ed-version-badge ${dirty ? 'badge-warning' : ''}`;
      vb.dataset.tip = dirty ? t('You have changes that are autosaved but not yet saved as a version') : t('All changes are saved in this version');
      const open = f.comments.filter((c) => !c.resolved).length;
      q('[data-comment-count]').textContent = open || '';
      q('[data-comment-count]').hidden = !open;
      shell.setBreadcrumbs([{ label: t('Figures'), href: ctx.href('figures') }, { label: info ? `${info.label}: ${f.title}` : f.title }]);
      document.title = `${info?.label || t('Figure')} · ${f.title} · GradDocs`;
    }

    function refreshStatus() {
      const els = editor.doc.elements;
      const sel = editor.selectedElements();
      let info = shapesConnectorsText(els.filter(isNode).length, els.filter(isEdge).length);
      if (sel.length === 1 && isNode(sel[0])) { const n = sel[0]; info = `${displayLabel(n)} · X ${Math.round(n.x)} Y ${Math.round(n.y)} · ${Math.round(n.w)}×${Math.round(n.h)}`; }
      else if (sel.length > 1) info = `${t('{n} selected', { n: sel.length })} · ${info}`;
      q('[data-status-info]').textContent = info;
      q('.ed-zoom').textContent = `${Math.round(editor.zoom * 100)}%`;
      q('[data-action="grid"]').classList.toggle('active', editor.grid);
      q('[data-action="snap"]').classList.toggle('active', editor.snap);
      q('[data-action="undo"]').disabled = !editor.history.canUndo;
      q('[data-action="redo"]').disabled = !editor.history.canRedo;
      const hasSel = sel.length > 0;
      q('.ed-toolbar [data-action="duplicate"]').disabled = !hasSel;
      q('.ed-toolbar [data-action="delete"]').disabled = !hasSel;
    }

    function refreshSave() {
      const el = q('[data-save]');
      const s = store.status;
      el.className = `ed-save ${s}`;
      el.innerHTML = s === 'saving' || persist.pending() ? `<span class="dot"></span>${t('Saving…')}` : s === 'error' ? `${icon('alert', 'icon-sm')} ${t('Not saved')}` : `${icon('check', 'icon-sm')} ${t('Saved')}`;
    }

    function refreshTools() {
      root.querySelectorAll('[data-tool]').forEach((b) => {
        const on = b.dataset.tool === editor.tool;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on);
      });
    }

    // ---------------------------------------------------------- right panel
    function renderPanel(force = false) {
      if (!force && panel.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
      root.querySelectorAll('[data-tab]').forEach((t) => { t.classList.toggle('active', t.dataset.tab === activeTab); t.setAttribute('aria-selected', t.dataset.tab === activeTab); });
      const f = getFigure();
      if (activeTab === 'design') panel.innerHTML = designPanelHTML(editor);
      else if (activeTab === 'figure') panel.innerHTML = figurePanelHTML(project(), { ...f, diagram: editor.doc }, editor);
      else if (activeTab === 'history') panel.innerHTML = historyPanelHTML(project(), { ...f, diagram: editor.doc }, revisionMode);
      else panel.innerHTML = commentsPanelHTML(f, editor, commentFilter);
    }
    bindDesignPanel(panel, editor, { onComment: () => { activeTab = 'comments'; renderPanel(true); panel.querySelector('[data-comment-input]')?.focus(); } });

    // Figure metadata (Figure tab)
    const updateMeta = debounce((field, value) => {
      store.update((p) => {
        const f = findFigure(p, figureId);
        if (field === 'location') {
          const [kind, id] = value.split(':');
          f.chapterId = kind === 'ch' ? id : kind === 'sec' ? (getNumbering(p).sections.get(id)?.chapterId || null) : null;
          f.sectionId = kind === 'sec' ? id : null;
        } else f[field] = value;
        f.updatedAt = Date.now();
      }, { activity: { text: `Updated details of “${getFigure().title}”`, targetId: figureId }, source: 'editor-meta' });
    }, 250);
    panel.addEventListener('input', (e) => { const el = e.target.closest('[data-meta]'); if (el && el.tagName !== 'SELECT') updateMeta(el.dataset.meta, el.value); });
    panel.addEventListener('change', (e) => { const el = e.target.closest('[data-meta]'); if (el?.tagName === 'SELECT') { updateMeta(el.dataset.meta, el.value); updateMeta.flush(); } });
    panel.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const { action, value } = btn.dataset;
      if (action === 'save-version') openSaveVersionDialog(revisionMode ? 'revision' : 'version');
      else if (action === 'toggle-revision') setRevisionMode(!revisionMode);
      else if (action === 'view-version') viewVersion(value);
      else if (action === 'restore-version') restoreVersion(value);
      else if (action === 'apply-template') applyTemplate();
      else if (action === 'comment-filter') { commentFilter = value; renderPanel(true); }
      else if (action === 'add-comment') addComment();
      else if (action === 'resolve-comment') {
        store.update((p) => { const c = findFigure(p, figureId).comments.find((x) => x.id === value); if (c) c.resolved = !c.resolved; }, { source: 'editor-meta' });
      } else if (action === 'delete-comment') {
        if (await confirmDialog({ title: t('Delete comment?'), message: t('This comment will be removed permanently.'), confirmText: t('Delete'), danger: true })) {
          store.update((p) => { const f = findFigure(p, figureId); f.comments = f.comments.filter((x) => x.id !== value); }, { source: 'editor-meta' });
        }
      } else if (action === 'focus-element') { editor.select(value); editor.centerOn(value); }
    });

    function addComment() {
      const input = panel.querySelector('[data-comment-input]');
      const text = input?.value.trim();
      if (!text) { input?.focus(); return; }
      const sel = editor.selectedElements();
      store.update((p) => {
        findFigure(p, figureId).comments.unshift(createComment({ text, elementId: sel.length === 1 ? sel[0].id : null }));
      }, { activity: { text: `Commented on “${getFigure().title}”`, kind: 'comment', targetId: figureId }, source: 'editor-meta' });
      commentFilter = 'open';
      renderPanel(true);
      toast(t('Comment added'), { type: 'success', duration: 1500 });
    }

    function refreshCommentBadges() {
      const counts = new Map();
      for (const c of getFigure()?.comments || []) if (!c.resolved && c.elementId) counts.set(c.elementId, (counts.get(c.elementId) || 0) + 1);
      editor.setCommentCounts(counts);
    }

    // ---------------------------------------------------------- versions
    function openSaveVersionDialog(kind = 'version') {
      const f = getFigure();
      const last = latestVersion(f);
      const diff = diffDiagrams(last?.snapshot || { elements: [] }, editor.doc);
      const changes = summarizeDiff(diff);
      if (last && !hasChanges(diff)) { toast(t('No changes since the last version.'), { type: 'info' }); return; }
      const isRev = kind === 'revision';
      const modal = openModal({
        title: isRev ? t('Save Revision #{n}', { n: revisionCount(f) + 1 }) : t('Save version v{n}', { n: (last?.number || 0) + 1 }),
        subtitle: isRev ? t('Record what changed for your supervisor.') : t('Name this state of the figure so you can return to it later.'),
        body: `<div class="form-grid">
          <div class="field"><label>${t('Detected changes')}</label>
            <ul class="ed-change-list"${AUTO}>${changes.map((c) => `<li>${esc(c)}</li>`).join('') || `<li>${t('Initial version')}</li>`}</ul></div>
          <div class="field"><label for="sv-label">${isRev ? t('Revision title') : t('Version name')}</label><input id="sv-label" class="input"${AUTO} value="${esc(last ? autoLabel(diff) : 'Initial diagram')}" autofocus></div>
          ${isRev ? `<div class="field"><label for="sv-by">${t('Requested by')}</label><input id="sv-by" class="input"${AUTO} value="${esc(project().supervisor || '')}" placeholder="${t('e.g. Dr. Ahmed')}"></div>` : ''}
          <div class="field"><label for="sv-note">${t('Note')}</label><textarea id="sv-note" class="textarea" rows="2"${AUTO} placeholder="${isRev ? t('e.g. Doctor requested renaming the analysis feature.') : t('Optional')}"></textarea></div>
        </div>`,
        footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-ok>${icon('save', 'icon-sm')} ${isRev ? t('Save revision') : t('Save version')}</button>`,
      });
      const submit = () => {
        const v = saveVersion({ kind, label: modal.$('#sv-label').value.trim(), note: modal.$('#sv-note').value.trim(), requestedBy: modal.$('#sv-by')?.value.trim() || '' });
        modal.close();
        if (v && isRev) setRevisionMode(true);
      };
      modal.$('[data-ok]').addEventListener('click', submit);
      modal.$('#sv-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    }

    function viewVersion(versionId) {
      const f = getFigure();
      const v = f.versions.find((x) => x.id === versionId);
      if (!v) return;
      const modal = openModal({
        title: `v${v.number} — ${v.label}`,
        subtitle: `${isRTL ? formatDateTime(v.createdAt) : new Date(v.createdAt).toLocaleString('en-GB')}${v.requestedBy ? ` · ${t('Requested by {name}', { name: v.requestedBy })}` : ''}`,
        size: 'xl',
        body: `<div class="ed-version-view"><div class="thumb ed-version-thumb">${renderThumbnail(v.snapshot)}</div>
          <div class="ed-version-meta">${v.note ? `<p${AUTO}>${esc(v.note)}</p>` : ''}<div class="section-title">${t('Changes in this version')}</div><ul class="ed-change-list"${AUTO}>${(v.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div></div>`,
        footer: `<div class="left"><button class="btn" data-dl>${icon('export', 'icon-sm')} ${t('Download SVG')}</button></div><button class="btn" data-close>${t('Close')}</button><button class="btn btn-primary" data-restore>${icon('history', 'icon-sm')} ${t('Restore this version')}</button>`,
      });
      modal.$('[data-dl]').addEventListener('click', () => {
        const { svg } = renderFigureSVG(v.snapshot);
        downloadText(svg, `${fileBase()}-v${v.number}.svg`, 'image/svg+xml');
      });
      modal.$('[data-restore]').addEventListener('click', () => { modal.close(); restoreVersion(versionId, true); });
    }

    async function restoreVersion(versionId, confirmed = false) {
      const v = getFigure().versions.find((x) => x.id === versionId);
      if (!v) return;
      if (!confirmed && !(await confirmDialog({ title: t('Restore v{n}?', { n: v.number }), message: t('The canvas will be replaced with {version}. Your current state is kept in the history, and you can undo.', { version: `<strong>v${v.number} — ${esc(v.label)}</strong>` }), confirmText: t('Restore') }))) return;
      editor.replaceDiagram(v.snapshot);
      persist.cancel();
      store.update((p) => {
        const f = findFigure(p, figureId);
        f.diagram = clone(editor.doc);
        f.updatedAt = Date.now();
        addVersion(f, { label: `Restored v${v.number}`, kind: 'restore', force: true });
      }, { activity: { text: `Restored v${v.number} of “${getFigure().title}”`, kind: 'version', targetId: figureId }, source: 'editor-meta' });
      toast(t('Restored v{n}', { n: v.number }), { type: 'success', action: { label: t('Undo'), onClick: () => editor.undo() } });
    }

    async function applyTemplate() {
      const f = getFigure();
      const ft = getFigureType(f.type);
      if (!(await confirmDialog({ title: t('Reset to the {type} template?', { type: ft.name }), message: t('The current diagram will be replaced by the starter template. You can undo this or restore any saved version.'), confirmText: t('Reset diagram') }))) return;
      editor.replaceDiagram(buildTemplate(f.type, project()));
      editor.fit({ maxZoom: 1 });
      toast(t('Template applied'), { type: 'success', action: { label: t('Undo'), onClick: () => editor.undo() } });
    }

    // ---------------------------------------------------------- auto layout & generate
    function runAutoLayout(mode, direction) {
      if (layoutUnsuitedReason(editor.doc, getFigure()?.type)) {
        toast(t('Auto layout is not suited to fishbone, sequence or timeline figures — they keep their own layout.'), { type: 'info' });
        return;
      }
      if (!editor.doc.elements.some(isNode)) { toast(t('Nothing to arrange yet.'), { type: 'info' }); return; }
      const picked = editor.selectedElements().filter(isNode);
      const ids = picked.length >= 2 ? new Set(picked.map((n) => n.id)) : null;
      const before = editor.snapshot();
      editor.mutate((doc) => { autoLayout(doc, { mode, direction, ids }); });
      editor.fit({ maxZoom: 1 });
      if (editor.snapshot() === before) { toast(t('Already arranged.'), { type: 'info' }); return; }
      toast(ids ? t('Arranged {n} selected shapes', { n: ids.size }) : t('Diagram arranged'), { type: 'success', action: { label: t('Undo'), onClick: () => { editor.undo(); editor.fit({ maxZoom: 1 }); } } });
    }

    function openAutoLayoutMenu(anchor) {
      const picked = editor.selectedElements().filter(isNode);
      openMenu(anchor, [
        { heading: picked.length >= 2 ? t('Arrange {n} selected shapes', { n: picked.length }) : t('Arrange the whole diagram') },
        { label: t('Top to bottom'), icon: 'arrowDown', onClick: () => runAutoLayout('auto', 'TB') },
        { label: t('Left to right'), icon: 'arrowRight', onClick: () => runAutoLayout('auto', 'LR') },
        { label: t('Tree'), icon: 'tHierarchy', onClick: () => runAutoLayout('tree', 'TB') },
      ]);
    }

    /** Place a generated diagram beside the existing drawing. */
    function addToCanvas(diagram) {
      const here = computeBounds(editor.doc);
      const gen = computeBounds(diagram);
      const below = here.w > here.h * 1.3;
      const dx = Math.round(below ? here.x - gen.x : here.x + here.w + 80 - gen.x);
      const dy = Math.round(below ? here.y + here.h + 80 - gen.y : here.y - gen.y);
      const els = clone(diagram.elements);
      for (const el of els) {
        if (isNode(el)) { el.x += dx; el.y += dy; } else for (const end of [el.source, el.target]) if (end && !end.id) { end.x += dx; end.y += dy; }
      }
      editor.mutate((doc) => { doc.elements.push(...els); });
      editor.select(els.map((e) => e.id));
    }

    async function openGenerate() {
      const { openGenerateDialog } = await import('../generate/generate-dialog.js');
      const result = await openGenerateDialog({ project: project(), mode: 'insert', hasContent: editor.doc.elements.length > 0 });
      if (!result) return;
      if (result.mode === 'replace' || !editor.doc.elements.length) editor.replaceDiagram(result.diagram);
      else addToCanvas(result.diagram);
      editor.fit({ maxZoom: 1 });
      toast(result.mode === 'replace' ? t('Diagram replaced') : t('Diagram added to the canvas'), { type: 'success', action: { label: t('Undo'), onClick: () => { editor.undo(); editor.fit({ maxZoom: 1 }); } } });
    }

    // ---------------------------------------------------------- revision mode
    function refreshHighlights() {
      const banner = q('[data-revision-banner]');
      if (!revisionMode) { editor.setHighlights(null); banner.hidden = true; return; }
      const f = getFigure();
      const last = latestVersion(f);
      const diff = diffDiagrams(last?.snapshot || { elements: [] }, editor.doc);
      editor.setHighlights(diff.changedIds);
      const lines = summarizeDiff(diff);
      banner.hidden = false;
      banner.innerHTML = `${icon('flag')}<div class="grow"><strong>${t('Revision mode')}</strong> ${t('— changes since v{n} are highlighted', { n: last?.number ?? 0 })}
        <span class="ed-legend"><i class="added"></i>${t('added')} <i class="changed"></i>${t('changed')}</span>
        <div class="ed-banner-changes truncate"${AUTO}>${lines.length ? lines.map(esc).join(' · ') : t('No changes yet. Edit the figure as requested by your supervisor.')}</div></div>
        <button class="btn btn-sm btn-primary" data-action="save-revision" ${lines.length ? '' : 'disabled'}>${icon('save', 'icon-sm')} ${t('Save Revision')}</button>
        <button class="btn btn-sm btn-ghost" data-action="toggle-revision">${t('Exit')}</button>`;
    }
    function setRevisionMode(on) {
      revisionMode = on;
      q('.ed-header [data-action="toggle-revision"]').classList.toggle('active', on);
      refreshHighlights();
      if (activeTab === 'history') renderPanel(true);
    }
    q('[data-revision-banner]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (btn?.dataset.action === 'save-revision') openSaveVersionDialog('revision');
      if (btn?.dataset.action === 'toggle-revision') setRevisionMode(false);
    });

    // ---------------------------------------------------------- exports
    function fileBase() {
      const info = getNumbering(project()).figures.get(figureId);
      const num = info ? String(info.number).padStart(2, '0') : '00';
      return `Figure-${num}-${slugify(getFigure().title)}`;
    }
    function exportSVG() {
      const transparent = project().settings.figureDefaults?.transparentBackground;
      return renderFigureSVG(editor.doc, transparent ? { background: null } : {});
    }
    const scale = () => Number(project().settings.figureDefaults?.exportScale) || 3;
    async function doExport(kind) {
      try {
        if (kind === 'svg') { downloadText(exportSVG().svg, `${fileBase()}.svg`, 'image/svg+xml'); }
        else if (kind === 'png') { const { svg, width, height } = exportSVG(); downloadBlob(await svgToPngBlob(svg, width, height, { scale: scale() }), `${fileBase()}.png`); }
        else if (kind === 'pdf') { const { svg, width, height } = renderFigureSVG(editor.doc); downloadBlob(await svgToPdfBlob(svg, width, height, { scale: scale(), title: getFigure().title }), `${fileBase()}.pdf`); }
        else if (kind === 'copy') {
          const { svg, width, height } = renderFigureSVG(editor.doc);
          await copyPngToClipboard(await svgToPngBlob(svg, width, height, { scale: scale() }));
          toast(t('Image copied — paste it into Word with Ctrl+V'), { type: 'success' });
          return;
        }
        toast(t('Exported {kind}', { kind: kind.toUpperCase() }), { type: 'success', duration: 1800 });
      } catch (err) { toastError(err, t('Export failed')); }
    }

    // ---------------------------------------------------------- figure ops
    async function duplicateFigure() {
      flushPersist();
      const src = getFigure();
      const copy = clone(src);
      copy.id = uid('fig'); copy.title = `${src.title} (copy)`; copy.versions = []; copy.comments = [];
      copy.createdAt = copy.updatedAt = Date.now();
      addVersion(copy, { force: true });
      store.update((p) => { const i = p.figures.findIndex((f) => f.id === figureId); p.figures.splice(i + 1, 0, copy); }, { activity: { text: `Duplicated figure “${src.title}”`, kind: 'create', targetId: copy.id } });
      toast(t('Figure duplicated'), { type: 'success' });
      ctx.navigate(ctx.href('figures', copy.id));
    }
    async function deleteFigure() {
      const f = getFigure();
      const info = getNumbering(project()).figures.get(figureId);
      if (!(await confirmDialog({ title: t('Delete {label}?', { label: info?.label || t('figure') }), message: t('“{title}” and its version history will be deleted. Later figures are renumbered automatically and references to it will show as broken.', { title: esc(f.title) }), confirmText: t('Delete figure'), danger: true }))) return;
      persist.cancel();
      deleted = true;
      store.update((p) => { p.figures = p.figures.filter((x) => x.id !== figureId); }, { activity: { text: `Deleted figure “${f.title}”`, kind: 'delete' } });
      toast(t('Figure deleted'), { type: 'success' });
      ctx.navigate(ctx.href('figures'));
    }
    let deleted = false;

    // ---------------------------------------------------------- events
    const library = renderLibrary(q('[data-library]'), { groupsFirst: typeDef.libraryGroups, onAdd: (preset) => { editor.setTool('select'); editor.addPreset(preset); root.dataset.panels = ''; } });
    const canvasHost = q('[data-canvas]');
    canvasHost.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-graddocs-preset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    canvasHost.addEventListener('drop', (e) => {
      const idx = e.dataTransfer.getData('application/x-graddocs-preset');
      if (idx === '') return;
      e.preventDefault();
      editor.addPreset(library.presetAt(idx), editor.screenToDiagram(e.clientX, e.clientY));
    });

    cleanups.push(on(root, 'click', '[data-tool]', (e, el) => { editor.setTool(el.dataset.tool); }));
    cleanups.push(on(root, 'click', '[data-tab]', (e, el) => { activeTab = el.dataset.tab; renderPanel(true); }));
    cleanups.push(on(root, 'click', '.ed-header [data-action], .ed-toolbar [data-action], .ed-statusbar [data-action]', (e, el) => {
      const a = el.dataset.action;
      if (a === 'undo') editor.undo();
      else if (a === 'redo') editor.redo();
      else if (a === 'duplicate') editor.duplicateSelection();
      else if (a === 'delete') editor.deleteSelection();
      else if (a === 'zoom-in') editor.zoomIn();
      else if (a === 'zoom-out') editor.zoomOut();
      else if (a === 'fit') editor.fit();
      else if (a === 'auto-layout') openAutoLayoutMenu(el);
      else if (a === 'generate') openGenerate();
      else if (a === 'grid') editor.setGrid(!editor.grid);
      else if (a === 'snap') editor.setSnap(!editor.snap);
      else if (a === 'zoom-menu') openMenu(el, [50, 75, 100, 150, 200].map((z) => ({ label: `${z}%`, onClick: () => editor.setZoom(z / 100) })).concat(['-', { label: t('Fit to screen'), icon: 'maximize', shortcut: '⇧1', onClick: () => editor.fit() }]));
      else if (a === 'toggle-revision') setRevisionMode(!revisionMode);
      else if (a === 'save-version') openSaveVersionDialog(revisionMode ? 'revision' : 'version');
      else if (a === 'toggle-left') root.dataset.panels = root.dataset.panels === 'left' ? '' : 'left';
      else if (a === 'toggle-right') root.dataset.panels = root.dataset.panels === 'right' ? '' : 'right';
      else if (a === 'export') {
        openMenu(el, [
          { heading: t('Download') },
          { label: t('SVG (vector, best for Word)'), icon: 'image', onClick: () => doExport('svg') },
          { label: t('PNG ({scale}× · {dpi} DPI)', { scale: scale(), dpi: 96 * scale() }), icon: 'image', onClick: () => doExport('png') },
          { label: t('PDF'), icon: 'fileText', onClick: () => doExport('pdf') },
          '-',
          { label: t('Copy image to clipboard'), icon: 'clipboard', onClick: () => doExport('copy') },
        ], { align: MENU_END });
      } else if (a === 'more') {
        openMenu(el, [
          { label: t('Duplicate figure'), icon: 'duplicate', onClick: duplicateFigure },
          { label: t('Reset to template…'), icon: 'wand', onClick: applyTemplate },
          { label: t('Generate from text…'), icon: 'sparkles', onClick: openGenerate },
          { label: t('Keyboard shortcuts'), icon: 'keyboard', shortcut: '?', onClick: async () => (await import('../../app/shortcuts.js')).showShortcutsHelp() },
          '-',
          { label: t('Delete figure'), icon: 'trash', danger: true, onClick: deleteFigure },
        ], { align: MENU_END });
      }
    }));

    const titleInput = q('[data-title]');
    titleInput.addEventListener('input', () => updateMeta('title', titleInput.value.trim() || 'Untitled Figure'));
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); titleInput.blur(); canvasHost.focus(); } });
    titleInput.addEventListener('blur', () => { if (!titleInput.value.trim()) titleInput.value = getFigure()?.title || ''; updateMeta.flush(); });

    editor.on('change', () => {
      persist();
      refreshSave();
      refreshStatus();
      refreshHeader();
      if (revisionMode) refreshHighlights();
      if (activeTab !== 'comments') renderPanel();
    });
    editor.on('selection', () => { refreshStatus(); if (activeTab === 'design' || activeTab === 'comments') renderPanel(true); });
    editor.on('history', refreshStatus);
    editor.on('view', refreshStatus);
    editor.on('tool', refreshTools);
    editor.on('comment-click', (id) => { activeTab = 'comments'; editor.select(id); renderPanel(true); });
    editor.on('context', ({ x, y, element, point }) => {
      const items = element ? [
        { label: t('Edit text'), icon: 'edit', shortcut: 'Enter', onClick: () => editor.startTextEdit(element.id) },
        { label: t('Duplicate'), icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => editor.duplicateSelection() },
        { label: t('Copy'), icon: 'copy', shortcut: 'Ctrl+C', onClick: () => editor.copy() },
        '-',
        { label: t('Bring to front'), icon: 'bringFront', onClick: () => editor.bringToFront() },
        { label: t('Send to back'), icon: 'sendBack', onClick: () => editor.sendToBack() },
        ...(isEdge(element) ? ['-', { label: t('Reverse direction'), icon: 'swap', onClick: () => editor.reverseSelectedEdges() },
          ...Object.entries(ROUTING_MENU).map(([r, label]) => ({ label, icon: element.routing === r ? 'check' : 'line', onClick: () => editor.updateSelected((el) => { el.routing = r; }, { kind: 'edge' }) }))] : []),
        '-',
        { label: t('Add comment'), icon: 'message', onClick: () => { activeTab = 'comments'; renderPanel(true); panel.querySelector('[data-comment-input]')?.focus(); } },
        { label: t('Delete'), icon: 'trash', danger: true, shortcut: 'Del', onClick: () => editor.deleteSelection() },
      ] : [
        { label: t('Paste'), icon: 'clipboard', shortcut: 'Ctrl+V', onClick: () => editor.paste() },
        { label: t('Add text here'), icon: 'type', onClick: () => { const el = editor.addPreset({ shape: 'text', text: '' }, point); if (el) editor.startTextEdit(el.id); } },
        { label: t('Select all'), icon: 'pointer', shortcut: 'Ctrl+A', onClick: () => editor.selectAll() },
        '-',
        { label: t('Fit to screen'), icon: 'maximize', shortcut: '⇧1', onClick: () => editor.fit() },
      ];
      openMenu({ x, y }, items);
    });

    // ---------------------------------------------------------- keyboard
    const onKeyDown = (e) => {
      const mod = modKey(e);
      const key = e.key.toLowerCase();
      if (mod && key === 's') {
        e.preventDefault(); e.stopPropagation();
        if (document.activeElement === titleInput) updateMeta.flush();
        if (revisionMode) openSaveVersionDialog('revision');
        else saveVersion({ kind: 'version' });
        return;
      }
      if (document.querySelector('.modal-root, .palette-root') || isTypingTarget(e.target)) return;
      if (e.key === ' ' && !e.repeat) { editor.spaceDown = true; canvasHost.classList.add('space-pan'); e.preventDefault(); return; }
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); editor.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); editor.duplicateSelection(); return; }
      if (mod && key === 'c') { if (editor.copy()) e.preventDefault(); return; }
      if (mod && key === 'x') { e.preventDefault(); editor.cut(); return; }
      if (mod && key === 'v') { if (editor.paste()) e.preventDefault(); return; }
      if (mod && key === 'a') { e.preventDefault(); editor.selectAll(); return; }
      if (mod && (key === '=' || key === '+')) { e.preventDefault(); editor.zoomIn(); return; }
      if (mod && (key === '-' || key === '_')) { e.preventDefault(); editor.zoomOut(); return; }
      if (mod && key === '0') { e.preventDefault(); editor.zoomReset(); return; }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.selection.size) { e.preventDefault(); editor.deleteSelection(); } return; }
      if (e.key === 'Escape') { if (editor.tool !== 'select') editor.setTool('select'); else editor.clearSelection(); root.dataset.panels = ''; return; }
      if ((e.key === 'Enter' || e.key === 'F2') && editor.selection.size === 1) { e.preventDefault(); editor.startTextEdit([...editor.selection][0]); return; }
      if (e.key.startsWith('Arrow') && editor.selection.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        editor.nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
        return;
      }
      if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) { e.preventDefault(); editor.fit(); return; }
      if (!e.altKey && TOOL_KEYS[key]) { editor.setTool(TOOL_KEYS[key]); }
    };
    const onKeyUp = (e) => { if (e.key === ' ') { editor.spaceDown = false; canvasHost.classList.remove('space-pan'); } };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp);

    // ---------------------------------------------------------- store sync
    const offChange = store.on('change', ({ source }) => {
      if (deleted) return;
      if (!getFigure()) { toast(t('This figure was deleted.'), { type: 'warning' }); ctx.navigate(ctx.href('figures')); return; }
      refreshHeader();
      refreshCommentBadges();
      if (source !== 'editor') renderPanel();
    });
    const offStatus = store.on('status', refreshSave);

    // ---------------------------------------------------------- initial
    refreshHeader(); refreshTools(); refreshStatus(); refreshSave(); renderPanel(true); refreshCommentBadges();
    if (revisionMode) refreshHighlights();
    requestAnimationFrame(() => { editor.fit({ maxZoom: 1 }); canvasHost.focus({ preventScroll: true }); });
    if (params.query?.select) { editor.select(params.query.select); }

    return {
      unmount() {
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp);
        offChange(); offStatus();
        cleanups.forEach((fn) => fn());
        editor.commitTextEdit();
        updateMeta.flush();
        if (!deleted && getFigure()) {
          persist.flush();
          // Every editing session ends as a version, so nothing is ever lost.
          if (isDirty(getFigure())) saveVersion({ kind: 'auto', silent: true });
        }
        editor.destroy();
        if (window.graddocs) delete window.graddocs.editor;
      },
    };
  },
};
