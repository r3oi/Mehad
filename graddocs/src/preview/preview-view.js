// Document Preview: a Word-like, paginated rendering of the whole report.
//
//   buildDocument(project) ──► items (HTML blocks) ──► paginate.js ──► pages ──► DOM
//
// Two passes: the body (chapters, then the References page) is paginated first so we know on which page every
// heading, figure and table lands (arabic numbers from 1); the TOC / List of Figures / List of Tables are
// then built with those numbers and the front matter is paginated (lower-roman numbers). The TOC may list the
// front-matter pages themselves, so that pass repeats until their page numbers are stable.
import { buildDocument } from '../core/document.js';
import { FRONT_MATTER_KINDS } from '../core/model.js';
import { resolveHTML } from '../core/references.js';
import { clamp, debounce } from '../core/utils.js';
import { renderFigureSVG } from '../figures/render.js';
import { fontStack } from '../figures/text-layout.js';
import { renderTableHTML } from '../tables/table-render.js';
import { prefs } from '../app/prefs.js';
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { t, isRTL } from '../i18n/index.js';
import { createMeasureHost, formatPageNumber, pageMetrics, paginate } from './paginate.js';

// Everything painted INSIDE a page (title page, TOC, headings, captions, page numbers, placeholders) is the
// user's report and stays in the report language: only the toolbar, navigator and hover hints are translated.

const PREF_KEY = 'preview';
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const REFERENCES_ID = '__references'; // anchor of the References page (matches the toc entry id in core/document.js)
const DEFAULT_STATE = { mode: 'auto', zoom: 1, navOpen: true, show: { title: true, front: true, body: true } };

// ---------------------------------------------------------------------------
// Block builders: document model → items (see paginate.js for the item shape)

function captionParts(caption, label, sep) {
  const text = String(caption || '');
  if (label && text.startsWith(label)) {
    const rest = text.slice(label.length);
    if (sep && rest.startsWith(sep)) return { lead: `${label}${sep}`, title: rest.slice(sep.length).trim() };
    const m = rest.match(/^\s*[:.—–-]?\s*/);
    return { lead: label + (m ? m[0].trimEnd() : ''), title: rest.slice(m ? m[0].length : 0).trim() };
  }
  return { lead: '', title: text };
}

function captionHTML(cfg, block, pos) {
  const { lead, title } = captionParts(block.caption, block.label, cfg.separator);
  const align = ['left', 'center', 'right', 'justify'].includes(cfg.align) ? cfg.align : 'center';
  return `<div class="pv-caption" data-pos="${pos}" data-label="${esc(block.label)}" style="text-align:${align}">`
    + `${lead ? `<span class="pv-cap-label${cfg.labelBold === false ? '' : ' is-bold'}">${esc(lead)}</span> ` : ''}`
    + `<span class="pv-cap-title${cfg.titleBold ? ' is-bold' : ''}${cfg.titleItalic ? ' is-italic' : ''}">${esc(title)}</span></div>`;
}

function figureItem(project, block, m) {
  const cfg = project.settings.captions.figure;
  const pos = cfg.position === 'above' ? 'above' : 'below';
  let svgHTML;
  try {
    const { svg, width, height } = renderFigureSVG(block.figure, { background: '#ffffff' });
    const maxW = m.contentWidth;
    const maxH = m.contentHeight * 0.55;
    let w = Math.min(width, maxW);
    let h = (w * height) / width;
    if (h > maxH) { h = maxH; w = (h * width) / height; }
    svgHTML = svg.replace('<svg ', `<svg class="pv-fig-svg" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;max-width:100%" `);
  } catch (err) {
    console.warn('[preview] figure failed to render', block.id, err);
    svgHTML = '<div class="pv-missing">This figure could not be rendered.</div>';
  }
  const caption = captionHTML(cfg, block, pos);
  return {
    kind: 'figure',
    anchors: [block.id],
    html: `<figure class="pv-figure" data-fig-id="${esc(block.id)}" title="${esc(t('Double-click to edit'))}">${pos === 'above' ? caption : ''}<div class="pv-fig-img">${svgHTML}</div>${pos === 'below' ? caption : ''}</figure>`,
  };
}

function tableItem(project, block) {
  const cfg = project.settings.captions.table;
  const pos = cfg.position === 'below' ? 'below' : 'above';
  let tableHTML;
  try { tableHTML = renderTableHTML(project, block.table, { caption: false }); } catch (err) {
    console.warn('[preview] table failed to render', block.id, err);
    tableHTML = '<div class="pv-missing">This table could not be rendered.</div>';
  }
  const caption = captionHTML(cfg, block, pos);
  return {
    kind: 'table',
    splitMode: 'rows',
    anchors: [block.id],
    html: `<div class="pv-tblock" data-tbl-id="${esc(block.id)}" title="${esc(t('Double-click to edit'))}">${pos === 'above' ? caption : ''}<div class="pv-tbl">${tableHTML}</div>${pos === 'below' ? caption : ''}</div>`,
  };
}

