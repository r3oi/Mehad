// Central application store: holds the open project, applies mutations,
// autosaves through the repository and broadcasts changes.
//
// Usage from views:
//   store.update((project) => { project.acronyms.push(a); }, { activity: 'Added acronym AI' });
//   store.on('change', ({ project, revision, source }) => …);
//   store.on('status', (status) => …);   // 'saved' | 'saving' | 'error'
import { Emitter } from './events.js';
import { debounce, uid, clone } from './utils.js';
import { normalizeProject, createProject } from './model.js';
import { invalidateNumbering } from './numbering.js';
import { ProjectRepository } from '../storage/repository.js';

const SAVE_DELAY = 450;
const BACKUP_INTERVAL = 15 * 60 * 1000;

export class Store extends Emitter {
  constructor(repo = new ProjectRepository()) {
    super();
    this.repo = repo;
    this.project = null;
    this.projects = [];
    this.revision = 0;
    this.status = 'saved';
    this.lastError = null;
    this.lastSavedAt = null;
    this.lastBackupAt = 0;
    this._save = debounce(() => this.#persist(), SAVE_DELAY);
  }

  async init({ seed } = {}) {
    this.projects = await this.repo.listProjects();
    const meta = await this.repo.getMeta();
    if (!this.projects.length && !meta.seeded && seed) {
      const demo = normalizeProject(seed());
      await this.repo.saveProject(demo);
      await this.repo.setMeta({ seeded: true, lastProjectId: demo.id });
      this.projects = await this.repo.listProjects();
      return demo.id;
    }
    return meta.lastProjectId && this.projects.some((p) => p.id === meta.lastProjectId) ? meta.lastProjectId : null;
  }

  async refreshProjects() {
    this.projects = await this.repo.listProjects();
    this.emit('projects', this.projects);
    return this.projects;
  }

  async openProject(id) {
    if (this.project?.id === id) return this.project;
    await this.flush();
    const data = await this.repo.getProject(id);
    if (!data) throw new Error('Project not found. It may have been deleted.');
    this.project = normalizeProject(data);
    this.revision += 1;
    await this.repo.setMeta({ lastProjectId: id });
    this.emit('project', this.project);
    this.emit('change', { project: this.project, revision: this.revision, source: 'open' });
    this.#maybeBackup('Opened project');
    return this.project;
  }

  closeProject() {
    this._save.flush();
    this.project = null;
    this.emit('project', null);
  }

  /**
   * Apply a mutation to the open project.
   * options: { activity: string | { text, kind, targetId }, source, save = true }
   */
  update(mutator, options = {}) {
    if (!this.project) throw new Error('No project is open.');
    const result = mutator(this.project);
    this.project.updatedAt = Date.now();
    if (options.activity) this.#log(options.activity);
    invalidateNumbering(this.project);
    this.revision += 1;
    this.emit('change', { project: this.project, revision: this.revision, source: options.source || 'update' });
    if (options.save !== false) this.#scheduleSave();
    return result;
  }

  #log(activity) {
    const entry = typeof activity === 'string' ? { text: activity } : activity;
    const list = this.project.activity;
    // Collapse repeated edits of the same target within 2 minutes.
    const prev = list[0];
    if (prev && prev.text === entry.text && Date.now() - prev.at < 120000) { prev.at = Date.now(); return; }
    list.unshift({ id: uid('act'), at: Date.now(), kind: 'edit', ...entry });
    if (list.length > 60) list.length = 60;
  }

  #scheduleSave() {
    this.#setStatus('saving');
    this._save();
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }

  async #persist() {
    if (!this.project) return;
    const snapshot = this.project;
    try {
      await this.repo.saveProject(snapshot);
      this.lastSavedAt = Date.now();
      this.lastError = null;
      this.#setStatus('saved');
      this.#maybeBackup('Automatic backup');
      this.refreshProjects();
    } catch (err) {
      console.error('[store] save failed', err);
      this.lastError = err;
      this.#setStatus('error');
      this.emit('save-error', err);
    }
  }

  async #maybeBackup(reason) {
    if (!this.project || Date.now() - this.lastBackupAt < BACKUP_INTERVAL) return;
    this.lastBackupAt = Date.now();
    try { await this.repo.saveBackup(clone(this.project), reason); } catch (err) { console.warn('[store] backup skipped', err); }
  }

  /** Persist pending changes now. */
  async flush() {
    if (this._save.pending()) { this._save.cancel(); await this.#persist(); }
  }

  /** Best-effort synchronous save used on page unload. */
  flushSync() {
    if (!this.project || !this._save.pending()) return;
    this._save.cancel();
    try { this.repo.saveProjectSync(this.project); this.status = 'saved'; } catch (err) { console.error(err); }
  }

  get hasPendingChanges() { return this._save.pending() || this.status === 'saving'; }

  // ----- Project management ----------------------------------------------
  async createProject(fields) {
    const project = createProject(fields);
    project.activity.unshift({ id: uid('act'), at: Date.now(), kind: 'create', text: 'Created project' });
    await this.repo.saveProject(project);
    await this.refreshProjects();
    return project;
  }

  async saveImportedProject(data, { asCopy = false } = {}) {
    const project = normalizeProject(clone(data));
    if (asCopy) { project.id = uid('prj'); project.name = `${project.name} (imported)`; }
    project.updatedAt = Date.now();
    await this.repo.saveProject(project);
    await this.refreshProjects();
    if (this.project?.id === project.id) { this.project = null; await this.openProject(project.id); }
    return project;
  }

  async duplicateProject(id) {
    const data = await this.repo.getProject(id);
    if (!data) throw new Error('Project not found.');
    const copy = normalizeProject(clone(data));
    copy.id = uid('prj');
    copy.name = `${copy.name} (copy)`;
    copy.createdAt = copy.updatedAt = Date.now();
    await this.repo.saveProject(copy);
    await this.refreshProjects();
    return copy;
  }

  async deleteProject(id) {
    if (this.project?.id === id) { this._save.cancel(); this.project = null; this.emit('project', null); }
    await this.repo.deleteProject(id);
    await this.refreshProjects();
  }

  async exportProjectData(id = this.project?.id) {
    if (this.project?.id === id) { await this.flush(); return clone(this.project); }
    return this.repo.getProject(id);
  }

  async createBackup(reason = 'Manual backup') {
    if (!this.project) return null;
    await this.flush();
    this.lastBackupAt = Date.now();
    return this.repo.saveBackup(clone(this.project), reason);
  }

  async restoreBackup(backup) {
    await this.createBackup('Before restoring a backup');
    const restored = normalizeProject(clone(backup.data));
    restored.updatedAt = Date.now();
    await this.repo.saveProject(restored);
    this.project = null;
    await this.openProject(restored.id);
    await this.refreshProjects();
  }

  async switchEngine(engine) {
    await this.flush();
    await this.repo.migrateTo(engine);
    await this.refreshProjects();
  }
}

export const store = new Store();
