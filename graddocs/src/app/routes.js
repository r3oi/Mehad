// Route table. Each view module default-exports:
//   { title, layout?: 'page' | 'flush', mount(container, ctx) → { unmount?() } | void }
// ctx = { store, project, params, navigate, href }
// Views are loaded lazily so a failure in one module never breaks the app.

export const NAV = [
  { group: 'Workspace', items: [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'structure', label: 'Project Structure', icon: 'structure' },
    { id: 'word', label: 'Word Sync', icon: 'word' },
  ] },
  { group: 'Content', items: [
    { id: 'figures', label: 'Figures', icon: 'figure', count: (p) => p.figures.length },
    { id: 'tables', label: 'Tables', icon: 'table', count: (p) => p.tables.length },
    { id: 'chapters', label: 'Chapters', icon: 'chapters', count: (p) => p.chapters.length },
    { id: 'acronyms', label: 'Acronyms', icon: 'acronym', count: (p) => p.acronyms.length },
    { id: 'references', label: 'References', icon: 'book', count: (p) => (p.references || []).length },
  ] },
  { group: 'Output', items: [
    { id: 'preview', label: 'Document Preview', icon: 'preview' },
    { id: 'export', label: 'Export', icon: 'export' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ] },
];

export const VIEWS = {
  projects: () => import('../projects/projects-view.js'),
  dashboard: () => import('../dashboard/dashboard-view.js'),
  structure: () => import('../structure/structure-view.js'),
  chapters: () => import('../structure/chapters-view.js'),
  figures: () => import('../figures/figures-view.js'),
  'figure-editor': () => import('../figures/editor/editor-view.js'),
  tables: () => import('../tables/tables-view.js'),
  'table-editor': () => import('../tables/table-editor-view.js'),
  acronyms: () => import('../acronyms/acronyms-view.js'),
  references: () => import('../bibliography/references-view.js'),
  preview: () => import('../preview/preview-view.js'),
  export: () => import('../export/export-view.js'),
  settings: () => import('../settings/settings-view.js'),
  word: () => import('../word/word-view.js'),
};

/**
 * Parse location.hash → { view, projectId, params }.
 *   #/projects
 *   #/p/<projectId>/<section>[/<itemId>]   e.g. #/p/prj_x/figures/fig_y, #/p/prj_x/references/ref_z
 *   Query string after "?" is exposed as params.query (e.g. ?focus=<id>).
 */
export function parseHash(hash = location.hash) {
  const [pathPart, queryPart = ''] = hash.replace(/^#/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  if (parts[0] === 'p' && parts[1]) {
    const section = parts[2] || 'dashboard';
    const itemId = parts[3] || null;
    let view = section;
    if (section === 'figures' && itemId) view = 'figure-editor';
    if (section === 'tables' && itemId) view = 'table-editor';
    if (!VIEWS[view]) view = 'dashboard';
    return { view, section, projectId: parts[1], params: { id: itemId, query } };
  }
  return { view: 'projects', section: 'projects', projectId: null, params: { query } };
}

export function href(projectId, section = 'dashboard', itemId = null, query = null) {
  let out = `#/p/${encodeURIComponent(projectId)}/${section}`;
  if (itemId) out += `/${encodeURIComponent(itemId)}`;
  if (query) out += `?${new URLSearchParams(query)}`;
  return out;
}