const paragraphItem = (project, text) => ({
  kind: 'p', splitMode: 'lines', html: `<p class="pv-p" dir="auto">${resolveHTML(project, text, { chipClass: 'doc-ref' })}</p>`,
});
const bulletItem = (project, text, last) => ({
  kind: 'li', splitMode: 'lines', html: `<div class="pv-li${last ? ' pv-li-last' : ''}" dir="auto">${resolveHTML(project, text, { chipClass: 'doc-ref' })}</div>`,
});

/** Items for [{ type: 'p' | 'li', text }] (front-matter bodies). */
function textItems(project, blocks) {
  return blocks.map((b, i) => (b.type === 'li' ? bulletItem(project, b.text, blocks[i + 1]?.type !== 'li') : paragraphItem(project, b.text)));
}

/** Chapter-style heading text for a title the user typed (References, front matter): capitals when "chapter titles in capitals" is on. */
const headingCase = (project, title) => (project.settings.chapterTitle?.style === 'upper' ? String(title ?? '').toUpperCase() : String(title ?? ''));

/** The References page: a chapter-style heading, then "[n]  text" entries with a hanging indent. */
function referenceItems(project, doc) {
  const { include, title, entries } = doc.references;
  if (!include || !entries.length) return [];
  const items = [{ kind: 'h1', breakBefore: true, keepWithNext: true, anchors: [REFERENCES_ID], html: `<h1 class="pv-h1" dir="auto" data-a="${REFERENCES_ID}">${esc(headingCase(project, title))}</h1>` }];
  for (const e of entries) {
    const text = e.runs.map((r) => (r.italic ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('');
    items.push({ kind: 'ref', splitMode: 'lines', html: `<div class="pv-ref" dir="auto" data-n="${esc(e.label)}">${text}</div>` });
  }
  return items;
}

/** Pass 1: the report body (and the References page) → items. */
function buildBodyItems(project, doc, m) {
  const newPage = project.settings.chapterTitle?.newPage !== false;
  const items = [];
  doc.body.forEach((b, i) => {
    if (b.type === 'chapter') {
      items.push({ kind: 'h1', breakBefore: newPage, keepWithNext: true, anchors: [b.id], html: `<h1 class="pv-h1" data-a="${esc(b.id)}">${esc(b.heading)}</h1>` });
    } else if (b.type === 'heading') {
      const level = clamp(b.level, 2, 4);
      items.push({ kind: `h${level}`, keepWithNext: true, anchors: [b.id], html: `<h${level} class="pv-h${level}" dir="auto" data-a="${esc(b.id)}">${esc(b.text)}</h${level}>` });
    } else if (b.type === 'paragraph') items.push(paragraphItem(project, b.text));
    else if (b.type === 'bullet') items.push(bulletItem(project, b.text, doc.body[i + 1]?.type !== 'bullet'));
    else if (b.type === 'figure') items.push(figureItem(project, b, m));
    else if (b.type === 'table') items.push(tableItem(project, b));
  });
  items.push(...referenceItems(project, doc));
  return items;
}

const tocLine = ({ id, text, page, cls = '', indent = 0 }) => `<div class="pv-toc ${cls}"${id && page !== '' ? ` data-goto="${esc(id)}"` : ''}${indent ? ` style="padding-inline-start:${indent}em"` : ''}>`
  + `<span class="t">${esc(text)}</span><span class="lead" aria-hidden="true"></span><span class="n">${esc(page)}</span></div>`;
const noteItem = (text) => ({ kind: 'note', html: `<p class="pv-note">${esc(text)}</p>` });

/** Contents line classes: 'plain' = chapters bold, indented sub-levels; 'academic' = see .pv-toc.acad in preview.css. */
function tocLineClass(entry, academic) {
  if (!academic) return entry.level === 1 ? 'is-ch' : '';
  if (entry.kind === 'front') return 'acad is-front';
  return `acad ${entry.level === 1 ? 'is-ch' : entry.level === 2 ? 'is-l2' : 'is-l3'}`;
}

/**
 * Pass 2: front matter → items. `pageOf(id)` gives the body page number of a heading / figure / table / References,
 * `frontPageOf(id)` the lower-roman label of a front-matter page (for the contents).
 */
function buildFrontItems(project, doc, { pageOf, frontPageOf }) {
  const items = [];
  const academic = project.settings.toc?.style === 'academic';
  for (const f of doc.front) {
    const start = items.length;
    const title = headingCase(project, f.title || FRONT_MATTER_KINDS[f.kind]?.title || 'Untitled Page');
    items.push({ kind: 'front-h', keepWithNext: true, anchors: [f.id], html: `<h1 class="pv-h1 pv-front-h" data-a="${esc(f.id)}">${esc(title)}</h1>` });
    if (f.kind === 'toc') {
      if (!doc.toc.length) items.push(noteItem('No chapters yet.'));
      for (const e of doc.toc) {
        const page = e.kind === 'front' ? frontPageOf(e.id) : pageOf(e.id);
        const text = e.kind === 'references' ? headingCase(project, e.text) : e.text;
        items.push({ kind: 'toc', html: tocLine({ id: e.id, text, page: page ?? '', cls: tocLineClass(e, academic), indent: academic ? 0 : (e.level - 1) * 1.6 }) });
      }
    } else if (f.kind === 'lof' || f.kind === 'lot') {
      const list = f.kind === 'lof' ? doc.figures : doc.tables;
      if (!list.length) items.push(noteItem(f.kind === 'lof' ? 'No figures in this document.' : 'No tables in this document.'));
      for (const e of list) items.push({ kind: 'toc', html: tocLine({ id: e.id, text: e.caption, page: pageOf(e.id) ?? '', cls: `is-list${academic ? ' acad' : ''}` }) });
    } else if (f.kind === 'loa') {
      if (!doc.acronyms.length) items.push(noteItem('No acronyms defined.'));
      for (const a of doc.acronyms) items.push({ kind: 'acr', html: `<div class="pv-acr"><span class="a">${esc(a.acronym)}</span><span class="m">${esc(a.meaning)}</span></div>` });
    } else {
      items.push(...textItems(project, f.blocks));
      const names = doc.titlePage.studentNames;
      if (f.signatures && names.length) {
        for (const name of names) items.push({ kind: 'sig', keepWithNext: true, html: `<div class="pv-sig" dir="auto"><span class="n">${esc(name)}</span><span class="line"></span></div>` });
        if (f.signatureNote) items.push({ kind: 'note', html: `<p class="pv-sig-note">${esc(f.signatureNote)}</p>` });
      }
    }
    items[start].breakBefore = true;
  }
  return items;
}

/** "College of X" / "Department of X" unless the text already says what it is: the word Department / College anywhere in it, or it starts like one ("Faculty of …"). */
const ORG_WORD = /\b(department|college)\b/i;
const ORG_START = { college: /^(college|faculty|school|institute|academy)\b/i, department: /^(department|dept\b|school|faculty|division|institute|college)/i };
function withPrefix(value, kind) {
  const text = String(value || '').trim();
  if (!text || ORG_WORD.test(text) || ORG_START[kind].test(text)) return text;
  return `${kind === 'college' ? 'College' : 'Department'} of ${text}`;
}

/** Logos are data: URLs of an image (anything else is ignored, never put into the page). */
const safeLogo = (src) => (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp)[;,]/i.test(String(src || '')) ? String(src) : '');

/**
 * The project's own logo (settings → Title page), centred just above the project title: about 1.1 inch tall, at most
 * 4.5 inch wide, aspect ratio kept (fitProjectLogo shrinks the height of very wide logos once the picture has loaded).
 */
const PROJECT_LOGO_H = 1.1; // inch
const PROJECT_LOGO_W = 4.5; // inch
const projectLogoHTML = (tp) => {
  const src = safeLogo(tp.projectLogo);
  return src ? `<img class="pv-project-logo" src="${esc(src)}" alt="">` : '';
};
function fitProjectLogo(root) {
  root?.querySelectorAll?.('img.pv-project-logo').forEach((img) => {
    const fit = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio > 0 && Number.isFinite(ratio)) img.style.height = `${Math.min(PROJECT_LOGO_H, PROJECT_LOGO_W / ratio).toFixed(3)}in`;
    };
    if (img.complete && img.naturalWidth) fit(); else img.addEventListener('load', fit, { once: true });
  });
}

