// The REFERENCES list of a Word report and the "[3]" citations that point into it.
//   parseReferenceEntry('[1] Babineau W., …')            → { label: 1, text: 'Babineau W., …' }
//   convertCitations(text, lookup, render)                → "[1]–[3]" → one token per number, joined by ", "
//   matchReferences(entries, existing, stored)            → which project reference each Word entry is (or none)
// Pure functions, no DOM. plan.js turns the result into reviewable changes and applies them.
import { normKey, hashOf, similarity, tidy, asciiDigits } from './text-utils.js';

// ---------------------------------------------------------------------------
// Entries

// "[1]", "(1)", "1." or "1)" in front of an entry. A bare "1." needs a space after it, so "1.5 million …" and "2010. …" stay text.
const LABEL = /^\s*(?:\[\s*([\d٠-٩]{1,3})\s*\]|\(\s*([\d٠-٩]{1,3})\s*\)|([\d٠-٩]{1,3})\s*[.)](?=\s))\s*/;

/** One paragraph of the list → { label: explicit number or null, text: the entry without its number }. */
export function parseReferenceEntry(raw) {
  const full = tidy(raw);
  const m = LABEL.exec(full);
  return {
    label: m ? Number(asciiDigits(m[1] ?? m[2] ?? m[3])) : null,
    text: tidy(m ? full.slice(m[0].length) : full),
  };
}

/**
 * How "[n]" finds its entry: by the number typed in front of each entry when every entry has its own (so a list that skips
 * "[3]" still works), otherwise by position (the nth entry in Word order).
 * → { indexOf(n) → index into `entries` or -1, numberOf(index) → the n a citation of that entry uses }
 */
export function citationIndex(entries) {
  const labels = entries.map((e) => e.label);
  if (entries.length && labels.every((l) => l !== null) && new Set(labels).size === labels.length) {
    const byLabel = new Map(labels.map((l, i) => [l, i]));
    return { indexOf: (n) => (byLabel.has(n) ? byLabel.get(n) : -1), numberOf: (i) => labels[i] };
  }
  return { indexOf: (n) => (Number.isInteger(n) && n >= 1 && n <= entries.length ? n - 1 : -1), numberOf: (i) => i + 1 };
}

// ---------------------------------------------------------------------------
// Citations in running text

const NUM = '[\\d٠-٩]{1,3}';
const DASH = '[-‐-―]';
const ITEM = `${NUM}(?:\\s*${DASH}\\s*${NUM})?`;
// "[3]", "[1, 2]", "[1-3]", "[1], [2]" (one group each) and "[1]–[3]" (a range written as two brackets); not "arr[1](…)", "x2[1]" or "[2010]".
const CITE_GROUP = new RegExp(`(?<![\\d_])\\[\\s*(${ITEM}(?:\\s*[,;،]\\s*${ITEM})*)\\s*\\](?:\\s*${DASH}\\s*\\[\\s*(${NUM})\\s*\\])?(?!\\()`, 'gu');
const MAX_RANGE = 60;

