// Bibliography: reference types, author parsing, formatting (IEEE / compact) and a small BibTeX importer.
// Pure functions only. Citation numbers ([1], [2] …) are derived in numbering.js like every other number.
// Text cites a reference with the cross-reference token {{ref:cite:<referenceId>}} (see references.js).

/** Field ids per type, in form order. `container` is named per type (Journal, Proceedings, Book, Website …). */
export const REFERENCE_TYPES = [
  { id: 'journal', label: 'Journal article', container: 'Journal', fields: ['authors', 'title', 'container', 'volume', 'issue', 'pages', 'month', 'year', 'doi', 'url'] },
  { id: 'conference', label: 'Conference paper', container: 'Conference / proceedings', fields: ['authors', 'title', 'container', 'place', 'pages', 'month', 'year', 'publisher', 'doi', 'url'] },
  { id: 'book', label: 'Book', container: '', fields: ['authors', 'title', 'edition', 'publisher', 'place', 'year', 'doi', 'url'] },
  { id: 'chapter', label: 'Book chapter', container: 'Book title', fields: ['authors', 'title', 'container', 'editors', 'edition', 'pages', 'publisher', 'place', 'year', 'doi', 'url'] },
  { id: 'web', label: 'Website / online', container: 'Website', fields: ['authors', 'title', 'container', 'month', 'year', 'url', 'accessed'] },
  { id: 'thesis', label: 'Thesis / project', container: 'University', fields: ['authors', 'title', 'note', 'container', 'place', 'year', 'url'] },
  { id: 'report', label: 'Report / standard', container: 'Institution', fields: ['authors', 'title', 'container', 'note', 'place', 'month', 'year', 'url'] },
  { id: 'other', label: 'Other', container: 'Published in', fields: ['authors', 'title', 'container', 'publisher', 'place', 'month', 'year', 'url', 'accessed', 'note'] },
];

export const REFERENCE_STYLES = [
  { id: 'ieee', label: 'IEEE' },
  { id: 'compact', label: 'Compact (Surname I., "Title", …)' },
];

export const typeInfo = (id) => REFERENCE_TYPES.find((tp) => tp.id === id) || REFERENCE_TYPES[REFERENCE_TYPES.length - 1];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const stripEnd = (s) => clean(s).replace(/[\s.,;:]+$/, '');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const IEEE_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

/** "3", "mar", "March" → 2 (zero-based) or -1. */
function monthIndex(m) {
  const s = clean(m).toLowerCase().replace(/\.$/, '');
  if (!s) return -1;
  if (/^\d{1,2}$/.test(s)) { const n = Number(s) - 1; return n >= 0 && n < 12 ? n : -1; }
  return MONTHS.findIndex((name) => name.toLowerCase().startsWith(s.slice(0, 3)));
}
const ieeeMonth = (m) => { const i = monthIndex(m); return i >= 0 ? IEEE_MONTHS[i] : clean(m); };
const longMonth = (m) => { const i = monthIndex(m); return i >= 0 ? MONTHS[i] : clean(m); };

/**
 * "Ahmed D. Alharthi; Smith, John and Jane Roe" → [{ first: 'Ahmed D.', last: 'Alharthi' }, { first: 'John', last: 'Smith' }, …]
 * A name wrapped in braces ({World Health Organization}) or a single word is kept whole as `last`.
 */
