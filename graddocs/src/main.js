// Application bootstrap.
import { store } from './core/store.js';
import { Shell } from './app/shell.js';
import { applyTheme } from './app/prefs.js';
import { applyDocumentLanguage, t, missingTranslations, lang } from './i18n/index.js';
import { installGlobalShortcuts } from './app/shortcuts.js';
import { installTooltips } from './ui/tooltip.js';
import { toastError } from './ui/toast.js';
import { href } from './app/routes.js';
import { createDemoProject } from './demo/meyar.js';

applyTheme();
applyDocumentLanguage();
installTooltips();

window.addEventListener('error', (e) => console.error('[graddocs]', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => { toastError(e.reason, t('Unexpected error')); });

async function boot() {
  const root = document.getElementById('root');
  try {
    const lastProjectId = await store.init({ seed: createDemoProject });
    const shell = new Shell(root, store);
    window.graddocs = { store, shell, lang, missingTranslations }; // handy for debugging and automated tests
    installGlobalShortcuts(shell);
    // Never lose edits: flush on tab hide / close.
    window.addEventListener('pagehide', () => store.flushSync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flushSync(); });
    window.addEventListener('beforeunload', (e) => {
      store.flushSync();
      if (store.status === 'error') { e.preventDefault(); e.returnValue = ''; }
    });
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      history.replaceState(null, '', lastProjectId ? href(lastProjectId, 'dashboard') : '#/projects');
    }
    await shell.start();
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div style="padding:48px;font-family:system-ui"><h2>${t('GradDocs could not start')}</h2><p>${String(err.message || err)}</p></div>`;
  } finally {
    document.getElementById('boot')?.remove();
  }
}

boot();
