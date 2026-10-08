// Interactive SVG diagram editor: tools, selection, drag/resize with smart
// guides & grid snapping, smart connectors that stay attached to shapes,
// inline text editing, clipboard, z-order, alignment, zoom/pan, undo/redo.
//
// Events: 'change' (document mutated — persist it), 'selection', 'view',
// 'tool', 'history', 'context' ({ x, y, element }), 'comment-click' (elementId), 'edit-start'/'edit-end'.
import { Emitter } from '../../core/events.js';
import { uid, clamp, clone } from '../../core/utils.js';
import { renderElements, computeBounds, nodeMap, isNode, isEdge, textBoxOf, resolveNodeStyle, resolveEdgeStyle, defsFor } from '../render.js';
import { getShape } from '../shapes.js';
import { edgeGeometry, pathMidpoint, PORTS, anchorPoint, dist } from '../geometry.js';
import { fontStack } from '../text-layout.js';
import { History } from './history.js';
import { blobURLFor } from './image-import.js';
import { t } from '../../i18n/index.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
const SHAPE_TOOLS = { rect: 'rect', roundRect: 'roundRect', circle: 'circle', ellipse: 'ellipse', diamond: 'diamond', text: 'text' };
const EDGE_TOOLS = {
  line: { routing: 'straight', style: { endArrow: 'none' } },
  arrow: { routing: 'straight', style: { endArrow: 'arrow' } },
  connector: { routing: 'orthogonal', style: { endArrow: 'arrow' } },
};
const CLIP_KEY = 'graddocs:clipboard';
// Undo snapshots keep a short token instead of a picture's (huge) data URL.
const IMG_TOKEN = '\u0001img:';

export class DiagramEditor extends Emitter {
  constructor(host, diagram, { readOnly = false } = {}) {
    super();
    this.host = host;
    this.doc = clone(diagram);
    if (!Array.isArray(this.doc.elements)) this.doc.elements = [];
    this.readOnly = readOnly;
    this.selection = new Set();
    this.tool = 'select';
    this.zoom = 1; this.panX = 40; this.panY = 40;
    this.grid = true; this.snap = true; this.gridSize = 10;
    this.history = new History();
    this.highlights = null;
    this.commentCounts = new Map();
    this.hoverId = null;
    this.drag = null;
    this.guides = [];
    this.editing = null;
    this.spaceDown = false;
    this.imagePool = { byToken: new Map(), bySrc: new Map() };
    this.#build();
    this.render();
  }

  // ------------------------------------------------------------------ setup
  #build() {
    this.host.classList.add('ed-canvas');
    this.host.tabIndex = 0;
    this.host.innerHTML = `
      <svg class="ed-svg" xmlns="${SVGNS}">
        <defs>
          <pattern id="ed-grid" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="0.6" cy="0.6" r="0.6" class="ed-grid-dot"/></pattern>
          <pattern id="ed-grid-major" patternUnits="userSpaceOnUse" width="50" height="50"><circle cx="0.9" cy="0.9" r="0.9" class="ed-grid-dot major"/></pattern>
        </defs>
        <rect class="ed-bg" width="100%" height="100%"/>
        <rect class="ed-gridlayer" width="100%" height="100%" fill="url(#ed-grid)"/>
        <rect class="ed-gridlayer major" width="100%" height="100%" fill="url(#ed-grid-major)"/>
        <g class="ed-viewport"><g class="ed-defs"></g><g class="ed-content"></g><g class="ed-overlay"></g></g>
      </svg>
      <textarea class="ed-text-editor" spellcheck="true" hidden aria-label="${t('Edit text')}"></textarea>`;
    this.svg = this.host.querySelector('svg');
    this.viewport = this.host.querySelector('.ed-viewport');
    this.defsLayer = this.host.querySelector('.ed-defs');
    this.content = this.host.querySelector('.ed-content');
    this.overlay = this.host.querySelector('.ed-overlay');
    this.textarea = this.host.querySelector('.ed-text-editor');
    this.patterns = [...this.host.querySelectorAll('pattern')];
    this.gridLayers = [...this.host.querySelectorAll('.ed-gridlayer')];

