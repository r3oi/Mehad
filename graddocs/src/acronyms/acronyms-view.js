// Acronyms manager (#/p/<id>/acronyms): searchable alphabetical list, add / edit /
// delete (with undo), bulk paste, automatic suggestions, PDF print and
// "copy as Word table".
import { esc, on, Disposer, highlight, flash } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal, confirmDialog, formDialog } from '../ui/modal.js';
import { openMenu } from '../ui/menu.js';
import { toast, toastError } from '../ui/toast.js';
import { createAcronym } from '../core/model.js';
import { sortAcronyms } from '../core/document.js';
import { plural } from '../core/utils.js'; // activity-log entries are stored in English
import { t, isRTL } from '../i18n/index.js';
import { iso, strong, tHTML, count } from '../projects/projects-view.js';
import { detectAcronymSuggestions, countUsages } from './detection.js';

/** Forces left-to-right order for a snippet of Latin text inside Arabic UI text (no-op in English). */
const ltr = (s) => (isRTL ? `\u2066${s}\u2069` : String(s));

const norm = (s) => String(s ?? '').trim().toLowerCase();

// ----- Parsing pasted lists -------------------------------------------------
// "AI - Artificial Intelligence", "AI: …", "AI — …", "AI\t…", "AI = …"
const SEPARATOR = /\t+|\s*[:=]\s*|\s+[-–—]+\s+|\s*[–—]+\s*/;

/** parseAcronymList(text, existingAcronyms[]) → { fresh: [{acronym, meaning}], duplicates: [], invalid: [lines] } */
export function parseAcronymList(textValue, existing = []) {
  const seen = new Set(existing.map(norm));
  const out = { fresh: [], duplicates: [], invalid: [] };
  for (const raw of String(textValue || '').split(/\r?\n/)) {
    const line = raw.replace(/^[\s•·▪●◦]+/, '').trim();
    if (!line) continue;
    const m = SEPARATOR.exec(line);
    const acronym = m ? line.slice(0, m.index).trim() : '';
    const meaning = m ? line.slice(m.index + m[0].length).trim() : '';
    if (!m || !acronym || !meaning || acronym.length > 24 || acronym.split(/\s+/).length > 3 || meaning.length > 240) { out.invalid.push(line); continue; }
    if (seen.has(norm(acronym))) { out.duplicates.push({ acronym, meaning }); continue; }
    seen.add(norm(acronym));
    out.fresh.push({ acronym, meaning });
  }
  return out;
}

