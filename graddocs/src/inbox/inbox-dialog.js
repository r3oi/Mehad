// "Updates from Claude" review dialog: every pending item with a preview, where it will go and Apply / Dismiss,
// plus Apply all. Applying runs in one store.update and offers Undo. Item texts come from a file in the repository
// (untrusted): they only ever reach the page through esc().
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { getNumbering, locationLabel } from '../core/numbering.js';
import { formatDateTime, relativeTime } from '../core/utils.js';
import { getFigureType } from '../figures/types.js';
import { renderThumbnail } from '../figures/render.js';
import { t, isRTL } from '../i18n/index.js';
import {
  pendingItems, describeDestination, figureParts, applyItems, undoApply, dismissItemInStore, checkInbox, inboxEvents, inboxState,
} from './inbox.js';

/** Isolates text of unknown direction inside a sentence (Arabic UI only). */
const iso = (s) => (isRTL ? `⁨${s}⁩` : String(s));

/** Title and description in the interface language (the Arabic ones when the interface is Arabic and Claude wrote them). */
export function itemTexts(item) {
  return {
    title: (isRTL && item.titleAr) || item.title,
    description: (isRTL && item.descriptionAr) || item.description,
  };
}

/** "Project logo" / the figure type's name ("Gantt Chart", "Flowchart" …). */
export function kindLabel(item) {
  return item.kind === 'projectLogo' ? t('Project logo') : getFigureType(item.figure.type).name;
}

export const kindIcon = (item) => (item.kind === 'projectLogo' ? 'image' : 'figure');

const previews = new Map(); // item version → thumbnail markup or { error }
function figurePreview(project, item) {
  const key = `${project.id}|${item.id}|${item.createdMs}|${project.settings?.figureDefaults?.fontFamily}`;
  if (!previews.has(key)) {
    try { previews.set(key, { svg: renderThumbnail(figureParts(project, item).diagram) }); } catch (error) { previews.set(key, { error }); }
    if (previews.size > 60) previews.delete(previews.keys().next().value);
  }
  return previews.get(key);
}

/** Where applying an item sends it, as text: "Chapter 2 · 2.3 Project Schedule", "Unassigned", … → { label, value } */
export function destinationText(project, item) {
  const d = describeDestination(project, item);
  if (d.kind === 'titlePage') return { label: t('Goes to'), value: t('Title page, above the project title') };
  const where = locationLabel(project, d.chapterId, d.sectionId);
  if (d.kind === 'update') {
    const number = getNumbering(project).figures.get(d.figure.id)?.label || t('Figure');
    return { label: t('Replaces'), value: `${number} · ${where}` };
  }
  return { label: t('Goes to'), value: where };
}

const statusBadge = (item) => (item.status === 'update'
  ? `<span class="badge badge-info">${esc(t('Update'))}</span>`
  : `<span class="badge badge-success">${esc(t('New'))}</span>`);

function itemHTML(project, item, { busy }) {
  const { title, description } = itemTexts(item);
  const where = destinationText(project, item);
  let preview;
  let broken = false;
  if (item.kind === 'projectLogo') {
    preview = `<div class="ib-preview ib-preview-logo"><img src="${esc(item.assetUrl)}" alt="" loading="lazy"></div>`;
  } else {
    const p = figurePreview(project, item);
    broken = !!p.error;
    preview = `<div class="ib-preview thumb">${p.error ? `<div class="ib-broken">${icon('alert')}<span>${esc(t('This figure could not be drawn.'))}</span></div>` : p.svg}</div>`;
  }
  return `
  <article class="ib-item" data-id="${esc(item.id)}" aria-label="${esc(title)}">
    ${preview}
    <div class="ib-main">
      <div class="ib-head">
        <span class="badge badge-primary">${icon(kindIcon(item), 'icon-sm')}<bdi>${esc(kindLabel(item))}</bdi></span>
        ${statusBadge(item)}
        ${item.createdMs ? `<span class="ib-date">${esc(t('Sent {time}', { time: iso(formatDateTime(item.createdMs)) }))}</span>` : ''}
      </div>
      <h3 class="ib-title" dir="auto">${esc(title)}</h3>
      ${description ? `<p class="ib-desc" dir="auto">${esc(description)}</p>` : ''}
      <div class="ib-where"><span class="ib-where-label">${esc(where.label)}</span><bdi class="ib-where-value">${esc(where.value)}</bdi></div>
      <div class="ib-actions">
        <button type="button" class="btn btn-sm btn-primary" data-act="apply" data-id="${esc(item.id)}" ${busy || broken ? 'disabled' : ''}>${icon('check', 'icon-sm')}${esc(t('Apply'))}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="dismiss" data-id="${esc(item.id)}" ${busy ? 'disabled' : ''}>${esc(t('Dismiss'))}</button>
      </div>
    </div>
  </article>`;
}

