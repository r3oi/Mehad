// References (#/p/<id>/references[/<referenceId>]): the bibliography of the report. Searchable list in the
// current numbering order, add / edit / delete (with undo), BibTeX import, style and order, "copy list".
// Citations in the text are {{ref:cite:<id>}} tokens (inserted with the Cite button of the chapter editor);
// the numbers [1], [2] … are derived (core/numbering.js).
import { esc, on, Disposer, highlight, flash } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { getNumbering } from '../core/numbering.js';
import { REF_RE, bodyOwners } from '../core/references.js';
import { REFERENCE_STYLES, formatReference, formatReferenceRuns, typeInfo } from '../core/bibliography.js';
import { t, isRTL } from '../i18n/index.js';
import { openReferenceDialog, openBibTeXImport, referenceName, runsHTML, iso, strong, tHTML, count } from './reference-dialog.js';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// "Compact (Surname I., "Title", …)": the sample stays left-to-right inside Arabic text.
const styleLabel = (s) => (s.id === 'compact' ? `${t('Compact')} (${isRTL ? '\u2066' : ''}Surname I., "Title", …${isRTL ? '\u2069' : ''})` : 'IEEE');

const ORDERS = [
  { id: 'citation', label: 'Order of first citation' },
  { id: 'alphabetical', label: 'Alphabetical (first author)' },
  { id: 'manual', label: 'Manual' },
];

