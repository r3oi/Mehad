// Figures list: grouped by chapter in document order, live numbering,
// thumbnails, quick export and the "New Figure" template picker.
import { esc, on, flash } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { getNumbering, moveInDocumentOrder } from '../core/numbering.js';
import { createFigure, findFigure, walkSections } from '../core/model.js';
import { findUsages, clearPlacement } from '../core/references.js';
import { relativeTime, clone, uid, slugify, downloadBlob, downloadText, plural, pickFile } from '../core/utils.js';
import { renderThumbnail, renderFigureSVG } from './render.js';
import { figureTypes, getFigureType, buildTemplate, figureFonts } from './types.js';
import { screenshotDiagram } from './templates/index.js';
import { IMAGE_ACCEPT, isImageFile, imageFromFile, titleFromFileName, lightDiagram } from './editor/image-import.js';
import { addVersion, latestVersion, isDirty } from './versions.js';
import { svgToPngBlob, copyPngToClipboard } from '../export/png.js';
import { svgToPdfBlob } from '../export/pdf.js';
import { ganttDiagram } from './gantt/gantt-model.js';
import { sampleGantt } from './gantt/gantt-sample.js';
import { prefs } from '../app/prefs.js';
import { t, isRTL } from '../i18n/index.js';

// Menus anchor to a physical edge: the end of the row is on the left in Arabic.
const MENU_END = isRTL ? 'start' : 'end';
// User-typed text (titles, descriptions) picks its own direction in Arabic mode.
const AUTO = isRTL ? ' dir="auto"' : '';
/** "3 figures" in English; a grammar-safe "Figures: 3" pattern in Arabic. */
const figuresCount = (n) => (isRTL ? t('Figures: {n}', { n }) : plural(n, 'figure'));

