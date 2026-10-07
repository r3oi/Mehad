// Pagination engine for the Word-like Document Preview.
//
// The engine works on "items": one item = one block-level DOM element (a paragraph,
// a heading, a figure, a table, a TOC line …). It is split in three small layers so
// each can be tested on its own:
//
//   pageMetrics(settings)            → page / content size in CSS px (mm → px at 96 dpi)
//   measureItems(items, host)        → renders every item into an off-screen host that has
//                                      exactly the page content width and the same CSS as a page,
//                                      then reads height + vertical margins (DOM)
//   packPages(items, { contentHeight }) → greedy page packing (pure: only needs the numbers)
//
// `paginate(items, host, opts)` = measureItems + packPages.
//
// Item shape (all optional unless noted):
//   html            string, ONE root element                           (required before measuring)
//   breakBefore     start a new page before this item (chapter headings, front-matter sections)
//   keepWithNext    never leave this item (a heading) at the bottom of a page
//   splitMode       'lines' (paragraphs / bullets) | 'rows' (tables taller than a page)
//   anchors         [id…] ids whose page number we want to know (headings, figures, tables)
// Filled in by measureItems:
//   node, height (margin box), marginTop, marginBottom, lineH, lines, minHeight
//
// Vertical layout is a flex column (no margin collapsing), so the sum of margin boxes is exactly
// what the browser lays out on the real page. The top margin of the first item on a page is
// dropped (Word does the same after a page break).
import { toRoman } from '../core/utils.js';

export const CM_PX = 96 / 2.54;
export const MM_PX = 96 / 25.4;
export const PT_PX = 96 / 72;
export const PAGE_SIZES = { A4: { w: 210, h: 297 }, Letter: { w: 215.9, h: 279.4 } };

const EPS = 0.75; // px of tolerance when comparing fractional layout heights

const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/**
 * Page geometry from project settings (`settings.page`).
 * A4 portrait → 794 × 1123 px. Margins are centimetres in the settings.
 */
export function pageMetrics(settings = {}) {
  const page = settings.page || {};
  const size = PAGE_SIZES[page.size] ? page.size : 'A4';
  const landscape = page.orientation === 'landscape';
  const base = PAGE_SIZES[size];
  const mmW = landscape ? base.h : base.w;
  const mmH = landscape ? base.w : base.h;
  const m = { top: 2.54, bottom: 2.54, left: 3, right: 2.54, ...(page.margins || {}) };
  const width = Math.round(mmW * MM_PX);
  const height = Math.round(mmH * MM_PX);
  const clampMargin = (v, fallback, max) => Math.min(max, Math.max(0, num(v, fallback) * CM_PX));
  const margins = {
    top: clampMargin(m.top, 2.54, height * 0.35),
    bottom: clampMargin(m.bottom, 2.54, height * 0.35),
    left: clampMargin(m.left, 3, width * 0.35),
    right: clampMargin(m.right, 2.54, width * 0.35),
  };
  return {
    size, orientation: landscape ? 'landscape' : 'portrait', cssSize: `${size} ${landscape ? 'landscape' : 'portrait'}`,
    mmW, mmH, width, height, margins,
    contentWidth: width - margins.left - margins.right,
    contentHeight: height - margins.top - margins.bottom,
  };
}

/** Page number label: front matter is lower-roman (i, ii, iii …), body is arabic. */
export const formatPageNumber = (kind, n) => (kind === 'front' ? toRoman(n) : String(n));

// ---------------------------------------------------------------------------
// Packing (pure)

const blockH = (item, atTop) => item.height - (atTop ? item.marginTop : 0);
const minBlock = (item) => item.minHeight ?? (item.height - item.marginBottom);

/**
 * Greedy page packing.
 * items: measured items (height, marginTop, marginBottom, …).
 * → { pages: [{ items, used }], anchors: Map(anchorId → pageIndex) }
 *
 * Rules: `breakBefore` forces a new page; `keepWithNext` items stay with (the first lines of) what
 * follows; an item that doesn't fit moves to the next page unless it can be split (`canSplit/split`
 * installed by measureItems); an item taller than a page is placed anyway (it overflows).
 */
