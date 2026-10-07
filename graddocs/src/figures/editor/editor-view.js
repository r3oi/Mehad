// Figure Editor page: header, tool bar, element library, canvas, inspector,
// status bar, autosave, versions/revision mode, comments and exports.
import { DiagramEditor } from './canvas.js';
import { renderLibrary } from './library.js';
import { designPanelHTML, bindDesignPanel, figurePanelHTML, historyPanelHTML, commentsPanelHTML } from './panels.js';
import { esc, on } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { toast, toastError } from '../../ui/toast.js';
import { openMenu } from '../../ui/menu.js';
import { openModal, confirmDialog } from '../../ui/modal.js';
import { debounce, clone, isTypingTarget, modKey, slugify, downloadBlob, downloadText, uid } from '../../core/utils.js';
import { findFigure, createComment } from '../../core/model.js';
import { getNumbering } from '../../core/numbering.js';
import { renderFigureSVG, renderThumbnail, isNode, isEdge } from '../render.js';
import { getFigureType, buildTemplate } from '../types.js';
import { diffDiagrams, summarizeDiff, autoLabel, hasChanges, elementLabel } from '../diff.js';
import { addVersion, isDirty, latestVersion, revisionCount } from '../versions.js';
import { svgToPngBlob, copyPngToClipboard } from '../../export/png.js';
import { svgToPdfBlob } from '../../export/pdf.js';

