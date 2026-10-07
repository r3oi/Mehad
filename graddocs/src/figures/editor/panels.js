// Right-hand inspector of the figure editor: Design (selected element
// properties), Figure (metadata), History (versions & revisions), Comments.
import { esc } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { allShapes, getShape } from '../shapes.js';
import { ARROWS } from '../geometry.js';
import { FONT_FAMILIES } from '../text-layout.js';
import { resolveNodeStyle, resolveEdgeStyle, isNode, isEdge, DEFAULT_FONT } from '../render.js';
import { elementLabel } from '../diff.js';
import { getNumbering, captionText } from '../../core/numbering.js';
import { findUsages } from '../../core/references.js';
import { walkSections } from '../../core/model.js';
import { figureTypes } from '../types.js';
import { formatDateTime, relativeTime, formatDate } from '../../core/utils.js';
import { latestVersion, isDirty, pendingChanges } from '../versions.js';
import { summarizeDiff } from '../diff.js';
import { href } from '../../app/routes.js';

export const SWATCHES = [
  { fill: '#ffffff', stroke: '#1f2937', textColor: '#111827', name: 'Academic (white)' },
  { fill: '#eef2fb', stroke: '#1f2937', textColor: '#111827', name: 'Soft blue' },
  { fill: '#e0e7ff', stroke: '#4338ca', textColor: '#1e1b4b', name: 'Indigo' },
  { fill: '#dcfce7', stroke: '#15803d', textColor: '#14532d', name: 'Green' },
  { fill: '#fef3c7', stroke: '#b45309', textColor: '#78350f', name: 'Amber' },
  { fill: '#fee2e2', stroke: '#b91c1c', textColor: '#7f1d1d', name: 'Red' },
  { fill: '#f3e8ff', stroke: '#7e22ce', textColor: '#3b0764', name: 'Purple' },
  { fill: '#f1f5f9', stroke: '#475569', textColor: '#0f172a', name: 'Grey' },
  { fill: '#1f2937', stroke: '#1f2937', textColor: '#ffffff', name: 'Dark' },
];

const segBtn = (action, value, current, iconName, tip) => `<button class="${String(current) === String(value) ? 'active' : ''}" data-action="${action}" data-value="${esc(value)}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" aria-pressed="${String(current) === String(value)}">${icon(iconName, 'icon-sm')}</button>`;
const colorInput = (prop, value, kind, label) => `<label class="ed-color" data-tip="${esc(label)}"><input type="color" data-style="${prop}" data-kind="${kind}" value="${esc(toHex(value))}" aria-label="${esc(label)}"><span class="mono">${esc(value === 'none' ? 'None' : toHex(value))}</span></label>`;

function toHex(v) {
  if (!v || v === 'none' || v === 'transparent') return '#ffffff';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  return '#000000';
}

function fontOptions(current) {
  const list = FONT_FAMILIES.includes(current) ? FONT_FAMILIES : [current, ...FONT_FAMILIES];
  return list.map((f) => `<option value="${esc(f)}" ${f === current ? 'selected' : ''}>${esc(f)}</option>`).join('');
}

