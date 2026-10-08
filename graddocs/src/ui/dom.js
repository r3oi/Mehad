// DOM helpers. Views render with template strings (escaped via `esc`) and
// wire events with delegation (`on`). `h` is available for imperative bits.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Hyperscript: h('button.btn.btn-primary', { onclick }, 'Save') */
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Parse an HTML string into a single element (or fragment if several roots). */
export function fromHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.childElementCount === 1 ? tpl.content.firstElementChild : tpl.content;
}

/**
 * Delegated event listener. Returns an unsubscribe function.
 * on(root, 'click', '[data-action]', (e, el) => ...)
 */
export function on(root, type, selector, handler, options) {
  const listener = (event) => {
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

/** Collects disposer functions so views can clean up in one call. */
export class Disposer {
  #fns = [];
  add(fn) { if (typeof fn === 'function') this.#fns.push(fn); return fn; }
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    return this.add(() => target.removeEventListener(type, handler, options));
  }
  dispose() { while (this.#fns.length) { try { this.#fns.pop()(); } catch (err) { console.error(err); } } }
}

/** Highlight occurrences of `query` inside already-escaped text. */
export function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const q = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${q})`, 'ig'), '<mark>$1</mark>');
}

export function focusFirst(root) {
  const el = root.querySelector('[autofocus], input:not([type=hidden]), textarea, select, button.btn-primary');
  el?.focus();
  if (el && 'select' in el && el.tagName === 'INPUT') el.select();
}

export function flash(el) {
  if (!el) return;
  el.classList.remove('highlight-flash');
  void el.offsetWidth;
  el.classList.add('highlight-flash');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