export function packPages(items, { contentHeight }) {
  const H = contentHeight;
  const pages = [];
  const anchors = new Map();
  const queue = items.slice().reverse(); // pop() → next item; push() → put back
  let page = null;
  let used = 0;
  const newPage = () => { page = { items: [], used: 0 }; pages.push(page); used = 0; };
  const peek = (k) => queue[queue.length - 1 - k];

  // Height needed to place `item` here, counting the minimum part of the item(s) it must stay with.
  const requirement = (item, atTop) => {
    let need = 0; let cur = item; let top = atTop; let k = 0;
    for (;;) {
      const own = blockH(cur, top);
      if (!cur.keepWithNext) {
        need += cur === item ? own - cur.marginBottom : Math.min(own - cur.marginBottom, minBlock(cur));
        break;
      }
      need += own;
      const next = peek(k++);
      if (!next || next.breakBefore) { need -= cur.marginBottom; break; }
      cur = next; top = false;
    }
    // A chain taller than a page can't be honoured: just place the item itself.
    return need > H + EPS ? blockH(item, atTop) - item.marginBottom : need;
  };

  const place = (item, atTop) => {
    item.atTop = atTop;
    page.items.push(item);
    used += blockH(item, atTop);
    page.used = used;
    if (!item.isTail) for (const a of item.anchors || []) if (!anchors.has(a)) anchors.set(a, pages.length - 1);
  };

  while (queue.length) {
    const item = queue.pop();
    if (!page) newPage();
    if (item.breakBefore && page.items.length) newPage();
    const atTop = page.items.length === 0;
    if (used + requirement(item, atTop) <= H + EPS) { place(item, atTop); continue; }

    const avail = H - used;
    if (item.split && item.canSplit?.(avail, atTop)) {
      const parts = item.split(avail, atTop);
      if (parts) {
        place(parts.head, atTop);
        newPage();
        queue.push(parts.tail);
        continue;
      }
    }
    if (!atTop) { newPage(); queue.push(item); continue; }
    place(item, true); // taller than a whole page and not splittable: let it overflow
  }
  return { pages, anchors };
}

// ---------------------------------------------------------------------------
// Measuring (DOM)

/** Off-screen container with exactly the page content width. Must live inside the preview root so it inherits the page CSS variables. */
export function createMeasureHost(root, { contentWidth }) {
  const host = document.createElement('div');
  host.className = 'pv-measure-host';
  host.setAttribute('aria-hidden', 'true');
  const el = document.createElement('div');
  el.className = 'pv-measure';
  el.style.width = `${contentWidth}px`;
  host.append(el);
  root.append(host);
  return { host, el, destroy: () => host.remove() };
}

const parseNode = (html) => {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
};

function readMetrics(item) {
  const node = item.node;
  const rect = node.getBoundingClientRect();
  const cs = getComputedStyle(node);
  item.marginTop = px(cs.marginTop);
  item.marginBottom = px(cs.marginBottom);
  item.height = rect.height + item.marginTop + item.marginBottom;
  if (item.splitMode === 'lines') {
    item.lineH = px(cs.lineHeight) || px(cs.fontSize) * 1.2;
    const pad = px(cs.paddingTop) + px(cs.paddingBottom);
    item.lines = Math.max(1, Math.round((rect.height - pad) / item.lineH));
    item.minHeight = item.lines >= 4 ? item.marginTop + 2 * item.lineH + pad : undefined;
  }
}

/**
 * Parse + measure items inside the host (mutates items). All nodes are inserted first and
 * measured afterwards so the browser lays out once.
 */
export function measureItems(items, mh, { contentHeight }) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    if (!item.node) item.node = parseNode(item.html);
    frag.append(item.node);
  }
  mh.el.append(frag);
  for (const item of items) {
    item.contentHeight = contentHeight;
    readMetrics(item);
    attachSplitter(item, mh, contentHeight);
  }
  return items;
}

/** measure + pack in one call. */
export function paginate(items, mh, { contentHeight }) {
  measureItems(items, mh, { contentHeight });
  return packPages(items, { contentHeight });
}

// ---------------------------------------------------------------------------
// Splitting

function attachSplitter(item, mh, contentHeight) {
  if (item.splitMode === 'lines') {
    item.canSplit = () => item.lines >= 4;
    item.split = (avail, atTop) => splitLines(item, avail, atTop, mh);
  } else if (item.splitMode === 'rows') {
    // Tables are only split when they are taller than a whole page.
    item.canSplit = () => item.height > contentHeight + EPS;
    item.split = (avail, atTop) => splitRows(item, avail, atTop, mh);
  }
}

/** A tail / head derived from an item: same settings, fresh node + metrics, measured inside the host. */
function derive(item, node, patch, mh) {
  const d = { ...item, ...patch, node, breakBefore: false, keepWithNext: false };
  delete d.minHeight;
  mh.el.append(node);
  readMetrics(d);
  attachSplitter(d, mh, item.contentHeight);
  return d;
}

const textNodesOf = (root) => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
};

/**
 * Split a paragraph / bullet by lines so that at least 2 lines stay on each page (widow/orphan control).
 * The split point is found by measuring where each word starts (Range rects) → no re-flow guessing.
 */
