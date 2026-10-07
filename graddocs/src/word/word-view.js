// Word Sync page (#/p/<id>/word): link a Word report, see the live-sync status, sync now,
// review changes, create a project from a Word file and look at the sync history.
import { esc, on, Disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast, toastError } from '../ui/toast.js';
import { t } from '../i18n/index.js';
import { relativeTime, formatDateTime } from '../core/utils.js';
import {
  wordEvents, wordState, supportsLiveWatch, linkWordFile, syncNow, createProjectFromWord, unlinkWordFile, setAutoSync,
} from './sync.js';
import { getWatcher } from './watcher.js';

const IMPORTS = [
  { icon: 'structure', title: 'Chapters and sections', text: 'Heading 1 becomes a chapter and Heading 2–4 become sections. “Chapter 3:” labels, “1.4.2” numbers and ALL-CAPS titles are tidied up.' },
  { icon: 'fileText', title: 'Text and lists', text: 'Paragraphs and bulleted or numbered lists, in the order you wrote them. References such as “Figure 3” become live links.' },
  { icon: 'table', title: 'Tables', text: 'Cells, merged cells, header rows, alignment and column widths, together with their captions.' },
  { icon: 'figure', title: 'Pictures', text: 'Pictures become figures, scaled down to keep your project small. The caption becomes the title.' },
  { icon: 'acronym', title: 'Acronyms', text: 'The list of abbreviations in your front matter, as a table or as “AI – Artificial Intelligence” lines.' },
  { icon: 'chapters', title: 'Front matter', text: 'Declaration, acknowledgements and abstract. The table of contents and the lists of figures and tables are rebuilt by GradDocs.' },
];

const STATUS = {
  watching: { label: 'Watching', cls: 'badge-success', dot: true, text: 'GradDocs checks the file every few seconds and imports your changes when you save in Word.' },
  'needs-permission': { label: 'Needs reconnect', cls: 'badge-warning', text: 'After a reload the browser needs your permission to read the file again. Click Reconnect to resume live sync.' },
  'no-handle': { label: 'Needs reconnect', cls: 'badge-warning', text: 'GradDocs does not have access to the file yet. Choose it again to resume live sync.' },
  missing: { label: 'File not found', cls: 'badge-danger', text: 'The file was moved, renamed or deleted. Choose it again to continue.' },
  unsupported: { label: 'Not supported in this browser', cls: '', text: 'This browser cannot watch files for changes. Click Sync now and choose the file after you save in Word.' },
};

