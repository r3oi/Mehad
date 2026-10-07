// Text helpers shared by the Word parser and the sync planner: title cleaning, normalisation for
// matching, hashing and a few Arabic/English patterns. Pure functions, no DOM.

import { isRTL } from '../i18n/index.js';

const DIGITS_AR = '٠١٢٣٤٥٦٧٨٩';
/** Arabic-Indic digits → ASCII digits. */
export const asciiDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => String(DIGITS_AR.indexOf(d)));

const cc = (...codes) => String.fromCharCode(...codes);
const INVISIBLE = new RegExp(`[${cc(0x200b, 0xad, 0x200e, 0x200f, 0xfeff)}]`, 'g');
const SPACES = new RegExp(`[${cc(0xa0, 0x2007, 0x202f)}]`, 'g');
const MARKS = new RegExp(`[${cc(0x300)}-${cc(0x36f)}${cc(0x64b)}-${cc(0x65f)}${cc(0x670)}${cc(0x6d6)}-${cc(0x6ed)}]`, 'g');

/** Wrap report text (file and project names, titles) so it keeps its own direction inside translated UI text. */
export const isolate = (text) => (isRTL ? `${cc(0x2068)}${text}${cc(0x2069)}` : String(text));

/** Collapse whitespace (incl. NBSP / zero-width) into single spaces. */
export function tidy(s) {
  return String(s ?? '').replace(INVISIBLE, '').replace(SPACES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalised identity of a title/caption: case-insensitive, no accents, no punctuation, Arabic
 * letter variants unified. Two titles that read the same to a human have the same key.
 */
export function normKey(s) {
  return asciiDigits(String(s ?? ''))
    .normalize('NFKD')
    .replace(MARKS, '') // Latin accents and Arabic diacritics
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا') // alef variants
    .replace(/ى/g, 'ي') // alef maqsura
    .replace(/ة/g, 'ه') // ta marbuta
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** 64-bit FNV-1a style hash (two 32-bit lanes) → 16 hex chars. Works on strings and Uint8Array. */
export function hashOf(input) {
  let h1 = 0x811c9dc5; let h2 = 0x01000193 ^ 0xdeadbeef;
  const feed = (c) => {
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  };
  if (typeof input === 'string') {
    for (let i = 0; i < input.length; i += 1) feed(input.charCodeAt(i));
  } else {
    for (let i = 0; i < input.length; i += 1) feed(input[i]);
    feed(input.length & 0xff); feed((input.length >>> 8) & 0xff);
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Title cleaning

const EN_NUM = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen';
const AR_ORD = 'الأول|الاول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر|الثاني عشر';
const CHAPTER_PREFIX = new RegExp(`^\\s*(?:chapter|ch\\.?)\\s*(?:\\d+|[ivxlc]+\\b|(?:${EN_NUM})\\b)\\s*[:.\\-–—)]*\\s*`, 'i');
const CHAPTER_PREFIX_AR = new RegExp(`^\\s*(?:الفصل|فصل)\\s*(?:[\\d٠-٩]+|(?:${AR_ORD}))\\s*[:\\-–—.،)]*\\s*`);
const NUMBER_PREFIX = /^\s*(?:\d{1,2}|[٠-٩]{1,2})(?:\s*\.\s*(?:\d{1,2}|[٠-٩]{1,2}))*\s*[.)]?\s+(?=\S)/;
const NUMBER_PREFIX_TIGHT = /^\s*(?:\d{1,2}|[٠-٩]{1,2})(?:\.(?:\d{1,2}|[٠-٩]{1,2}))*[.)](?=\p{L})/u;

export const isChapterLabelOnly = (s) => {
  const t = tidy(s);
  return (CHAPTER_PREFIX.test(t) && !t.replace(CHAPTER_PREFIX, '').trim()) || (CHAPTER_PREFIX_AR.test(t) && !t.replace(CHAPTER_PREFIX_AR, '').trim());
};
export const hasChapterLabel = (s) => CHAPTER_PREFIX.test(tidy(s)) || CHAPTER_PREFIX_AR.test(tidy(s));
/** "1. Introduction" / "2 Design" / "3.1 Scope": the heading carries its own outline number. */
export const hasOutlineNumber = (s) => NUMBER_PREFIX.test(tidy(s)) || NUMBER_PREFIX_TIGHT.test(tidy(s));

/** "Chapter 3:" / "CHAPTER 3 -" / "الفصل الثالث:" prefix removed (title unchanged when there is none). */
export function stripChapterPrefix(s) {
  const t = tidy(s);
  const stripped = t.replace(CHAPTER_PREFIX, '').replace(CHAPTER_PREFIX_AR, '').trim();
  return stripped || t;
}

/** Leading outline numbers ("1.4.2 ", "3) ", "2.Design") removed. */
export function stripNumbering(s) {
  const t = tidy(s);
  const out = t.replace(NUMBER_PREFIX, '').replace(NUMBER_PREFIX_TIGHT, '').trim();
  return out || t;
}

// Short all-caps words that are ordinary English (so ALL-CAPS titles read "Top Ten", not "TOP Ten"); other short ones stay (AI, API, SQL).
const COMMON_SHORT = new Set(['one', 'two', 'six', 'ten', 'the', 'and', 'for', 'not', 'but', 'all', 'new', 'top', 'use', 'our', 'out', 'off', 'any', 'can', 'may', 'way', 'day', 'big', 'low', 'how', 'why', 'who', 'set', 'end', 'add', 'get', 'run', 'map', 'log', 'web', 'its', 'you', 'are', 'was', 'has', 'had', 'see', 'yes', 'non', 'pre', 'no', 'go', 'up', 'do', 'so', 'we', 'my', 'me', 'be', 'is', 'if', 'he']);
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'with', 'from', 'as', 'vs', 'via', 'per']);
const LABEL_WORDS = new Set(['appendix', 'annex', 'part', 'section', 'table', 'figure', 'phase', 'stage', 'step', 'group', 'type', 'level', 'class']);
const KNOWN_UPPER = new Set(['HTTP', 'HTTPS', 'HTML', 'JSON', 'REST', 'RESTFUL', 'MVC', 'NOSQL', 'MYSQL', 'OAUTH', 'CRUD', 'AJAX', 'GRPC', 'IEEE', 'WIFI', 'LORA', 'LORAWAN', 'MQTT', 'BLE', 'IOT', 'UML', 'SRS', 'GUI', 'NASA']);

const hasCased = (s) => s !== s.toLowerCase() || s !== s.toUpperCase();
/** True when a title is written in capitals only (Latin). */
export function isAllCaps(s) {
  const letters = String(s).match(/\p{L}/gu) || [];
  return letters.length >= 2 && hasCased(s) && s === s.toUpperCase() && s !== s.toLowerCase();
}

/** ALL-CAPS → Title Case. Short capitalised words (AI, API) and known acronyms stay as they are. */
export function toTitleCase(s, keep = new Set()) {
  const parts = String(s).split(/(\s+|[-–—/]+)/);
  let first = true;
  let prev = '';
  return parts.map((tok) => {
    if (!tok || /^(\s+|[-–—/]+)$/.test(tok)) return tok;
    const m = tok.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su);
    const [, pre, core, post] = m;
    if (!/\p{L}/u.test(core)) { first = false; return tok; }
    const upper = core.toUpperCase();
    const lower = core.toLowerCase();
    const isFirst = first; first = false;
    const before = prev; prev = lower;
    if (keep.has(upper) || KNOWN_UPPER.has(upper)) return pre + upper + post;
    if (core.length === 1 && LABEL_WORDS.has(before)) return pre + upper + post; // "Appendix A" is a label, not the article "a"
    if (!isFirst && SMALL_WORDS.has(lower)) return pre + lower + post;
    if (core.length <= 3 && /^[A-Z0-9&]+$/.test(core) && !COMMON_SHORT.has(lower)) return tok; // AI, API, 5G
    return pre + lower.charAt(0).toUpperCase() + lower.slice(1) + post;
  }).join('');
}