/** 'submission' layout: logo, university / college / department, title, degree statement, "by", students, supervisors, date. */
function submissionTitleHTML(tp) {
  const logo = safeLogo(tp.logo);
  const college = withPrefix(tp.college, 'college');
  const department = withPrefix(tp.department, 'department');
  const date = tp.submissionDate || tp.academicYear;
  const supervisors = [tp.supervisor, tp.coSupervisor && `Co-Supervisor: ${tp.coSupervisor}`].filter(Boolean);
  return `<div class="pv-ts">
    ${logo ? `<img class="pv-ts-logo" src="${esc(logo)}" alt="">` : ''}
    ${tp.university ? `<div class="pv-ts-uni">${esc(tp.university)}</div>` : ''}
    ${college ? `<div class="pv-ts-org">${esc(college)}</div>` : ''}
    ${department ? `<div class="pv-ts-org">${esc(department)}</div>` : ''}
    <div class="pv-ts-gap g1"></div>
    ${projectLogoHTML(tp)}
    <div class="pv-ts-name">${esc(tp.name)}</div>
    ${tp.degreeStatement ? `<div class="pv-ts-degree">${esc(tp.degreeStatement)}</div>` : ''}
    <div class="pv-ts-gap g2"></div>
    ${tp.students.length ? `<div class="pv-ts-by">by</div>${tp.students.map((s) => `<div class="pv-ts-line">${esc(s)}</div>`).join('')}` : ''}
    <div class="pv-ts-gap g3"></div>
    ${supervisors.length ? `<div class="pv-ts-by">Supervised by</div>${supervisors.map((s) => `<div class="pv-ts-line">${esc(s)}</div>`).join('')}` : ''}
    <div class="pv-ts-gap g4"></div>
    ${date ? `<div class="pv-ts-date">${esc(date)}</div>` : ''}
  </div>`;
}

