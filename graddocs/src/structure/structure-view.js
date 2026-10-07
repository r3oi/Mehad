// Project Structure: manage the document skeleton (front matter + chapters → sections → subsections)
// with a live Table of Contents preview. Numbers are always derived from getNumbering().
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openMenu } from '../ui/menu.js';
import { openModal, confirmDialog, promptDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { FRONT_MATTER_KINDS, SECTION_STATUSES, createFrontMatterItem } from '../core/model.js';
import { getNumbering } from '../core/numbering.js';
import { buildDocument } from '../core/document.js';
import { resolveText } from '../core/references.js';
import { clone } from '../core/utils.js';
import { t, isRTL } from '../i18n/index.js';
import * as ops from './outline-ops.js';
import { createBodyEditor } from './body-editor.js';

// Expand/collapse state is remembered in memory per project while the app is open.
const collapsedByProject = new Map();

const FM_ICONS = { declaration: 'fileText', acknowledgements: 'fileText', abstract: 'fileText', toc: 'structure', lot: 'table', lof: 'figure', loa: 'acronym', custom: 'file' };
const wordsOf = (text) => (String(text).trim() ? String(text).trim().split(/\s+/).length : 0);
const STATUS_LABEL = Object.fromEntries(SECTION_STATUSES.map((s) => [s.value, s.label]));
const iso = ops.isolate; // keeps user titles inside translated sentences in their own direction

function pulse(el) {
  if (!el) return;
  el.classList.remove('highlight-flash');
  void el.offsetWidth;
  el.classList.add('highlight-flash');
}

export default {
  title: 'Project Structure',

  mount(container, ctx) {
    const { store } = ctx;
    const disposer = new Disposer();
    const projectId = store.project.id;
    if (!collapsedByProject.has(projectId)) collapsedByProject.set(projectId, new Set());
    const collapsed = collapsedByProject.get(projectId);

    let renaming = false;
    let pendingRender = false;
    let activeId = null; // roving tabindex target
    let dragId = null;
    let dropMarker = null; // { el, cls }
    const pending = { rename: null, focus: null, pulse: null, pulseFm: null, scroll: null };

    container.innerHTML = `
      <div class="page wide structure-page">
        <div class="page-header">
          <div class="titles">
            <h1>${t('Project Structure')}</h1>
            <p class="subtitle">${t('Plan the skeleton of your report. Chapter and section numbers update automatically wherever they appear.')}</p>
          </div>
          <div class="actions">
            <a class="btn" data-link="chapters">${icon('chapters')}${t('Write chapters')}</a>
            <button class="btn btn-primary" data-action="add-chapter">${icon('plus')}${t('Add Chapter')}</button>
          </div>
        </div>
        <div class="structure-grid">
          <div class="structure-main">
            <section class="card st-card" aria-labelledby="st-front-title">
              <div class="card-header">
                <div class="st-head-text"><h2 id="st-front-title">${t('Front Matter')}</h2><p>${t('Pages that come before Chapter 1.')}</p></div>
                <button class="btn btn-sm" data-action="fm-add">${icon('plus')}${t('Add page')}</button>
              </div>
              <ul class="fm-list" data-part="front"></ul>
            </section>
            <section class="card st-card" aria-labelledby="st-chapters-title">
              <div class="card-header">
                <div class="st-head-text"><h2 id="st-chapters-title">${t('Chapters')}</h2><p data-part="outline-sub"></p></div>
                <div class="btn-group">
                  <button class="btn btn-sm" data-action="expand-all" data-tip="${t('Expand everything')}">${icon('chevronDown')}<span class="hide-xs">${t('Expand')}</span></button>
                  <button class="btn btn-sm" data-action="collapse-all" data-tip="${t('Collapse everything')}">${icon('chevronUp')}<span class="hide-xs">${t('Collapse')}</span></button>
                </div>
              </div>
              <div data-part="outline"></div>
              <div class="st-card-foot"><button class="btn btn-sm btn-soft" data-action="add-chapter">${icon('plus')}${t('Add chapter')}</button>
                <span class="st-tip">${t('Drag rows to reorder, or press {keys} + arrow keys on a focused row.', { keys: '<kbd>Alt</kbd>' })}</span></div>
            </section>
          </div>
          <aside class="structure-side">
            <section class="card toc-card" aria-label="${t('Table of contents preview')}" data-part="toc"></section>
          </aside>
        </div>
      </div>`;
    const root = container.querySelector('.structure-page');
    const frontEl = root.querySelector('[data-part="front"]');
    const outlineEl = root.querySelector('[data-part="outline"]');
    const outlineSub = root.querySelector('[data-part="outline-sub"]');
    const tocEl = root.querySelector('[data-part="toc"]');
    root.querySelector('[data-link="chapters"]').href = ctx.href('chapters');

    // ------------------------------------------------------------------ helpers
    const titleOf = (id) => ops.locate(store.project, id)?.node.title ?? '';
    const rowOf = (id) => outlineEl.querySelector(`.ol-row[data-id="${CSS.escape(id)}"]`);

    function labelOf(project, id) {
      const n = getNumbering(project);
      if (n.chapters.has(id)) return `${n.chapters.get(id).label}: ${n.chapters.get(id).title}`;
      const s = n.sections.get(id);
      return s ? `${s.number} ${s.title}` : '';
    }

    // ------------------------------------------------------------------ rendering
    function frontHTML(project) {
      const list = project.frontMatter;
      if (!list.length) return `<li class="fm-empty">${t('No front matter pages. Add one to get started.')}</li>`;
      return list.map((item, i) => {
        const def = FRONT_MATTER_KINDS[item.kind] || FRONT_MATTER_KINDS.custom;
        const off = item.include === false;
        let sub = '';
        if (def.generated) {
          sub = { toc: t('Built from your chapters and sections'), lot: ops.countLabel(project.tables.length, 'table'), lof: ops.countLabel(project.figures.length, 'figure'), loa: ops.countLabel(project.acronyms.length, 'acronym') }[item.kind] || t('Generated automatically');
        } else {
          const words = wordsOf(resolveText(project, item.body));
          sub = words ? ops.countLabel(words, 'word') : t('No text yet');
        }
        return `
        <li class="fm-row ${off ? 'off' : ''}" data-fm="${esc(item.id)}">
          <label class="switch fm-switch" data-tip="${off ? t('Excluded from the document') : t('Included in the document')}">
            <input type="checkbox" data-action="fm-include" data-id="${esc(item.id)}" ${off ? '' : 'checked'}>
            <span class="track"></span><span class="sr-only">${t('Include {title}', { title: iso(esc(item.title)) })}</span>
          </label>
          <span class="fm-icon">${icon(FM_ICONS[item.kind] || 'file')}</span>
          <div class="fm-main">
            <div class="fm-title" data-title dir="auto">${esc(item.title)}</div>
            <div class="fm-sub">${def.generated ? `<span class="fm-auto-sm">${t('Auto-generated')} · </span>` : ''}${esc(sub)}</div>
          </div>
          ${def.generated ? `<span class="badge badge-info" data-tip="${t('Filled in automatically from your project')}">${icon('sparkles')}${t('Auto-generated')}</span>` : ''}
          <div class="fm-actions">
            ${def.hasBody ? `<button class="btn btn-sm" data-action="fm-edit" data-id="${esc(item.id)}">${icon('edit')}<span class="hide-xs">${t('Edit text')}</span></button>` : ''}
            <button class="btn btn-ghost btn-icon btn-sm fm-move" data-action="fm-up" data-id="${esc(item.id)}" aria-label="${t('Move up')}" data-tip="${t('Move up')}" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
            <button class="btn btn-ghost btn-icon btn-sm fm-move" data-action="fm-down" data-id="${esc(item.id)}" aria-label="${t('Move down')}" data-tip="${t('Move down')}" ${i === list.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="fm-menu" data-id="${esc(item.id)}" aria-label="${t('More actions')}" aria-haspopup="menu">${icon('more')}</button>
          </div>
        </li>`;
      }).join('');
    }

    function countsHTML(c) {
      if (!c || (!c.figures && !c.tables)) return '<span class="ol-counts"></span>';
      return `<span class="ol-counts">${c.figures ? `<span class="ol-count" data-tip="${ops.countLabel(c.figures, 'figure')}">${icon('figure')}${c.figures}</span>` : ''}${c.tables ? `<span class="ol-count" data-tip="${ops.countLabel(c.tables, 'table')}">${icon('table')}${c.tables}</span>` : ''}</span>`;
    }

    function rowHTML(project, node, kind, depth, num, counts) {
      const kids = node.sections || [];
      const open = !collapsed.has(node.id);
      const info = kind === 'chapter' ? num.chapters.get(node.id) : num.sections.get(node.id);
      const label = kind === 'chapter' ? `${info.label}:` : info.number;
      const canAdd = ops.canAddChild(project, node.id);
      const addLabel = kind === 'chapter' ? t('Add section') : t('Add subsection');
      let meta = '';
      if (kind === 'chapter') {
        const pr = ops.progressOf(kids);
        meta = pr.total ? `<span class="ol-prog" data-tip="${t(pr.total === 1 ? '{done} of 1 section done · {percent}% complete' : '{done} of {n} sections done · {percent}% complete', { done: pr.done, n: pr.total, percent: pr.percent })}"><span class="bar"><i style="width:${pr.percent}%"></i></span><span class="pct">${pr.percent}%</span></span>` : '';
      } else {
        meta = `<button class="ol-status s-${esc(node.status)}" data-action="status" data-tip="${t('Change status')}" aria-haspopup="menu"><i></i>${esc(STATUS_LABEL[node.status] || node.status)}</button>`;
      }
      const c = kind === 'chapter' ? counts.chapter.get(node.id) : counts.section.get(node.id);
      return `
        <div class="ol-row ${kind}" style="--lvl:${depth}" data-id="${esc(node.id)}" data-kind="${kind}" tabindex="${node.id === activeId ? 0 : -1}" draggable="true"
             aria-label="${esc(`${label} ${node.title}`)}">
          <span class="ol-grip" aria-hidden="true">${icon('grip')}</span>
          ${kids.length ? `<button class="ol-toggle" data-action="toggle" aria-label="${open ? t('Collapse') : t('Expand')}" aria-expanded="${open}" tabindex="-1">${icon('chevronRight')}</button>` : '<span class="ol-toggle-gap"></span>'}
          <span class="ol-num" dir="ltr">${esc(label)}</span>
          <span class="ol-title" dir="auto" data-title title="${esc(node.title)}">${esc(node.title)}</span>
          ${countsHTML(c)}
          ${meta}
          <span class="ol-actions">
            <button class="ol-act ol-act-extra" data-action="add" aria-label="${addLabel}" data-tip="${addLabel}" tabindex="-1" ${canAdd ? '' : 'disabled'}>${icon('plus')}</button>
            <button class="ol-act ol-act-extra" data-action="up" aria-label="${t('Move up')}" data-tip="${t('Move up')}" tabindex="-1" ${ops.canMoveUp(project, node.id) ? '' : 'disabled'}>${icon('arrowUp')}</button>
            <button class="ol-act ol-act-extra" data-action="down" aria-label="${t('Move down')}" data-tip="${t('Move down')}" tabindex="-1" ${ops.canMoveDown(project, node.id) ? '' : 'disabled'}>${icon('arrowDown')}</button>
            <button class="ol-act" data-action="menu" aria-label="${t('More actions')}" aria-haspopup="menu" tabindex="-1">${icon('more')}</button>
          </span>
        </div>`;
    }

    function sectionNodeHTML(project, sec, depth, num, counts) {
      const open = !collapsed.has(sec.id);
      const kids = sec.sections || [];
      return `<li class="ol-node" role="treeitem" aria-level="${depth + 1}" ${kids.length ? `aria-expanded="${open}"` : ''}>
        ${rowHTML(project, sec, 'section', depth, num, counts)}
        ${kids.length && open ? `<ul class="ol-children" role="group">${kids.map((s) => sectionNodeHTML(project, s, depth + 1, num, counts)).join('')}</ul>` : ''}
      </li>`;
    }

    function outlineHTML(project) {
      if (!project.chapters.length) {
        return `<div class="empty-state st-empty"><div class="empty-icon">${icon('chapters')}</div><h3>${t('No chapters yet')}</h3><p>${t('Start with the chapters your university requires, for example Introduction, Background, Analysis, Design, Implementation and Conclusion.')}</p><button class="btn btn-primary" data-action="add-chapter">${icon('plus')}${t('Add your first chapter')}</button></div>`;
      }
      const num = getNumbering(project);
      const counts = ops.placementCounts(num);
      return `<ul class="ol-tree" role="tree" aria-label="${t('Chapters and sections')}">${project.chapters.map((ch) => {
        const open = !collapsed.has(ch.id);
        const kids = ch.sections || [];
        return `<li class="ol-node ol-chapter-node" role="treeitem" aria-level="1" ${kids.length ? `aria-expanded="${open}"` : ''}>
          ${rowHTML(project, ch, 'chapter', 0, num, counts)}
          ${kids.length && open ? `<ul class="ol-children" role="group">${kids.map((s) => sectionNodeHTML(project, s, 1, num, counts)).join('')}</ul>` : ''}
        </li>`;
      }).join('')}</ul>`;
    }

    function tocHTML(project) {
      const doc = buildDocument(project);
      const font = String(project.settings.typography?.fontFamily || 'Times New Roman').replace(/['"\\;{}]/g, '');
      const prog = ops.projectProgress(project);
      const chapterBold = project.settings.chapterTitle?.style === 'upper' ? 'upper' : 'title';
      const line = (id, text, cls, lvl) => `<div class="toc-line ${cls}" data-toc="${esc(id)}" style="--toc-lvl:${lvl}" role="button" tabindex="0"><span class="toc-text">${esc(text)}</span><span class="toc-leader" aria-hidden="true"></span><span class="toc-page" aria-hidden="true">—</span></div>`;
      const lines = [];
      for (const f of doc.front.filter((x) => x.kind !== 'toc')) lines.push(line(f.id, f.title, 'toc-front', 0));
      for (const entry of doc.toc) lines.push(line(entry.id, entry.text, entry.kind === 'chapter' ? `toc-chapter ${chapterBold}` : 'toc-sec', entry.kind === 'chapter' ? 0 : entry.level - 1));
      const empty = !doc.toc.length;
      return `
        <div class="card-header">
          <div class="st-head-text"><h2>${t('Table of Contents')}</h2><p>${t('Live preview of your document')}</p></div>
          <a class="btn btn-sm btn-ghost" href="${ctx.href('preview')}" data-tip="${t('Open Document Preview')}">${icon('preview')}<span class="hide-xs">${t('Preview')}</span></a>
        </div>
        <div class="toc-stats">
          <div class="toc-stat"><strong>${project.chapters.length}</strong><span>${project.chapters.length === 1 ? t('Chapter') : t('Chapters')}</span></div>
          <div class="toc-stat"><strong>${prog.total}</strong><span>${prog.total === 1 ? t('Section') : t('Sections')}</span></div>
          <div class="toc-stat"><strong>${prog.percent}%</strong><span>${t('Complete')}</span></div>
        </div>
        <div class="toc-bar" aria-hidden="true"><span style="width:${Math.max(prog.percent, prog.total ? 2 : 0)}%"></span></div>
        <div class="toc-scroll">
          <div class="toc-paper" dir="ltr" style="font-family:'${esc(font)}','Times New Roman',Times,serif">
            <div class="toc-heading">Table of Contents</div>
            ${empty && !lines.length ? `<p class="toc-empty" dir="auto">${t('Add chapters to see them listed here.')}</p>` : lines.join('')}
            ${empty && lines.length ? `<p class="toc-empty" dir="auto">${t('Chapters will be listed here.')}</p>` : ''}
          </div>
        </div>
        <div class="toc-foot">${icon('info', 'icon-sm')}<span>${t('Page numbers are calculated in {link}.', { link: `<a href="${ctx.href('preview')}">${t('Document Preview')}</a>` })}</span></div>
        `;
    }

    function render() {
      const project = store.project;
      if (!project) return;
      frontEl.innerHTML = frontHTML(project);
      outlineEl.innerHTML = outlineHTML(project);
      const prog = ops.projectProgress(project);
      outlineSub.textContent = `${ops.countLabel(project.chapters.length, 'chapter')} · ${ops.countLabel(prog.total, 'section')}`;
      tocEl.innerHTML = tocHTML(project);
      if (!activeId || !rowOf(activeId)) {
        activeId = project.chapters[0]?.id || null;
        const first = activeId && rowOf(activeId);
        if (first) first.tabIndex = 0;
      }
      afterRender();
    }

    function afterRender() {
      if (pending.rename) {
        const id = pending.rename; pending.rename = null;
        const row = rowOf(id);
        if (row) { row.scrollIntoView({ block: 'nearest' }); startOutlineRename(id); }
      }
      if (pending.focus) {
        const row = rowOf(pending.focus);
        pending.focus = null;
        row?.focus({ preventScroll: false });
      }
      if (pending.pulse) {
        const row = rowOf(pending.pulse);
        pending.pulse = null;
        pulse(row);
      }
      if (pending.pulseFm) {
        const row = frontEl.querySelector(`[data-fm="${CSS.escape(pending.pulseFm)}"]`);
        pending.pulseFm = null;
        pulse(row);
      }
      if (pending.scroll) {
        const el = pending.scroll.startsWith('fm_') ? frontEl.querySelector(`[data-fm="${CSS.escape(pending.scroll)}"]`) : rowOf(pending.scroll);
        pending.scroll = null;
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); pulse(el); }
      }
    }

    const stop = store.on('change', () => {
      if (renaming) { pendingRender = true; return; }
      render();
    });
    disposer.add(stop);

    // ------------------------------------------------------------------ inline rename
    function startInline(host, current, onCommit, dragEl, focusId = null) {
      const titleEl = host.querySelector('[data-title]');
      if (!titleEl || renaming) return;
      renaming = true;
      const input = document.createElement('input');
      input.className = 'input input-sm ol-edit';
      input.value = current;
      input.maxLength = 200;
      input.setAttribute('aria-label', t('Title'));
      input.dir = 'auto';
      titleEl.replaceWith(input);
      if (dragEl) dragEl.draggable = false;
      input.focus(); input.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true; renaming = false; pendingRender = false;
        const value = input.value.trim();
        if (focusId) pending.focus = focusId;
        if (commit && value && value !== current) onCommit(value); else render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    function startOutlineRename(id) {
      const row = rowOf(id);
      const info = ops.locate(store.project, id);
      if (!row || !info) return;
      startInline(row, info.node.title, (value) => {
        pending.focus = id; pending.pulse = id;
        store.update((p) => { const n = ops.locate(p, id); if (n) n.node.title = value; }, { activity: { text: t(info.kind === 'chapter' ? 'Renamed chapter “{title}”' : 'Renamed section “{title}”', { title: iso(value) }), kind: 'edit', targetId: id } });
      }, row, id);
    }

    function startFrontRename(id) {
      const row = frontEl.querySelector(`[data-fm="${CSS.escape(id)}"]`);
      const item = store.project.frontMatter.find((f) => f.id === id);
      if (!row || !item || item.kind !== 'custom') return;
      startInline(row, item.title, (value) => {
        pending.pulseFm = id;
        store.update((p) => { const f = p.frontMatter.find((x) => x.id === id); if (f) f.title = value; }, { activity: t('Renamed page “{title}”', { title: iso(value) }) });
      });
    }

    // ------------------------------------------------------------------ actions: outline
    function collapseAll() {
      const visit = (list) => list.forEach((s) => { if (s.sections?.length) { collapsed.add(s.id); visit(s.sections); } });
      store.project.chapters.forEach((c) => { if (c.sections?.length) { collapsed.add(c.id); visit(c.sections); } });
    }

    function expandAncestors(id) {
      for (const a of ops.ancestorIds(store.project, id)) collapsed.delete(a);
    }

    async function addChapterFlow() {
      const title = await promptDialog({ title: t('Add chapter'), label: t('Chapter title'), placeholder: t('e.g. Literature Review'), submitText: t('Add chapter') });
      if (!title) return;
      let id = null;
      store.update((p) => { id = ops.addChapter(p, title).id; }, { activity: t('Added chapter “{title}”', { title: iso(title) }) });
      pending.scroll = id;
      render();
    }

    function addChild(id) {
      if (!ops.canAddChild(store.project, id)) { toast(t('Sections can be nested up to three levels (for example 1.4.2.1).'), { type: 'info' }); return; }
      let newId = null;
      const parentTitle = titleOf(id);
      collapsed.delete(id);
      store.update((p) => { newId = ops.addSection(p, id)?.id; }, { activity: t('Added a section under “{title}”', { title: iso(parentTitle) }) });
      if (newId) { pending.rename = newId; render(); }
    }

    function move(id, delta) {
      const title = titleOf(id);
      let moved = false;
      store.update((p) => { moved = ops.moveBy(p, id, delta); }, { activity: { text: t('Moved “{title}”', { title: iso(title) }), kind: 'edit', targetId: id } });
      pending.focus = id; pending.pulse = id;
      if (moved) render(); else pending.focus = pending.pulse = null;
    }

    function doIndent(id, dir) {
      const title = titleOf(id);
      const ok = dir > 0 ? ops.canIndent(store.project, id) : ops.canOutdent(store.project, id);
      if (!ok) {
        if (dir > 0 && ops.locate(store.project, id)?.index > 0) toast(t('Sections can be nested up to three levels deep.'), { type: 'info' });
        return;
      }
      if (dir > 0) {
        const prev = ops.locate(store.project, id);
        collapsed.delete(prev.siblings[prev.index - 1].id);
      }
      store.update((p) => { if (dir > 0) ops.indent(p, id); else ops.outdent(p, id); }, { activity: { text: t(dir > 0 ? 'Indented “{title}”' : 'Outdented “{title}”', { title: iso(title) }), kind: 'edit', targetId: id } });
      pending.focus = id; pending.pulse = id;
      render();
    }

    async function deleteFlow(id) {
      const project = store.project;
      const info = ops.locate(project, id);
      if (!info) return;
      const impact = ops.deletionImpact(project, id);
      const label = labelOf(project, id);
      const title = info.node.title;
      const isChapter = info.kind === 'chapter';
      const strong = (text) => `<strong><bdi>${esc(text)}</bdi></strong>`;
      const parts = [`<span style="display:block">${impact.subsections
        ? t(impact.subsections === 1 ? 'Delete {label} and its 1 subsection?' : 'Delete {label} and its {n} subsections?', { label: strong(label), n: impact.subsections })
        : t('Delete {label}?', { label: strong(label) })}</span>`];
      const items = [impact.figures && ops.countLabel(impact.figures, 'figure'), impact.tables && ops.countLabel(impact.tables, 'table')].filter(Boolean);
      if (items.length) {
        const placed = items.length === 2 ? t('{a} and {b}', { a: items[0], b: items[1] }) : items[0];
        const dest = isChapter
          ? t('They will become {unassigned} (they stay in the Figures and Tables lists and appear at the end of the document).', { unassigned: `<strong>${t('unassigned')}</strong>` })
          : t('They will be moved to {target}.', { target: strong(labelOf(project, impact.parentId)) });
        const placedText = t(impact.figures + impact.tables === 1 ? '{items} is placed inside.' : '{items} are placed inside.', { items: `<strong>${esc(placed)}</strong>` });
        parts.push(`<span style="display:block;margin-top:10px">${placedText} ${dest}</span>`);
      } else {
        parts.push(`<span style="display:block;margin-top:10px">${t('No figures or tables are placed inside.')}</span>`);
      }
      const broken = '<bdi dir="ltr" style="white-space:nowrap">“Section ??”</bdi>';
      const refsText = impact.brokenRefs
        ? t(impact.brokenRefs === 1 ? 'Cross references to deleted sections will show as broken ({broken}); {refs} in your text is affected.' : 'Cross references to deleted sections will show as broken ({broken}); {refs} in your text are affected.', { broken, refs: `<strong>${ops.countLabel(impact.brokenRefs, 'reference')}</strong>` })
        : t('Cross references to deleted sections will show as broken ({broken}).', { broken });
      parts.push(`<span style="display:block;margin-top:10px">${refsText}</span>`);
      const ok = await confirmDialog({ title: isChapter ? t('Delete chapter') : t('Delete section'), message: parts.join(''), confirmText: isChapter ? t('Delete chapter') : t('Delete section'), danger: true });
      if (!ok) { pending.focus = id; afterRender(); return; }
      const snapshot = clone({ chapters: store.project.chapters, figures: store.project.figures, tables: store.project.tables });
      const neighbour = info.siblings[info.index + 1] || info.siblings[info.index - 1] || info.parent || (info.kind === 'section' ? info.chapter : null);
      store.update((p) => { ops.deleteNode(p, id); }, { activity: t(isChapter ? 'Deleted chapter “{title}”' : 'Deleted section “{title}”', { title: iso(title) }) });
      if (neighbour) { activeId = neighbour.id; pending.focus = neighbour.id; }
      render();
      toast(t('Deleted “{title}”', { title: iso(title) }), {
        type: 'success', duration: 6000,
        action: {
          label: t('Undo'),
          onClick: () => store.update((p) => { p.chapters = snapshot.chapters; p.figures = snapshot.figures; p.tables = snapshot.tables; }, { activity: t(isChapter ? 'Restored chapter “{title}”' : 'Restored section “{title}”', { title: iso(title) }) }),
        },
      });
    }

    function statusMenu(btn, id) {
      const node = ops.locate(store.project, id)?.node;
      if (!node) return;
      openMenu(btn, [
        { heading: t('Section status') },
        ...SECTION_STATUSES.map((s) => ({
          label: s.label, icon: s.value === node.status ? 'check' : undefined,
          onClick: () => store.update((p) => { const n = ops.locate(p, id); if (n) n.node.status = s.value; }, { activity: { text: t('Marked “{title}” as {status}', { title: iso(node.title), status: s.label.toLowerCase() }), kind: 'edit', targetId: id } }),
        })),
      ]);
    }

    function rowMenu(anchor, id) {
      const project = store.project;
      const info = ops.locate(project, id);
      if (!info) return;
      const chapter = info.kind === 'chapter';
      const items = [
        { label: t('Write content'), icon: 'chapters', shortcut: '↵', onClick: () => ctx.navigate(ctx.href('chapters', null, { focus: id })) },
        { label: t('Rename'), icon: 'edit', shortcut: ops.ltr('F2'), onClick: () => startOutlineRename(id) },
        { label: chapter ? t('Add section') : t('Add subsection'), icon: 'plus', disabled: !ops.canAddChild(project, id), onClick: () => addChild(id) },
        '-',
        { label: t('Move up'), icon: 'arrowUp', shortcut: ops.ltr('Alt ↑'), disabled: !ops.canMoveUp(project, id), onClick: () => move(id, -1) },
        { label: t('Move down'), icon: 'arrowDown', shortcut: ops.ltr('Alt ↓'), disabled: !ops.canMoveDown(project, id), onClick: () => move(id, 1) },
        !chapter && { label: t('Indent'), icon: 'indent', shortcut: ops.ltr(`Alt ${ops.ARROW_FORWARD}`), disabled: !ops.canIndent(project, id), onClick: () => doIndent(id, 1) },
        !chapter && { label: t('Outdent'), icon: 'outdent', shortcut: ops.ltr(`Alt ${ops.ARROW_BACK}`), disabled: !ops.canOutdent(project, id), onClick: () => doIndent(id, -1) },
        '-',
        { label: chapter ? t('Delete chapter…') : t('Delete section…'), icon: 'trash', danger: true, shortcut: ops.ltr('Del'), onClick: () => deleteFlow(id) },
      ].filter(Boolean);
      openMenu(anchor, items, { align: anchor instanceof Element && !isRTL ? 'end' : 'start' });
    }

    // ------------------------------------------------------------------ actions: front matter
    async function addPageFlow() {
      const title = await promptDialog({ title: t('Add page'), label: t('Page title'), placeholder: t('e.g. Dedication'), submitText: t('Add page') });
      if (!title) return;
      let id = null;
      store.update((p) => { const item = createFrontMatterItem('custom', { title }); id = item.id; p.frontMatter.push(item); }, { activity: t('Added front matter page “{title}”', { title: iso(title) }) });
      pending.scroll = id;
      render();
    }

    function moveFront(id, delta) {
      store.update((p) => {
        const i = p.frontMatter.findIndex((f) => f.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.frontMatter.length) return;
        [p.frontMatter[i], p.frontMatter[j]] = [p.frontMatter[j], p.frontMatter[i]];
      }, { activity: t('Reordered front matter') });
      pending.pulseFm = id;
      render();
    }

    async function deleteFront(id) {
      const item = store.project.frontMatter.find((f) => f.id === id);
      if (!item) return;
      const ok = await confirmDialog({ title: t('Delete page'), message: t(item.body ? 'Delete the page {title} and its text?' : 'Delete the page {title}?', { title: `<strong><bdi>${esc(item.title)}</bdi></strong>` }), confirmText: t('Delete page'), danger: true });
      if (!ok) return;
      store.update((p) => { p.frontMatter = p.frontMatter.filter((f) => f.id !== id); }, { activity: t('Deleted front matter page “{title}”', { title: iso(item.title) }) });
    }

    function editFrontBody(id) {
      const item = store.project.frontMatter.find((f) => f.id === id);
      if (!item) return;
      const def = FRONT_MATTER_KINDS[item.kind] || FRONT_MATTER_KINDS.custom;
      if (!def.hasBody) return;
      const editor = createBodyEditor({
        store,
        getProject: () => store.project,
        value: item.body || '',
        label: item.title,
        minHeight: 240,
        placeholder: item.kind === 'abstract' ? t('Summarise the problem, your solution and the main results…') : item.kind === 'declaration' ? t('We hereby declare that this report is our own work…') : t('Write the text of this page…'),
        onChange: (body) => store.update((p) => { const f = p.frontMatter.find((x) => x.id === id); if (f) f.body = body; }, { activity: { text: t('Edited “{title}”', { title: iso(item.title) }), kind: 'edit', targetId: id } }),
      });
      const wrap = document.createElement('div');
      wrap.className = 'fm-modal-body';
      wrap.append(editor.el);
      const modal = openModal({
        title: item.title,
        subtitle: t('Appears on its own page before Chapter 1. Changes are saved automatically.'),
        size: 'lg',
        body: wrap,
        footer: `<button class="btn btn-primary" data-close>${t('Done')}</button>`,
        onClose: () => editor.destroy(),
      });
      setTimeout(() => { if (modal.root.isConnected) editor.focus(); }, 80);
    }

    function frontMenu(anchor, id) {
      const project = store.project;
      const i = project.frontMatter.findIndex((f) => f.id === id);
      const item = project.frontMatter[i];
      if (!item) return;
      const def = FRONT_MATTER_KINDS[item.kind] || FRONT_MATTER_KINDS.custom;
      const items = [
        def.hasBody && { label: t('Edit text'), icon: 'edit', onClick: () => editFrontBody(id) },
        item.kind === 'custom' && { label: t('Rename'), icon: 'edit', onClick: () => startFrontRename(id) },
        { label: item.include === false ? t('Include in document') : t('Exclude from document'), icon: item.include === false ? 'eye' : 'eyeOff', onClick: () => store.update((p) => { const f = p.frontMatter.find((x) => x.id === id); if (f) f.include = f.include === false; }, { activity: t(item.include === false ? 'Included “{title}”' : 'Excluded “{title}”', { title: iso(item.title) }) }) },
        '-',
        { label: t('Move up'), icon: 'arrowUp', disabled: i === 0, onClick: () => moveFront(id, -1) },
        { label: t('Move down'), icon: 'arrowDown', disabled: i === project.frontMatter.length - 1, onClick: () => moveFront(id, 1) },
        item.kind === 'custom' && '-',
        item.kind === 'custom' && { label: t('Delete page…'), icon: 'trash', danger: true, onClick: () => deleteFront(id) },
      ].filter(Boolean);
      openMenu(anchor, items, { align: isRTL ? 'start' : 'end' });
    }

    // ------------------------------------------------------------------ events
    disposer.add(on(root, 'click', '[data-action]', (e, el) => {
      const action = el.dataset.action;
      const rowEl = el.closest('.ol-row');
      const id = rowEl?.dataset.id || el.dataset.id;
      switch (action) {
        case 'add-chapter': addChapterFlow(); break;
        case 'fm-add': addPageFlow(); break;
        case 'fm-edit': editFrontBody(id); break;
        case 'fm-up': moveFront(id, -1); break;
        case 'fm-down': moveFront(id, 1); break;
        case 'fm-menu': frontMenu(el, id); break;
        case 'expand-all': collapsed.clear(); render(); break;
        case 'collapse-all': collapseAll(); render(); break;
        case 'toggle': {
          if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
          activeId = id; pending.focus = id;
          render();
          break;
        }
        case 'status': statusMenu(el, id); break;
        case 'add': addChild(id); break;
        case 'up': move(id, -1); break;
        case 'down': move(id, 1); break;
        case 'menu': activeId = id; rowMenu(el, id); break;
        default: break;
      }
    }));

    disposer.add(on(root, 'change', '[data-action="fm-include"]', (e, el) => {
      const id = el.dataset.id; const checked = el.checked;
      const item = store.project.frontMatter.find((f) => f.id === id);
      store.update((p) => { const f = p.frontMatter.find((x) => x.id === id); if (f) f.include = checked; }, { activity: t(checked ? 'Included “{title}”' : 'Excluded “{title}”', { title: iso(item?.title ?? '') }) });
    }));

    disposer.add(on(root, 'dblclick', '.ol-title', (e, el) => { const id = el.closest('.ol-row')?.dataset.id; if (id) startOutlineRename(id); }));
    disposer.add(on(root, 'dblclick', '.fm-title', (e, el) => {
      const id = el.closest('[data-fm]')?.dataset.fm;
      const item = store.project.frontMatter.find((f) => f.id === id);
      if (!item) return;
      if (item.kind === 'custom') startFrontRename(id); else if ((FRONT_MATTER_KINDS[item.kind] || {}).hasBody) editFrontBody(id);
    }));

    // Context menu on rows
    disposer.add(on(root, 'contextmenu', '.ol-row', (e, row) => {
      if (e.target.closest('input')) return;
      e.preventDefault();
      activeId = row.dataset.id;
      rowMenu({ x: e.clientX, y: e.clientY }, row.dataset.id);
    }));

    // Roving focus + keyboard
    disposer.add(on(root, 'focusin', '.ol-row', (e, row) => {
      activeId = row.dataset.id;
      outlineEl.querySelectorAll('.ol-row').forEach((r) => { r.tabIndex = r === row ? 0 : -1; });
    }));
    disposer.add(on(root, 'keydown', '.ol-row', (e, row) => {
      if (e.target !== row) return;
      const id = row.dataset.id;
      const rows = [...outlineEl.querySelectorAll('.ol-row')];
      const idx = rows.indexOf(row);
      const info = ops.locate(store.project, id);
      if (!info) return;
      const hasKids = (info.node.sections || []).length > 0;
      const key = e.key;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (key === 'ArrowUp') { e.preventDefault(); move(id, -1); } else if (key === 'ArrowDown') { e.preventDefault(); move(id, 1); } else if (key === ops.KEY_FORWARD) { e.preventDefault(); doIndent(id, 1); } else if (key === ops.KEY_BACK) { e.preventDefault(); doIndent(id, -1); }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (key === 'ArrowDown') { e.preventDefault(); rows[idx + 1]?.focus(); } else if (key === 'ArrowUp') { e.preventDefault(); rows[idx - 1]?.focus(); } else if (key === ops.KEY_FORWARD) {
        e.preventDefault();
        if (hasKids && collapsed.has(id)) { collapsed.delete(id); pending.focus = id; render(); } else if (hasKids) rows[idx + 1]?.focus();
      } else if (key === ops.KEY_BACK) {
        e.preventDefault();
        if (hasKids && !collapsed.has(id)) { collapsed.add(id); pending.focus = id; render(); } else {
          const parentId = info.kind === 'section' ? (info.parent ? info.parent.id : info.chapter.id) : null;
          if (parentId) rowOf(parentId)?.focus();
        }
      } else if (key === 'Home') { e.preventDefault(); rows[0]?.focus(); } else if (key === 'End') { e.preventDefault(); rows[rows.length - 1]?.focus(); } else if (key === 'F2') { e.preventDefault(); startOutlineRename(id); } else if (key === 'Enter') { e.preventDefault(); ctx.navigate(ctx.href('chapters', null, { focus: id })); } else if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); deleteFlow(id); } else if (key === '+' || key === 'Insert') { e.preventDefault(); addChild(id); } else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) {
        e.preventDefault();
        rowMenu(row.querySelector('[data-action="menu"]'), id);
      }
    }));

    // Table of contents: click a line to find it in the outline.
    function jumpTo(id) {
      if (!id) return;
      if (store.project.frontMatter.some((f) => f.id === id)) {
        const el = frontEl.querySelector(`[data-fm="${CSS.escape(id)}"]`);
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); pulse(el); }
        return;
      }
      const hidden = !rowOf(id);
      if (hidden) { expandAncestors(id); render(); }
      const row = rowOf(id);
      if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); pulse(row); }
    }
    disposer.add(on(tocEl, 'click', '[data-toc]', (e, el) => jumpTo(el.dataset.toc)));
    disposer.add(on(tocEl, 'keydown', '[data-toc]', (e, el) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo(el.dataset.toc); } }));

    // ------------------------------------------------------------------ drag and drop
    function clearMarker() {
      if (dropMarker) { dropMarker.el.classList.remove(dropMarker.cls); dropMarker = null; }
    }
    function mark(el, cls) {
      if (dropMarker && dropMarker.el === el && dropMarker.cls === cls) return;
      clearMarker();
      el.classList.add(cls);
      dropMarker = { el, cls };
    }

    function resolveDrop(srcId, rowEl, clientY) {
      const targetId = rowEl.dataset.id;
      if (!srcId || srcId === targetId) return null;
      const project = store.project;
      const src = ops.locate(project, srcId);
      const dst = ops.locate(project, targetId);
      if (!src || !dst) return null;
      const rect = rowEl.getBoundingClientRect();
      const fy = (clientY - rect.top) / Math.max(1, rect.height);
      const expanded = (dst.node.sections || []).length > 0 && !collapsed.has(targetId);
      let order;
      if (src.kind === 'chapter') order = fy < 0.5 ? ['before'] : ['after'];
      else if (dst.kind === 'chapter') order = [expanded ? 'first' : 'inside'];
      else if (expanded) order = fy < 0.28 ? ['before'] : ['first'];
      else if (fy < 0.28) order = ['before'];
      else if (fy > 0.72) order = ['after'];
      else order = ['inside', fy < 0.5 ? 'before' : 'after'];
      for (const position of order) {
        if (ops.validateMove(project, srcId, targetId, position).ok) return { targetId, position, expanded, kind: dst.kind };
      }
      return null;
    }

    function endDrag() {
      clearMarker();
      outlineEl.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
      dragId = null;
    }

    outlineEl.addEventListener('dragstart', (e) => {
      const row = e.target instanceof Element ? e.target.closest('.ol-row') : null;
      if (!row || renaming || e.target !== row) { if (row && e.target !== row) e.preventDefault(); return; }
      dragId = row.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* ignore */ }
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    outlineEl.addEventListener('dragover', (e) => {
      if (!dragId) return;
      const row = e.target instanceof Element ? e.target.closest('.ol-row') : null;
      const res = row ? resolveDrop(dragId, row, e.clientY) : null;
      if (!res) { clearMarker(); e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (res.position === 'after' && res.kind === 'chapter' && res.expanded) mark(row.closest('.ol-node'), 'drop-after-node');
      else mark(row, `drop-${res.position}`);
    });
    outlineEl.addEventListener('dragleave', (e) => { if (!outlineEl.contains(e.relatedTarget)) clearMarker(); });
    outlineEl.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const row = e.target instanceof Element ? e.target.closest('.ol-row') : null;
      const res = row ? resolveDrop(dragId, row, e.clientY) : null;
      const srcId = dragId;
      endDrag();
      if (!res) return;
      const title = titleOf(srcId);
      if (res.position === 'inside' || res.position === 'first') collapsed.delete(res.targetId);
      store.update((p) => { ops.moveNode(p, srcId, res.targetId, res.position); }, { activity: { text: t('Moved “{title}”', { title: iso(title) }), kind: 'edit', targetId: srcId } });
      pending.focus = srcId; pending.pulse = srcId;
      render();
    });
    outlineEl.addEventListener('dragend', endDrag);

    // ------------------------------------------------------------------ first render
    render();
    const q = ctx.params?.query || {};
    if (q.focus) {
      const id = q.focus;
      expandAncestors(id);
      render();
      pending.scroll = id;
      afterRender();
    }
    if (q.new === 'chapter') {
      history.replaceState(null, '', ctx.href('structure'));
      setTimeout(addChapterFlow, 60);
    }

    return {
      unmount() {
        disposer.dispose();
        endDrag();
      },
    };
  },
};
