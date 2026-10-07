// Project-wide search across figures (including text inside diagrams),
// tables (including cells), acronyms, chapters, sections and front matter.
import { getNumbering } from '../core/numbering.js';
import { resolveText } from '../core/references.js';
import { walkSections } from '../core/model.js';
import { href } from './routes.js';
import { t } from '../i18n/index.js';

function snippet(text, query, radius = 38) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return '';
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

function score(fields, query) {
  const q = query.toLowerCase();
  let best = 0; let hitText = '';
  for (const [text, weight] of fields) {
    if (!text) continue;
    const t = String(text).toLowerCase();
    const i = t.indexOf(q);
    if (i < 0) continue;
    const s = weight * (i === 0 ? 3 : /\W/.test(t[i - 1] || ' ') ? 2 : 1);
    if (s > best) { best = s; hitText = String(text); }
  }
  return { score: best, hitText };
}

/** search(project, query) → [{ kind, id, title, sub, snippet, href, score }] */
export function searchProject(project, query, { limit = 40 } = {}) {
  const q = query.trim();
  if (!project || !q) return [];
  const n = getNumbering(project);
  const results = [];
  const push = (base, fields) => {
    const { score: s, hitText } = score(fields, q);
    if (s > 0) results.push({ ...base, score: s, snippet: hitText && hitText !== base.title ? snippet(hitText, q) : '' });
  };

  for (const fig of project.figures) {
    const info = n.figures.get(fig.id);
    const texts = (fig.diagram?.elements || []).map((el) => el.text || el.label).filter(Boolean).join(' · ');
    push({ kind: 'figure', id: fig.id, title: `${info?.label || 'Figure'} — ${fig.title}`, sub: info?.location || '', href: href(project.id, 'figures', fig.id) },
      [[fig.title, 10], [info?.label, 6], [info?.code, 6], [fig.description, 3], [fig.type, 2], [texts, 2]]);
  }
  for (const tab of project.tables) {
    const info = n.tables.get(tab.id);
    const cells = tab.rows.flat().map((c) => c?.text).filter(Boolean).join(' · ');
    push({ kind: 'table', id: tab.id, title: `${info?.label || 'Table'} — ${tab.title}`, sub: info?.location || '', href: href(project.id, 'tables', tab.id) },
      [[tab.title, 10], [info?.label, 6], [info?.code, 6], [tab.description, 3], [cells, 2]]);
  }
  for (const a of project.acronyms) {
    push({ kind: 'acronym', id: a.id, title: `${a.acronym} — ${a.meaning}`, sub: t('Acronym'), href: href(project.id, 'acronyms', null, { focus: a.id }) },
      [[a.acronym, 10], [a.meaning, 7], [a.description, 2]]);
  }
  for (const ch of project.chapters) {
    const info = n.chapters.get(ch.id);
    push({ kind: 'chapter', id: ch.id, title: `${info.label}: ${ch.title}`, sub: t('Chapter'), href: href(project.id, 'chapters', null, { focus: ch.id }) },
      [[ch.title, 9], [info.label, 5], [resolveText(project, ch.body), 2]]);
  }
  walkSections(project, (sec) => {
    const info = n.sections.get(sec.id);
    const ch = n.chapters.get(info.chapterId);
    push({ kind: 'section', id: sec.id, title: `${info.number} ${sec.title}`, sub: ch ? `${ch.label}: ${ch.title}` : '', href: href(project.id, 'chapters', null, { focus: sec.id }) },
      [[sec.title, 8], [info.number, 5], [`Section ${info.number}`, 4], [resolveText(project, sec.body), 2]]);
  });
  for (const fm of project.frontMatter) {
    push({ kind: 'front', id: fm.id, title: fm.title, sub: t('Front matter'), href: href(project.id, 'structure', null, { focus: fm.id }) },
      [[fm.title, 6], [fm.body, 2]]);
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results.slice(0, limit);
}

export const KIND_ICONS = { figure: 'figure', table: 'table', acronym: 'acronym', chapter: 'chapters', section: 'structure', front: 'fileText' };
