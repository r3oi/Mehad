// Live Word sync. While a project that is linked to a Word file is open (on any page), the watcher
// polls the file's modification time every 3 seconds (File System Access API, Chromium browsers).
// Only when the time changes is the file read and compared with the project:
//   • auto sync on, no removals → changes are applied right away (with a backup) and a toast offers Undo / Details
//   • otherwise a toast invites the user to review the changes on the Word Sync page.
// Browsers without the API cannot watch: the Word Sync page's "Sync now" asks for the file instead.
import { toast } from '../ui/toast.js';
import { t } from '../i18n/index.js';
import { href } from '../app/routes.js';
import { loadHandle, saveHandle } from './link-store.js';
import { wordEvents, wordState, withLock, hasReadPermission, setPending, supportsLiveWatch } from './state.js';

const POLL_MS = 3000;
const SETTLE_MS = 600;
const MAX_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * modes: 'unlinked' | 'unsupported' | 'no-handle' | 'needs-permission' | 'watching' | 'missing'
 */
export class WordWatcher {
  constructor(store, shell) {
    this.store = store; this.shell = shell;
    this.mode = 'unlinked';
    this.key = null;
    this.handle = null;
    this.lastSeen = undefined;
    this.timer = null;
    this.checking = false;
    this.failures = 0;
    this.lastCheckedAt = 0;
  }

  start() {
    this.store.on('project', () => this.refresh());
    this.store.on('change', () => this.refresh());
    wordEvents.on('relink', () => this.refresh(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
    window.addEventListener('focus', () => this.tick());
    this.refresh(true);
    return this;
  }

  status() {
    const link = this.store.project?.wordLink || null;
    return { mode: this.mode, fileName: link?.fileName || '', lastCheckedAt: this.lastCheckedAt, pending: wordState.pending };
  }

  #setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    wordEvents.emit('status', this.status());
  }

  #stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** Re-evaluate which project/file is being watched. Cheap when nothing changed. */
  async refresh(force = false) {
    const project = this.store.project;
    const linked = !!project?.wordLink;
    const key = project ? `${project.id}|${linked}` : '';
    if (!force && key === this.key) return;
    this.key = key;
    const gen = (this.generation = (this.generation || 0) + 1); // a newer refresh supersedes this one
    this.#stopTimer();
    this.handle = null; this.lastSeen = undefined; this.failures = 0;
    if (!project || !linked) { this.#setMode('unlinked'); return; }
    const handle = await loadHandle(project.id);
    if (gen !== this.generation) return;
    if (!handle) { this.#setMode(supportsLiveWatch() ? 'no-handle' : 'unsupported'); return; }
    this.handle = handle;
    const granted = await hasReadPermission(handle, false);
    if (gen !== this.generation) return;
    if (granted) this.#begin(); else this.#setMode('needs-permission');
  }

  #begin() {
    this.#setMode('watching');
    this.#stopTimer();
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.tick();
  }

  /** User gesture: ask the browser for access to the remembered file again. */
  async reconnect() {
    const project = this.store.project;
    if (!project?.wordLink) return false;
    const handle = this.handle || await loadHandle(project.id);
    if (!handle) { this.#setMode(supportsLiveWatch() ? 'no-handle' : 'unsupported'); return false; }
    this.handle = handle;
    if (!(await hasReadPermission(handle, true))) { this.#setMode('needs-permission'); return false; }
    this.lastSeen = undefined; this.failures = 0;
    this.#begin();
    return true;
  }

  /** Test/diagnostic hook: use this handle for the open project (kept in memory, saved when possible). */
  async useHandle(handle) {
    const project = this.store.project;
    if (!project) return;
    await saveHandle(project.id, handle);
    await this.refresh(true);
  }

  /** One poll. Reads the file only when its modification time changed. */
  async tick() {
    if (this.checking || (this.mode !== 'watching' && this.mode !== 'missing') || !this.handle || !this.store.project?.wordLink) return;
    this.checking = true;
    const projectId = this.store.project.id;
    try {
      const file = await this.handle.getFile();
      this.lastCheckedAt = Date.now();
      if (this.mode === 'missing') this.#setMode('watching'); // the file is back
      const link = this.store.project.wordLink;
      const modified = file.lastModified;
      if (this.lastSeen === undefined) {
        // Baseline. If the file was saved while GradDocs was closed, treat it as a change now.
        this.lastSeen = modified;
        if (link.lastSyncedAt && link.lastModified && modified !== link.lastModified) await this.#changed(file, projectId, modified);
        return;
      }
      if (modified === this.lastSeen) return;
      // Word writes the file in several steps: wait until it stops changing.
      await sleep(SETTLE_MS);
      const again = await this.handle.getFile();
      if (again.lastModified !== modified || again.size !== file.size) return; // still being written; next tick
      await this.#changed(again, projectId, modified);
    } catch (err) {
      if (err?.name === 'NotFoundError') this.#setMode('missing');
      else if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') this.#setMode('needs-permission');
      else console.warn('[word] watcher', err);
    } finally { this.checking = false; }
  }

  async #changed(file, projectId, modified) {
    const done = await withLock(async () => {
      // The .docx parser and the planner are only loaded once a Word file really changed.
      const [{ parseSource, notifySynced }, { buildPlan, applyPlan }] = await Promise.all([import('./sync.js'), import('./plan.js')]);
      const store = this.store;
      if (store.project?.id !== projectId || !store.project.wordLink) return true;
      let parsedInfo;
      try { parsedInfo = await parseSource(file); } catch (err) {
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) {
          this.failures = 0;
          toast(err.message, { type: 'error', title: t('Could not read the Word file'), duration: 7000 });
          return true;
        }
        return false; // try again on the next tick
      }
      this.failures = 0;
      const { parsed, info } = parsedInfo;
      wordState.lastInfo = info;
      const plan = buildPlan(store.project, parsed);
      const link = store.project.wordLink;
      if (!plan.items.length) {
        await applyPlan(store, plan, [], { fileInfo: info, backup: false, activity: false });
        setPending(null);
        return true;
      }
      if (link.autoSync !== false && !plan.hasRemovals && !plan.firstSync) {
        const res = await applyPlan(store, plan, plan.items.map((i) => i.id), { fileInfo: info });
        setPending(null);
        notifySynced(store, this.shell, res, { fileName: info.name, auto: true });
        return true;
      }
      setPending({ at: Date.now(), name: info.name, count: plan.items.length, removals: plan.hasRemovals });
      toast(t('Your Word file changed'), {
        type: 'info', duration: 12000,
        action: { label: t('Review'), onClick: () => this.shell.navigate(href(projectId, 'word', null, { review: '1' })) },
      });
      return true;
    });
    if (done) this.lastSeen = modified;
  }
}

let shared = null;

/** Start the app-wide watcher (call once, after the shell has started). */
export function startWordWatcher(store, shell) {
  const watcher = new WordWatcher(store, shell).start();
  shared = watcher;
  if (typeof window !== 'undefined') {
    window.graddocs = window.graddocs || {};
    window.graddocs.word = { watcher, events: wordEvents, state: wordState, useHandle: (h) => watcher.useHandle(h) };
  }
  return watcher;
}

export const getWatcher = () => shared;
