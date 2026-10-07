// Dashboard (#/p/<id>/dashboard): project overview, progress, health checks,
// recent activity, quick actions and recent figures.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { walkSections, SECTION_STATUSES } from '../core/model.js';
import { getNumbering } from '../core/numbering.js';
import { findBrokenReferences } from '../core/references.js';
import { relativeTime, formatDate, escapeRegExp } from '../core/utils.js';
import { t, isRTL } from '../i18n/index.js';
import { detectAcronymSuggestions } from '../acronyms/detection.js';
import { isDirty } from '../figures/versions.js';
import { renderThumbnail } from '../figures/render.js';
import { projectDetailFields, iso, count } from '../projects/projects-view.js';

const WEIGHT = Object.fromEntries(SECTION_STATUSES.map((s) => [s.value, s.weight]));
const hueOf = (text) => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const initialsOf = (name) => String(name || '').split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || '').join('').slice(0, 2).toUpperCase() || 'P';
const ACTIVITY_ICONS = { create: 'plus', revision: 'history', edit: 'edit', delete: 'trash', export: 'export' };

// The activity log stores English sentences (they are project data), written by
// every module. For display they are matched against these templates and
// re-rendered in the interface language. Specific templates come before generic ones.
export const ACTIVITY_TEMPLATES = [
  'Created project', 'Updated project details', 'Updated {tab} settings', 'Reordered front matter', 'Reordered figures',
  'Added a table row', 'Deleted a table row', 'Added a table column', 'Deleted a table column', 'Merged table cells', 'Unmerged table cells', 'Duplicated a table',
  'Imported 1 acronym', 'Imported {n} acronyms', 'Added 1 detected acronym', 'Added {n} detected acronyms',
  'Added acronym {acronym}', 'Updated acronym {acronym}', 'Deleted acronym {acronym}', 'Restored acronym {acronym}',
  'Dismissed suggestion {acronym}', 'Restored suggestion {acronym}',
  'Renamed page “{title}”', 'Renamed {kind} “{title}”', 'Added chapter “{title}”', 'Added a section under “{title}”',
  'Added front matter page “{title}”', 'Deleted front matter page “{title}”',
  'Deleted {kind} “{title}”', 'Restored {kind} “{title}”',
  'Marked “{title}” as {status}', 'Moved “{title}”', 'Indented “{title}”', 'Outdented “{title}”', 'Included “{title}”', 'Excluded “{title}”',
  'Edited table “{title}”', 'Formatted table “{title}”', 'Changed styling of table “{title}”', 'Changed header rows of table “{title}”',
  'Resized columns of table “{title}”', 'Cleared cells in table “{title}”', 'Cut cells in table “{title}”', 'Pasted cells into table “{title}”',
  'Deleted table “{title}”', 'Restored table “{title}”', 'Moved table “{title}” up', 'Moved table “{title}” down',
  'Edited details of table “{title}”', 'Created table “{title}”',
  'Undo in table “{title}”', 'Redo in table “{title}”', 'Saved version {n} of table “{title}”', 'Restored version {n} of table “{title}”',
  'Moved table “{title}”', 'Edited description of table “{title}”', 'Renamed table “{title}”',
  'Edited figure “{title}”', 'Duplicated figure “{title}”', 'Deleted figure “{title}”', 'Created figure “{title}”', 'Restored figure “{title}”',
  'Saved revision of “{title}”', 'Saved version of “{title}”', 'Updated details of “{title}”', 'Commented on “{title}”', 'Restored v{n} of “{title}”',
  'Edited “{title}”', 'Saved revision #{n} of {title}', 'Updated {title}',
];
const STATUS_EN = { 'not started': 'Not started', draft: 'Draft', 'in review': 'In review', done: 'Done' };
const ACTIVITY_PARAMS = {
  n: { re: '(\\d+)', map: (v) => v },
  tab: { re: '(document|captions|figures)', map: (v) => t(v.charAt(0).toUpperCase() + v.slice(1)) },
  kind: { re: '(chapter|section)', map: (v) => t(v) },
  status: { re: '(.+)', map: (v) => { const en = STATUS_EN[v.toLowerCase()]; return en ? t(en) : v; } },
};
const ACTIVITY_MATCHERS = ACTIVITY_TEMPLATES.map((key) => {
  const names = [];
  const source = escapeRegExp(key).replace(/[“”]/g, '["“”]').replace(/\\\{(\w+)\\\}/g, (m, name) => { names.push(name); return ACTIVITY_PARAMS[name]?.re || '(.+)'; });
  return { key, names, re: new RegExp(`^${source}$`) };
});
/** Interface-language text for a stored activity entry (unknown sentences are shown as stored). */
function activityText(text) {
  const raw = String(text ?? '');
  if (!isRTL) return raw;
  for (const { key, names, re } of ACTIVITY_MATCHERS) {
    const m = re.exec(raw);
    if (!m) continue;
    const params = {};
    names.forEach((name, i) => { params[name] = ACTIVITY_PARAMS[name] ? ACTIVITY_PARAMS[name].map(m[i + 1]) : iso(m[i + 1]); });
    return t(key, params);
  }
  return raw;
}

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
  const pct = (w, all) => (all ? Math.round((w / all) * 100) : 0);
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
    return uniq.slice(0, max).map((x) => iso(`“${x}”`)).join(t(', ')) + (uniq.length > max ? ` ${t('+{n} more', { n: uniq.length - max })}` : '');
  };
  const itemHref = (section, list) => (list.length === 1 ? ctx.href(section, list[0].id) : ctx.href(section));

  const broken = findBrokenReferences(project);
  if (broken.length) {
    checks.push({
      id: 'refs', tone: 'danger', icon: 'unlink', count: broken.length,
      label: broken.length === 1 ? t('Broken cross reference') : t('Broken cross references'),
      hint: t('In {names}', { names: names(broken.map((b) => b.ownerTitle || t('Untitled'))) }),
      href: ctx.href('chapters', null, { focus: broken[0].ownerId }),
    });
  }

  const unFigs = project.figures.filter((f) => !n.figures.get(f.id)?.sectionId);
  if (unFigs.length) {
    checks.push({
      id: 'figs', tone: 'warning', icon: 'figure', count: unFigs.length,
      label: unFigs.length === 1 ? t('Figure not assigned to a section') : t('Figures not assigned to a section'),
      hint: t('{names} won’t appear in a chapter', { names: names(unFigs.map((f) => f.title)) }),
      href: itemHref('figures', unFigs),
    });
  }
  const unTabs = project.tables.filter((tb) => !n.tables.get(tb.id)?.sectionId);
  if (unTabs.length) {
    checks.push({
      id: 'tabs', tone: 'warning', icon: 'table', count: unTabs.length,
      label: unTabs.length === 1 ? t('Table not assigned to a section') : t('Tables not assigned to a section'),
      hint: t('{names} won’t appear in a chapter', { names: names(unTabs.map((tb) => tb.title)) }),
      href: itemHref('tables', unTabs),
    });
  }

  const empty = [];
  walkSections(project, (sec) => { if (!String(sec.body || '').trim()) empty.push(sec); });
  if (empty.length) {
    const first = n.sections.get(empty[0].id);
    checks.push({
      id: 'empty', tone: 'info', icon: 'fileText', count: empty.length,
      label: empty.length === 1 ? t('Section with no text') : t('Sections with no text'),
      hint: first ? t('Next up: {section}', { section: iso(`${first.number} ${first.title || t('Untitled')}`) }) : '',
      href: ctx.href('chapters', null, { focus: empty[0].id }),
    });
  }

  if (suggestions.length) {
    checks.push({
      id: 'acr', tone: 'info', icon: 'sparkles', count: suggestions.length,
      label: suggestions.length === 1 ? t('Acronym suggestion pending') : t('Acronym suggestions pending'),
      hint: suggestions.slice(0, 4).map((sg) => iso(sg.acronym)).join(t(', ')) + (suggestions.length > 4 ? '…' : ''),
      href: ctx.href('acronyms'),
    });
  }

  const commented = project.figures.filter((f) => (f.comments || []).some((c) => !c.resolved));
  if (commented.length) {
    const open = commented.reduce((s, f) => s + f.comments.filter((c) => !c.resolved).length, 0);
    checks.push({
      id: 'comments', tone: 'warning', icon: 'message', count: commented.length,
      label: commented.length === 1 ? t('Figure with open comments') : t('Figures with open comments'),
      hint: count(open, '1 unresolved comment to review', '{n} unresolved comments to review'),
      href: itemHref('figures', commented),
    });
  }

  const dirty = project.figures.filter((f) => isDirty(f));
  if (dirty.length) {
    checks.push({
      id: 'dirty', tone: 'info', icon: 'history', count: dirty.length,
      label: dirty.length === 1 ? t('Figure with unsaved changes') : t('Figures with unsaved changes'),
      hint: t('Changes not yet saved as a version'),
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
      <div class="df-value ${value ? '' : 'muted'}">${value ? esc(value) : t('Not set')}</div></div></div>`;

    const render = () => {
      const project = store.project;
      if (!alive || !project) return;
      const n = getNumbering(project);
      const progress = computeProgress(project);
      const suggestions = detectAcronymSuggestions(project);
      const checks = healthChecks(project, ctx, suggestions);
      const students = String(project.students || '').split(/\n|,/).map((x) => x.trim()).filter(Boolean).join(t(', '));
      const sectionCount = progress.total;
      const unFigs = project.figures.filter((f) => !n.figures.get(f.id)?.sectionId).length;
      const unTabs = project.tables.filter((tb) => !n.tables.get(tb.id)?.sectionId).length;
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
              <p class="dash-desc ${project.description ? '' : 'muted'}">${project.description ? esc(project.description) : t('No description yet. Add one in Edit details.')}</p>
            </div>
            <button class="btn" data-action="edit-details">${icon('edit')}${t('Edit details')}</button>
          </div>
          <div class="dash-facts">
            ${fact('calendar', t('Academic year'), project.academicYear)}
            ${fact('user', t('Supervisor'), project.supervisor)}
            ${fact('user', t('Students'), students)}
            ${fact('building', t('University'), project.university)}
            ${fact('building', t('College'), project.college)}
            ${fact('layers', t('Department'), project.department)}
          </div>
        </section>

        <section class="dash-stats" aria-label="${esc(t('Project statistics'))}">
          ${statCard({ to: ctx.href('figures'), ico: 'figure', label: t('Total Figures'), value: project.figures.length, sub: unFigs ? t('{n} not assigned', { n: unFigs }) : (project.figures.length ? t('All assigned') : t('None yet')) })}
          ${statCard({ to: ctx.href('tables'), ico: 'table', tone: 'info', label: t('Total Tables'), value: project.tables.length, sub: unTabs ? t('{n} not assigned', { n: unTabs }) : (project.tables.length ? t('All assigned') : t('None yet')) })}
          ${statCard({ to: ctx.href('acronyms'), ico: 'acronym', tone: 'warning', label: t('Total Acronyms'), value: project.acronyms.length, sub: suggestions.length ? count(suggestions.length, '1 suggestion pending', '{n} suggestions pending') : t('Up to date') })}
          ${statCard({ to: ctx.href('structure'), ico: 'chapters', tone: 'success', label: t('Total Chapters'), value: project.chapters.length, sub: count(sectionCount, '1 section', '{n} sections') })}
          ${statCard({ to: ctx.href('settings', null, { tab: 'storage' }), ico: 'clock', tone: 'muted', label: t('Last Modified'), value: `<span class="ds-value-sm">${esc(relativeTime(project.updatedAt))}</span>`, sub: `<bdi>${esc(formatDate(project.updatedAt))}</bdi>` })}
          ${statCard({
            to: ctx.href('chapters'), ico: 'target', tone: 'primary', label: t('Completion Status'),
            value: `<bdi>${progress.pct}%</bdi>`,
            sub: sectionCount ? (sectionCount === 1 ? t('{done} of 1 section done', { done: progress.done }) : t('{done} of {total} sections done', { done: progress.done, total: sectionCount })) : t('No sections yet'),
            extra: `<div class="progress ds-progress ${progress.pct === 100 ? 'is-done' : ''}" role="progressbar" aria-label="${esc(t('Completion Status'))}" aria-valuenow="${progress.pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress.pct}%"></span></div>`,
          })}
        </section>

        <div class="dash-cols">
          <div class="dash-col">
            <section class="card dash-progress-card" style="order:2">
              <div class="card-header"><h2>${t('Chapter progress')}</h2><a class="btn btn-ghost btn-sm" href="${ctx.href('structure')}">${t('Structure')}</a></div>
              <div class="card-body">
                ${progress.chapters.length ? progress.chapters.map(({ chapter, total, done, pct }) => `
                  <a class="cp-row" href="${ctx.href('chapters', null, { focus: chapter.id })}">
                    <div class="cp-head"><span class="cp-title truncate"><bdi>${esc(n.chapters.get(chapter.id)?.label || t('Chapter'))}: ${esc(chapter.title)}</bdi></span><span class="cp-pct"><bdi>${pct}%</bdi></span></div>
                    <div class="progress ${pct === 100 ? 'is-done' : ''}"><span style="width:${pct}%"></span></div>
                    <div class="cp-sub">${total ? t('{done}/{total} sections done', { done, total }) : t('No sections yet')}</div>
                  </a>`).join('') : `
                  <div class="dash-empty">${icon('chapters')}<div><b>${t('No chapters yet')}</b><div class="muted">${t('Build your report outline to track progress.')}</div></div>
                  <a class="btn btn-sm" href="${ctx.href('structure', null, { new: 'chapter' })}">${icon('plus')}${t('Add chapter')}</a></div>`}
              </div>
            </section>
          </div>

          <div class="dash-col">
            <section class="card dash-health-card" style="order:1">
              <div class="card-header"><h2>${t('Health checks')}</h2>
                ${checks.length ? `<span class="badge badge-warning">${esc(count(checks.length, '1 issue', '{n} issues'))}</span>` : `<span class="badge badge-success">${icon('check')}${t('All good')}</span>`}
              </div>
              <div class="card-body dash-health">
                ${checks.length ? checks.map((c) => `
                  <div class="hc-row" data-check="${c.id}">
                    <span class="hc-ico tone-${c.tone}">${icon(c.icon)}</span>
                    <div class="grow min0"><div class="hc-label">${esc(c.label)}</div><div class="hc-hint truncate">${esc(c.hint)}</div></div>
                    <span class="hc-count tone-${c.tone}">${c.count}</span>
                    <a class="btn btn-sm" href="${c.href}">${t('Fix')}${icon('arrowRight', 'icon-sm')}</a>
                  </div>`).join('') : `
                  <div class="hc-ok">${icon('checkCircle', 'icon-lg')}<div><b>${t('All good')}</b>
                    <div class="muted">${t('No broken references, unassigned figures or tables, empty sections, pending suggestions, open comments or unsaved figure changes.')}</div></div></div>`}
              </div>
            </section>

            <section class="card dash-quick-card" style="order:3">
              <div class="card-header"><h2>${t('Quick actions')}</h2></div>
              <div class="card-body dash-quick">
                <a class="btn quick" href="${ctx.href('figures', null, { new: '1' })}">${icon('figure')}${t('New Figure')}</a>
                <a class="btn quick" href="${ctx.href('tables', null, { new: '1' })}">${icon('table')}${t('New Table')}</a>
                <a class="btn quick" href="${ctx.href('acronyms', null, { new: '1' })}">${icon('acronym')}${t('Add Acronym')}</a>
                <a class="btn quick" href="${ctx.href('structure', null, { new: 'chapter' })}">${icon('chapters')}${t('Add Chapter')}</a>
                <a class="btn quick" href="${ctx.href('preview')}">${icon('preview')}${t('Document Preview')}</a>
                <a class="btn quick" href="${ctx.href('export')}">${icon('export')}${t('Export package')}</a>
              </div>
            </section>

            <section class="card dash-activity-card" style="order:4">
              <div class="card-header"><h2>${t('Recent activity')}</h2></div>
              <div class="card-body dash-activity">
                ${activity.length ? activity.map((a) => `
                  <div class="act-row"><span class="act-ico">${icon(ACTIVITY_ICONS[a.kind] || 'activity', 'icon-sm')}</span>
                    <span class="act-text">${esc(activityText(a.text))}</span><span class="act-time">${esc(relativeTime(a.at))}</span></div>`).join('')
                  : `<div class="dash-empty">${icon('activity')}<div><b>${t('No activity yet')}</b><div class="muted">${t('Your edits will show up here.')}</div></div></div>`}
              </div>
            </section>
          </div>
        </div>

        <section class="dash-recent" style="margin-top:20px">
          <div class="row" style="margin-bottom:10px"><h2 class="grow">${t('Recent figures')}</h2><a class="btn btn-ghost btn-sm" href="${ctx.href('figures')}">${t('View all')}${icon('arrowRight', 'icon-sm')}</a></div>
          ${recentFigures.length ? `<div class="rf-grid">${recentFigures.map((fig) => {
            const info = n.figures.get(fig.id);
            return `
            <a class="card interactive rf-card" href="${ctx.href('figures', fig.id)}" data-tip="${esc(t('Open in the figure editor'))}">
              <div class="thumb rf-thumb">${renderThumbnail(fig)}</div>
              <div class="rf-body">
                <div class="rf-label"><bdi>${esc(info?.label || t('Figure'))}</bdi></div>
                <div class="rf-title truncate" title="${esc(fig.title)}"><bdi>${esc(fig.title)}</bdi></div>
                <div class="rf-meta truncate">${esc(t('Updated {time}', { time: iso(relativeTime(fig.updatedAt)) }))}</div>
              </div>
            </a>`;
          }).join('')}</div>` : `
          <div class="card"><div class="empty-state" style="padding:36px 24px">
            <div class="empty-icon">${icon('figure')}</div><h3>${t('No figures yet')}</h3>
            <p>${t('Create a diagram from a template and it will be numbered automatically.')}</p>
            <a class="btn btn-primary" href="${ctx.href('figures', null, { new: '1' })}">${icon('plus')}${t('New Figure')}</a>
          </div></div>`}
        </section>
      </div>`;
    };

    const editDetails = async () => {
      const values = await formDialog({
        title: t('Edit project details'), subtitle: t('Shown on the title page of your report.'),
        size: 'lg', submitText: t('Save changes'), fields: projectDetailFields(store.project),
      });
      if (!values) return;
      store.update((p) => Object.assign(p, values), { activity: 'Updated project details' });
      toast(t('Project details saved.'), { type: 'success' });
    };

    d.add(on(container, 'click', '[data-action="edit-details"]', () => editDetails()));
    d.add(store.on('change', render));
    ctx.shell.setBreadcrumbs([{ label: t('Dashboard') }]);
    render();

    return { unmount() { alive = false; d.dispose(); } };
  },
};
