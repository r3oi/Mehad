// Toast notifications. toast('Saved', { type: 'success', action: { label, onClick } })
import { esc } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n/index.js';

let stackEl = null;
const ICONS = { success: 'checkCircle', error: 'alert', warning: 'alert', info: 'info' };

export function toast(message, { type = 'info', title = '', duration = 3600, action = null } = {}) {
  if (!stackEl) {
    stackEl = document.createElement('div');
    stackEl.className = 'toast-stack';
    stackEl.setAttribute('role', 'status');
    stackEl.setAttribute('aria-live', 'polite');
    document.body.append(stackEl);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(ICONS[type] || 'info')}
    <div class="msg">${title ? `<strong>${esc(title)}</strong>` : ''}${esc(message)}</div>
    ${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}
    <button class="toast-close" aria-label="${t('Dismiss notification')}">${icon('x', 'icon-sm')}</button>`;
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector('.toast-close').addEventListener('click', remove);
  if (action) el.querySelector('.toast-action').addEventListener('click', () => { action.onClick?.(); remove(); });
  stackEl.append(el);
  if (duration > 0) setTimeout(remove, duration + (action ? 2500 : 0));
  return remove;
}

export const toastError = (err, fallback = t('Something went wrong')) => {
  console.error(err);
  toast(err?.message || String(err || fallback), { type: 'error', title: fallback, duration: 6000 });
};