function titlePageHTML(tp) {
  if (tp.layout === 'submission') return submissionTitleHTML(tp);
  const college = withPrefix(tp.college, 'college');
  const department = withPrefix(tp.department, 'department');
  const top = [
    tp.university && `<div class="pv-uni">${esc(tp.university)}</div>`,
    college && `<div class="pv-org">${esc(college)}</div>`,
    department && `<div class="pv-org">${esc(department)}</div>`,
  ].filter(Boolean).join('');
  const students = tp.students.length
    ? `<div class="pv-credit"><div class="pv-label">Prepared by:</div>${tp.students.map((s) => `<div class="pv-name">${esc(s)}</div>`).join('')}</div>` : '';
  const supervisor = tp.supervisor ? `<div class="pv-credit"><span class="pv-label">Supervised by:</span> <span class="pv-name">${esc(tp.supervisor)}</span></div>` : '';
  const year = tp.academicYear ? `<div class="pv-year">Academic Year: ${esc(tp.academicYear)}</div>` : '';
  return `<div class="pv-title">
    <div class="pv-title-top">${top}</div>
    <div class="pv-title-mid">
      <div class="pv-rule"></div>
      ${projectLogoHTML(tp)}
      <div class="pv-project">${esc(tp.name)}</div>
      ${tp.type ? `<div class="pv-ptype">${esc(tp.type)}</div>` : ''}
      <div class="pv-rule"></div>
    </div>
    <div class="pv-title-bottom">${students}${supervisor}${year}</div>
  </div>`;
}

const toNode = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
};
/** The title page as a DOM node (its logos are sized once they have loaded). */
const titlePageNode = (tp) => {
  const node = toNode(titlePageHTML(tp));
  fitProjectLogo(node);
  return node;
};

// ---------------------------------------------------------------------------
// View

class PreviewView {
  constructor(container, ctx) {
    this.container = container;
    this.ctx = ctx;
    this.store = ctx.store;
    const saved = prefs.get(PREF_KEY, {}) || {};
    this.state = {
      ...DEFAULT_STATE,
      ...saved,
      zoom: Number.isFinite(saved.zoom) ? clamp(saved.zoom, ZOOM_MIN, ZOOM_MAX) : 1,
      show: { ...DEFAULT_STATE.show, ...(saved.show || {}) },
    };
    if (window.matchMedia?.('(max-width: 800px)').matches) this.state.navOpen = false;
    this.zoom = this.state.zoom;
    this.pages = [];
    this.nav = [];
    this.refPages = new Map();
    this.pinnedNav = null;
    this.metrics = null;
    this.cleanups = [];
    this.destroyed = false;
    this.schedule = debounce(() => this.render(), 300);
  }

