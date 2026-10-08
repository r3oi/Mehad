// Automatic acronym detection: finds "Full Name (ABBR)" patterns whose
// initials match the abbreviation, e.g. "Role-Based Access Control (RBAC)".
import { walkSections } from '../core/model.js';
import { getNumbering } from '../core/numbering.js';
import { resolveText } from '../core/references.js';

const STOP = new Set(['of', 'and', 'for', 'the', 'to', 'in', 'on', 'a', 'an', '&', 'with', 'by', 'at', 'as', 'or']);
const PATTERN = /([A-Za-z][\w'’&.-]*(?:\s+[A-Za-z&][\w'’&.-]*){0,9})\s*\(\s*([A-Z][A-Za-z0-9&]{1,11})\s*\)/g;

/** Letters a word can contribute: first letter + internal capitals (JavaScript → JS). */
function initialsOf(word) {
  const clean = word.replace(/[^A-Za-z0-9&]/g, '');
  if (!clean) return '';
  return (clean[0] + clean.slice(1).replace(/[^A-Z0-9]/g, '')).toUpperCase();
}

function matches(words, abbr) {
  const target = abbr.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const content = words.filter((w) => !STOP.has(w.toLowerCase()));
  const strict = content.map((w) => w.replace(/[^A-Za-z0-9]/g, '')[0] || '').join('').toUpperCase();
  if (strict === target) return true;
  const loose = content.map(initialsOf).join('');
  if (loose === target) return true;
  const withStops = words.map((w) => w.replace(/[^A-Za-z0-9&]/g, '')[0] || '').join('').toUpperCase();
  return withStops === target;
}

/** scanText(text) → [{ acronym, meaning, index }] */
export function scanText(text) {
  const out = [];
  const src = String(text || '');
  for (const m of src.matchAll(PATTERN)) {
    const abbr = m[2];
    if (!/[A-Z].*[A-Z]|[A-Z]{2}/.test(abbr) && abbr.length < 2) continue;
    // Split the phrase into words, treating hyphens as word boundaries.
    const phrase = m[1];
    const tokens = [...phrase.matchAll(/[A-Za-z&][\w'’&.]*/g)];
    for (let k = 1; k <= tokens.length; k += 1) {
      const slice = tokens.slice(tokens.length - k);
      const words = slice.map((t) => t[0]);
      if (STOP.has(words[0].toLowerCase())) continue;
      if (matches(words, abbr)) {
        const start = slice[0].index;
        const meaning = phrase.slice(start).replace(/\s+/g, ' ').trim();
        out.push({ acronym: abbr, meaning, index: m.index + start });
        break;
      }
    }
  }
  return out;
}

/** All places that hold prose or labels: [{ kind, id, label, text }] */
export function textSources(project) {
  const n = getNumbering(project);
  const sources = [];
  for (const fm of project.frontMatter) if (fm.body) sources.push({ kind: 'front', id: fm.id, label: fm.title, text: fm.body });
  for (const ch of project.chapters) if (ch.body) sources.push({ kind: 'chapter', id: ch.id, label: `${n.chapters.get(ch.id)?.label}: ${ch.title}`, text: resolveText(project, ch.body) });
  walkSections(project, (sec) => { if (sec.body) sources.push({ kind: 'section', id: sec.id, label: `${n.sections.get(sec.id)?.number} ${sec.title}`, text: resolveText(project, sec.body) }); });
  for (const fig of project.figures) {
    const text = (fig.diagram?.elements || []).map((el) => el.text).filter(Boolean).join('\n');
    const all = [fig.description, text].filter(Boolean).join('\n');
    if (all) sources.push({ kind: 'figure', id: fig.id, label: `${n.figures.get(fig.id)?.label}: ${fig.title}`, text: all });
  }
  for (const t of project.tables) {
    const text = [t.description, ...t.rows.flat().map((c) => c?.text)].filter(Boolean).join('\n');
    if (text) sources.push({ kind: 'table', id: t.id, label: `${n.tables.get(t.id)?.label}: ${t.title}`, text });
  }
  return sources;
}

const norm = (s) => String(s || '').trim().toUpperCase();

/**
 * detectAcronymSuggestions(project) → [{ acronym, meaning, sources: [{ kind, id, label }] }]
 * Excludes acronyms already defined and ones the user dismissed.
 */
export function detectAcronymSuggestions(project) {
  const existing = new Set(project.acronyms.map((a) => norm(a.acronym)));
  const dismissed = new Set((project.dismissedSuggestions || []).map(norm));
  const found = new Map();
  for (const src of textSources(project)) {
    for (const hit of scanText(src.text)) {
      const key = norm(hit.acronym);
      if (existing.has(key) || dismissed.has(key)) continue;
      if (!found.has(key)) found.set(key, { acronym: hit.acronym, meanings: new Map(), sources: [] });
      const entry = found.get(key);
      entry.meanings.set(hit.meaning, (entry.meanings.get(hit.meaning) || 0) + 1);
      if (!entry.sources.some((s) => s.id === src.id)) entry.sources.push({ kind: src.kind, id: src.id, label: src.label });
    }
  }
  return [...found.values()].map((e) => ({
    acronym: e.acronym,
    meaning: [...e.meanings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    sources: e.sources,
  })).sort((a, b) => a.acronym.localeCompare(b.acronym));
}

/** Count whole-word uses of an acronym across the project's text. */
export function countUsages(project, acronym) {
  const re = new RegExp(`\\b${acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return textSources(project).reduce((sum, src) => sum + (src.text.match(re)?.length || 0), 0);
}
