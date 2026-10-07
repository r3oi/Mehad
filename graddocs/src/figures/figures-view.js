// Figures list: grouped by chapter in document order, live numbering,
// thumbnails, quick export and the "New Figure" template picker.
import { esc, on, flash } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { getNumbering, moveInDocumentOrder } from '../core/numbering.js';
import { createFigure, findFigure, walkSections } from '../core/model.js';
import { findUsages } from '../core/references.js';
import { relativeTime, clone, uid, slugify, downloadBlob, downloadText, plural } from '../core/utils.js';
import { renderThumbnail, renderFigureSVG } from './render.js';
import { figureTypes, getFigureType, buildTemplate } from './types.js';
import { addVersion, latestVersion, isDirty } from './versions.js';
import { svgToPngBlob, copyPngToClipboard } from '../export/png.js';
import { svgToPdfBlob } from '../export/pdf.js';
import { prefs } from '../app/prefs.js';

/** <option>s for chapter/section placement. value = 'ch:<id>' | 'sec:<id>' | '' */
export function locationOptions(project, selected = '') {
  const n = getNumbering(project);
  const out = [`<option value="" ${!selected ? 'selected' : ''}>Unassigned (numbered last)</option>`];
  for (const ch of project.chapters) {
    const ci = n.chapters.get(ch.id);
    out.push(`<option value="ch:${ch.id}" ${selected === `ch:${ch.id}` ? 'selected' : ''}>${esc(ci.label)}: ${esc(ch.title)}</option>`);
    walkSections({ chapters: [ch] }, (sec) => {
      const s = n.sections.get(sec.id);
      out.push(`<option value="sec:${sec.id}" ${selected === `sec:${sec.id}` ? 'selected' : ''}>${' '.repeat(s.depth)}${esc(s.number)} ${esc(sec.title)}</option>`);
    });
  }
  return out.join('');
}

export function parseLocation(project, value) {
  const [kind, id] = String(value || '').split(':');
  if (kind === 'sec') return { chapterId: getNumbering(project).sections.get(id)?.chapterId || null, sectionId: id };
  if (kind === 'ch') return { chapterId: id, sectionId: null };
  return { chapterId: null, sectionId: null };
}

const locationValue = (f) => (f.sectionId ? `sec:${f.sectionId}` : f.chapterId ? `ch:${f.chapterId}` : '');

