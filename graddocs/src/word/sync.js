// Word → GradDocs sync orchestration: picking the file, linking a project, running a reviewed sync,
// creating a project from a Word file, undo and unlink. The page (word-view.js) and the background
// watcher (watcher.js) both go through here. Nothing in this module ever writes to the Word file.
import { pickFile } from '../core/utils.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { t } from '../i18n/index.js';
import { href } from '../app/routes.js';
import { parseDocx } from './docx-parse.js';
import { buildPlan, applyPlan, normalizeLink } from './plan.js';
import { saveHandle, loadHandle, deleteHandle } from './link-store.js';
import { openReviewDialog, openAppliedDialog } from './review-dialog.js';
import { wordEvents, wordState, withLock, setPending, supportsLiveWatch, hasReadPermission } from './state.js';

export { wordEvents, wordState, supportsLiveWatch, withLock, setPending, hasReadPermission };

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------------------------------------------------------------------------
// Files

/** Ask the user for a .docx: a live handle where the browser allows it, a plain File otherwise. */
export async function pickWordSource() {
  if (supportsLiveWatch()) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: t('Word document'), accept: { [DOCX_TYPE]: ['.docx'] } }], multiple: false });
      return { handle, file: await handle.getFile() };
    } catch (err) {
      if (err?.name === 'AbortError') return null;
      throw err;
    }
  }
  const file = await pickFile(`.docx,${DOCX_TYPE}`);
  return file ? { handle: null, file } : null;
}

const ERRORS = {
  invalid: 'This does not look like a valid Word (.docx) file.',
  legacy: 'This is an old .doc file or a password-protected document. Save it as a regular .docx and try again.',
  encrypted: 'This Word file is password-protected.',
  unsupported: 'This browser cannot unzip Word files.',
};
function friendly(err) {
  const known = ERRORS[err?.code];
  const out = new Error(known ? t(known) : `${t('Could not read the Word file.')} ${err?.message || ''}`.trim());
  out.cause = err;
  return out;
}

/** Read + parse a File or FileSystemFileHandle. → { parsed, info: { name, lastModified, size } } */
export async function parseSource(source) {
  const file = typeof source.getFile === 'function' ? await source.getFile() : source;
  if (!file.size) throw new Error(t('The Word file is empty. If Word is still saving it, try again in a moment.'));
  const buffer = await file.arrayBuffer();
  const info = { name: file.name, lastModified: file.lastModified, size: file.size };
  try {
    return { parsed: await parseDocx(buffer, { fileName: file.name }), info };
  } catch (err) { throw friendly(err); }
}

// ---------------------------------------------------------------------------
// Notifications

export function notifySynced(store, shell, res, { fileName, auto = false } = {}) {
  wordState.lastApplied = { at: Date.now(), items: res.applied, fileName, backup: res.backup, auto };
  wordEvents.emit('synced', wordState.lastApplied);
  if (!res.count) return;
  const message = res.count === 1 ? t('Synced with Word: 1 change') : t('Synced with Word: {n} changes', { n: res.count });
  toast(message, {
    type: 'success', duration: 9000,
    action: res.backup ? { label: t('Undo'), onClick: () => undoSync(store, res.backup) } : null,
  });
  // The toast component supports a single action; add "Details" next to "Undo" with the same markup.
  const el = document.querySelector('.toast-stack .toast:last-child');
  const close = el?.querySelector('.toast-close');
  if (close) {
    const btn = document.createElement('button');
    btn.className = 'toast-action'; btn.textContent = t('Details');
    btn.addEventListener('click', () => openAppliedDialog({ items: res.applied, fileName, at: Date.now() }));
    close.before(btn);
  }
}

/** Restore the backup taken before a sync. */
export async function undoSync(store, backup) {
  try {
    await store.restoreBackup(backup);
    // Remember the Word version we just rejected so it is not offered again until the file is saved anew.
    const seen = wordState.lastInfo?.lastModified;
    if (store.project?.wordLink && seen) store.update((p) => { p.wordLink.lastModified = seen; }, { activity: 'Undid a Word sync' });
    wordState.lastApplied = null;
    wordEvents.emit('undone');
    toast(t('The Word sync was undone.'), { type: 'info' });
  } catch (err) { toastError(err, t('Could not undo the sync')); }
}

// ---------------------------------------------------------------------------
// Reviewed sync (link / sync now)