/**
 * Full cleanup of a heading: no "Chapter 3:" label, no leading numbers, no trailing colon, Title Case
 * when it was typed in capitals. `keep` is a Set of upper-case words that must stay upper-case.
 */
export function cleanTitle(raw, { chapter = false, keep } = {}) {
  let t = tidy(raw);
  if (chapter) t = stripChapterPrefix(t);
  t = stripNumbering(t);
  if (chapter) t = stripChapterPrefix(t);
  t = t.replace(/[\s:：.\-–—]+$/u, '').trim();
  if (isAllCaps(t)) t = toTitleCase(t, keep || new Set());
  return t || tidy(raw);
}

/**
 * Do two titles of closing chapters name the same page? "Conclusion" ~ "Conclusions" ~ "Conclusions and Recommendations"
 * (all the words of the shorter title are in the longer one). Appendices are told apart by their letter.
 */
export function closingTitlesAlike(a, b) {
  if (similarity(a, b) >= 0.7) return true;
  if (APPENDIX.test(tidy(a)) || APPENDIX.test(tidy(b))) return false;
  const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  const wa = new Set(normKey(a).split(' ').filter(Boolean).map(stem));
  const wb = new Set(normKey(b).split(' ').filter(Boolean).map(stem));
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  return small.size > 0 && [...small].every((w) => big.has(w));
}

