// Review dialog: lists everything a Word sync would change, grouped, with checkboxes.
//   const selected = await openReviewDialog({ plan, fileName })   → Set of item ids, or null when cancelled
//   openAppliedDialog({ items, fileName })                       → read-only list of what a sync changed
import { esc, on } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { t } from '../i18n/index.js';
import { isolate } from './text-utils.js';

const GROUPS = [
  { id: 'structure', label: 'Chapters & sections', icon: 'structure' },
  { id: 'text', label: 'Text changes', icon: 'fileText' },
  { id: 'tables', label: 'Tables', icon: 'table' },
  { id: 'figures', label: 'Figures', icon: 'figure' },
  { id: 'acronyms', label: 'Acronyms', icon: 'acronym' },
  { id: 'references', label: 'References', icon: 'book' },
  { id: 'front', label: 'Front matter', icon: 'chapters' },
];
const KIND = {
  add: { label: 'Added', cls: 'badge-success' },
  update: { label: 'Updated', cls: 'badge-info' },
  rename: { label: 'Renamed', cls: 'badge-primary' },
  move: { label: 'Moved', cls: 'badge-primary' },
  reorder: { label: 'Reordered', cls: 'badge-primary' },
  remove: { label: 'Removed', cls: 'badge-danger' },
};
const COLLAPSE_AFTER = 8;

/** Messages for parser warnings, keyed by warning code. */
export const WARNING_TEXT = {
  'no-headings': 'No headings were found. In Word, use Heading 1 for chapters and Heading 2–4 for sections.',
  'pseudo-headings': 'This file does not use Word’s heading styles, so chapters were guessed from bold and numbered lines. Heading styles give more reliable results.',
  drawings: '{n} drawings (charts, shapes or text boxes) cannot be imported. Paste them into Word as pictures.',
  'images-unsupported': '{n} pictures use a format browsers cannot show (EMF or WMF) and were skipped.',
  'images-missing': '{n} linked pictures could not be found inside the file.',
  'images-small': '{n} very small images (icons and logos) were skipped.',
  'table-images': '{n} pictures inside tables that also contain text were skipped.',
};

/** Translated, escaped one-line description of a plan item's detail. */
export function describeDetail(item) {
  const say = ([key, params]) => esc(t(key, Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [k, typeof v === 'string' ? isolate(v) : v]))));
  const bits = [];
  if (item.detail) bits.push(say(item.detail));
  if (item.rawDetail) bits.push(`<bdi>${esc(item.rawDetail)}</bdi>`);
  for (const extra of item.extra || []) bits.push(say(extra));
  return bits.join(' · ');
}

function diffHTML(diff) {
  const cut = (s) => esc(s.length > 220 ? `${s.slice(0, 220)}…` : s);
  const rows = [
    ...diff.removed.slice(0, 5).map((l) => `<div class="ws-diff-line del" dir="auto"><span class="ws-diff-sign">−</span><span>${cut(l)}</span></div>`),
    ...diff.added.slice(0, 5).map((l) => `<div class="ws-diff-line add" dir="auto"><span class="ws-diff-sign">+</span><span>${cut(l)}</span></div>`),
  ];
  const more = diff.removed.length + diff.added.length - rows.length;
  if (more > 0) rows.push(`<div class="ws-diff-more">${esc(t('and {n} more lines', { n: more }))}</div>`);
  return rows.join('');
}

