// Dropdown and context menus.
// openMenu(anchorElOrPoint, [{ label, icon, shortcut, danger, disabled, onClick } | '-' | { heading }])
import { esc } from './dom.js';
import { icon as iconSvg } from './icons.js';

let current = null;

export function closeMenu() {
  if (!current) return;
  current.cleanup();
  current = null;
}

export function openMenu(anchor, items, { align = 'start' } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  const actionable = [];
  menu.innerHTML = items.filter(Boolean).map((item) => {
    if (item === '-' || item === 'sep') return '<div class="menu-sep"></div>';
    if (item.heading) return `<div class="menu-heading">${esc(item.heading)}</div>`;
    const idx = actionable.push(item) - 1;
    return `<button class="menu-item ${item.danger ? 'danger' : ''}" role="menuitem" data-idx="${idx}" ${item.disabled ? 'disabled' : ''}>
      ${item.icon ? iconSvg(item.icon) : '<span class="icon"></span>'}
      <span class="truncate">${esc(item.label)}</span>
      ${item.shortcut ? `<span class="shortcut">${esc(item.shortcut)}</span>` : ''}
    </button>`;
  }).join('');
  document.body.append(menu);

  // Position
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  let x; let y;
  if (anchor instanceof Element) {
    const r = anchor.getBoundingClientRect();
    x = align === 'end' ? r.right - mw : r.left;
    y = r.bottom + 4;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  } else {
    x = anchor.x; y = anchor.y;
    if (y + mh > window.innerHeight - 8) y = Math.max(8, y - mh);
  }
  x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
  menu.style.left = `${x}px`; menu.style.top = `${y}px`;

  const buttons = [...menu.querySelectorAll('.menu-item:not(:disabled)')];
  let focus = -1;
  const setFocus = (i) => {
    buttons.forEach((b) => b.classList.remove('focused'));
    focus = (i + buttons.length) % buttons.length;
    buttons[focus]?.classList.add('focused');
    buttons[focus]?.focus();
  };

  const onClick = (e) => {
    const btn = e.target.closest('.menu-item');
    if (!btn || btn.disabled) return;
    const item = actionable[Number(btn.dataset.idx)];
    closeMenu();
    item?.onClick?.();
  };
  const onDocDown = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor?.contains?.(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); if (anchor instanceof HTMLElement) anchor.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(focus + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(focus - 1); }
  };
  const onScroll = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  menu.addEventListener('click', onClick);
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true));
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeMenu);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', closeMenu);

  current = {
    el: menu,
    cleanup() {
      menu.remove();
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closeMenu);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeMenu);
    },
  };
  return current;
}