function emptyHTML() {
  const failed = inboxState.reached === false;
  const text = failed ? t('Could not reach the repository right now. Try again later.') : t('There are no new updates from Claude for this project.');
  return `
  <div class="ib-empty">
    <span class="ib-empty-ico">${icon(failed ? 'alert' : 'checkCircle', 'icon-lg')}</span>
    <h3>${esc(failed ? t('Nothing to show') : t('You’re all caught up'))}</h3>
    <p>${esc(text)}</p>
    <button type="button" class="btn btn-sm" data-act="check" ${inboxState.checking ? 'disabled' : ''}>${icon('refresh', 'icon-sm')}${esc(inboxState.checking ? t('Checking…') : t('Check now'))}</button>
  </div>`;
}

/**
 * Apply items and tell the student what happened (toast with Undo). Returns the applyItems result.
 * Used by the dialog's Apply / Apply all.
 */
export async function applyWithFeedback(store, items) {
  let res;
  try { res = await applyItems(store, items); } catch (err) { toastError(err, t('Could not apply the update')); return null; }
  for (const { item, error } of res.failed) {
    console.warn('[inbox] could not apply', item.id, error);
    const { title } = itemTexts(item);
    toast(item.kind === 'projectLogo' ? t('Could not download the image for “{title}”.', { title: iso(title) }) : t('Could not apply “{title}”.', { title: iso(title) }), { type: 'error', duration: 7000 });
  }
  if (res.applied.length) {
    const message = res.applied.length === 1 ? t('Applied “{title}”.', { title: iso(itemTexts(res.applied[0]).title) }) : t('{n} updates applied.', { n: res.applied.length });
    toast(message, {
      type: 'success', duration: 9000,
      action: { label: t('Undo'), onClick: () => { if (undoApply(store, res.snapshot)) toast(t('The update was undone.'), { type: 'info', duration: 2600 }); else toast(t('That can no longer be undone.'), { type: 'warning' }); } },
    });
  }
  return res;
}

/** Open the review dialog for the open project. */
export function openInboxDialog({ store }) {
  const d = new Disposer();
  let busy = false;
  let lastSignature = null;

  const modal = openModal({
    title: t('Updates from Claude'),
    subtitle: t('These come from your project’s GitHub repository (public).'),
    size: 'lg', className: 'ib-modal',
    body: '', footer: ' ',
    onClose: () => d.dispose(),
  });

  const render = (force = false) => {
    const project = store.project;
    if (!project) { modal.close(); return; }
    const items = pendingItems(project);
    const signature = JSON.stringify([busy, inboxState.checking, inboxState.reached, project.id, items.map((i) => [i.id, i.createdMs, i.status])]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    modal.body.innerHTML = items.length
      ? `<p class="ib-note">${icon('info', 'icon-sm')}<span>${esc(t('Nothing changes until you press Apply. You can undo right after applying.'))}</span></p>
         <div class="ib-list">${items.map((item) => itemHTML(project, item, { busy })).join('')}</div>`
      : emptyHTML();
    modal.footer.innerHTML = `
      <span class="left ib-checked muted">${inboxState.checkedAt ? esc(t('Last checked {time}', { time: iso(relativeTime(inboxState.checkedAt)) })) : ''}</span>
      <button type="button" class="btn" data-close>${esc(t('Close'))}</button>
      ${items.length > 1 ? `<button type="button" class="btn btn-primary" data-act="apply-all" ${busy ? 'disabled' : ''}>${icon('check', 'icon-sm')}${esc(t('Apply all ({n})', { n: items.length }))}</button>` : ''}`;
  };

  const run = async (items) => {
    if (busy || !items.length) return;
    busy = true; render();
    try { await applyWithFeedback(store, items); } finally { busy = false; render(true); }
  };

  d.add(on(modal.root, 'click', '[data-act]', (e, el) => {
    const act = el.dataset.act;
    const items = pendingItems(store.project);
    const item = items.find((i) => i.id === el.dataset.id);
    if (act === 'apply' && item) run([item]);
    else if (act === 'apply-all') run(items);
    else if (act === 'dismiss' && item) { dismissItemInStore(store, item); render(true); }
    else if (act === 'check') checkInbox({ project: store.project }).then((r) => { if (!r.reached) toast(t('Could not reach the repository right now. Try again later.'), { type: 'info' }); });
  }));
  d.add(inboxEvents.on('update', () => render()));
  d.add(store.on('change', () => render()));
  d.add(store.on('project', () => render(true)));
  render(true);
  return modal;
}
