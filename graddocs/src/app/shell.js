// App shell: sidebar navigation, topbar (breadcrumbs, search, save status,
// theme) and the main outlet. Owns routing and view lifecycle.
import { NAV, VIEWS, parseHash, href } from './routes.js';
import { esc, on } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { closeMenu, openMenu } from '../ui/menu.js';
import { formatBytes, relativeTime, modLabel } from '../core/utils.js';
import { prefs } from './prefs.js';

export class Shell {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.current = null; // { view, key, instance }
    this.navToken = 0;
    this.crumbs = [];
  }

  start() {
    this.root.innerHTML = `
      <div class="app no-project" id="app">
        <aside class="sidebar" aria-label="Main navigation"></aside>
        <div class="sidebar-backdrop" data-action="close-nav"></div>
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-toggle" data-action="toggle-nav" aria-label="Open navigation">${icon('menu')}</button>
          <nav class="breadcrumbs grow" aria-label="Breadcrumb"></nav>
          <button class="search-trigger" data-action="palette" aria-label="Search and commands">
            ${icon('search')}<span class="label">Search or jump to…</span>
            <span class="kbds"><kbd>${modLabel}</kbd><kbd>K</kbd></span>
          </button>
          <span class="save-indicator" aria-live="polite"></span>
          <button class="btn btn-ghost btn-icon" data-action="theme" data-tip="Toggle theme" aria-label="Toggle theme">${icon('moon')}</button>
        </header>
        <main class="main" id="main" tabindex="-1"></main>
      </div>`;
    this.app = this.root.querySelector('#app');
    this.sidebar = this.root.querySelector('.sidebar');
    this.main = this.root.querySelector('#main');
    this.breadcrumbsEl = this.root.querySelector('.breadcrumbs');
    this.saveEl = this.root.querySelector('.save-indicator');

    on(this.root, 'click', '[data-action]', (e, el) => this.#onAction(e, el));
    on(this.root, 'click', '.nav-item', () => this.app.classList.remove('nav-open'));
    window.addEventListener('hashchange', () => this.route());

    this.store.on('change', () => this.#renderSidebar());
    this.store.on('projects', () => this.#renderSidebar());
    this.store.on('status', () => this.#renderSaveStatus());
    this.store.on('project', () => this.#renderSaveStatus());
    this.store.on('save-error', (err) => toast(err.message, {
      type: 'error', title: 'Changes could not be saved', duration: 9000,
      action: err.code === 'QUOTA_EXCEEDED' ? { label: 'Open storage settings', onClick: () => this.navigate(href(this.store.project.id, 'settings', null, { tab: 'storage' })) } : null,
    }));
    setInterval(() => this.#renderSaveStatus(), 30000);
    this.#renderThemeButton();
    this.#renderSaveStatus();
    return this.route();
  }

  navigate(hash, { replace = false } = {}) {
    if (replace) { history.replaceState(null, '', hash); this.route(); } else if (location.hash === hash) this.route(true); else location.hash = hash;
  }

  href(section, itemId, query) { return href(this.store.project?.id, section, itemId, query); }

  /** Views call this to set breadcrumb trail: [{ label, href? }] */
  setBreadcrumbs(crumbs) {
    this.crumbs = crumbs;
    const project = this.store.project;
    const base = project ? [{ label: 'Projects', href: '#/projects', hideSm: true }, { label: project.name, href: href(project.id, 'dashboard') }] : [];
    const all = [...base, ...crumbs];
    this.breadcrumbsEl.innerHTML = all.map((c, i) => {
      const last = i === all.length - 1;
      const cls = c.hideSm ? 'crumb-hide-sm' : '';
      const content = last ? `<span class="current truncate ${cls}">${esc(c.label)}</span>` : (c.href ? `<a class="${cls} truncate" href="${esc(c.href)}">${esc(c.label)}</a>` : `<span class="${cls}">${esc(c.label)}</span>`);
      return `${content}${last ? '' : `<span class="sep ${cls}">/</span>`}`;
    }).join('');
  }

  async route(force = false) {
    const parsed = parseHash();
    const token = ++this.navToken;
    const key = `${parsed.view}|${parsed.projectId}|${parsed.params.id}|${JSON.stringify(parsed.params.query)}`;
    if (!force && this.current?.key === key) return;
    closeMenu();

    try {
      if (parsed.projectId) {
        if (this.store.project?.id !== parsed.projectId) await this.store.openProject(parsed.projectId);
      } else if (this.store.project && parsed.view === 'projects') {
        await this.store.flush();
      }
    } catch (err) {
      toastError(err, 'Could not open project');
      this.navigate('#/projects', { replace: true });
      return;
    }
    if (token !== this.navToken) return;

    const loader = VIEWS[parsed.view];
    let mod;
    try { mod = (await loader()).default; } catch (err) {
      console.error(err);
      this.#unmountCurrent();
      this.main.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('alert')}</div><h3>This page failed to load</h3><p>${esc(err.message)}</p></div></div>`;
      return;
    }
    if (token !== this.navToken) return;

    this.#unmountCurrent();
    this.app.classList.toggle('no-project', !parsed.projectId);
    this.main.className = `main ${mod.layout === 'flush' ? 'flush' : ''}`;
    this.main.innerHTML = '';
    this.main.scrollTop = 0;
    this.crumbs = [];
    this.setBreadcrumbs(mod.title ? [{ label: typeof mod.title === 'function' ? mod.title() : mod.title }] : []);
    document.title = `${mod.title ? `${typeof mod.title === 'function' ? mod.title() : mod.title} · ` : ''}${this.store.project ? `${this.store.project.name} · ` : ''}GradDocs`;
    this.#renderSidebar(parsed.section);
    const ctx = {
      store: this.store,
      project: this.store.project,
      params: parsed.params,
      shell: this,
      navigate: (h, o) => this.navigate(h, o),
      href: (section, itemId, query) => this.href(section, itemId, query),
    };
    let instance;
    try {
      instance = (await mod.mount(this.main, ctx)) || {};
    } catch (err) {
      console.error(err);
      this.main.innerHTML = `<div class="page"><div class="empty-state"><div class="empty-icon">${icon('alert')}</div><h3>Something went wrong</h3><p>${esc(err.message)}</p></div></div>`;
      instance = {};
    }
    this.current = { key, view: parsed.view, section: parsed.section, instance };
  }

  #unmountCurrent() {
    if (!this.current) return;
    try { this.current.instance?.unmount?.(); } catch (err) { console.error(err); }
    this.current = null;
  }

  #renderSidebar(section = this.current?.section) {
    const project = this.store.project;
    if (!project) { this.sidebar.innerHTML = ''; return; }
    const initials = project.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    this.sidebar.innerHTML = `
      <div class="sidebar-brand">
        <div class="brand-mark">${icon('graduation')}</div>
        <div><div class="brand-name">GradDocs</div><div class="brand-sub">Documentation Builder</div></div>
      </div>
      <button class="project-switcher" data-action="switch-project" aria-label="Switch project">
        <span class="project-avatar">${esc(initials || 'P')}</span>
        <span class="grow"><div class="name truncate">${esc(project.name)}</div><div class="sub truncate">${esc(project.type || 'Graduation Project')}</div></span>
        ${icon('chevronDown', 'icon-sm')}
      </button>
      <nav class="nav">
        ${NAV.map((group) => `
          <div class="nav-section">
            <div class="nav-label">${esc(group.group)}</div>
            ${group.items.map((item) => `
              <a class="nav-item ${section === item.id ? 'active' : ''}" href="${href(project.id, item.id)}" ${section === item.id ? 'aria-current="page"' : ''}>
                ${icon(item.icon)}<span>${esc(item.label)}</span>
                ${item.count ? `<span class="count">${item.count(project)}</span>` : ''}
              </a>`).join('')}
          </div>`).join('')}
      </nav>
      <div class="sidebar-footer">
        <div class="storage-meter" data-storage-meter>Storage: ${esc(this.store.repo.engine)}</div>
        <button class="btn btn-ghost btn-icon btn-sm" data-action="shortcuts" data-tip="Keyboard shortcuts" aria-label="Keyboard shortcuts">${icon('keyboard')}</button>
      </div>`;
    this.#renderStorageMeter();
  }

  async #renderStorageMeter() {
    const el = this.sidebar.querySelector('[data-storage-meter]');
    if (!el) return;
    try {
      const { used, quota } = await this.store.repo.usage();
      const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
      el.innerHTML = `<div class="row"><span class="grow truncate">${this.store.repo.engine === 'indexedDB' ? 'IndexedDB' : 'Local storage'}</span><span>${formatBytes(used)}</span></div>
        <div class="bar"><span style="width:${Math.max(2, pct).toFixed(1)}%;${pct > 80 ? 'background:var(--danger)' : ''}"></span></div>`;
    } catch { /* ignore */ }
  }

  #renderSaveStatus() {
    const { status, lastSavedAt } = this.store;
    const el = this.saveEl;
    if (!this.store.project) { el.innerHTML = ''; el.className = 'save-indicator'; return; }
    el.className = `save-indicator ${status}`;
    if (status === 'saving') el.innerHTML = '<span class="dot"></span>Saving…';
    else if (status === 'error') el.innerHTML = `<span class="dot"></span>Not saved`;
    else el.innerHTML = `${icon('check', 'icon-sm')}<span>Saved</span>`;
    el.title = lastSavedAt ? `Last saved ${relativeTime(lastSavedAt)}` : 'All changes are saved in this browser';
  }

  #renderThemeButton() {
    const btn = this.root.querySelector('[data-action="theme"]');
    const dark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
  }

  toggleTheme() {
    const dark = document.documentElement.dataset.theme === 'dark'
      || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    prefs.set('theme', dark ? 'light' : 'dark');
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    this.#renderThemeButton();
  }

  async #onAction(e, el) {
    const action = el.dataset.action;
    if (action === 'toggle-nav') this.app.classList.toggle('nav-open');
    else if (action === 'close-nav') this.app.classList.remove('nav-open');
    else if (action === 'theme') this.toggleTheme();
    else if (action === 'palette') (await import('./command-palette.js')).openPalette(this);
    else if (action === 'shortcuts') (await import('./shortcuts.js')).showShortcutsHelp();
    else if (action === 'switch-project') {
      const items = this.store.projects.slice(0, 8).map((p) => ({
        label: p.name, icon: p.id === this.store.project?.id ? 'check' : 'folder',
        onClick: () => this.navigate(href(p.id, 'dashboard')),
      }));
      openMenu(el, [{ heading: 'Switch project' }, ...items, '-', { label: 'All projects', icon: 'folderOpen', onClick: () => this.navigate('#/projects') }, { label: 'New project…', icon: 'plus', onClick: () => this.navigate('#/projects?new=1') }]);
    }
  }
}