/** <option>s for chapter/section placement. value = 'ch:<id>' | 'sec:<id>' | '' */
export function locationOptions(project, selected = '') {
  const n = getNumbering(project);
  const out = [`<option value="" ${!selected ? 'selected' : ''}>${t('Unassigned (numbered last)')}</option>`];
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

/** Thumbnail markup of a figure (pictures are drawn from light blob: URLs, not the full data URLs). */
const thumbOf = (figure) => renderThumbnail(lightDiagram(figure.diagram));

/** Opens the New Figure dialog. Resolves with the created figure id (or null). */
export function openNewFigureDialog(store, { sectionId = null, chapterId = null, type = 'flowchart' } = {}) {
  const project = store.project;
  const types = figureTypes();
  let selectedType = type;
  let titleTouched = false;
  const initialLoc = sectionId ? `sec:${sectionId}` : chapterId ? `ch:${chapterId}` : '';
  return new Promise((resolve) => {
    let created = null;
    const modal = openModal({
      title: t('New Figure'),
      subtitle: t('Pick a diagram type — every template becomes fully editable shapes and connectors.'),
      size: 'xl',
      body: `<div class="new-fig-layout">
        <div><div class="section-title">${t('Diagram type')}</div><div class="type-gallery" role="listbox" aria-label="${t('Diagram types')}">
          ${types.map((ft) => `<button class="type-card ${ft.id === selectedType ? 'active' : ''}" data-type="${ft.id}" role="option" aria-selected="${ft.id === selectedType}">
            <span class="type-icon">${icon(ft.icon)}</span><strong>${esc(ft.name)}</strong><span class="desc">${esc(ft.description)}</span></button>`).join('')}
        </div></div>
        <div class="col" style="gap:14px">
          <div class="nf-sources">
            <button type="button" class="btn btn-soft nf-generate" data-generate>${icon('sparkles', 'icon-sm')} ${t('Generate from description')}</button>
            <button type="button" class="btn btn-soft nf-generate" data-convert>${icon('wand', 'icon-sm')} ${t('Editable diagram from a picture')}</button>
            <button type="button" class="btn btn-soft nf-generate" data-image>${icon('image', 'icon-sm')} ${t('From image (screenshot)')}</button>
          </div>
          <div><div class="section-title" data-preview-title>${t('Template preview')}</div><div class="new-fig-preview" data-preview></div></div>
          <div class="field"><label for="nf-title">${t('Figure title')} <span style="color:var(--danger)">*</span></label><input id="nf-title" class="input" autofocus${AUTO}></div>
          <div class="field"><label for="nf-loc">${t('Chapter / section')}</label><select id="nf-loc" class="select">${locationOptions(project, initialLoc)}</select></div>
          <div class="field"><label for="nf-desc">${t('Description')}</label><textarea id="nf-desc" class="textarea" rows="2" placeholder="${t('Optional')}"${AUTO}></textarea></div>
          <div class="number-hint" data-number>${icon('info', 'icon-sm')}<span></span></div>
        </div>
      </div>`,
      footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-create>${t('Create figure')}</button>`,
      onClose: () => resolve(created),
    });
    const titleEl = modal.$('#nf-title'); const locEl = modal.$('#nf-loc');
    let generated = null; // a diagram made with "Generate from description" (replaces the template)
    let picture = null; // { diagram, title }: a screenshot / image chosen with "From image (screenshot)"
    const previewEl = modal.$('[data-preview]');
    const refresh = () => {
      const ft = getFigureType(selectedType);
      if (!titleTouched) titleEl.value = picture?.title || generated?.title || ft.defaultTitle;
      modal.$('[data-preview-title]').textContent = picture ? t('Your image — pick a type to start from a template instead')
        : generated ? t('Generated diagram — pick a type to start from a template instead') : t('Template preview');
      previewEl.innerHTML = picture ? thumbOf(picture)
        : generated ? renderThumbnail(generated.diagram)
          : selectedType === 'screenshot'
            ? `<button type="button" class="nf-drop" data-image>${icon('upload')}<strong>${t('Choose an image…')}</strong><span>${t('PNG, JPG, WebP, GIF or SVG — or drop the file here')}</span></button>`
            : renderThumbnail(buildTemplate(selectedType, project));
      const candidate = { id: '__new', title: titleEl.value || ft.defaultTitle, ...parseLocation(project, locEl.value) };
      const n = getNumbering({ ...project, figures: [...project.figures, candidate] }).figures.get('__new');
      const renumbers = project.figures.length && n.index <= project.figures.length;
      modal.$('[data-number] span').textContent = renumbers
        ? t('This will be {label} — figures after it are renumbered automatically.', { label: n.label })
        : t('This will be {label}.', { label: n.label });
      modal.root.querySelectorAll('.type-card').forEach((c) => { const on = c.dataset.type === selectedType; c.classList.toggle('active', on); c.setAttribute('aria-selected', on); });
    };
    modal.root.querySelector('.type-gallery').addEventListener('click', (e) => {
      const card = e.target.closest('[data-type]');
      if (!card) return;
      selectedType = card.dataset.type;
      generated = null; picture = null;
      refresh();
    });
    // "Generate from description" / "Editable diagram from a picture": both open the generator (text or image tab).
    const generate = async (tab) => {
      const { openGenerateDialog } = await import('./generate/generate-dialog.js');
      const result = await openGenerateDialog({ project, mode: 'new', tab });
      if (!result) return;
      generated = result; picture = null;
      selectedType = result.type;
      refresh();
    };
    modal.$('[data-generate]').addEventListener('click', () => generate('ai'));
    modal.$('[data-convert]').addEventListener('click', () => generate('image'));
    // Screenshot / image: pick a file (or drop one on the preview) → a figure that is one picture.
    const usePicture = async (file) => {
      if (!file) return;
      if (!isImageFile(file)) { toast(t('Choose an image file (PNG, JPG, WebP, GIF or SVG).'), { type: 'warning' }); return; }
      try {
        const img = await imageFromFile(file);
        picture = { diagram: screenshotDiagram(figureFonts(project), img), title: titleFromFileName(file.name) || getFigureType('screenshot').defaultTitle };
        generated = null; selectedType = 'screenshot';
        refresh();
      } catch (err) { toastError(err, t('Could not read the image')); }
    };
    modal.root.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-image]')) return;
      e.preventDefault();
      await usePicture(await pickFile(IMAGE_ACCEPT));
    });
    previewEl.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); previewEl.classList.add('dropping'); } });
    previewEl.addEventListener('dragleave', () => previewEl.classList.remove('dropping'));
    previewEl.addEventListener('drop', (e) => {
      previewEl.classList.remove('dropping');
      const file = [...(e.dataTransfer?.files || [])][0];
      if (file) { e.preventDefault(); usePicture(file); }
    });
    titleEl.addEventListener('input', () => { titleTouched = true; refresh(); });
    locEl.addEventListener('change', refresh);
    const create = () => {
      const title = titleEl.value.trim();
      if (!title) { titleEl.classList.add('invalid'); titleEl.focus(); return; }
      const figure = createFigure({
        title, type: selectedType, description: modal.$('#nf-desc').value.trim(),
        diagram: picture ? picture.diagram : generated ? generated.diagram : buildTemplate(selectedType, project), ...parseLocation(project, locEl.value),
      });
      if (selectedType === 'gantt' && !picture && !generated) { // a Gantt chart keeps its schedule as data; the picture is rebuilt from it
        figure.gantt = sampleGantt();
        figure.diagram = ganttDiagram(figure.gantt, figureFonts(project));
      }
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
      toast(t('Image copied — paste it into Word with Ctrl+V'), { type: 'success' });
      return;
    }
    toast(t('Downloaded {kind}', { kind: kind.toUpperCase() }), { type: 'success', duration: 1600 });
  } catch (err) { toastError(err, t('Export failed')); }
}

export default {
  title: 'Figures', // translated by the shell
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
          g = { key, title: ch ? `${n.chapters.get(ch.id).label}: ${ch.title}` : t('Unassigned'), items: [] };
          groups.push(g);
        }
        g.items.push(f);
      }

      const card = (f) => {
        const info = n.figures.get(f.id);
        const last = latestVersion(f);
        const openComments = f.comments.filter((c) => !c.resolved).length;
        const meta = `<span>${esc(info.location)}</span><span class="sep">·</span><span>${esc(t('Last modified: {time}', { time: relativeTime(f.updatedAt) }))}</span>`;
        const badges = `<span class="badge">${esc(getFigureType(f.type).name)}</span><span class="badge ${isDirty(f) ? 'badge-warning' : ''}" data-tip="${isDirty(f) ? t('Edited since the last saved version') : t('Latest version')}">v${last?.number ?? 0}${isDirty(f) ? '*' : ''}</span>${openComments ? `<span class="badge badge-warning">${icon('message')} ${openComments}</span>` : ''}`;
        const link = editHref(f);
        const actions = `
          <a class="btn btn-sm btn-primary" href="${link}">${icon('edit', 'icon-sm')} ${t('Open')}</a>
          <button class="btn btn-sm" data-action="duplicate" data-id="${f.id}">${icon('duplicate', 'icon-sm')} ${t('Duplicate')}</button>
          <button class="btn btn-sm" data-action="export" data-id="${f.id}">${icon('export', 'icon-sm')} ${t('Export')}</button>
          <button class="btn btn-sm btn-ghost btn-icon" data-action="more" data-id="${f.id}" aria-label="${esc(t('More actions for {title}', { title: f.title }))}">${icon('more')}</button>`;
        if (view === 'grid') {
          return `<article class="card fig-card" data-fig="${f.id}">
            <a class="thumb" href="${link}" aria-label="${esc(t('Open {title}', { title: f.title }))}">${thumbOf(f)}</a>
            <div class="fig-card-body">
              <div class="fig-card-title"><span class="fig-num">#${info.index}</span><a class="truncate" href="${link}">${esc(f.title)}</a></div>
              <div class="fig-meta"><strong style="color:var(--text-2)">${esc(info.label)}</strong><span class="sep">·</span><span class="mono">${esc(info.code)}</span></div>
              <div class="fig-meta">${meta}</div>
              <div class="row-wrap" style="gap:5px;margin-top:4px">${badges}</div>
            </div>
            <div class="fig-card-actions">${actions}</div>
          </article>`;
        }
        return `<div class="list-item fig-row" data-fig="${f.id}">
          <a class="thumb" href="${link}" aria-label="${esc(t('Open {title}', { title: f.title }))}">${thumbOf(f)}</a>
          <div class="grow" style="display:flex;flex-direction:column;gap:3px">
            <div class="title"><span class="fig-num">#${info.index}</span> <a href="${link}">${esc(f.title)}</a></div>
            <div class="fig-meta"><strong style="color:var(--text-2)">${esc(info.label)}</strong><span class="sep">·</span><span class="mono">${esc(info.code)}</span><span class="sep">·</span>${meta}</div>
            <div class="row-wrap" style="gap:5px">${badges}</div>
          </div>
          <div class="actions">${actions}</div>
        </div>`;
      };

      root.innerHTML = `
        <div class="page-header">
          <div class="titles"><h1>${icon('figure', 'icon-lg')} ${t('Figures')} <span class="badge">${project.figures.length}</span></h1>
            <p class="subtitle">${t('Diagrams are numbered automatically in document order. Insert or move a figure and every number, list and reference updates.')}</p></div>
          <div class="actions"><button class="btn btn-primary" data-action="new">${icon('plus')} ${t('New Figure')}</button></div>
        </div>
        <div class="toolbar">
          <div class="input-group">${icon('search')}<input class="input" type="search" placeholder="${t('Search figures…')}" value="${esc(query)}" data-search aria-label="${t('Search figures')}"></div>
          <select class="select" style="width:auto" data-chapter aria-label="${t('Filter by chapter')}">
            <option value="">${t('All chapters')}</option>
            ${project.chapters.map((c) => `<option value="${c.id}" ${chapterFilter === c.id ? 'selected' : ''}>${esc(n.chapters.get(c.id).label)}: ${esc(c.title)}</option>`).join('')}
            <option value="__none" ${chapterFilter === '__none' ? 'selected' : ''}>${t('Unassigned')}</option>
          </select>
          <select class="select" style="width:auto" data-type aria-label="${t('Filter by type')}">
            <option value="">${t('All types')}</option>
            ${figureTypes().map((ft) => `<option value="${ft.id}" ${typeFilter === ft.id ? 'selected' : ''}>${esc(ft.name)}</option>`).join('')}
          </select>
          <span class="spacer"></span>
          <div class="segmented" role="group" aria-label="${t('View')}">
            <button class="${view === 'grid' ? 'active' : ''}" data-view="grid" data-tip="${t('Grid view')}" aria-label="${t('Grid view')}">${icon('dashboard', 'icon-sm')}</button>
            <button class="${view === 'list' ? 'active' : ''}" data-view="list" data-tip="${t('List view')}" aria-label="${t('List view')}">${icon('menu', 'icon-sm')}</button>
          </div>
        </div>
        ${!project.figures.length ? `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('figure')}</div><h3>${t('No figures yet')}</h3>
            <p>${t('Create your first diagram from a template — flowcharts, UML, ERD, architecture, fishbone and more.')}</p>
            <button class="btn btn-primary" data-action="new">${icon('plus')} ${t('New Figure')}</button></div></div>`
          : !visible.length ? `<div class="card"><div class="empty-state"><div class="empty-icon">${icon('search')}</div><h3>${t('No matching figures')}</h3><p>${t('Try a different search or filter.')}</p></div></div>`
            : groups.map((g) => (view === 'grid'
              ? `<div class="section-title" style="margin:22px 0 10px">${esc(g.title)} · ${figuresCount(g.items.length)}</div><div class="fig-grid">${g.items.map(card).join('')}</div>`
              : `<div class="list" style="margin-bottom:16px"><div class="list-group-title">${esc(g.title)}</div>${g.items.map(card).join('')}</div>`)).join('')}`;
      const search = root.querySelector('[data-search]');
      if (focusSearch) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); focusSearch = false; }
    }
    let focusSearch = false;
    /** Where a figure is edited: Gantt charts have their own editor (tasks and dates), everything else the canvas. */
    const editHref = (f) => (f.type === 'gantt' && f.gantt ? ctx.href('gantt', f.id) : ctx.href('figures', f.id));

    async function createNew(sectionId = null, chapterId = null) {
      const id = await openNewFigureDialog(store, { sectionId, chapterId });
      if (id) ctx.navigate(editHref(findFigure(store.project, id) || { id }));
    }

    function duplicate(id) {
      const src = findFigure(store.project, id);
      const copy = clone(src);
      copy.id = uid('fig'); copy.title = `${src.title} (copy)`; copy.versions = []; copy.comments = []; delete copy.imagePool;
      copy.createdAt = copy.updatedAt = Date.now();
      addVersion(copy, { force: true });
      store.update((p) => { const i = p.figures.findIndex((f) => f.id === id); p.figures.splice(i + 1, 0, copy); }, { activity: { text: `Duplicated figure “${src.title}”`, kind: 'create', targetId: copy.id } });
      toast(t('Duplicated as {label}', { label: getNumbering(store.project).figures.get(copy.id).label }), { type: 'success' });
      requestAnimationFrame(() => flash(root.querySelector(`[data-fig="${copy.id}"]`)));
    }

    async function remove(id) {
      const project = store.project;
      const f = findFigure(project, id);
      const info = getNumbering(project).figures.get(id);
      const usages = findUsages(project, 'fig', id);
      const ok = await confirmDialog({
        title: t('Delete {label}?', { label: info.label }),
        message: `${t('“{title}” will be deleted. Figures after it are renumbered automatically.', { title: esc(f.title) })}${usages.length ? ` ${isRTL ? t('It is referenced in {n} places; those references will show as broken.', { n: usages.length }) : t('It is referenced in {places}; those references will show as broken.', { places: plural(usages.length, 'place') })}` : ''}`,
        confirmText: t('Delete'), danger: true,
      });
      if (!ok) return;
      const index = project.figures.findIndex((x) => x.id === id);
      const backup = clone(f);
      store.update((p) => { p.figures = p.figures.filter((x) => x.id !== id); clearPlacement(p, 'figure', id); }, { activity: { text: `Deleted figure “${f.title}”`, kind: 'delete' } });
      toast(t('Deleted “{title}”', { title: f.title }), { type: 'success', action: { label: t('Undo'), onClick: () => store.update((p) => { p.figures.splice(index, 0, backup); }, { activity: `Restored figure “${f.title}”` }) } });
    }

    function editDetails(id) {
      const project = store.project;
      const f = findFigure(project, id);
      const modal = openModal({
        title: t('Figure details'), size: '',
        body: `<div class="form-grid">
          <div class="field"><label for="fd-title">${t('Title')}</label><input id="fd-title" class="input" value="${esc(f.title)}" autofocus${AUTO}></div>
          <div class="field"><label for="fd-loc">${t('Chapter / section')}</label><select id="fd-loc" class="select">${locationOptions(project, locationValue(f))}</select></div>
          <div class="field"><label for="fd-desc">${t('Description')}</label><textarea id="fd-desc" class="textarea" rows="3"${AUTO}>${esc(f.description || '')}</textarea></div>
        </div>`,
        footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-save>${t('Save')}</button>`,
      });
      modal.$('[data-save]').addEventListener('click', () => {
        const title = modal.$('#fd-title').value.trim();
        if (!title) { modal.$('#fd-title').classList.add('invalid'); return; }
        store.update((p) => {
          const x = findFigure(p, id);
          const loc = parseLocation(p, modal.$('#fd-loc').value);
          if (loc.chapterId !== x.chapterId || loc.sectionId !== x.sectionId) clearPlacement(p, 'figure', id);
          Object.assign(x, { title, description: modal.$('#fd-desc').value.trim(), ...loc, updatedAt: Date.now() });
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
            { label: t('SVG (vector)'), icon: 'image', onClick: () => exportFigure(store.project, f, 'svg') },
            { label: t('PNG (high resolution)'), icon: 'image', onClick: () => exportFigure(store.project, f, 'png') },
            { label: t('PDF'), icon: 'fileText', onClick: () => exportFigure(store.project, f, 'pdf') },
            '-',
            { label: t('Copy image'), icon: 'clipboard', onClick: () => exportFigure(store.project, f, 'copy') },
          ]);
        } else if (action === 'more') {
          openMenu(el, [
            { label: t('Open editor'), icon: 'edit', onClick: () => ctx.navigate(editHref(f)) },
            { label: t('Edit details'), icon: 'settings', onClick: () => editDetails(id) },
            ...(f.type === 'gantt' && f.gantt ? [] : [{ label: t('Revision mode'), icon: 'flag', onClick: () => ctx.navigate(ctx.href('figures', id, { revision: '1' })) }]),
            '-',
            { label: t('Move up'), icon: 'arrowUp', onClick: () => move(id, -1) },
            { label: t('Move down'), icon: 'arrowDown', onClick: () => move(id, 1) },
            '-',
            { label: t('Delete'), icon: 'trash', danger: true, onClick: () => remove(id) },
          ], { align: MENU_END });
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
      if (!moved) toast(t('A figure can only move before or after figures in the same section. Change its section to move it further.'), { type: 'info' });
      else requestAnimationFrame(() => flash(root.querySelector(`[data-fig="${id}"]`)));
    }

    render();
    if (params.query?.new === '1') {
      history.replaceState(null, '', ctx.href('figures'));
      createNew(params.query.section || null, params.query.chapter || null);
    }
    return { unmount() { offs.forEach((off) => off()); } };
  },
};
