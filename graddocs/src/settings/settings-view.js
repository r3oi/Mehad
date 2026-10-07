// Settings (#/p/<id>/settings): Document | Captions | Figures | Project | Storage.
// Every control writes straight to project.settings through store.update, so
// numbering, preview and exports follow immediately.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { getNumbering, captionText } from '../core/numbering.js';
import { renderThumbnail } from '../figures/render.js';
import { formatBytes, formatDateTime, downloadText, slugify } from '../core/utils.js';
import { projectDetailFields } from '../projects/projects-view.js';

const TABS = [
  { id: 'document', label: 'Document', icon: 'file' },
  { id: 'captions', label: 'Captions', icon: 'figure' },
  { id: 'figures', label: 'Figures', icon: 'diagram' },
  { id: 'project', label: 'Project', icon: 'folder' },
  { id: 'storage', label: 'Storage', icon: 'database' },
];
const SETTINGS_TABS = new Set(['document', 'captions', 'figures']);
const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia'];
const SEPARATORS = [[':', 'Colon', ':'], ['.', 'Period', '.'], [' —', 'Em dash', ' —'], [' -', 'Hyphen', ' -']];
const separatorOptions = (label) => SEPARATORS.map(([value, name, sep]) => [value, `${name}  ( ${label} 1${sep} Title )`]);
const ENGINES = {
  localStorage: { label: 'Browser localStorage', short: 'localStorage', desc: 'Simple and fast. The browser limits it to roughly 5–10 MB in total, which is enough for most text-heavy projects.' },
  indexedDB: { label: 'IndexedDB', short: 'IndexedDB', desc: 'Recommended for large projects with many figures and versions. Much higher storage limit.' },
};

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; return o[k]; }, obj);
  target[last] = value;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const round = (v) => Math.round(v * 100) / 100;

// ----- Control builders -----------------------------------------------------
const row = (title, desc, control, cls = '') => `
  <div class="set-row ${cls}">
    <div class="set-label"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>
    <div class="set-control">${control}</div>
  </div>`;

const card = (title, desc, body, extra = '') => `
  <section class="card set-card ${extra}">
    <div class="card-header"><div class="grow"><h3>${title}</h3>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div></div>
    <div class="set-rows">${body}</div>
  </section>`;