/** Word-overlap similarity of two strings, 0..1. */
export function similarity(a, b) {
  const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);
  const wa = new Set(normKey(a).split(' ').filter(Boolean).map(stem));
  const wb = new Set(normKey(b).split(' ').filter(Boolean).map(stem));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / Math.max(wa.size, wb.size);
}

// ---------------------------------------------------------------------------
// Captions

export const CAPTION_RE = /^\s*(?:ال)?(Figure|Fig\.?|Table|شكل|جدول)\s*\(?([\d٠-٩]+(?:[.\-][\d٠-٩]+)*)\)?\s*[:.\-–—]\s*(\S.*)$/isu;
export const CAPTION_LOOSE_RE = /^\s*(?:ال)?(Figure|Fig\.?|Table|شكل|جدول)\s*\(?([\d٠-٩]+(?:[.\-][\d٠-٩]+)*)\)?\s*(.*)$/isu;

/** → { kind: 'figure'|'table', number: '3', title } or null. `loose` also accepts "Figure 3 Title". */
export function parseCaption(text, { loose = false } = {}) {
  const s = tidy(text);
  const m = CAPTION_RE.exec(s) || (loose ? CAPTION_LOOSE_RE.exec(s) : null);
  if (!m) return null;
  const word = m[1].toLowerCase();
  const kind = word.startsWith('tab') || m[1] === 'جدول' ? 'table' : 'figure';
  const title = tidy(m[3]).replace(/[.\s]+$/, '');
  if (!title && !loose) return null;
  return { kind, number: asciiDigits(m[2]).replace(/-/g, '.'), title };
}

// ---------------------------------------------------------------------------
// Front matter titles

const AR = (...list) => list.map(normKey);
const FRONT_TITLES = {
  declaration: new Set([...['declaration', 'student declaration', 'students declaration', 'declaration of originality', 'statement of originality', 'originality statement', 'declaration of authorship', 'undertaking', 'plagiarism declaration', 'student declaration of originality'].map(normKey), ...AR('الإقرار', 'إقرار', 'إقرار الطالب', 'إقرار الطلاب', 'تعهد', 'الإقرار والتعهد', 'إقرار وتعهد', 'بيان الأصالة')]),
  acknowledgements: new Set([...['acknowledgements', 'acknowledgments', 'acknowledgement', 'acknowledgment', 'acknowledgements and thanks', 'thanks and acknowledgements', 'thanks and appreciation'].map(normKey), ...AR('الشكر والتقدير', 'شكر وتقدير', 'الشكر', 'شكر', 'شكر وعرفان', 'الشكر والعرفان', 'كلمة شكر', 'شكر وامتنان')]),
  abstract: new Set([...['abstract', 'executive summary', 'summary'].map(normKey), ...AR('الملخص', 'ملخص', 'مستخلص', 'الملخص العربي', 'ملخص المشروع', 'ملخص البحث', 'الخلاصة', 'الملخص التنفيذي')]),
  toc: new Set([...['table of contents', 'table of content', 'content', 'contents', 'contents page', 'list of contents', 'toc'].map(normKey), ...AR('فهرس المحتويات', 'المحتويات', 'جدول المحتويات', 'محتويات', 'الفهرس')]),
  lot: new Set([...['list of tables', 'index of tables'].map(normKey), ...AR('قائمة الجداول', 'فهرس الجداول')]),
  lof: new Set([...['list of figures', 'list of images', 'list of illustrations', 'index of figures'].map(normKey), ...AR('قائمة الأشكال', 'فهرس الأشكال', 'قائمة الصور', 'فهرس الصور')]),
  loa: new Set([...['list of acronyms', 'list of abbreviations', 'list of acronyms and abbreviations', 'list of abbreviations and acronyms', 'list of symbols and abbreviations', 'list of symbols', 'abbreviations', 'acronyms', 'abbreviations and acronyms', 'acronyms and abbreviations', 'nomenclature', 'glossary', 'list of terms'].map(normKey), ...AR('قائمة الاختصارات', 'قائمة المختصرات', 'الاختصارات', 'المختصرات', 'قائمة الرموز والاختصارات', 'قائمة الرموز', 'الاختصارات والمختصرات', 'قائمة المصطلحات', 'المصطلحات')]),
  custom: new Set([...['dedication', 'certificate', 'certification', 'approval', 'approval page', 'supervisor approval', 'supervisors approval', 'supervisor certificate', 'committee approval', 'preface', 'foreword', 'copyright', 'copyright page', 'epigraph', 'list of publications', 'student certificate'].map(normKey), ...AR('الإهداء', 'إهداء', 'شهادة', 'صفحة الموافقة', 'شهادة المشرف', 'تقديم', 'موافقة المشرف', 'قرار لجنة المناقشة')]),
};