/** Opens the New Figure dialog. Resolves with the created figure id (or null). */
export function openNewFigureDialog(store, { sectionId = null, type = 'flowchart' } = {}) {
  const project = store.project;
  const types = figureTypes();
  let selectedType = type;
  let titleTouched = false;
  const initialLoc = sectionId ? `sec:${sectionId}` : '';
  return new Promise((resolve) => {
    let created = null;
    const modal = openModal({
      title: 'New Figure',
      subtitle: 'Pick a diagram type — every template becomes fully editable shapes and connectors.',
      size: 'xl',
      body: `<div class="new-fig-layout">
        <div><div class="section-title">Diagram type</div><div class="type-gallery" role="listbox" aria-label="Diagram types">
          ${types.map((t) => `<button class="type-card ${t.id === selectedType ? 'active' : ''}" data-type="${t.id}" role="option" aria-selected="${t.id === selectedType}">
            <span class="type-icon">${icon(t.icon)}</span><strong>${esc(t.name)}</strong><span class="desc">${esc(t.description)}</span></button>`).join('')}
        </div></div>
        <div class="col" style="gap:14px">
          <div><div class="section-title">Template preview</div><div class="new-fig-preview" data-preview></div></div>
          <div class="field"><label for="nf-title">Figure title <span style="color:var(--danger)">*</span></label><input id="nf-title" class="input" autofocus></div>
          <div class="field"><label for="nf-loc">Chapter / section</label><select id="nf-loc" class="select">${locationOptions(project, initialLoc)}</select></div>
          <div class="field"><label for="nf-desc">Description</label><textarea id="nf-desc" class="textarea" rows="2" placeholder="Optional"></textarea></div>
          <div class="number-hint" data-number>${icon('info', 'icon-sm')}<span></span></div>
        </div>
      </div>`,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-create>Create figure</button>',
      onClose: () => resolve(created),
    });
    const titleEl = modal.$('#nf-title'); const locEl = modal.$('#nf-loc');
    const refresh = () => {
      const t = getFigureType(selectedType);
      if (!titleTouched) titleEl.value = t.name;
      modal.$('[data-preview]').innerHTML = renderThumbnail(buildTemplate(selectedType, project));
      const candidate = { id: '__new', title: titleEl.value || t.name, ...parseLocation(project, locEl.value) };
      const n = getNumbering({ ...project, figures: [...project.figures, candidate] }).figures.get('__new');
      const after = project.figures.length && n.index <= project.figures.length ? ` — figures after it are renumbered automatically` : '';
      modal.$('[data-number] span').textContent = `This will be ${n.label}${after}.`;
      modal.root.querySelectorAll('.type-card').forEach((c) => { const on = c.dataset.type === selectedType; c.classList.toggle('active', on); c.setAttribute('aria-selected', on); });
    };
    modal.root.querySelector('.type-gallery').addEventListener('click', (e) => {
      const card = e.target.closest('[data-type]');
      if (!card) return;
      selectedType = card.dataset.type;
      refresh();
    });
    titleEl.addEventListener('input', () => { titleTouched = true; refresh(); });
    locEl.addEventListener('change', refresh);
    const create = () => {
      const title = titleEl.value.trim();
      if (!title) { titleEl.classList.add('invalid'); titleEl.focus(); return; }
      const figure = createFigure({
        title, type: selectedType, description: modal.$('#nf-desc').value.trim(),
        diagram: buildTemplate(selectedType, project), ...parseLocation(project, locEl.value),
      });
      addVersion(figure, { force: true });
      store.update((p) => { p.figures.push(figure); }, { activity: { text: `Created figure “${title}”`, kind: 'create', targetId: figure.id } });
      created = figure.id;
      modal.close();
    };
    modal.$('[data-create]').addEventListener('click', create);
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    refresh();
  });
}

function fileBase(project, figure) {
  const info = getNumbering(project).figures.get(figure.id);
  return `Figure-${String(info?.number ?? 0).padStart(2, '0')}-${slugify(figure.title)}`;
}

export async function exportFigure(project, figure, kind) {
  try {
    const scale = Number(project.settings.figureDefaults?.exportScale) || 3;
    const transparent = project.settings.figureDefaults?.transparentBackground;
    if (kind === 'svg') { const { svg } = renderFigureSVG(figure, transparent ? { background: null } : {}); downloadText(svg, `${fileBase(project, figure)}.svg`, 'image/svg+xml'); }
    else if (kind === 'png') { const { svg, width, height } = renderFigureSVG(figure, transparent ? { background: null } : {}); downloadBlob(await svgToPngBlob(svg, width, height, { scale }), `${fileBase(project, figure)}.png`); }
    else if (kind === 'pdf') { const { svg, width, height } = renderFigureSVG(figure); downloadBlob(await svgToPdfBlob(svg, width, height, { scale, title: figure.title }), `${fileBase(project, figure)}.pdf`); }
    else if (kind === 'copy') {
      const { svg, width, height } = renderFigureSVG(figure);
      await copyPngToClipboard(await svgToPngBlob(svg, width, height, { scale }));
      toast('Image copied — paste it into Word with Ctrl+V', { type: 'success' });
      return;
    }
    toast(`Downloaded ${kind.toUpperCase()}`, { type: 'success', duration: 1600 });
  } catch (err) { toastError(err, 'Export failed'); }
}

