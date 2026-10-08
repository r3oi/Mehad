// Interface language (English / Arabic). English strings are the keys:
//   t('Figures')                         → 'الأشكال' in Arabic
//   t('Last modified: {time}', { time }) → placeholders work in both languages
// Missing Arabic entries fall back to English. The language is read once at
// startup (prefs), so module-level labels can call t() too; switching
// language saves the choice and reloads the page.
//
// Report content (figure/table captions, chapter headings, exports) is the
// user's document and is NOT translated here.
import { AR } from './ar/index.js';

const PREFS_KEY = 'graddocs:prefs';

function readLang() {
  try {
    if (typeof localStorage === 'undefined') return 'en';
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}').lang === 'ar' ? 'ar' : 'en';
  } catch { return 'en'; }
}

export const lang = readLang();
export const isRTL = lang === 'ar';
/** Locale for dates/numbers: Gregorian calendar and Western digits in Arabic too. */
export const locale = isRTL ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';

const missing = new Set();

export function t(text, params) {
  let out = text;
  if (isRTL) {
    const hit = AR[text];
    if (hit === undefined) missing.add(text); else out = hit;
  }
  if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
  return out;
}

/** Untranslated strings seen so far (Arabic mode) — handy while translating. */
export const missingTranslations = () => [...missing].sort();

export function applyDocumentLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
}

export function setLanguage(next) {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    prefs.lang = next === 'ar' ? 'ar' : 'en';
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable: nothing to persist */ }
  location.reload();
}

export const LANGUAGES = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'ar', label: 'العربية', short: 'ع' },
];