  start() {
    this.container.innerHTML = `
      <div class="pv-root" id="pv-root">
        <div class="pv-toolbar" role="toolbar" aria-label="${esc(t('Preview controls'))}">
          <button class="btn btn-sm btn-icon pv-nav-toggle" data-act="nav" aria-pressed="true" aria-label="${esc(t('Toggle navigator'))}" data-tip="${esc(t('Navigator'))}">${icon('structure')}</button>
          <div class="btn-group" role="group" aria-label="${esc(t('Zoom'))}" dir="ltr">
            <button class="btn btn-sm btn-icon" data-act="zoom-out" aria-label="${esc(t('Zoom out'))}" data-tip="${esc(t('Zoom out'))}">${icon('minus')}</button>
            <button class="btn btn-sm pv-zoom" data-act="zoom-reset" data-tip="${esc(t('Reset to 100%'))}" aria-label="${esc(t('Zoom level'))}">100%</button>
            <button class="btn btn-sm btn-icon" data-act="zoom-in" aria-label="${esc(t('Zoom in'))}" data-tip="${esc(t('Zoom in'))}">${icon('plus')}</button>
          </div>
          <button class="btn btn-sm pv-fit" data-act="fit" data-tip="${esc(t('Fit page width'))}">${icon('maximize')}<span class="pv-tl">${esc(t('Fit width'))}</span></button>
          <span class="pv-count" aria-live="polite"></span>
          <div class="segmented pv-toggles" role="group" aria-label="${esc(t('Sections to show'))}">
            <button type="button" data-sec="title" aria-pressed="true">${esc(t('Title page'))}</button>
            <button type="button" data-sec="front" aria-pressed="true">${esc(t('Front matter'))}</button>
            <button type="button" data-sec="body" aria-pressed="true">${esc(t('Chapters'))}</button>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-act="refresh" data-tip="${esc(t('Re-paginate'))}">${icon('refresh')}<span class="pv-tl">${esc(t('Refresh'))}</span></button>
          <button class="btn btn-sm btn-primary" data-act="print" data-tip="${esc(t('Opens the print dialog; choose “Save as PDF”'))}">${icon('printer')}<span class="pv-tl pv-tl-full">${esc(t('Print / Save as PDF'))}</span><span class="pv-tl-short">${esc(t('Print'))}</span></button>
        </div>
        <div class="pv-body">
          <aside class="pv-nav" aria-label="${esc(t('Navigator'))}">
            <div class="pv-nav-head"><span>${esc(t('Navigator'))}</span>
              <button class="btn btn-ghost btn-icon btn-sm" data-act="nav" aria-label="${esc(t('Collapse navigator'))}">${icon('chevronLeft')}</button></div>
            <div class="pv-nav-list"></div>
          </aside>
          <div class="pv-stage">
            <div class="pv-canvas" tabindex="0" aria-label="${esc(t('Document pages'))}"><div class="pv-pages"></div></div>
            <div class="pv-indicator" aria-hidden="true"></div>
          </div>
        </div>
      </div>`;
    const q = (s) => this.container.querySelector(s);
    this.root = q('.pv-root');
    this.canvas = q('.pv-canvas');
    this.pagesEl = q('.pv-pages');
    this.navEl = q('.pv-nav');
    this.navList = q('.pv-nav-list');
    this.countEl = q('.pv-count');
    this.zoomEl = q('.pv-zoom');
    this.indicator = q('.pv-indicator');
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'preview-page-size';
    document.head.append(this.styleEl);

    this.listen(this.root, 'click', (e) => this.onClick(e));
    this.listen(this.canvas, 'dblclick', (e) => this.onDblClick(e));
    this.listen(this.canvas, 'scroll', () => this.onScroll(), { passive: true });
    this.listen(this.canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    // Once the reader scrolls by hand, the navigator follows the scroll position again (see onNavClick).
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) this.listen(this.canvas, type, () => { this.pinnedNav = null; }, { passive: true });
    const unsubscribe = this.store.on('change', () => this.schedule());
    this.cleanups.push(unsubscribe);
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      const ro = new ResizeObserver(() => {
        const w = this.canvas.clientWidth;
        if (w === lastW) return;
        lastW = w;
        if (this.state.mode !== 'manual') this.applyZoom();
      });
      ro.observe(this.canvas);
      this.cleanups.push(() => ro.disconnect());
    }
    this.syncToolbar();
    this.render();
  }

  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  destroy() {
    this.destroyed = true;
    this.schedule.cancel();
    clearTimeout(this.indicatorTimer);
    cancelAnimationFrame(this.scrollFrame);
    for (const fn of this.cleanups.splice(0)) { try { fn(); } catch (err) { console.error(err); } }
    this.styleEl?.remove();
  }

  savePrefs() {
    prefs.set(PREF_KEY, { mode: this.state.mode, zoom: this.state.mode === 'manual' ? this.zoom : this.state.zoom, navOpen: this.state.navOpen, show: this.state.show });
  }

  // ----- Layout + render -------------------------------------------------
  /** Paginate the whole report and return the page model (no DOM writes besides the off-screen measure host). */
  layout(project) {
    const m = pageMetrics(project.settings);
    this.applyVars(m, project.settings);
    const doc = buildDocument(project);
    const mh = createMeasureHost(this.root, m);
    const hosts = [mh];
    try {
      // Pass 1: body (and References). Page numbers start at 1 on the first chapter page.
      const body = paginate(buildBodyItems(project, doc, m), mh, m);
      const pageOf = (id) => (body.anchors.has(id) ? String(body.anchors.get(id) + 1) : null);
      // Pass 2: front matter, now that TOC / LoF / LoT numbers are known. A 'submission' title page counts as page i
      // (it shows no number), so the first front-matter page is ii, as in the university templates.
      const frontOffset = doc.titlePage.layout === 'submission' ? 1 : 0;
      const frontLabel = (idx) => formatPageNumber('front', idx + frontOffset + 1);
      // The contents may list the front-matter pages themselves: repeat until their labels stop changing.
      const listsFront = doc.toc.some((e) => e.kind === 'front');
      let front = null;
      let labels = new Map();
      for (let round = 0; round < 3; round += 1) {
        const host = createMeasureHost(this.root, m);
        hosts.push(host);
        front = paginate(buildFrontItems(project, doc, { pageOf, frontPageOf: (id) => labels.get(id) || '' }), host, m);
        if (!listsFront) break;
        const next = new Map(doc.front.map((f) => [f.id, front.anchors.has(f.id) ? frontLabel(front.anchors.get(f.id)) : '']));
        const stable = doc.front.every((f) => labels.get(f.id) === next.get(f.id));
        labels = next;
        if (stable) break;
      }

      const show = this.state.show;
      const pages = [];
      if (show.title) pages.push({ kind: 'title', label: '', node: titlePageNode(doc.titlePage) });
      const frontBase = pages.length;
      if (show.front) front.pages.forEach((p, i) => pages.push({ kind: 'front', label: frontLabel(i), items: p.items }));
      const bodyBase = pages.length;
      if (show.body) body.pages.forEach((p, i) => pages.push({ kind: 'body', label: formatPageNumber('body', i + 1), items: p.items }));

      // Navigation model + cross-reference targets (absolute page index).
      const nav = [];
      const refPages = new Map();
      if (show.title) nav.push({ label: t('Title page'), level: 0, page: 0 });
      if (show.front && doc.front.length) {
        nav.push({ group: t('Front matter') });
        for (const f of doc.front) {
          const idx = front.anchors.get(f.id);
          if (idx === undefined) continue;
          nav.push({ id: f.id, label: f.title || FRONT_MATTER_KINDS[f.kind]?.title || 'Untitled Page', level: 0, page: frontBase + idx, pageLabel: frontLabel(idx) });
          refPages.set(f.id, frontBase + idx);
        }
      }
      if (show.body) {
        const hasReferences = body.anchors.has(REFERENCES_ID);
        if (doc.body.length || hasReferences) nav.push({ group: t('Report') });
        for (const b of doc.body) {
          if (b.type !== 'chapter' && b.type !== 'heading') continue;
          const idx = body.anchors.get(b.id);
          if (idx === undefined) continue;
          const isCh = b.type === 'chapter';
          if (isCh || b.level <= 3) {
            nav.push({
              id: b.id,
              label: isCh ? (b.unassigned || b.numbered === false ? b.title : `Chapter ${b.number}: ${b.title}`) : b.text,
              level: isCh ? 0 : b.level - 1, chapter: isCh, page: bodyBase + idx, pageLabel: String(idx + 1),
            });
          }
        }
        if (hasReferences) {
          const idx = body.anchors.get(REFERENCES_ID);
          nav.push({ id: REFERENCES_ID, label: doc.references.title, level: 0, chapter: true, page: bodyBase + idx, pageLabel: String(idx + 1) });
        }
        for (const [id, idx] of body.anchors) refPages.set(id, bodyBase + idx);
      }
      return { m, pages, nav, refPages };
    } finally {
      // Nodes that were placed on pages have already been moved out of the hosts.
      for (const host of hosts) host.destroy();
    }
  }

  applyVars(m, settings) {
    const typo = settings.typography || {};
    const sizes = typo.headingSizes || {};
    const set = (k, v) => this.root.style.setProperty(k, v);
    set('--pw', `${m.width}px`);
    set('--ph', `${m.height}px`);
    set('--mt', `${m.margins.top}px`);
    set('--mr', `${m.margins.right}px`);
    set('--mb', `${m.margins.bottom}px`);
    set('--ml', `${m.margins.left}px`);
    set('--cw', `${m.contentWidth}px`);
    set('--ch', `${m.contentHeight}px`);
    set('--pv-font', fontStack(typo.fontFamily || 'Times New Roman'));
    set('--pv-size', `${Number(typo.fontSize) || 12}pt`);
    set('--pv-lh', String(Number(typo.lineSpacing) || 1.5));
    set('--pv-para', `${Number.isFinite(Number(typo.paragraphSpacing)) ? Number(typo.paragraphSpacing) : 6}pt`);
    set('--pv-h1', `${Number(sizes.h1) || 18}pt`);
    set('--pv-h2', `${Number(sizes.h2) || 16}pt`);
    set('--pv-h3', `${Number(sizes.h3) || 14}pt`);
    set('--pv-align', typo.justify === false ? 'start' : 'justify');
    set('--pv-align-last', typo.justify === false ? 'auto' : 'justify');
    // Headings in their own font (unset = the body font), indented first lines, bold-italic level 3+ headings.
    if (String(typo.headingFontFamily || '').trim()) set('--pv-hfont', fontStack(String(typo.headingFontFamily).trim()));
    else this.root.style.removeProperty('--pv-hfont');
    set('--pv-indent', `${Math.max(0, Number(typo.firstLineIndent) || 0)}cm`);
    set('--pv-sub-style', typo.subheadingItalic ? 'italic' : 'normal');
    this.styleEl.textContent = `@page { size: ${m.cssSize}; margin: 0; }\n`
      + `@media print { .preview-page { width: ${m.mmW}mm !important; height: ${(m.mmH - 0.4).toFixed(2)}mm !important; } }\n`;
  }

  render() {
    if (this.destroyed || !this.store.project) return;
    this.schedule.cancel();
    const t0 = performance.now();
    const scrollTop = this.canvas.scrollTop;
    let model;
    try {
      model = this.layout(this.store.project);
    } catch (err) {
      console.error('[preview] pagination failed', err);
      this.pagesEl.innerHTML = `<div class="pv-error"><strong>${esc(t('The preview could not be generated.'))}</strong><br>${esc(err?.message || err)}</div>`;
      return;
    }
    const { m, pages, nav, refPages } = model;
    this.metrics = m;
    this.pages = pages;
    this.nav = nav;
    this.pinnedNav = null;
    this.refPages = refPages;

    const frag = document.createDocumentFragment();
    pages.forEach((pg, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'pv-page-wrap';
      wrap.dataset.page = String(i);
      const sheet = document.createElement('section');
      sheet.className = `preview-page pv-page pv-kind-${pg.kind}`;
      // Paper is left-to-right, report-language (English) paper whatever the app language: the same fonts, the same
      // glyph fallbacks, the same layout. (Paragraphs carry dir="auto", so Arabic text inside still reads RTL.)
      sheet.lang = 'en';
      sheet.dir = 'ltr';
      sheet.setAttribute('aria-label', pg.label ? t('Page {label}', { label: pg.label }) : t('Page {label}', { label: i + 1 }));
      const content = document.createElement('div');
      content.className = 'pv-content';
      if (pg.node) content.append(pg.node);
      else pg.items.forEach((item, j) => { item.node.classList.toggle('pv-top', j === 0); content.append(item.node); });
      sheet.append(content);
      if (pg.label) {
        const footer = document.createElement('div');
        footer.className = 'pv-footer';
        footer.innerHTML = `<span>${esc(pg.label)}</span>`;
        sheet.append(footer);
      }
      wrap.append(sheet);
      frag.append(wrap);
    });
    if (!pages.length) {
      const empty = document.createElement('div');
      empty.className = 'pv-empty';
      empty.textContent = t('Nothing to show. Turn on a section above.');
      frag.append(empty);
    }
    this.pagesEl.replaceChildren(frag);
    this.applyZoom({ keepScroll: false });
    this.canvas.scrollTop = scrollTop;

    this.countEl.textContent = pages.length === 1 ? t('1 page') : t('{n} pages', { n: pages.length });
    this.renderNav();
    this.onScroll();
    this.renderMs = Math.round(performance.now() - t0);
    this.container.dataset.renderMs = String(this.renderMs);
  }

  renderNav() {
    this.navList.innerHTML = this.nav.map((e, i) => (e.group
      ? `<div class="pv-nav-group">${esc(e.group)}</div>`
      : `<button type="button" class="pv-nav-item lvl-${e.level}${e.chapter ? ' is-ch' : ''}" data-page="${e.page}" data-nav="${i}">
          <span class="pv-lbl" dir="auto">${esc(e.label)}</span><span class="pv-pg">${esc(e.pageLabel || '')}</span></button>`)).join('');
    // Heading elements, used to highlight the section that is currently at the top of the viewport.
    this.navEls = this.nav.map((e) => (e.id ? this.pagesEl.querySelector(`[data-a="${CSS.escape(e.id)}"]`) : null));
  }

  // ----- Zoom ----------------------------------------------------------
  fitZoom() {
    if (!this.metrics) return 1;
    const cs = getComputedStyle(this.pagesEl);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const avail = Math.max(120, this.canvas.clientWidth - pad);
    return avail / this.metrics.width;
  }

  /** Apply the current zoom mode ('auto' = fit but never above 100 %, 'fit' = exact width, 'manual'). */
  applyZoom({ keepScroll = true } = {}) {
    let z = this.zoom;
    if (this.state.mode === 'auto') z = Math.min(1, this.fitZoom());
    else if (this.state.mode === 'fit') z = Math.min(2, this.fitZoom());
    this.setZoomValue(clamp(z, ZOOM_MIN, ZOOM_MAX), keepScroll);
  }

  setZoomValue(z, keepScroll = true) {
    const c = this.canvas;
    const ratio = keepScroll && c.scrollHeight ? (c.scrollTop + c.clientHeight / 2) / c.scrollHeight : null;
    this.zoom = z;
    this.pagesEl.style.setProperty('--zoom', String(+z.toFixed(4)));
    if (ratio !== null) c.scrollTop = ratio * c.scrollHeight - c.clientHeight / 2;
    this.syncToolbar();
  }

  setZoom(z, mode = 'manual') {
    this.state.mode = mode;
    this.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.applyZoom();
    this.savePrefs();
  }

  stepZoom(dir) {
    const pct = Math.round(this.zoom * 100);
    const next = dir > 0 ? (Math.floor(pct / 10) + 1) * 10 : (Math.ceil(pct / 10) - 1) * 10;
    this.setZoom(next / 100);
  }

  syncToolbar() {
    this.zoomEl.textContent = `${Math.round(this.zoom * 100)}%`;
    this.root.querySelector('[data-act="fit"]').classList.toggle('active', this.state.mode === 'fit');
    const navToggle = this.root.querySelector('.pv-nav-toggle');
    navToggle.setAttribute('aria-pressed', String(this.state.navOpen));
    navToggle.classList.toggle('active', this.state.navOpen);
    this.navEl.classList.toggle('collapsed', !this.state.navOpen);
    for (const b of this.root.querySelectorAll('[data-sec]')) {
      const on = !!this.state.show[b.dataset.sec];
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // ----- Interaction ---------------------------------------------------
  scrollToPage(index, { smooth = true } = {}) {
    const wrap = this.pagesEl.children[index];
    if (!wrap || !wrap.classList.contains('pv-page-wrap')) return;
    const top = wrap.getBoundingClientRect().top - this.canvas.getBoundingClientRect().top + this.canvas.scrollTop - 16;
    this.canvas.scrollTo({ top: Math.max(0, top), behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }

  currentPage() {
    const wraps = this.pagesEl.children;
    const probe = this.canvas.scrollTop + this.canvas.clientHeight * 0.3;
    let cur = 0;
    for (let i = 0; i < wraps.length; i += 1) { if (wraps[i].offsetTop - 16 <= probe) cur = i; else break; }
    return cur;
  }

  onScroll() {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      if (this.destroyed || !this.pages.length) { this.indicator.classList.remove('show'); return; }
      const cur = this.currentPage();
      const pg = this.pages[cur];
      // The page label (i, ii, 1 …) is paper text: keep it left-to-right inside the Arabic pill.
      const label = pg?.label ? ` · ${isRTL ? `<bdi dir="ltr">${esc(pg.label)}</bdi>` : esc(pg.label)}` : '';
      this.indicator.innerHTML = `${esc(t('Page {n} of {total}', { n: cur + 1, total: this.pages.length }))}${label}`;
      this.indicator.classList.add('show');
      clearTimeout(this.indicatorTimer);
      this.indicatorTimer = setTimeout(() => this.indicator.classList.remove('show'), 1600);
      // Highlight the last heading that has scrolled past the 30 % line of the viewport.
      const probe = this.canvas.getBoundingClientRect().top + this.canvas.clientHeight * 0.3;
      let active = -1;
      for (let i = 0; i < this.nav.length && this.pinnedNav == null; i += 1) {
        const e = this.nav[i];
        if (e.group) continue;
        if (e.page > cur + 1) break;
        const el = this.navEls[i] || this.pagesEl.children[e.page];
        if (!el || el.getBoundingClientRect().top > probe) { if (e.page >= cur) break; continue; }
        active = i;
      }
      if (this.pinnedNav != null) active = this.pinnedNav;
      for (const el of this.navList.querySelectorAll('.pv-nav-item')) {
        const on = Number(el.dataset.nav) === active;
        if (on === el.classList.contains('active')) continue;
        el.classList.toggle('active', on);
        if (on) this.revealInNav(el);
      }
    });
  }

  /** Keep the active navigator entry visible without scrolling anything but the navigator list. */
  revealInNav(el) {
    const list = this.navList;
    if (!list.clientHeight) return;
    const l = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < l.top + 8) list.scrollTop -= l.top + 8 - r.top;
    else if (r.bottom > l.bottom - 8) list.scrollTop += r.bottom - l.bottom + 8;
  }

  onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.setZoom(this.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  onClick(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const act = el.closest('[data-act]')?.dataset.act;
    if (act === 'nav') { this.state.navOpen = !this.state.navOpen; this.syncToolbar(); this.savePrefs(); return; }
    if (act === 'zoom-in') { this.stepZoom(1); return; }
    if (act === 'zoom-out') { this.stepZoom(-1); return; }
    if (act === 'zoom-reset') { this.setZoom(1); return; }
    if (act === 'fit') { this.setZoom(this.fitZoom(), 'fit'); return; }
    if (act === 'refresh') { this.render(); return; }
    if (act === 'print') { this.print(); return; }
    const sec = el.closest('[data-sec]')?.dataset.sec;
    if (sec) {
      this.state.show[sec] = !this.state.show[sec];
      this.syncToolbar();
      this.savePrefs();
      this.render();
      return;
    }
    const navBtn = el.closest('.pv-nav-item');
    if (navBtn) {
      // The clicked entry stays highlighted until the reader scrolls by hand.
      this.pinnedNav = Number(navBtn.dataset.nav);
      this.scrollToPage(Number(navBtn.dataset.page));
      this.onScroll();
      return;
    }
    const toc = el.closest('.pv-toc[data-goto]');
    const ref = el.closest('.doc-ref[data-ref]');
    const target = toc ? toc.dataset.goto : ref ? ref.dataset.ref.split(':')[1] : null;
    if (target && this.refPages.has(target)) this.scrollToPage(this.refPages.get(target));
  }

  onDblClick(e) {
    const el = e.target instanceof Element ? e.target.closest('[data-fig-id], [data-tbl-id]') : null;
    if (!el) return;
    window.getSelection?.()?.removeAllRanges();
    if (el.dataset.figId) this.ctx.navigate(this.ctx.href('figures', el.dataset.figId));
    else this.ctx.navigate(this.ctx.href('tables', el.dataset.tblId));
  }

  print() {
    this.schedule.flush();
    window.print();
  }
}

export default {
  title: 'Document Preview',
  layout: 'flush',
  mount(container, ctx) {
    const view = new PreviewView(container, ctx);
    view.start();
    return { unmount: () => view.destroy() };
  },
};
