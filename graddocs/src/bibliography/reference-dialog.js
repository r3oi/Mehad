// Reference dialogs: add / edit one bibliography entry (with a live preview in the project's style) and
// import BibTeX (pasted or from a .bib file). Used by the References page and by the Cite picker of the body editor.
//
//   openReferenceDialog(store, { ref?, onSaved(ref, { isNew }) })   // ref = existing entry to edit
//   openBibTeXImport(store, { onDone({ added, skipped }) })
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { createReference } from '../core/model.js';
import { pickFile, readFileAsText } from '../core/utils.js';
import { t, isRTL } from '../i18n/index.js';
import { REFERENCE_TYPES, typeInfo, formatReferenceRuns, findDuplicateReference, parseBibTeX } from '../core/bibliography.js';

/** Keeps user text from reordering an Arabic sentence; a no-op in English. */
export const iso = (s) => (isRTL ? `⁨${s}⁩` : String(s));
/** Bold, direction-isolated user text for HTML dialog messages. */
export const strong = (s) => `<strong><bdi>${esc(s)}</bdi></strong>`;
/** t() for HTML messages: the translated text is escaped, placeholders take ready-made HTML. */
export const tHTML = (key, params = {}) => esc(t(key)).replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m);
/** One / many phrasing: `one` is a complete key without a number (e.g. '1 reference'). */
export const count = (n, one, many) => (n === 1 ? t(one) : t(many, { n }));

/** Name used in activity entries, toasts and confirmations: the title, else the custom text, else the first author. */
export function referenceName(ref) {
  const clip = (s) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v.length > 70 ? `${v.slice(0, 67)}…` : v; };
  return clip(ref?.title) || clip(ref?.custom) || clip(String(ref?.authors ?? '').split('\n')[0]) || t('Untitled reference');
}

/** Formatted entry as HTML: italic runs in <em>. `mark` can post-process each escaped run (search highlighting). */
export function runsHTML(runs, mark = esc) {
  return runs.map((r) => (r.italic ? `<em>${mark(r.text)}</em>` : mark(r.text))).join('');
}

// Labels are listed as literal keys so every one is translated through t().
const FIELD_LABEL = {
  authors: () => t('Authors'), title: () => t('Title'), editors: () => t('Editors'), publisher: () => t('Publisher'),
  place: () => t('Place'), year: () => t('Year'), month: () => t('Month'), volume: () => t('Volume'), issue: () => t('Issue / number'),
  pages: () => t('Pages'), edition: () => t('Edition'), doi: () => t('DOI'), url: () => t('URL'), accessed: () => t('Accessed'),
  note: () => t('Note'),
};
const FIELD_PLACEHOLDER = {
  year: () => t('e.g. 2024'), month: () => t('e.g. March'), pages: () => t('e.g. 12–25'), doi: () => t('e.g. 10.1109/ACCESS.2024.123456'),
  url: () => t('https://…'), accessed: () => t('e.g. 15 March 2026'), edition: () => t('e.g. 2'), volume: () => t('e.g. 12'), issue: () => t('e.g. 3'),
};
/** Fields that use the full width of the form. */
const WIDE = new Set(['authors', 'title', 'editors', 'container', 'url', 'note']);

const fieldLabel = (type, field) => {
  if (field === 'container') return t(typeInfo(type).container || 'Published in');
  if (field === 'note' && type === 'thesis') return t('Type of work');
  return FIELD_LABEL[field]();
};
const fieldPlaceholder = (type, field) => {
  if (field === 'note' && type === 'thesis') return t('e.g. B.S. project report');
  if (field === 'note' && type === 'report') return t('e.g. Rep. 23, Standard no. 5');
  return FIELD_PLACEHOLDER[field]?.() || '';
};
const fieldHint = (type, field) => {
  if (field === 'authors') return t('One author per line, for example “Ahmed D. Alharthi” or “Alharthi, Ahmed”. For an organisation use {example}.', { example: isRTL ? '\u2066{World Health Organization}\u2069' : '{World Health Organization}' });
  if (field === 'editors') return t('One editor per line, in the same format as the authors.');
  if (field === 'note' && type === 'thesis') return t('Optional. Shown before the university, for example “M.S. thesis”.');
  return '';
};