/** "1, 3-5" (+ optional end of a "[1]–[3]" range) → [1, 3, 4, 5], or null when it is not a sensible citation. */
function citedNumbers(body, rangeEnd) {
  const out = [];
  const parts = asciiDigits(body).split(/\s*[,;،]\s*/);
  if (rangeEnd && parts.length !== 1) return null;
  for (const part of parts) {
    const m = /^(\d+)(?:\s*[-‐-―]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = rangeEnd ? Number(asciiDigits(rangeEnd)) : m[2] !== undefined ? Number(m[2]) : a;
    if (m[2] !== undefined && rangeEnd) return null; // "[1-2]–[4]"
    if (b < a || b - a > MAX_RANGE) return null;
    if (b === a && (rangeEnd || m[2] !== undefined)) return null; // "[2-2]"
    for (let n = a; n <= b; n += 1) out.push(n);
  }
  return out.length && out.length <= MAX_RANGE ? out : null;
}

/**
 * Replace every citation group whose numbers all exist by `render(n, id)` of each number, joined by ", ".
 * `lookup(n)` → id of the entry (or null → the whole group stays as typed). Text without a reference list is never touched.
 */
export function convertCitations(text, lookup, render) {
  const s = String(text ?? '');
  if (!s.includes('[')) return s;
  return s.replace(CITE_GROUP, (match, body, rangeEnd) => {
    const numbers = citedNumbers(body, rangeEnd);
    if (!numbers) return match;
    const parts = [];
    for (const n of numbers) {
      const id = lookup(n);
      if (!id) return match;
      parts.push(render(n, id));
    }
    return parts.join(', ');
  });
}

// ---------------------------------------------------------------------------
// Matching Word entries with the references already imported from Word

/**
 * matchReferences(entries, existing, stored) → { rows, removed }
 *   entries   [{ label, text }] in Word order
 *   existing  the project's references that came from Word (source 'word'), in project order. User-made ones are never passed in.
 *   stored    { referenceId: hash of the Word text at the last sync }
 *   rows      [{ entry, index, proj: reference | null, changed }]   (proj null = new)
 *   removed   existing references that are no longer in the Word list
 *
 * 1. the same text (ignoring case and punctuation); 2. a reference edited on the site whose Word text has not changed;
 * 3. an entry edited in Word: pair what is left between the matched neighbours (same count → in order, because Word's
 *    "[n]" is positional; otherwise only entries that read alike).
 * `changed` = the Word text differs from the project's AND it is not just the project that was edited since the last sync.
 */
export function matchReferences(entries, existing, stored = {}) {
  const textOf = (r) => tidy(r.custom);
  const rows = entries.map((entry, index) => ({ entry, index, proj: null, changed: false, hash: hashOf(entry.text) }));
  const claimed = new Set();
  const claim = (row, proj) => { row.proj = proj; claimed.add(proj.id); };

  const byKey = new Map();
  for (const p of existing) {
    const k = normKey(textOf(p));
    if (k) byKey.set(k, [...(byKey.get(k) || []), p]);
  }
  for (const row of rows) {
    const cand = (byKey.get(normKey(row.entry.text)) || []).find((p) => !claimed.has(p.id));
    if (cand) claim(row, cand);
  }
  for (const row of rows) {
    if (row.proj) continue;
    const cand = existing.find((p) => !claimed.has(p.id) && stored[p.id] === row.hash);
    if (cand) claim(row, cand);
  }

  const position = new Map(existing.map((p, i) => [p.id, i]));
  for (let i = 0; i < rows.length;) {
    if (rows[i].proj) { i += 1; continue; }
    let j = i;
    while (j < rows.length && !rows[j].proj) j += 1;
    const gap = rows.slice(i, j);
    const lo = i > 0 ? position.get(rows[i - 1].proj.id) : -1;
    const hi = j < rows.length ? position.get(rows[j].proj.id) : existing.length;
    const pool = lo < hi ? existing.filter((p) => !claimed.has(p.id) && position.get(p.id) > lo && position.get(p.id) < hi) : [];
    if (pool.length === gap.length) gap.forEach((row, k) => claim(row, pool[k]));
    else {
      const pairs = [];
      for (const row of gap) for (const p of pool) pairs.push({ row, p, score: similarity(row.entry.text, textOf(p)) });
      pairs.sort((a, b) => b.score - a.score);
      for (const { row, p, score } of pairs) if (score >= 0.5 && !row.proj && !claimed.has(p.id)) claim(row, p);
    }
    i = j;
  }

  for (const row of rows) {
    if (!row.proj) continue;
    row.changed = textOf(row.proj) !== row.entry.text && (stored[row.proj.id] === undefined || stored[row.proj.id] !== row.hash);
  }
  return { rows, removed: existing.filter((p) => !claimed.has(p.id)) };
}