export default {
  title: 'Figures',
  mount(container, ctx) {
    const { store, params } = ctx;
    let query = '';
    let chapterFilter = '';
    let typeFilter = '';
    let view = prefs.get('figuresView', 'grid');

    container.innerHTML = '<div class="page wide"><div data-root></div></div>';
    const root = container.querySelector('[data-root]');

    function render() {
      const project = store.project;
      const n = getNumbering(project);
      const ordered = n.figureOrder;
      const q = query.trim().toLowerCase();
      const visible = ordered.filter((f) => {
        const info = n.figures.get(f.id);
        if (chapterFilter === '__none' ? info.chapterId : chapterFilter && info.chapterId !== chapterFilter) return false;
        if (typeFilter && f.type !== typeFilter) return false;
        if (!q) return true;
        const texts = (f.diagram?.elements || []).map((el) => el.text || '').join(' ');
        return `${f.title} ${f.description} ${info.label} ${info.code} ${getFigureType(f.type).name} ${texts}`.toLowerCase().includes(q);
      });
      const groups = [];
      for (const f of visible) {
        const info = n.figures.get(f.id);
        const key = info.chapterId || '__none';
        let g = groups.find((x) => x.key === key);
        if (!g) {
          const ch = info.chapterId && project.chapters.find((c) => c.id === info.chapterId);
          g = { key, title: ch ? `${n.chapters.get(ch.id).label}: ${ch.title}` : 'Unassigned', items: [] };
          groups.push(g);
        }
        g.items.push(f);
      }

      const card = (f) => {
        const info = n.figures.get(f.id);
        const last = latestVersion(f);
        const openComments = f.comments.filter((c) => !c.resolved).length;
        const meta = `<span>${esc(info.location)}</span><span class="sep">·</span><span>Last modified: ${esc(relativeTime(f.updatedAt))}</span>`;
        const badges = `<span class="badge">${esc(getFigureType(f.type).name)}</span><span class="badge ${isDirty(f) ? 'badge-warning' : ''}" data-tip="${isDirty(f) ? 'Edited since the last saved version' : 'Latest version'}">v${last?.number ?? 0}${isDirty(f) ? '*' : ''}</span>${openComments ? `<span class="badge badge-warning">${icon('message')} ${openComments}</span>` : ''}`;
        const actions = `
          <a class="btn btn-sm btn-primary" href="${ctx.href('figures', f.id)}">${icon('edit', 'icon-sm')} Open</a>
          <button class="btn btn-sm" data-action="duplicate" data-id="${f.id}">${icon('duplicate', 'icon-sm')} Duplicate</button>
          <button class="btn btn-sm" data-action="export" data-id="${f.id}">${icon('export', 'icon-sm')} Export</button>
          <button class="btn btn-sm btn-ghost btn-icon" data-action="more" data-id="${f.id}" aria-label="More actions for ${esc(f.title)}">${icon('more')}</button>`;
        if (view === 'grid') {
          return `<article class="card fig-card" data-fig="${f.id}">
            <a class="thumb" href="${ctx.href('figures', f.id)}" aria-label="Open ${esc(f.title)}">${renderThumbnail(f)}</a>
            <div class="fig-card-body">
              <div class="fig-card-title"><span class="fig-num">#${info.index}</span><a class="truncate" href="${ctx.href('figures', f.id)}">${esc(f.title)}</a></div>
              <div class="fig-meta"><strong style="color:var(--text-2)">${esc(info.label)}</strong><span class="sep">·</span><span class="mono">${esc(info.code)}</span></div>
              <div class="fig-meta">${meta}</div>
              <div class="row-wrap" style="gap:5px;margin-top:4px">${badges}</div>
            </div>
            <div class="fig-card-actions">${actions}</div>
          </article>`;
        }
        return `<div class="list-item fig-row" data-fig="${f.id}">
          <a class="thumb" href="${ctx.href('figures', f.id)}" aria-label="Open ${esc(f.title)}">${renderThumbnail(f)}</a>
          <div class="grow" style="display:flex;flex-direction:column;gap:3px">
            <div class="title"><span class="fig-num">#${info.index}</span> <a href="${ctx.href('figures', f.id)}">${esc(f.title)}</a></div>
            <div class="fig-meta"><strong style="color:var(--text-2)">${esc(info.label)}</strong><span class="sep">·</span><span class="mono">${esc(info.code)}</span><span class="sep">·</span>${meta}</div>
            <div class="row-wrap" style="gap:5px">${badges}</div>
          </div>
          <div class="actions">${actions}</div>
        </div>`;
      };

      root.innerHTML = `
        <div class="page-header">
          <div class="titles"><h1>${icon('figure', 'icon-lg')} Figures <span class="badge">${project.figures.length}</span></h1>
            <p class="subtitle">Diagrams are numbered automatically in document order. Insert or move a figure and every number, list and reference updates.</p></div>
          <div class="actions"><button class="btn btn-primary" data-action="new">${icon('plus')} New Figure</button></div>
        </div>
        <div class="toolbar">
          <div class="input-group">${icon('search')}<input class="input" type="search" placeholder="Search figures…" value="${esc(query)}" data-search aria-label="Search figures"></div>
          <select class="select" style="width:auto" data-chapter aria-label="Filter by chapter">
            <option value="">All chapters</option>
            ${project.chapters.map((c) => `<option value="${c.id}" ${chapterFilter === c.id ? 'selected' : ''}>${esc(n.chapters.get(c.id).label)}: ${esc(c.title)}</option>`).join('')}
            <option value="__none" ${chapterFilter === '__none' ? 'selected' : ''}>Unassigned</option>
          </select>
          <select class="select" style="width:auto" data-type aria-label="Filter by type">
            <option value="">All types</option>
            ${figureTypes().map((t) => `<option value="${t.id}" ${typeFilter === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <span class="spacer"></span>
          <div class="segmented" role="group" aria-label="View">
            <button class="${view === 'grid' ? 'active' : ''}" data-view="grid" data-tip="Grid view" aria-label="Grid view">${icon('dashboard', 'icon-sm')}</button>
            <button class="${view === 'list' ? 'active' : ''}" data-view="list" data-tip="List view" aria-label="List view">${icon('menu', 'icon-sm')}</button>
          </div>
        </div>
        ${!project.figures.length ? `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('figure')}</div><h3>No figures yet</h3>
            <p>Create your first diagram from a template — flowcharts, UML, ERD, architecture, fishbone and more.</p>
            <button class="btn btn-primary" data-action="new">${icon('plus')} New Figure</button></div></div>`
          : !visible.length ? `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>No matching figures</h3><p>Try a different search or filter.</p></div></div>`
            : groups.map((g) => (view === 'grid'
              ? `<div class="section-title" style="margin:22px 0 10px">${esc(g.title)} · ${plural(g.items.length, 'figure')}</div><div class="fig-grid">${g.items.map(card).join('')}</div>`
              : `<div class="list" style="margin-bottom:16px"><div class="list-group-title">${esc(g.title)}</div>${g.items.map(card).join('')}</div>`)).join('')}`;
      const search = root.querySelector('[data-search]');
      if (focusSearch) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); focusSearch = false; }
    }
    let focusSearch = false;

    async function createNew(sectionId = null) {
      const id = await openNewFigureDialog(store, { sectionId });
      if (id) ctx.navigate(ctx.href('figures', id));
    }

    function duplicate(id) {
      const src = findFigure(store.project, id);
      const copy = clone(src);
      copy.id = uid('fig'); copy.title = `${src.title} (copy)`; copy.versions = []; copy.comments = [];
      copy.createdAt = copy.updatedAt = Date.now();
      addVersion(copy, { force: true });
      store.update((p) => { const i = p.figures.findIndex((f) => f.id === id); p.figures.splice(i + 1, 0, copy); }, { activity: { text: `Duplicated figure “${src.title}”`, kind: 'create', targetId: copy.id } });
      toast(`Duplicated as ${getNumbering(store.project).figures.get(copy.id).label}`, { type: 'success' });
      requestAnimationFrame(() => flash(root.querySelector(`[data-fig="${copy.id}"]`)));
    }

    async function remove(id) {
      const project = store.project;
      const f = findFigure(project, id);
      const info = getNumbering(project).figures.get(id);
      const usages = findUsages(project, 'fig', id);
      const ok = await confirmDialog({
        title: `Delete ${info.label}?`,
        message: `“${esc(f.title)}” will be deleted. Figures after it are renumbered automatically.${usages.length ? ` It is referenced in ${plural(usages.length, 'place')}; those references will show as broken.` : ''}`,
        confirmText: 'Delete', danger: true,
      });
      if (!ok) return;
      const index = project.figures.findIndex((x) => x.id === id);
      const backup = clone(f);
      store.update((p) => { p.figures = p.figures.filter((x) => x.id !== id); }, { activity: { text: `Deleted figure “${f.title}”`, kind: 'delete' } });
      toast(`Deleted “${f.title}”`, { type: 'success', action: { label: 'Undo', onClick: () => store.update((p) => { p.figures.splice(index, 0, backup); }, { activity: `Restored figure “${f.title}”` }) } });
    }

    function editDetails(id) {
      const project = store.project;
      const f = findFigure(project, id);
      const modal = openModal({
        title: 'Figure details', size: '',
        body: `<div class="form-grid">
          <div class="field"><label for="fd-title">Title</label><input id="fd-title" class="input" value="${esc(f.title)}" autofocus></div>
          <div class="field"><label for="fd-loc">Chapter / section</label><select id="fd-loc" class="select">${locationOptions(project, locationValue(f))}</select></div>
          <div class="field"><label for="fd-desc">Description</label><textarea id="fd-desc" class="textarea" rows="3">${esc(f.description || '')}</textarea></div>
        </div>`,
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-save>Save</button>',
      });
      modal.$('[data-save]').addEventListener('click', () => {
        const title = modal.$('#fd-title').value.trim();
        if (!title) { modal.$('#fd-title').classList.add('invalid'); return; }
        store.update((p) => {
          const x = findFigure(p, id);
          Object.assign(x, { title, description: modal.$('#fd-desc').value.trim(), ...parseLocation(p, modal.$('#fd-loc').value), updatedAt: Date.now() });
        }, { activity: { text: `Updated details of “${title}”`, targetId: id } });
        modal.close();
      });
    }

    const offs = [
      on(root, 'click', '[data-action]', (e, el) => {
        const { action, id } = el.dataset;
        const project = store.project;
        const f = id && findFigure(project, id);
        if (action === 'new') createNew();
        else if (action === 'duplicate') duplicate(id);
        else if (action === 'export') {
          openMenu(el, [
            { label: 'SVG (vector)', icon: 'image', onClick: () => exportFigure(store.project, f, 'svg') },
            { label: 'PNG (high resolution)', icon: 'image', onClick: () => exportFigure(store.project, f, 'png') },
            { label: 'PDF', icon: 'fileText', onClick: () => exportFigure(store.project, f, 'pdf') },
            '-',
            { label: 'Copy image', icon: 'clipboard', onClick: () => exportFigure(store.project, f, 'copy') },
          ]);
        } else if (action === 'more') {
          openMenu(el, [
            { label: 'Open editor', icon: 'edit', onClick: () => ctx.navigate(ctx.href('figures', id)) },
            { label: 'Edit details', icon: 'settings', onClick: () => editDetails(id) },
            { label: 'Revision mode', icon: 'flag', onClick: () => ctx.navigate(ctx.href('figures', id, { revision: '1' })) },
            '-',
            { label: 'Move up', icon: 'arrowUp', onClick: () => move(id, -1) },
            { label: 'Move down', icon: 'arrowDown', onClick: () => move(id, 1) },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(id) },
          ], { align: 'end' });
        }
      }),
      on(root, 'click', '[data-view]', (e, el) => { view = el.dataset.view; prefs.set('figuresView', view); render(); }),
      on(root, 'input', '[data-search]', (e, el) => { query = el.value; focusSearch = true; render(); }),
      on(root, 'change', '[data-chapter]', (e, el) => { chapterFilter = el.value; render(); }),
      on(root, 'change', '[data-type]', (e, el) => { typeFilter = el.value; render(); }),
      store.on('change', () => { if (!root.contains(document.activeElement) || !document.activeElement.matches('[data-search]')) render(); }),
    ];

    function move(id, dir) {
      let moved = false;
      store.update((p) => { moved = moveInDocumentOrder(p, 'figures', id, dir); }, { activity: 'Reordered figures', save: true });
      if (!moved) toast('A figure can only move before or after figures in the same section. Change its section to move it further.', { type: 'info' });
      else requestAnimationFrame(() => flash(root.querySelector(`[data-fig="${id}"]`)));
    }

    render();
    if (params.query?.new === '1') {
      history.replaceState(null, '', ctx.href('figures'));
      createNew(params.query.section || null);
    }
    return { unmount() { offs.forEach((off) => off()); } };
  },
};