export function parseNames(text) {
  return String(text ?? '').split(/\n|;|\s+and\s+/i).map(clean).filter(Boolean).map((raw) => {
    if (/^\{.*\}$/.test(raw)) return { first: '', last: raw.slice(1, -1).trim(), corporate: true };
    if (raw.includes(',')) {
      const [last, ...rest] = raw.split(',');
      return { first: clean(rest.join(' ')), last: clean(last) };
    }
    const words = raw.split(' ');
    if (words.length === 1) return { first: '', last: raw };
    // "Booth D." / "Alharthi A. D." (surname first, then initials, as in many reference lists).
    if (words.slice(1).every((w) => /^(?:[A-Z]\.?-?)+$/.test(w)) && !/^(?:[A-Z]\.?-?)+$/.test(words[0])) return { first: words.slice(1).join(' '), last: words[0] };
    // Particles stay with the surname: "Ludwig van Beethoven" → last "van Beethoven".
    let i = words.length - 1;
    while (i > 1 && /^(van|von|de|del|der|da|di|al|el|bin|ibn|la|le)$/i.test(words[i - 1])) i -= 1;
    return { first: words.slice(0, i).join(' '), last: words.slice(i).join(' ') };
  });
}

/** "Ahmed Dakhil" → "A. D."  ("Jean-Paul" → "J.-P.") */
export function initials(first) {
  return clean(first).split(' ').filter(Boolean).map((w) => (/^[A-Za-z]\.$/.test(w) ? w
    : w.split('-').map((part) => (part ? `${part[0].toUpperCase()}.` : '')).join('-'))).join(' ');
}

const ieeeName = (n) => (n.corporate || !n.first ? n.last : `${initials(n.first)} ${n.last}`);
const compactName = (n) => (n.corporate || !n.first ? n.last : `${n.last} ${initials(n.first).replace(/\s+/g, '')}`);

