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
import { t, isRTL, lang, LANGUAGES, setLanguage } from '../i18n/index.js';
import { projectDetailFields, iso, strong, tHTML } from '../projects/projects-view.js';

/** Forces left-to-right order for a snippet of report text inside Arabic UI text (no-op in English). */
const ltr = (s) => (isRTL ? `\u2066${s}\u2069` : String(s));

const TABS = [
  { id: 'document', label: t('Document'), icon: 'file' },
  { id: 'captions', label: t('Captions'), icon: 'figure' },
  { id: 'figures', label: t('Figures'), icon: 'diagram' },
  { id: 'project', label: t('Project'), icon: 'folder' },
  { id: 'storage', label: t('Storage'), icon: 'database' },
];
const SETTINGS_TABS = new Set(['document', 'captions', 'figures']);
const FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Georgia'];
const SEPARATORS = [[':', t('Colon'), ':'], ['.', t('Period'), '.'], [' —', t('Em dash'), ' —'], [' -', t('Hyphen'), ' -']];
// The example in brackets shows how the printed caption will look (report text, always left-to-right).
const separatorOptions = (label) => SEPARATORS.map(([value, name, sep]) => [value, `${name}  ${ltr(`( ${label} 1${sep} Title )`)}`]);
const numberingOptions = (label) => [['global', t('{label} 1, 2, 3 (whole report)', { label: iso(label) })], ['chapter', t('{label} 1.1, 1.2 (per chapter)', { label: iso(label) })]];
const ENGINES = {
  localStorage: { label: t('Browser localStorage'), short: 'localStorage', desc: t('Simple and fast. The browser limits it to roughly 5–10 MB in total, which is enough for most text-heavy projects.') },
  indexedDB: { label: 'IndexedDB', short: 'IndexedDB', desc: t('Recommended for large projects with many figures and versions. Much higher storage limit.') },
};
const BACKUP_REASONS = {
  'Opened project': t('Opened project'), 'Automatic backup': t('Automatic backup'),
  'Manual backup': t('Manual backup'), 'Before restoring a backup': t('Before restoring a backup'),
};
// Captions tab wording per kind (full phrases, so each translates as a unit).
const CAPTION_TEXT = {
  figure: {
    title: t('Figure captions'), desc: t('How figures are labelled and numbered throughout the report.'),
    label: t('Figure label text'), separator: t('Figure separator'), position: t('Figure caption position'), positionDesc: t('Caption placed above or below the figure.'),
    numbering: t('Figure numbering'), align: t('Figure caption alignment'),
  },
  table: {
    title: t('Table captions'), desc: t('How tables are labelled and numbered throughout the report.'),
    label: t('Table label text'), separator: t('Table separator'), position: t('Table caption position'), positionDesc: t('Caption placed above or below the table.'),
    numbering: t('Table numbering'), align: t('Table caption alignment'),
  },
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
      <div class="pg" dir="ltr" style="width:${pw}px;height:${ph}px">
        <div class="pg-inner" style="top:${pct(m.top, h)};bottom:${pct(m.bottom, h)};left:${pct(m.left, w)};right:${pct(m.right, w)}"></div>
      </div>
      <div class="pg-caption">${esc(s.page.size)} · ${esc(t(cap(s.page.orientation)))} · <bdi>${w} × ${h} ${esc(t('cm'))}</bdi></div>
    </div>`;
}

function typographyPreview(s) {
  const ty = s.typography;
  const k = 0.78; // scale pt down to fit the narrow preview card
  const pt = (v) => `${round(v * k)}pt`;
  const heading = s.chapterTitle.style === 'upper' ? 'CHAPTER 1: INTRODUCTION' : 'Chapter 1: Introduction';
  // A sample of the printed report page: report text stays English and left-to-right.
  const p = `margin:0 0 ${pt(ty.paragraphSpacing)};text-align:${ty.justify ? 'justify' : 'left'}`;
  return `
    <div class="typo-page" dir="ltr" style="font-family:'${esc(ty.fontFamily)}',serif;font-size:${pt(ty.fontSize)};line-height:${ty.lineSpacing}">
      <div style="font-size:${pt(ty.headingSizes.h1)};font-weight:700;text-align:center;line-height:1.25;margin-bottom:${pt(10)}">${heading}</div>
      <div style="font-size:${pt(ty.headingSizes.h2)};font-weight:700;line-height:1.25;margin-bottom:${pt(6)}">1.1 Introduction</div>
      <p style="${p}">This project presents a secure platform for storing, analysing and reporting on project data, designed for students and researchers.</p>
      <div style="font-size:${pt(ty.headingSizes.h3)};font-weight:700;line-height:1.25;margin-bottom:${pt(4)}">1.1.1 Aims</div>
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
  return `<div class="cap-page" dir="ltr">${cfg.position === 'above' ? `${caption}${object}` : `${object}${caption}`}</div>
    <div class="cap-note">${first ? esc(t('Preview uses “{title}”.', { title: iso(first.title) })) : t('Preview uses sample content. Add a figure or table to see your own.')}</div>`;
}