const seg = (path, value, options, { numeric = false, label = '' } = {}) => `
  <div class="segmented" role="group" aria-label="${esc(label || path)}">${options.map(([v, l]) => `
    <button type="button" data-path="${path}" data-value="${esc(v)}" ${numeric ? 'data-type="number"' : ''} class="${String(v) === String(value) ? 'active' : ''}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}
  </div>`;

const num = (path, value, { min, max, step = 1, unit = '', label = '' }) => `
  <div class="num-field"><input class="input input-sm" type="number" inputmode="decimal" data-path="${path}" data-kind="number"
    min="${min}" max="${max}" step="${step}" value="${esc(value)}" aria-label="${esc(label || path)}"><span class="unit">${esc(unit)}</span></div>`;

const select = (path, value, options, { numeric = false, label = '' } = {}) => {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (!opts.some(([v]) => String(v) === String(value))) opts.push([value, String(value)]);
  return `<select class="select input-sm" data-path="${path}" ${numeric ? 'data-type="number"' : ''} aria-label="${esc(label || path)}">${opts.map(([v, l]) => `
    <option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
};

const toggle = (path, checked, label) => `
  <label class="switch"><input type="checkbox" data-path="${path}" data-kind="bool" ${checked ? 'checked' : ''}><span class="track"></span><span>${esc(label)}</span></label>`;

const text = (path, value, { placeholder = '', label = '' } = {}) => `
  <input class="input input-sm" type="text" data-path="${path}" data-kind="text" data-required value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="40" aria-label="${esc(label || path)}">`;

// ----- Previews -------------------------------------------------------------
function pagePreview(s) {
  let [w, h] = s.page.size === 'Letter' ? [21.59, 27.94] : [21, 29.7];
  if (s.page.orientation === 'landscape') [w, h] = [h, w];
  const long = 168;
  const pw = Math.round((w / Math.max(w, h)) * long);
  const ph = Math.round((h / Math.max(w, h)) * long);
  const m = s.page.margins;
  const pct = (v, total) => `${Math.min(45, Math.max(0, (v / total) * 100)).toFixed(2)}%`;
  return `
    <div class="pg-wrap">
      <div class="pg" style="width:${pw}px;height:${ph}px">
        <div class="pg-inner" style="top:${pct(m.top, h)};bottom:${pct(m.bottom, h)};left:${pct(m.left, w)};right:${pct(m.right, w)}"></div>
      </div>
      <div class="pg-caption">${esc(s.page.size)} · ${esc(cap(s.page.orientation))} · ${w} × ${h} cm</div>
    </div>`;
}

function typographyPreview(s) {
  const t = s.typography;
  const k = 0.78; // scale pt down to fit the narrow preview card
  const pt = (v) => `${round(v * k)}pt`;
  const heading = s.chapterTitle.style === 'upper' ? 'CHAPTER 1: INTRODUCTION' : 'Chapter 1: Introduction';
  const p = `margin:0 0 ${pt(t.paragraphSpacing)};text-align:${t.justify ? 'justify' : 'left'}`;
  return `
    <div class="typo-page" style="font-family:'${esc(t.fontFamily)}',serif;font-size:${pt(t.fontSize)};line-height:${t.lineSpacing}">
      <div style="font-size:${pt(t.headingSizes.h1)};font-weight:700;text-align:center;line-height:1.25;margin-bottom:${pt(10)}">${heading}</div>
      <div style="font-size:${pt(t.headingSizes.h2)};font-weight:700;line-height:1.25;margin-bottom:${pt(6)}">1.1 Introduction</div>
      <p style="${p}">This project presents a secure platform for storing, analysing and reporting on project data, designed for students and researchers.</p>
      <div style="font-size:${pt(t.headingSizes.h3)};font-weight:700;line-height:1.25;margin-bottom:${pt(4)}">1.1.1 Aims</div>
      <p style="${p}">The aim is to provide role-based access to datasets and built-in analysis so teams can work in one place.</p>
    </div>`;
}

function captionPreview(project, kind) {
  const s = project.settings;
  const cfg = s.captions[kind];
  const n = getNumbering(project);
  const first = (kind === 'figure' ? n.figureOrder : n.tableOrder)[0];
  let full; let title;
  if (first) {
    title = first.title || '';
    full = captionText(project, kind, first);
  } else {
    title = kind === 'figure' ? 'System Architecture' : 'Functional Requirements';
    full = `${cfg.label} ${cfg.numbering === 'chapter' ? '1.1' : '1'}${cfg.separator} ${title}`;
  }
  const prefix = full.slice(0, full.length - title.length);
  const caption = `<div class="cap-text" style="text-align:${cfg.align};font-family:'${esc(s.typography.fontFamily)}',serif;font-size:${Math.min(s.typography.fontSize, 14)}pt">
      <span style="font-weight:${cfg.labelBold ? 700 : 400}">${esc(prefix)}</span><span style="font-style:${cfg.titleItalic ? 'italic' : 'normal'}">${esc(title)}</span></div>`;
  const object = kind === 'figure'
    ? `<div class="thumb cap-object">${first ? renderThumbnail(first) : icon('figure', 'icon-lg')}</div>`
    : `<div class="cap-object cap-table"><table><thead><tr><th>ID</th><th>Requirement</th><th>Priority</th></tr></thead><tbody><tr><td>F-1</td><td>User login</td><td>High</td></tr><tr><td>F-2</td><td>Upload dataset</td><td>Medium</td></tr></tbody></table></div>`;
  return `<div class="cap-page">${cfg.position === 'above' ? `${caption}${object}` : `${object}${caption}`}</div>
    <div class="cap-note">${first ? `Preview uses “${esc(first.title)}”.` : 'Preview uses sample content. Add a figure or table to see your own.'}</div>`;
}

// ---------------------------------------------------------------------------

export default {
  title: 'Settings',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;
    let tab = TABS.some((t) => t.id === ctx.params?.query?.tab) ? ctx.params.query.tab : 'document';
    let storageToken = 0;
    let backups = [];

    container.innerHTML = `
      <div class="page set-page">
        <div class="page-header">
          <div class="titles">
            <h1>Settings</h1>
            <p class="subtitle set-saved">${icon('checkCircle', 'icon-sm')}Changes are saved automatically</p>
          </div>
        </div>
        <div class="tabs set-tabs" role="tablist" aria-label="Settings sections"></div>
        <div class="set-panel" role="tabpanel"></div>
      </div>`;
    const tabsEl = container.querySelector('.set-tabs');
    const panel = container.querySelector('.set-panel');

    const renderTabs = () => {
      tabsEl.innerHTML = TABS.map((t) => `
        <button class="tab ${t.id === tab ? 'active' : ''}" role="tab" aria-selected="${t.id === tab}" data-tab="${t.id}">${icon(t.icon, 'icon-sm')}${t.label}</button>`).join('');
      // On narrow screens the tab strip scrolls; keep the active tab visible.
      const active = tabsEl.querySelector('.tab.active');
      if (active && tabsEl.scrollWidth > tabsEl.clientWidth) tabsEl.scrollLeft = Math.max(0, active.offsetLeft - (tabsEl.clientWidth - active.offsetWidth) / 2);
    };

    // ----- Tab renderers ------------------------------------------------------
    const documentTab = (s) => `
      <div class="set-split">
        <div class="set-main">
          ${card('Page', 'Paper size, orientation and margins.', `
            ${row('Page size', 'Paper format for preview and Word export.', seg('page.size', s.page.size, [['A4', 'A4'], ['Letter', 'Letter']], { label: 'Page size' }))}
            ${row('Orientation', '', seg('page.orientation', s.page.orientation, [['portrait', 'Portrait'], ['landscape', 'Landscape']], { label: 'Orientation' }))}
            ${row('Margins', 'Distance from the page edge.', `<div class="margin-grid">${['top', 'bottom', 'left', 'right'].map((k) => `
              <label class="mg"><span>${cap(k)}</span>${num(`page.margins.${k}`, s.page.margins[k], { min: 0, max: 10, step: 0.1, unit: 'cm', label: `${cap(k)} margin` })}</label>`).join('')}</div>`, 'stack-sm')}`)}
          ${card('Typography', 'Body text of the report.', `
            ${row('Font family', '', select('typography.fontFamily', s.typography.fontFamily, FONTS, { label: 'Font family' }))}
            ${row('Font size', '', num('typography.fontSize', s.typography.fontSize, { min: 8, max: 24, step: 0.5, unit: 'pt', label: 'Font size' }))}
            ${row('Line spacing', '', select('typography.lineSpacing', s.typography.lineSpacing, [[1, '1.0'], [1.15, '1.15'], [1.5, '1.5'], [2, '2.0 (double)']], { numeric: true, label: 'Line spacing' }))}
            ${row('Paragraph spacing', 'Space after each paragraph.', num('typography.paragraphSpacing', s.typography.paragraphSpacing, { min: 0, max: 36, step: 1, unit: 'pt', label: 'Paragraph spacing' }))}
            ${row('Justify text', 'Align paragraphs to both margins.', toggle('typography.justify', s.typography.justify, 'Justified'))}`)}
          ${card('Headings', 'Font sizes for chapter and section titles.', `
            ${row('Chapter title (H1)', '', num('typography.headingSizes.h1', s.typography.headingSizes.h1, { min: 10, max: 40, unit: 'pt', label: 'Heading 1 size' }))}
            ${row('Section (H2)', '', num('typography.headingSizes.h2', s.typography.headingSizes.h2, { min: 10, max: 36, unit: 'pt', label: 'Heading 2 size' }))}
            ${row('Subsection (H3)', '', num('typography.headingSizes.h3', s.typography.headingSizes.h3, { min: 10, max: 32, unit: 'pt', label: 'Heading 3 size' }))}`)}
          ${card('Chapters & contents', '', `
            ${row('Chapter title style', '', seg('chapterTitle.style', s.chapterTitle.style, [['upper', 'CHAPTER 1: INTRODUCTION'], ['title', 'Chapter 1: Introduction']], { label: 'Chapter title style' }), 'stack-sm')}
            ${row('Start chapters on a new page', '', toggle('chapterTitle.newPage', s.chapterTitle.newPage, 'New page'))}
            ${row('Table of contents depth', 'How many heading levels are listed.', select('toc.depth', s.toc.depth, [[1, '1 — Chapters only'], [2, '2 — Chapters and sections'], [3, '3 — Down to subsections'], [4, '4 — Down to sub-subsections']], { numeric: true, label: 'Table of contents depth' }))}`)}
        </div>
        <aside class="set-aside">
          <div class="card set-sticky">
            <div class="card-header"><h3>Live preview</h3></div>
            <div class="card-body" data-preview="document"></div>
          </div>
        </aside>
      </div>`;

    const captionsTab = (s) => `
      <div class="set-captions">
        ${['figure', 'table'].map((kind) => {
          const c = s.captions[kind];
          const K = cap(kind);
          return `
          <section class="card set-card">
            <div class="card-header"><div class="grow"><h3>${K} captions</h3><div class="set-desc">How ${kind}s are labelled and numbered throughout the report.</div></div></div>
            <div class="cap-layout">
              <div class="set-rows">
                ${row('Label text', 'Word used before the number.', text(`captions.${kind}.label`, c.label, { placeholder: K, label: `${K} label text` }))}
                ${row('Separator', '', select(`captions.${kind}.separator`, c.separator, separatorOptions(c.label), { label: `${K} separator` }))}
                ${row('Position', `Caption placed above or below the ${kind}.`, seg(`captions.${kind}.position`, c.position, [['above', 'Above'], ['below', 'Below']], { label: `${K} caption position` }))}
                ${row('Numbering', '', select(`captions.${kind}.numbering`, c.numbering, [['global', `${c.label} 1, 2, 3 (whole report)`], ['chapter', `${c.label} 1.1, 1.2 (per chapter)`]], { label: `${K} numbering` }))}
                ${row('Alignment', '', seg(`captions.${kind}.align`, c.align, [['left', 'Left'], ['center', 'Center']], { label: `${K} caption alignment` }))}
                ${row('Label bold', 'Make the label and number bold.', toggle(`captions.${kind}.labelBold`, c.labelBold, 'Bold label'))}
                ${row('Title italic', '', toggle(`captions.${kind}.titleItalic`, c.titleItalic, 'Italic title'))}
              </div>
              <div class="cap-preview"><div class="set-preview-title">Preview</div><div data-preview="caption-${kind}"></div></div>
            </div>
          </section>`;
        }).join('')}
      </div>`;

    const figuresTab = (s) => `
      <div class="set-main set-narrow">
        ${card('New figures', 'Defaults applied to text in newly created diagrams.', `
          ${row('Default font family', '', select('figureDefaults.fontFamily', s.figureDefaults.fontFamily, FONTS, { label: 'Default figure font family' }))}
          ${row('Default font size', '', num('figureDefaults.fontSize', s.figureDefaults.fontSize, { min: 8, max: 48, unit: 'pt', label: 'Default figure font size' }))}`)}
        ${card('Image export', 'Used when exporting figures as PNG or in the Word package.', `
          ${row('Resolution', 'Higher resolution = sharper images, larger files.', seg('figureDefaults.exportScale', s.figureDefaults.exportScale, [[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], { numeric: true, label: 'Export resolution' }), 'stack-sm')}
          ${row('Output density', '', `<span class="dpi-hint" data-dpi>${[96, 192, 288, 384][Math.min(4, Math.max(1, Number(s.figureDefaults.exportScale) || 3)) - 1]} DPI</span>`)}
          ${row('Transparent background', 'Export PNGs without the white page background.', toggle('figureDefaults.transparentBackground', s.figureDefaults.transparentBackground, 'Transparent'))}`)}
      </div>`;

    const projectTab = (project) => {
      const f = (def) => {
        const id = `pf_${def.name}`;
        const control = def.type === 'textarea'
          ? `<textarea class="textarea" id="${id}" name="${def.name}" rows="${def.rows || 3}" placeholder="${esc(def.placeholder || '')}">${esc(def.value)}</textarea>`
          : `<input class="input" id="${id}" name="${def.name}" type="text" value="${esc(def.value)}" placeholder="${esc(def.placeholder || '')}">`;
        return `<div class="field ${def.span ? 'span-all' : ''}"><label for="${id}">${esc(def.label)}${def.required ? ' <span class="req">*</span>' : ''}</label>${control}
          ${def.hint ? `<div class="hint">${esc(def.hint)}</div>` : ''}<div class="error-text" data-error="${def.name}"></div></div>`;
      };
      return `
        <form class="card set-card set-narrow" id="project-form" novalidate>
          <div class="card-header"><div class="grow"><h3>Project details</h3><div class="set-desc">Shown on the title page and in the dashboard.</div></div></div>
          <div class="card-body pf-grid">${projectDetailFields(project).map(f).join('')}</div>
          <div class="card-footer"><button type="button" class="btn" data-action="reset-project">Reset</button><button type="submit" class="btn btn-primary">${icon('check')}Save changes</button></div>
        </form>`;
    };

    const storageSkeleton = () => `
      <div class="set-main set-narrow" data-storage>
        <section class="card set-card"><div class="card-body"><div class="muted">Loading storage information…</div></div></section>
      </div>`;

    async function renderStorage() {
      const token = ++storageToken;
      const project = store.project;
      let usage = { used: 0, quota: 0 };
      try { usage = await store.repo.usage(); } catch { /* unavailable */ }
      try {
        backups = await store.repo.listBackups(project.id);
      } catch (err) { backups = []; console.error(err); }
      if (!alive || token !== storageToken || tab !== 'storage') return;

      const engine = store.repo.engine;
      const pct = usage.quota ? Math.min(100, (usage.used / usage.quota) * 100) : 0;
      const sizeOf = (b) => { try { return new Blob([JSON.stringify(b.data)]).size; } catch { return 0; } };
      panel.innerHTML = `
        <div class="set-main set-narrow" data-storage>
          <section class="card set-card">
            <div class="card-header"><div class="grow"><h3>Storage</h3><div class="set-desc">Where GradDocs keeps your projects. Everything stays on this device.</div></div>
              <span class="badge badge-primary">${esc(ENGINES[engine]?.label || engine)}</span></div>
            <div class="card-body">
              <div class="usage">
                <div class="usage-head"><span><b>${formatBytes(usage.used)}</b> used${usage.quota ? ` of ${formatBytes(usage.quota)}` : ''}</span>${usage.quota ? `<span class="muted">${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%</span>` : ''}</div>
                <div class="progress usage-bar ${pct > 80 ? 'is-danger' : ''}" role="progressbar" aria-valuenow="${pct.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(2, pct)}%"></span></div>
              </div>
              <div class="engine-grid">
                ${Object.entries(ENGINES).map(([key, e]) => `
                  <div class="engine ${key === engine ? 'active' : ''}">
                    <div class="engine-top"><span class="engine-name">${esc(e.label)}</span>${key === engine ? `<span class="badge badge-success">${icon('check')}Active</span>` : ''}</div>
                    <p>${esc(e.desc)}</p>
                    ${key === engine ? '' : `<button class="btn btn-sm" data-action="switch-engine" data-engine="${key}">${icon('refresh')}Switch to ${esc(e.short)}</button>`}
                  </div>`).join('')}
              </div>
            </div>
          </section>

          <section class="card set-card">
            <div class="card-header">
              <div class="grow"><h3>Backups</h3><div class="set-desc">The ${5} most recent backups of this project. One is created automatically every 15 minutes while you work.</div></div>
              <button class="btn btn-sm btn-primary" data-action="create-backup">${icon('archive')}Create backup now</button>
            </div>
            <div class="bk-list">
              ${backups.length ? backups.map((b) => `
                <div class="bk-row" data-backup="${esc(b.id)}">
                  <span class="bk-ico">${icon('history')}</span>
                  <div class="grow min0"><div class="bk-title">${esc(formatDateTime(b.at))}</div>
                    <div class="bk-meta"><span class="badge">${esc(b.reason || 'Backup')}</span><span>≈ ${formatBytes(sizeOf(b))}</span></div></div>
                  <div class="bk-actions">
                    <button class="btn btn-sm" data-action="restore-backup" data-id="${esc(b.id)}">${icon('undo')}<span class="bk-label">Restore</span></button>
                    <button class="btn btn-sm btn-icon" data-action="download-backup" data-id="${esc(b.id)}" data-tip="Download backup" aria-label="Download backup">${icon('export')}</button>
                    <button class="btn btn-sm btn-icon bk-delete" data-action="delete-backup" data-id="${esc(b.id)}" data-tip="Delete backup" aria-label="Delete backup">${icon('trash')}</button>
                  </div>
                </div>`).join('') : `<div class="bk-empty">${icon('archive')}<div><b>No backups yet</b><div class="muted">Create one now to keep a restorable snapshot of this project.</div></div></div>`}
            </div>
            <div class="card-footer bk-footer"><button class="btn btn-sm" data-action="download-project">${icon('export')}Download project backup (.json)</button></div>
          </section>

          <section class="card set-card danger-zone">
            <div class="card-header"><div class="grow"><h3>Danger zone</h3><div class="set-desc">Irreversible actions for this project.</div></div></div>
            <div class="set-rows">${row('Delete this project', 'Permanently removes the project and its backups from this browser. Download a backup first if you may need it.', `<button class="btn btn-danger" data-action="delete-project">${icon('trash')}Delete project</button>`)}</div>
          </section>
        </div>`;
    }

    // ----- Rendering ----------------------------------------------------------
    const refreshPreviews = () => {
      const project = store.project;
      if (!project) return;
      panel.querySelectorAll('[data-preview]').forEach((el) => {
        const kind = el.dataset.preview;
        if (kind === 'document') el.innerHTML = pagePreview(project.settings) + typographyPreview(project.settings);
        else if (kind.startsWith('caption-')) el.innerHTML = captionPreview(project, kind.slice(8));
      });
      for (const kind of ['figure', 'table']) {
        const label = project.settings.captions[kind].label;
        const opts = panel.querySelector(`select[data-path="captions.${kind}.numbering"]`)?.options;
        if (opts) for (const o of opts) o.textContent = o.value === 'chapter' ? `${label} 1.1, 1.2 (per chapter)` : `${label} 1, 2, 3 (whole report)`;
        const sepOpts = panel.querySelector(`select[data-path="captions.${kind}.separator"]`)?.options;
        if (sepOpts) for (const o of sepOpts) o.textContent = separatorOptions(label).find(([v]) => v === o.value)?.[1] || o.textContent;
      }
      const dpi = panel.querySelector('[data-dpi]');
      if (dpi) dpi.textContent = `${[96, 192, 288, 384][Math.min(4, Math.max(1, Number(project.settings.figureDefaults.exportScale) || 3)) - 1]} DPI`;
    };

    const renderPanel = () => {
      const project = store.project;
      if (!alive || !project) return;
      renderTabs();
      storageToken += 1; // cancel any in-flight storage render
      if (tab === 'document') panel.innerHTML = documentTab(project.settings);
      else if (tab === 'captions') panel.innerHTML = captionsTab(project.settings);
      else if (tab === 'figures') panel.innerHTML = figuresTab(project.settings);
      else if (tab === 'project') panel.innerHTML = projectTab(project);
      else { panel.innerHTML = storageSkeleton(); renderStorage(); }
      refreshPreviews();
    };

    // ----- Settings controls ----------------------------------------------------
    const apply = (path, value) => {
      const project = store.project;
      if (!project || getPath(project.settings, path) === value) return;
      store.update((p) => setPath(p.settings, path, value), { activity: `Updated ${tab} settings`, source: 'settings' });
      refreshPreviews();
    };

    const readNumber = (el) => {
      const raw = parseFloat(el.value);
      if (!Number.isFinite(raw)) return null;
      const min = el.min === '' ? -Infinity : Number(el.min);
      const max = el.max === '' ? Infinity : Number(el.max);
      return round(Math.min(max, Math.max(min, raw)));
    };

    d.add(on(panel, 'input', 'input[data-path]', (e, el) => {
      if (el.dataset.kind === 'number') { const v = readNumber(el); if (v !== null) apply(el.dataset.path, v); }
      else if (el.dataset.kind === 'text') { const v = el.value.trim(); if (v) apply(el.dataset.path, v); }
    }));
    d.add(on(panel, 'change', 'input[data-path], select[data-path]', (e, el) => {
      const project = store.project;
      if (!project) return;
      if (el.tagName === 'SELECT') apply(el.dataset.path, el.dataset.type === 'number' ? Number(el.value) : el.value);
      else if (el.dataset.kind === 'bool') apply(el.dataset.path, el.checked);
      else if (el.dataset.kind === 'number') {
        const v = readNumber(el);
        if (v !== null) apply(el.dataset.path, v);
        el.value = getPath(project.settings, el.dataset.path); // reflect the clamped value
      } else if (el.dataset.kind === 'text') {
        const v = el.value.trim();
        if (v) apply(el.dataset.path, v);
        el.value = getPath(project.settings, el.dataset.path);
      }
    }));
    d.add(on(panel, 'click', '.segmented button[data-path]', (e, btn) => {
      const value = btn.dataset.type === 'number' ? Number(btn.dataset.value) : btn.dataset.value;
      btn.parentElement.querySelectorAll('button').forEach((b) => { const on_ = b === btn; b.classList.toggle('active', on_); b.setAttribute('aria-pressed', String(on_)); });
      apply(btn.dataset.path, value);
    }));

    // ----- Project tab ------------------------------------------------------------
    d.add(on(panel, 'submit', '#project-form', (e, form) => {
      e.preventDefault();
      const values = Object.fromEntries(projectDetailFields({}).map((f) => [f.name, form.elements[f.name].value.trim()]));
      const err = form.querySelector('[data-error="name"]');
      err.textContent = values.name ? '' : 'Project Name is required.';
      form.elements.name.classList.toggle('invalid', !values.name);
      if (!values.name) { form.elements.name.focus(); return; }
      store.update((p) => Object.assign(p, values), { activity: 'Updated project details', source: 'settings' });
      toast('Project details saved.', { type: 'success' });
    }));
    d.add(on(panel, 'click', '[data-action="reset-project"]', () => {
      const form = panel.querySelector('#project-form');
      projectDetailFields(store.project).forEach((f) => { form.elements[f.name].value = f.value; });
      form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
      form.querySelectorAll('[data-error]').forEach((el) => { el.textContent = ''; });
    }));

    // ----- Storage tab --------------------------------------------------------------
    const findBackup = (id) => backups.find((b) => b.id === id);
    const stamp = (ts) => new Date(ts).toISOString().slice(0, 16).replace(/[:T]/g, '-');

    const actions = {
      async 'switch-engine'(el) {
        const target = el.dataset.engine;
        const to = ENGINES[target];
        const ok = await confirmDialog({
          title: `Switch to ${to.short}?`,
          message: `All projects and backups will be <strong>copied</strong> to ${esc(to.label)} and GradDocs will use it from now on. The existing copy is left untouched, so nothing is lost.`,
          confirmText: `Switch to ${to.short}`,
        });
        if (!ok) return;
        try {
          await store.switchEngine(target);
          toast(`Now using ${to.label}. Your projects were copied.`, { type: 'success', title: 'Storage switched' });
        } catch (err) { toastError(err, 'Could not switch storage'); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'create-backup'() {
        try {
          await store.createBackup('Manual backup');
          toast('Backup created.', { type: 'success' });
        } catch (err) { toastError(err, 'Could not create the backup'); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'restore-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        const ok = await confirmDialog({
          title: 'Restore this backup?',
          message: `The project will go back to how it was on <strong>${esc(formatDateTime(backup.at))}</strong>. Your current version is backed up first, so you can undo this.`,
          confirmText: 'Restore backup',
        });
        if (!ok) return;
        try {
          await store.restoreBackup(backup);
          toast('Backup restored.', { type: 'success' });
        } catch (err) { toastError(err, 'Could not restore the backup'); }
        if (alive && tab === 'storage') renderStorage();
      },
      'download-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        downloadText(JSON.stringify(backup.data, null, 2), `${slugify(backup.data?.name || store.project.name)}-backup-${stamp(backup.at)}.json`, 'application/json');
        toast('Backup downloaded.', { type: 'success' });
      },
      async 'delete-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        const ok = await confirmDialog({
          title: 'Delete this backup?', danger: true, confirmText: 'Delete backup',
          message: `The backup from <strong>${esc(formatDateTime(backup.at))}</strong> will be removed permanently.`,
        });
        if (!ok) return;
        try {
          await store.repo.deleteBackup(store.project.id, backup.id);
          toast('Backup deleted.', { type: 'success' });
        } catch (err) { toastError(err, 'Could not delete the backup'); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'download-project'() {
        try {
          const data = await store.exportProjectData(store.project.id);
          downloadText(JSON.stringify(data, null, 2), `${slugify(data.name)}-project.json`, 'application/json');
          toast('Project backup downloaded.', { type: 'success' });
        } catch (err) { toastError(err, 'Could not export the project'); }
      },
      async 'delete-project'() {
        const project = store.project;
        const ok = await confirmDialog({
          title: 'Delete project?', danger: true, confirmText: 'Delete project',
          message: `This permanently deletes <strong>${esc(project.name)}</strong>, including all figures, tables, chapters, acronyms and backups stored in this browser. This cannot be undone.`,
        });
        if (!ok) return;
        try {
          await store.deleteProject(project.id);
          toast(`Deleted “${project.name}”.`, { type: 'success' });
          ctx.navigate('#/projects');
        } catch (err) { toastError(err, 'Could not delete the project'); }
      },
    };
    d.add(on(panel, 'click', '[data-action]', (e, el) => { actions[el.dataset.action]?.(el); }));

    // ----- Tabs & lifecycle ---------------------------------------------------------
    d.add(on(tabsEl, 'click', '[data-tab]', (e, el) => {
      if (tab === el.dataset.tab) return;
      tab = el.dataset.tab;
      renderPanel();
    }));
    d.add(store.on('change', ({ source }) => {
      if (source === 'settings' || !SETTINGS_TABS.has(tab)) return;
      renderPanel();
    }));

    ctx.shell.setBreadcrumbs([{ label: 'Settings' }]);
    renderPanel();

    return { unmount() { alive = false; storageToken += 1; d.dispose(); } };
  },
};
