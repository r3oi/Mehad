// Small, dependency-free helpers shared across modules.

export function uid(prefix = 'id') {
  const rand = (crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)
    .replace(/-/g, '').slice(0, 12);
  return `${prefix}_${rand}`;
}

export const clone = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export function debounce(fn, wait = 300) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  debounced.flush = (...args) => { if (timer) { clearTimeout(timer); timer = null; fn(...args); } };
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  debounced.pending = () => timer !== null;
  return debounced;
}

export function throttleRaf(fn) {
  let frame = 0; let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; fn(...lastArgs); });
  };
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const pad = (n, width = 3) => String(n).padStart(width, '0');

export function slugify(text, max = 60) {
  return String(text || 'untitled')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'untitled';
}

export function toRoman(num) {
  const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let n = Math.max(1, Math.floor(num)); let out = '';
  for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } }
  return out;
}

const DAY = 86400000;
export function formatDate(ts, opts = {}) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...opts });
}
export function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${formatDate(ts, { month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export function relativeTime(ts) {
  if (!ts) return 'never';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 45 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.round(diff / 60000)} min ago`;
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  if (ts >= startToday.getTime()) return `Today, ${new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  if (ts >= startToday.getTime() - DAY) return 'Yesterday';
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} days ago`;
  return formatDate(ts, { month: 'short' });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsText(file);
  });
}

export function pickFile(accept = '*/*') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

/** Case-insensitive compare used for sorting labels alphabetically. */
export const compareText = (a, b) => String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });

/** Escape a string for use inside a RegExp. */
export const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
export const modLabel = isMac ? '⌘' : 'Ctrl';
