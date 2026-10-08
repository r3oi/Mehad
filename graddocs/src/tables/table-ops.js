// Pure table operations. Every function works on a "table-like" object
// ({ columns, rows, headerRows }) and mutates it in place, so callers can run
// an operation on a draft clone, check the result and only then commit it.
//
// A merged region keeps its content in the top-left ("anchor") cell, which
// carries colspan / rowspan. Every other cell of the region has hidden: true.
// Rectangles are { r1, c1, r2, c2 } (inclusive, zero-based).
// Only the `reason` messages returned for the UI are translated; table content is never touched.
import { uid, clone, clamp } from '../core/utils.js';
import { createCell } from '../core/model.js';
import { t } from '../i18n/index.js';

export const MIN_COL_WIDTH = 5; // percent
export const MAX_HEADER_ROWS = 3;

const round2 = (n) => Math.round(n * 100) / 100;
const spanOf = (cell) => ({ rs: Math.max(1, Math.floor(Number(cell?.rowspan)) || 1), cs: Math.max(1, Math.floor(Number(cell?.colspan)) || 1) });

export const rowCount = (t) => t.rows.length;
export const colCount = (t) => t.columns.length;

/** Deep copy of the editable content of a table (used for undo and versions). */
export function snapshotContent(table) {
  return clone({ columns: table.columns, rows: table.rows, headerRows: table.headerRows, style: table.style });
}

/** Replace the content of `table` with a copy of `content`. */
export function applyContent(table, content) {
  const copy = clone(content);
  table.columns = copy.columns; table.rows = copy.rows; table.headerRows = copy.headerRows; table.style = copy.style;
  return table;
}

export const contentKey = (content) => JSON.stringify([content.columns.map((c) => Math.round(c.width * 100)), content.rows, content.headerRows, content.style]);

// ---------------------------------------------------------------------------
// Column widths

/** Scale widths so they sum to exactly 100 and none is below the minimum. Mutates and returns `columns`. */
export function normaliseWidths(columns) {
  const n = columns.length;
  if (!n) return columns;
  let w = columns.map((c) => Math.max(Number(c.width) || 0, 0));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) { w = w.map(() => 100 / n); sum = 100; }
  w = w.map((x) => (x / sum) * 100);
  const min = Math.min(MIN_COL_WIDTH, 100 / n);
  for (let pass = 0; pass < 2; pass += 1) {
    let fixed = 0; let free = 0;
    w.forEach((x) => { if (x < min) fixed += min; else free += x; });
    const k = free > 0 ? (100 - fixed) / free : 1;
    w = w.map((x) => (x < min ? min : x * k));
  }
  w = w.map(round2);
  const drift = round2(100 - w.reduce((a, b) => a + b, 0));
  if (drift) { const big = w.indexOf(Math.max(...w)); w[big] = round2(w[big] + drift); }
  columns.forEach((c, i) => { c.width = w[i]; });
  return columns;
}

export function equaliseWidths(columns) {
  columns.forEach((c) => { c.width = 100 / columns.length; });
  return normaliseWidths(columns);
}

/** Move the border between column i and i+1 by `delta` percent. Returns a new array of widths. */
export function resizeBoundary(widths, i, delta) {
  const a = widths[i]; const b = widths[i + 1];
  if (a === undefined || b === undefined) return widths.slice();
  const total = a + b;
  const min = Math.min(MIN_COL_WIDTH, total / 2);
  const na = clamp(a + delta, min, total - min);
  return widths.map((w, k) => (k === i ? na : k === i + 1 ? total - na : w));
}

// ---------------------------------------------------------------------------
// Geometry