// ---------------------------------------------------------------------------

export default {
  title: 'Settings',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;
    let tab = TABS.some((x) => x.id === ctx.params?.query?.tab) ? ctx.params.query.tab : 'document';
    let storageToken = 0;
    let backups = [];

    container.innerHTML = `
      <div class="page set-page">
        <div class="page-header">
          <div class="titles">
            <h1>${t('Settings')}</h1>
            <p class="subtitle set-saved">${icon('checkCircle', 'icon-sm')}${t('Changes are saved automatically')}</p>
          </div>
        </div>
        <div class="tabs set-tabs" role="tablist" aria-label="${esc(t('Settings sections'))}"></div>
        <div class="set-panel" role="tabpanel"></div>
      </div>`;
    const tabsEl = container.querySelector('.set-tabs');
    const panel = container.querySelector('.set-panel');

    const renderTabs = () => {
      tabsEl.innerHTML = TABS.map((tb) => `
        <button class="tab ${tb.id === tab ? 'active' : ''}" role="tab" aria-selected="${tb.id === tab}" data-tab="${tb.id}">${icon(tb.icon, 'icon-sm')}${tb.label}</button>`).join('');
      // On narrow screens the tab strip scrolls; keep the active tab visible.
      const active = tabsEl.querySelector('.tab.active');
      if (active && tabsEl.scrollWidth > tabsEl.clientWidth) tabsEl.scrollLeft = Math.max(0, active.offsetLeft - (tabsEl.clientWidth - active.offsetWidth) / 2);
    };

    // ----- Tab renderers ------------------------------------------------------
    // Interface language: its own card at the top of the first tab. The title is
    // bilingual on purpose so it can be found from either language.
    const languageCard = () => `
      <section class="card set-card set-lang">
        <div class="card-header"><div class="grow"><h3>Language / اللغة</h3>
          <div class="set-desc">${t('Choose the language of the interface. Your report content is never translated.')}</div></div></div>
        <div class="lang-options" role="group" aria-label="Language / اللغة">
          ${LANGUAGES.map((l) => `
          <button type="button" class="lang-opt ${l.id === lang ? 'active' : ''}" data-action="set-language" data-lang="${esc(l.id)}" lang="${esc(l.id)}" aria-pressed="${l.id === lang}">
            <span class="lang-code">${esc(l.short)}</span>
            <span class="lang-name">${esc(l.label)}</span>
            ${l.id === lang ? `<span class="badge badge-success">${icon('check')}${t('Active')}</span>` : ''}
          </button>`).join('')}
        </div>
      </section>`;

    const documentTab = (s) => `
      ${languageCard()}
      <div class="set-split">
        <div class="set-main">
          ${card(t('Page'), t('Paper size, orientation and margins.'), `
            ${row(t('Page size'), t('Paper format for preview and Word export.'), seg('page.size', s.page.size, [['A4', 'A4'], ['Letter', 'Letter']], { label: t('Page size') }))}
            ${row(t('Orientation'), '', seg('page.orientation', s.page.orientation, [['portrait', t('Portrait')], ['landscape', t('Landscape')]], { label: t('Orientation') }))}
            ${row(t('Margins'), t('Distance from the page edge.'), `<div class="margin-grid">${[['top', t('Top'), t('Top margin')], ['bottom', t('Bottom'), t('Bottom margin')], ['left', t('Left'), t('Left margin')], ['right', t('Right'), t('Right margin')]].map(([k, name, aria]) => `
              <label class="mg"><span>${name}</span>${num(`page.margins.${k}`, s.page.margins[k], { min: 0, max: 10, step: 0.1, unit: t('cm'), label: aria })}</label>`).join('')}</div>`, 'stack-sm')}`)}
          ${card(t('Typography'), t('Body text of the report.'), `
            ${row(t('Font family'), '', select('typography.fontFamily', s.typography.fontFamily, FONTS, { label: t('Font family') }))}
            ${row(t('Font size'), '', num('typography.fontSize', s.typography.fontSize, { min: 8, max: 24, step: 0.5, unit: t('pt'), label: t('Font size') }))}
            ${row(t('Line spacing'), '', select('typography.lineSpacing', s.typography.lineSpacing, [[1, '1.0'], [1.15, '1.15'], [1.5, '1.5'], [2, t('2.0 (double)')]], { numeric: true, label: t('Line spacing') }))}
            ${row(t('Paragraph spacing'), t('Space after each paragraph.'), num('typography.paragraphSpacing', s.typography.paragraphSpacing, { min: 0, max: 36, step: 1, unit: t('pt'), label: t('Paragraph spacing') }))}
            ${row(t('Justify text'), t('Align paragraphs to both margins.'), toggle('typography.justify', s.typography.justify, t('Justified')))}`)}
          ${card(t('Headings'), t('Font sizes for chapter and section titles.'), `
            ${row(t('Chapter title (H1)'), '', num('typography.headingSizes.h1', s.typography.headingSizes.h1, { min: 10, max: 40, unit: t('pt'), label: t('Heading 1 size') }))}
            ${row(t('Section (H2)'), '', num('typography.headingSizes.h2', s.typography.headingSizes.h2, { min: 10, max: 36, unit: t('pt'), label: t('Heading 2 size') }))}
            ${row(t('Subsection (H3)'), '', num('typography.headingSizes.h3', s.typography.headingSizes.h3, { min: 10, max: 32, unit: t('pt'), label: t('Heading 3 size') }))}`)}
          ${card(t('Chapters & contents'), '', `
            ${row(t('Chapter title style'), '', seg('chapterTitle.style', s.chapterTitle.style, [['upper', 'CHAPTER 1: INTRODUCTION'], ['title', 'Chapter 1: Introduction']], { label: t('Chapter title style') }), 'stack-sm')}
            ${row(t('Start chapters on a new page'), '', toggle('chapterTitle.newPage', s.chapterTitle.newPage, t('New page')))}
            ${row(t('Table of contents depth'), t('How many heading levels are listed.'), select('toc.depth', s.toc.depth, [[1, t('1 — Chapters only')], [2, t('2 — Chapters and sections')], [3, t('3 — Down to subsections')], [4, t('4 — Down to sub-subsections')]], { numeric: true, label: t('Table of contents depth') }))}`)}
        </div>
        <aside class="set-aside">
          <div class="card set-sticky">
            <div class="card-header"><h3>${t('Live preview')}</h3></div>
            <div class="card-body" data-preview="document"></div>
          </div>
        </aside>
      </div>`;

    const captionsTab = (s) => `
      <div class="set-captions">
        ${['figure', 'table'].map((kind) => {
          const c = s.captions[kind];
          const K = cap(kind); // default label word (report text, stays English)
          const L = CAPTION_TEXT[kind];
          return `
          <section class="card set-card">
            <div class="card-header"><div class="grow"><h3>${L.title}</h3><div class="set-desc">${L.desc}</div></div></div>
            <div class="cap-layout">
              <div class="set-rows">
                ${row(t('Label text'), t('Word used before the number.'), text(`captions.${kind}.label`, c.label, { placeholder: K, label: L.label }))}
                ${row(t('Separator'), '', select(`captions.${kind}.separator`, c.separator, separatorOptions(c.label), { label: L.separator }))}
                ${row(t('Position'), L.positionDesc, seg(`captions.${kind}.position`, c.position, [['above', t('Above')], ['below', t('Below')]], { label: L.position }))}
                ${row(t('Numbering'), '', select(`captions.${kind}.numbering`, c.numbering, numberingOptions(c.label), { label: L.numbering }))}
                ${row(t('Alignment'), '', seg(`captions.${kind}.align`, c.align, [['left', t('Left')], ['center', t('Center')]], { label: L.align }))}
                ${row(t('Label bold'), t('Make the label and number bold.'), toggle(`captions.${kind}.labelBold`, c.labelBold, t('Bold label')))}
                ${row(t('Title italic'), '', toggle(`captions.${kind}.titleItalic`, c.titleItalic, t('Italic title')))}
              </div>
              <div class="cap-preview"><div class="set-preview-title">${t('Preview')}</div><div data-preview="caption-${kind}"></div></div>
            </div>
          </section>`;
        }).join('')}
      </div>`;

    const figuresTab = (s) => `
      <div class="set-main set-narrow">
        ${card(t('New figures'), t('Defaults applied to text in newly created diagrams.'), `
          ${row(t('Default font family'), '', select('figureDefaults.fontFamily', s.figureDefaults.fontFamily, FONTS, { label: t('Default figure font family') }))}
          ${row(t('Default font size'), '', num('figureDefaults.fontSize', s.figureDefaults.fontSize, { min: 8, max: 48, unit: t('pt'), label: t('Default figure font size') }))}`)}
        ${card(t('Image export'), t('Used when exporting figures as PNG or in the Word package.'), `
          ${row(t('Resolution'), t('Higher resolution = sharper images, larger files.'), seg('figureDefaults.exportScale', s.figureDefaults.exportScale, [[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], { numeric: true, label: t('Export resolution') }), 'stack-sm')}
          ${row(t('Output density'), '', `<span class="dpi-hint" data-dpi dir="ltr">${[96, 192, 288, 384][Math.min(4, Math.max(1, Number(s.figureDefaults.exportScale) || 3)) - 1]} DPI</span>`)}
          ${row(t('Transparent background'), t('Export PNGs without the white page background.'), toggle('figureDefaults.transparentBackground', s.figureDefaults.transparentBackground, t('Transparent')))}`)}
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
          <div class="card-header"><div class="grow"><h3>${t('Project details')}</h3><div class="set-desc">${t('Shown on the title page and in the dashboard.')}</div></div></div>
          <div class="card-body pf-grid">${projectDetailFields(project).map(f).join('')}</div>
          <div class="card-footer"><button type="button" class="btn" data-action="reset-project">${t('Reset')}</button><button type="submit" class="btn btn-primary">${icon('check')}${t('Save changes')}</button></div>
        </form>`;
    };

    const storageSkeleton = () => `
      <div class="set-main set-narrow" data-storage>
        <section class="card set-card"><div class="card-body"><div class="muted">${t('Loading storage information…')}</div></div></section>
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
            <div class="card-header"><div class="grow"><h3>${t('Storage')}</h3><div class="set-desc">${t('Where GradDocs keeps your projects. Everything stays on this device.')}</div></div>
              <span class="badge badge-primary"><bdi>${esc(ENGINES[engine]?.label || engine)}</bdi></span></div>
            <div class="card-body">
              <div class="usage">
                <div class="usage-head"><span>${usage.quota ? tHTML('{used} used of {quota}', { used: `<b><bdi>${formatBytes(usage.used)}</bdi></b>`, quota: `<bdi>${formatBytes(usage.quota)}</bdi>` }) : tHTML('{used} used', { used: `<b><bdi>${formatBytes(usage.used)}</bdi></b>` })}</span>${usage.quota ? `<span class="muted"><bdi>${pct < 0.1 ? '&lt;0.1' : pct.toFixed(1)}%</bdi></span>` : ''}</div>
                <div class="progress usage-bar ${pct > 80 ? 'is-danger' : ''}" role="progressbar" aria-valuenow="${pct.toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(2, pct)}%"></span></div>
              </div>
              <div class="engine-grid">
                ${Object.entries(ENGINES).map(([key, e]) => `
                  <div class="engine ${key === engine ? 'active' : ''}">
                    <div class="engine-top"><span class="engine-name"><bdi>${esc(e.label)}</bdi></span>${key === engine ? `<span class="badge badge-success">${icon('check')}${t('Active')}</span>` : ''}</div>
                    <p>${esc(e.desc)}</p>
                    ${key === engine ? '' : `<button class="btn btn-sm" data-action="switch-engine" data-engine="${key}">${icon('refresh')}${tHTML('Switch to {name}', { name: `<bdi>${esc(e.short)}</bdi>` })}</button>`}
                  </div>`).join('')}
              </div>
            </div>
          </section>

          <section class="card set-card">
            <div class="card-header">
              <div class="grow"><h3>${t('Backups')}</h3><div class="set-desc">${t('The {n} most recent backups of this project. One is created automatically every 15 minutes while you work.', { n: 5 })}</div></div>
              <button class="btn btn-sm btn-primary" data-action="create-backup">${icon('archive')}${t('Create backup now')}</button>
            </div>
            <div class="bk-list">
              ${backups.length ? backups.map((b) => `
                <div class="bk-row" data-backup="${esc(b.id)}">
                  <span class="bk-ico">${icon('history')}</span>
                  <div class="grow min0"><div class="bk-title"><bdi>${esc(formatDateTime(b.at))}</bdi></div>
                    <div class="bk-meta"><span class="badge">${esc(b.reason ? (BACKUP_REASONS[b.reason] || b.reason) : t('Backup'))}</span><span><bdi>≈ ${formatBytes(sizeOf(b))}</bdi></span></div></div>
                  <div class="bk-actions">
                    <button class="btn btn-sm" data-action="restore-backup" data-id="${esc(b.id)}">${icon('undo')}<span class="bk-label">${t('Restore')}</span></button>
                    <button class="btn btn-sm btn-icon" data-action="download-backup" data-id="${esc(b.id)}" data-tip="${esc(t('Download backup'))}" aria-label="${esc(t('Download backup'))}">${icon('export')}</button>
                    <button class="btn btn-sm btn-icon bk-delete" data-action="delete-backup" data-id="${esc(b.id)}" data-tip="${esc(t('Delete backup'))}" aria-label="${esc(t('Delete backup'))}">${icon('trash')}</button>
                  </div>
                </div>`).join('') : `<div class="bk-empty">${icon('archive')}<div><b>${t('No backups yet')}</b><div class="muted">${t('Create one now to keep a restorable snapshot of this project.')}</div></div></div>`}
            </div>
            <div class="card-footer bk-footer"><button class="btn btn-sm" data-action="download-project">${icon('export')}${t('Download project backup (.json)')}</button></div>
          </section>

          <section class="card set-card danger-zone">
            <div class="card-header"><div class="grow"><h3>${t('Danger zone')}</h3><div class="set-desc">${t('Irreversible actions for this project.')}</div></div></div>
            <div class="set-rows">${row(t('Delete this project'), t('Permanently removes the project and its backups from this browser. Download a backup first if you may need it.'), `<button class="btn btn-danger" data-action="delete-project">${icon('trash')}${t('Delete project')}</button>`)}</div>
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
        if (opts) for (const o of opts) o.textContent = numberingOptions(label).find(([v]) => v === o.value)?.[1] || o.textContent;
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
      err.textContent = values.name ? '' : t('{label} is required.', { label: t('Project Name') });
      form.elements.name.classList.toggle('invalid', !values.name);
      if (!values.name) { form.elements.name.focus(); return; }
      store.update((p) => Object.assign(p, values), { activity: 'Updated project details', source: 'settings' });
      toast(t('Project details saved.'), { type: 'success' });
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
          title: t('Switch to {name}?', { name: to.short }),
          message: tHTML('All projects and backups will be <strong>copied</strong> to {name} and GradDocs will use it from now on. The existing copy is left untouched, so nothing is lost.', { name: `<bdi>${esc(to.label)}</bdi>` }),
          confirmText: t('Switch to {name}', { name: to.short }),
        });
        if (!ok) return;
        try {
          await store.switchEngine(target);
          toast(t('Now using {name}. Your projects were copied.', { name: to.label }), { type: 'success', title: t('Storage switched') });
        } catch (err) { toastError(err, t('Could not switch storage')); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'create-backup'() {
        try {
          await store.createBackup('Manual backup');
          toast(t('Backup created.'), { type: 'success' });
        } catch (err) { toastError(err, t('Could not create the backup')); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'restore-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        const ok = await confirmDialog({
          title: t('Restore this backup?'),
          message: tHTML('The project will go back to how it was on {date}. Your current version is backed up first, so you can undo this.', { date: strong(formatDateTime(backup.at)) }),
          confirmText: t('Restore backup'),
        });
        if (!ok) return;
        try {
          await store.restoreBackup(backup);
          toast(t('Backup restored.'), { type: 'success' });
        } catch (err) { toastError(err, t('Could not restore the backup')); }
        if (alive && tab === 'storage') renderStorage();
      },
      'download-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        downloadText(JSON.stringify(backup.data, null, 2), `${slugify(backup.data?.name || store.project.name)}-backup-${stamp(backup.at)}.json`, 'application/json');
        toast(t('Backup downloaded.'), { type: 'success' });
      },
      async 'delete-backup'(el) {
        const backup = findBackup(el.dataset.id);
        if (!backup) return;
        const ok = await confirmDialog({
          title: t('Delete this backup?'), danger: true, confirmText: t('Delete backup'),
          message: tHTML('The backup from {date} will be removed permanently.', { date: strong(formatDateTime(backup.at)) }),
        });
        if (!ok) return;
        try {
          await store.repo.deleteBackup(store.project.id, backup.id);
          toast(t('Backup deleted.'), { type: 'success' });
        } catch (err) { toastError(err, t('Could not delete the backup')); }
        if (alive && tab === 'storage') renderStorage();
      },
      async 'download-project'() {
        try {
          const data = await store.exportProjectData(store.project.id);
          downloadText(JSON.stringify(data, null, 2), `${slugify(data.name)}-project.json`, 'application/json');
          toast(t('Project backup downloaded.'), { type: 'success' });
        } catch (err) { toastError(err, t('Could not export the project')); }
      },
      async 'delete-project'() {
        const project = store.project;
        const ok = await confirmDialog({
          title: t('Delete project?'), danger: true, confirmText: t('Delete project'),
          message: tHTML('This permanently deletes {name}, including all figures, tables, chapters, acronyms and backups stored in this browser. This cannot be undone.', { name: strong(project.name) }),
        });
        if (!ok) return;
        try {
          await store.deleteProject(project.id);
          toast(t('Deleted “{name}”.', { name: iso(project.name) }), { type: 'success' });
          ctx.navigate('#/projects');
        } catch (err) { toastError(err, t('Could not delete the project')); }
      },
      // Interface language: persist everything first, then save the choice and reload.
      async 'set-language'(el) {
        const id = el.dataset.lang;
        if (!id || id === lang) return;
        try { await store.flush(); } catch (err) { toastError(err, t('Changes could not be saved')); return; }
        setLanguage(id);
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

    ctx.shell.setBreadcrumbs([{ label: t('Settings') }]);
    renderPanel();

    return { unmount() { alive = false; storageToken += 1; d.dispose(); } };
  },
};
