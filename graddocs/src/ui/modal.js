// Modal dialogs: generic modal, confirm, prompt and declarative form dialogs.
import { esc, focusFirst } from './dom.js';
import { icon } from './icons.js';

const stack = [];

/**
 * openModal({ title, subtitle, size, body, footer, onMount, onClose, dismissible })
 * body/footer may be HTML strings or Nodes. Returns { root, close, $ }.
 */
export function openModal({ title = '', subtitle = '', size = '', body = '', footer = '', onMount, onClose, dismissible = true, className = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal ${size ? `modal-${size}` : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      ${title ? `<div class="modal-header">
        <div class="titles"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${icon('x')}</button>
      </div>` : ''}
      <div class="modal-body"></div>
      ${footer === false ? '' : '<div class="modal-footer"></div>'}
    </div>`;
  const bodyEl = root.querySelector('.modal-body');
  const footerEl = root.querySelector('.modal-footer');
  if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = body;
  if (footerEl) {
    if (footer instanceof Node) footerEl.append(footer);
    else if (footer) footerEl.innerHTML = footer;
    else footerEl.remove();
  }

  const previousFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    const idx = stack.indexOf(api);
    if (idx >= 0) stack.splice(idx, 1);
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
    if (previousFocus instanceof HTMLElement) previousFocus.focus?.();
  };
  const onKey = (e) => {
    if (stack[stack.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') trapFocus(e, root);
  };
  root.addEventListener('click', (e) => {
    if (dismissible && e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  const api = { root, close, $: (sel) => root.querySelector(sel), body: bodyEl, footer: footerEl };
  stack.push(api);
  onMount?.(api);
  requestAnimationFrame(() => focusFirst(root.querySelector('.modal')));
  return api;
}

function trapFocus(e, root) {
  const focusables = [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0]; const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export const hasOpenModal = () => stack.length > 0;

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const modal = openModal({
      title, size: 'sm',
      body: `<p style="color:var(--text-2)">${message}</p>`,
      footer: `<button class="btn" data-close>${esc(cancelText)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok autofocus>${esc(confirmText)}</button>`,
      onClose: () => resolve(result),
    });
    modal.$('[data-ok]').addEventListener('click', () => { result = true; modal.close(); });
  });
}

export function promptDialog({ title, label = '', value = '', placeholder = '', submitText = 'Save', validate } = {}) {
  return formDialog({
    title, submitText,
    fields: [{ name: 'value', label, value, placeholder, required: true }],
    validate: validate ? (v) => { const msg = validate(v.value); return msg ? { value: msg } : null; } : undefined,
  }).then((values) => (values ? values.value : null));
}

/**
 * Declarative form dialog. fields: [{ name, label, type, value, options, required, placeholder, hint, rows, span }]
 * Resolves with an object of values, or null when cancelled.
 */
export function formDialog({ title, subtitle = '', fields = [], submitText = 'Save', size = '', validate, extraFooter = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const fieldHTML = (f) => {
      const id = `f_${f.name}`;
      const common = `id="${id}" name="${esc(f.name)}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}"`;
      let control;
      if (f.type === 'textarea') control = `<textarea class="textarea" rows="${f.rows || 3}" ${common}>${esc(f.value ?? '')}</textarea>`;
      else if (f.type === 'select') {
        control = `<select class="select" ${common}>${(f.options || []).map((o) => {
          const opt = typeof o === 'object' ? o : { value: o, label: o };
          return `<option value="${esc(opt.value)}" ${String(opt.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(opt.label)}</option>`;
        }).join('')}</select>`;
      } else control = `<input class="input" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${common} ${f.autofocus ? 'autofocus' : ''}>`;
      return `<div class="field" style="${f.span ? 'grid-column:1/-1' : ''}">
        ${f.label ? `<label for="${id}">${esc(f.label)}${f.required ? ' <span style="color:var(--danger)">*</span>' : ''}</label>` : ''}
        ${control}
        ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}
        <div class="error-text" data-error="${esc(f.name)}"></div>
      </div>`;
    };
    const modal = openModal({
      title, subtitle, size,
      body: `<form class="form-grid" novalidate style="grid-template-columns:${fields.length > 3 ? 'repeat(2, minmax(0,1fr))' : '1fr'}">${fields.map(fieldHTML).join('')}<button type="submit" hidden></button></form>`,
      footer: `<div class="left">${extraFooter}</div><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-submit>${esc(submitText)}</button>`,
      onClose: () => resolve(result),
    });
    const form = modal.$('form');
    const collect = () => Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()]));
    const submit = () => {
      const values = collect();
      const errors = {};
      for (const f of fields) if (f.required && !values[f.name]) errors[f.name] = `${f.label || f.name} is required.`;
      Object.assign(errors, validate?.(values) || {});
      form.querySelectorAll('[data-error]').forEach((el) => { el.textContent = errors[el.dataset.error] || ''; });
      form.querySelectorAll('.input, .textarea').forEach((el) => el.classList.toggle('invalid', !!errors[el.name]));
      if (Object.keys(errors).length) { form.elements[Object.keys(errors)[0]]?.focus(); return; }
      result = values; modal.close();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    modal.$('[data-submit]').addEventListener('click', submit);
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
  });
}
