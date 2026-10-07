// Projects view (#/projects): the project gallery plus New / Import / Duplicate /
// Export / Delete. Also exports the shared project-details field list and the
// "standard report" chapter builder used by the dashboard and settings views.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog, formDialog } from '../ui/modal.js';
import { toast, toastError } from '../ui/toast.js';
import { href } from '../app/routes.js';
import { createChapter, createSection } from '../core/model.js';
import { relativeTime, downloadText, slugify, pickFile, readFileAsText } from '../core/utils.js';
import { t, isRTL } from '../i18n/index.js';

export const DEFAULT_PROJECT_TYPE = 'Software Engineering Graduation Project';

/** Keeps user text (names, titles) from reordering an Arabic sentence; a no-op in English. */
export const iso = (s) => (isRTL ? `\u2068${s}\u2069` : String(s));
/** Bold, direction-isolated user text for HTML dialog messages. */
export const strong = (s) => `<strong><bdi>${esc(s)}</bdi></strong>`;
/** t() for HTML messages: the translated text is escaped (only <strong>/<b>/<em>/<code> survive), placeholders take ready-made HTML. */
export const tHTML = (key, params = {}) => esc(t(key))
  .replace(/&lt;(\/?)(strong|b|em|code)&gt;/g, '<$1$2>')
  .replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
/** One / many phrasing: `one` is a complete key without a number (e.g. '1 project'). */
export const count = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));

/** Field definitions for formDialog / inline forms, prefilled from `v`. */
export function projectDetailFields(v = {}) {
  return [
    { name: 'name', label: t('Project Name'), value: v.name ?? '', required: true, placeholder: t('e.g. Meyar'), span: true, autofocus: true },
    { name: 'description', label: t('Project Description'), type: 'textarea', rows: 3, value: v.description ?? '', span: true, placeholder: t('A short summary of what the project does.') },
    { name: 'type', label: t('Project Type'), value: v.type ?? DEFAULT_PROJECT_TYPE },
    { name: 'academicYear', label: t('Academic Year'), value: v.academicYear ?? String(new Date().getFullYear()) },
    { name: 'university', label: t('University'), value: v.university ?? '' },
    { name: 'college', label: t('College'), value: v.college ?? '' },
    { name: 'department', label: t('Department'), value: v.department ?? '' },
    { name: 'supervisor', label: t('Supervisor'), value: v.supervisor ?? '' },
    { name: 'students', label: t('Students'), type: 'textarea', rows: 3, value: v.students ?? '', span: true, hint: t('One student per line.'), placeholder: t('Full name, one per line') },
  ];
}

// ---------------------------------------------------------------------------
// Standard software-engineering report structure (6 chapters). These titles are
// document content, so they stay English whatever the interface language.

const STANDARD_STRUCTURE = [
  ['Introduction', ['Introduction', 'Problem Domain', 'Problem Statement',
    ['Proposed System', ['Aims and Objectives', 'Proposed System Features']],
    'Project Methodology', 'Gantt Chart', 'Resource Requirement', 'Report Layout']],
  ['Background / Existing Work', ['Introduction', 'Background', 'Existing Systems', 'Comparison of Existing Systems', 'Limitations of Existing Projects', 'Summary']],
  ['System Analysis', ['Introduction', 'Functional Requirements', 'Non-Functional Requirements', 'Use Case Diagram', 'Activity Diagrams']],
  ['System Design', ['Introduction', 'System Architecture', 'Sequence Diagrams', 'Class Diagram', 'Database Design']],
  ['Implementation', ['Introduction', 'Development Environment', 'Implementation Details']],
  ['Testing and Conclusion', ['Testing Strategy', 'Test Cases', 'Conclusion', 'Future Work']],
];

export function standardChapters() {
  const section = (s) => (Array.isArray(s)
    ? createSection({ title: s[0], sections: s[1].map(section) })
    : createSection({ title: s }));
  return STANDARD_STRUCTURE.map(([title, sections]) => createChapter({ title, sections: sections.map(section) }));
}

// ---------------------------------------------------------------------------

const initialsOf = (name) => String(name || '').split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || '').join('').slice(0, 2).toUpperCase() || 'P';
const hueOf = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

function looksLikeProject(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && typeof data.name === 'string' && data.name.trim() !== ''
    && (Array.isArray(data.chapters) || Array.isArray(data.figures));
}

function askImportMode(existingName) {
  return new Promise((resolve) => {
    let choice = null;
    const modal = openModal({
      title: t('Project already exists'), size: 'sm',
      body: `<p style="color:var(--text-2)">${tHTML('A project with the same ID ({name}) is already in this browser. Replace it with the imported file, or keep both by importing a copy?', { name: strong(existingName) })}</p>`,
      footer: `<button class="btn" data-close>${t('Cancel')}</button>
               <button class="btn" data-choice="copy">${t('Import as copy')}</button>
               <button class="btn btn-primary" data-choice="replace">${t('Replace existing')}</button>`,
      onClose: () => resolve(choice),
    });
    modal.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-choice]');
      if (btn) { choice = btn.dataset.choice; modal.close(); }
    });
  });
}