export function rectOf(a, b) {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export const rectCells = (rect) => (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
export const rectContains = (rect, r, c) => r >= rect.r1 && r <= rect.r2 && c >= rect.c1 && c <= rect.c2;
export const clampRect = (t, rect) => ({
  r1: clamp(rect.r1, 0, t.rows.length - 1), c1: clamp(rect.c1, 0, t.columns.length - 1),
  r2: clamp(rect.r2, 0, t.rows.length - 1), c2: clamp(rect.c2, 0, t.columns.length - 1),
});

/** Region (rectangle) that the cell at (r, c) belongs to; a plain cell is a 1×1 region. */
export function regionAt(table, r, c) {
  const rows = table.rows.length; const cols = table.columns.length;
  const cell = table.rows[r]?.[c];
  if (!cell) return { r1: r, c1: c, r2: r, c2: c };
  if (!cell.hidden) {
    const { rs, cs } = spanOf(cell);
    return { r1: r, c1: c, r2: Math.min(rows - 1, r + rs - 1), c2: Math.min(cols - 1, c + cs - 1) };
  }
  for (let rr = r; rr >= 0; rr -= 1) {
    for (let cc = c; cc >= 0; cc -= 1) {
      const a = table.rows[rr]?.[cc];
      if (!a || a.hidden) continue;
      const { rs, cs } = spanOf(a);
      if ((rs > 1 || cs > 1) && rr + rs - 1 >= r && cc + cs - 1 >= c) {
        return { r1: rr, c1: cc, r2: Math.min(rows - 1, rr + rs - 1), c2: Math.min(cols - 1, cc + cs - 1) };
      }
    }
  }
  return { r1: r, c1: c, r2: r, c2: c };
}

/** Grow a rectangle until it contains whole merged regions only. */
export function expandRect(table, rect) {
  let { r1, c1, r2, c2 } = clampRect(table, rect);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        const g = regionAt(table, r, c);
        if (g.r1 < r1) { r1 = g.r1; changed = true; }
        if (g.c1 < c1) { c1 = g.c1; changed = true; }
        if (g.r2 > r2) { r2 = g.r2; changed = true; }
        if (g.c2 > c2) { c2 = g.c2; changed = true; }
      }
    }
  }
  return { r1, c1, r2, c2 };
}

/** Visible (non-hidden) cells inside a rectangle: [{ r, c, cell, region }]. */
export function anchorsIn(table, rect) {
  const out = [];
  const box = clampRect(table, rect);
  for (let r = box.r1; r <= box.r2; r += 1) {
    for (let c = box.c1; c <= box.c2; c += 1) {
      const cell = table.rows[r][c];
      if (!cell.hidden) out.push({ r, c, cell, region: regionAt(table, r, c) });
    }
  }
  return out;
}

export const isMerged = (cell) => !cell.hidden && (spanOf(cell).rs > 1 || spanOf(cell).cs > 1);
export const isHeaderRow = (table, r) => r < (table.headerRows || 0);
/** Header cells are bold unless explicitly set to bold:false; body cells only when bold:true. */
export const isCellBold = (table, r, cell) => (isHeaderRow(table, r) ? cell.bold !== false : !!cell.bold);

export function setCellBold(table, r, cell, value) {
  if (isHeaderRow(table, r)) { if (value) delete cell.bold; else cell.bold = false; } else if (value) cell.bold = true; else delete cell.bold;
}

// ---------------------------------------------------------------------------
// Merge / unmerge

/** Repair spans and hidden flags (after imports, restores or structural edits). */
export function normalizeMerges(table) {
  const rows = table.rows.length; const cols = table.columns.length;
  const covered = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = table.rows[r][c];
      if (covered[r][c]) { cell.hidden = true; delete cell.colspan; delete cell.rowspan; continue; }
      if (cell.hidden) { delete cell.hidden; } // orphan: nothing covers it
      let { rs, cs } = spanOf(cell);
      rs = Math.min(rs, rows - r); cs = Math.min(cs, cols - c);
      let clash = false;
      for (let rr = r; rr < r + rs && !clash; rr += 1) {
        for (let cc = c; cc < c + cs; cc += 1) if ((rr !== r || cc !== c) && covered[rr][cc]) { clash = true; break; }
      }
      if (clash) { rs = 1; cs = 1; }
      if (rs > 1) cell.rowspan = rs; else delete cell.rowspan;
      if (cs > 1) cell.colspan = cs; else delete cell.colspan;
      for (let rr = r; rr < r + rs; rr += 1) for (let cc = c; cc < c + cs; cc += 1) if (rr !== r || cc !== c) covered[rr][cc] = true;
    }
  }
  return table;
}

/**
 * Merge a rectangle into its top-left cell. Text of the other cells is appended
 * (one per line). Returns { ok, rect } or { ok: false, reason }.
 */