// ---------------------------------------------------------------- Design tab
export function designPanelHTML(editor) {
  const sel = editor.selectedElements();
  if (!sel.length) return canvasPanelHTML(editor);
  const nodes = sel.filter(isNode); const edges = sel.filter(isEdge);
  const single = sel.length === 1 ? sel[0] : null;
  const parts = [];

  parts.push(`<div class="ed-sec ed-sel-title">
    <div class="row"><span class="ed-kind-icon">${icon(edges.length && !nodes.length ? 'connector' : 'square')}</span>
      <div class="grow"><div class="ed-sel-name truncate">${single ? esc(isNode(single) ? getShape(single.shape).name : 'Connector') : `${sel.length} elements`}</div>
      <div class="faint ed-sel-sub truncate">${single ? esc(elementLabel(single)) : `${nodes.length} shapes · ${edges.length} connectors`}</div></div>
      <button class="btn btn-ghost btn-icon btn-sm" data-action="duplicate" data-tip="Duplicate" data-kbd="Ctrl D" aria-label="Duplicate">${icon('duplicate')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-action="delete" data-tip="Delete" data-kbd="Del" aria-label="Delete">${icon('trash')}</button>
    </div></div>`);

  if (single) {
    parts.push(`<div class="ed-sec"><div class="ed-label">${isEdge(single) ? 'Label' : 'Text'}</div>
      <textarea class="textarea ed-text-field" data-field="text" rows="${single.shape === 'class' || single.shape === 'entity' ? 6 : 2}" placeholder="${isEdge(single) ? 'Connector label (optional)' : 'Type text…'}">${esc(single.text || '')}</textarea>
      ${single.shape === 'class' || single.shape === 'entity' ? '<div class="hint faint">Separate compartments with a line containing only <span class="mono">--</span></div>' : ''}
    </div>`);
  }

  if (nodes.length) {
    const n = nodes[0]; const s = resolveNodeStyle(n, editor.doc);
    parts.push(`<div class="ed-sec"><div class="ed-label">Style presets</div><div class="ed-swatches">
      ${SWATCHES.map((sw, i) => `<button class="ed-swatch" data-action="swatch" data-value="${i}" data-tip="${esc(sw.name)}" aria-label="${esc(sw.name)}" style="background:${sw.fill};border-color:${sw.stroke};color:${sw.textColor}">A</button>`).join('')}
    </div></div>`);
    parts.push(`<div class="ed-sec"><div class="ed-label">Typography</div>
      <div class="ed-grid2"><select class="select select-sm" data-style="fontFamily" data-kind="node" aria-label="Font">${fontOptions(s.fontFamily)}</select>
      <input class="input input-sm" type="number" min="6" max="96" step="1" data-style="fontSize" data-kind="node" data-type="number" value="${s.fontSize}" aria-label="Font size"></div>
      <div class="ed-row">
        <div class="segmented">
          <button class="${s.fontWeight === 'bold' ? 'active' : ''}" data-action="toggle-bold" data-tip="Bold" aria-label="Bold" aria-pressed="${s.fontWeight === 'bold'}">${icon('bold', 'icon-sm')}</button>
          <button class="${s.fontStyle === 'italic' ? 'active' : ''}" data-action="toggle-italic" data-tip="Italic" aria-label="Italic" aria-pressed="${s.fontStyle === 'italic'}">${icon('italic', 'icon-sm')}</button>
          <button class="${s.underline ? 'active' : ''}" data-action="toggle-underline" data-tip="Underline" aria-label="Underline" aria-pressed="${!!s.underline}">${icon('underline', 'icon-sm')}</button>
        </div>
        ${colorInput('textColor', s.textColor, 'node', 'Text colour')}
      </div>
      <div class="ed-row">
        <div class="segmented">${segBtn('align', 'left', s.align, 'alignLeft', 'Align left')}${segBtn('align', 'center', s.align, 'alignCenter', 'Align centre')}${segBtn('align', 'right', s.align, 'alignRight', 'Align right')}</div>
        <div class="segmented">${segBtn('valign', 'top', s.vAlign, 'alignTop', 'Top')}${segBtn('valign', 'middle', s.vAlign, 'alignMiddle', 'Middle')}${segBtn('valign', 'bottom', s.vAlign, 'alignBottom', 'Bottom')}</div>
      </div></div>`);
    parts.push(`<div class="ed-sec"><div class="ed-label">Fill & border</div>
      <div class="ed-row">${colorInput('fill', s.fill, 'node', 'Fill colour')}
        <label class="checkbox"><input type="checkbox" data-action="no-fill" ${s.fill === 'none' ? 'checked' : ''}> No fill</label></div>
      <div class="ed-row">${colorInput('stroke', s.stroke, 'node', 'Border colour')}
        <input class="input input-sm ed-num" type="number" min="0" max="12" step="0.5" data-style="strokeWidth" data-kind="node" data-type="number" value="${s.stroke === 'none' ? 0 : s.strokeWidth}" aria-label="Border width" data-tip="Border width">
        <select class="select select-sm" data-style="dash" data-kind="node" aria-label="Border style">${['solid', 'dashed', 'dotted'].map((d) => `<option value="${d}" ${s.dash === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></div>
      ${['rect', 'roundRect', 'frame', 'text', 'component', 'entity', 'class', 'lifeline'].includes(n.shape) ? `<div class="ed-row"><span class="ed-mini-label">Corner radius</span><input class="ed-range" type="range" min="0" max="40" step="1" data-style="radius" data-kind="node" data-type="number" value="${s.radius || 0}"></div>` : ''}
      <div class="ed-row"><span class="ed-mini-label">Opacity</span><input class="ed-range" type="range" min="0.1" max="1" step="0.05" data-style="opacity" data-kind="node" data-type="number" value="${s.opacity}"></div>
      <label class="switch"><input type="checkbox" data-action="toggle-shadow" ${s.shadow ? 'checked' : ''}><span class="track"></span>Shadow</label>
    </div>`);
    if (single && isNode(single)) {
      parts.push(`<div class="ed-sec"><div class="ed-label">Position & size</div>
        <div class="ed-grid4">${['x', 'y', 'w', 'h'].map((k) => `<label class="ed-geom"><span>${k.toUpperCase()}</span><input class="input input-sm" type="number" step="1" data-geom="${k}" value="${Math.round(single[k])}"></label>`).join('')}</div>
        <div class="ed-row"><span class="ed-mini-label">Shape</span><select class="select select-sm" data-action-change="shape" aria-label="Change shape">${allShapes().map((sh) => `<option value="${sh.id}" ${sh.id === single.shape ? 'selected' : ''}>${esc(sh.name)}</option>`).join('')}</select></div>
        <label class="switch"><input type="checkbox" data-action="toggle-lock" ${single.locked ? 'checked' : ''}><span class="track"></span>Lock position</label>
      </div>`);
    }
  }

  if (edges.length) {
    const e = edges[0]; const s = resolveEdgeStyle(e, editor.doc);
    const arrowOptions = (cur) => ARROWS.map((a) => `<option value="${a.id}" ${a.id === cur ? 'selected' : ''}>${esc(a.label)}</option>`).join('');
    parts.push(`<div class="ed-sec"><div class="ed-label">Connector</div>
      <div class="segmented ed-full">
        ${['straight', 'orthogonal', 'curved'].map((r) => `<button class="${(e.routing || 'straight') === r ? 'active' : ''}" data-action="routing" data-value="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}
      </div>
      <div class="ed-grid2 ed-arrows">
        <label class="field"><span class="ed-mini-label">Start</span><select class="select select-sm" data-style="startArrow" data-kind="edge">${arrowOptions(s.startArrow)}</select></label>
        <label class="field"><span class="ed-mini-label">End</span><select class="select select-sm" data-style="endArrow" data-kind="edge">${arrowOptions(s.endArrow)}</select></label>
      </div>
      <button class="btn btn-sm btn-block" data-action="reverse">${icon('swap', 'icon-sm')} Reverse direction</button>
      <div class="ed-row">${colorInput('stroke', s.stroke, 'edge', 'Line colour')}
        <input class="input input-sm ed-num" type="number" min="0.5" max="12" step="0.5" data-style="strokeWidth" data-kind="edge" data-type="number" value="${s.strokeWidth}" aria-label="Line width" data-tip="Line width">
        <select class="select select-sm" data-style="dash" data-kind="edge" aria-label="Line style">${['solid', 'dashed', 'dotted'].map((d) => `<option value="${d}" ${s.dash === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('')}</select></div>
      <div class="ed-row"><span class="ed-mini-label">Label size</span><input class="input input-sm ed-num" type="number" min="6" max="48" data-style="fontSize" data-kind="edge" data-type="number" value="${s.fontSize}"></div>
      ${single ? `<div class="ed-ends faint">${endText(editor, e.source, 'From')}<br>${endText(editor, e.target, 'To')}</div>` : ''}
    </div>`);
  }

  parts.push(`<div class="ed-sec"><div class="ed-label">Arrange</div>
    <div class="ed-row">
      <button class="btn btn-sm" data-action="front">${icon('bringFront', 'icon-sm')} Front</button>
      <button class="btn btn-sm" data-action="back">${icon('sendBack', 'icon-sm')} Back</button>
      <button class="btn btn-sm" data-action="comment">${icon('message', 'icon-sm')} Comment</button>
    </div>
    ${nodes.length > 1 ? `<div class="ed-row ed-align-row">
      ${[['left', 'alignHLeft', 'Align left'], ['center', 'alignHCenter', 'Align centre'], ['right', 'alignHRight', 'Align right'], ['top', 'alignTop', 'Align top'], ['middle', 'alignMiddle', 'Align middle'], ['bottom', 'alignBottom', 'Align bottom']]
        .map(([m, ic, tip]) => `<button class="btn btn-ghost btn-icon btn-sm" data-action="align" data-value="${m}" data-tip="${tip}" aria-label="${tip}">${icon(ic)}</button>`).join('')}
      <button class="btn btn-ghost btn-icon btn-sm" data-action="distribute" data-value="h" data-tip="Distribute horizontally" aria-label="Distribute horizontally" ${nodes.length < 3 ? 'disabled' : ''}>${icon('distributeH')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-action="distribute" data-value="v" data-tip="Distribute vertically" aria-label="Distribute vertically" ${nodes.length < 3 ? 'disabled' : ''}>${icon('distributeV')}</button>
    </div>` : ''}
  </div>`);
  return parts.join('');
}

function endText(editor, end, label) {
  if (end?.id) {
    const n = editor.byId(end.id);
    return `${label}: <strong>${esc(n ? elementLabel(n) : 'missing')}</strong> ${end.anchor ? '(fixed point)' : '(auto)'}`;
  }
  return `${label}: free point`;
}

function canvasPanelHTML(editor) {
  const d = { ...DEFAULT_FONT, ...(editor.doc.defaults || {}) };
  const bg = editor.doc.background || '#ffffff';
  return `<div class="ed-sec"><div class="ed-empty-hint">${icon('pointer')}<div><strong>Nothing selected</strong><br><span class="faint">Click an element to edit it, drag on the canvas to select several, or double-click empty space to add text.</span></div></div></div>
    <div class="ed-sec"><div class="ed-label">Canvas</div>
      <div class="ed-row"><span class="ed-mini-label">Background</span>
        <div class="segmented"><button class="${bg !== 'transparent' ? 'active' : ''}" data-action="bg" data-value="#ffffff">White</button><button class="${bg === 'transparent' ? 'active' : ''}" data-action="bg" data-value="transparent">Transparent</button></div></div>
      <label class="switch"><input type="checkbox" data-action="grid" ${editor.grid ? 'checked' : ''}><span class="track"></span>Show grid</label>
      <label class="switch"><input type="checkbox" data-action="snap" ${editor.snap ? 'checked' : ''}><span class="track"></span>Snap to grid & guides</label>
    </div>
    <div class="ed-sec"><div class="ed-label">Default text style for this figure</div>
      <div class="ed-grid2"><select class="select select-sm" data-doc-default="fontFamily" aria-label="Default font">${fontOptions(d.fontFamily)}</select>
      <input class="input input-sm" type="number" min="6" max="72" data-doc-default="fontSize" value="${d.fontSize}" aria-label="Default font size"></div>
      <div class="hint faint">Applies to every element without its own font.</div>
    </div>
    <div class="ed-sec"><div class="ed-label">Tips</div>
      <ul class="ed-tips faint">
        <li>Hover a shape and drag one of its blue dots to connect it to another shape — connectors follow the shapes when you move them.</li>
        <li>Double-click any shape or connector to edit its text.</li>
        <li>Hold <kbd>Space</kbd> and drag to pan, <kbd>Ctrl</kbd> + scroll to zoom.</li>
        <li>Hold <kbd>Alt</kbd> while dragging to disable snapping.</li>
      </ul></div>`;
}

/** Wire the design panel controls (delegated; call once on the panel root). */
export function bindDesignPanel(root, editor, { onComment }) {
  const value = (el) => (el.dataset.type === 'number' ? Number(el.value) : el.value);
  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.style && el.type !== 'checkbox' && el.tagName !== 'SELECT') {
      const v = value(el);
      if (el.dataset.type === 'number' && !Number.isFinite(v)) return;
      if (el.dataset.style === 'strokeWidth' && v > 0 && el.dataset.kind === 'node') {
        editor.updateSelected((x) => { x.style = { ...(x.style || {}), strokeWidth: v }; if (x.style.stroke === 'none') x.style.stroke = '#1f2937'; }, { kind: 'node', merge: 'style:strokeWidth' });
      } else editor.setStyle(el.dataset.style, v, { kind: el.dataset.kind || null });
      const label = el.closest('.ed-color')?.querySelector('span');
      if (label) label.textContent = el.value;
    } else if (el.dataset.field === 'text') {
      editor.updateSelected((x) => { x.text = el.value; }, { merge: 'text' });
    } else if (el.dataset.geom) {
      const v = Number(el.value);
      if (!Number.isFinite(v)) return;
      const k = el.dataset.geom;
      editor.updateSelected((x) => { if (isNode(x)) x[k] = (k === 'w' || k === 'h') ? Math.max(4, v) : v; }, { merge: `geom:${k}` });
    } else if (el.dataset.docDefault) {
      const k = el.dataset.docDefault;
      const v = k === 'fontSize' ? Number(el.value) : el.value;
      if (k === 'fontSize' && !(v > 0)) return;
      editor.mutate((doc) => { doc.defaults = { ...DEFAULT_FONT, ...(doc.defaults || {}), [k]: v }; }, { merge: `doc:${k}` });
    }
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.tagName === 'SELECT' && el.dataset.style) editor.setStyle(el.dataset.style, el.value, { kind: el.dataset.kind || null });
    else if (el.dataset.actionChange === 'shape') editor.updateSelected((x) => { if (isNode(x)) x.shape = el.value; }, { kind: 'node' });
    else if (el.tagName === 'SELECT' && el.dataset.docDefault) editor.mutate((doc) => { doc.defaults = { ...DEFAULT_FONT, ...(doc.defaults || {}), [el.dataset.docDefault]: el.value }; });
    else if (el.dataset.action === 'no-fill') editor.setStyle('fill', el.checked ? 'none' : '#ffffff', { kind: 'node' });
    else if (el.dataset.action === 'toggle-shadow') editor.setStyle('shadow', el.checked, { kind: 'node' });
    else if (el.dataset.action === 'toggle-lock') editor.updateSelected((x) => { x.locked = el.checked; }, { kind: 'node' });
    else if (el.dataset.action === 'grid') editor.setGrid(el.checked);
    else if (el.dataset.action === 'snap') editor.setSnap(el.checked);
    else if (el.dataset.style && el.type === 'color') editor.setStyle(el.dataset.style, el.value, { kind: el.dataset.kind || null });
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, value: v } = btn.dataset;
    const first = editor.selectedElements().find(isNode);
    const s = first ? resolveNodeStyle(first, editor.doc) : {};
    switch (action) {
      case 'duplicate': editor.duplicateSelection(); break;
      case 'delete': editor.deleteSelection(); break;
      case 'toggle-bold': editor.setStyle('fontWeight', s.fontWeight === 'bold' ? 'normal' : 'bold', { kind: 'node' }); break;
      case 'toggle-italic': editor.setStyle('fontStyle', s.fontStyle === 'italic' ? 'normal' : 'italic', { kind: 'node' }); break;
      case 'toggle-underline': editor.setStyle('underline', !s.underline, { kind: 'node' }); break;
      case 'align': if (btn.closest('.ed-align-row')) editor.align(v); else editor.setStyle('align', v, { kind: 'node' }); break;
      case 'valign': editor.setStyle('vAlign', v, { kind: 'node' }); break;
      case 'swatch': {
        const sw = SWATCHES[Number(v)];
        editor.updateSelected((x) => { x.style = { ...(x.style || {}), fill: sw.fill, stroke: sw.stroke, textColor: sw.textColor }; }, { kind: 'node' });
        break;
      }
      case 'routing': editor.updateSelected((x) => { x.routing = v; }, { kind: 'edge' }); break;
      case 'reverse': editor.reverseSelectedEdges(); break;
      case 'front': editor.bringToFront(); break;
      case 'back': editor.sendToBack(); break;
      case 'distribute': editor.distribute(v); break;
      case 'comment': onComment?.(); break;
      case 'bg': editor.mutate((doc) => { doc.background = v; }); break;
      default: break;
    }
  });
}

// ---------------------------------------------------------------- Figure tab
export function figurePanelHTML(project, figure, editor) {
  const n = getNumbering(project);
  const info = n.figures.get(figure.id);
  const last = latestVersion(figure);
  const usages = findUsages(project, 'fig', figure.id);
  const sectionOptions = [];
  for (const ch of project.chapters) {
    const chInfo = n.chapters.get(ch.id);
    sectionOptions.push(`<option value="ch:${ch.id}" ${figure.chapterId === ch.id && !figure.sectionId ? 'selected' : ''}>${esc(chInfo.label)}: ${esc(ch.title)}</option>`);
    walkSections({ chapters: [ch] }, (sec) => {
      const s = n.sections.get(sec.id);
      sectionOptions.push(`<option value="sec:${sec.id}" ${figure.sectionId === sec.id ? 'selected' : ''}>${' '.repeat(s.depth)}${esc(s.number)} ${esc(sec.title)}</option>`);
    });
  }
  return `<div class="ed-sec">
      <div class="ed-caption-preview"><span class="faint">Caption</span><div>${esc(captionText(project, 'figure', figure))}</div></div>
    </div>
    <div class="ed-sec form-grid">
      <div class="field"><label for="fp-title">Figure title</label><input id="fp-title" class="input input-sm" data-meta="title" value="${esc(figure.title)}"></div>
      <div class="field"><label for="fp-loc">Location in report</label><select id="fp-loc" class="select select-sm" data-meta="location"><option value="">Unassigned (numbered last)</option>${sectionOptions.join('')}</select></div>
      <div class="field"><label for="fp-type">Diagram type</label><select id="fp-type" class="select select-sm" data-meta="type">${figureTypes().map((t) => `<option value="${t.id}" ${t.id === figure.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="fp-desc">Description</label><textarea id="fp-desc" class="textarea" rows="3" data-meta="description" placeholder="Optional notes about this figure">${esc(figure.description || '')}</textarea></div>
    </div>
    <div class="ed-sec"><div class="ed-label">Metadata</div>
      <dl class="kv ed-kv">
        <dt>Figure ID</dt><dd class="mono">${esc(info?.code || '—')}</dd>
        <dt>Number</dt><dd>${esc(info?.label || '—')}</dd>
        <dt>Chapter</dt><dd>${esc(info?.chapterId ? n.chapters.get(info.chapterId).label : '—')}</dd>
        <dt>Section</dt><dd>${esc(info?.sectionId ? n.sections.get(info.sectionId).number : '—')}</dd>
        <dt>Version</dt><dd>${last ? `v${last.number}` : 'v0'}${isDirty(figure) ? ' <span class="badge badge-warning">edited</span>' : ''}</dd>
        <dt>Created</dt><dd>${esc(formatDate(figure.createdAt))}</dd>
        <dt>Last modified</dt><dd>${esc(relativeTime(figure.updatedAt))}</dd>
        <dt>Elements</dt><dd>${editor.doc.elements.filter(isNode).length} shapes · ${editor.doc.elements.filter(isEdge).length} connectors</dd>
        <dt>Internal ID</dt><dd class="mono faint">${esc(figure.id)}</dd>
      </dl>
    </div>
    <div class="ed-sec"><div class="ed-label">Referenced in</div>
      ${usages.length ? `<ul class="ed-usages">${usages.map((u) => `<li><a href="${href(project.id, 'chapters', null, { focus: u.ownerId })}">${icon('link', 'icon-sm')} ${esc(u.ownerTitle)}</a></li>`).join('')}</ul>`
        : `<p class="faint ed-small">Not referenced in any chapter yet. Use “Insert reference” in Chapters so “${esc(info?.label || 'Figure')}” updates automatically.</p>`}
    </div>
    <div class="ed-sec"><div class="ed-label">Template</div>
      <p class="faint ed-small">Replace the diagram with the starter template of the selected type. You can undo this.</p>
      <button class="btn btn-sm" data-action="apply-template">${icon('wand', 'icon-sm')} Reset to template</button>
    </div>`;
}

// --------------------------------------------------------------- History tab
export function historyPanelHTML(project, figure, revisionMode) {
  const versions = [...figure.versions].reverse();
  const dirty = isDirty(figure);
  const pending = dirty ? summarizeDiff(pendingChanges(figure)) : [];
  const latest = latestVersion(figure);
  return `<div class="ed-sec">
      ${dirty ? `<div class="callout callout-warning">${icon('history')}<div><strong>Unsaved version changes</strong><br>
        <span class="ed-small">${pending.slice(0, 4).map(esc).join(' · ') || 'Edited'}${pending.length > 4 ? ` · +${pending.length - 4} more` : ''}</span></div></div>`
        : `<div class="callout callout-success">${icon('checkCircle')}<div>Everything is saved in <strong>v${latest?.number ?? 0}</strong>.</div></div>`}
      <div class="ed-row" style="margin-top:10px">
        <button class="btn btn-sm btn-primary" data-action="save-version" ${dirty ? '' : 'disabled'}>${icon('save', 'icon-sm')} Save version</button>
        <button class="btn btn-sm ${revisionMode ? 'active' : ''}" data-action="toggle-revision">${icon('flag', 'icon-sm')} ${revisionMode ? 'Exit revision mode' : 'Revision mode'}</button>
      </div>
    </div>
    <div class="ed-timeline">
      ${versions.map((v) => `
        <div class="ed-version ${v.kind === 'revision' ? 'is-revision' : ''}">
          <div class="ed-version-dot"></div>
          <div class="grow">
            <div class="row" style="gap:6px;flex-wrap:wrap"><span class="badge ${v === latest ? 'badge-primary' : ''}">v${v.number}</span>
              ${v.kind === 'revision' ? `<span class="badge badge-warning">Revision #${v.revision}</span>` : ''}
              ${v.kind === 'restore' ? '<span class="badge badge-info">Restore</span>' : ''}
              ${v.kind === 'auto' ? '<span class="badge">Auto</span>' : ''}
              <strong class="ed-version-label">${esc(v.label)}</strong></div>
            <div class="faint ed-small">${esc(formatDateTime(v.createdAt))}${v.requestedBy ? ` · Requested by ${esc(v.requestedBy)}` : ''}</div>
            ${v.note ? `<div class="ed-version-note">${esc(v.note)}</div>` : ''}
            ${v.renamed?.length ? `<ul class="ed-changes">${v.renamed.slice(0, 3).map((r) => `<li><span class="ed-from">${esc(r.from || '∅')}</span> → <span class="ed-to">${esc(r.to || '∅')}</span></li>`).join('')}</ul>` : ''}
            ${v.changes?.length ? `<ul class="ed-changes">${v.changes.filter((c) => !c.startsWith('Changed “')).slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
            <div class="row" style="gap:6px;margin-top:6px">
              <button class="btn btn-sm" data-action="view-version" data-value="${v.id}">${icon('eye', 'icon-sm')} View</button>
              ${v !== latest || dirty ? `<button class="btn btn-sm" data-action="restore-version" data-value="${v.id}">${icon('history', 'icon-sm')} Restore</button>` : ''}
            </div>
          </div>
        </div>`).join('') || '<p class="faint ed-small" style="padding:0 16px">No versions yet.</p>'}
    </div>`;
}

// -------------------------------------------------------------- Comments tab
export function commentsPanelHTML(figure, editor, filter = 'open') {
  const list = figure.comments.filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved));
  const sel = editor.selectedElements();
  const target = sel.length === 1 ? sel[0] : null;
  const openCount = figure.comments.filter((c) => !c.resolved).length;
  return `<div class="ed-sec">
      <textarea class="textarea" rows="3" data-comment-input placeholder="${target ? `Comment on “${esc(elementLabel(target))}”…` : 'Add a comment on this figure…'}"></textarea>
      <div class="ed-row" style="margin-top:8px;justify-content:space-between">
        <span class="faint ed-small">${target ? `${icon('link', 'icon-sm')} Attached to selected element` : 'Select an element to attach the comment to it'}</span>
        <button class="btn btn-sm btn-primary" data-action="add-comment">Comment</button>
      </div>
    </div>
    <div class="ed-sec" style="padding-top:0">
      <div class="segmented ed-full">
        <button class="${filter === 'open' ? 'active' : ''}" data-action="comment-filter" data-value="open">Open (${openCount})</button>
        <button class="${filter === 'resolved' ? 'active' : ''}" data-action="comment-filter" data-value="resolved">Resolved</button>
        <button class="${filter === 'all' ? 'active' : ''}" data-action="comment-filter" data-value="all">All</button>
      </div>
    </div>
    <div class="ed-comments">
      ${list.map((c) => {
        const el = c.elementId ? editor.byId(c.elementId) : null;
        return `<div class="ed-comment ${c.resolved ? 'resolved' : ''}">
          <div class="row" style="gap:8px"><span class="project-avatar ed-avatar">${esc((c.author || 'Y')[0])}</span>
            <div class="grow"><strong>${esc(c.author || 'You')}</strong> <span class="faint ed-small">${esc(relativeTime(c.createdAt))}</span></div></div>
          ${c.elementId ? `<button class="ed-comment-target" data-action="focus-element" data-value="${esc(c.elementId)}" ${el ? '' : 'disabled'}>${icon('link', 'icon-sm')} ${el ? esc(elementLabel(el)) : 'Element was deleted'}</button>` : ''}
          <p>${esc(c.text)}</p>
          <div class="row" style="gap:6px">
            <button class="btn btn-sm btn-ghost" data-action="resolve-comment" data-value="${c.id}">${icon(c.resolved ? 'refresh' : 'check', 'icon-sm')} ${c.resolved ? 'Reopen' : 'Resolve'}</button>
            <button class="btn btn-sm btn-ghost" data-action="delete-comment" data-value="${c.id}">${icon('trash', 'icon-sm')} Delete</button>
          </div>
        </div>`;
      }).join('') || `<p class="faint ed-small" style="padding:4px 16px">${filter === 'open' ? 'No open comments. Use comments to track supervisor feedback.' : 'Nothing here.'}</p>`}
    </div>`;
}