/** Kind of front-matter page a heading text names, or null. */
export function frontKindOf(text) {
  const raw = tidy(text).replace(/^(?:[ivxlc]+|\d+)\s*[.)\-–]\s+/i, '');
  if (!raw || raw.length > 70) return null;
  const key = normKey(raw);
  if (!key) return null;
  for (const [kind, titles] of Object.entries(FRONT_TITLES)) if (titles.has(key)) return kind;
  return null;
}

// ---------------------------------------------------------------------------
// Closing pages: references and unnumbered closing chapters

const REFERENCE_TITLES = new Set([...['references', 'reference', 'reference list', 'references list', 'list of references', 'bibliography', 'selected bibliography', 'works cited', 'literature cited', 'sources', 'list of sources', 'references and bibliography', 'bibliography and references'].map(normKey), ...AR('المراجع', 'مراجع', 'قائمة المراجع', 'المصادر', 'قائمة المصادر', 'المصادر والمراجع', 'المراجع والمصادر', 'المراجع العلمية', 'مصادر ومراجع')]);
const CLOSING_TITLES = new Set([...['conclusion', 'conclusions', 'conclusion and future work', 'conclusions and future work', 'conclusion and future works', 'conclusion and recommendations', 'conclusions and recommendations', 'conclusion and recommendation', 'conclusions and future directions', 'conclusion and future directions', 'summary', 'summary and conclusion', 'summary and conclusions', 'summary and recommendations', 'summary and future work', 'future work', 'future works', 'future work and recommendations', 'future directions', 'future enhancements', 'future improvements', 'future scope', 'limitations and future work', 'recommendations', 'recommendation', 'recommendations and future work', 'concluding remarks', 'final remarks', 'closing remarks', 'appendix', 'appendices'].map(normKey), ...AR('الخاتمة', 'خاتمة', 'الخلاصة', 'الخلاصة والتوصيات', 'الخاتمة والتوصيات', 'الاستنتاجات', 'الاستنتاج', 'التوصيات', 'العمل المستقبلي', 'الأعمال المستقبلية', 'الأعمال المستقبلية والتوصيات', 'الملاحق', 'ملحق')]);
const APPENDIX = /^(?:appendix|appendices|annex)\b|^(?:ملحق|الملاحق)(?=\s|$)/i;

/** The words of a heading without outline numbers, "Chapter N:" labels, trailing colons and case. */
function headingCore(text) {
  let t = tidy(text).replace(/^(?:[ivxlc]+|\d{1,2})\s*[.)\-–]\s+/i, '');
  t = stripNumbering(stripChapterPrefix(stripNumbering(t)));
  return normKey(t.replace(/[\s:：.\-–—]+$/u, ''));
}

/** REFERENCES / BIBLIOGRAPHY / WORKS CITED …: the list of sources, never a chapter. */
export function isReferencesTitle(text) {
  const raw = tidy(text);
  return !!raw && raw.length <= 70 && REFERENCE_TITLES.has(headingCore(raw));
}

/** CONCLUSIONS / SUMMARY / FUTURE WORK / RECOMMENDATIONS / APPENDIX …: headings that close a report without a chapter number. */
export function isClosingTitle(text) {
  const raw = tidy(text);
  if (!raw || raw.length > 90) return false;
  return CLOSING_TITLES.has(headingCore(raw)) || APPENDIX.test(stripChapterPrefix(raw));
}

/** Does a heading read like the start of a real chapter (so it can never be cover-page text)? */
export function looksLikeChapter(text) {
  const t = tidy(text);
  return hasChapterLabel(t) || /^(?:\d{1,2}|[٠-٩])[.)\s]/u.test(t) || /^(introduction|مقدمة|المقدمة|background|literature review)\b/i.test(t);
}

// ---------------------------------------------------------------------------
// Acronym lines

const ACRONYM_SEPARATOR = /\t+|\s*[:=]\s*|\s+[-–—]+\s+|\s*[–—]+\s*/;
/** "AI – Artificial Intelligence" / "AI\tArtificial Intelligence" → { acronym, meaning } or null. */
export function parseAcronymLine(line) {
  const text = String(line || '').replace(/^[\s•·▪●◦\-*]+/, '').trim();
  if (!text) return null;
  const m = ACRONYM_SEPARATOR.exec(text);
  if (!m) return null;
  const acronym = tidy(text.slice(0, m.index));
  const meaning = tidy(text.slice(m.index + m[0].length));
  if (!acronym || !meaning || acronym.length > 24 || acronym.split(/\s+/).length > 3 || meaning.length > 240) return null;
  return { acronym, meaning };
}