export function mergeCells(table, rect) {
  const box = expandRect(table, rect);
  if (box.r1 === box.r2 && box.c1 === box.c2) return { ok: false, reason: t('Select two or more cells to merge.') };
  const header = table.headerRows || 0;
  if (box.r1 < header && box.r2 >= header) return { ok: false, reason: t('Header cells and body cells cannot be merged together.') };
  const anchor = table.rows[box.r1][box.c1];
  const parts = [];
  for (let r = box.r1; r <= box.r2; r += 1) {
    for (let c = box.c1; c <= box.c2; c += 1) {
      const cell = table.rows[r][c];
      if (!cell.hidden && String(cell.text ?? '').trim()) parts.push(String(cell.text));
    }
  }
  for (let r = box.r1; r <= box.r2; r += 1) {
    for (let c = box.c1; c <= box.c2; c += 1) {
      if (r === box.r1 && c === box.c1) continue;
      const cell = table.rows[r][c];
      cell.text = ''; cell.hidden = true; delete cell.colspan; delete cell.rowspan;
    }
  }
  anchor.text = parts.join('\n');
  delete anchor.hidden;
  const rs = box.r2 - box.r1 + 1; const cs = box.c2 - box.c1 + 1;
  if (rs > 1) anchor.rowspan = rs; else delete anchor.rowspan;
  if (cs > 1) anchor.colspan = cs; else delete anchor.colspan;
  return { ok: true, rect: box };
}