/** IEEE author list: "A", "A and B", "A, B, and C"; more than six → "A et al." */
export function ieeeAuthors(names) {
  const list = names.map(ieeeName);
  if (list.length > 6) return `${list[0]} et al.`;
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

const ordinal = (s) => {
  const v = clean(s); if (!/^\d+$/.test(v)) return v;
  const n = Number(v); const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${tail}`;
};
const pagesText = (p, prefix = true) => {
  const v = clean(p).replace(/\s*-{1,2}\s*/g, '–');
  if (!v) return '';
  return prefix ? `${/[–,]/.test(v) ? 'pp.' : 'p.'} ${v}` : v;
};

// A formatted entry is a list of runs: [{ text, italic? }]. Renderers italicise where asked; plain text joins them.
const run = (text, italic = false) => ({ text, italic });
function joinRuns(parts) {
  const out = [];
  for (const p of parts) {
    if (!p || !p.text) continue;
    const last = out[out.length - 1];
    if (last && last.italic === p.italic) last.text += p.text; else out.push({ ...p });
  }
  return out;
}

/** IEEE: A. B. Author, "Title," *Journal*, vol. 3, no. 2, pp. 1–9, Mar. 2020, doi: … */
function ieee(ref) {
  const names = parseNames(ref.authors);
  const authors = names.length ? `${ieeeAuthors(names)}, ` : '';
  const title = stripEnd(ref.title);
  const quoted = title ? `“${title},” ` : '';
  const year = clean(ref.year); const month = ieeeMonth(ref.month);
  const date = [month, year].filter(Boolean).join(' ');
  const doi = clean(ref.doi) ? `doi: ${clean(ref.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}.` : '';
  const online = clean(ref.url) ? `[Online]. Available: ${clean(ref.url)}` : '';
  const tail = (list) => list.filter(Boolean).join(', ');
  const R = [];
  switch (ref.type) {
    case 'journal': {
      R.push(run(authors + quoted));
      if (clean(ref.container)) R.push(run(stripEnd(ref.container), true));
      const rest = tail([clean(ref.volume) && `vol. ${clean(ref.volume)}`, clean(ref.issue) && `no. ${clean(ref.issue)}`, pagesText(ref.pages), date, doi]);
      R.push(run(`${clean(ref.container) && rest ? ', ' : ''}${rest}${doi ? '' : '.'}`));
      if (!doi && online) R.push(run(` ${online}`));
      break;
    }
    case 'conference': {
      R.push(run(`${authors}${quoted}`));
      if (clean(ref.container)) { R.push(run('in ')); R.push(run(stripEnd(ref.container), true)); }
      const rest = tail([clean(ref.place), date, pagesText(ref.pages), doi]);
      R.push(run(`${rest ? `${clean(ref.container) ? ', ' : ''}${rest}` : ''}${doi ? '' : '.'}`));
      if (!doi && online) R.push(run(` ${online}`));
      break;
    }
    case 'book': {
      R.push(run(authors));
      if (title) R.push(run(title, true));
      const ed = clean(ref.edition) ? `, ${ordinal(ref.edition)} ed` : '';
      const pub = [clean(ref.place), clean(ref.publisher)].filter(Boolean).join(': ');
      R.push(run(`${ed}. ${[pub, year].filter(Boolean).join(', ')}.`.replace(/^\. \./, '.')));
      if (doi) R.push(run(` ${doi}`)); else if (online) R.push(run(` ${online}`));
      break;
    }
    case 'chapter': {
      R.push(run(`${authors}${quoted}in `));
      if (clean(ref.container)) R.push(run(stripEnd(ref.container), true));
      const eds = parseNames(ref.editors);
      const edText = eds.length ? `, ${ieeeAuthors(eds)}, ${eds.length > 1 ? 'Eds' : 'Ed'}.` : '';
      const ed = clean(ref.edition) ? ` ${ordinal(ref.edition)} ed.` : '';
      const pub = [clean(ref.place), clean(ref.publisher)].filter(Boolean).join(': ');
      R.push(run(`${edText}${ed}${pub || year ? ` ${[pub, year].filter(Boolean).join(', ')}` : ''}${pagesText(ref.pages) ? `, ${pagesText(ref.pages)}` : ''}.`));
      if (doi) R.push(run(` ${doi}`));
      break;
    }
    case 'web': {
      const site = clean(ref.container);
      R.push(run(`${authors}${quoted}`));
      if (site) R.push(run(`${stripEnd(site)}`, true));
      const acc = clean(ref.accessed) ? `Accessed: ${clean(ref.accessed)}.` : '';
      R.push(run(`${site && date ? ', ' : ''}${date}${site || date ? '. ' : ''}${[acc, online].filter(Boolean).join(' ')}`.trimEnd()));
      break;
    }
    case 'thesis': {
      const kind = clean(ref.note) || 'B.S. project report';
      R.push(run(`${authors}${quoted}${tail([kind, clean(ref.container), clean(ref.place), date])}.`));
      if (online) R.push(run(` ${online}`));
      break;
    }
    case 'report': {
      R.push(run(`${authors}${quoted}${tail([clean(ref.container), clean(ref.place), clean(ref.note), date])}.`));
      if (online) R.push(run(` ${online}`));
      break;
    }
    default: {
      R.push(run(`${authors}${quoted}`));
      if (clean(ref.container)) R.push(run(stripEnd(ref.container), true));
      const rest = tail([clean(ref.publisher), clean(ref.place), date, clean(ref.note)]);
      R.push(run(`${rest ? `${clean(ref.container) ? ', ' : ''}${rest}` : ''}.`));
      if (online) R.push(run(` ${online}`));
      if (clean(ref.accessed)) R.push(run(` Accessed: ${clean(ref.accessed)}.`));
    }
  }
  return R;
}

/**
 * Compact (the style of many department templates):
 *   Babineau W., Barry P., Furness Z., "Title", Proceedings of …, Orlando, FL, USA. September 1998.
 *   Booth D., Haas H. "Web Services Architecture". 2004. <http://…>. Accessed November 2010.
 */
function compact(ref) {
  const names = parseNames(ref.authors).map(compactName);
  const title = stripEnd(ref.title);
  const date = [longMonth(ref.month), clean(ref.year)].filter(Boolean).join(' ');
  const eds = parseNames(ref.editors).map((n) => [n.first, n.last].filter(Boolean).join(' '));
  const R = [];
  if (names.length) R.push(run(`${names.join(', ')}${ref.type === 'book' ? '. ' : ', '}`));
  if (ref.type === 'book') {
    if (title) R.push(run(title, true));
    R.push(run(`.${clean(ref.edition) ? ` ${ordinal(ref.edition)} edition.` : ''}`));
  } else if (title) R.push(run(`“${title}”`));
  const parts = [];
  if (ref.type === 'chapter' && clean(ref.container)) parts.push(`in book “${stripEnd(ref.container)}”${eds.length ? `. ${eds.join(', ')} ${eds.length > 1 ? 'Editors' : 'Editor'}` : ''}`);
  else if (clean(ref.container)) parts.push(stripEnd(ref.container));
  for (const v of [clean(ref.volume) && `vol. ${clean(ref.volume)}`, clean(ref.issue) && `no. ${clean(ref.issue)}`, pagesText(ref.pages), clean(ref.note), clean(ref.publisher), clean(ref.place)]) if (v) parts.push(v);
  const body = parts.join(', ');
  R.push(run(`${body ? `${ref.type === 'book' ? ' ' : ', '}${body}` : ''}${date ? `. ${date}` : ''}.`));
  if (clean(ref.doi)) R.push(run(` doi: ${clean(ref.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}.`));
  if (clean(ref.url)) R.push(run(` <${clean(ref.url)}>.`));
  if (clean(ref.accessed)) R.push(run(` Accessed ${clean(ref.accessed)}.`));
  return R;
}

/** Formatted entry (without the [n] number) as runs: [{ text, italic }]. `custom` text wins when set. */
export function formatReferenceRuns(ref, style = 'ieee') {
  if (clean(ref?.custom)) return [run(clean(ref.custom))];
  if (!clean(ref?.title) && !clean(ref?.authors)) return [run('(empty reference)')];
  const runs = joinRuns(style === 'compact' ? compact(ref) : ieee(ref));
  // Tidy punctuation that empty fields leave behind.
  for (const r of runs) r.text = r.text.replace(/\s+([,.])/g, '$1').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').replace(/,\./g, '.').replace(/ {2,}/g, ' ');
  return runs.filter((r) => r.text);
}

/** Formatted entry as plain text. */
export const formatReference = (ref, style = 'ieee') => formatReferenceRuns(ref, style).map((r) => r.text).join('').trim();

/** Alphabetical sort key: first author's surname, then year, then title. */
export function referenceSortKey(ref) {
  const first = parseNames(ref.authors)[0];
  return `${(first?.last || clean(ref.custom) || clean(ref.title)).toLowerCase()}\u0000${clean(ref.year)}\u0000${clean(ref.title).toLowerCase()}`;
}

/** Short label for pickers: "Alharthi 2024 — Title". */
export function referenceShortLabel(ref) {
  const first = parseNames(ref.authors)[0];
  const who = first ? first.last + (parseNames(ref.authors).length > 1 ? ' et al.' : '') : '';
  const head = [who, clean(ref.year)].filter(Boolean).join(' ');
  const title = clean(ref.title) || clean(ref.custom).slice(0, 80) || '(untitled)';
  return head ? `${head} — ${title}` : title;
}

const normTitle = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Another reference with the same title (and year, when both have one), or the same DOI. */
export function findDuplicateReference(list, ref) {
  const doi = clean(ref.doi).toLowerCase();
  const title = normTitle(ref.title);
  return list.find((r) => r.id !== ref.id && (
    (doi && clean(r.doi).toLowerCase() === doi)
    || (title && normTitle(r.title) === title && (!clean(r.year) || !clean(ref.year) || clean(r.year) === clean(ref.year)))
  )) || null;
}

// ---------------------------------------------------------------------------
// BibTeX import (Google Scholar, IEEE Xplore, ACM, Zotero exports).

const LATEX = { '\\&': '&', '\\%': '%', '\\$': '$', '\\_': '_', '\\#': '#', '~': ' ', '--': '–' };
function delatex(s) {
  let v = String(s ?? '');
  v = v.replace(/\\[`'^"~=.uvHc]\{?([A-Za-z])\}?/g, '$1'); // accents → base letter
  for (const [k, r] of Object.entries(LATEX)) v = v.split(k).join(r);
  return clean(v.replace(/[{}]/g, ''));
}

/** Read one `{…}` / `"…"` / bare value starting at i → [value, nextIndex]. */
function readValue(src, i) {
  while (/\s/.test(src[i] || '')) i += 1;
  if (src[i] === '{') {
    let depth = 0; const start = i + 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) return [src.slice(start, i), i + 1]; }
    }
    return [src.slice(start), src.length];
  }
  if (src[i] === '"') {
    let depth = 0; const start = i + 1;
    for (i += 1; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1; else if (src[i] === '}') depth -= 1;
      else if (src[i] === '"' && depth === 0) return [src.slice(start, i), i + 1];
    }
    return [src.slice(start), src.length];
  }
  const m = /^[^,}\s]+/.exec(src.slice(i));
  return [m ? m[0] : '', i + (m ? m[0].length : 0)];
}

