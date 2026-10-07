// Left "Elements" panel: searchable shape library grouped by category.
// Click adds at the viewport centre; drag & drop places at the cursor.
import { LIBRARY, getShape } from '../shapes.js';
import { renderThumbnail } from '../render.js';
import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';

const thumbCache = new Map();

function presetThumb(preset) {
  const key = JSON.stringify(preset);
  if (!thumbCache.has(key)) {
    const shape = getShape(preset.shape);
    const w = preset.w ?? shape.defaults.w; const h = preset.h ?? shape.defaults.h;
    const scale = Math.min(1, 120 / w, 80 / h);
    const node = {
      id: 'p', type: 'node', shape: preset.shape, x: 0, y: 0, w: Math.max(6, w * scale), h: Math.max(6, h * scale),
      text: preset.shape === 'text' ? 'Aa' : '', style: { ...(preset.style || {}), fontSize: 18 },
    };
    thumbCache.set(key, renderThumbnail({ elements: [node], defaults: { fontFamily: 'Arial', fontSize: 18 } }, { padding: 6 }));
  }
  return thumbCache.get(key);
}

export function renderLibrary(container, { groupsFirst = [], onAdd }) {
  const ordered = [...LIBRARY].sort((a, b) => {
    const ia = groupsFirst.indexOf(a.group); const ib = groupsFirst.indexOf(b.group);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const presets = [];
  container.innerHTML = `
    <div class="ed-panel-head"><span>Elements</span></div>
    <div class="ed-lib-search input-group">${icon('search')}<input class="input input-sm" type="search" placeholder="Search shapes" aria-label="Search shapes"></div>
    <div class="ed-lib-groups">
      ${ordered.map((g, gi) => `
        <details class="ed-lib-group" ${gi < 2 || groupsFirst.includes(g.group) ? 'open' : ''}>
          <summary>${icon('chevronRight', 'icon-sm chev')}${esc(g.group)}<span class="faint">${g.items.length}</span></summary>
          <div class="ed-lib-grid">
            ${g.items.map((item) => {
              const idx = presets.push(item) - 1;
              return `<button class="ed-lib-item" draggable="true" data-preset="${idx}" data-name="${esc(item.name.toLowerCase())}" data-tip="${esc(item.name)} — click or drag onto the canvas">
                <span class="ed-lib-thumb">${presetThumb(item)}</span><span class="ed-lib-name truncate">${esc(item.name)}</span></button>`;
            }).join('')}
          </div>
        </details>`).join('')}
    </div>`;
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (btn) onAdd(presets[Number(btn.dataset.preset)], null);
  });
  container.addEventListener('dragstart', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    e.dataTransfer.setData('application/x-graddocs-preset', btn.dataset.preset);
    e.dataTransfer.effectAllowed = 'copy';
  });
  const search = container.querySelector('input[type=search]');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    container.querySelectorAll('.ed-lib-group').forEach((group) => {
      let any = false;
      group.querySelectorAll('.ed-lib-item').forEach((item) => {
        const hit = !q || item.dataset.name.includes(q);
        item.hidden = !hit; any = any || hit;
      });
      group.hidden = !any;
      if (q && any) group.open = true;
    });
  });
  return { presetAt: (i) => presets[Number(i)] };
}
