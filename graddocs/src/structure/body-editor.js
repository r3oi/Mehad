// Reusable rich body editor.
//
// Body format (stored as a plain string): one paragraph per line, "- " prefix = bullet,
// cross references as {{ref:fig|tab|sec|ch:<id>}} tokens. In the editor the tokens are
// atomic chips whose labels follow the live numbering ("Figure 3" → "Figure 4" when a
// figure is inserted before it).
//
//   const editor = createBodyEditor({ store, getProject: () => store.project, value, onChange, placeholder });
//   container.append(editor.el);  editor.refresh();  editor.destroy();
import { esc } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { getNumbering } from '../core/numbering.js';
import { createAcronym } from '../core/model.js';
import {
  REF_RE, makeRef, refInfo, resolveHTML, resolveText, findPlainReferences, linkPlainReferences,
} from '../core/references.js';
import { scanText } from '../acronyms/detection.js';
import { href } from '../app/routes.js';

const REF_ATTR = /^(fig|tab|sec|ch):([A-Za-z0-9_-]+)$/;
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TR']);
const EMIT_DELAY = 400;
const BULLET_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="7" r="1.3"/><circle cx="5" cy="12" r="1.3"/><circle cx="5" cy="17" r="1.3"/><path d="M10 7h10"/><path d="M10 12h10"/><path d="M10 17h10"/></svg>';

let activePicker = null; // only one reference picker is open at a time

const trimEnd = (s) => String(s || '').replace(/\n+$/, '');

function chipToken(node) {
  const ref = node.getAttribute?.('data-ref');
  return ref && REF_ATTR.test(ref) ? `{{ref:${ref}}}` : null;
}

