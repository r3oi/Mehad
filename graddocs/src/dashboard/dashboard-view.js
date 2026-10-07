// Dashboard (#/p/<id>/dashboard): project overview, progress, health checks,
// recent activity, quick actions and recent figures.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { walkSections, SECTION_STATUSES } from '../core/model.js';
import { getNumbering } from '../core/numbering.js';
import { findBrokenReferences } from '../core/references.js';
import { relativeTime, formatDate, plural } from '../core/utils.js';
import { detectAcronymSuggestions } from '../acronyms/detection.js';
import { isDirty } from '../figures/versions.js';
import { renderThumbnail } from '../figures/render.js';
import { projectDetailFields } from '../projects/projects-view.js';

const WEIGHT = Object.fromEntries(SECTION_STATUSES.map((s) => [s.value, s.weight]));
const hueOf = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const initialsOf = (name) => String(name || '').split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || '').join('').slice(0, 2).toUpperCase() || 'P';
const ACTIVITY_ICONS = { create: 'plus', revision: 'history', edit: 'edit', delete: 'trash', export: 'export' };

/** Progress of every chapter and of the whole project, from section statuses. */
export function computeProgress(project) {
  const rows = new Map(project.chapters.map((c) => [c.id, { chapter: c, total: 0, weight: 0, done: 0 }]));
  let total = 0; let weight = 0; let done = 0;
  walkSections(project, (sec, { chapter }) => {
    const row = rows.get(chapter.id);
    const w = WEIGHT[sec.status] ?? 0;
    row.total += 1; row.weight += w; total += 1; weight += w;
    if (sec.status === 'done') { row.done += 1; done += 1; }
  });
  const pct = (w, t) => (t ? Math.round((w / t) * 100) : 0);
  return {
    total, done, pct: pct(weight, total),
    chapters: [...rows.values()].map((r) => ({ ...r, pct: pct(r.weight, r.total) })),
  };
}

/** Things worth fixing before exporting. Each: { id, tone, icon, count, label, hint, href }. */
function healthChecks(project, ctx, suggestions) {
  const n = getNumbering(project);
  const checks = [];
  const names = (list, max = 2) => {
    const uniq = [...new Set(list)];
    return uniq.slice(0, max).map((t) => `“${t}”`).join(', ') + (uniq.length > max ? ` +${uniq.length - max} more` : '');
  };
  const itemHref = (section, list) => (list.length === 1 ? ctx.href(section, list[0].id) : ctx.href(section));

  const broken = findBrokenReferences(project);
  if (broken.length) {
    checks.push({
      id: 'refs', tone: 'danger', icon: 'unlink', count: broken.length,
      label: `Broken cross ${broken.length === 1 ? 'reference' : 'references'}`,
      hint: `In ${names(broken.map((b) => b.ownerTitle || 'Untitled'))}`,
      href: ctx.href('chapters', null, { focus: broken[0].ownerId }),
    });
  }

  const unFigs = project.figures.filter((f) => !n.figures.get(f.id)?.sectionId);
  if (unFigs.length) {
    checks.push({
      id: 'figs', tone: 'warning', icon: 'figure', count: unFigs.length,
      label: `${unFigs.length === 1 ? 'Figure' : 'Figures'} not assigned to a section`,
      hint: `${names(unFigs.map((f) => f.title))} won’t appear in a chapter`,
      href: itemHref('figures', unFigs),
    });
  }
  const unTabs = project.tables.filter((t) => !n.tables.get(t.id)?.sectionId);
  if (unTabs.length) {
    checks.push({
      id: 'tabs', tone: 'warning', icon: 'table', count: unTabs.length,
      label: `${unTabs.length === 1 ? 'Table' : 'Tables'} not assigned to a section`,
      hint: `${names(unTabs.map((t) => t.title))} won’t appear in a chapter`,
      href: itemHref('tables', unTabs),
    });
  }

  const empty = [];
  walkSections(project, (sec) => { if (!String(sec.body || '').trim()) empty.push(sec); });
  if (empty.length) {
    const first = n.sections.get(empty[0].id);
    checks.push({
      id: 'empty', tone: 'info', icon: 'fileText', count: empty.length,
      label: `${empty.length === 1 ? 'Section' : 'Sections'} with no text`,
      hint: first ? `Next up: ${first.number} ${first.title || 'Untitled'}` : '',
      href: ctx.href('chapters', null, { focus: empty[0].id }),
    });
  }

  if (suggestions.length) {
    checks.push({
      id: 'acr', tone: 'info', icon: 'sparkles', count: suggestions.length,
      label: `Acronym ${suggestions.length === 1 ? 'suggestion' : 'suggestions'} pending`,
      hint: suggestions.slice(0, 4).map((s) => s.acronym).join(', ') + (suggestions.length > 4 ? '…' : ''),
      href: ctx.href('acronyms'),
    });
  }

  const commented = project.figures.filter((f) => (f.comments || []).some((c) => !c.resolved));
  if (commented.length) {
    const open = commented.reduce((s, f) => s + f.comments.filter((c) => !c.resolved).length, 0);
    checks.push({
      id: 'comments', tone: 'warning', icon: 'message', count: commented.length,
      label: `${commented.length === 1 ? 'Figure' : 'Figures'} with open comments`,
      hint: `${plural(open, 'unresolved comment')} to review`,
      href: itemHref('figures', commented),
    });
  }

  const dirty = project.figures.filter((f) => isDirty(f));
  if (dirty.length) {
    checks.push({
      id: 'dirty', tone: 'info', icon: 'history', count: dirty.length,
      label: `${dirty.length === 1 ? 'Figure' : 'Figures'} with unsaved changes`,
      hint: 'Changes not yet saved as a version',
      href: itemHref('figures', dirty),
    });
  }
  return checks;
}