async function runReviewed(store, shell, { source, handle }) {
  const project = store.project;
  let parsedInfo;
  try { parsedInfo = await parseSource(source); } catch (err) { toastError(err, t('Could not read the Word file')); return null; }
  const { parsed, info } = parsedInfo;
  wordState.lastInfo = info;
  if (handle) await saveHandle(project.id, handle);
  const plan = buildPlan(project, parsed);
  if (!plan.items.length) {
    await applyPlan(store, plan, [], { fileInfo: info, backup: false, activity: false });
    setPending(null);
    toast(plan.firstSync ? t('Linked to {file}. Everything already matches.', { file: info.name }) : t('Everything is up to date.'), { type: 'success' });
    wordEvents.emit('synced', null); wordEvents.emit('relink');
    return { count: 0 };
  }
  const selected = await openReviewDialog({ plan, fileName: info.name });
  if (!selected) return null;
  if (store.project?.id !== project.id) return null; // the user switched project while reviewing
  try {
    const res = await applyPlan(store, plan, selected, { fileInfo: info });
    setPending(null);
    notifySynced(store, shell, res, { fileName: info.name });
    wordEvents.emit('relink');
    return res;
  } catch (err) { toastError(err, t('Could not apply the changes')); return null; }
}

/** "Link this project to a Word file". */
export function linkWordFile({ store, shell }) {
  return withLock(async () => {
    const picked = await pickWordSource();
    if (!picked) return null;
    return runReviewed(store, shell, { source: picked.file, handle: picked.handle });
  });
}

/** "Sync now": read the linked file again (asks for the file in browsers without live access). */
export function syncNow({ store, shell }) {
  return withLock(async () => {
    const project = store.project;
    const link = project?.wordLink;
    let handle = project ? await loadHandle(project.id) : null;
    let source = null;
    if (handle && await hasReadPermission(handle, true)) source = handle;
    if (!source) {
      const picked = await pickWordSource();
      if (!picked) return null;
      if (link?.fileName && picked.file.name !== link.fileName) {
        const ok = await confirmDialog({
          title: t('Different file'),
          message: t('This project is linked to “{linked}”, but you chose “{chosen}”. Sync from the new file anyway?', { linked: escapeHtml(link.fileName), chosen: escapeHtml(picked.file.name) }),
          confirmText: t('Sync anyway'),
        });
        if (!ok) return null;
      }
      handle = picked.handle; source = picked.file;
    }
    return runReviewed(store, shell, { source, handle });
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------------------------------------------------------------------
// New project from a Word file

export function createProjectFromWord({ store, shell }) {
  return withLock(async () => {
    const picked = await pickWordSource();
    if (!picked) return null;
    let parsedInfo;
    try { parsedInfo = await parseSource(picked.file); } catch (err) { toastError(err, t('Could not read the Word file')); return null; }
    const { parsed, info } = parsedInfo;
    try {
      const meta = Object.fromEntries(Object.entries(parsed.titlePage).filter(([, v]) => v));
      const project = await store.createProject({ name: parsed.title || info.name.replace(/\.docx$/i, ''), ...meta });
      await store.openProject(project.id);
      const plan = buildPlan(store.project, parsed);
      wordState.lastInfo = info;
      await applyPlan(store, plan, plan.items.filter((i) => i.checked).map((i) => i.id), { fileInfo: info, backup: false });
      if (picked.handle) await saveHandle(project.id, picked.handle);
      wordEvents.emit('relink');
      const s = parsed.stats;
      toast(t('Created “{name}” from Word: {chapters} chapters, {tables} tables, {figures} figures.', { name: store.project.name, chapters: s.chapters, tables: s.tables, figures: s.images }), { type: 'success', duration: 6000 });
      shell.navigate(href(project.id, 'structure'));
      return project;
    } catch (err) { toastError(err, t('Could not create the project')); return null; }
  });
}

// ---------------------------------------------------------------------------
// Link settings

export async function unlinkWordFile({ store }) {
  const project = store.project;
  if (!project?.wordLink) return false;
  const ok = await confirmDialog({
    title: t('Unlink Word file?'),
    message: t('GradDocs stops following the Word file. Everything already imported stays in the project, and the Word file is not touched.'),
    confirmText: t('Unlink'), danger: true,
  });
  if (!ok) return false;
  store.update((p) => { delete p.wordLink; }, { activity: 'Unlinked the Word file' });
  await deleteHandle(project.id);
  setPending(null);
  wordEvents.emit('relink');
  return true;
}

export function setAutoSync(store, on) {
  if (!store.project?.wordLink) return;
  store.update((p) => { p.wordLink = normalizeLink(p.wordLink); p.wordLink.autoSync = !!on; }, { source: 'word-link' });
}
