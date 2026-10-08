// Reusable rich body editor.
//
// Body format (stored as a plain string): one paragraph per line, "- " prefix = bullet,
// cross references as {{ref:fig|tab|sec|ch|cite:<id>}} tokens ("cite" = a bibliography citation, shown as [3]). In the editor the tokens are
// atomic chips whose labels follow the live numbering ("Figure 3" → "Figure 4" when a
// figure is inserted before it).
//
// Placement lines: a line that holds only {{figure:<id>}} or {{table:<id>}} puts that figure/table at exactly
// that spot. When the editor is given an `ownerId` (the chapter/section whose text it edits) such lines are shown
// as full-width, non-editable blocks (thumbnail + live "Figure 3: Title" + buttons) and the toolbar can insert
// them. Editors without an ownerId (front-matter pages) treat those lines as ordinary text.
//
// DOM model (flat): text nodes, chips (span[data-ref]), <br>, and placement blocks (div.be-block[data-place]).
// A block owns its own line: the text node before it normally ends with "\n", the text after it starts on the next
// line. Text nodes holding only U+200B ("anchors") give the caret somewhere to go before/after a block at the ends of
// the text; the serializer ignores them.
//
// Options: `hint` = writing guidance from the template (shown above the text while it is empty; never part of the body),
// `wordLimit` = shows "n / limit words" and turns warning-coloured when over.
//
//   const editor = createBodyEditor({ store, getProject: () => store.project, value, onChange, placeholder, ownerId, hint, wordLimit });
//   container.append(editor.el);  editor.refresh();  editor.destroy();
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { getNumbering, captionText } from '../core/numbering.js';
import { createAcronym, findNode } from '../core/model.js';
import {
  REF_RE, PLACE_RE, makeRef, makePlacement, refInfo, resolveHTML, resolveText, findPlainReferences, linkPlainReferences,
  placementsIn, removePlacements, moveLine,
} from '../core/references.js';
import { renderThumbnail } from '../figures/render.js';
import { scanText } from '../acronyms/detection.js';
import { href } from '../app/routes.js';
import { t } from '../i18n/index.js';
import { referenceShortLabel } from '../core/bibliography.js';
import { countLabel, countWords, isolate, LIST_SEP } from './outline-ops.js';

const REF_ATTR = /^(fig|tab|sec|ch|cite):([A-Za-z0-9_-]+)$/;
const PLACE_ATTR = /^(figure|table):([A-Za-z0-9_-]+)$/;
const ANCHOR = '\u200b';
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR']);
const EMIT_DELAY = 400;
const BULLET_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="17" r="1.3"/><path d="M10 7h10"/><path d="M10 12h10"/><path d="M10 17h10"/></svg>';

let activePicker = null; // only one reference picker is open at a time

const trimEnd = (s) => String(s || '').replace(/\n+$/, '');

function chipToken(node) {
  const ref = node.getAttribute?.('data-ref');
  return ref && REF_ATTR.test(ref) ? `{{ref:${ref}}}` : null;
}

function placeToken(node) {
  const place = node.getAttribute?.('data-place');
  return place && PLACE_ATTR.test(place) ? `{{${place}}}` : null;
}

const isBlock = (node) => !!node && node.nodeType === 1 && !!placeToken(node);
const isAnchor = (node) => !!node && node.nodeType === 3 && node.nodeValue === ANCHOR;
const cleanText = (text) => String(text).replace(/\u00a0/g, ' ').replace(/[\u200b\ufeff]/g, '').replace(/\r\n?/g, '\n');
const lineCount = (text) => (text.match(/\n/g) || []).length;

/**
 * DOM → body string. Text nodes as-is, chips → tokens, placement blocks → their token on a line of its own,
 * <br> → newline, blocks → newline separated. When `spans` is an array it receives one
 * { node, start, end } per top-level node (offsets into the returned string).
 */
export function serializeNodes(root, spans) {
  let out = '';
  const endLine = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const visit = (node, top) => {
    const start = out.length;
    if (node.nodeType === 3) {
      if (!isAnchor(node)) out += cleanText(node.nodeValue);
    } else if (node.nodeType === 1) {
      const chip = chipToken(node);
      const place = placeToken(node);
      if (chip) out += chip;
      else if (place) { endLine(); out += `${place}\n`; }
      else if (node.nodeName === 'BR') out += '\n';
      else if (BLOCK_TAGS.has(node.nodeName)) { endLine(); node.childNodes.forEach((child) => visit(child, false)); endLine(); }
      else node.childNodes.forEach((child) => visit(child, false));
    }
    if (top && spans) spans.push({ node, start, end: out.length });
  };
  root.childNodes.forEach((node) => visit(node, true));
  return out;
}

const wordCount = countWords;