export default {
  title: 'Dashboard',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;

    const statCard = ({ to, ico, tone = 'primary', label, value, sub, extra = '' }) => `
      <a class="card interactive dash-stat" href="${to}">
        <div class="ds-top"><span class="ds-ico tone-${tone}">${icon(ico)}</span><span class="ds-label">${esc(label)}</span></div>
        <div class="ds-value">${value}</div>
        <div class="ds-sub">${sub}</div>
        ${extra}
      </a>`;

    const fact = (ico, label, value) => `
      <div class="dash-fact">${icon(ico)}<div class="min0"><div class="df-label">${esc(label)}</div>
      <div class="df-value ${value ? '' : 'muted'}">${value ? esc(value) : 'Not set'}</div></div></div>`;

    const render = () => {
      const project = store.project;
      if (!alive || !project) return;
      const n = getNumbering(project);
      const progress = computeProgress(project);
      const suggestions = detectAcronymSuggestions(project);
      const checks = healthChecks(project, ctx, suggestions);
      const students = String(project.students || '').split(/\n|,/).map((s) => s.trim()).filter(Boolean).join(', ');
      const sectionCount = progress.total;
      const unFigs = project.figures.filter((f) => !n.figures.get(f.id)?.sectionId).length;
      const unTabs = project.tables.filter((t) => !n.tables.get(t.id)?.sectionId).length;
      const recentFigures = [...project.figures].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
      const activity = (project.activity || []).slice(0, 8);

      container.innerHTML = `
      <div class="page dash-page">
        <section class="card dash-hero" style="--hue:${hueOf(project.name)}">
          <div class="dash-hero-main">
            <span class="dash-avatar">${esc(initialsOf(project.name))}</span>
            <div class="grow min0">
              <div class="dash-title-row">
                <h1>${esc(project.name)}</h1>
                ${project.type ? `<span class="badge badge-primary">${esc(project.type)}</span>` : ''}
              </div>
              <p class="dash-desc ${project.description ? '' : 'muted'}">${project.description ? esc(project.description) : 'No description yet. Add one in Edit details.'}</p>
            </div>
            <button class="btn" data-action="edit-details">${icon('edit')}Edit details</button>
          </div>
          <div class="dash-facts">
            ${fact('calendar', 'Academic year', project.academicYear)}
            ${fact('user', 'Supervisor', project.supervisor)}
            ${fact('user', 'Students', students)}
            ${fact('building', 'University', project.university)}
            ${fact('building', 'College', project.college)}
            ${fact('layers', 'Department', project.department)}
          </div>
        </section>

        <section class="dash-stats" aria-label="Project statistics">
          ${statCard({ to: ctx.href('figures'), ico: 'figure', label: 'Total Figures', value: project.figures.length, sub: unFigs ? `${unFigs} not assigned` : (project.figures.length ? 'All assigned' : 'None yet') })}
          ${statCard({ to: ctx.href('tables'), ico: 'table', tone: 'info', label: 'Total Tables', value: project.tables.length, sub: unTabs ? `${unTabs} not assigned` : (project.tables.length ? 'All assigned' : 'None yet') })}
          ${statCard({ to: ctx.href('acronyms'), ico: 'acronym', tone: 'warning', label: 'Total Acronyms', value: project.acronyms.length, sub: suggestions.length ? `${plural(suggestions.length, 'suggestion')} pending` : 'Up to date' })}
          ${statCard({ to: ctx.href('structure'), ico: 'chapters', tone: 'success', label: 'Total Chapters', value: project.chapters.length, sub: plural(sectionCount, 'section') })}
          ${statCard({ to: ctx.href('settings', null, { tab: 'storage' }), ico: 'clock', tone: 'muted', label: 'Last Modified', value: `<span class="ds-value-sm">${esc(relativeTime(project.updatedAt))}</span>`, sub: esc(formatDate(project.updatedAt)) })}
          ${statCard({
            to: ctx.href('chapters'), ico: 'target', tone: 'primary', label: 'Completion Status',
            value: `${progress.pct}%`,
            sub: sectionCount ? `${progress.done} of ${plural(sectionCount, 'section')} done` : 'No sections yet',
            extra: `<div class="progress ds-progress ${progress.pct === 100 ? 'is-done' : ''}" role="progressbar" aria-valuenow="${progress.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress.pct}%"></span></div>`,
          })}
        </section>

        <div class="dash-cols">
          <div class="dash-col">
            <section class="card dash-progress-card" style="order:2">
              <div class="card-header"><h2>Chapter progress</h2><a class="btn btn-ghost btn-sm" href="${ctx.href('structure')}">Structure</a></div>
              <div class="card-body">
                ${progress.chapters.length ? progress.chapters.map(({ chapter, total, done, pct }) => `
                  <a class="cp-row" href="${ctx.href('chapters', null, { focus: chapter.id })}">
                    <div class="cp-head"><span class="cp-title truncate">${esc(n.chapters.get(chapter.id)?.label || 'Chapter')}: ${esc(chapter.title)}</span><span class="cp-pct">${pct}%</span></div>
                    <div class="progress ${pct === 100 ? 'is-done' : ''}"><span style="width:${pct}%"></span></div>
                    <div class="cp-sub">${total ? `${done}/${total} sections done` : 'No sections yet'}</div>
                  </a>`).join('') : `
                  <div class="dash-empty">${icon('chapters')}<div><b>No chapters yet</b><div class="muted">Build your report outline to track progress.</div></div>
                  <a class="btn btn-sm" href="${ctx.href('structure', null, { new: 'chapter' })}">${icon('plus')}Add chapter</a></div>`}
              </div>
            </section>
          </div>

          <div class="dash-col">
            <section class="card dash-health-card" style="order:1">
              <div class="card-header"><h2>Health checks</h2>
                ${checks.length ? `<span class="badge badge-warning">${plural(checks.length, 'issue')}</span>` : `<span class="badge badge-success">${icon('check')}All good</span>`}
              </div>
              <div class="card-body dash-health">
                ${checks.length ? checks.map((c) => `
                  <div class="hc-row" data-check="${c.id}">
                    <span class="hc-ico tone-${c.tone}">${icon(c.icon)}</span>
                    <div class="grow min0"><div class="hc-label">${esc(c.label)}</div><div class="hc-hint truncate">${esc(c.hint)}</div></div>
                    <span class="hc-count tone-${c.tone}">${c.count}</span>
                    <a class="btn btn-sm" href="${c.href}">Fix${icon('arrowRight', 'icon-sm')}</a>
                  </div>`).join('') : `
                  <div class="hc-ok">${icon('checkCircle', 'icon-lg')}<div><b>All good</b>
                    <div class="muted">No broken references, unassigned figures or tables, empty sections, pending suggestions, open comments or unsaved figure changes.</div></div></div>`}
              </div>
            </section>

            <section class="card dash-quick-card" style="order:3">
              <div class="card-header"><h2>Quick actions</h2></div>
              <div class="card-body dash-quick">
                <a class="btn quick" href="${ctx.href('figures', null, { new: '1' })}">${icon('figure')}New Figure</a>
                <a class="btn quick" href="${ctx.href('tables', null, { new: '1' })}">${icon('table')}New Table</a>
                <a class="btn quick" href="${ctx.href('acronyms', null, { new: '1' })}">${icon('acronym')}Add Acronym</a>
                <a class="btn quick" href="${ctx.href('structure', null, { new: 'chapter' })}">${icon('chapters')}Add Chapter</a>
                <a class="btn quick" href="${ctx.href('preview')}">${icon('preview')}Document Preview</a>
                <a class="btn quick" href="${ctx.href('export')}">${icon('export')}Export package</a>
              </div>
            </section>

            <section class="card dash-activity-card" style="order:4">
              <div class="card-header"><h2>Recent activity</h2></div>
              <div class="card-body dash-activity">
                ${activity.length ? activity.map((a) => `
                  <div class="act-row"><span class="act-ico">${icon(ACTIVITY_ICONS[a.kind] || 'activity', 'icon-sm')}</span>
                    <span class="act-text">${esc(a.text)}</span><span class="act-time">${esc(relativeTime(a.at))}</span></div>`).join('')
                  : `<div class="dash-empty">${icon('activity')}<div><b>No activity yet</b><div class="muted">Your edits will show up here.</div></div></div>`}
              </div>
            </section>
          </div>
        </div>

        <section class="dash-recent" style="margin-top:20px">
          <div class="row" style="margin-bottom:10px"><h2 class="grow">Recent figures</h2><a class="btn btn-ghost btn-sm" href="${ctx.href('figures')}">View all${icon('arrowRight', 'icon-sm')}</a></div>
          ${recentFigures.length ? `<div class="rf-grid">${recentFigures.map((fig) => {
            const info = n.figures.get(fig.id);
            return `
            <a class="card interactive rf-card" href="${ctx.href('figures', fig.id)}" data-tip="Open in the figure editor">
              <div class="thumb rf-thumb">${renderThumbnail(fig)}</div>
              <div class="rf-body">
                <div class="rf-label">${esc(info?.label || 'Figure')}</div>
                <div class="rf-title truncate" title="${esc(fig.title)}">${esc(fig.title)}</div>
                <div class="rf-meta truncate">Updated ${esc(relativeTime(fig.updatedAt))}</div>
              </div>
            </a>`;
          }).join('')}</div>` : `
          <div class="card"><div class="empty-state" style="padding:36px 24px">
            <div class="empty-icon">${icon('figure')}</div><h3>No figures yet</h3>
            <p>Create a diagram from a template and it will be numbered automatically.</p>
            <a class="btn btn-primary" href="${ctx.href('figures', null, { new: '1' })}">${icon('plus')}New Figure</a>
          </div></div>`}
        </section>
      </div>`;
    };

    const editDetails = async () => {
      const values = await formDialog({
        title: 'Edit project details', subtitle: 'Shown on the title page of your report.',
        size: 'lg', submitText: 'Save changes', fields: projectDetailFields(store.project),
      });
      if (!values) return;
      store.update((p) => Object.assign(p, values), { activity: 'Updated project details' });
      toast('Project details saved.', { type: 'success' });
    };

    d.add(on(container, 'click', '[data-action="edit-details"]', () => editDetails()));
    d.add(store.on('change', render));
    ctx.shell.setBreadcrumbs([{ label: 'Dashboard' }]);
    render();

    return { unmount() { alive = false; d.dispose(); } };
  },
};
