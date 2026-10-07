// Command palette (Ctrl/⌘+K): commands + live project search.
import { esc, highlight } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { searchProject, KIND_ICONS } from './search.js';
import { href } from './routes.js';
import { modLabel } from '../core/utils.js';
import { t, lang, setLanguage } from '../i18n/index.js';

let open = null;

function commands(shell) {
  const p = shell.store.project;
  const go = (section, itemId, query) => () => shell.navigate(href(p.id, section, itemId, query));
  const list = [];
  if (p) {
    list.push(
      { title: 'Create Figure', sub: 'Start from a diagram template', icon: 'plus', keywords: 'new figure diagram add', run: go('figures', null, { new: '1' }) },
      { title: 'Create Table', sub: 'Start from a table template', icon: 'plus', keywords: 'new table add', run: go('tables', null, { new: '1' }) },
      { title: 'Create Acronym', sub: 'Add to List of Acronyms', icon: 'plus', keywords: 'new acronym abbreviation add', run: go('acronyms', null, { new: '1' }) },
      { title: 'Create Chapter', sub: 'Add a chapter to the document', icon: 'plus', keywords: 'new chapter add section', run: go('structure', null, { new: 'chapter' }) },
      { title: 'New Reference', sub: 'Add a book, paper or website to the bibliography', icon: 'plus', keywords: 'create add reference citation bibliography source paper book', run: go('references', null, { new: '1' }) },
      { title: 'Import BibTeX', sub: 'Add references from Google Scholar or a .bib file', icon: 'upload', keywords: 'bib bibtex references google scholar zotero import citations', run: go('references', null, { import: '1' }) },
      { title: 'Go to Dashboard', icon: 'dashboard', keywords: 'home overview', run: go('dashboard') },
      { title: 'Go to Project Structure', icon: 'structure', keywords: 'outline toc sections', run: go('structure') },
      { title: 'Sync with Word', sub: 'Link your report’s .docx and pull changes when you save', icon: 'word', keywords: 'word docx link import sync ربط وورد مزامنة', run: go('word') },
      { title: 'Go to Figures', icon: 'figure', keywords: 'diagrams', run: go('figures') },
      { title: 'Go to Tables', icon: 'table', run: go('tables') },
      { title: 'Go to Chapters', icon: 'chapters', keywords: 'write content sections', run: go('chapters') },
      { title: 'Go to Acronyms', icon: 'acronym', keywords: 'abbreviations', run: go('acronyms') },
      { title: 'Go to References', icon: 'book', keywords: 'bibliography citations sources cite', run: go('references') },
      { title: 'Document Preview', icon: 'preview', keywords: 'print word pages toc', run: go('preview') },
      { title: 'Export', sub: 'Word package, PNG, SVG, PDF', icon: 'export', keywords: 'download docx zip pdf png svg', run: go('export') },
      { title: 'Export Project (JSON backup)', icon: 'archive', keywords: 'backup download json', run: go('export', null, { action: 'json' }) },
      { title: 'Settings', icon: 'settings', keywords: 'page font margins captions storage', run: go('settings') },
    );
  }
  list.push(
    { title: 'All Projects', icon: 'folderOpen', keywords: 'switch open project', run: () => shell.navigate('#/projects') },
    { title: 'New Project', icon: 'plus', keywords: 'create project', run: () => shell.navigate('#/projects?new=1') },
    { title: 'Toggle Dark / Light Mode', icon: 'moon', keywords: 'theme dark light', run: () => shell.toggleTheme() },
    { title: 'Keyboard Shortcuts', icon: 'keyboard', keywords: 'help keys', run: async () => (await import('./shortcuts.js')).showShortcutsHelp() },
    lang === 'ar'
      ? { title: 'Switch to English', icon: 'refresh', keywords: 'language english لغة انجليزي', run: async () => { await shell.store.flush(); setLanguage('en'); } }
      : { title: 'التبديل إلى العربية', icon: 'refresh', keywords: 'language arabic rtl عربي لغة', run: async () => { await shell.store.flush(); setLanguage('ar'); } },
  );
  // Translated titles; English titles stay searchable as keywords.
  return list.map((c) => ({ ...c, keywords: `${c.title} ${c.keywords || ''}`, title: t(c.title), sub: c.sub ? t(c.sub) : '' }));
}

export function openPalette(shell, initialQuery = '') {
  if (open) { open.input.focus(); return; }
  const root = document.createElement('div');
  root.className = 'palette-root';
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="palette" role="dialog" aria-label="${t('Command palette')}">
      <div class="palette-input">${icon('search')}<input type="text" placeholder="${t('Search figures, tables, acronyms, references, sections… or type a command')}" aria-label="${t('Search')}" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
      <div class="palette-results" role="listbox"></div>
      <div class="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> ${t('navigate')}</span><span><kbd>Enter</kbd> ${t('open')}</span><span><kbd>${modLabel}</kbd><kbd>K</kbd> ${t('toggle')}</span></div>
    </div>`;
  document.body.append(root);
  const input = root.querySelector('input');
  const resultsEl = root.querySelector('.palette-results');
  const allCommands = commands(shell);
  let items = []; let active = 0;

  const close = () => { root.remove(); document.removeEventListener('keydown', onKey, true); open = null; };

  const render = () => {
    const q = input.value.trim();
    const ql = q.toLowerCase();
    const cmds = (q ? allCommands.filter((c) => `${c.title} ${c.keywords || ''} ${c.sub || ''}`.toLowerCase().includes(ql)) : allCommands.slice(0, 8))
      .map((c) => ({ ...c, group: t('Commands') }));
    const hits = shell.store.project && q ? searchProject(shell.store.project, q, { limit: 12 }).map((r) => ({
      title: r.title, sub: [r.sub, r.snippet].filter(Boolean).join(' — '), icon: KIND_ICONS[r.kind] || 'search', group: t('Search results'),
      hint: t(r.kind), run: () => shell.navigate(r.href),
    })) : [];
    items = q ? [...hits, ...cmds] : cmds;
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!items.length) { resultsEl.innerHTML = `<div class="palette-empty">${esc(t('No results for “{q}”', { q }))}</div>`; return; }
    let lastGroup = null;
    resultsEl.innerHTML = items.map((it, i) => {
      const head = it.group !== lastGroup ? `<div class="palette-group">${esc(it.group)}</div>` : '';
      lastGroup = it.group;
      return `${head}<div class="palette-item ${i === active ? 'active' : ''}" role="option" data-i="${i}" aria-selected="${i === active}">
        <span class="pi-icon">${icon(it.icon)}</span>
        <span class="grow"><div class="pi-title truncate">${highlight(it.title, q)}</div>${it.sub ? `<div class="pi-sub truncate">${highlight(it.sub, q)}</div>` : ''}</span>
        ${it.hint ? `<span class="pi-hint">${esc(it.hint)}</span>` : ''}
      </div>`;
    }).join('');
    resultsEl.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
  };

  const run = (i) => { const it = items[i]; if (!it) return; close(); it.run(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); close(); }
  };
  input.addEventListener('input', () => { active = 0; render(); });
  resultsEl.addEventListener('click', (e) => { const el = e.target.closest('.palette-item'); if (el) run(Number(el.dataset.i)); });
  resultsEl.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.palette-item');
    if (el && Number(el.dataset.i) !== active) { active = Number(el.dataset.i); resultsEl.querySelectorAll('.palette-item').forEach((n) => n.classList.toggle('active', n === el)); }
  });
  root.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  input.value = initialQuery;
  render();
  input.focus();
  open = { root, input, close };
}

export const isPaletteOpen = () => !!open;