/** How often and where each reference is cited: Map(id → { total, places: [title] }). */
export function citationStats(project) {
  const stats = new Map();
  for (const owner of bodyOwners(project)) {
    if (!owner.body.includes('{{ref:cite:')) continue;
    for (const m of owner.body.matchAll(REF_RE)) {
      if (m[1] !== 'cite') continue;
      const e = stats.get(m[2]) || { total: 0, places: [] };
      e.total += 1;
      if (!e.places.includes(owner.title)) e.places.push(owner.title);
      stats.set(m[2], e);
    }
  }
  return stats;
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export default {
  title: 'References',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;
    let query = '';
    let stats = { rev: -1, map: new Map() };

    container.innerHTML = `
      <div class="page ref-page">
        <div class="page-header">
          <div class="titles">
            <h1>${esc(t('References'))} <span class="badge badge-primary ref-count" data-count></span></h1>
            <p class="subtitle">${esc(t('The bibliography of your report. Cite an entry in the text with the Cite button in Chapters; the numbers update automatically.'))}</p>
          </div>
          <div class="actions">
            <button class="btn" data-action="import">${icon('upload')}${t('Import BibTeX')}</button>
            <button class="btn btn-primary" data-action="add">${icon('plus')}${t('Add Reference')}</button>
          </div>
        </div>
        <div data-region="controls"></div>
        <div data-region="list"></div>
      </div>`;
    const countEl = container.querySelector('[data-count]');
    const controlsEl = container.querySelector('[data-region="controls"]');
    const listEl = container.querySelector('[data-region="list"]');

    const project = () => store.project;
    const settings = () => project().settings.references || {};
    const usage = () => {
      if (stats.rev !== store.revision) stats = { rev: store.revision, map: citationStats(project()) };
      return stats.map;
    };

    // ----- Rendering ------------------------------------------------------------
    // The toolbar is rendered once so typing in the search box never loses focus.
    controlsEl.innerHTML = `
      <div class="toolbar ref-toolbar">
        <div class="input-group">${icon('search')}<input class="input" type="search" data-role="search" placeholder="${esc(t('Search authors, titles…'))}" aria-label="${esc(t('Search references'))}" autocomplete="off"></div>
        <span class="muted ref-result" data-result></span>
        <span class="spacer"></span>
        <label class="ref-ctl"><span>${t('Style')}</span>
          <select class="select select-sm" data-role="style" aria-label="${esc(t('Reference style'))}">${REFERENCE_STYLES.map((s) => `<option value="${s.id}">${esc(styleLabel(s))}</option>`).join('')}</select></label>
        <label class="ref-ctl"><span>${t('Order')}</span>
          <select class="select select-sm" data-role="order" aria-label="${esc(t('Reference order'))}">${ORDERS.map((o) => `<option value="${o.id}">${esc(t(o.label))}</option>`).join('')}</select></label>
        <button class="btn btn-sm" data-action="copy" data-tip="${esc(t('Copy the numbered list as plain text'))}">${icon('copy')}${t('Copy list')}</button>
      </div>
      <p class="ref-order-note" data-note></p>`;
    const searchEl = controlsEl.querySelector('[data-role="search"]');
    const styleEl = controlsEl.querySelector('[data-role="style"]');
    const orderEl = controlsEl.querySelector('[data-role="order"]');
    const resultEl = controlsEl.querySelector('[data-result]');
    const noteEl = controlsEl.querySelector('[data-note]');

    const renderControls = () => {
      const all = project().references;
      controlsEl.hidden = !all.length;
      if (document.activeElement !== styleEl) styleEl.value = settings().style || 'ieee';
      if (document.activeElement !== orderEl) orderEl.value = settings().order || 'citation';
      const mode = settings().order || 'citation';
      noteEl.textContent = mode === 'citation' ? t('Numbered in the order they are first cited in your text. References that are not cited yet come last.')
        : mode === 'alphabetical' ? t('Sorted alphabetically by the surname of the first author.')
          : t('Numbered in the order shown here. Use the arrows to reorder the list.');
    };

    const renderList = () => {
      if (!alive || !project()) return;
      const p = project();
      const n = getNumbering(p);
      const style = settings().style || 'ieee';
      const manual = (settings().order || 'citation') === 'manual';
      const all = n.referenceOrder;
      countEl.textContent = String(all.length);
      countEl.setAttribute('aria-label', count(all.length, '1 reference', '{n} references'));
      renderControls();

      if (!all.length) {
        resultEl.textContent = '';
        listEl.innerHTML = `
          <div class="card"><div class="empty-state ref-empty">
            <div class="empty-icon">${icon('book')}</div>
            <h3>${t('No references yet')}</h3>
            <p>${esc(t('Add the books, papers and websites you used, or import BibTeX (in Google Scholar choose Cite → BibTeX). Then cite them in Chapters with the Cite button; the numbers [1], [2] … update automatically.'))}</p>
            <div class="row" style="justify-content:center;flex-wrap:wrap">
              <button class="btn btn-primary" data-action="add">${icon('plus')}${t('Add Reference')}</button>
              <button class="btn" data-action="import">${icon('upload')}${t('Import BibTeX')}</button>
            </div>
          </div></div>`;
        return;
      }

      const q = query.trim();
      const rows = q ? all.filter((r) => [r.authors, r.title, r.container, r.custom, r.year, formatReference(r, style)].some((x) => norm(x).includes(norm(q)))) : all;
      resultEl.textContent = q ? t('{n} of {total} shown', { n: rows.length, total: all.length }) : '';
      if (!rows.length) {
        listEl.innerHTML = `
          <div class="card"><div class="empty-state" style="padding:40px 24px">
            <div class="empty-icon">${icon('search')}</div>
            <h3>${t('No matches')}</h3>
            <p>${esc(t('Nothing matches “{q}”. Try a different word or clear the search.', { q }))}</p>
            <button class="btn" data-action="clear-search">${t('Clear search')}</button>
          </div></div>`;
        return;
      }
      const used = usage();
      const mark = (text) => highlight(text, q);
      listEl.innerHTML = `
        <ol class="card ref-list">${rows.map((r) => {
          const info = n.references.get(r.id);
          const u = used.get(r.id);
          const index = all.indexOf(r);
          const cited = u
            ? `<span class="ref-cited" title="${esc(t('Cited in {places}', { places: u.places.map(iso).join(t(', ')) }))}">${icon('quote')}<bdi>${esc(t('Cited {n}×', { n: u.total }))}</bdi></span>`
            : `<span class="ref-uncited">${t('Not cited yet')}</span>`;
          const arrows = manual && !q ? `
            <button class="btn btn-ghost btn-icon btn-sm" data-action="up" data-id="${esc(r.id)}" ${index === 0 ? 'disabled' : ''} data-tip="${esc(t('Move up'))}" aria-label="${esc(t('Move up'))}">${icon('arrowUp')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" data-action="down" data-id="${esc(r.id)}" ${index === all.length - 1 ? 'disabled' : ''} data-tip="${esc(t('Move down'))}" aria-label="${esc(t('Move down'))}">${icon('arrowDown')}</button>` : '';
          const name = referenceName(r);
          return `
          <li class="ref-row" id="ref-${esc(r.id)}" data-id="${esc(r.id)}">
            <span class="ref-num" dir="ltr">${esc(info.label)}</span>
            <div class="ref-main">
              <div class="ref-text" dir="auto">${runsHTML(formatReferenceRuns(r, style), mark)}</div>
              <div class="ref-meta">
                <span class="badge ref-type">${esc(t(typeInfo(r.type).label))}</span>
                ${String(r.custom || '').trim() ? `<span class="badge" data-tip="${esc(t('This entry uses custom text'))}">${t('Custom text')}</span>` : ''}
                ${cited}
              </div>
            </div>
            <div class="ref-actions">
              ${arrows}
              <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-id="${esc(r.id)}" data-tip="${esc(t('Edit'))}" aria-label="${esc(t('Edit {name}', { name }))}">${icon('edit')}</button>
              <button class="btn btn-ghost btn-icon btn-sm ref-del" data-action="delete" data-id="${esc(r.id)}" data-tip="${esc(t('Delete'))}" aria-label="${esc(t('Delete {name}', { name }))}">${icon('trash')}</button>
            </div>
          </li>`;
        }).join('')}</ol>`;
    };

    // ----- Actions --------------------------------------------------------------
    const find = (id) => project().references.find((r) => r.id === id);

    function addReference() {
      openReferenceDialog(store, { onSaved: (ref) => flash(container.querySelector(`.ref-row[data-id="${CSS.escape(ref.id)}"]`)) });
    }
    function editReference(id) {
      const ref = find(id);
      if (ref) openReferenceDialog(store, { ref, onSaved: (saved) => flash(container.querySelector(`.ref-row[data-id="${CSS.escape(saved.id)}"]`)) });
    }

    async function removeReference(id) {
      const index = project().references.findIndex((r) => r.id === id);
      if (index < 0) return;
      const item = { ...project().references[index] };
      const name = referenceName(item);
      const times = usage().get(id)?.total || 0;
      const cited = times
        ? `<span style="display:block;margin-top:10px">${esc(times === 1
          ? t('It is cited 1 time in your text. That citation will show as [?] until you remove it, and it is reported in the Dashboard health checks.')
          : t('It is cited {n} times in your text. Those citations will show as [?] until you remove them, and they are reported in the Dashboard health checks.', { n: times }))}</span>`
        : '';
      const ok = await confirmDialog({
        title: t('Delete reference?'), danger: true, confirmText: t('Delete'),
        message: `<span style="display:block">${tHTML('{name} will be removed from your list of references.', { name: strong(name) })}</span>${cited}`,
      });
      if (!ok) return;
      store.update((p) => { const i = p.references.findIndex((r) => r.id === id); if (i >= 0) p.references.splice(i, 1); }, { activity: { text: `Deleted reference “${name}”`, kind: 'delete', targetId: id } });
      toast(t('Deleted “{name}”.', { name: iso(name) }), {
        type: 'success',
        action: {
          label: t('Undo'),
          onClick: () => {
            store.update((p) => { if (!p.references.some((r) => r.id === id)) p.references.splice(Math.min(index, p.references.length), 0, item); }, { activity: { text: `Restored reference “${name}”`, kind: 'revision', targetId: id } });
            toast(t('Restored “{name}”.', { name: iso(name) }), { type: 'success' });
          },
        },
      });
    }

    function move(id, delta) {
      const ref = find(id);
      if (!ref) return;
      store.update((p) => {
        const i = p.references.findIndex((r) => r.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= p.references.length) return;
        [p.references[i], p.references[j]] = [p.references[j], p.references[i]];
      }, { activity: { text: `Moved reference “${referenceName(ref)}”`, kind: 'edit', targetId: id } });
      requestAnimationFrame(() => {
        const row = container.querySelector(`.ref-row[data-id="${CSS.escape(id)}"]`);
        (row?.querySelector(`[data-action="${delta < 0 ? 'up' : 'down'}"]:not(:disabled)`) || row?.querySelector('[data-action="edit"]'))?.focus();
      });
    }

    async function copyList() {
      const n = getNumbering(project());
      if (!n.referenceOrder.length) { toast(t('Add at least one reference before copying.'), { type: 'info' }); return; }
      const style = settings().style || 'ieee';
      const text = n.referenceOrder.map((r) => `${n.references.get(r.id).label} ${formatReference(r, style)}`).join('\n');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
      if (!ok) ok = legacyCopy(text);
      if (ok) toast(count(n.referenceOrder.length, 'Copied 1 reference. Paste it into Word.', 'Copied {n} references. Paste them into Word.'), { type: 'success', title: t('Copied') });
      else toast(t('The browser did not allow clipboard access. Try again after clicking inside the page.'), { type: 'error', title: t('Could not copy') });
    }

    // ----- Events ---------------------------------------------------------------
    d.add(on(container, 'click', '[data-action]', (e, el) => {
      const { action, id } = el.dataset;
      if (action === 'add') addReference();
      else if (action === 'import') openBibTeXImport(store);
      else if (action === 'edit') editReference(id);
      else if (action === 'delete') removeReference(id);
      else if (action === 'up') move(id, -1);
      else if (action === 'down') move(id, 1);
      else if (action === 'copy') copyList();
      else if (action === 'clear-search') { query = ''; searchEl.value = ''; renderList(); searchEl.focus(); }
    }));
    d.add(on(container, 'input', '[data-role="search"]', (e, el) => { query = el.value; renderList(); }));
    d.add(on(container, 'change', '[data-role="style"]', (e, el) => {
      const style = el.value;
      store.update((p) => { p.settings.references = { ...p.settings.references, style }; }, { activity: 'Changed reference style' });
    }));
    d.add(on(container, 'change', '[data-role="order"]', (e, el) => {
      const order = el.value;
      store.update((p) => { p.settings.references = { ...p.settings.references, order }; }, { activity: 'Changed reference order' });
    }));
    d.add(store.on('change', renderList));

    ctx.shell.setBreadcrumbs([{ label: t('References') }]);
    renderList();

    // Deep links: #/p/<id>/references/<referenceId> (or ?focus=), ?new=1, ?import=1
    const q = ctx.params?.query || {};
    const focusId = ctx.params?.id || q.focus;
    if (focusId) {
      const row = container.querySelector(`.ref-row[data-id="${CSS.escape(focusId)}"]`);
      if (row) requestAnimationFrame(() => flash(row));
    }
    if (q.new === '1' || q.import === '1') {
      setTimeout(() => { if (alive) (q.import === '1' ? openBibTeXImport(store) : addReference()); }, 60);
    }

    return { unmount() { alive = false; d.dispose(); } };
  },
};
