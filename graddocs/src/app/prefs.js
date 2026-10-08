// Per-browser UI preferences (theme, view modes). Not part of any project.
const KEY = 'graddocs:prefs';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export const prefs = {
  get(key, fallback = null) { const v = read()[key]; return v === undefined ? fallback : v; },
  set(key, value) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: value })); } catch { /* storage unavailable */ }
  },
};

export function applyTheme() {
  const theme = prefs.get('theme', 'system');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
