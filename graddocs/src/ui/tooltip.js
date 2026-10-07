// Global tooltips: any element with data-tip="Text" (and optional data-kbd="Ctrl+K").
import { esc } from './dom.js';

let tipEl = null;
let timer = null;
let target = null;

function show(el) {
  hide();
  const text = el.dataset.tip;
  if (!text) return;
  target = el;
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip';
  tipEl.innerHTML = `${esc(text)}${el.dataset.kbd ? el.dataset.kbd.split(' ').map((k) => `<kbd>${esc(k)}</kbd>`).join('') : ''}`;
  document.body.append(tipEl);
  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth; const th = tipEl.offsetHeight;
  const place = el.dataset.tipPlace || 'bottom';
  let x = r.left + r.width / 2 - tw / 2;
  let y = place === 'top' ? r.top - th - 6 : place === 'right' ? r.top + r.height / 2 - th / 2 : r.bottom + 6;
  if (place === 'right') x = r.right + 8;
  if (y + th > window.innerHeight - 4) y = r.top - th - 6;
  x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
  tipEl.style.left = `${x}px`; tipEl.style.top = `${Math.max(6, y)}px`;
}

function hide() {
  clearTimeout(timer);
  tipEl?.remove();
  tipEl = null; target = null;
}

export function installTooltips() {
  document.addEventListener('pointerover', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el === target) return;
    hide();
    if (el && e.pointerType !== 'touch') timer = setTimeout(() => show(el), 380);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('blur', hide);
}
