// ProjectRepository: the only module the rest of the app uses for persistence.
// It speaks in projects/backups/meta, not storage keys, so replacing it with a
// Supabase/PostgreSQL implementation means implementing this same interface
// (see supabase-repository.example.js) without touching views or the store.
import { createAdapter, setPreferredEngine } from './adapters.js';

const MAX_BACKUPS = 5;

export function projectSummary(p) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    description: p.description,
    academicYear: p.academicYear,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    counts: { figures: p.figures.length, tables: p.tables.length, acronyms: p.acronyms.length, chapters: p.chapters.length },
  };
}

export class ProjectRepository {
  constructor(adapter = createAdapter()) { this.adapter = adapter; }

  get engine() { return this.adapter.name; }

  async listProjects() {
    const index = (await this.adapter.get('index')) || [];
    return index.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getProject(id) { return this.adapter.get(`project:${id}`); }

  async saveProject(project) {
    await this.adapter.set(`project:${project.id}`, project);
    await this.#updateIndex(project);
  }

  /** Synchronous save for page unload (only localStorage supports it). */
  saveProjectSync(project) {
    if (!this.adapter.setSync) return false;
    this.adapter.setSync(`project:${project.id}`, project);
    const index = (this.adapter.getSync('index') || []).filter((s) => s.id !== project.id);
    index.push(projectSummary(project));
    this.adapter.setSync('index', index);
    return true;
  }

  async #updateIndex(project) {
    const index = ((await this.adapter.get('index')) || []).filter((s) => s.id !== project.id);
    index.push(projectSummary(project));
    await this.adapter.set('index', index);
  }

  async deleteProject(id) {
    await this.adapter.remove(`project:${id}`);
    await this.adapter.remove(`backups:${id}`);
    const index = ((await this.adapter.get('index')) || []).filter((s) => s.id !== id);
    await this.adapter.set('index', index);
  }

  // ----- Backups ------------------------------------------------------------
  async listBackups(projectId) { return (await this.adapter.get(`backups:${projectId}`)) || []; }

  async saveBackup(project, reason = 'auto') {
    const backups = await this.listBackups(project.id);
    backups.unshift({ id: `bk_${Date.now().toString(36)}`, at: Date.now(), reason, name: project.name, data: project });
    const trimmed = backups.slice(0, MAX_BACKUPS);
    try {
      await this.adapter.set(`backups:${project.id}`, trimmed);
    } catch (err) {
      // Backups are best-effort: keep fewer if storage is tight.
      await this.adapter.set(`backups:${project.id}`, trimmed.slice(0, 1));
      if (err.code !== 'QUOTA_EXCEEDED') throw err;
    }
    return trimmed[0];
  }

  async deleteBackup(projectId, backupId) {
    const backups = (await this.listBackups(projectId)).filter((b) => b.id !== backupId);
    await this.adapter.set(`backups:${projectId}`, backups);
  }

  // ----- Meta (last opened project, flags) ----------------------------------
  async getMeta() { return (await this.adapter.get('meta')) || {}; }
  async setMeta(patch) { await this.adapter.set('meta', { ...(await this.getMeta()), ...patch }); }

  async usage() { return this.adapter.usage(); }

  /** Copy every key into another engine, then make it the active one. */
  async migrateTo(engineName) {
    if (engineName === this.adapter.name) return this;
    const target = createAdapter(engineName);
    if (target.name !== engineName) throw new Error(`${engineName} is not available in this browser.`);
    const keys = await this.adapter.keys('');
    for (const key of keys) {
      if (key === 'engine') continue;
      const value = await this.adapter.get(key);
      if (value !== null) await target.set(key, value);
    }
    setPreferredEngine(engineName);
    this.adapter = target;
    return this;
  }
}