    this._onDown = (e) => this.#pointerDown(e);
    this._onMove = (e) => this.#pointerMove(e);
    this._onUp = (e) => this.#pointerUp(e);
    this._onWheel = (e) => this.#wheel(e);
    this._onCtx = (e) => this.#contextMenu(e);
    this._onLeave = () => { if (!this.drag && this.hoverId) { this.hoverId = null; this.renderOverlay(); } };
    this.host.addEventListener('pointerdown', this._onDown);
    this.host.addEventListener('pointermove', this._onMove);
    this.host.addEventListener('pointerup', this._onUp);
    this.host.addEventListener('pointercancel', this._onUp);
    this.host.addEventListener('pointerleave', this._onLeave);
    this.host.addEventListener('wheel', this._onWheel, { passive: false });
    this.host.addEventListener('contextmenu', this._onCtx);
    this.textarea.addEventListener('keydown', (e) => this.#textKey(e));
    this.textarea.addEventListener('input', () => this.#layoutTextarea());
    this.textarea.addEventListener('blur', () => this.commitTextEdit());
    this.resizeObserver = new ResizeObserver(() => this.#applyView());
    this.resizeObserver.observe(this.host);
  }

  destroy() {
    this.commitTextEdit();
    this.resizeObserver.disconnect();
    this.host.removeEventListener('pointerdown', this._onDown);
    this.host.removeEventListener('pointermove', this._onMove);
    this.host.removeEventListener('pointerup', this._onUp);
    this.host.removeEventListener('pointercancel', this._onUp);
    this.host.removeEventListener('pointerleave', this._onLeave);
    this.host.removeEventListener('wheel', this._onWheel);
    this.host.removeEventListener('contextmenu', this._onCtx);
    this.host.innerHTML = '';
  }

  // --------------------------------------------------------------- document
  get elements() { return this.doc.elements; }
  byId(id) { return this.doc.elements.find((el) => el.id === id) || null; }
  selectedElements() { return this.doc.elements.filter((el) => this.selection.has(el.id)); }
  snapshot() {
    return JSON.stringify({ elements: this.doc.elements, background: this.doc.background, defaults: this.doc.defaults },
      (key, value) => (key === 'src' && typeof value === 'string' && value.length > 4000 ? this.#imageToken(value) : value));
  }

  #imageToken(src) {
    let token = this.imagePool.bySrc.get(src);
    if (!token) { token = `${IMG_TOKEN}${this.imagePool.bySrc.size}`; this.imagePool.bySrc.set(src, token); this.imagePool.byToken.set(token, src); }
    return token;
  }

  #restore(snap) {
    const data = JSON.parse(snap, (key, value) => (typeof value === 'string' && value.startsWith(IMG_TOKEN) ? (this.imagePool.byToken.get(value) ?? value) : value));
    this.doc.elements = data.elements;
    this.doc.background = data.background;
    this.doc.defaults = data.defaults;
    for (const id of [...this.selection]) if (!this.byId(id)) this.selection.delete(id);
  }

  /** Apply a mutation with undo support. fn(doc) may mutate freely. */
  mutate(fn, { merge = null } = {}) {
    if (this.readOnly) return;
    const before = this.snapshot();
    fn(this.doc);
    this.#afterMutation(before, merge);
  }

  #afterMutation(before, merge = null) {
    const after = this.snapshot();
    if (after === before) { this.renderOverlay(); return false; }
    this.history.record(before, merge);
    this.render();
    this.emit('change');
    this.emit('history');
    return true;
  }

  /** Replace the whole diagram (e.g. restoring a version) as one undoable step. */
  replaceDiagram(diagram) {
    this.mutate((doc) => {
      doc.elements = clone(diagram.elements || []);
      doc.background = diagram.background ?? doc.background;
      doc.defaults = { ...(doc.defaults || {}), ...(diagram.defaults || {}) };
    });
    this.selection.clear();
    this.emit('selection');
  }

  undo() {
    this.commitTextEdit();
    const snap = this.history.undo(this.snapshot());
    if (!snap) return;
    this.#restore(snap); this.render(); this.emit('change'); this.emit('history'); this.emit('selection');
  }

  redo() {
    this.commitTextEdit();
    const snap = this.history.redo(this.snapshot());
    if (!snap) return;
    this.#restore(snap); this.render(); this.emit('change'); this.emit('history'); this.emit('selection');
  }

  // -------------------------------------------------------------- selection
  select(ids, { add = false } = {}) {
    if (!add) this.selection.clear();
    for (const id of [].concat(ids)) if (id && this.byId(id)) this.selection.add(id);
    this.renderOverlay();
    this.emit('selection');
  }
  clearSelection() { if (!this.selection.size) return; this.selection.clear(); this.renderOverlay(); this.emit('selection'); }
  selectAll() { this.select(this.doc.elements.map((el) => el.id)); }

  setTool(tool) {
    this.commitTextEdit();
    this.tool = tool;
    this.host.dataset.tool = tool;
    this.emit('tool', tool);
    this.renderOverlay();
  }

  setHighlights(map) { this.highlights = map && map.size ? map : null; this.render(); }
  setCommentCounts(map) { this.commentCounts = map || new Map(); this.renderOverlay(); }

  // -------------------------------------------------------------- rendering
  render() {
    this.defsLayer.innerHTML = defsFor(this.doc);
    this.content.innerHTML = renderElements(this.doc, { mode: 'edit', hideTextId: this.editing?.id, highlights: this.highlights, imageHref: blobURLFor });
    this.host.style.setProperty('--ed-paper', this.doc.background && this.doc.background !== 'transparent' ? this.doc.background : '#ffffff');
    this.renderOverlay();
    this.#applyView();
  }

  #applyView() {
    this.viewport.setAttribute('transform', `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    const g = this.gridSize;
    this.patterns[0].setAttribute('width', g); this.patterns[0].setAttribute('height', g);
    this.patterns[1].setAttribute('width', g * 5); this.patterns[1].setAttribute('height', g * 5);
    for (const p of this.patterns) p.setAttribute('patternTransform', `translate(${this.panX} ${this.panY}) scale(${this.zoom})`);
    this.gridLayers[0].style.display = this.grid && this.zoom >= 0.5 ? '' : 'none';
    this.gridLayers[1].style.display = this.grid ? '' : 'none';
    if (this.editing) this.#layoutTextarea();
  }

  renderOverlay() {
    const z = this.zoom;
    const parts = [];
    const sel = this.selectedElements();
    const nodes = nodeMap(this.doc);
    const single = sel.length === 1 ? sel[0] : null;

    for (const el of sel) {
      if (isNode(el)) {
        parts.push(`<rect class="ed-sel-box" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" stroke-width="${1.25 / z}"/>`);
      } else if (isEdge(el)) {
        const g = edgeGeometry(el, nodes);
        const d = g.curve ? `M${g.points[0].x},${g.points[0].y} C${g.curve.c1.x},${g.curve.c1.y} ${g.curve.c2.x},${g.curve.c2.y} ${g.points[g.points.length - 1].x},${g.points[g.points.length - 1].y}` : g.points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
        parts.push(`<path class="ed-sel-edge" d="${d}" stroke-width="${(Number(resolveEdgeStyle(el, this.doc).strokeWidth) + 5) / z}"/>`);
        if (single && !this.readOnly) {
          const a = g.points[0]; const b = g.points[g.points.length - 1];
          parts.push(this.#endHandle(a, 'source', !!el.source?.id, z), this.#endHandle(b, 'target', !!el.target?.id, z));
        }
      }
    }
    if (single && isNode(single) && !this.readOnly && !single.locked && single.shape !== 'point') {
      const hs = 8 / z;
      for (const h of HANDLES) {
        const p = handlePoint(single, h);
        parts.push(`<rect class="ed-handle" data-handle="${h}" x="${p.x - hs / 2}" y="${p.y - hs / 2}" width="${hs}" height="${hs}" rx="${1.5 / z}" stroke-width="${1.25 / z}" style="cursor:${CURSORS[h]}"/>`);
      }
    }

    // Connection ports on the hovered node (or drop target while connecting).
    const portNode = this.drag?.hoverTarget ? nodes.get(this.drag.hoverTarget.id) : (this.hoverId && !this.drag ? nodes.get(this.hoverId) : null);
    const showPorts = portNode && !this.readOnly && (this.tool === 'select' || EDGE_TOOLS[this.tool] || this.drag) && getShape(portNode.shape).outline !== 'lifeline';
    if (portNode && this.drag?.hoverTarget) {
      parts.push(`<rect class="ed-target-box" x="${portNode.x - 3 / z}" y="${portNode.y - 3 / z}" width="${portNode.w + 6 / z}" height="${portNode.h + 6 / z}" rx="${4 / z}" stroke-width="${2 / z}"/>`);
    }
    if (showPorts) {
      const active = this.drag?.hoverTarget?.anchor;
      for (const [side, a] of Object.entries(PORTS)) {
        const p = anchorPoint(portNode, a);
        const on = active && active.x === a.x && active.y === a.y;
        parts.push(`<circle class="ed-port ${on ? 'active' : ''}" data-port="${side}" data-node="${portNode.id}" cx="${p.x}" cy="${p.y}" r="${(on ? 6 : 4.5) / z}" stroke-width="${1.5 / z}"/>`);
      }
    }

    if (this.drag?.type === 'marquee') {
      const r = rectFrom(this.drag.start, this.drag.current);
      parts.push(`<rect class="ed-marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" stroke-width="${1 / z}"/>`);
    }
    if (this.drag?.type === 'create' && this.drag.moved) {
      const r = rectFrom(this.drag.start, this.drag.current);
      parts.push(`<rect class="ed-marquee" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" stroke-width="${1 / z}"/>`);
    }
    if ((this.drag?.type === 'edge-create' || this.drag?.type === 'edge-end') && this.drag.preview) {
      const { a, b } = this.drag.preview;
      parts.push(`<path class="ed-connect-preview" d="M${a.x},${a.y} L${b.x},${b.y}" stroke-width="${1.5 / z}" stroke-dasharray="${5 / z} ${4 / z}"/>`);
    }
    for (const g of this.guides) {
      parts.push(`<line class="ed-guide" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke-width="${1 / z}"/>`);
    }
    // Comment badges
    for (const [id, count] of this.commentCounts) {
      const el = this.byId(id);
      if (!el || !count) continue;
      let p;
      if (isNode(el)) p = { x: el.x + el.w, y: el.y };
      else { try { p = pathMidpoint(edgeGeometry(el, nodes)); } catch { continue; } }
      parts.push(`<g class="ed-comment-badge" data-comment="${id}" transform="translate(${p.x} ${p.y}) scale(${1 / z})"><circle r="10"/><text y="4" text-anchor="middle">${count}</text></g>`);
    }
    this.overlay.innerHTML = parts.join('');
  }