/** Add or edit a reference. Resolves nothing: use `onSaved`. Returns the modal. */
export function openReferenceDialog(store, { ref = null, values = null, onSaved } = {}) {
  const project = () => store.project;
  const state = { ...createReference(), ...(values || {}), ...(ref ? { ...ref } : {}) };
  const isNew = !ref;
  const styleId = () => project().settings?.references?.style || 'ieee';

  const body = document.createElement('form');
  body.className = 'ref-form';
  body.noValidate = true;
  body.innerHTML = `
    <div class="field ref-type">
      <label for="rf-type">${t('Type')}</label>
      <select class="select" id="rf-type" name="type">${REFERENCE_TYPES.map((tp) => `<option value="${tp.id}" ${tp.id === state.type ? 'selected' : ''}>${esc(t(tp.label))}</option>`).join('')}</select>
    </div>
    <div class="ref-fields" data-region="fields"></div>
    <div class="field ref-custom-field">
      <label for="rf-custom">${t('Custom text (optional)')}</label>
      <textarea class="textarea" id="rf-custom" name="custom" rows="3" dir="auto" placeholder="${esc(t('Write the whole entry yourself, exactly as it should appear'))}"></textarea>
      <div class="hint">${esc(t('Optional. When this is filled in, it replaces the formatted text above exactly as written.'))}</div>
    </div>
    <div class="ref-preview" aria-live="polite">
      <div class="ref-preview-head"><span>${t('Preview')}</span><span class="badge" data-region="style"></span></div>
      <div class="ref-preview-body" data-region="preview" dir="auto"></div>
    </div>
    <button type="submit" hidden></button>`;
  const fieldsEl = body.querySelector('[data-region="fields"]');
  const previewEl = body.querySelector('[data-region="preview"]');
  body.querySelector('[data-region="style"]').textContent = styleId() === 'compact' ? t('Compact') : 'IEEE';
  body.querySelector('[name="custom"]').value = state.custom;

  let firstRender = true;
  const renderFields = () => {
    const info = typeInfo(state.type);
    fieldsEl.innerHTML = info.fields.map((f) => {
      const id = `rf-${f}`;
      const label = fieldLabel(state.type, f);
      const hint = fieldHint(state.type, f);
      const control = f === 'authors' || f === 'editors'
        ? `<textarea class="textarea" id="${id}" name="${f}" rows="${f === 'authors' ? 3 : 2}" dir="auto" ${f === 'authors' && firstRender ? 'autofocus' : ''} placeholder="${esc(f === 'authors' ? 'Ahmed D. Alharthi\nSmith, John' : '')}">${esc(state[f])}</textarea>`
        : `<input class="input" id="${id}" name="${f}" type="text" dir="auto" value="${esc(state[f])}" placeholder="${esc(fieldPlaceholder(state.type, f))}" autocomplete="off">`;
      return `<div class="field ${WIDE.has(f) ? 'wide' : ''}">
        <label for="${id}">${esc(label)}${f === 'title' ? ' <span class="req">*</span>' : ''}</label>
        ${control}
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
        <div class="error-text" data-error="${f}"></div>
      </div>`;
    }).join('');
    firstRender = false;
  };

  const candidate = () => ({ ...state, id: ref?.id || state.id });
  const hasContent = () => !!(String(state.title).trim() || String(state.authors).trim() || String(state.custom).trim());
  const renderPreview = () => {
    previewEl.classList.toggle('empty', !hasContent());
    previewEl.innerHTML = hasContent()
      ? runsHTML(formatReferenceRuns(candidate(), styleId()))
      : esc(t('Fill in the fields above to see the formatted reference here.'));
  };

  renderFields();
  renderPreview();

  const clearError = (name) => {
    const el = body.querySelector(`[data-error="${name}"]`);
    if (el) el.textContent = '';
    body.querySelector(`[name="${name}"]`)?.classList.remove('invalid');
  };
  const showError = (name, message) => {
    const el = body.querySelector(`[data-error="${name}"]`);
    if (el) el.textContent = message;
    const input = body.querySelector(`[name="${name}"]`);
    input?.classList.add('invalid');
    input?.focus();
  };

  body.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.getAttribute('name') || el.getAttribute('name') === 'type') return;
    state[el.getAttribute('name')] = el.value;
    if (el.getAttribute('name') === 'title' || el.getAttribute('name') === 'custom') clearError('title');
    renderPreview();
  });
  body.querySelector('[name="type"]').addEventListener('change', (e) => {
    state.type = e.target.value;
    renderFields();
    renderPreview();
  });

  const trimmed = () => {
    const out = {};
    for (const key of Object.keys(createReference())) {
      if (key === 'id' || key === 'createdAt') continue;
      // authors / editors: one name per line, no blank lines
      out[key] = String(state[key] ?? '').split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
    }
    out.type = state.type;
    return out;
  };

  const save = () => {
    const values_ = trimmed();
    if (!values_.title && !values_.custom) { showError('title', t('Enter a title or custom text.')); return; }
    const dup = findDuplicateReference(project().references, { ...values_, id: ref?.id || '' });
    if (dup) { showError('title', t('This reference already exists.')); return; }
    const name = referenceName(values_);
    let saved;
    if (isNew) {
      saved = createReference(values_);
      store.update((p) => { p.references.push(saved); }, { activity: { text: `Added reference “${name}”`, kind: 'create', targetId: saved.id } });
    } else {
      store.update((p) => {
        saved = p.references.find((r) => r.id === ref.id);
        if (saved) Object.assign(saved, values_);
      }, { activity: { text: `Updated reference “${name}”`, kind: 'edit', targetId: ref.id } });
      if (!saved) return;
    }
    modal.close();
    toast(isNew ? t('Added “{name}”.', { name: iso(name) }) : t('Updated “{name}”.', { name: iso(name) }), { type: 'success' });
    onSaved?.(saved, { isNew });
  };

  body.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName === 'TEXTAREA') { e.preventDefault(); save(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
  });

  const modal = openModal({
    title: isNew ? t('Add reference') : t('Edit reference'),
    subtitle: t('Fill in the details; the entry is formatted automatically in your chosen style.'),
    size: 'lg',
    className: 'ref-modal',
    body,
    footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-save>${esc(isNew ? t('Add reference') : t('Save changes'))}</button>`,
  });
  modal.$('[data-save]').addEventListener('click', save);
  return modal;
}

/** Paste BibTeX or pick a .bib file, see how many entries were found, import them (duplicates are skipped). */
export function openBibTeXImport(store, { initialText = '', onDone } = {}) {
  const body = document.createElement('div');
  body.className = 'ref-import';
  body.innerHTML = `
    <p class="ref-import-help">${esc(t('In Google Scholar choose Cite → BibTeX (or export from Zotero, IEEE Xplore or ACM), then paste the entries here.'))}</p>
    <div class="field">
      <textarea class="textarea ref-bib" rows="9" dir="ltr" spellcheck="false" aria-label="${esc(t('BibTeX entries'))}" placeholder="@article{key,&#10;  author = {Ahmed D. Alharthi and John Smith},&#10;  title = {…},&#10;  journal = {…},&#10;  year = {2024}&#10;}"></textarea>
    </div>
    <div class="ref-import-bar">
      <button type="button" class="btn btn-sm" data-pick>${icon('upload')}${t('Choose .bib file')}</button>
      <span class="ref-import-summary" data-region="summary" aria-live="polite"></span>
    </div>
    <div class="ref-import-preview" data-region="preview"></div>`;
  const ta = body.querySelector('textarea');
  const summary = body.querySelector('[data-region="summary"]');
  const preview = body.querySelector('[data-region="preview"]');
  let plan = { fresh: [], skipped: 0, found: 0 };

  const analyse = () => {
    const found = parseBibTeX(ta.value);
    const known = [...store.project.references];
    const fresh = []; let skipped = 0;
    for (const partial of found) {
      const candidate = createReference(partial);
      if ((!candidate.title && !candidate.custom && !candidate.authors) || findDuplicateReference(known, candidate)) { skipped += 1; continue; }
      known.push(candidate);
      fresh.push(candidate);
    }
    return { fresh, skipped, found: found.length };
  };

  const importBtn = () => modal.$('[data-import]');
  const update = () => {
    plan = analyse();
    const text = ta.value.trim();
    if (!text) summary.innerHTML = `<span class="muted">${esc(t('Paste BibTeX above or choose a file to see what will be imported.'))}</span>`;
    else if (!plan.found) summary.innerHTML = `<span class="ps-bad">${esc(t('No BibTeX entries found.'))}</span>`;
    else {
      const found = count(plan.found, '1 entry found', '{n} entries found');
      summary.innerHTML = `<span class="ps-new">${esc(found)}</span>${plan.skipped ? `${esc(t(', '))}<span class="ps-dup">${esc(count(plan.skipped, '1 duplicate will be skipped', '{n} duplicates will be skipped'))}</span>` : ''}`;
    }
    const style = store.project.settings?.references?.style || 'ieee';
    preview.innerHTML = plan.fresh.length
      ? `<ol class="ref-import-list">${plan.fresh.slice(0, 5).map((r) => `<li dir="auto">${runsHTML(formatReferenceRuns(r, style))}</li>`).join('')}</ol>${plan.fresh.length > 5 ? `<div class="muted">${esc(t('and {n} more…', { n: plan.fresh.length - 5 }))}</div>` : ''}`
      : '';
    const btn = importBtn();
    if (btn) {
      btn.disabled = plan.fresh.length === 0;
      btn.textContent = plan.fresh.length ? count(plan.fresh.length, 'Import 1 reference', 'Import {n} references') : t('Import');
    }
  };

  const modal = openModal({
    title: t('Import BibTeX'),
    subtitle: t('Add many references at once. Entries that are already in your list are skipped.'),
    size: 'lg',
    className: 'ref-modal',
    body,
    footer: `<button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" data-import disabled>${t('Import')}</button>`,
  });
  ta.value = initialText;
  ta.addEventListener('input', update);
  body.querySelector('[data-pick]').addEventListener('click', async () => {
    const file = await pickFile('.bib,.bibtex,.txt,text/plain');
    if (!file) return;
    try { ta.value = await readFileAsText(file); update(); } catch (err) { toast(err?.message || t('Could not read the file.'), { type: 'error' }); }
  });
  modal.$('[data-import]').addEventListener('click', () => {
    const { fresh, skipped } = plan;
    if (!fresh.length) return;
    store.update((p) => { for (const r of fresh) p.references.push(r); }, { activity: fresh.length === 1 ? 'Imported 1 reference' : `Imported ${fresh.length} references` });
    modal.close();
    const done = count(fresh.length, '1 reference imported', '{n} references imported');
    const dups = skipped ? `${t(', ')}${count(skipped, '1 duplicate skipped', '{n} duplicates skipped')}` : '';
    toast(`${done}${dups}`, { type: 'success' });
    onDone?.({ added: fresh, skipped });
  });
  update();
  return modal;
}