export default {
  title: 'Word Sync',
  layout: 'page',
  mount(container, ctx) {
    const { store, shell } = ctx;
    const d = new Disposer();
    let alive = true;
    let renderTimer = 0;

    const link = () => store.project?.wordLink || null;
    const watcherStatus = () => getWatcher()?.status() || { mode: link() ? (supportsLiveWatch() ? 'no-handle' : 'unsupported') : 'unlinked', pending: wordState.pending };

    const timeHTML = (ts) => (ts ? `<span title="${esc(formatDateTime(ts))}">${esc(relativeTime(ts))}</span>` : esc(t('never')));

    const historyHTML = () => {
      const history = link()?.history || [];
      if (!history.length) {
        return `<div class="ws-empty">${icon('history')}<span>${esc(t('Nothing has been synced yet.'))}</span></div>`;
      }
      return `<ul class="ws-history-list">${history.slice(0, 8).map((h) => {
        const c = h.counts || {};
        const chips = [
          c.added && `<span class="badge badge-success">${esc(t('{n} new', { n: c.added }))}</span>`,
          c.updated && `<span class="badge badge-info">${esc(t('{n} updated', { n: c.updated }))}</span>`,
          c.renamed && `<span class="badge badge-primary">${esc(t('{n} renamed', { n: c.renamed }))}</span>`,
          c.removed && `<span class="badge badge-danger">${esc(t('{n} removed', { n: c.removed }))}</span>`,
        ].filter(Boolean).join('') || `<span class="badge">${esc(h.first ? t('Linked') : t('No changes'))}</span>`;
        return `<li class="ws-history-item"><span class="ws-history-dot"></span>
          <div class="grow"><div class="ws-history-when" title="${esc(formatDateTime(h.at))}">${esc(relativeTime(h.at))}</div>
          <div class="ws-history-chips">${chips}</div></div>
          <bdi class="ws-history-file truncate">${esc(h.file || '')}</bdi></li>`;
      }).join('')}</ul>`;
    };

    const statusCardHTML = () => {
      const l = link();
      const busy = wordState.busy;
      if (!l) {
        return `<section class="card ws-card ws-status ws-unlinked">
          <div class="ws-unlinked-body">
            <div class="ws-tile ws-tile-xl">${icon('word')}</div>
            <h2>${esc(t('No Word file linked yet'))}</h2>
            <p>${esc(t('Link the .docx file of this report. Chapters, sections, tables and figures that already exist are matched by title, so nothing is duplicated.'))}</p>
            <div class="ws-actions">
              <button class="btn btn-primary btn-lg" data-action="link" ${busy ? 'disabled' : ''}>${icon('link')}${esc(t('Link Word file'))}</button>
            </div>
            ${supportsLiveWatch() ? '' : `<div class="callout callout-info ws-callout">${icon('info')}<div>${esc(t('This browser cannot watch files for changes, so you will click Sync now after saving in Word. Chrome or Edge on a computer can sync automatically.'))}</div></div>`}
          </div>
        </section>`;
      }
      const status = watcherStatus();
      const st = STATUS[status.mode] || STATUS['no-handle'];
      const needsReconnect = status.mode === 'needs-permission';
      const pending = wordState.pending;
      return `<section class="card ws-card ws-status">
        <header class="ws-status-head">
          <div class="ws-tile ws-tile-lg">${icon('word')}</div>
          <div class="grow">
            <div class="ws-eyebrow">${esc(t('Linked Word file'))}</div>
            <h2 class="ws-file-title"><bdi>${esc(l.fileName || '—')}</bdi></h2>
          </div>
          <span class="badge ${st.cls} ws-live ${st.dot ? 'is-live' : ''}">${st.dot ? '<span class="ws-pulse"></span>' : ''}${esc(t(st.label))}</span>
        </header>
        ${pending ? `<div class="callout callout-warning ws-callout">${icon('alert')}<div class="grow">${esc(pending.removals ? t('The Word file changed and some items were removed from it. Review before applying.') : t('The Word file changed and is waiting for your review.'))}</div><button class="btn btn-sm" data-action="sync">${esc(t('Review changes'))}</button></div>` : ''}
        <dl class="kv ws-kv">
          <dt>${esc(t('Last synced'))}</dt><dd>${timeHTML(l.lastSyncedAt)}</dd>
          <dt>${esc(t('Sync mode'))}</dt><dd>${esc(l.autoSync !== false && status.mode !== 'unsupported' ? t('Automatic, when you save in Word') : t('Manual, with Sync now'))}</dd>
        </dl>
        <p class="ws-status-text">${esc(t(st.text))}</p>
        <label class="switch ws-auto"><input type="checkbox" data-toggle="auto" ${l.autoSync !== false && status.mode !== 'unsupported' ? 'checked' : ''} ${status.mode === 'unsupported' ? 'disabled' : ''}><span class="track"></span><span>${esc(t('Sync automatically when the Word file is saved'))}</span></label>
        <div class="ws-hint">${esc(status.mode === 'unsupported' ? t('Automatic sync needs Chrome or Edge on a computer.') : t('Changes that remove content are always shown to you first.'))}</div>
        <footer class="ws-status-actions">
          ${needsReconnect ? `<button class="btn btn-primary" data-action="reconnect">${icon('link')}${esc(t('Reconnect'))}</button>` : ''}
          <button class="btn ${needsReconnect ? '' : 'btn-primary'}" data-action="sync" ${busy ? 'disabled' : ''}>${icon('refresh')}${esc(busy ? t('Reading Word file…') : t('Sync now'))}</button>
          <button class="btn" data-action="link" ${busy ? 'disabled' : ''}>${icon('swap')}${esc(t('Choose another file'))}</button>
          <span class="grow"></span>
          <button class="btn btn-ghost ws-unlink" data-action="unlink">${icon('unlink')}${esc(t('Unlink'))}</button>
        </footer>
      </section>`;
    };

    const render = () => {
      if (!alive) return;
      const focused = document.activeElement?.dataset?.toggle;
      container.innerHTML = `
        <div class="page ws-page">
          <div class="page-header">
            <div class="titles">
              <h1>${icon('word')}${esc(t('Word Sync'))}</h1>
              <p class="subtitle">${esc(t('Write your report in Microsoft Word and let GradDocs pull it in. Word is only read, never changed.'))}</p>
            </div>
          </div>

          <section class="card ws-card ws-hero">
            <div class="ws-hero-text">
              <div class="ws-eyebrow">${esc(t('How it works'))}</div>
              <h2>${esc(t('Write in Word, GradDocs keeps your figures, tables and lists in sync'))}</h2>
              <p>${esc(t('Link your report once. Each time you save in Word, GradDocs imports the new and changed chapters, text, tables, pictures and acronyms. You review anything that removes content, and every sync can be undone.'))}</p>
              <ol class="ws-steps">
                <li><span class="ws-step-n">1</span>${esc(t('Link your Word file'))}</li>
                <li><span class="ws-step-n">2</span>${esc(t('Keep writing in Word'))}</li>
                <li><span class="ws-step-n">3</span>${esc(t('Save, and GradDocs updates'))}</li>
              </ol>
            </div>
            <div class="ws-flow" aria-hidden="true">
              <div class="ws-flow-card ws-flow-word"><div class="ws-tile ws-tile-lg">${icon('word')}</div><span>Word</span></div>
              <div class="ws-flow-line"><span></span><span></span><span></span></div>
              <div class="ws-flow-card ws-flow-app"><div class="ws-tile ws-tile-lg ws-tile-brand">${icon('graduation')}</div><span>GradDocs</span></div>
            </div>
          </section>

          <div class="ws-cols">
            ${statusCardHTML()}
            <div class="ws-side">
              <section class="card ws-card ws-create">
                <div class="ws-create-head"><div class="ws-tile">${icon('plus')}</div><h2>${esc(t('Start from a Word file'))}</h2></div>
                <p>${esc(t('Create a new GradDocs project from a report you already wrote: title, chapters, tables, pictures, acronyms and front matter.'))}</p>
                <button class="btn" data-action="create" ${wordState.busy ? 'disabled' : ''}>${icon('upload')}${esc(t('Create new project from Word'))}</button>
              </section>
              <section class="card ws-card ws-history">
                <header class="ws-card-title">${icon('history')}<h2>${esc(t('Recent syncs'))}</h2></header>
                ${historyHTML()}
              </section>
            </div>
          </div>

          <section class="card ws-card ws-imports">
            <header class="ws-card-title">${icon('checkCircle')}<h2>${esc(t('What gets imported'))}</h2></header>
            <ul class="ws-import-grid">
              ${IMPORTS.map((i) => `<li class="ws-import"><div class="ws-tile">${icon(i.icon)}</div><div><h3>${esc(t(i.title))}</h3><p>${esc(t(i.text))}</p></div></li>`).join('')}
            </ul>
            <div class="callout callout-info ws-callout">${icon('lock')}<div>${esc(t('Word wins for the text, tables and pictures it owns. Diagrams you draw in GradDocs are never replaced, and nothing is ever written to your Word file.'))}</div></div>
          </section>
        </div>`;
      if (focused) container.querySelector(`[data-toggle="${focused}"]`)?.focus();
    };

    const onClick = async (e, el) => {
      const action = el.dataset.action;
      try {
        if (action === 'link') await linkWordFile({ store, shell });
        else if (action === 'sync') await syncNow({ store, shell });
        else if (action === 'create') await createProjectFromWord({ store, shell });
        else if (action === 'unlink') await unlinkWordFile({ store });
        else if (action === 'reconnect') {
          const ok = await getWatcher()?.reconnect();
          if (ok) toast(t('Live sync resumed.'), { type: 'success', duration: 2500 });
          else toast(t('Could not reconnect. Choose the file again with “Choose another file”.'), { type: 'warning' });
        }
      } catch (err) { toastError(err, t('Word sync failed')); }
      render();
    };

    render();
    d.add(on(container, 'click', '[data-action]', onClick));
    d.add(on(container, 'change', '[data-toggle="auto"]', (e, el) => { setAutoSync(store, el.checked); }));
    d.add(store.on('change', () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 60); }));
    d.add(store.on('project', () => { if (alive) render(); }));
    for (const ev of ['status', 'synced', 'busy', 'pending', 'undone', 'relink']) d.add(wordEvents.on(ev, () => { clearTimeout(renderTimer); renderTimer = setTimeout(render, 30); }));
    const tick = setInterval(render, 30000);
    d.add(() => clearInterval(tick));

    // Opened from the "Your Word file changed" toast.
    if (ctx.params.query?.review && link()) setTimeout(() => { if (alive) syncNow({ store, shell }).then(render); }, 50);

    return {
      unmount() { alive = false; clearTimeout(renderTimer); d.dispose(); },
    };
  },
};