  #endHandle(p, which, attached, z) {
    return `<circle class="ed-end-handle ${attached ? 'attached' : ''}" data-edge-end="${which}" cx="${p.x}" cy="${p.y}" r="${5.5 / z}" stroke-width="${1.5 / z}"/>`;
  }

  // ----------------------------------------------------------------- view
  screenToDiagram(clientX, clientY) {
    const r = this.host.getBoundingClientRect();
    return { x: (clientX - r.left - this.panX) / this.zoom, y: (clientY - r.top - this.panY) / this.zoom };
  }

  diagramToScreen(x, y) { return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY }; }

  setZoom(z, anchor = null) {
    const nz = clamp(z, 0.1, 4);
    const r = this.host.getBoundingClientRect();
    const ax = anchor ? anchor.x : r.width / 2; const ay = anchor ? anchor.y : r.height / 2;
    const dx = (ax - this.panX) / this.zoom; const dy = (ay - this.panY) / this.zoom;
    this.zoom = nz;
    this.panX = ax - dx * nz; this.panY = ay - dy * nz;
    this.#applyView(); this.renderOverlay(); this.emit('view');
  }
  zoomIn() { this.setZoom(this.zoom * 1.2); }
  zoomOut() { this.setZoom(this.zoom / 1.2); }
  zoomReset() { this.setZoom(1); }

  fit({ maxZoom = 1.5 } = {}) {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const b = computeBounds(this.doc);
    if (b.empty) { this.zoom = 1; this.panX = 40; this.panY = 40; this.#applyView(); this.renderOverlay(); this.emit('view'); return; }
    const pad = 48;
    const z = clamp(Math.min((r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2) / Math.max(1, b.h), maxZoom), 0.1, 4);
    this.zoom = z;
    this.panX = (r.width - b.w * z) / 2 - b.x * z;
    this.panY = (r.height - b.h * z) / 2 - b.y * z;
    this.#applyView(); this.renderOverlay(); this.emit('view');
  }

  centerOn(id) {
    const el = this.byId(id);
    if (!el) return;
    const r = this.host.getBoundingClientRect();
    let c;
    if (isNode(el)) c = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
    else c = pathMidpoint(edgeGeometry(el, nodeMap(this.doc)));
    this.panX = r.width / 2 - c.x * this.zoom; this.panY = r.height / 2 - c.y * this.zoom;
    this.#applyView(); this.renderOverlay(); this.emit('view');
  }

  setGrid(on) { this.grid = on; this.#applyView(); this.emit('view'); }
  setSnap(on) { this.snap = on; this.emit('view'); }

  // -------------------------------------------------------------- hit tests
  #elementFromEvent(e) {
    const g = e.target instanceof Element ? e.target.closest('[data-id]') : null;
    return g && this.content.contains(g) ? this.byId(g.dataset.id) : null;
  }

  /** Top-most node under a diagram point (container interiors are ignored). */
  nodeAt(p, exclude = null) {
    const tol = 6 / this.zoom;
    for (let i = this.doc.elements.length - 1; i >= 0; i -= 1) {
      const el = this.doc.elements[i];
      if (!isNode(el) || exclude?.has(el.id)) continue;
      const pad = el.shape === 'point' ? 6 / this.zoom : 0;
      const extraBottom = el.shape === 'actor' ? 22 : 0;
      if (p.x < el.x - pad || p.x > el.x + el.w + pad || p.y < el.y - pad || p.y > el.y + el.h + pad + extraBottom) continue;
      if (getShape(el.shape).container) {
        const near = p.x - el.x < tol * 2 || el.x + el.w - p.x < tol * 2 || p.y - el.y < 34 || el.y + el.h - p.y < tol * 2;
        if (!near) continue;
      }
      return el;
    }
    return null;
  }

  #anchorFor(node, p) {
    const shape = getShape(node.shape);
    if (shape.outline === 'lifeline') {
      const top = Math.min(44, node.h) / node.h;
      return { x: 0.5, y: clamp((p.y - node.y) / node.h, top + 0.02, 1) };
    }
    const tol = 14 / this.zoom;
    for (const a of Object.values(PORTS)) if (dist(p, anchorPoint(node, a)) <= tol) return { ...a };
    return null;
  }

  #snapValue(v) { return this.snap ? Math.round(v / this.gridSize) * this.gridSize : v; }
  #snapPoint(p) { return { x: this.#snapValue(p.x), y: this.#snapValue(p.y) }; }

  // --------------------------------------------------------------- pointer
  #pointerDown(e) {
    if (this.editing && e.target === this.textarea) return;
    if (this.editing) this.commitTextEdit();
    this.host.focus({ preventScroll: true });
    if (e.button === 2) return; // context menu handles right click
    const p = this.screenToDiagram(e.clientX, e.clientY);
    const target = e.target instanceof Element ? e.target : null;

    // Pan: middle button, hand tool, or space held.
    if (e.button === 1 || this.tool === 'hand' || this.spaceDown) {
      e.preventDefault();
      this.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, px: this.panX, py: this.panY };
      this.host.setPointerCapture(e.pointerId); this.host.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;

    // Double-click detection (native dblclick is unreliable because the
    // canvas re-renders between clicks).
    const now = performance.now();
    const hitEl = this.#elementFromEvent(e);
    const last = this._lastDown;
    this._lastDown = { t: now, x: e.clientX, y: e.clientY, id: hitEl?.id || null };
    if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6 && last.id === (hitEl?.id || null)
      && this.tool === 'select' && !this.readOnly && !target?.closest('[data-handle],[data-port],[data-edge-end],[data-comment]')) {
      this._lastDown = null;
      e.preventDefault();
      this.drag = { type: 'dblclick', element: hitEl, point: p };
      this.host.setPointerCapture(e.pointerId);
      return;
    }

    const badge = target?.closest('[data-comment]');
    if (badge) { this.emit('comment-click', badge.dataset.comment); return; }
    if (this.readOnly) { const el = this.#elementFromEvent(e); if (el) this.select(el.id); else this.clearSelection(); return; }

    const before = this.snapshot();
    const handle = target?.closest('[data-handle]');
    if (handle) {
      const el = this.selectedElements()[0];
      this.drag = { type: 'resize', id: el.id, handle: handle.dataset.handle, box: { x: el.x, y: el.y, w: el.w, h: el.h }, before };
      this.host.setPointerCapture(e.pointerId);
      return;
    }
    const end = target?.closest('[data-edge-end]');
    if (end) {
      const edge = this.selectedElements()[0];
      this.drag = { type: 'edge-end', id: edge.id, which: end.dataset.edgeEnd, before, preview: null };
      this.host.setPointerCapture(e.pointerId);
      return;
    }
    const port = target?.closest('[data-port]');
    if (port && (this.tool === 'select' || EDGE_TOOLS[this.tool])) {
      const node = this.byId(port.dataset.node);
      const def = EDGE_TOOLS[this.tool] || EDGE_TOOLS.connector;
      this.drag = { type: 'edge-create', source: { id: node.id }, sourcePoint: anchorPoint(node, PORTS[port.dataset.port]), def, before, preview: null };
      this.host.setPointerCapture(e.pointerId);
      return;
    }

    if (SHAPE_TOOLS[this.tool]) {
      this.drag = { type: 'create', shape: SHAPE_TOOLS[this.tool], start: this.#snapPoint(p), current: this.#snapPoint(p), moved: false, before };
      this.host.setPointerCapture(e.pointerId);
      return;
    }
    if (EDGE_TOOLS[this.tool]) {
      const node = this.nodeAt(p);
      const source = node ? { id: node.id, ...(this.#anchorFor(node, p) ? { anchor: this.#anchorFor(node, p) } : {}) } : this.#snapPoint(p);
      const sourcePoint = node ? (source.anchor ? anchorPoint(node, source.anchor) : { x: node.x + node.w / 2, y: node.y + node.h / 2 }) : source;
      this.drag = { type: 'edge-create', source, sourcePoint, def: EDGE_TOOLS[this.tool], before, preview: null, fromTool: true };
      this.host.setPointerCapture(e.pointerId);
      return;
    }

    // Select tool
    const el = this.#elementFromEvent(e);
    if (el) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (additive) {
        if (this.selection.has(el.id)) this.selection.delete(el.id); else this.selection.add(el.id);
        this.emit('selection');
      } else if (!this.selection.has(el.id)) {
        this.selection.clear(); this.selection.add(el.id); this.emit('selection');
      }
      this.renderOverlay();
      if (this.selection.has(el.id)) this.#startMove(p, before, el.id, e);
      return;
    }
    // Empty canvas → marquee
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) this.clearSelection();
    this.drag = { type: 'marquee', start: p, current: p, additive: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(this.selection) };
    this.host.setPointerCapture(e.pointerId);
  }

  #startMove(p, before, clickedId, e) {
    const ids = new Set();
    const nodes = this.selectedElements().filter((x) => isNode(x) && !x.locked);
    for (const n of nodes) {
      ids.add(n.id);
      if (getShape(n.shape).container) {
        for (const other of this.doc.elements) {
          if (isNode(other) && other !== n && other.x >= n.x && other.y >= n.y && other.x + other.w <= n.x + n.w && other.y + other.h <= n.y + n.h) ids.add(other.id);
        }
      }
    }
    const origin = new Map();
    for (const id of ids) { const n = this.byId(id); origin.set(id, { x: n.x, y: n.y }); }
    const edgeOrigin = new Map();
    for (const el of this.selectedElements()) {
      if (!isEdge(el)) continue;
      edgeOrigin.set(el.id, { source: clone(el.source), target: clone(el.target) });
    }
    const bbox = unionBox([...ids].map((id) => this.byId(id)));
    const others = this.doc.elements.filter((x) => isNode(x) && !ids.has(x.id));
    this.drag = { type: 'move', start: p, before, origin, edgeOrigin, bbox, others, moved: false, clickedId, additive: e.shiftKey || e.ctrlKey || e.metaKey };
    this.host.setPointerCapture(e.pointerId);
  }

  #pointerMove(e) {
    const p = this.screenToDiagram(e.clientX, e.clientY);
    const d = this.drag;
    if (!d) {
      // Hover feedback for ports.
      if (this.tool === 'select' || EDGE_TOOLS[this.tool]) {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('[data-port]')) return;
        const node = this.nodeAt(p);
        const id = node && node.shape !== 'point' ? node.id : null;
        if (id !== this.hoverId) { this.hoverId = id; this.renderOverlay(); }
      }
      return;
    }
    if (d.type === 'pan') {
      this.panX = d.px + (e.clientX - d.sx); this.panY = d.py + (e.clientY - d.sy);
      this.#applyView(); this.emit('view');
      return;
    }
    if (d.type === 'marquee') {
      d.current = p;
      const r = rectFrom(d.start, d.current);
      const nodes = nodeMap(this.doc);
      this.selection = new Set(d.additive ? d.base : []);
      for (const el of this.doc.elements) {
        if (isNode(el) && el.x >= r.x && el.y >= r.y && el.x + el.w <= r.x + r.w && el.y + el.h <= r.y + r.h) this.selection.add(el.id);
        if (isEdge(el)) {
          try {
            const g = edgeGeometry(el, nodes);
            if (g.points.every((q) => q.x >= r.x && q.y >= r.y && q.x <= r.x + r.w && q.y <= r.y + r.h)) this.selection.add(el.id);
          } catch { /* ignore */ }
        }
      }
      this.renderOverlay();
      return;
    }
    if (d.type === 'move') {
      let dx = p.x - d.start.x; let dy = p.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
      d.moved = true;
      ({ dx, dy } = this.#snapMove(d, dx, dy, e.altKey));
      for (const [id, o] of d.origin) { const n = this.byId(id); n.x = o.x + dx; n.y = o.y + dy; }
      for (const [id, o] of d.edgeOrigin) {
        const edge = this.byId(id);
        if (!edge.source?.id) edge.source = { x: o.source.x + dx, y: o.source.y + dy };
        if (!edge.target?.id) edge.target = { x: o.target.x + dx, y: o.target.y + dy };
      }
      this.render();
      return;
    }
    if (d.type === 'resize') {
      this.#resize(d, p, e.shiftKey);
      this.render();
      return;
    }
    if (d.type === 'create') {
      d.current = this.#snapPoint(p);
      if (dist(d.start, d.current) * this.zoom > 4) d.moved = true;
      this.renderOverlay();
      return;
    }
    if (d.type === 'edge-create' || d.type === 'edge-end') {
      const node = this.nodeAt(p);
      d.hoverTarget = node && node.shape !== 'point' ? { id: node.id, anchor: this.#anchorFor(node, p) } : (node ? { id: node.id, anchor: null } : null);
      d.current = p;
      if (d.type === 'edge-create') {
        d.preview = { a: d.sourcePoint, b: d.hoverTarget?.anchor ? anchorPoint(node, d.hoverTarget.anchor) : p };
        d.moved = d.moved || dist(d.sourcePoint, p) * this.zoom > 6;
        this.renderOverlay();
      } else {
        const edge = this.byId(d.id);
        edge[d.which] = d.hoverTarget ? { id: d.hoverTarget.id, ...(d.hoverTarget.anchor ? { anchor: d.hoverTarget.anchor } : {}) } : this.#snapPoint(p);
        d.moved = true;
        this.render();
      }
    }
  }

  #snapMove(d, dx, dy, disable) {
    this.guides = [];
    if (disable) return { dx, dy };
    const b = d.bbox;
    if (!b) return { dx: this.snap ? this.#snapValue(dx) : dx, dy: this.snap ? this.#snapValue(dy) : dy };
    const thr = 6 / this.zoom;
    const moving = { l: b.x + dx, c: b.x + b.w / 2 + dx, r: b.x + b.w + dx, t: b.y + dy, m: b.y + b.h / 2 + dy, b: b.y + b.h + dy };
    let bestX = null; let bestY = null;
    for (const o of d.others) {
      const ox = [o.x, o.x + o.w / 2, o.x + o.w]; const oy = [o.y, o.y + o.h / 2, o.y + o.h];
      for (const mv of [moving.l, moving.c, moving.r]) for (const v of ox) {
        const diff = v - mv;
        if (Math.abs(diff) < thr && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) bestX = { diff, v, o };
      }
      for (const mv of [moving.t, moving.m, moving.b]) for (const v of oy) {
        const diff = v - mv;
        if (Math.abs(diff) < thr && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) bestY = { diff, v, o };
      }
    }
    if (bestX) dx += bestX.diff; else if (this.snap) dx = this.#snapValue(b.x + dx) - b.x;
    if (bestY) dy += bestY.diff; else if (this.snap) dy = this.#snapValue(b.y + dy) - b.y;
    if (bestX) {
      const y1 = Math.min(b.y + dy, bestX.o.y); const y2 = Math.max(b.y + b.h + dy, bestX.o.y + bestX.o.h);
      this.guides.push({ x1: bestX.v, y1: y1 - 10, x2: bestX.v, y2: y2 + 10 });
    }
    if (bestY) {
      const x1 = Math.min(b.x + dx, bestY.o.x); const x2 = Math.max(b.x + b.w + dx, bestY.o.x + bestY.o.w);
      this.guides.push({ x1: x1 - 10, y1: bestY.v, x2: x2 + 10, y2: bestY.v });
    }
    return { dx, dy };
  }

  #resize(d, p, keepRatio) {
    const el = this.byId(d.id);
    const shape = getShape(el.shape);
    const min = 8;
    let { x, y, w, h } = d.box;
    const px = this.#snapValue(p.x); const py = this.#snapValue(p.y);
    if (d.handle.includes('e')) w = Math.max(min, px - x);
    if (d.handle.includes('s')) h = Math.max(min, py - y);
    if (d.handle.includes('w')) { const nx = Math.min(px, x + w - min); w = x + w - nx; x = nx; }
    if (d.handle.includes('n')) { const ny = Math.min(py, y + h - min); h = y + h - ny; y = ny; }
    if (shape.aspect || keepRatio) {
      const ratio = d.box.w / d.box.h;
      if (d.handle.length === 1 && (d.handle === 'n' || d.handle === 's')) w = h * ratio;
      else if (d.handle.length === 1) h = w / ratio;
      else if (w / h > ratio) h = w / ratio; else w = h * ratio;
      if (d.handle.includes('w')) x = d.box.x + d.box.w - w;
      if (d.handle.includes('n')) y = d.box.y + d.box.h - h;
    }
    Object.assign(el, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }

  #pointerUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.guides = [];
    try { this.host.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.host.classList.remove('panning');
    if (d.type === 'pan') return;
    if (d.type === 'dblclick') { setTimeout(() => this.#doubleClick(d.element, d.point), 0); return; }
    if (d.type === 'marquee') { this.renderOverlay(); this.emit('selection'); return; }
    if (d.type === 'move') {
      if (!d.moved && !d.additive && d.clickedId && this.selection.size > 1) { this.select(d.clickedId); return; }
      this.#afterMutation(d.before);
      this.emit('selection');
      return;
    }
    if (d.type === 'resize') { this.#afterMutation(d.before); this.emit('selection'); return; }
    if (d.type === 'create') {
      const r = d.moved ? rectFrom(d.start, d.current) : null;
      const el = this.#nodeFromPreset({ shape: d.shape, text: d.shape === 'text' ? 'Text' : '' }, d.start, r);
      this.doc.elements.push(el);
      this.selection = new Set([el.id]);
      this.#afterMutation(d.before);
      this.setTool('select');
      this.emit('selection');
      if (d.shape !== 'circle') setTimeout(() => this.startTextEdit(el.id, { selectAll: true }), 0);
      return;
    }
    if (d.type === 'edge-create') {
      if (!d.moved) { this.renderOverlay(); return; }
      const p = d.current;
      const target = d.hoverTarget ? { id: d.hoverTarget.id, ...(d.hoverTarget.anchor ? { anchor: d.hoverTarget.anchor } : {}) } : this.#snapPoint(p);
      if (target.id && target.id === d.source.id && !d.source.anchor && !target.anchor) { this.renderOverlay(); return; }
      const edge = { id: uid('e'), type: 'edge', source: d.source.id ? d.source : { x: d.source.x, y: d.source.y }, target, routing: d.def.routing, text: '', style: { ...d.def.style } };
      this.doc.elements.push(edge);
      this.selection = new Set([edge.id]);
      this.#afterMutation(d.before);
      if (d.fromTool) this.setTool('select');
      this.emit('selection');
      return;
    }
    if (d.type === 'edge-end') { this.#afterMutation(d.before); this.emit('selection'); }
  }

  #nodeFromPreset(preset, at, rect = null) {
    const shape = getShape(preset.shape);
    const w = rect ? Math.max(10, rect.w) : (preset.w ?? shape.defaults.w);
    const h = rect ? Math.max(10, rect.h) : (preset.h ?? shape.defaults.h);
    const x = rect ? rect.x : this.#snapValue(at.x - w / 2);
    const y = rect ? rect.y : this.#snapValue(at.y - h / 2);
    return { id: uid('n'), type: 'node', shape: preset.shape, x, y, w, h: shape.aspect && rect ? w : h, text: preset.text ?? shape.defaults.text ?? '', style: clone(preset.style || {}) };
  }

  /** Centre of the visible canvas in diagram coordinates. */
  viewportCenter() {
    const r = this.host.getBoundingClientRect();
    return this.screenToDiagram(r.left + r.width / 2, r.top + r.height / 2);
  }

  /** Add a library preset at a diagram point (default: viewport centre). */
  addPreset(preset, at = null) {
    if (this.readOnly) return null;
    let p = at;
    if (!p) {
      p = this.viewportCenter();
      // Avoid stacking exactly on top of the previous insert.
      const offset = (this._insertCount = ((this._insertCount || 0) + 1) % 6) * 20;
      p = { x: p.x + offset, y: p.y + offset };
    }
    if (preset.edge) return this.#addEdgePreset(preset, p, !at);
    const el = this.#nodeFromPreset(preset, p);
    this.mutate((doc) => { doc.elements.push(el); });
    this.select(el.id);
    return el;
  }

  /**
   * Connector presets (data flow, sequence messages). With two shapes selected the connector joins them
   * (first selected → second selected; between lifelines it goes below the previous message).
   * Otherwise it is a free arrow whose ends you drag onto shapes.
   */
  #addEdgePreset(preset, p, fromClick) {
    const def = preset.edge;
    const picked = fromClick ? [...this.selection].map((id) => this.byId(id)).filter((el) => el && isNode(el) && el.shape !== 'point') : [];
    let source; let target;
    if (picked.length === 2) {
      const [a, b] = picked;
      if (getShape(a.shape).outline === 'lifeline' && getShape(b.shape).outline === 'lifeline') {
        const headA = Math.min(44, a.h);
        let y = a.y + headA + 50;
        for (const el of this.doc.elements) {
          if (!isEdge(el)) continue;
          for (const end of [el.source, el.target]) {
            const n = end?.id && end.anchor && (end.id === a.id || end.id === b.id) ? this.byId(end.id) : null;
            if (n) y = Math.max(y, n.y + end.anchor.y * n.h + 50);
          }
        }
        y = Math.min(this.#snapValue(y), a.y + a.h - 10);
        source = { id: a.id, anchor: { x: 0.5, y: (y - a.y) / a.h } };
        target = { id: b.id, anchor: { x: 0.5, y: (y - b.y) / b.h } };
      } else { source = { id: a.id }; target = { id: b.id }; }
    } else {
      const y = this.#snapValue(p.y);
      source = { x: this.#snapValue(p.x - 90), y }; target = { x: this.#snapValue(p.x + 90), y };
    }
    const edge = { id: uid('e'), type: 'edge', source, target, routing: def.routing || 'straight', text: def.text || '', style: clone(def.style || {}) };
    this.mutate((doc) => { doc.elements.push(edge); });
    this.select(edge.id);
    return edge;
  }

  /**
   * Add a picture ({ src: data URL, width, height }) as an 'image' element, centred on `at`
   * (default: the visible centre) and scaled down to fit the visible area. Undoable.
   */
  addImage({ src, width, height }, at = null) {
    if (this.readOnly || !src) return null;
    const host = this.host.getBoundingClientRect();
    let c = at;
    if (!c) {
      c = this.viewportCenter();
      const offset = (this._insertCount = ((this._insertCount || 0) + 1) % 6) * 20; // do not stack exactly on the previous insert
      c = { x: c.x + offset, y: c.y + offset };
    }
    const k = Math.min(1, (host.width * 0.8) / (this.zoom * width), (host.height * 0.8) / (this.zoom * height)) || 1;
    const w = Math.max(16, Math.round(width * k)); const h = Math.max(16, Math.round(height * k));
    const el = { id: uid('n'), type: 'node', shape: 'image', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, text: '', style: {}, src };
    this.mutate((doc) => { doc.elements.push(el); });
    this.select(el.id);
    return el;
  }

  #wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = this.host.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
      this.setZoom(this.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.panX -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      this.panY -= (e.shiftKey ? 0 : e.deltaY) * k;
      this.#applyView(); this.emit('view');
    }
  }

  #doubleClick(el, p) {
    if (this.readOnly) return;
    if (el) { this.select(el.id); this.startTextEdit(el.id); return; }
    // Double-click on empty canvas creates a text label.
    const node = this.#nodeFromPreset({ shape: 'text', text: '' }, p);
    this.mutate((doc) => doc.elements.push(node));
    this.select(node.id);
    this.startTextEdit(node.id);
  }

  #contextMenu(e) {
    e.preventDefault();
    const el = this.#elementFromEvent(e);
    if (el && !this.selection.has(el.id)) this.select(el.id);
    if (!el) this.clearSelection();
    this.emit('context', { x: e.clientX, y: e.clientY, element: el, point: this.screenToDiagram(e.clientX, e.clientY) });
  }

  // -------------------------------------------------------------- text edit
  startTextEdit(id, { selectAll = true } = {}) {
    if (this.readOnly) return;
    const el = this.byId(id);
    if (!el || (isNode(el) && el.shape === 'point')) return;
    this.commitTextEdit();
    this._lastDown = null;
    this.editing = { id, before: this.snapshot(), original: el.text || '' };
    this.render();
    const ta = this.textarea;
    ta.hidden = false;
    ta.value = el.text || '';
    this.#layoutTextarea();
    ta.focus();
    if (selectAll) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
    this.emit('edit-start', id);
  }

  #layoutTextarea() {
    if (!this.editing) return;
    const el = this.byId(this.editing.id);
    if (!el) { this.cancelTextEdit(); return; }
    const ta = this.textarea;
    const z = this.zoom;
    let box; let s;
    if (isNode(el)) {
      s = resolveNodeStyle(el, this.doc);
      const compartment = el.shape === 'class' || el.shape === 'entity';
      box = compartment ? { x: el.x, y: el.y, w: el.w, h: el.h } : textBoxOf(el);
      ta.style.textAlign = compartment ? 'left' : s.align;
    } else {
      s = resolveEdgeStyle(el, this.doc);
      const mid = pathMidpoint(edgeGeometry(el, nodeMap(this.doc)));
      box = { x: mid.x - 90, y: mid.y - 16, w: 180, h: 32 };
      ta.style.textAlign = 'center';
    }
    const tl = this.diagramToScreen(box.x, box.y);
    const fs = s.fontSize * z;
    ta.style.fontFamily = fontStack(s.fontFamily);
    ta.style.fontSize = `${fs}px`;
    ta.style.fontWeight = s.fontWeight === 'bold' ? '700' : '400';
    ta.style.fontStyle = s.fontStyle === 'italic' ? 'italic' : 'normal';
    ta.style.color = s.textColor || '#111827';
    ta.style.left = `${tl.x}px`;
    ta.style.width = `${Math.max(60, box.w * z)}px`;
    ta.style.height = 'auto';
    const contentH = Math.max(fs * 1.25 + 8, ta.scrollHeight);
    const boxH = box.h * z;
    ta.style.height = `${Math.max(contentH, Math.min(boxH, contentH))}px`;
    const top = s.vAlign === 'top' ? tl.y : s.vAlign === 'bottom' ? tl.y + boxH - contentH : tl.y + (boxH - contentH) / 2;
    ta.style.top = `${top}px`;
  }

  #textKey(e) {
    e.stopPropagation();
    const el = this.editing && this.byId(this.editing.id);
    const multiline = el && (el.shape === 'class' || el.shape === 'entity');
    if (e.key === 'Escape') { e.preventDefault(); this.cancelTextEdit(); this.host.focus(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!multiline && !e.shiftKey))) { e.preventDefault(); this.commitTextEdit(); this.host.focus(); }
  }

  commitTextEdit() {
    if (!this.editing) return;
    const { id, before } = this.editing;
    this._lastDown = null;
    const el = this.byId(id);
    const value = this.textarea.value.replace(/\s+$/, '');
    this.editing = null;
    this.textarea.hidden = true;
    if (el) {
      el.text = value;
      // Remove empty free-floating text labels.
      if (isNode(el) && el.shape === 'text' && !value.trim()) {
        this.doc.elements = this.doc.elements.filter((x) => x.id !== id);
        this.selection.delete(id);
        this.emit('selection');
      }
    }
    this.#afterMutation(before);
    this.emit('edit-end', id);
  }

  cancelTextEdit() {
    if (!this.editing) return;
    const { id, original, before } = this.editing;
    this.editing = null;
    this.textarea.hidden = true;
    const el = this.byId(id);
    if (el) el.text = original;
    if (el && isNode(el) && el.shape === 'text' && !original.trim()) {
      this.doc.elements = this.doc.elements.filter((x) => x.id !== id);
      this.selection.delete(id);
    }
    this.#afterMutation(before);
    this.emit('edit-end', id);
  }

  // ------------------------------------------------------------- commands
  deleteSelection() {
    if (!this.selection.size || this.readOnly) return;
    const ids = new Set(this.selection);
    this.mutate((doc) => {
      doc.elements = doc.elements.filter((el) => {
        if (ids.has(el.id)) return false;
        if (isEdge(el) && ((el.source?.id && ids.has(el.source.id)) || (el.target?.id && ids.has(el.target.id)))) return false;
        return true;
      });
    });
    this.selection.clear();
    this.emit('selection');
  }

  #cloneElements(list, offset = 20) {
    const map = new Map();
    const copies = [];
    for (const el of list) if (isNode(el)) { const c = clone(el); c.id = uid('n'); c.x += offset; c.y += offset; map.set(el.id, c.id); copies.push(c); }
    for (const el of list) {
      if (!isEdge(el)) continue;
      const c = clone(el); c.id = uid('e');
      for (const end of ['source', 'target']) {
        const v = c[end];
        if (v?.id) { if (map.has(v.id)) v.id = map.get(v.id); }
        else if (v) { v.x += offset; v.y += offset; }
      }
      copies.push(c);
    }
    return copies;
  }

  /** Nodes in selection plus edges between them (and selected edges). */
  #selectionWithEdges() {
    const sel = this.selectedElements();
    const ids = new Set(sel.map((x) => x.id));
    const extra = this.doc.elements.filter((el) => isEdge(el) && !ids.has(el.id) && el.source?.id && el.target?.id && ids.has(el.source.id) && ids.has(el.target.id));
    return [...sel, ...extra];
  }

  duplicateSelection() {
    if (!this.selection.size || this.readOnly) return;
    const copies = this.#cloneElements(this.#selectionWithEdges());
    this.mutate((doc) => { doc.elements.push(...copies); });
    this.select(copies.map((c) => c.id));
  }

  copy() {
    if (!this.selection.size) return false;
    const data = JSON.stringify(this.#selectionWithEdges());
    try { localStorage.setItem(CLIP_KEY, data); } catch { /* ignore */ }
    this._clip = data;
    return true;
  }

  cut() { if (this.copy()) this.deleteSelection(); }

  paste() {
    if (this.readOnly) return false;
    let raw = this._clip;
    try { raw = localStorage.getItem(CLIP_KEY) || raw; } catch { /* ignore */ }
    if (!raw) return false;
    let list;
    try { list = JSON.parse(raw); } catch { return false; }
    this._pasteCount = (this._pasteCount || 0) + 1;
    const copies = this.#cloneElements(list, 20 * this._pasteCount);
    this.mutate((doc) => { doc.elements.push(...copies); });
    this.select(copies.map((c) => c.id));
    return true;
  }

  nudge(dx, dy) {
    const nodes = this.selectedElements().filter((x) => isNode(x) && !x.locked);
    const edges = this.selectedElements().filter(isEdge);
    if (!nodes.length && !edges.length) return;
    this.mutate(() => {
      for (const n of nodes) { n.x += dx; n.y += dy; }
      for (const e of edges) for (const end of ['source', 'target']) if (!e[end]?.id) { e[end].x += dx; e[end].y += dy; }
    }, { merge: 'nudge' });
  }

  /** Apply fn(el) to selected elements (filtered by kind: 'node' | 'edge' | null). */
  updateSelected(fn, { kind = null, merge = null } = {}) {
    const targets = this.selectedElements().filter((el) => !kind || el.type === kind);
    if (!targets.length) return;
    this.mutate(() => { for (const el of targets) fn(el); }, { merge });
  }

  setStyle(prop, value, { kind = null, merge = null } = {}) {
    this.updateSelected((el) => {
      el.style = { ...(el.style || {}) };
      if (value === null || value === undefined) delete el.style[prop]; else el.style[prop] = value;
    }, { kind, merge: merge ?? `style:${prop}` });
  }

  bringToFront() {
    const ids = this.selection;
    this.mutate((doc) => { doc.elements = [...doc.elements.filter((x) => !ids.has(x.id)), ...doc.elements.filter((x) => ids.has(x.id))]; });
  }

  sendToBack() {
    const ids = this.selection;
    this.mutate((doc) => { doc.elements = [...doc.elements.filter((x) => ids.has(x.id)), ...doc.elements.filter((x) => !ids.has(x.id))]; });
  }

  align(mode) {
    const nodes = this.selectedElements().filter(isNode);
    if (nodes.length < 2) return;
    const b = unionBox(nodes);
    this.mutate(() => {
      for (const n of nodes) {
        if (mode === 'left') n.x = b.x;
        if (mode === 'right') n.x = b.x + b.w - n.w;
        if (mode === 'center') n.x = Math.round(b.x + b.w / 2 - n.w / 2);
        if (mode === 'top') n.y = b.y;
        if (mode === 'bottom') n.y = b.y + b.h - n.h;
        if (mode === 'middle') n.y = Math.round(b.y + b.h / 2 - n.h / 2);
      }
    });
  }

  distribute(axis) {
    const nodes = this.selectedElements().filter(isNode);
    if (nodes.length < 3) return;
    const key = axis === 'h' ? 'x' : 'y'; const size = axis === 'h' ? 'w' : 'h';
    const sorted = [...nodes].sort((a, b) => a[key] - b[key]);
    const first = sorted[0]; const last = sorted[sorted.length - 1];
    const total = sorted.reduce((s, n) => s + n[size], 0);
    const gap = (last[key] + last[size] - first[key] - total) / (sorted.length - 1);
    this.mutate(() => {
      let pos = first[key];
      for (const n of sorted) { n[key] = Math.round(pos); pos += n[size] + gap; }
    });
  }

  reverseSelectedEdges() {
    this.updateSelected((el) => {
      [el.source, el.target] = [el.target, el.source];
      const s = el.style || {};
      el.style = { ...s, startArrow: s.endArrow ?? 'arrow', endArrow: s.startArrow ?? 'none' };
    }, { kind: 'edge' });
  }
}

// ------------------------------------------------------------------ helpers
function handlePoint(el, h) {
  const x = h.includes('w') ? el.x : h.includes('e') ? el.x + el.w : el.x + el.w / 2;
  const y = h.includes('n') ? el.y : h.includes('s') ? el.y + el.h : el.y + el.h / 2;
  return { x, y };
}

function rectFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function unionBox(nodes) {
  const list = nodes.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((n) => n.x)); const y = Math.min(...list.map((n) => n.y));
  const r = Math.max(...list.map((n) => n.x + n.w)); const b = Math.max(...list.map((n) => n.y + n.h));
  return { x, y, w: r - x, h: b - y };
}