const TOOLS = [
  { id: 'select', icon: 'pointer', label: 'Select', key: 'V' },
  { id: 'hand', icon: 'hand', label: 'Hand (pan)', key: 'H' },
  '|',
  { id: 'text', icon: 'type', label: 'Text', key: 'T' },
  { id: 'rect', icon: 'square', label: 'Rectangle', key: 'R' },
  { id: 'roundRect', icon: 'roundSquare', label: 'Rounded rectangle', key: 'U' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { id: 'diamond', icon: 'diamond', label: 'Diamond', key: 'D' },
  '|',
  { id: 'line', icon: 'line', label: 'Line', key: 'L' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { id: 'connector', icon: 'connector', label: 'Connector (smart, orthogonal)', key: 'C' },
];
const TOOL_KEYS = Object.fromEntries(TOOLS.filter((t) => t.key).map((t) => [t.key.toLowerCase(), t.id]));

export default {
  title: 'Figure Editor',
  layout: 'flush',
  mount(container, ctx) {
    const { store, params, shell } = ctx;
    const figureId = params.id;
    const getFigure = () => findFigure(store.project, figureId);
    const figure = getFigure();
    if (!figure) {
      container.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('figure')}</div><h3>Figure not found</h3><p>It may have been deleted.</p><a class="btn btn-primary" href="${ctx.href('figures')}">Back to Figures</a></div></div>`;
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
          <a class="btn btn-ghost btn-icon btn-sm" href="${ctx.href('figures')}" data-tip="Back to Figures" aria-label="Back to Figures">${icon('arrowLeft')}</a>
          <span class="badge badge-primary ed-fig-label" data-fig-label></span>
          <input class="ed-title-input" data-title value="${esc(figure.title)}" aria-label="Figure title" spellcheck="true">
          <span class="badge ed-version-badge" data-version></span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-ghost ed-mobile-toggle" data-action="toggle-left" aria-label="Elements">${icon('layers')}</button>
          <button class="btn btn-sm btn-ghost ed-mobile-toggle" data-action="toggle-right" aria-label="Properties">${icon('settings')}</button>
          <button class="btn btn-sm ${revisionMode ? 'active' : ''}" data-action="toggle-revision" data-tip="Highlight changes since the last version and save them as a supervisor revision">${icon('flag', 'icon-sm')}<span class="hide-sm">Revision mode</span></button>
          <button class="btn btn-sm" data-action="save-version" data-tip="Save a named version" data-kbd="Ctrl S">${icon('save', 'icon-sm')}<span class="hide-sm">Save version</span></button>
          <button class="btn btn-sm btn-primary" data-action="export">${icon('export', 'icon-sm')}<span class="hide-sm">Export</span></button>
          <button class="btn btn-sm btn-ghost btn-icon" data-action="more" aria-label="More actions">${icon('moreV')}</button>
        </header>
        <div class="ed-revision-banner" data-revision-banner hidden></div>
        <div class="ed-body">
          <aside class="ed-left" data-library></aside>
          <section class="ed-center">
            <div class="ed-toolbar" role="toolbar" aria-label="Drawing tools">
              ${TOOLS.map((t) => (t === '|' ? '<span class="ed-tb-sep"></span>' : `<button class="ed-tool" data-tool="${t.id}" data-tip="${esc(t.label)}" ${t.key ? `data-kbd="${t.key}"` : ''} aria-label="${esc(t.label)}">${icon(t.icon)}</button>`)).join('')}
              <span class="ed-tb-sep"></span>
              <button class="ed-tool" data-action="duplicate" data-tip="Duplicate" data-kbd="Ctrl D" aria-label="Duplicate">${icon('duplicate')}</button>
              <button class="ed-tool" data-action="delete" data-tip="Delete" data-kbd="Del" aria-label="Delete">${icon('trash')}</button>
              <span class="ed-tb-sep"></span>
              <button class="ed-tool" data-action="undo" data-tip="Undo" data-kbd="Ctrl Z" aria-label="Undo">${icon('undo')}</button>
              <button class="ed-tool" data-action="redo" data-tip="Redo" data-kbd="Ctrl Y" aria-label="Redo">${icon('redo')}</button>
            </div>
            <div class="ed-canvas-host" data-canvas></div>
            <div class="ed-statusbar">
              <span data-status-info class="truncate"></span>
              <span class="spacer"></span>
              <span class="ed-save" data-save></span>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="grid" data-tip="Toggle grid" aria-label="Toggle grid">${icon('grid')}</button>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="snap" data-tip="Toggle snapping" aria-label="Toggle snapping">${icon('magnet')}</button>
              <span class="ed-tb-sep"></span>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-out" data-tip="Zoom out" data-kbd="Ctrl −" aria-label="Zoom out">${icon('zoomOut')}</button>
              <button class="btn btn-ghost btn-sm ed-zoom" data-action="zoom-menu" aria-label="Zoom level"></button>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="zoom-in" data-tip="Zoom in" data-kbd="Ctrl +" aria-label="Zoom in">${icon('zoomIn')}</button>
              <button class="btn btn-ghost btn-icon btn-sm" data-action="fit" data-tip="Fit to screen" data-kbd="⇧ 1" aria-label="Fit to screen">${icon('maximize')}</button>
            </div>
          </section>
          <aside class="ed-right">
            <div class="tabs ed-tabs" role="tablist">
              <button class="tab" data-tab="design" role="tab">Design</button>
              <button class="tab" data-tab="figure" role="tab">Figure</button>
              <button class="tab" data-tab="history" role="tab">History</button>
              <button class="tab" data-tab="comments" role="tab">Comments <span class="badge" data-comment-count></span></button>
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
        if (version) toast(`${version.kind === 'revision' ? `Revision #${version.revision}` : `Version v${version.number}`} saved — ${version.label}`, { type: 'success' });
        else toast('No changes since the last version.', { type: 'info' });
      }
      if (revisionMode) refreshHighlights();
      return version;
    }

    // ---------------------------------------------------------- header etc.
    function refreshHeader() {
      const f = getFigure();
      if (!f) return;
      const info = getNumbering(project()).figures.get(figureId);
      q('[data-fig-label]').textContent = info ? `${info.label} · ${info.code}` : 'Figure';
      const titleInput = q('[data-title]');
      if (document.activeElement !== titleInput) titleInput.value = f.title;
      const last = latestVersion(f);
      const dirty = isDirty({ ...f, diagram: editor.doc });
      const vb = q('[data-version]');
      vb.textContent = `${last ? `v${last.number}` : 'v0'}${dirty ? ' · edited' : ''}`;
      vb.className = `badge ed-version-badge ${dirty ? 'badge-warning' : ''}`;
      vb.dataset.tip = dirty ? 'You have changes that are autosaved but not yet saved as a version' : 'All changes are saved in this version';
      const open = f.comments.filter((c) => !c.resolved).length;
      q('[data-comment-count]').textContent = open || '';
      q('[data-comment-count]').hidden = !open;
      shell.setBreadcrumbs([{ label: 'Figures', href: ctx.href('figures') }, { label: info ? `${info.label}: ${f.title}` : f.title }]);
      document.title = `${info?.label || 'Figure'} · ${f.title} · GradDocs`;
    }

    function refreshStatus() {
      const els = editor.doc.elements;
      const sel = editor.selectedElements();
      let info = `${els.filter(isNode).length} shapes · ${els.filter(isEdge).length} connectors`;
      if (sel.length === 1 && isNode(sel[0])) { const n = sel[0]; info = `${elementLabel(n)} · X ${Math.round(n.x)} Y ${Math.round(n.y)} · ${Math.round(n.w)}×${Math.round(n.h)}`; }
      else if (sel.length > 1) info = `${sel.length} selected · ${info}`;
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
      el.innerHTML = s === 'saving' || persist.pending() ? '<span class="dot"></span>Saving…' : s === 'error' ? `${icon('alert', 'icon-sm')} Not saved` : `${icon('check', 'icon-sm')} Saved`;
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
        if (await confirmDialog({ title: 'Delete comment?', message: 'This comment will be removed permanently.', confirmText: 'Delete', danger: true })) {
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
      toast('Comment added', { type: 'success', duration: 1500 });
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
      if (last && !hasChanges(diff)) { toast('No changes since the last version.', { type: 'info' }); return; }
      const isRev = kind === 'revision';
      const modal = openModal({
        title: isRev ? `Save Revision #${revisionCount(f) + 1}` : `Save version v${(last?.number || 0) + 1}`,
        subtitle: isRev ? 'Record what changed for your supervisor.' : 'Name this state of the figure so you can return to it later.',
        body: `<div class="form-grid">
          <div class="field"><label>Detected changes</label>
            <ul class="ed-change-list">${changes.map((c) => `<li>${esc(c)}</li>`).join('') || '<li>Initial version</li>'}</ul></div>
          <div class="field"><label for="sv-label">${isRev ? 'Revision title' : 'Version name'}</label><input id="sv-label" class="input" value="${esc(last ? autoLabel(diff) : 'Initial diagram')}" autofocus></div>
          ${isRev ? `<div class="field"><label for="sv-by">Requested by</label><input id="sv-by" class="input" value="${esc(project().supervisor || '')}" placeholder="e.g. Dr. Ahmed"></div>` : ''}
          <div class="field"><label for="sv-note">Note</label><textarea id="sv-note" class="textarea" rows="2" placeholder="${isRev ? 'e.g. Doctor requested renaming the analysis feature.' : 'Optional'}"></textarea></div>
        </div>`,
        footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-ok>${icon('save', 'icon-sm')} ${isRev ? 'Save revision' : 'Save version'}</button>`,
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
        subtitle: `${new Date(v.createdAt).toLocaleString('en-GB')}${v.requestedBy ? ` · Requested by ${v.requestedBy}` : ''}`,
        size: 'xl',
        body: `<div class="ed-version-view"><div class="thumb ed-version-thumb">${renderThumbnail(v.snapshot)}</div>
          <div class="ed-version-meta">${v.note ? `<p>${esc(v.note)}</p>` : ''}<div class="section-title">Changes in this version</div><ul class="ed-change-list">${(v.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div></div>`,
        footer: `<div class="left"><button class="btn" data-dl>${icon('export', 'icon-sm')} Download SVG</button></div><button class="btn" data-close>Close</button><button class="btn btn-primary" data-restore>${icon('history', 'icon-sm')} Restore this version</button>`,
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
      if (!confirmed && !(await confirmDialog({ title: `Restore v${v.number}?`, message: `The canvas will be replaced with <strong>v${v.number} — ${esc(v.label)}</strong>. Your current state is kept in the history, and you can undo.`, confirmText: 'Restore' }))) return;
      editor.replaceDiagram(v.snapshot);
      persist.cancel();
      store.update((p) => {
        const f = findFigure(p, figureId);
        f.diagram = clone(editor.doc);
        f.updatedAt = Date.now();
        addVersion(f, { label: `Restored v${v.number}`, kind: 'restore', force: true });
      }, { activity: { text: `Restored v${v.number} of “${getFigure().title}”`, kind: 'version', targetId: figureId }, source: 'editor-meta' });
      toast(`Restored v${v.number}`, { type: 'success', action: { label: 'Undo', onClick: () => editor.undo() } });
    }

    async function applyTemplate() {
      const f = getFigure();
      const t = getFigureType(f.type);
      if (!(await confirmDialog({ title: `Reset to the ${t.name} template?`, message: 'The current diagram will be replaced by the starter template. You can undo this or restore any saved version.', confirmText: 'Reset diagram' }))) return;
      editor.replaceDiagram(buildTemplate(f.type, project()));
      editor.fit({ maxZoom: 1 });
      toast('Template applied', { type: 'success', action: { label: 'Undo', onClick: () => editor.undo() } });
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
      banner.innerHTML = `${icon('flag')}<div class="grow"><strong>Revision mode</strong> — changes since v${last?.number ?? 0} are highlighted
        <span class="ed-legend"><i class="added"></i>added <i class="changed"></i>changed</span>
        <div class="ed-banner-changes truncate">${lines.length ? lines.map(esc).join(' · ') : 'No changes yet. Edit the figure as requested by your supervisor.'}</div></div>
        <button class="btn btn-sm btn-primary" data-action="save-revision" ${lines.length ? '' : 'disabled'}>${icon('save', 'icon-sm')} Save Revision</button>
        <button class="btn btn-sm btn-ghost" data-action="toggle-revision">Exit</button>`;
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
          toast('Image copied — paste it into Word with Ctrl+V', { type: 'success' });
          return;
        }
        toast(`Exported ${kind.toUpperCase()}`, { type: 'success', duration: 1800 });
      } catch (err) { toastError(err, 'Export failed'); }
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
      toast('Figure duplicated', { type: 'success' });
      ctx.navigate(ctx.href('figures', copy.id));
    }
    async function deleteFigure() {
      const f = getFigure();
      const info = getNumbering(project()).figures.get(figureId);
      if (!(await confirmDialog({ title: `Delete ${info?.label || 'figure'}?`, message: `“${esc(f.title)}” and its version history will be deleted. Later figures are renumbered automatically and references to it will show as broken.`, confirmText: 'Delete figure', danger: true }))) return;
      persist.cancel();
      deleted = true;
      store.update((p) => { p.figures = p.figures.filter((x) => x.id !== figureId); }, { activity: { text: `Deleted figure “${f.title}”`, kind: 'delete' } });
      toast('Figure deleted', { type: 'success' });
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
      else if (a === 'grid') editor.setGrid(!editor.grid);
      else if (a === 'snap') editor.setSnap(!editor.snap);
      else if (a === 'zoom-menu') openMenu(el, [50, 75, 100, 150, 200].map((z) => ({ label: `${z}%`, onClick: () => editor.setZoom(z / 100) })).concat(['-', { label: 'Fit to screen', icon: 'maximize', shortcut: '⇧1', onClick: () => editor.fit() }]));
      else if (a === 'toggle-revision') setRevisionMode(!revisionMode);
      else if (a === 'save-version') openSaveVersionDialog(revisionMode ? 'revision' : 'version');
      else if (a === 'toggle-left') root.dataset.panels = root.dataset.panels === 'left' ? '' : 'left';
      else if (a === 'toggle-right') root.dataset.panels = root.dataset.panels === 'right' ? '' : 'right';
      else if (a === 'export') {
        openMenu(el, [
          { heading: 'Download' },
          { label: 'SVG (vector, best for Word)', icon: 'image', onClick: () => doExport('svg') },
          { label: `PNG (${scale()}× · ${96 * scale()} DPI)`, icon: 'image', onClick: () => doExport('png') },
          { label: 'PDF', icon: 'fileText', onClick: () => doExport('pdf') },
          '-',
          { label: 'Copy image to clipboard', icon: 'clipboard', onClick: () => doExport('copy') },
        ], { align: 'end' });
      } else if (a === 'more') {
        openMenu(el, [
          { label: 'Duplicate figure', icon: 'duplicate', onClick: duplicateFigure },
          { label: 'Reset to template…', icon: 'wand', onClick: applyTemplate },
          { label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', onClick: async () => (await import('../../app/shortcuts.js')).showShortcutsHelp() },
          '-',
          { label: 'Delete figure', icon: 'trash', danger: true, onClick: deleteFigure },
        ], { align: 'end' });
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
        { label: 'Edit text', icon: 'edit', shortcut: 'Enter', onClick: () => editor.startTextEdit(element.id) },
        { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => editor.duplicateSelection() },
        { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => editor.copy() },
        '-',
        { label: 'Bring to front', icon: 'bringFront', onClick: () => editor.bringToFront() },
        { label: 'Send to back', icon: 'sendBack', onClick: () => editor.sendToBack() },
        ...(isEdge(element) ? ['-', { label: 'Reverse direction', icon: 'swap', onClick: () => editor.reverseSelectedEdges() },
          ...['straight', 'orthogonal', 'curved'].map((r) => ({ label: `${r[0].toUpperCase() + r.slice(1)} line`, icon: element.routing === r ? 'check' : 'line', onClick: () => editor.updateSelected((el) => { el.routing = r; }, { kind: 'edge' }) }))] : []),
        '-',
        { label: 'Add comment', icon: 'message', onClick: () => { activeTab = 'comments'; renderPanel(true); panel.querySelector('[data-comment-input]')?.focus(); } },
        { label: 'Delete', icon: 'trash', danger: true, shortcut: 'Del', onClick: () => editor.deleteSelection() },
      ] : [
        { label: 'Paste', icon: 'clipboard', shortcut: 'Ctrl+V', onClick: () => editor.paste() },
        { label: 'Add text here', icon: 'type', onClick: () => { const el = editor.addPreset({ shape: 'text', text: '' }, point); if (el) editor.startTextEdit(el.id); } },
        { label: 'Select all', icon: 'pointer', shortcut: 'Ctrl+A', onClick: () => editor.selectAll() },
        '-',
        { label: 'Fit to screen', icon: 'maximize', shortcut: '⇧1', onClick: () => editor.fit() },
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
      if (!getFigure()) { toast('This figure was deleted.', { type: 'warning' }); ctx.navigate(ctx.href('figures')); return; }
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