function splitLines(item, avail, atTop, mh) {
  const { node, lineH, lines } = item;
  const room = avail - (atTop ? 0 : item.marginTop);
  let k = Math.min(Math.floor((room + EPS) / lineH), lines - 2);
  if (k < 2) return null;

  const texts = textNodesOf(node);
  const words = [];
  for (const t of texts) for (const m of t.data.matchAll(/\S+/g)) words.push({ t, offset: m.index });
  if (words.length < 2) return null;
  const top = node.getBoundingClientRect().top + px(getComputedStyle(node).paddingTop);
  const range = document.createRange();
  const lineOf = (w) => {
    range.setStart(w.t, w.offset);
    range.setEnd(w.t, w.offset + 1);
    const r = range.getBoundingClientRect();
    return Math.floor(((r.top + r.bottom) / 2 - top) / lineH);
  };

  for (let attempt = 0; attempt < 4 && k >= 2; attempt += 1, k -= 1) {
    // First word that starts on line index >= k (lines are 0-based): binary search, line index is monotonic.
    let lo = 1; let hi = words.length; // words[0] is on line 0
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lineOf(words[mid]) >= k) hi = mid; else lo = mid + 1; }
    if (lo >= words.length || lineOf(words[lo]) < k) return null;
    const w = words[lo];

    const headNode = node.cloneNode(true);
    const headTexts = textNodesOf(headNode);
    const r = document.createRange();
    r.setStart(headTexts[texts.indexOf(w.t)], w.offset);
    r.setEnd(headNode, headNode.childNodes.length);
    const tailNode = node.cloneNode(false);
    tailNode.append(r.extractContents());
    headNode.classList.add('pv-split-head');
    tailNode.classList.add('pv-split-tail');

    const head = derive(item, headNode, {}, mh);
    if (blockH(head, atTop) - head.marginBottom > avail + EPS) { headNode.remove(); continue; } // rounding: try one line less
    const tail = derive(item, tailNode, { isTail: true, anchors: [] }, mh);
    node.remove();
    return { head, tail };
  }
  return null;
}

/**
 * Split a table block by rows (header rows repeat on the continuation, the caption stays with the
 * first part). Rows covered by a rowspan are never separated from the row that spans them.
 */
function splitRows(item, avail, atTop, mh) {
  const { node } = item;
  const table = node.querySelector('table');
  if (!table) return null;
  const rows = [...table.tBodies].flatMap((tb) => [...tb.rows]);
  if (rows.length < 2) return null;
  const nodeTop = node.getBoundingClientRect().top;
  const bottoms = rows.map((tr) => tr.getBoundingClientRect().bottom - nodeTop);
  const blocked = new Set(); // boundary-before-row j is illegal when a rowspan crosses it
  rows.forEach((tr, i) => [...tr.cells].forEach((c) => { for (let j = 1; j < c.rowSpan; j += 1) blocked.add(i + j); }));
  const room = avail - (atTop ? 0 : item.marginTop);
  const minRows = Math.min(2, rows.length - 1);

  const candidates = []; // legal "last row of the head" indices that fit, best (largest) first
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (bottoms[i] + 2 > room) break;
    if (!blocked.has(i + 1)) candidates.unshift(i);
  }
  const caption = node.querySelector('.pv-caption');
  const captionAbove = caption?.dataset.pos !== 'below';

  for (const last of candidates.slice(0, 4)) {
    if (last + 1 < minRows) return null;
    const build = (keep) => {
      const clone = node.cloneNode(true);
      const cloneRows = [...clone.querySelector('table').tBodies].flatMap((tb) => [...tb.rows]);
      cloneRows.forEach((tr, i) => { if (!keep(i)) tr.remove(); });
      return clone;
    };
    const headNode = build((i) => i <= last);
    const tailNode = build((i) => i > last);
    const headCap = headNode.querySelector('.pv-caption');
    const tailCap = tailNode.querySelector('.pv-caption');
    if (caption) {
      if (captionAbove) {
        if (tailCap) {
          tailCap.classList.add('pv-cont');
          tailCap.innerHTML = `${escapeHTML(caption.dataset.label || '')} <span class="pv-cap-title">(continued)</span>`;
        }
      } else headCap?.remove();
    }
    const head = derive(item, headNode, {}, mh);
    if (blockH(head, atTop) - head.marginBottom > avail + EPS) { headNode.remove(); continue; }
    const tail = derive(item, tailNode, { isTail: true, anchors: [] }, mh);
    node.remove();
    return { head, tail };
  }
  return null;
}

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