const BIB_TYPES = {
  article: 'journal', inproceedings: 'conference', conference: 'conference', proceedings: 'conference', book: 'book', inbook: 'chapter',
  incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', techreport: 'report', manual: 'report',
  standard: 'report', online: 'web', electronic: 'web', www: 'web', webpage: 'web', misc: 'other', unpublished: 'other',
};

/** Parse BibTeX text → [partial reference fields] (pass each to createReference). Unknown entries become 'other'. */
export function parseBibTeX(text) {
  const src = String(text ?? '');
  const out = [];
  const re = /@(\w+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1].toLowerCase();
    if (kind === 'comment' || kind === 'preamble' || kind === 'string') continue;
    let i = m.index + m[0].length;
    const keyEnd = src.indexOf(',', i);
    if (keyEnd < 0) break;
    i = keyEnd + 1;
    const fields = {};
    while (i < src.length) {
      while (/[\s,]/.test(src[i] || '')) i += 1;
      if (src[i] === '}' || i >= src.length) { i += 1; break; }
      const nm = /^([A-Za-z][\w-]*)\s*=/.exec(src.slice(i));
      if (!nm) { const close = src.indexOf('}', i); i = close < 0 ? src.length : close + 1; break; }
      i += nm[0].length;
      const [value, next] = readValue(src, i);
      fields[nm[1].toLowerCase()] = value;
      i = next;
    }
    re.lastIndex = i;
    const f = (k) => delatex(fields[k]);
    const type = BIB_TYPES[kind] || 'other';
    const names = (k) => String(fields[k] ?? '').split(/\s+and\s+/i).map((n) => (/^\{.*\}$/.test(n.trim()) ? n.trim() : delatex(n))).filter(Boolean).join('\n');
    const container = type === 'book' ? ''
      : type === 'journal' ? f('journal') || f('journaltitle')
      : type === 'conference' || type === 'chapter' ? f('booktitle') || f('journal')
        : type === 'thesis' ? f('school') || f('institution')
          : type === 'report' ? f('institution') || f('organization') || f('publisher')
            : f('howpublished').replace(/^\\url/, '') || f('journal') || f('organization') || f('publisher');
    out.push({
      type,
      authors: names('author'),
      editors: names('editor'),
      title: f('title'),
      container,
      publisher: type === 'report' ? '' : f('publisher'),
      place: f('address') || f('location'),
      year: f('year') || (f('date').match(/\d{4}/)?.[0] ?? ''),
      month: f('month'),
      volume: f('volume'),
      issue: f('number') || f('issue'),
      pages: f('pages'),
      edition: f('edition'),
      doi: f('doi'),
      url: f('url'),
      accessed: f('urldate'),
      note: kind === 'phdthesis' ? 'Ph.D. dissertation' : kind === 'mastersthesis' ? 'M.S. thesis' : (type === 'report' ? f('number') && `Rep. ${f('number')}` : '') || f('note'),
    });
  }
  return out;
}