export function createBodyEditor({
  store, getProject = () => store.project, value = '', onChange, placeholder = '', label = t('Text'), minHeight, ownerId = null,
  hint = '', wordLimit = 0,
} = {}) {
  const placementsOn = !!ownerId; // placement lines become blocks, and the toolbar can insert them
  const el = document.createElement('div');
  el.className = 'be';
  if (minHeight) el.style.setProperty('--be-min', typeof minHeight === 'number' ? `${minHeight}px` : minHeight);
  el.innerHTML = `
    <div class="be-toolbar" role="toolbar" aria-label="${esc(t('{label} tools', { label }))}">
      <button type="button" class="be-btn" data-be="ref" aria-haspopup="dialog" data-tip="${t('Insert a live cross reference')}">${icon('link')}<span>${t('Insert reference')}</span></button>
      <button type="button" class="be-btn be-btn-cite" data-be="cite" aria-haspopup="dialog" data-tip="${esc(t('Cite a reference from your bibliography'))}">${icon('quote')}<span>${t('Cite')}</span></button>
      <button type="button" class="be-btn" data-be="bullet" data-tip="${t('Toggle bullet list for the current line')}">${BULLET_SVG}<span>${t('Bullet')}</span></button>${placementsOn ? `
      <span class="be-sep" role="separator" aria-orientation="vertical"></span>
      <button type="button" class="be-btn be-btn-place" data-be="figure" aria-haspopup="dialog" aria-label="${esc(t('Insert figure here'))}" data-tip="${esc(t('Put a figure at the cursor position'))}">${icon('figure')}<span>${t('Insert figure here')}</span></button>
      <button type="button" class="be-btn be-btn-place" data-be="table" aria-haspopup="dialog" aria-label="${esc(t('Insert table here'))}" data-tip="${esc(t('Put a table at the cursor position'))}">${icon('table')}<span>${t('Insert table here')}</span></button>` : ''}
      <span class="be-meta"></span>${hint ? `
      <button type="button" class="be-btn be-btn-guide" data-be="guide" aria-pressed="false" data-tip="${esc(t('Show or hide the writing guidance'))}">${icon('info')}<span>${t('Guidance')}</span></button>` : ''}
    </div>${hint ? `
    <div class="be-guide" hidden>
      <span class="be-guide-ico">${icon('info')}</span>
      <div class="be-guide-body"><div class="be-guide-title">${t('Template guidance')}</div><div class="be-guide-text" dir="auto">${esc(hint)}</div></div>
    </div>` : ''}
    <div class="be-surface" role="textbox" aria-multiline="true" aria-label="${esc(label)}" spellcheck="true" data-placeholder="${esc(placeholder)}"></div>
    <div class="be-hints" hidden></div>`;
  const surface = el.querySelector('.be-surface');
  const hintsEl = el.querySelector('.be-hints');
  const metaEl = el.querySelector('.be-meta');
  const toolbar = el.querySelector('.be-toolbar');
  const guideEl = el.querySelector('.be-guide');
  const guideBtn = el.querySelector('[data-be="guide"]');

  try { surface.contentEditable = 'plaintext-only'; } catch { /* unsupported → fall back */ }
  if (surface.contentEditable !== 'plaintext-only') surface.contentEditable = 'true';

  const disposers = [];
  const listen = (target, type, handler, opts) => {
    target.addEventListener(type, handler, opts);
    disposers.push(() => target.removeEventListener(type, handler, opts));
  };
  const project = () => getProject();

  let timer = null;
  let lastEmitted = trimEnd(value);
  let savedRange = null;
  let destroyed = false;
  let refreshFrame = 0;
  let lastHintHTML = '';

  const read = () => trimEnd(serializeNodes(surface));
  const rawRead = () => serializeNodes(surface);

  const chipHTML = (text) => resolveHTML(project(), text, { chipClass: 'ref-chip', editable: true });
  const htmlFragment = (html) => { const tpl = document.createElement('template'); tpl.innerHTML = html; return tpl.content; };

  function renderDom(body) {
    const text = trimEnd(body);
    if (!placementsOn || placementsIn(text).length === 0) { surface.innerHTML = chipHTML(text); return; }
    // Placement lines become blocks; the lines between them stay one text node each (see the DOM model above).
    const frag = document.createDocumentFragment();
    let group = [];
    const flushGroup = (beforeBlock) => {
      if (!group.length) return;
      frag.append(htmlFragment(chipHTML(group.join('\n') + (beforeBlock ? '\n' : ''))));
      group = [];
    };
    for (const line of text.split('\n')) {
      const m = PLACE_RE.exec(line);
      if (m) { flushGroup(true); frag.append(makeBlock(m[1], m[2])); } else group.push(line);
    }
    flushGroup(false);
    surface.replaceChildren(frag);
    ensureAnchors();
    updateBlocks();
  }

  /** Somewhere for the caret to go before a first / after a last block. Pure-anchor content is cleared. */
  function ensureAnchors() {
    if (!placementsOn) return;
    const first = surface.firstChild;
    if (!first) return;
    if (!surface.querySelector(':scope > .be-block')) {
      if ([...surface.childNodes].every(isAnchor)) surface.textContent = '';
      return;
    }
    if (isBlock(first)) surface.insertBefore(document.createTextNode(ANCHOR), first);
    if (isBlock(surface.lastChild)) surface.append(document.createTextNode(ANCHOR));
  }

  // ----- placement blocks ---------------------------------------------------
  function makeBlock(kind, id) {
    const block = document.createElement('div');
    block.className = 'be-block';
    block.contentEditable = 'false';
    block.tabIndex = 0;
    block.setAttribute('role', 'group');
    block.setAttribute('data-place', `${kind}:${id}`);
    block.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Enter Delete');
    return block;
  }

  const thumbHTML = (item) => { try { return renderThumbnail(item); } catch { return icon('figure'); } };

  /** Paint one block from the live project: caption with its current number, thumbnail, state. */
  function updateBlock(block, duplicate) {
    const [kind, id] = block.getAttribute('data-place').split(':');
    const p = project();
    const n = getNumbering(p);
    const item = (kind === 'figure' ? p.figures : p.tables).find((x) => x.id === id) || null;
    const info = (kind === 'figure' ? n.figures : n.tables).get(id) || null;
    const state = !item ? 'missing' : duplicate ? 'duplicate' : 'ok';
    const caption = item ? captionText(p, kind, item) : '';
    const sig = `${state}|${caption}|${kind === 'figure' && item ? `${item.updatedAt}|${item.diagram?.elements?.length}` : ''}`;
    if (block.dataset.sig === sig) return;
    block.dataset.sig = sig;
    block.className = `be-block is-${state}`;
    const kindWord = kind === 'figure' ? t('Figure') : t('Table');
    const lead = info && caption.startsWith(info.label) ? info.label : '';
    const rest = caption.slice(lead.length);
    block.setAttribute('aria-label', state === 'missing' ? (kind === 'figure' ? t('Figure not found') : t('Table not found')) : `${kindWord}: ${caption}`);
    const media = state === 'missing' ? `<span class="be-block-media be-block-icon">${icon('alert')}</span>`
      : kind === 'figure' ? `<span class="be-block-media thumb">${thumbHTML(item)}</span>`
        : `<span class="be-block-media be-block-icon">${icon('table')}</span>`;
    const eyebrow = state === 'missing' ? t('Missing') : state === 'duplicate' ? t('Repeated') : kindWord;
    const main = state === 'missing' ? (kind === 'figure' ? t('Figure not found') : t('Table not found'))
      : `<strong>${esc(lead)}</strong>${esc(rest)}`;
    const note = state === 'missing' ? `<span class="be-block-note">${t('It was deleted. Remove this line.')}</span>`
      : state === 'duplicate' ? `<span class="be-block-note">${t('Already placed earlier, so this copy is ignored.')}</span>` : '';
    const btn = (act, ic, text, kbd) => `<button type="button" class="be-bk" data-bk="${act}" tabindex="-1" aria-label="${esc(text)}" data-tip="${esc(text)}"${kbd ? ` data-kbd="${kbd}"` : ''}>${icon(ic)}</button>`;
    block.innerHTML = `${media}
      <span class="be-block-text"><span class="be-block-eyebrow">${esc(eyebrow)}</span><span class="be-block-caption" dir="auto">${main}</span>${note}</span>
      <span class="be-block-actions">${state === 'missing' ? '' : btn('open', 'edit', kind === 'figure' ? t('Edit figure') : t('Edit table'))}${btn('up', 'arrowUp', t('Move up'), 'Alt ↑')}${btn('down', 'arrowDown', t('Move down'), 'Alt ↓')}${btn('remove', 'x', t('Remove from text'))}</span>`;
  }

  /** Refresh every block (live numbers, deleted items, duplicate placements). */
  function updateBlocks() {
    if (!placementsOn) return;
    const blocks = surface.querySelectorAll(':scope > .be-block');
    if (!blocks.length) return;
    const n = getNumbering(project());
    const seen = new Set();
    blocks.forEach((block) => {
      const key = block.getAttribute('data-place');
      const [kind, id] = key.split(':');
      const claim = (kind === 'figure' ? n.figures : n.tables).get(id)?.placement;
      // A copy is ignored when the same item was already placed earlier in this text, or in a body before this one.
      const duplicate = seen.has(key) || (!!claim && claim.ownerId !== ownerId);
      seen.add(key);
      updateBlock(block, duplicate);
    });
  }

  // ----- change emission ------------------------------------------------
  function flush() {
    if (timer === null) return;
    clearTimeout(timer); timer = null;
    const body = read();
    if (body === lastEmitted) return;
    lastEmitted = body;
    onChange?.(body);
  }
  function scheduleEmit() {
    clearTimeout(timer);
    timer = setTimeout(flush, EMIT_DELAY);
    updateMeta();
  }
  function emitNow() { scheduleEmit(); flush(); }

  // ----- caret helpers (flat DOM: text nodes + chips) -------------------
  const inSurface = (node) => !!node && surface.contains(node);

  function offsetOf(container, offset) {
    const r = document.createRange();
    r.selectNodeContents(surface);
    r.setEnd(container, offset);
    const tmp = document.createElement('div');
    tmp.append(r.cloneContents());
    return serializeNodes(tmp).length;
  }

  function pointAtOffset(target) {
    const spans = [];
    serializeNodes(surface, spans);
    for (let i = 0; i < spans.length; i += 1) {
      const { node, start } = spans[i];
      if (node.nodeType === 3) {
        if (isAnchor(node)) { if (target <= start) return { node, offset: 1 }; continue; }
        if (target <= start + node.nodeValue.length) return { node, offset: Math.max(0, target - start) };
      } else if (target <= start) return { node: surface, offset: i };
    }
    return { node: surface, offset: surface.childNodes.length };
  }

  function placeCaret(offset) {
    const pt = pointAtOffset(offset);
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(pt.node, pt.offset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  }

  function saveRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && inSurface(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }

  function currentRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && inSurface(sel.anchorNode)) return sel.getRangeAt(0);
    if (savedRange && inSurface(savedRange.commonAncestorContainer)) return savedRange;
    const r = document.createRange();
    r.selectNodeContents(surface);
    r.collapse(false);
    return r;
  }

  function focusAtEnd() {
    surface.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(surface);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    savedRange = r.cloneRange();
  }

  function restoreSelection() {
    // Read the target range first: focusing a contenteditable moves the caret to its start.
    const r = currentRange().cloneRange();
    surface.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    return r;
  }

  // ----- chips ------------------------------------------------------------
  function makeChip(kind, id) {
    const tpl = document.createElement('template');
    tpl.innerHTML = resolveHTML(project(), makeRef(kind, id), { chipClass: 'ref-chip', editable: true });
    return tpl.content.firstElementChild;
  }

  function insertChip(kind, id) {
    const r = restoreSelection();
    r.deleteContents();
    const chip = makeChip(kind, id);
    r.insertNode(chip);
    // Friendly spacing around the chip.
    const prev = chip.previousSibling;
    const prevText = prev && prev.nodeType === 3 ? prev.nodeValue : '';
    if (prevText && !/[\s([{"'“‘-]$/.test(prevText)) chip.before(document.createTextNode(' '));
    const next = chip.nextSibling;
    const nextText = next && next.nodeType === 3 ? next.nodeValue : '';
    let after = chip;
    if (!/^[\s.,;:!?)\]}"'”’]/.test(nextText)) { const sp = document.createTextNode(' '); chip.after(sp); after = sp; }
    const range = document.createRange();
    if (after === chip) range.setStartAfter(chip); else range.setStart(after, after.nodeValue.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    savedRange = range.cloneRange();
    emitNow();
    updateHints();
  }

  function updateChips() {
    const p = project();
    surface.querySelectorAll('.ref-chip[data-ref]').forEach((chip) => {
      const m = REF_ATTR.exec(chip.getAttribute('data-ref'));
      if (!m) return;
      const info = refInfo(p, m[1], m[2]);
      if (chip.textContent !== info.text) chip.textContent = info.text;
      chip.classList.toggle('broken', !info.ok);
      if (chip.title !== info.title) chip.title = info.title;
    });
  }

  // ----- hints --------------------------------------------------------------
  function updateMeta() {
    const words = wordCount(resolveText(project(), serializeNodes(surface)));
    if (wordLimit) {
      metaEl.textContent = t('{n} / {limit} words', { n: words, limit: wordLimit });
      metaEl.classList.toggle('over', words > wordLimit);
      metaEl.title = words > wordLimit ? t('{n} words over the limit', { n: words - wordLimit }) : '';
    } else metaEl.textContent = words ? countLabel(words, 'word') : '';
    updateGuide();
  }

  // Template guidance: visible while the text is empty (or when the Guidance button asks for it). Never written into the body.
  let guideOverride = null; // null = automatic (visible while empty), true / false = chosen with the button
  let guideWasEmpty = null;
  function updateGuide() {
    if (!guideEl) return;
    const empty = !surface.querySelector('[data-ref], [data-place]') && !surface.textContent.replace(/[\u200b\s]/g, '');
    if (empty !== guideWasEmpty) { guideWasEmpty = empty; guideOverride = null; }
    const visible = guideOverride ?? empty;
    guideEl.hidden = !visible;
    guideBtn?.setAttribute('aria-pressed', String(visible));
    guideBtn?.classList.toggle('active', visible && !empty);
  }

  function updateHints() {
    const p = project();
    if (!p) return;
    const body = read();
    const rows = [];

    const plain = findPlainReferences(p, body);
    if (plain.length) {
      const labels = [...new Set(plain.map((x) => x.match))];
      const shown = labels.slice(0, 4).map((l) => `<bdi>${esc(l)}</bdi>`).join(LIST_SEP) + (labels.length > 4 ? `${LIST_SEP}${t('+{n} more', { n: labels.length - 4 })}` : '');
      const linkText = t(plain.length === 1 ? '1 plain reference can be linked so they update automatically: {labels}' : '{n} plain references can be linked so they update automatically: {labels}', { n: plain.length, labels: `<strong>${shown}</strong>` });
      rows.push(`<div class="be-hint be-hint-link">${icon('link')}<span class="be-hint-text">${linkText}</span><button type="button" class="btn btn-sm btn-soft" data-hint="link">${t('Link all')}</button></div>`);
    }

    const known = new Set((p.acronyms || []).map((a) => String(a.acronym).trim().toUpperCase()));
    const dismissed = new Set((p.dismissedSuggestions || []).map((a) => String(a).trim().toUpperCase()));
    const seen = new Set();
    const suggestions = [];
    for (const s of scanText(resolveText(p, body))) {
      const key = s.acronym.toUpperCase();
      if (known.has(key) || dismissed.has(key) || seen.has(key)) continue;
      seen.add(key); suggestions.push(s);
    }
    for (const s of suggestions.slice(0, 3)) {
      rows.push(`<div class="be-hint be-hint-acronym">${icon('sparkles')}<span class="be-hint-text">${t('Add {acronym} ({meaning}) to Acronyms?', { acronym: `<strong><bdi>${esc(s.acronym)}</bdi></strong>`, meaning: `<bdi>${esc(s.meaning)}</bdi>` })}</span>
        <span class="be-hint-actions"><button type="button" class="btn btn-sm btn-soft" data-hint="acr-add" data-acr="${esc(s.acronym)}" data-meaning="${esc(s.meaning)}">${t('Add')}</button>
        <button type="button" class="btn btn-sm btn-ghost" data-hint="acr-dismiss" data-acr="${esc(s.acronym)}">${t('Dismiss')}</button></span></div>`);
    }
    if (suggestions.length > 3) rows.push(`<div class="be-hint-more">${t(suggestions.length - 3 === 1 ? '+1 more acronym suggestion' : '+{n} more acronym suggestions', { n: suggestions.length - 3 })}</div>`);

    const broken = surface.querySelectorAll('.ref-chip.broken').length;
    if (broken) {
      rows.push(`<div class="be-hint be-hint-broken">${icon('alert')}<span class="be-hint-text">${t(broken === 1 ? '1 broken reference — the target was deleted. Remove it or insert a new reference.' : '{n} broken references — the target was deleted. Remove them or insert a new reference.', { n: broken })}</span><button type="button" class="btn btn-sm btn-ghost" data-hint="remove-broken">${t('Remove')}</button></div>`);
    }

    const html = rows.join('');
    if (html === lastHintHTML) return;
    lastHintHTML = html;
    hintsEl.innerHTML = html;
    hintsEl.hidden = !html;
  }

  // ----- refresh (store changed) ---------------------------------------------
  function refresh() {
    if (destroyed) return;
    updateChips();
    updateBlocks();
    updateMeta();
    updateHints();
  }
  const offChange = store?.on?.('change', () => {
    if (refreshFrame) return;
    refreshFrame = requestAnimationFrame(() => { refreshFrame = 0; refresh(); });
  });

  // ----- value --------------------------------------------------------------
  function setValue(next) {
    const body = trimEnd(next);
    if (body === read()) { lastEmitted = body; return; }
    const hadFocus = document.activeElement === surface;
    renderDom(body);
    lastEmitted = body;
    if (hadFocus) focusAtEnd();
    updateMeta(); updateHints();
  }

  /** Adopt a body changed elsewhere (another editor moved a figure here, a broken line was removed …); never overwrites unsent typing. */
  function sync(body) {
    if (destroyed || timer !== null) return;
    const next = trimEnd(body);
    if (next === lastEmitted) return;
    const sel = window.getSelection();
    const pos = document.activeElement === surface && sel.rangeCount && inSurface(sel.anchorNode) ? offsetOf(sel.anchorNode, sel.anchorOffset) : null;
    renderDom(next);
    lastEmitted = next;
    if (pos !== null) placeCaret(Math.min(pos, rawRead().length));
    updateMeta(); updateHints();
  }

  function rerenderKeepCaret() {
    const sel = window.getSelection();
    const pos = sel.rangeCount && inSurface(sel.anchorNode) ? offsetOf(sel.anchorNode, sel.anchorOffset) : null;
    renderDom(rawRead());
    if (pos !== null) placeCaret(pos);
  }

  // ----- editing behaviour -----------------------------------------------------
  function insertText(text) {
    if (!text.includes('\n')) {
      let ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
      if (ok) return;
    }
    // Multi-line text: insert a plain text node so the DOM stays flat (execCommand would create <div> blocks).
    const r = currentRange();
    r.deleteContents();
    const node = document.createTextNode(text);
    r.insertNode(node);
    r.setStartAfter(node); r.collapse(true);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    savedRange = r.cloneRange();
  }

  listen(surface, 'paste', (e) => {
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData)?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    if (!text) return;
    insertText(text);
    if (text.match(REF_RE) || (placementsOn && placementsIn(text).length)) rerenderKeepCaret();
    scheduleEmit();
  });
  // Copying a selection that contains placement blocks puts their tokens (not their captions) on the clipboard.
  const onCopy = (e, cut) => {
    if (!placementsOn) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !inSurface(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const frag = range.cloneContents();
    if (!frag.querySelector('[data-place]')) return;
    const tmp = document.createElement('div');
    tmp.append(frag);
    e.clipboardData.setData('text/plain', trimEnd(serializeNodes(tmp)));
    e.preventDefault();
    if (cut) { range.deleteContents(); ensureAnchors(); scheduleEmit(); updateHints(); }
  };
  listen(surface, 'copy', (e) => onCopy(e, false));
  listen(surface, 'cut', (e) => onCopy(e, true));
  listen(surface, 'dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  listen(surface, 'drop', (e) => { if (e.dataTransfer?.files?.length) e.preventDefault(); });

  /** Text typed into an anchor node: drop the zero-width space and keep the caret where it was. */
  function normalizeAnchors() {
    if (!placementsOn) return;
    const sel = window.getSelection();
    const node = sel.rangeCount ? sel.anchorNode : null;
    if (node && node.nodeType === 3 && inSurface(node) && node.nodeValue.length > 1 && node.nodeValue.includes(ANCHOR)) {
      const offset = sel.anchorOffset;
      const before = (node.nodeValue.slice(0, offset).match(/\u200b/g) || []).length;
      node.nodeValue = node.nodeValue.replace(/\u200b/g, '');
      sel.collapse(node, Math.max(0, offset - before));
    }
    ensureAnchors();
  }

  listen(surface, 'input', (e) => {
    if (!e.isComposing && !surface.textContent && !surface.querySelector('[data-ref]')) surface.innerHTML = '';
    if (!e.isComposing) normalizeAnchors();
    scheduleEmit();
    clearTimeout(hintTimer); hintTimer = setTimeout(updateHints, 250);
    saveRange();
  });
  let hintTimer = null;
  disposers.push(() => clearTimeout(hintTimer));
  listen(surface, 'blur', () => { saveRange(); flush(); });
  listen(surface, 'keyup', saveRange);
  listen(surface, 'mouseup', saveRange);
  listen(surface, 'focus', saveRange);

  // Enter continues a bullet list; Enter on an empty bullet ends it.
  let continueBullet = false;
  listen(surface, 'keydown', (e) => {
    continueBullet = false;
    if (e.target instanceof Element && e.target.closest('.be-block')) return; // keys on a focused block: see onBlockKey
    if (placementsOn && (e.key === 'Backspace' || e.key === 'Delete') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      if (deleteAtBlockSeam(e.key === 'Backspace' ? -1 : 1)) { e.preventDefault(); return; }
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || !inSurface(sel.anchorNode)) return;
    const raw = rawRead();
    const pos = offsetOf(sel.anchorNode, sel.anchorOffset);
    const ls = raw.lastIndexOf('\n', pos - 1) + 1;
    const nl = raw.indexOf('\n', pos);
    const lineEnd = nl === -1 ? raw.length : nl;
    if (!/^- /.test(raw.slice(ls, pos))) return;
    if (raw.slice(ls, lineEnd) === '- ') {
      // Empty bullet: remove the marker instead of adding a line.
      e.preventDefault();
      const a = pointAtOffset(ls); const b = pointAtOffset(ls + 2);
      const r = document.createRange();
      r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
      sel.removeAllRanges(); sel.addRange(r);
      let ok = false;
      try { ok = document.execCommand('delete'); } catch { ok = false; }
      if (!ok) r.deleteContents();
      scheduleEmit();
    } else {
      continueBullet = true; // let the browser add the line, then add the marker
    }
  });
  listen(surface, 'input', () => {
    if (!continueBullet) return;
    continueBullet = false;
    insertText('- ');
  });

  // Chips open their target on double-click (not inside modals).
  listen(surface, 'dblclick', (e) => {
    const block = e.target instanceof Element ? e.target.closest('.be-block') : null;
    if (block) { if (!block.classList.contains('is-missing') && !el.closest('.modal')) openBlockTarget(block); return; }
    const chip = e.target instanceof Element ? e.target.closest('.ref-chip[data-ref]') : null;
    if (!chip || chip.classList.contains('broken') || el.closest('.modal')) return;
    const m = REF_ATTR.exec(chip.getAttribute('data-ref'));
    if (!m) return;
    const pid = project().id;
    flush();
    if (m[1] === 'fig') location.hash = href(pid, 'figures', m[2]);
    else if (m[1] === 'tab') location.hash = href(pid, 'tables', m[2]);
    else if (m[1] === 'cite') location.hash = href(pid, 'references', m[2]);
    else location.hash = href(pid, 'chapters', null, { focus: m[2] });
  });

  // ----- toolbar -----------------------------------------------------------------
  function toggleBullet() {
    const r = restoreSelection();
    const raw = rawRead();
    const a = offsetOf(r.startContainer, r.startOffset);
    const b = offsetOf(r.endContainer, r.endOffset);
    const ls = raw.lastIndexOf('\n', a - 1) + 1;
    let le = raw.indexOf('\n', Math.max(a, b > a ? b - 1 : b));
    if (le === -1) le = raw.length;
    const lines = raw.slice(ls, le).split('\n');
    const nonBlank = lines.filter((l) => l.trim() && !PLACE_RE.test(l));
    const allBullets = nonBlank.length > 0 && nonBlank.every((l) => /^- /.test(l));
    const next = lines.map((l) => {
      if (PLACE_RE.test(l)) return l; // a figure/table line is never a bullet
      if (allBullets) return l.replace(/^- /, '');
      if (!l.trim()) return lines.length === 1 ? '- ' : l;
      return /^- /.test(l) ? l : `- ${l}`;
    }).join('\n');
    const full = raw.slice(0, ls) + next + raw.slice(le);
    renderDom(full);
    placeCaret(ls + next.length);
    emitNow();
    updateHints();
  }

  // ----- placing figures and tables --------------------------------------------
  const itemOf = (kind, id) => (kind === 'figure' ? project().figures : project().tables).find((x) => x.id === id) || null;

  /** Raw text + the line index of every placement block, from one serialisation. */
  function blockLines() {
    const spans = [];
    const raw = serializeNodes(surface, spans);
    const lines = new Map();
    for (const sp of spans) if (isBlock(sp.node)) lines.set(sp.node, lineCount(raw.slice(0, sp.end - 1 - placeToken(sp.node).length)));
    return { raw, lines };
  }

  const blockAtLine = (index) => { for (const [block, line] of blockLines().lines) if (line === index) return block; return null; };

  function focusBlock(block) {
    if (!block) return;
    block.focus({ preventScroll: true });
    block.scrollIntoView({ block: 'nearest' });
  }

  /** Put the caret in a text node (focusing the editor). */
  function caretIn(node, offset) {
    surface.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(node, offset); r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    savedRange = r.cloneRange();
  }

  /** Re-render from a new body, commit it, and focus the block that now sits on `focusLine`. */
  function commitText(body, { focusLine = null } = {}) {
    renderDom(body);
    emitNow();
    updateHints();
    if (focusLine !== null) focusBlock(blockAtLine(focusLine));
  }

  /** Line index for a new line at the caret: before the caret's line when the caret is at its start, otherwise after it. */
  function caretLineIndex(raw) {
    const r = currentRange();
    const pos = offsetOf(r.endContainer, r.endOffset);
    const ls = raw.lastIndexOf('\n', pos - 1) + 1;
    return lineCount(raw.slice(0, ls)) + (pos === ls ? 0 : 1);
  }

  /**
   * Put a figure/table in this text: at the caret (default) or after the last line. The item is assigned to this
   * chapter/section; a placement it has in another text (or elsewhere in this one) moves here.
   */
  function placeItem(kind, id, where = 'caret') {
    const item = itemOf(kind, id);
    if (!placementsOn || !item || !findNode(project(), ownerId)) return false;
    const n = getNumbering(project());
    const claim = (kind === 'figure' ? n.figures : n.tables).get(id)?.placement;
    const elsewhere = claim && claim.ownerId !== ownerId ? claim.ownerId : null;
    flush();
    store.update((proj) => {
      const target = (kind === 'figure' ? proj.figures : proj.tables).find((x) => x.id === id);
      const owner = findNode(proj, ownerId);
      if (!target || !owner) return;
      target.chapterId = owner.kind === 'chapter' ? owner.node.id : owner.chapter.id;
      target.sectionId = owner.kind === 'section' ? owner.node.id : null;
      if (elsewhere) { const other = findNode(proj, elsewhere); if (other) other.node.body = removePlacements(other.node.body, kind, id); }
    }, { activity: t('Placed “{title}” in the text', { title: isolate(item.title) }) });

    const raw = rawRead();
    const lines = raw.split('\n');
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    let at = where === 'end' ? lines.length : Math.min(caretLineIndex(raw), lines.length);
    const kept = lines.filter((line, i) => {
      const m = PLACE_RE.exec(line);
      const same = !!m && m[1] === kind && m[2] === id;
      if (same && i < at) at -= 1;
      return !same;
    });
    kept.splice(at, 0, makePlacement(kind, id));
    commitText(kept.join('\n'), { focusLine: at });
    return true;
  }

  function removeBlock(block) {
    const prev = block.previousSibling; const next = block.nextSibling;
    const prevText = prev && prev.nodeType === 3 && !isAnchor(prev) ? prev : null;
    const nextText = next && next.nodeType === 3 && !isAnchor(next) ? next : null;
    if (prevText && nextText && !prevText.nodeValue.endsWith('\n')) prevText.nodeValue += '\n'; // keep the two lines apart
    block.remove();
    const last = surface.lastChild;
    if (last && last.nodeType === 3 && !isAnchor(last)) last.nodeValue = last.nodeValue.replace(/\n+$/, '');
    ensureAnchors();
    if (nextText?.isConnected) caretIn(nextText, 0);
    else if (prevText?.isConnected) caretIn(prevText, prevText.nodeValue.replace(/\n$/, '').length);
    else surface.focus({ preventScroll: true });
    emitNow();
    updateHints();
  }

  function moveBlock(block, dir) {
    const { raw, lines } = blockLines();
    const res = moveLine(raw, lines.get(block), dir);
    if (res) commitText(res.body, { focusLine: res.line });
  }

  /**
   * Backspace / Delete with the caret right next to a block. The browser would swallow the block together with the
   * line break and glue the two paragraphs together, so: on a blank line the blank line goes; otherwise the block is
   * selected (a second Backspace/Delete then removes it, see onBlockKey). Returns true when the key was handled.
   */
  function deleteAtBlockSeam(dir) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || !inSurface(sel.anchorNode)) return false;
    const node = sel.anchorNode; const offset = sel.anchorOffset;
    let sibling = null; let blankLine = false;
    if (node === surface) sibling = surface.childNodes[dir < 0 ? offset - 1 : offset] || null;
    else if (node.nodeType === 3 && node.parentNode === surface) {
      const text = node.nodeValue;
      if (isAnchor(node)) sibling = dir < 0 ? node.previousSibling : node.nextSibling;
      else if (dir < 0 && offset === 0) { sibling = node.previousSibling; blankLine = text.startsWith('\n'); }
      else if (dir > 0 && /^\n?$/.test(text.slice(offset))) { sibling = node.nextSibling; blankLine = text[offset] === '\n' && (offset === 0 || text[offset - 1] === '\n'); }
    }
    while (sibling && sibling.nodeType === 3 && sibling.nodeValue === '') sibling = dir < 0 ? sibling.previousSibling : sibling.nextSibling;
    if (!isBlock(sibling)) return false;
    if (blankLine) {
      const at = dir < 0 ? 0 : offset;
      node.nodeValue = node.nodeValue.slice(0, at) + node.nodeValue.slice(at + 1);
      caretIn(node, at);
      scheduleEmit();
      return true;
    }
    focusBlock(sibling);
    return true;
  }

  /** Enter on a block: open an empty line below it and put the caret there. */
  function newLineAfter(block) {
    const next = block.nextSibling;
    if (next && next.nodeType === 3 && !isAnchor(next)) { next.nodeValue = `\n${next.nodeValue}`; caretIn(next, 0); scheduleEmit(); return; }
    if (next && isAnchor(next)) { caretIn(next, 1); return; }
    const gap = document.createTextNode('\n');
    block.after(gap);
    caretIn(gap, 0);
    scheduleEmit();
  }

  /** ArrowUp / ArrowDown on a block: step to the neighbouring text or block. */
  function stepFromBlock(block, dir) {
    const sibling = dir < 0 ? block.previousSibling : block.nextSibling;
    if (!sibling) return;
    if (isBlock(sibling)) { focusBlock(sibling); return; }
    if (sibling.nodeType !== 3) return;
    const text = sibling.nodeValue;
    if (dir < 0) caretIn(sibling, isAnchor(sibling) ? 1 : text.replace(/\n$/, '').length);
    else caretIn(sibling, isAnchor(sibling) ? 1 : 0);
  }

  function openBlockTarget(block) {
    const [kind, id] = block.getAttribute('data-place').split(':');
    flush();
    location.hash = href(project().id, kind === 'figure' ? 'figures' : 'tables', id);
  }

  function newItem(kind) {
    const owner = findNode(project(), ownerId);
    flush();
    const query = owner?.kind === 'chapter' ? { new: '1', chapter: ownerId } : { new: '1', section: ownerId };
    location.hash = href(project().id, kind === 'figure' ? 'figures' : 'tables', null, query);
  }

  function onBlockKey(e) {
    const block = e.target instanceof Element ? e.target.closest('.be-block') : null;
    if (!block || e.isComposing) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault(); moveBlock(block, e.key === 'ArrowUp' ? -1 : 1); return;
    }
    if (e.target !== block || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeBlock(block); }
    else if (e.key === 'Enter') { e.preventDefault(); newLineAfter(block); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepFromBlock(block, e.key === 'ArrowUp' ? -1 : 1); }
  }
  listen(surface, 'keydown', onBlockKey);
  listen(surface, 'mousedown', (e) => { if (e.target instanceof Element && e.target.closest('.be-bk')) e.preventDefault(); });
  listen(surface, 'click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('.be-bk') : null;
    const block = btn?.closest('.be-block');
    if (!btn || !block) return;
    const act = btn.dataset.bk;
    if (act === 'up') moveBlock(block, -1);
    else if (act === 'down') moveBlock(block, 1);
    else if (act === 'remove') removeBlock(block);
    else if (act === 'open') openBlockTarget(block);
  });

  /** "New reference…" in the Cite picker: add it in the dialog, then cite it where the caret was. */
  async function newReference() {
    saveRange();
    try {
      const { openReferenceDialog } = await import('../bibliography/reference-dialog.js');
      openReferenceDialog(store, { onSaved: (ref) => { if (!destroyed) insertChip('cite', ref.id); } });
    } catch (err) { console.error(err); }
  }

  // ----- pickers ------------------------------------------------------------------
  function closePicker() { if (activePicker?.owner === api) activePicker.close(); }

  /** mode: 'ref' (cross-reference chip) | 'cite' (citation chip) | 'figure' | 'table' (placement line). */
  function openPicker(anchorBtn, mode = 'ref') {
    if (activePicker) activePicker.close();
    saveRange();
    const p = project();
    const n = getNumbering(p);
    const placing = mode === 'figure' || mode === 'table';
    const citing = mode === 'cite';
    const where = (info) => (info.sectionId ? (n.sections.get(info.sectionId)?.number || n.sections.get(info.sectionId)?.title) : info.chapterId ? n.chapters.get(info.chapterId)?.label : t('Unassigned'));
    const placeItems = () => (mode === 'figure' ? n.figureOrder : n.tableOrder).map((x) => {
      const info = (mode === 'figure' ? n.figures : n.tables).get(x.id);
      return { id: x.id, label: info.label, title: x.title, placed: info.placed, here: info.placement?.ownerId === ownerId, where: where(info) };
    });
    const citeItems = () => n.referenceOrder.map((ref) => {
      const info = n.references.get(ref.id);
      return { id: ref.id, label: info.label, title: referenceShortLabel(ref), cited: info.cited, search: `${ref.authors} ${ref.title} ${ref.custom} ${ref.container} ${ref.year}` };
    });
    const groups = placing
      ? [{ title: '', kind: mode, items: placeItems() }]
      : citing ? [{ title: '', kind: 'cite', items: citeItems() }]
      : [
        { title: t('Figures'), kind: 'fig', items: n.figureOrder.map((f) => ({ id: f.id, label: n.figures.get(f.id).label, title: f.title })) },
        { title: t('Tables'), kind: 'tab', items: n.tableOrder.map((tb) => ({ id: tb.id, label: n.tables.get(tb.id).label, title: tb.title })) },
        { title: t('Sections'), kind: 'sec', items: n.outline.filter((o) => o.kind === 'section').map((o) => { const label = n.sections.get(o.id).label; return { id: o.id, label, title: label === o.title ? null : o.title }; }) },
        { title: t('Chapters'), kind: 'ch', items: n.outline.filter((o) => o.kind === 'chapter').map((o) => { const label = n.chapters.get(o.id).label; return { id: o.id, label, title: label === o.title ? null : o.title }; }) },
      ];
    const pop = document.createElement('div');
    pop.className = `be-picker${placing ? ' be-picker-place' : ''}${citing ? ' be-picker-cite' : ''}`;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', placing ? (mode === 'figure' ? t('Insert figure here') : t('Insert table here')) : citing ? t('Cite a reference') : t('Insert reference'));
    const filterText = placing ? (mode === 'figure' ? t('Filter figures…') : t('Filter tables…')) : citing ? t('Filter references…') : t('Filter figures, tables, sections…');
    const footer = placing ? `<div class="be-picker-foot"><button type="button" class="be-pick-new" data-new="${mode}">${icon('plus')}<span>${mode === 'figure' ? t('New figure…') : t('New table…')}</span></button></div>`
      : citing ? `<div class="be-picker-foot"><button type="button" class="be-pick-new" data-new="cite">${icon('plus')}<span>${t('New reference…')}</span></button></div>` : '';
    pop.innerHTML = `<div class="be-picker-search">${icon('search')}<input class="input input-sm" type="search" placeholder="${esc(filterText)}" aria-label="${esc(placing || citing ? filterText : t('Filter references'))}" autocomplete="off"></div><div class="be-picker-list" role="listbox"></div>${footer}`;
    el.append(pop);
    const input = pop.querySelector('input');
    const list = pop.querySelector('.be-picker-list');
    let active = 0;

    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      let html = '';
      for (const g of groups) {
        const items = g.items.filter((it) => !q || `${it.label} ${it.title} ${it.search || ''}`.toLowerCase().includes(q));
        if (!items.length) continue;
        if (g.title) html += `<div class="be-picker-group">${g.title}</div>`;
        html += items.map((it) => {
          if (citing) return `<button type="button" class="be-pick" role="option" data-kind="${g.kind}" data-id="${esc(it.id)}"><span class="be-pick-label" dir="ltr">${esc(it.label)}</span><span class="be-pick-title" dir="auto">${esc(it.title)}</span>${it.cited ? '' : `<span class="be-pick-meta"><span class="be-pick-badge">${t('Not cited yet')}</span></span>`}</button>`;
          const meta = placing ? `<span class="be-pick-meta">${it.here ? `<span class="be-pick-badge here">${t('Placed here')}</span>` : it.placed ? `<span class="be-pick-badge">${t('In text')}</span>` : ''}<bdi>${esc(it.where || '')}</bdi></span>` : '';
          return `<button type="button" class="be-pick" role="option" data-kind="${g.kind}" data-id="${esc(it.id)}"><span class="be-pick-label">${esc(it.label)}</span><span class="be-pick-title" dir="auto">${esc(it.title === null ? '' : it.title || t('Untitled'))}</span>${meta}</button>`;
        }).join('');
      }
      const empty = citing ? (q ? t('Nothing matches.') : t('No references yet. Add the first one below.')) : placing ? (q ? t('Nothing matches.') : mode === 'figure' ? t('No figures yet. Create the first one below.') : t('No tables yet. Create the first one below.')) : t('Nothing matches. Add figures and tables from their pages first.');
      list.innerHTML = html || `<div class="be-picker-empty">${empty}</div>`;
      active = 0;
      setActive(0);
    };
    const buttons = () => [...list.querySelectorAll('.be-pick')];
    const setActive = (i) => {
      const bs = buttons();
      bs.forEach((b) => b.classList.remove('active'));
      if (!bs.length) return;
      active = (i + bs.length) % bs.length;
      bs[active].classList.add('active');
      const b = bs[active];
      if (b.offsetTop < list.scrollTop) list.scrollTop = b.offsetTop - 28;
      else if (b.offsetTop + b.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = b.offsetTop + b.offsetHeight - list.clientHeight + 6;
    };
    const pick = (btn) => {
      if (!btn) return;
      const { kind, id } = btn.dataset;
      close();
      if (placing) placeItem(kind, id); else insertChip(kind, id);
    };
    const onDown = (e) => { if (!pop.contains(e.target) && !anchorBtn.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); focusAtEnd(); restoreSelection(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' && !e.target.closest?.('.be-pick-new')) { e.preventDefault(); pick(buttons()[active]); }
    };
    function close() {
      if (activePicker?.pop !== pop) return;
      activePicker = null;
      pop.remove();
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      anchorBtn.classList.remove('active');
      anchorBtn.setAttribute('aria-expanded', 'false');
    }
    input.addEventListener('input', renderList);
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => pick(e.target.closest('.be-pick')));
    list.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.be-pick');
      if (b) { const i = buttons().indexOf(b); if (i !== active) setActive(i); }
    });
    pop.querySelector('.be-pick-new')?.addEventListener('click', () => { close(); if (citing) newReference(); else newItem(mode); });
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    anchorBtn.classList.add('active');
    anchorBtn.setAttribute('aria-expanded', 'true');
    activePicker = { pop, close, owner: api };
    renderList();
    input.focus();
  }

  // Never lose the last keystrokes when the tab is closed or hidden within the debounce window.
  const onHide = () => {
    if (timer === null) return;
    flush();
    store?.flushSync?.();
  };
  listen(window, 'pagehide', onHide);
  listen(window, 'beforeunload', onHide);
  listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });

  // Keep the editor's focus and selection when clicking toolbar buttons.
  listen(toolbar, 'mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  listen(toolbar, 'click', (e) => {
    const btn = e.target.closest('[data-be]');
    if (!btn) return;
    const act = btn.dataset.be;
    if (act === 'ref' || act === 'cite' || act === 'figure' || act === 'table') {
      const sameButton = activePicker?.owner === api && el.contains(activePicker.pop) && btn.classList.contains('active');
      if (sameButton) activePicker.close(); else openPicker(btn, act);
    } else if (act === 'bullet') toggleBullet();
    else if (act === 'guide') { guideOverride = !(guideOverride ?? guideWasEmpty); updateGuide(); }
  });

  // ----- hint actions ---------------------------------------------------------------
  listen(hintsEl, 'click', (e) => {
    const btn = e.target.closest('[data-hint]');
    if (!btn) return;
    const act = btn.dataset.hint;
    const p = project();
    if (act === 'link') {
      flush();
      const res = linkPlainReferences(p, read());
      if (res.count) {
        setValue(res.body);
        lastEmitted = trimEnd(res.body);
        onChange?.(lastEmitted);
        toast(t(res.count === 1 ? 'Linked 1 reference' : 'Linked {n} references', { n: res.count }), { type: 'success' });
      }
    } else if (act === 'acr-add') {
      const acronym = btn.dataset.acr; const meaning = btn.dataset.meaning;
      store.update((proj) => {
        if (!proj.acronyms.some((a) => String(a.acronym).trim().toUpperCase() === acronym.toUpperCase())) proj.acronyms.push(createAcronym({ acronym, meaning }));
      }, { activity: t('Added acronym {acronym}', { acronym: isolate(acronym) }) });
      toast(t('Added {acronym} to Acronyms', { acronym: isolate(acronym) }), { type: 'success' });
    } else if (act === 'acr-dismiss') {
      const acronym = btn.dataset.acr;
      store.update((proj) => {
        if (!proj.dismissedSuggestions.some((a) => String(a).toUpperCase() === acronym.toUpperCase())) proj.dismissedSuggestions.push(acronym);
      });
    } else if (act === 'remove-broken') {
      surface.querySelectorAll('.ref-chip.broken').forEach((c) => c.remove());
      emitNow();
      updateHints();
    }
  });

  // ----- initial render ------------------------------------------------------------------
  renderDom(value);
  updateMeta();
  // Hints need the project in its final DOM position; compute once on the next frame.
  requestAnimationFrame(() => { if (!destroyed) updateHints(); });

  const api = {
    el,
    setValue,
    getValue: read,
    sync,
    refresh,
    flush,
    focus: focusAtEnd,
    placeItem,
    /** Scroll to (and select) the block of a figure/table, if this text has one. */
    reveal(kind, id) {
      const block = [...surface.querySelectorAll(':scope > .be-block')].find((b) => b.getAttribute('data-place') === `${kind}:${id}`);
      if (!block) return false;
      focusBlock(block);
      block.classList.remove('highlight-flash');
      void block.offsetWidth;
      block.classList.add('highlight-flash');
      return true;
    },
    destroy() {
      if (destroyed) return;
      flush();
      destroyed = true;
      closePicker();
      offChange?.();
      cancelAnimationFrame(refreshFrame);
      clearTimeout(timer);
      while (disposers.length) disposers.pop()();
    },
  };
  return api;
}
