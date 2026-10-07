// Example only — not imported by the app.
//
// How to move GradDocs to Supabase / PostgreSQL later: implement the same
// interface as ProjectRepository (repository.js) and pass an instance to the
// store in main.js. Views and the store never touch storage keys directly.
//
// Suggested schema (one JSONB document per project keeps the client model
// unchanged; split figures/tables into their own tables when you need
// row-level collaboration):
//
//   create table projects (
//     id text primary key,
//     owner uuid references auth.users not null default auth.uid(),
//     name text not null,
//     data jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   create table project_backups (
//     id text primary key,
//     project_id text references projects(id) on delete cascade,
//     reason text, created_at timestamptz default now(), data jsonb not null
//   );
//   alter table projects enable row level security;
//   create policy "own projects" on projects for all using (owner = auth.uid());
//
// import { createClient } from '@supabase/supabase-js';
// import { projectSummary } from './repository.js';
//
// export class SupabaseProjectRepository {
//   constructor(url, anonKey) { this.db = createClient(url, anonKey); }
//   get engine() { return 'supabase'; }
//   async listProjects() {
//     const { data, error } = await this.db.from('projects').select('data').order('updated_at', { ascending: false });
//     if (error) throw error;
//     return data.map((row) => projectSummary(row.data));
//   }
//   async getProject(id) {
//     const { data, error } = await this.db.from('projects').select('data').eq('id', id).maybeSingle();
//     if (error) throw error;
//     return data?.data ?? null;
//   }
//   async saveProject(project) {
//     const { error } = await this.db.from('projects').upsert({ id: project.id, name: project.name, data: project, updated_at: new Date(project.updatedAt).toISOString() });
//     if (error) throw error;
//   }
//   saveProjectSync() { return false; }
//   async deleteProject(id) { const { error } = await this.db.from('projects').delete().eq('id', id); if (error) throw error; }
//   async listBackups(projectId) { /* select from project_backups */ }
//   async saveBackup(project, reason) { /* insert into project_backups */ }
//   async deleteBackup(projectId, backupId) { /* delete */ }
//   async getMeta() { return JSON.parse(localStorage.getItem('graddocs:meta') || '{}'); }
//   async setMeta(patch) { localStorage.setItem('graddocs:meta', JSON.stringify({ ...(await this.getMeta()), ...patch })); }
//   async usage() { return { used: 0, quota: 0 }; }
// }