/** DOM → body string. Text nodes as-is, chips → tokens, <br> → newline, blocks → newline separated. */
export function serializeNodes(root) {
  let out = '';
  const endLine = () => { if (out && !out.endsWith('\n')) out += '\n'; };
  const walk = (parent) => {
    parent.childNodes.forEach((node) => {
      if (node.nodeType === 3) { out += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const token = chipToken(node);
      if (token) { out += token; return; }
      if (node.nodeName === 'BR') { out += '\n'; return; }
      if (BLOCK_TAGS.has(node.nodeName)) { endLine(); walk(node); endLine(); return; }
      walk(node);
    });
  };
  walk(root);
  return out.replace(/\u00a0/g, ' ').replace(/[\u200b\ufeff]/g, '').replace(/\r\n?/g, '\n');
}

const wordCount = (text) => (String(text).trim() ? String(text).trim().split(/\s+/).length : 0);

export function createBodyEditor({
  store, getProject = () => store.project, value = '', onChange, placeholder = '', label = 'Text', minHeight,
} = {}) {
  const el = document.createElement('div');
  el.className = 'be';
  if (minHeight) el.style.setProperty('--be-min', typeof minHeight === 'number' ? `${minHeight}px` : minHeight);
  el.innerHTML = `
    <div class="be-toolbar" role="toolbar" aria-label="${esc(label)} tools">
      <button type="button" class="be-btn" data-be="ref" aria-haspopup="dialog" data-tip="Insert a live cross reference">${icon('link')}<span>Insert reference</span></button>
      <button type="button" class="be-btn" data-be="bullet" data-tip="Toggle bullet list for the current line">${BULLET_SVG}<span>Bullet</span></button>
      <span class="be-meta"></span>
    </div>
    <div class="be-surface" role="textbox" aria-multiline="true" aria-label="${esc(label)}" spellcheck="true" data-placeholder="${esc(placeholder)}"></div>
    <div class="be-hints" hidden></div>`;
  const surface = el.querySelector('.be-surface');
  const hintsEl = el.querySelector('.be-hints');
  const metaEl = el.querySelector('.be-meta');
  const toolbar = el.querySelector('.be-toolbar');

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

  function renderDom(body) {
    surface.innerHTML = resolveHTML(project(), trimEnd(body), { chipClass: 'ref-chip', editable: true });
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
    let remaining = target;
    const nodes = [...surface.childNodes];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.nodeType === 3) {
        const len = node.nodeValue.length;
        if (remaining <= len) return { node, offset: remaining };
        remaining -= len;
      } else if (chipToken(node)) {
        if (remaining <= 0) return { node: surface, offset: i };
        remaining -= chipToken(node).length;
      } else if (node.nodeName === 'BR') {
        if (remaining <= 0) return { node: surface, offset: i };
        remaining -= 1;
      }
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
    surface.focus({ preventScroll: true });
    const r = currentRange();
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
    metaEl.textContent = words ? `${words} ${words === 1 ? 'word' : 'words'}` : '';
  }

  function updateHints() {
    const p = project();
    if (!p) return;
    const body = read();
    const rows = [];

    const plain = findPlainReferences(p, body);
    if (plain.length) {
      const labels = [...new Set(plain.map((x) => x.match))];
      const shown = labels.slice(0, 4).join(', ') + (labels.length > 4 ? `, +${labels.length - 4} more` : '');
      rows.push(`<div class="be-hint be-hint-link">${icon('link')}<span class="be-hint-text">${plain.length} plain reference${plain.length === 1 ? '' : 's'} can be linked so they update automatically: <strong>${esc(shown)}</strong></span><button type="button" class="btn btn-sm btn-soft" data-hint="link">Link all</button></div>`);
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
      rows.push(`<div class="be-hint be-hint-acronym">${icon('sparkles')}<span class="be-hint-text">Add <strong>${esc(s.acronym)}</strong> (${esc(s.meaning)}) to Acronyms?</span>
        <span class="be-hint-actions"><button type="button" class="btn btn-sm btn-soft" data-hint="acr-add" data-acr="${esc(s.acronym)}" data-meaning="${esc(s.meaning)}">Add</button>
        <button type="button" class="btn btn-sm btn-ghost" data-hint="acr-dismiss" data-acr="${esc(s.acronym)}">Dismiss</button></span></div>`);
    }
    if (suggestions.length > 3) rows.push(`<div class="be-hint-more">+${suggestions.length - 3} more acronym suggestion${suggestions.length - 3 === 1 ? '' : 's'}</div>`);

    const broken = surface.querySelectorAll('.ref-chip.broken').length;
    if (broken) {
      rows.push(`<div class="be-hint be-hint-broken">${icon('alert')}<span class="be-hint-text">${broken} broken reference${broken === 1 ? '' : 's'} — the target was deleted. Remove ${broken === 1 ? 'it' : 'them'} or insert a new reference.</span><button type="button" class="btn btn-sm btn-ghost" data-hint="remove-broken">Remove</button></div>`);
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
    if (text.match(REF_RE)) rerenderKeepCaret();
    scheduleEmit();
  });
  listen(surface, 'dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  listen(surface, 'drop', (e) => { if (e.dataTransfer?.files?.length) e.preventDefault(); });

  listen(surface, 'input', (e) => {
    if (!e.isComposing && !surface.textContent && !surface.querySelector('[data-ref]')) surface.innerHTML = '';
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
    const chip = e.target instanceof Element ? e.target.closest('.ref-chip[data-ref]') : null;
    if (!chip || chip.classList.contains('broken') || el.closest('.modal')) return;
    const m = REF_ATTR.exec(chip.getAttribute('data-ref'));
    if (!m) return;
    const pid = project().id;
    flush();
    if (m[1] === 'fig') location.hash = href(pid, 'figures', m[2]);
    else if (m[1] === 'tab') location.hash = href(pid, 'tables', m[2]);
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
    const nonBlank = lines.filter((l) => l.trim());
    const allBullets = nonBlank.length > 0 && nonBlank.every((l) => /^- /.test(l));
    const next = lines.map((l) => {
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

  function closePicker() { if (activePicker?.owner === api) activePicker.close(); }

  function openPicker(anchorBtn) {
    if (activePicker) activePicker.close();
    saveRange();
    const p = project();
    const n = getNumbering(p);
    const groups = [
      { title: 'Figures', kind: 'fig', items: n.figureOrder.map((f) => ({ id: f.id, label: n.figures.get(f.id).label, title: f.title })) },
      { title: 'Tables', kind: 'tab', items: n.tableOrder.map((t) => ({ id: t.id, label: n.tables.get(t.id).label, title: t.title })) },
      { title: 'Sections', kind: 'sec', items: n.outline.filter((o) => o.kind === 'section').map((o) => ({ id: o.id, label: `Section ${o.number}`, title: o.title })) },
      { title: 'Chapters', kind: 'ch', items: n.outline.filter((o) => o.kind === 'chapter').map((o) => ({ id: o.id, label: `Chapter ${o.number}`, title: o.title })) },
    ];
    const pop = document.createElement('div');
    pop.className = 'be-picker';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Insert reference');
    pop.innerHTML = `<div class="be-picker-search">${icon('search')}<input class="input input-sm" type="search" placeholder="Filter figures, tables, sections…" aria-label="Filter references" autocomplete="off"></div><div class="be-picker-list" role="listbox"></div>`;
    el.append(pop);
    const input = pop.querySelector('input');
    const list = pop.querySelector('.be-picker-list');
    let active = 0;

    const renderList = () => {
      const q = input.value.trim().toLowerCase();
      let html = '';
      for (const g of groups) {
        const items = g.items.filter((it) => !q || `${it.label} ${it.title}`.toLowerCase().includes(q));
        if (!items.length) continue;
        html += `<div class="be-picker-group">${g.title}</div>`;
        html += items.map((it) => `<button type="button" class="be-pick" role="option" data-kind="${g.kind}" data-id="${esc(it.id)}"><span class="be-pick-label">${esc(it.label)}</span><span class="be-pick-title">${esc(it.title || 'Untitled')}</span></button>`).join('');
      }
      list.innerHTML = html || '<div class="be-picker-empty">Nothing matches. Add figures and tables from their pages first.</div>';
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
      insertChip(kind, id);
    };
    const onDown = (e) => { if (!pop.contains(e.target) && !anchorBtn.contains(e.target)) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); focusAtEnd(); restoreSelection(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(buttons()[active]); }
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
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    anchorBtn.classList.add('active');
    anchorBtn.setAttribute('aria-expanded', 'true');
    activePicker = { pop, close, owner: api };
    renderList();
    input.focus();
  }

  // Keep the editor's focus and selection when clicking toolbar buttons.
  listen(toolbar, 'mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  listen(toolbar, 'click', (e) => {
    const btn = e.target.closest('[data-be]');
    if (!btn) return;
    if (btn.dataset.be === 'ref') { if (activePicker?.owner === api && el.contains(activePicker.pop)) activePicker.close(); else openPicker(btn); }
    else if (btn.dataset.be === 'bullet') toggleBullet();
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
        toast(`Linked ${res.count} reference${res.count === 1 ? '' : 's'}`, { type: 'success' });
      }
    } else if (act === 'acr-add') {
      const acronym = btn.dataset.acr; const meaning = btn.dataset.meaning;
      store.update((proj) => {
        if (!proj.acronyms.some((a) => String(a.acronym).trim().toUpperCase() === acronym.toUpperCase())) proj.acronyms.push(createAcronym({ acronym, meaning }));
      }, { activity: `Added acronym ${acronym}` });
      toast(`Added ${acronym} to Acronyms`, { type: 'success' });
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
    refresh,
    flush,
    focus: focusAtEnd,
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