// ----- Export helpers ---------------------------------------------------------
// The printed list (title, table, language) is report content: it stays English.
function printableHTML(project, list) {
  const s = project.settings;
  const ty = s.typography;
  const m = s.page.margins;
  const letter = s.page.size === 'Letter';
  const landscape = s.page.orientation === 'landscape';
  let [w, h] = letter ? [21.59, 27.94] : [21, 29.7];
  if (landscape) [w, h] = [h, w];
  const font = String(ty.fontFamily).replace(/['"<>]/g, '');
  const rows = list.map((a) => `<tr><td class="a">${esc(a.acronym)}</td><td>${esc(a.meaning)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>List of Acronyms and Abbreviations - ${esc(project.name)}</title>
<style>
  @page { size: ${letter ? 'Letter' : 'A4'} ${landscape ? 'landscape' : 'portrait'}; margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: '${font}', 'Times New Roman', Times, serif; font-size: ${ty.fontSize}pt; line-height: ${ty.lineSpacing}; }
  h1 { margin: 0 0 18pt; text-align: center; font-weight: 700; font-size: ${ty.headingSizes.h1}pt; line-height: 1.3; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; border: 0; }
  td { border: 0; padding: 3pt 14pt 3pt 0; vertical-align: top; }
  td.a { width: 28%; font-weight: 700; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  @media screen {
    html, body { background: #e7eaf0; }
    .sheet { width: ${w}cm; max-width: 100%; min-height: ${h}cm; margin: 20px auto; padding: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm; background: #fff; box-shadow: 0 2px 16px rgba(16, 24, 40, .18); }
  }
</style></head>
<body><div class="sheet"><h1>LIST OF ACRONYMS AND ABBREVIATIONS</h1><table><tbody>${rows}</tbody></table></div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 300); });<\/script>
</body></html>`;
}

function exportPdf(project) {
  const list = sortAcronyms(project.acronyms);
  if (!list.length) { toast(t('Add at least one acronym before exporting.'), { type: 'info' }); return; }
  const win = window.open('', '_blank');
  if (!win) { toast(t('Your browser blocked the print window. Allow pop-ups for this site and try again.'), { type: 'warning', title: t('Pop-up blocked'), duration: 7000 }); return; }
  win.document.open();
  win.document.write(printableHTML(project, list));
  win.document.close();
  toast(t('Choose “Save as PDF” in the print dialog.'), { type: 'info', title: t('Print window opened') });
}

function legacyCopy(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
  document.body.append(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges(); holder.remove();
  return ok;
}

async function copyAsWordTable(project) {
  const list = sortAcronyms(project.acronyms);
  if (!list.length) { toast(t('Add at least one acronym before copying.'), { type: 'info' }); return; }
  const ty = project.settings.typography;
  const font = String(ty.fontFamily).replace(/['"<>]/g, '');
  const cell = 'border:none;padding:2pt 14pt 2pt 0;vertical-align:top';
  const html = `<table style="border-collapse:collapse;border:none;font-family:'${font}',serif;font-size:${ty.fontSize}pt"><tbody>${list.map((a) => `<tr><td style="${cell};font-weight:bold">${esc(a.acronym)}</td><td style="${cell}">${esc(a.meaning)}</td></tr>`).join('')}</tbody></table>`;
  const plain = list.map((a) => `${a.acronym}\t${a.meaning}`).join('\n');
  let ok = false;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      ok = true;
    }
  } catch { ok = false; }
  if (!ok) ok = legacyCopy(html);
  if (!ok) { try { await navigator.clipboard.writeText(plain); ok = true; } catch { ok = false; } }
  if (ok) toast(count(list.length, 'Copied 1 acronym as a table. Paste it into Word.', 'Copied {n} acronyms as a table. Paste it into Word.'), { type: 'success', title: t('Copied') });
  else toast(t('The browser did not allow clipboard access. Try again after clicking inside the page.'), { type: 'error', title: t('Could not copy') });
}

// ---------------------------------------------------------------------------

export default {
  title: 'Acronyms',
  layout: 'page',
  mount(container, ctx) {
    const { store } = ctx;
    const d = new Disposer();
    let alive = true;
    let query = '';
    let usageCache = { rev: -1, map: new Map() };

    container.innerHTML = `
      <div class="page acr-page">
        <div class="page-header">
          <div class="titles">
            <h1>${esc(t('Acronyms & Abbreviations'))} <span class="badge badge-primary acr-count" data-count></span></h1>
            <p class="subtitle">${esc(t('Alphabetical list used for the “List of Acronyms and Abbreviations” in your report.'))}</p>
          </div>
          <div class="actions">
            <button class="btn" data-action="paste">${icon('clipboard')}${t('Paste list')}</button>
            <button class="btn btn-primary" data-action="add">${icon('plus')}${t('Add Acronym')}</button>
            <button class="btn btn-icon" data-action="more" data-tip="${esc(t('More actions'))}" aria-label="${esc(t('More actions'))}" aria-haspopup="menu">${icon('more')}</button>
          </div>
        </div>
        <div data-region="suggestions"></div>
        <div class="toolbar acr-toolbar">
          <div class="input-group">${icon('search')}<input class="input" type="search" data-role="search" placeholder="${esc(t('Search acronyms, meanings…'))}" aria-label="${esc(t('Search acronyms'))}" autocomplete="off"></div>
          <span class="muted acr-result" data-result></span>
        </div>
        <div data-region="list"></div>
      </div>`;
    const countEl = container.querySelector('[data-count]');
    const resultEl = container.querySelector('[data-result]');
    const suggestEl = container.querySelector('[data-region="suggestions"]');
    const listEl = container.querySelector('[data-region="list"]');
    const searchEl = container.querySelector('[data-role="search"]');

    const project = () => store.project;
    const usages = () => {
      if (usageCache.rev !== store.revision) {
        const map = new Map();
        for (const a of project().acronyms) map.set(a.id, countUsages(project(), a.acronym));
        usageCache = { rev: store.revision, map };
      }
      return usageCache.map;
    };
    const exists = (value, ignoreId) => project().acronyms.some((a) => a.id !== ignoreId && norm(a.acronym) === norm(value));

    // ----- Rendering ------------------------------------------------------------
    const renderSuggestions = () => {
      if (!alive || !project()) return;
      const list = detectAcronymSuggestions(project());
      if (!list.length) { suggestEl.innerHTML = ''; return; }
      suggestEl.innerHTML = `
        <section class="card acr-suggest" aria-label="${esc(t('Detected acronyms'))}">
          <div class="card-header">
            <span class="acr-sug-ico">${icon('sparkles')}</span>
            <div class="grow"><h2>${t('Detected in your text')}</h2><div class="acr-sug-desc">${esc(t('Found as “Full Name (ABBR)” in your chapters but not in your list yet.'))}</div></div>
            <button class="btn btn-sm btn-primary" data-action="sug-add-all">${icon('plus')}${esc(t('Add all ({n})', { n: list.length }))}</button>
          </div>
          <div class="acr-sug-list">${list.map((sg) => {
            const shown = sg.sources.slice(0, 2).map((x) => `<bdi>${esc(x.label)}</bdi>`).join(t(', '));
            const more = sg.sources.length > 2 ? ` ${esc(t('and {n} more', { n: sg.sources.length - 2 }))}` : '';
            return `
            <div class="acr-sug-row" data-sug="${esc(sg.acronym)}">
              <div class="grow min0">
                <div class="acr-sug-main"><b class="acr-badge"><bdi>${esc(sg.acronym)}</bdi></b><span class="acr-sep"> — </span><span class="acr-sug-meaning"><bdi>${esc(sg.meaning)}</bdi></span></div>
                <div class="acr-sug-src">${tHTML('found in {sources}', { sources: `${shown}${more}` })}</div>
              </div>
              <div class="acr-sug-actions">
                <button class="btn btn-sm btn-soft" data-action="sug-add" data-acr="${esc(sg.acronym)}">${icon('plus')}${t('Add')}</button>
                <button class="btn btn-sm btn-ghost" data-action="sug-dismiss" data-acr="${esc(sg.acronym)}">${t('Dismiss')}</button>
              </div>
            </div>`;
          }).join('')}</div>
        </section>`;
    };

    const renderList = () => {
      if (!alive || !project()) return;
      const all = sortAcronyms(project().acronyms);
      countEl.textContent = String(all.length);
      countEl.setAttribute('aria-label', count(all.length, '1 acronym', '{n} acronyms'));
      const q = query.trim();
      const rows = q ? all.filter((a) => [a.acronym, a.meaning, a.description].some((x) => norm(x).includes(norm(q)))) : all;
      resultEl.textContent = q && all.length ? t('{n} of {total} shown', { n: rows.length, total: all.length }) : '';

      if (!all.length) {
        listEl.innerHTML = `
          <div class="card"><div class="empty-state">
            <div class="empty-icon">${icon('acronym')}</div>
            <h3>${t('No acronyms yet')}</h3>
            <p>${esc(t('Add the abbreviations used in your report. Write “Full Name (ABBR)” in a chapter and GradDocs will also suggest it automatically.'))}</p>
            <div class="row" style="justify-content:center;flex-wrap:wrap">
              <button class="btn btn-primary" data-action="add">${icon('plus')}${t('Add Acronym')}</button>
              <button class="btn" data-action="paste">${icon('clipboard')}${t('Paste list')}</button>
            </div>
          </div></div>`;
        return;
      }
      if (!rows.length) {
        listEl.innerHTML = `
          <div class="card"><div class="empty-state" style="padding:40px 24px">
            <div class="empty-icon">${icon('search')}</div>
            <h3>${t('No matches')}</h3>
            <p>${tHTML('Nothing matches “{q}”. Try a different word or clear the search.', { q: `<bdi>${esc(q)}</bdi>` })}</p>
            <button class="btn" data-action="clear-search">${t('Clear search')}</button>
          </div></div>`;
        return;
      }
      const used = usages();
      listEl.innerHTML = `
        <div class="card acr-card"><table class="data-table acr-table">
          <thead><tr><th>${t('Acronym')}</th><th>${t('Meaning')}</th><th>${t('Description')}</th><th class="acr-used-col">${t('Used')}</th><th class="acr-actions-col"><span class="sr-only">${t('Actions')}</span></th></tr></thead>
          <tbody>${rows.map((a) => {
            const n = used.get(a.id) || 0;
            return `
            <tr data-id="${esc(a.id)}">
              <td class="acr-key" data-label="${esc(t('Acronym'))}"><span class="acr-badge"><bdi>${highlight(a.acronym, q)}</bdi></span></td>
              <td data-label="${esc(t('Meaning'))}" class="acr-meaning"><bdi>${highlight(a.meaning, q)}</bdi></td>
              <td data-label="${esc(t('Description'))}" class="acr-desc">${a.description ? `<bdi>${highlight(a.description, q)}</bdi>` : '<span class="faint">—</span>'}</td>
              <td data-label="${esc(t('Used'))}" class="acr-used">${n ? `<span title="${esc(count(n, 'Used 1 time in your text', 'Used {n} times in your text'))}"><bdi>${n}×</bdi></span>` : `<span class="muted">${t('unused')}</span>`}</td>
              <td class="acr-actions">
                <button class="btn btn-ghost btn-icon btn-sm" data-action="edit" data-id="${esc(a.id)}" data-tip="${esc(t('Edit'))}" aria-label="${esc(t('Edit {name}', { name: a.acronym }))}">${icon('edit')}</button>
                <button class="btn btn-ghost btn-icon btn-sm acr-del" data-action="delete" data-id="${esc(a.id)}" data-tip="${esc(t('Delete'))}" aria-label="${esc(t('Delete {name}', { name: a.acronym }))}">${icon('trash')}</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
    };

    const renderAll = () => { renderSuggestions(); renderList(); };

    // ----- Add / edit -----------------------------------------------------------
    async function openEditor(existing = null) {
      const values = await formDialog({
        title: existing ? t('Edit acronym') : t('Add acronym'),
        submitText: existing ? t('Save changes') : t('Add acronym'),
        fields: [
          { name: 'acronym', label: t('Acronym'), value: existing?.acronym ?? '', required: true, placeholder: t('e.g. API'), autofocus: true },
          { name: 'meaning', label: t('Meaning'), value: existing?.meaning ?? '', required: true, placeholder: t('e.g. Application Programming Interface') },
          { name: 'description', label: t('Description'), type: 'textarea', rows: 3, value: existing?.description ?? '', placeholder: t('Optional note about this term'), hint: t('Optional. Kept in your project for reference.') },
        ],
        validate: (v) => (v.acronym && exists(v.acronym, existing?.id) ? { acronym: t('This acronym already exists.') } : null),
      });
      if (!values) return;
      if (existing) {
        store.update((p) => {
          const target = p.acronyms.find((a) => a.id === existing.id);
          if (target) Object.assign(target, { acronym: values.acronym, meaning: values.meaning, description: values.description });
        }, { activity: `Updated acronym ${values.acronym}` });
        toast(t('Updated “{name}”.', { name: iso(values.acronym) }), { type: 'success' });
      } else {
        const created = createAcronym(values);
        store.update((p) => { p.acronyms.push(created); }, { activity: `Added acronym ${values.acronym}` });
        toast(t('Added “{name}”.', { name: iso(values.acronym) }), { type: 'success' });
        flash(container.querySelector(`tr[data-id="${CSS.escape(created.id)}"]`));
      }
    }

    async function removeAcronym(id) {
      const index = project().acronyms.findIndex((a) => a.id === id);
      if (index < 0) return;
      const item = { ...project().acronyms[index] };
      const ok = await confirmDialog({
        title: t('Delete acronym?'), danger: true, confirmText: t('Delete'),
        message: tHTML('{acronym} ({meaning}) will be removed from your list of acronyms.', { acronym: strong(item.acronym), meaning: `<bdi>${esc(item.meaning)}</bdi>` }),
      });
      if (!ok) return;
      store.update((p) => { const i = p.acronyms.findIndex((a) => a.id === id); if (i >= 0) p.acronyms.splice(i, 1); }, { activity: `Deleted acronym ${item.acronym}` });
      toast(t('Deleted “{name}”.', { name: iso(item.acronym) }), {
        type: 'success',
        action: {
          label: t('Undo'),
          onClick: () => {
            if (exists(item.acronym)) { toast(t('“{name}” was added again, so it was not restored.', { name: iso(item.acronym) }), { type: 'warning' }); return; }
            store.update((p) => { p.acronyms.splice(Math.min(index, p.acronyms.length), 0, item); }, { activity: `Restored acronym ${item.acronym}` });
            toast(t('Restored “{name}”.', { name: iso(item.acronym) }), { type: 'success' });
          },
        },
      });
    }

    // ----- Paste list -------------------------------------------------------------
    function openPaste() {
      const modal = openModal({
        title: t('Paste acronym list'),
        subtitle: t('One per line, for example {example}. Separators: {separators} or a tab.', { example: ltr('“API - Application Programming Interface”'), separators: ltr('- : = —') }),
        size: 'lg',
        body: `
          <div class="field"><textarea class="textarea acr-paste" rows="9" dir="auto" aria-label="${esc(t('Acronym list'))}" spellcheck="false"
            placeholder="AI - Artificial Intelligence&#10;API: Application Programming Interface&#10;UML = Unified Modeling Language&#10;SDLC&#9;Software Development Life Cycle"></textarea></div>
          <div class="acr-paste-summary" aria-live="polite"></div>
          <div class="acr-paste-preview"></div>`,
        footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-import disabled>${t('Import')}</button>`,
      });
      const ta = modal.$('textarea');
      const summary = modal.$('.acr-paste-summary');
      const preview = modal.$('.acr-paste-preview');
      const importBtn = modal.$('[data-import]');
      let parsed = { fresh: [], duplicates: [], invalid: [] };

      const update = () => {
        parsed = parseAcronymList(ta.value, project().acronyms.map((a) => a.acronym));
        const { fresh, duplicates, invalid } = parsed;
        const any = fresh.length + duplicates.length + invalid.length;
        summary.innerHTML = any
          ? `<span class="ps-new">${esc(t('{n} new', { n: fresh.length }))}</span>${esc(t(', '))}<span class="ps-dup">${esc(t('{n} duplicates skipped', { n: duplicates.length }))}</span>${esc(t(', '))}<span class="ps-bad">${esc(t('{n} invalid', { n: invalid.length }))}</span>`
          : `<span class="muted">${t('Paste your list above to preview what will be imported.')}</span>`;
        preview.innerHTML = `
          ${fresh.length ? `<div class="acr-paste-rows">${fresh.slice(0, 6).map((a) => `<div><b class="acr-badge"><bdi>${esc(a.acronym)}</bdi></b><span class="acr-sep"> — </span><bdi>${esc(a.meaning)}</bdi></div>`).join('')}${fresh.length > 6 ? `<div class="muted">${esc(t('and {n} more…', { n: fresh.length - 6 }))}</div>` : ''}</div>` : ''}
          ${invalid.length ? `<div class="acr-paste-bad">${esc(t('Could not read:'))} ${invalid.slice(0, 3).map((l) => `<code dir="auto">${esc(l.length > 40 ? `${l.slice(0, 40)}…` : l)}</code>`).join(' ')}${invalid.length > 3 ? ` ${esc(t('and {n} more', { n: invalid.length - 3 }))}` : ''}</div>` : ''}`;
        importBtn.disabled = fresh.length === 0;
        importBtn.textContent = fresh.length ? count(fresh.length, 'Import 1 acronym', 'Import {n} acronyms') : t('Import');
      };
      ta.addEventListener('input', update);
      update();
      importBtn.addEventListener('click', () => {
        const items = parsed.fresh;
        if (!items.length) return;
        store.update((p) => { for (const a of items) p.acronyms.push(createAcronym(a)); }, { activity: `Imported ${plural(items.length, 'acronym')}` });
        modal.close();
        const imported = count(items.length, 'Imported 1 acronym', 'Imported {n} acronyms');
        const skipped = parsed.duplicates.length ? `${t(', ')}${count(parsed.duplicates.length, 'skipped 1 duplicate', 'skipped {n} duplicates')}` : '';
        toast(`${imported}${skipped}.`, { type: 'success' });
      });
    }

    // ----- Suggestions ------------------------------------------------------------
    const suggestionByAcronym = (acr) => detectAcronymSuggestions(project()).find((s) => s.acronym === acr);

    const addSuggestions = (items) => {
      const fresh = items.filter((s) => !exists(s.acronym));
      if (!fresh.length) return;
      store.update((p) => { for (const s of fresh) p.acronyms.push(createAcronym({ acronym: s.acronym, meaning: s.meaning })); },
        { activity: fresh.length === 1 ? `Added acronym ${fresh[0].acronym}` : `Added ${plural(fresh.length, 'detected acronym')}` });
      toast(fresh.length === 1 ? t('Added “{name}”.', { name: iso(fresh[0].acronym) }) : t('Added {n} acronyms.', { n: fresh.length }), { type: 'success' });
    };

    const dismissSuggestion = (acr) => {
      store.update((p) => { if (!p.dismissedSuggestions.some((x) => norm(x) === norm(acr))) p.dismissedSuggestions.push(acr); }, { activity: `Dismissed suggestion ${acr}` });
      toast(t('Dismissed “{name}”.', { name: iso(acr) }), {
        type: 'info',
        action: { label: t('Undo'), onClick: () => store.update((p) => { p.dismissedSuggestions = p.dismissedSuggestions.filter((x) => norm(x) !== norm(acr)); }, { activity: `Restored suggestion ${acr}` }) },
      });
    };

    // ----- Events -----------------------------------------------------------------
    d.add(on(container, 'click', '[data-action]', (e, el) => {
      const { action, id, acr } = el.dataset;
      if (action === 'add') openEditor();
      else if (action === 'paste') openPaste();
      else if (action === 'edit') { const a = project().acronyms.find((x) => x.id === id); if (a) openEditor(a); }
      else if (action === 'delete') removeAcronym(id);
      else if (action === 'clear-search') { query = ''; searchEl.value = ''; renderList(); searchEl.focus(); }
      else if (action === 'sug-add') { const s = suggestionByAcronym(acr); if (s) addSuggestions([s]); }
      else if (action === 'sug-add-all') addSuggestions(detectAcronymSuggestions(project()));
      else if (action === 'sug-dismiss') dismissSuggestion(acr);
      else if (action === 'more') {
        openMenu(el, [
          { label: t('Export as PDF'), icon: 'printer', onClick: () => exportPdf(project()) },
          { label: t('Copy as table for Word'), icon: 'clipboard', onClick: () => copyAsWordTable(project()) },
        ], { align: isRTL ? 'start' : 'end' }); // the menu opens towards the inside of the page
      }
    }));
    d.add(on(container, 'input', '[data-role="search"]', (e, el) => { query = el.value; renderList(); }));
    d.add(store.on('change', renderAll));

    ctx.shell.setBreadcrumbs([{ label: t('Acronyms') }]);
    renderAll();
    const focusId = ctx.params?.query?.focus;
    if (focusId) {
      const row = container.querySelector(`tr[data-id="${CSS.escape(focusId)}"]`);
      if (row) requestAnimationFrame(() => flash(row));
    }
    if (ctx.params?.query?.new === '1') openEditor();

    return { unmount() { alive = false; d.dispose(); } };
  },
};