export default {
  title: 'Projects',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;

    // No project is "open" on the gallery page: this keeps the breadcrumbs and
    // save indicator accurate (the pending save is flushed first).
    if (store.project) store.closeProject();
    ctx.shell.setBreadcrumbs([{ label: t('Projects') }]);

    const cardHTML = (p) => {
      const c = p.counts || {};
      const stat = (ico, n, label) => `<div class="pj-stat" data-tip="${esc(t('{n} {label}', { n: n ?? 0, label }))}">${icon(ico)}<b>${n ?? 0}</b><span>${esc(label)}</span></div>`;
      return `
        <article class="card pj-card" data-id="${esc(p.id)}" style="--hue:${hueOf(p.name)}">
          <div class="pj-card-top">
            <span class="pj-avatar">${esc(initialsOf(p.name))}</span>
            <div class="grow">
              <h3 class="pj-name"><a href="${href(p.id, 'dashboard')}" class="truncate" title="${esc(p.name)}"><bdi>${esc(p.name)}</bdi></a></h3>
              <div class="pj-type"><bdi>${esc(p.type || t('Graduation project'))}</bdi>${p.academicYear ? ` · <bdi>${esc(p.academicYear)}</bdi>` : ''}</div>
            </div>
          </div>
          <p class="pj-desc ${p.description ? '' : 'muted'}">${p.description ? esc(p.description) : t('No description yet.')}</p>
          <div class="pj-stats">
            ${stat('figure', c.figures, t('Figures'))}${stat('table', c.tables, t('Tables'))}${stat('acronym', c.acronyms, t('Acronyms'))}${stat('chapters', c.chapters, t('Chapters'))}
          </div>
          <div class="pj-modified">${icon('clock', 'icon-sm')}<span>${esc(t('Last modified: {time}', { time: iso(relativeTime(p.updatedAt)) }))}</span></div>
          <div class="pj-actions">
            <a class="btn btn-primary btn-sm grow" href="${href(p.id, 'dashboard')}" data-action="open" data-id="${esc(p.id)}">${icon('folderOpen')}${t('Open')}</a>
            <button class="btn btn-sm btn-icon" data-action="duplicate" data-id="${esc(p.id)}" data-tip="${esc(t('Duplicate'))}" aria-label="${esc(t('Duplicate {name}', { name: p.name }))}">${icon('copy')}</button>
            <button class="btn btn-sm btn-icon" data-action="export" data-id="${esc(p.id)}" data-tip="${esc(t('Export JSON'))}" aria-label="${esc(t('Export {name} as JSON', { name: p.name }))}">${icon('export')}</button>
            <button class="btn btn-sm btn-icon pj-delete" data-action="delete" data-id="${esc(p.id)}" data-tip="${esc(t('Delete'))}" aria-label="${esc(t('Delete {name}', { name: p.name }))}">${icon('trash')}</button>
          </div>
        </article>`;
    };

    const render = () => {
      if (!alive) return;
      const projects = store.projects;
      container.innerHTML = `
        <div class="page pj-page">
          <header class="pj-brand">
            <span class="brand-mark pj-mark">${icon('graduation')}</span>
            <div><div class="brand-name">GradDocs</div><div class="brand-sub">${t('Graduation Project Documentation Builder')}</div></div>
          </header>
          <div class="page-header">
            <div class="titles">
              <h1>${t('My Projects')}</h1>
              <p class="subtitle">${projects.length ? (projects.length === 1 ? t('1 project · saved automatically in this browser') : t('{n} projects · saved automatically in this browser', { n: projects.length })) : t('Create a project to start documenting your graduation work.')}</p>
            </div>
            <div class="actions">
              <button class="btn" data-action="import">${icon('upload')}${t('Import Project')}</button>
              <button class="btn btn-primary" data-action="new">${icon('plus')}${t('New Project')}</button>
            </div>
          </div>
          ${projects.length ? `<div class="pj-grid">${projects.map(cardHTML).join('')}</div>` : `
            <div class="card pj-empty"><div class="empty-state">
              <div class="empty-icon">${icon('folderOpen')}</div>
              <h3>${t('No projects yet')}</h3>
              <p>${t('Create your first project to build figures, tables, chapters and acronyms that stay numbered automatically — or import one you exported earlier.')}</p>
              <div class="row" style="justify-content:center;flex-wrap:wrap">
                <button class="btn btn-primary" data-action="new">${icon('plus')}${t('New Project')}</button>
                <button class="btn" data-action="import">${icon('upload')}${t('Import Project')}</button>
              </div>
              <div style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-action="demo">${icon('sparkles')}${t('Load the Meyar demo project')}</button></div>
            </div></div>`}
        </div>`;
    };

    // ----- Actions ----------------------------------------------------------
    const newProject = async () => {
      const values = await formDialog({
        title: t('New project'),
        subtitle: t('Set up the basics now — everything can be changed later in Settings.'),
        size: 'lg',
        submitText: t('Create project'),
        fields: [
          ...projectDetailFields({}),
          {
            name: 'structure', label: t('Starting structure'), type: 'select', value: 'standard', span: true,
            options: [
              { value: 'standard', label: t('Standard software engineering report (6 chapters)') },
              { value: 'empty', label: t('Empty') },
            ],
            hint: t('The standard structure adds six chapters with their usual sections. You can edit it freely afterwards.'),
          },
        ],
      });
      if (!values) return;
      const { structure, ...fields } = values;
      try {
        const project = await store.createProject({ ...fields, chapters: structure === 'empty' ? [] : standardChapters() });
        toast(t('“{name}” is ready.', { name: iso(project.name) }), { type: 'success', title: t('Project created') });
        ctx.navigate(href(project.id, 'dashboard'));
      } catch (err) { toastError(err, t('Could not create the project')); }
    };

    const importProject = async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      let data;
      try { data = JSON.parse(await readFileAsText(file)); } catch {
        toast(t('That file is not valid JSON, so it could not be imported.'), { type: 'error', title: t('Import failed') });
        return;
      }
      if (!looksLikeProject(data)) {
        toast(t('This JSON file is not a GradDocs project. A project needs a name plus chapters or figures.'), { type: 'error', title: t('Not a GradDocs project') });
        return;
      }
      let asCopy = false;
      const existing = store.projects.find((p) => p.id === data.id);
      if (existing) {
        const choice = await askImportMode(existing.name);
        if (!choice) return;
        asCopy = choice === 'copy';
      }
      try {
        const project = await store.saveImportedProject(data, { asCopy });
        const name = iso(project.name);
        toast(asCopy ? t('Imported a copy of “{name}”.', { name }) : existing ? t('Replaced “{name}”.', { name }) : t('Imported “{name}”.', { name }), { type: 'success', title: t('Project imported') });
        ctx.navigate(href(project.id, 'dashboard'));
      } catch (err) { toastError(err, t('Import failed')); }
    };

    const summary = (id) => store.projects.find((p) => p.id === id);

    const duplicate = async (id) => {
      try {
        const copy = await store.duplicateProject(id);
        toast(t('Created “{name}”.', { name: iso(copy.name) }), { type: 'success', title: t('Project duplicated') });
      } catch (err) { toastError(err, t('Could not duplicate the project')); }
    };

    const exportJson = async (id) => {
      try {
        const data = await store.exportProjectData(id);
        if (!data) throw new Error(t('Project not found.'));
        downloadText(JSON.stringify(data, null, 2), `${slugify(data.name)}-project.json`, 'application/json');
        toast(t('Exported “{name}” as JSON.', { name: iso(data.name) }), { type: 'success' });
      } catch (err) { toastError(err, t('Could not export the project')); }
    };

    const remove = async (id) => {
      const p = summary(id);
      if (!p) return;
      const ok = await confirmDialog({
        title: t('Delete project?'), danger: true, confirmText: t('Delete project'),
        message: tHTML('This permanently deletes {name} and its backups from this browser. Export a JSON copy first if you might need it again.', { name: strong(p.name) }),
      });
      if (!ok) return;
      try {
        const data = await store.exportProjectData(id);
        await store.deleteProject(id);
        toast(t('Deleted “{name}”.', { name: iso(p.name) }), {
          type: 'success',
          action: data ? {
            label: t('Undo'),
            onClick: async () => {
              try { await store.saveImportedProject(data); toast(t('Restored “{name}”.', { name: iso(p.name) }), { type: 'success' }); } catch (err) { toastError(err, t('Could not restore the project')); }
            },
          } : null,
        });
      } catch (err) { toastError(err, t('Could not delete the project')); }
    };

    const loadDemo = async () => {
      try {
        const { createDemoProject } = await import('../demo/meyar.js');
        const project = await store.saveImportedProject(createDemoProject(), { asCopy: false });
        ctx.navigate(href(project.id, 'dashboard'));
      } catch (err) { toastError(err, t('Could not load the demo project')); }
    };

    d.add(on(container, 'click', '[data-action]', (e, el) => {
      const { action, id } = el.dataset;
      if (action === 'open') return; // plain link
      e.preventDefault();
      if (action === 'new') newProject();
      else if (action === 'import') importProject();
      else if (action === 'duplicate') duplicate(id);
      else if (action === 'export') exportJson(id);
      else if (action === 'delete') remove(id);
      else if (action === 'demo') loadDemo();
    }));

    d.add(store.on('projects', render));
    render();
    if (ctx.params?.query?.new === '1') newProject();

    return { unmount() { alive = false; d.dispose(); } };
  },
};