function rowHTML(item, { checkbox = true, checked = true, disabled = false } = {}) {
  const kind = KIND[item.kind] || KIND.update;
  const unit = item.unit ? `<span class="ws-unit">${esc(t(item.unit === 'chapter' ? 'Chapter' : 'Section'))}</span>` : '';
  const sub = [item.context ? `<bdi class="ws-ctx">${esc(item.context)}</bdi>` : '', describeDetail(item)].filter(Boolean).join(' · ');
  const hasDiff = item.diff && (item.diff.added.length || item.diff.removed.length);
  return `<div class="ws-row ${disabled ? 'is-disabled' : ''} ${item.kind === 'remove' ? 'is-remove' : ''}" data-row="${item.id}">
    <label class="ws-row-label">
      ${checkbox ? `<input type="checkbox" class="ws-check" data-id="${item.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>` : ''}
      <span class="badge ${kind.cls}">${esc(t(kind.label))}</span>
      <span class="ws-row-main">
        <span class="ws-row-title">${unit}<bdi>${esc(item.title || '—')}</bdi></span>
        ${sub ? `<span class="ws-row-sub">${sub}</span>` : ''}
      </span>
    </label>
    ${hasDiff ? `<button type="button" class="btn btn-ghost btn-sm btn-icon ws-expand" data-expand="${item.id}" aria-expanded="false" aria-label="${esc(t('Show changes'))}">${icon('chevronDown', 'icon-sm')}</button>` : ''}
    ${hasDiff ? `<div class="ws-diff" data-diff="${item.id}" hidden>${diffHTML(item.diff)}</div>` : ''}
  </div>`;
}

const KIND_RANK = { add: 0, rename: 1, move: 2, update: 3, reorder: 4, remove: 5 };
/** One line under a group's title that sums it up (only the references group has one). */
function groupNote(id, items) {
  if (id !== 'references') return '';
  const n = (kind) => items.filter((i) => i.kind === kind).length;
  return t('References: {added} new, {updated} changed, {removed} removed', { added: n('add'), updated: n('update'), removed: n('remove') });
}
/** Groups in a fixed order; inside a group new things first, removals last (document order is kept otherwise). */
function groupsOf(items) {
  return GROUPS.map((g) => {
    const list = items.filter((i) => i.group === g.id).map((item, order) => ({ item, order }))
      .sort((a, b) => (KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind]) || (a.order - b.order)).map((x) => x.item);
    return { ...g, items: list, note: groupNote(g.id, list) };
  }).filter((g) => g.items.length);
}
const noteHTML = (g) => (g.note ? `<div class="ws-group-note">${esc(g.note)}</div>` : '');

const countsLine = (items) => {
  const c = { add: 0, update: 0, remove: 0 };
  for (const i of items) { if (i.kind === 'add') c.add += 1; else if (i.kind === 'remove') c.remove += 1; else c.update += 1; }
  return [c.add && t('{n} new', { n: c.add }), c.update && t('{n} updated', { n: c.update }), c.remove && t('{n} removed', { n: c.remove })].filter(Boolean).join(' · ');
};

/** Review before applying. Resolves with the Set of selected item ids (or null if cancelled). */
export function openReviewDialog({ plan, fileName, applyLabel }) {
  return new Promise((resolve) => {
    const items = plan.items;
    const checked = new Map(items.map((i) => [i.id, i.checked]));
    const groups = groupsOf(items);
    const expandedGroups = new Set(groups.filter((g) => g.items.length <= COLLAPSE_AFTER).map((g) => g.id));
    let result = null;

    const warnings = (plan.parsed.warnings || []).filter((w) => WARNING_TEXT[w.code])
      .map((w) => `<div class="callout callout-warning ws-callout">${icon('alert')}<div>${esc(t(WARNING_TEXT[w.code], { n: w.count }))}</div></div>`).join('');
    const intro = plan.firstSync
      ? `<div class="callout callout-info ws-callout">${icon('info')}<div>${esc(t('Chapters, sections, tables and figures that already exist are matched by title, not duplicated. Diagrams you drew in GradDocs are never replaced.'))}</div></div>` : '';
    const storage = plan.imageBytes > 300 * 1024
      ? `<div class="callout callout-info ws-callout">${icon('database')}<div>${esc(t('The pictures in this file need space. If browser storage runs low, GradDocs switches to IndexedDB automatically.'))}</div></div>` : '';

    const body = `
      <div class="ws-review">
        <div class="ws-review-top">
          <div class="ws-file">${icon('word')}<bdi class="ws-file-name">${esc(fileName || '')}</bdi></div>
          <div class="ws-review-counts" data-counts></div>
        </div>
        ${intro}${warnings}${storage}
        <div class="ws-groups" data-groups></div>
      </div>`;
    const footer = `
      <div class="left">
        <button class="btn btn-ghost btn-sm" data-all>${esc(t('Select all'))}</button>
        <button class="btn btn-ghost btn-sm" data-none>${esc(t('Clear'))}</button>
      </div>
      <button class="btn" data-close>${esc(t('Cancel'))}</button>
      <button class="btn btn-primary" data-apply></button>`;

    const modal = openModal({
      title: t('Review changes from Word'),
      subtitle: plan.firstSync ? t('Choose what to bring into this project.') : t('Choose which changes to apply. A backup is made first, and you can undo.'),
      size: 'lg', className: 'ws-modal', body, footer, onClose: () => resolve(result),
    });

    const activeIds = () => items.filter((i) => checked.get(i.id) && (!i.requires || checked.get(i.requires))).map((i) => i.id);
    const render = () => {
      const host = modal.$('[data-groups]');
      host.innerHTML = groups.map((g) => {
        const sel = g.items.filter((i) => checked.get(i.id)).length;
        const open = expandedGroups.has(g.id);
        const shown = open ? g.items : g.items.slice(0, 0);
        return `<section class="ws-group" data-group="${g.id}">
          <header class="ws-group-head">
            <label class="ws-group-check"><input type="checkbox" data-group-toggle="${g.id}" ${sel === g.items.length ? 'checked' : ''}> </label>
            <span class="ws-group-icon">${icon(g.icon, 'icon-sm')}</span>
            <h3>${esc(t(g.label))}</h3>
            <span class="badge">${g.items.length}</span>
            <span class="grow"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-group-open="${g.id}" aria-expanded="${open}">${open ? esc(t('Hide')) : esc(t('Show'))}${icon(open ? 'chevronUp' : 'chevronDown', 'icon-sm')}</button>
          </header>
          ${noteHTML(g)}
          ${open ? `<div class="ws-group-body">${shown.map((i) => {
    const blocked = !!i.requires && !checked.get(i.requires);
    return rowHTML(i, { checked: checked.get(i.id) && !blocked, disabled: blocked });
  }).join('')}</div>` : ''}
        </section>`;
      }).join('');
      host.querySelectorAll('[data-group-toggle]').forEach((box) => {
        const g = groups.find((x) => x.id === box.dataset.groupToggle);
        const sel = g.items.filter((i) => checked.get(i.id)).length;
        box.indeterminate = sel > 0 && sel < g.items.length;
      });
      const n = activeIds().length;
      modal.$('[data-counts]').textContent = countsLine(items);
      const apply = modal.$('[data-apply]');
      apply.textContent = applyLabel || (n === 1 ? t('Apply 1 change') : t('Apply {n} changes', { n }));
      apply.disabled = n === 0;
    };
    render();

    on(modal.root, 'change', '.ws-check', (e, el) => {
      const id = el.dataset.id;
      checked.set(id, el.checked);
      if (!el.checked) for (const i of items) if (i.requires === id) checked.set(i.id, false);
      render();
    });
    on(modal.root, 'change', '[data-group-toggle]', (e, el) => {
      const g = groups.find((x) => x.id === el.dataset.groupToggle);
      for (const i of g.items) {
        const blocked = i.requires && !checked.get(i.requires);
        checked.set(i.id, el.checked && !blocked);
        if (el.checked) for (const d of items) if (d.requires === i.id && d.group === g.id) checked.set(d.id, true);
      }
      render();
    });
    on(modal.root, 'click', '[data-group-open]', (e, el) => {
      const id = el.dataset.groupOpen;
      if (expandedGroups.has(id)) expandedGroups.delete(id); else expandedGroups.add(id);
      render();
    });
    on(modal.root, 'click', '[data-expand]', (e, el) => {
      const diff = modal.$(`[data-diff="${el.dataset.expand}"]`);
      const open = diff.hidden;
      diff.hidden = !open;
      el.setAttribute('aria-expanded', String(open));
      el.classList.toggle('is-open', open);
    });
    modal.$('[data-all]').addEventListener('click', () => { items.forEach((i) => checked.set(i.id, true)); render(); });
    modal.$('[data-none]').addEventListener('click', () => { items.forEach((i) => checked.set(i.id, false)); render(); });
    modal.$('[data-apply]').addEventListener('click', () => { result = new Set(activeIds()); modal.close(); });
  });
}

/** Read-only list of the changes a sync applied (the "Details" action of the toast). */
export function openAppliedDialog({ items, fileName, at }) {
  const groups = groupsOf(items);
  const body = `<div class="ws-review">
    <div class="ws-review-top"><div class="ws-file">${icon('word')}<bdi class="ws-file-name">${esc(fileName || '')}</bdi></div><div class="ws-review-counts">${esc(countsLine(items))}</div></div>
    <div class="ws-groups">${groups.map((g) => `<section class="ws-group">
      <header class="ws-group-head"><span class="ws-group-icon">${icon(g.icon, 'icon-sm')}</span><h3>${esc(t(g.label))}</h3><span class="badge">${g.items.length}</span></header>
      ${noteHTML(g)}
      <div class="ws-group-body">${g.items.map((i) => rowHTML(i, { checkbox: false })).join('')}</div></section>`).join('')}</div></div>`;
  const modal = openModal({
    title: t('What changed'), subtitle: at ? t('Applied from {file}', { file: fileName || '' }) : '', size: 'lg', className: 'ws-modal', body,
    footer: `<button class="btn btn-primary" data-close>${esc(t('Done'))}</button>`,
  });
  on(modal.root, 'click', '[data-expand]', (e, el) => {
    const diff = modal.$(`[data-diff="${el.dataset.expand}"]`);
    const open = diff.hidden; diff.hidden = !open; el.classList.toggle('is-open', open);
  });
  return modal;
}