/** Split every merged region that intersects the rectangle. Returns the number of regions split. */
export function unmergeCells(table, rect) {
  const box = clampRect(table, rect);
  const seen = new Set();
  let count = 0;
  for (let r = box.r1; r <= box.r2; r += 1) {
    for (let c = box.c1; c <= box.c2; c += 1) {
      const g = regionAt(table, r, c);
      const key = `${g.r1},${g.c1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (g.r1 === g.r2 && g.c1 === g.c2) continue;
      const anchor = table.rows[g.r1][g.c1];
      delete anchor.rowspan; delete anchor.colspan;
      for (let rr = g.r1; rr <= g.r2; rr += 1) for (let cc = g.c1; cc <= g.c2; cc += 1) delete table.rows[rr][cc].hidden;
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Rows

function referenceAlign(table, index, header) {
  const lo = header ? 0 : table.headerRows || 0;
  const hi = header ? (table.headerRows || 0) - 1 : table.rows.length - 1;
  const pick = [index - 1, index].find((i) => i >= lo && i <= hi && i < table.rows.length);
  return pick === undefined ? null : table.rows[pick];
}

/**
 * Insert `count` blank rows so the first new row ends up at `index`.
 * Rows inserted above a header row become header rows. Regions that span the
 * insertion point grow instead of being split. Returns the index of the first new row.
 */
export function insertRow(table, index, count = 1) {
  const cols = table.columns.length;
  index = clamp(index, 0, table.rows.length);
  const header = index < (table.headerRows || 0);
  const ref = referenceAlign(table, index, header);
  const growCols = new Set(); const grow = new Set();
  if (index > 0 && index < table.rows.length) {
    for (let c = 0; c < cols; c += 1) {
      const up = regionAt(table, index - 1, c); const down = regionAt(table, index, c);
      if (up.r1 === down.r1 && up.c1 === down.c1 && up.r2 >= index) { growCols.add(c); grow.add(`${up.r1},${up.c1}`); }
    }
  }
  for (const key of grow) {
    const [ar, ac] = key.split(',').map(Number);
    const a = table.rows[ar][ac];
    a.rowspan = spanOf(a).rs + count;
  }
  const fresh = Array.from({ length: count }, () => Array.from({ length: cols }, (_, c) => {
    if (growCols.has(c)) return createCell('', { hidden: true });
    const align = ref?.[c]?.align;
    return createCell('', align ? { align } : {});
  }));
  table.rows.splice(index, 0, ...fresh);
  if (header) table.headerRows += count;
  return index;
}

/** Delete rows r1..r2. Merged regions touching them are split first. Returns false if nothing was deleted. */
export function deleteRows(table, r1, r2 = r1) {
  r1 = clamp(r1, 0, table.rows.length - 1); r2 = clamp(r2, r1, table.rows.length - 1);
  if (r2 - r1 + 1 >= table.rows.length) return false;
  unmergeCells(table, { r1, c1: 0, r2, c2: table.columns.length - 1 });
  let removedHeader = 0;
  for (let r = r1; r <= r2; r += 1) if (r < (table.headerRows || 0)) removedHeader += 1;
  table.rows.splice(r1, r2 - r1 + 1);
  table.headerRows = Math.max(0, (table.headerRows || 0) - removedHeader);
  return true;
}

/** Set the number of header rows. Merges that cross the new boundary are split. */
export function setHeaderRows(table, n) {
  n = clamp(Math.floor(Number(n)) || 0, 0, Math.min(MAX_HEADER_ROWS, table.rows.length));
  if (n > 0 && n < table.rows.length) {
    for (let c = 0; c < table.columns.length; c += 1) {
      const g = regionAt(table, n - 1, c);
      if (g.r2 >= n) unmergeCells(table, g);
    }
  }
  table.headerRows = n;
  return n;
}

// ---------------------------------------------------------------------------
// Columns

/** Insert a blank column so that it ends up at `index`. Existing widths are scaled to make room. */
export function insertColumn(table, index) {
  const rows = table.rows.length;
  index = clamp(index, 0, table.columns.length);
  const n = table.columns.length;
  const grow = new Set(); const growRows = new Set();
  if (index > 0 && index < n) {
    for (let r = 0; r < rows; r += 1) {
      const left = regionAt(table, r, index - 1); const right = regionAt(table, r, index);
      if (left.r1 === right.r1 && left.c1 === right.c1 && left.c2 >= index) { growRows.add(r); grow.add(`${left.r1},${left.c1}`); }
    }
  }
  for (const key of grow) {
    const [ar, ac] = key.split(',').map(Number);
    const a = table.rows[ar][ac];
    a.colspan = spanOf(a).cs + 1;
  }
  table.rows.forEach((row, r) => {
    if (growRows.has(r)) { row.splice(index, 0, createCell('', { hidden: true })); return; }
    const neighbour = row[index - 1] || row[index];
    const align = neighbour && !neighbour.hidden ? neighbour.align : null;
    row.splice(index, 0, createCell('', align ? { align } : {}));
  });
  const w = round2(100 / (n + 1));
  const k = (100 - w) / 100;
  table.columns.forEach((c) => { c.width *= k; });
  table.columns.splice(index, 0, { id: uid('col'), width: w });
  normaliseWidths(table.columns);
  return index;
}

/** Delete columns c1..c2. Merged regions touching them are split first. Returns false if nothing was deleted. */
export function deleteColumns(table, c1, c2 = c1) {
  c1 = clamp(c1, 0, table.columns.length - 1); c2 = clamp(c2, c1, table.columns.length - 1);
  if (c2 - c1 + 1 >= table.columns.length) return false;
  unmergeCells(table, { r1: 0, c1, r2: table.rows.length - 1, c2 });
  table.rows.forEach((row) => row.splice(c1, c2 - c1 + 1));
  table.columns.splice(c1, c2 - c1 + 1);
  normaliseWidths(table.columns);
  return true;
}

// ---------------------------------------------------------------------------
// Clipboard helpers

const needsQuotes = (s) => /[\t\n\r"]/.test(s);

/** Tab-separated text for a rectangle (Excel-compatible quoting). */
export function rectToTSV(table, rect) {
  const box = clampRect(table, rect);
  const lines = [];
  for (let r = box.r1; r <= box.r2; r += 1) {
    const fields = [];
    for (let c = box.c1; c <= box.c2; c += 1) {
      const cell = table.rows[r][c];
      const text = cell.hidden ? '' : String(cell.text ?? '');
      fields.push(needsQuotes(text) ? `"${text.replace(/"/g, '""')}"` : text);
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n');
}

/** Parse tab/newline separated clipboard text into a matrix of strings (handles quoted fields). */
export function parseDelimited(text, sep = '\t') {
  const rows = []; let row = []; let field = ''; let quoted = false; let i = 0;
  const src = String(text).replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += ch;
    i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Write a matrix of strings into the table starting at (r, c), growing it when needed. Returns the filled rect. */
export function pasteMatrix(table, r, c, matrix) {
  if (!matrix.length) return null;
  const width = Math.max(...matrix.map((row) => row.length));
  while (table.rows.length < r + matrix.length) insertRow(table, table.rows.length);
  while (table.columns.length < c + width) insertColumn(table, table.columns.length);
  matrix.forEach((line, i) => line.forEach((value, j) => {
    const cell = table.rows[r + i]?.[c + j];
    if (cell && !cell.hidden) cell.text = String(value);
  }));
  return { r1: r, c1: c, r2: r + matrix.length - 1, c2: c + width - 1 };
}

/** Clear the text of every visible cell in a rectangle. */
export function clearCells(table, rect) {
  for (const { cell } of anchorsIn(table, rect)) cell.text = '';
}

export const dimensions = (table) => ({ rows: table.rows.length, cols: table.columns.length });
