// Chapters: the writing workspace. A sticky outline on the left, the selected chapter on the right
// with one card per section (recursively) and live cross-reference chips in every text.
import { esc, on, Disposer, flash } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { SECTION_STATUSES } from '../core/model.js';
import { getNumbering, captionText, chapterHeading } from '../core/numbering.js';
import { removeLine, removePlacements, PLACE_RE } from '../core/references.js';
import { t, isRTL } from '../i18n/index.js';
import * as ops from './outline-ops.js';
import { createBodyEditor } from './body-editor.js';

const selectedByProject = new Map(); // remembered chapter per project while the app is open
const iso = ops.isolate; // keeps user titles inside translated sentences in their own direction

function pulse(el) {
  if (!el) return;
  el.classList.remove('highlight-flash');
  void el.offsetWidth;
  el.classList.add('highlight-flash');
}

export default {
  title: 'Chapters',

  mount(container, ctx) {
    const { store } = ctx;
    const disposer = new Disposer();
    const projectId = store.project.id;
    let editors = [];
    let lastShape = '';
    let rendering = false;
    let selectedId = selectedByProject.get(projectId) || null;
    let spyFrame = 0;
    const pending = { focusTitle: null, flash: null };

    // ------------------------------------------------------------------ html
    const shapeOf = (project, chapterId) => {
      const walk = (list) => list.map((s) => `${s.id}(${walk(s.sections || [])})`).join(',');
      const ch = project.chapters.find((c) => c.id === chapterId);
      return `${chapterId}|${project.chapters.map((c) => c.id).join(',')}|${ch ? walk(ch.sections || []) : ''}`;
    };

    const chapterPrefix = (project, chapter) => chapterHeading(project, { ...chapter, title: '' }).trim();

    function navSectionsHTML(sections, num) {
      return (sections || []).map((s) => {
        const info = num.sections.get(s.id);
        return `<li style="--d:${info.depth}"><button type="button" class="chn-link chn-sec" data-nav-sec="${esc(s.id)}"><i class="dot s-${esc(s.status)}" aria-hidden="true"></i><span class="chn-num" dir="ltr">${info.number}</span><span class="chn-title" dir="auto" data-nav-title="${esc(s.id)}">${esc(s.title)}</span></button></li>${navSectionsHTML(s.sections, num)}`;
      }).join('');
    }

    function navHTML(project, chapter, num) {
      const info = num.chapters.get(chapter.id);
      return `
        <aside class="ch-nav card" aria-label="${t('Chapter outline')}">
          <button type="button" class="ch-nav-head" data-action="nav-toggle" aria-expanded="false">
            <span class="ch-nav-label">${t('Outline')}</span>
            <span class="ch-nav-current truncate" dir="auto">${esc(info.label)}: ${esc(chapter.title)}</span>
            ${icon('chevronDown', 'ch-nav-chev')}
          </button>
          <nav class="ch-nav-list" aria-label="${t('Chapters')}">
            <ul class="chn-chapters">
              ${project.chapters.map((ch) => {
                const ci = num.chapters.get(ch.id);
                const current = ch.id === chapter.id;
                return `<li class="chn-ch ${current ? 'current' : ''}">
                  <button type="button" class="chn-link chn-chapter" data-nav-ch="${esc(ch.id)}" ${current ? 'aria-current="true"' : ''}>
                    <span class="chn-num" dir="ltr">${ci.number}</span><span class="chn-title" dir="auto" data-nav-title="${esc(ch.id)}">${esc(ch.title)}</span>
                  </button>
                  ${current ? `<ul class="chn-secs">${navSectionsHTML(ch.sections, num) || `<li class="chn-none">${t('No sections yet')}</li>`}</ul>` : ''}
                </li>`;
              }).join('')}
            </ul>
          </nav>
        </aside>`;
    }

    function itemsHTML(project, ownerId, isChapter) {
      const num = getNumbering(project);
      const here = (info) => (isChapter ? info.chapterId === ownerId && !info.sectionId : info.sectionId === ownerId);
      const figs = num.figureOrder.filter((f) => here(num.figures.get(f.id)));
      const tabs = num.tableOrder.filter((tb) => here(num.tables.get(tb.id)));
      const query = isChapter ? { new: '1', chapter: ownerId } : { new: '1', section: ownerId };
      const row = (kind, item) => {
        const info = num[kind === 'figure' ? 'figures' : 'tables'].get(item.id);
        const full = captionText(project, kind, item);
        const rest = full.startsWith(info.label) ? full.slice(info.label.length) : full;
        const data = `data-kind="${kind}" data-id="${esc(item.id)}" data-owner="${esc(ownerId)}"`;
        // In text: the figure/table has its own line in this text. Otherwise it follows the text of the section.
        const state = info.placed
          ? `<span class="si-state in-text">${icon('check')}${t('In text')}</span><button type="button" class="btn btn-sm btn-ghost si-act" data-action="show-placed" ${data}>${t('Show in text')}</button>`
          : `<span class="si-state at-end">${isChapter ? t('After the introduction') : t('At end of section')}</span><button type="button" class="btn btn-sm si-act" data-action="place" ${data}>${icon('plus')}${t('Place in text')}</button>`;
        return `<li class="si-row${info.placed ? ' is-placed' : ''}"><a class="si-item" href="${ctx.href(kind === 'figure' ? 'figures' : 'tables', item.id)}">${icon(kind === 'figure' ? 'figure' : 'table')}<span class="si-label" dir="auto"><strong>${esc(info.label)}</strong>${esc(rest)}</span></a><span class="si-status">${state}</span></li>`;
      };
      const rows = [...figs.map((f) => row('figure', f)), ...tabs.map((tb) => row('table', tb))];
      // Placement lines that do not work: the item was deleted, or it is placed a second time.
      const warnings = num.brokenPlacements.filter((b) => b.ownerId === ownerId).map((b) => {
        const info = num[b.kind === 'figure' ? 'figures' : 'tables'].get(b.id);
        const text = b.reason === 'missing'
          ? t(b.kind === 'figure' ? 'A figure placed in the text no longer exists.' : 'A table placed in the text no longer exists.')
          : t('{label} is placed more than once. Only the first copy counts.', { label: `<strong><bdi>${esc(info?.label || '')}</bdi></strong>` });
        return `<li class="si-warn">${icon('alert')}<span class="si-warn-text">${text}</span><button type="button" class="btn btn-sm btn-ghost" data-action="drop-placement" data-kind="${b.kind}" data-id="${esc(b.id)}" data-owner="${esc(ownerId)}" data-line="${b.line}" data-reason="${b.reason}">${t('Remove')}</button></li>`;
      });
      return `
        <div class="si-head">
          <span class="si-title">${isChapter ? t('In this chapter') : t('In this section')}${rows.length ? `<span class="si-count">${rows.length}</span>` : ''}</span>
          <span class="si-actions">
            <a class="btn btn-sm" href="${ctx.href('figures', null, query)}">${icon('plus')}${t('Add figure here')}</a>
            <a class="btn btn-sm" href="${ctx.href('tables', null, query)}">${icon('plus')}${t('Add table here')}</a>
          </span>
        </div>
        ${warnings.length ? `<ul class="si-warns">${warnings.join('')}</ul>` : ''}
        ${rows.length ? `<ul class="si-list">${rows.join('')}</ul>` : `<p class="si-empty">${t('No figures or tables placed here yet.')}</p>`}`;
    }

    function cardHTML(project, sec, num) {
      const s = num.sections.get(sec.id);
      return `
        <section class="sec-card d${s.depth}" id="sec-${esc(sec.id)}" data-id="${esc(sec.id)}" data-depth="${s.depth}" style="--depth:${s.depth}">
          <header class="sec-head">
            <span class="sec-num" data-sec-num dir="ltr">${s.number}</span>
            <input class="sec-title" data-title="${esc(sec.id)}" data-orig="${esc(sec.title)}" value="${esc(sec.title)}" maxlength="200" dir="auto" aria-label="${t('Title of section {number}', { number: s.number })}" placeholder="${t('Section title')}">
            <select class="select select-sm sec-status s-${esc(sec.status)}" data-status="${esc(sec.id)}" aria-label="${t('Status of section {number}', { number: s.number })}">
              ${SECTION_STATUSES.map((st) => `<option value="${st.value}" ${st.value === sec.status ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="sec-menu" data-id="${esc(sec.id)}" aria-label="${t('More actions for section {number}', { number: s.number })}" aria-haspopup="menu">${icon('more')}</button>
          </header>
          <div class="sec-body" data-editor="${esc(sec.id)}"></div>
          <div class="sec-items" data-items="${esc(sec.id)}"></div>
        </section>
        ${(sec.sections || []).map((child) => cardHTML(project, child, num)).join('')}`;
    }

    function mainHTML(project, chapter, num) {
      const idx = project.chapters.indexOf(chapter);
      const prev = project.chapters[idx - 1];
      const next = project.chapters[idx + 1];
      const prog = ops.progressOf(chapter.sections);
      const upper = project.settings.chapterTitle?.style === 'upper';
      const pager = (c, dir) => {
        if (!c) return '<span></span>';
        const ci = num.chapters.get(c.id);
        return `<button type="button" class="ch-page ${dir}" data-chapter="${esc(c.id)}">
          ${dir === 'prev' ? icon('arrowLeft') : ''}
          <span class="ch-page-text"><small>${dir === 'prev' ? t('Previous chapter') : t('Next chapter')}</small><strong dir="auto">${esc(ci.label)}: ${esc(c.title)}</strong></span>
          ${dir === 'next' ? icon('arrowRight') : ''}
        </button>`;
      };
      return `
        <div class="ch-main">
          <div class="ch-toolbar">
            <div class="ch-select-wrap">
              <label class="sr-only" for="ch-select">${t('Chapter')}</label>
              <select id="ch-select" class="select" data-chapter-select>
                ${project.chapters.map((c) => `<option value="${esc(c.id)}" ${c.id === chapter.id ? 'selected' : ''}>${esc(num.chapters.get(c.id).label)}: ${esc(c.title)}</option>`).join('')}
              </select>
            </div>
            <div class="ch-progress" data-ch-progress>
              <span class="bar"><i style="width:${prog.percent}%"></i></span>
              <span class="ch-progress-text">${ops.progressText(prog)}</span>
            </div>
            <a class="btn btn-sm" href="${ctx.href('structure', null, { focus: chapter.id })}">${icon('structure')}<span class="hide-xs">${t('Edit structure')}</span></a>
          </div>

          <article class="ch-article">
            <header class="ch-head card" id="ch-head" data-id="${esc(chapter.id)}">
              <h1 class="ch-heading ${upper ? 'upper' : ''}" aria-label="${esc(chapterHeading(project, chapter))}">
                <span class="ch-heading-prefix" data-ch-prefix dir="ltr">${esc(chapterPrefix(project, chapter))}</span>
                <input class="ch-title" data-title="${esc(chapter.id)}" data-orig="${esc(chapter.title)}" value="${esc(chapter.title)}" maxlength="200" dir="auto" aria-label="${t('Chapter title')}" placeholder="${t('Chapter title')}">
              </h1>
              <div class="ch-lead">
                <div class="ch-label">${t('Chapter introduction')} <span>${t('(optional text before the first section)')}</span></div>
                <div data-editor="${esc(chapter.id)}"></div>
              </div>
              <div class="sec-items ch-items" data-items="${esc(chapter.id)}"></div>
            </header>

            <div class="ch-sections">
              ${(chapter.sections || []).map((s) => cardHTML(project, s, num)).join('')}
            </div>
            ${(chapter.sections || []).length ? '' : `<div class="empty-state ch-empty card"><div class="empty-icon">${icon('fileText')}</div><h3>${t('This chapter has no sections yet')}</h3><p>${t('Sections give your chapter its structure (for example 1.1 Introduction, 1.2 Problem Statement) and appear in the table of contents.')}</p></div>`}
            <div class="ch-add"><button class="btn btn-soft" data-action="add-section" data-id="${esc(chapter.id)}">${icon('plus')}${t('Add section')}</button></div>
          </article>

          <footer class="ch-pager">${pager(prev, 'prev')}${pager(next, 'next')}</footer>
        </div>`;
    }

    // ------------------------------------------------------------------ rendering
    function disposeEditors() {
      const list = editors;
      editors = [];
      list.forEach(({ editor }) => editor.destroy());
    }

    function commitBody(id, body) {
      const title = ops.locate(store.project, id)?.node.title || t('text');
      store.update((p) => { const n = ops.locate(p, id); if (n) n.node.body = body; }, { activity: { text: t('Edited “{title}”', { title: iso(title) }), kind: 'edit', targetId: id } });
    }

    function mountEditors(project) {
      container.querySelectorAll('[data-editor]').forEach((host) => {
        const id = host.dataset.editor;
        const info = ops.locate(project, id);
        if (!info) return;
        const isChapter = info.kind === 'chapter';
        const editor = createBodyEditor({
          store,
          getProject: () => store.project,
          ownerId: id, // lets this text hold figures and tables at exact spots
          value: info.node.body || '',
          label: isChapter ? t('Chapter introduction') : t('Text of {title}', { title: info.node.title }),
          placeholder: isChapter ? t('Write a short introduction for this chapter…') : t('Write the content of this section…'),
          minHeight: isChapter ? 72 : 96,
          onChange: (body) => commitBody(id, body),
        });
        host.append(editor.el);
        editors.push({ id, editor });
      });
    }

    const editorFor = (id) => editors.find((e) => e.id === id)?.editor || null;

    function fillItems(project) {
      container.querySelectorAll('[data-items]').forEach((host) => {
        const id = host.dataset.items;
        const html = itemsHTML(project, id, project.chapters.some((c) => c.id === id));
        if (host.__html !== html) { host.innerHTML = html; host.__html = html; }
      });
    }

    function render() {
      rendering = true;
      try {
        disposeEditors();
        const project = store.project;
        if (!project) return;
        if (!project.chapters.length) {
          container.innerHTML = `
            <div class="page wide chapters-page">
              <div class="page-header"><div class="titles"><h1>${t('Chapters')}</h1><p class="subtitle">${t('Write the text of your report, chapter by chapter.')}</p></div></div>
              <div class="card"><div class="empty-state"><div class="empty-icon">${icon('chapters')}</div><h3>${t('No chapters yet')}</h3><p>${t('Create the chapters of your report first, then come back here to write them.')}</p>
                <a class="btn btn-primary" href="${ctx.href('structure', null, { new: 'chapter' })}">${icon('plus')}${t('Add a chapter')}</a></div></div>
            </div>`;
          lastShape = '';
          return;
        }
        const chapter = project.chapters.find((c) => c.id === selectedId) || project.chapters[0];
        selectedId = chapter.id;
        selectedByProject.set(projectId, selectedId);
        const num = getNumbering(project);
        const keepScroll = container.scrollTop;
        container.innerHTML = `<div class="page wide chapters-page"><div class="ch-layout">${navHTML(project, chapter, num)}${mainHTML(project, chapter, num)}</div></div>`;
        container.scrollTop = keepScroll;
        fillItems(project);
        mountEditors(project);
        lastShape = shapeOf(project, selectedId);
      } finally {
        rendering = false;
      }
      afterRender();
    }

    function afterRender() {
      updateSpy();
      if (pending.focusTitle) {
        const id = pending.focusTitle; pending.focusTitle = null;
        const input = container.querySelector(`input[data-title="${CSS.escape(id)}"]`);
        if (input) {
          input.closest('.sec-card')?.scrollIntoView({ block: 'center' });
          input.focus({ preventScroll: true }); input.select();
          pulse(input.closest('.sec-card'));
        }
      }
      if (pending.flash) {
        const id = pending.flash; pending.flash = null;
        const el = container.querySelector(`#sec-${CSS.escape(id)}`) || container.querySelector(`#ch-head[data-id="${CSS.escape(id)}"]`);
        if (el) requestAnimationFrame(() => flash(el));
      }
    }

    /** Update labels in place (titles, statuses, item lists) without touching focused editors. */
    function patch() {
      const project = store.project;
      const chapter = project.chapters.find((c) => c.id === selectedId);
      if (!chapter) { render(); return; }
      const num = getNumbering(project);
      const setInput = (input, title) => { input.dataset.orig = title; if (document.activeElement !== input) input.value = title; };

      container.querySelectorAll('input[data-title]').forEach((input) => {
        const info = ops.locate(project, input.dataset.title);
        if (info) setInput(input, info.node.title);
      });
      container.querySelectorAll('select[data-status]').forEach((sel) => {
        const info = ops.locate(project, sel.dataset.status);
        if (!info) return;
        sel.value = info.node.status;
        sel.className = `select select-sm sec-status s-${info.node.status}`;
      });
      container.querySelectorAll('[data-nav-title]').forEach((span) => {
        const info = ops.locate(project, span.dataset.navTitle);
        if (info && span.textContent !== info.node.title) span.textContent = info.node.title;
      });
      container.querySelectorAll('[data-nav-sec]').forEach((btn) => {
        const info = ops.locate(project, btn.dataset.navSec);
        const dot = btn.querySelector('.dot');
        if (info && dot) dot.className = `dot s-${info.node.status}`;
      });
      const select = container.querySelector('[data-chapter-select]');
      if (select) [...select.options].forEach((opt) => {
        const c = project.chapters.find((x) => x.id === opt.value);
        if (c) { const text = `${num.chapters.get(c.id).label}: ${c.title}`; if (opt.textContent !== text) opt.textContent = text; }
      });
      const current = container.querySelector('.ch-nav-current');
      if (current) current.textContent = `${num.chapters.get(chapter.id).label}: ${chapter.title}`;
      const prefix = container.querySelector('[data-ch-prefix]');
      if (prefix) prefix.textContent = chapterPrefix(project, chapter);
      container.querySelector('.ch-heading')?.classList.toggle('upper', project.settings.chapterTitle?.style === 'upper');
      const prog = ops.progressOf(chapter.sections);
      const progEl = container.querySelector('[data-ch-progress]');
      if (progEl) {
        progEl.querySelector('.bar i').style.width = `${prog.percent}%`;
        progEl.querySelector('.ch-progress-text').textContent = ops.progressText(prog);
      }
      container.querySelectorAll('.ch-page strong').forEach((strong) => {
        const c = project.chapters.find((x) => x.id === strong.closest('.ch-page').dataset.chapter);
        if (c) strong.textContent = `${num.chapters.get(c.id).label}: ${c.title}`;
      });
      fillItems(project);
      // A body can change without this editor knowing (a figure moved here from another section, a broken line removed).
      for (const { id, editor } of editors) {
        const info = ops.locate(project, id);
        if (info) editor.sync(info.node.body || '');
      }
    }

    const stop = store.on('change', () => {
      if (rendering || !store.project) return;
      if (shapeOf(store.project, selectedId) !== lastShape) render(); else patch();
    });
    disposer.add(stop);

    // ------------------------------------------------------------------ navigation / scroll spy
    function selectChapter(id, { top = true } = {}) {
      if (!store.project.chapters.some((c) => c.id === id)) return;
      selectedId = id;
      render();
      if (top) container.scrollTop = 0;
    }

    function setNavActive(id) {
      const buttons = [...container.querySelectorAll('[data-nav-sec]')];
      let active = null;
      for (const b of buttons) {
        const on_ = b.dataset.navSec === id;
        b.classList.toggle('active', on_);
        if (on_) { b.setAttribute('aria-current', 'location'); active = b; } else b.removeAttribute('aria-current');
      }
      const list = container.querySelector('.ch-nav-list');
      if (active && list && list.scrollHeight > list.clientHeight + 2) {
        const lr = list.getBoundingClientRect(); const br = active.getBoundingClientRect();
        if (br.top < lr.top + 6) list.scrollTop -= lr.top + 6 - br.top;
        else if (br.bottom > lr.bottom - 6) list.scrollTop += br.bottom - lr.bottom + 6;
      }
    }

    function updateSpy() {
      const cards = [...container.querySelectorAll('.sec-card')];
      if (!cards.length) return;
      const limit = container.getBoundingClientRect().top + Math.min(280, Math.max(110, container.clientHeight * 0.3));
      let current = null;
      for (const c of cards) { if (c.getBoundingClientRect().top <= limit) current = c.dataset.id; else break; }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) current = cards[cards.length - 1].dataset.id;
      setNavActive(current);
    }
    const onScroll = () => { if (!spyFrame) spyFrame = requestAnimationFrame(() => { spyFrame = 0; updateSpy(); }); };
    container.addEventListener('scroll', onScroll, { passive: true });
    disposer.add(() => { container.removeEventListener('scroll', onScroll); cancelAnimationFrame(spyFrame); });

    // ------------------------------------------------------------------ actions
    function addSectionTo(parentId) {
      const parentTitle = ops.locate(store.project, parentId)?.node.title || t('chapter');
      let newId = null;
      store.update((p) => { newId = ops.addSection(p, parentId)?.id; }, { activity: t('Added a section under “{title}”', { title: iso(parentTitle) }) });
      if (newId) { pending.focusTitle = newId; render(); }
    }

    disposer.add(on(container, 'click', '[data-nav-ch]', (e, el) => {
      const id = el.dataset.navCh;
      if (id === selectedId) { container.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      selectChapter(id);
    }));
    disposer.add(on(container, 'click', '[data-nav-sec]', (e, el) => {
      const card = container.querySelector(`#sec-${CSS.escape(el.dataset.navSec)}`);
      if (!card) return;
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      pulse(card.querySelector('.sec-head'));
      container.querySelector('.ch-nav')?.classList.remove('open');
      container.querySelector('[data-action="nav-toggle"]')?.setAttribute('aria-expanded', 'false');
    }));
    disposer.add(on(container, 'click', '[data-chapter]', (e, el) => selectChapter(el.dataset.chapter)));
    /** "In this section" actions: put an item in the text, jump to it, or drop a broken placement line. */
    function placementAction(action, el) {
      const { kind, id, owner } = el.dataset;
      const editor = editorFor(owner);
      if (!editor) return;
      if (action === 'place') {
        if (editor.placeItem(kind, id, 'end')) editor.reveal(kind, id);
      } else if (action === 'show-placed') {
        editor.reveal(kind, id);
      } else if (action === 'drop-placement') {
        editor.flush(); // the stored body must be current before a line is removed
        const line = Number(el.dataset.line);
        store.update((p) => {
          const node = ops.locate(p, owner)?.node;
          if (!node) return;
          const lines = String(node.body || '').split('\n');
          const m = PLACE_RE.exec(lines[line] || '');
          // a missing item: every line of it goes; a duplicate: only that second copy
          if (el.dataset.reason === 'missing') node.body = removePlacements(node.body, kind, id);
          else if (m && m[1] === kind && m[2] === id) node.body = removeLine(node.body, line);
        });
      }
    }

    disposer.add(on(container, 'click', '[data-action]', (e, el) => {
      const action = el.dataset.action;
      if (action === 'place' || action === 'show-placed' || action === 'drop-placement') {
        placementAction(action, el);
      } else if (action === 'nav-toggle') {
        const nav = el.closest('.ch-nav');
        const open = nav.classList.toggle('open');
        el.setAttribute('aria-expanded', String(open));
      } else if (action === 'add-section') {
        addSectionTo(el.dataset.id);
      } else if (action === 'sec-menu') {
        const id = el.dataset.id;
        const project = store.project;
        const canAdd = ops.canAddChild(project, id);
        openMenu(el, [
          { label: t('Add subsection'), icon: 'plus', disabled: !canAdd, onClick: () => addSectionTo(id) },
          { label: t('Show in Project Structure'), icon: 'structure', onClick: () => ctx.navigate(ctx.href('structure', null, { focus: id })) },
        ], { align: isRTL ? 'start' : 'end' });
      }
    }));

    disposer.add(on(container, 'change', 'select[data-chapter-select]', (e, el) => selectChapter(el.value)));
    disposer.add(on(container, 'change', 'select[data-status]', (e, el) => {
      const id = el.dataset.status; const status = el.value;
      const info = ops.locate(store.project, id);
      if (!info) return;
      const label = SECTION_STATUSES.find((s) => s.value === status)?.label.toLowerCase();
      store.update((p) => { const n = ops.locate(p, id); if (n) n.node.status = status; }, { activity: { text: t('Marked “{title}” as {status}', { title: iso(info.node.title), status: label }), kind: 'edit', targetId: id } });
    }));
    disposer.add(on(container, 'change', 'input[data-title]', (e, el) => {
      const id = el.dataset.title;
      const info = ops.locate(store.project, id);
      if (!info) return;
      const value = el.value.trim();
      if (!value) { el.value = info.node.title; return; }
      if (value === info.node.title) return;
      store.update((p) => { const n = ops.locate(p, id); if (n) n.node.title = value; }, { activity: { text: t(info.kind === 'chapter' ? 'Renamed chapter “{title}”' : 'Renamed section “{title}”', { title: iso(value) }), kind: 'edit', targetId: id } });
    }));
    disposer.add(on(container, 'keydown', 'input[data-title]', (e, el) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); } else if (e.key === 'Escape') { e.preventDefault(); el.value = el.dataset.orig || el.value; el.blur(); }
    }));

    // ------------------------------------------------------------------ first render
    const q = ctx.params?.query || {};
    if (q.focus) {
      const info = ops.locate(store.project, q.focus);
      if (info) { selectedId = info.kind === 'chapter' ? info.node.id : info.chapter.id; pending.flash = q.focus; }
    }
    render();

    return {
      unmount() {
        disposer.dispose();
        disposeEditors();
      },
    };
  },
};
