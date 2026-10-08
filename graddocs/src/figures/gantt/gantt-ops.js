// Pure operations on a Gantt task list (no DOM): indent / outdent / move / insert / delete as "blocks" (a task and
// its sub-tasks move together), phase dates, and the "paste from Excel" parser. Every function that changes the list
// returns a new array (or null when the change is not allowed) and never touches its input.
import { createGanttTask, effectiveSpans, isPhase, dayOf, isoOf, todayISO, isValidISO } from './gantt-model.js';

export const MAX_LEVEL = 2;

/** Index just after task i's last sub-task (i itself when it has none). */
export function blockEnd(tasks, i) {
  let j = i + 1;
  while (j < tasks.length && tasks[j].level > tasks[i].level) j += 1;
  return j;
}

const maxLevelIn = (tasks, from, to) => { let m = 0; for (let j = from; j < to; j += 1) m = Math.max(m, tasks[j].level); return m; };
const shiftLevels = (tasks, from, to, d) => tasks.map((t, j) => (j >= from && j < to ? { ...t, level: t.level + d } : t));

/** A phase's stored dates follow its sub-tasks (mutates and returns `tasks`). */
export function syncPhases(tasks) {
  const spans = effectiveSpans(tasks);
  tasks.forEach((t, i) => { if (isPhase(tasks, i)) { t.start = isoOf(spans[i][0]); t.end = isoOf(spans[i][1]); } });
  return tasks;
}

// ----- Indent / outdent ---------------------------------------------------------------------------------------
/** A row may go one level deeper than the row above it, and no deeper than level 2 (its sub-tasks go with it). */
export const canIndent = (tasks, i) => i > 0 && tasks[i].level <= tasks[i - 1].level && maxLevelIn(tasks, i, blockEnd(tasks, i)) < MAX_LEVEL;
export const canOutdent = (tasks, i) => tasks[i].level > 0;
export const indentTask = (tasks, i) => (canIndent(tasks, i) ? shiftLevels(tasks, i, blockEnd(tasks, i), 1) : null);
export const outdentTask = (tasks, i) => (canOutdent(tasks, i) ? shiftLevels(tasks, i, blockEnd(tasks, i), -1) : null);

// ----- Move ---------------------------------------------------------------------------------------------------
/** Start of the sibling block just above row i (a row of the same level, skipping that sibling's sub-tasks), or -1. */
function previousSibling(tasks, i) {
  let j = i - 1;
  while (j >= 0 && tasks[j].level > tasks[i].level) j -= 1;
  return j >= 0 && tasks[j].level === tasks[i].level ? j : -1;
}
export const canMoveUp = (tasks, i) => previousSibling(tasks, i) >= 0;
export const canMoveDown = (tasks, i) => { const e = blockEnd(tasks, i); return e < tasks.length && tasks[e].level === tasks[i].level; };

/** Swap row i (with its sub-tasks) with the block above (dir -1) or below (dir 1) it. */
export function moveTask(tasks, i, dir) {
  const e = blockEnd(tasks, i);
  if (dir < 0) {
    const j = previousSibling(tasks, i);
    if (j < 0) return null;
    return [...tasks.slice(0, j), ...tasks.slice(i, e), ...tasks.slice(j, i), ...tasks.slice(e)];
  }
  if (!canMoveDown(tasks, i)) return null;
  const f = blockEnd(tasks, e);
  return [...tasks.slice(0, i), ...tasks.slice(e, f), ...tasks.slice(i, e), ...tasks.slice(f)];
}

// ----- Insert / delete ----------------------------------------------------------------------------------------
/** Dates for a new task placed after row `after` (-1 = first): the week following that row, or today's week. */
export function nextDates(tasks, after) {
  if (after < 0 || after >= tasks.length) { const s = todayISO(); return { start: s, end: isoOf(dayOf(s) + 6) }; }
  const end = effectiveSpans(tasks)[after][1];
  return { start: isoOf(end + 1), end: isoOf(end + 7) };
}

/** A new task at the same level right after row i's block. Returns { tasks, task } or null. */
export function insertBelow(tasks, i, fields = {}) {
  if (i < 0 || i >= tasks.length) return null;
  const at = blockEnd(tasks, i);
  const task = createGanttTask({ level: tasks[i].level, ...nextDates(tasks, i), ...fields });
  return { tasks: [...tasks.slice(0, at), task, ...tasks.slice(at)], task };
}

/** "Add task": at the end, one level like the last row (so a phase can be filled row after row). */
export function appendTask(tasks, fields = {}) {
  const task = createGanttTask({ level: tasks.length ? tasks[tasks.length - 1].level : 0, ...nextDates(tasks, tasks.length - 1), ...fields });
  return { tasks: [...tasks, task], task };
}

/** "Add phase": a top-level row followed by its first sub-task (a phase is a row with deeper rows below it). */
export function appendPhase(tasks, names = {}) {
  const dates = nextDates(tasks, tasks.length - 1);
  const phase = createGanttTask({ name: names.phase || 'New phase', level: 0, ...dates });
  const first = createGanttTask({ name: names.task || 'New task', level: 1, ...dates });
  return { tasks: [...tasks, phase, first], task: phase };
}

/** Delete row i with its sub-tasks, or (keepChildren) only the row — its sub-tasks move up one level. */
export function removeTask(tasks, i, { keepChildren = false } = {}) {
  const e = blockEnd(tasks, i);
  if (!keepChildren) return [...tasks.slice(0, i), ...tasks.slice(e)];
  return [...tasks.slice(0, i), ...shiftLevels(tasks, i + 1, e, -1).slice(i + 1, e), ...tasks.slice(e)];
}

// ----- Dates --------------------------------------------------------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const monthOf = (name) => MONTHS[String(name).slice(0, 3).toLowerCase()];
const fullYear = (y) => (String(y).length === 2 ? 2000 + Number(y) : Number(y));
const compose = (y, m, d) => { const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return isValidISO(iso) ? iso : null; };

const RE_YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const RE_NUM = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/;
const RE_DMY_NAME = /^(\d{1,2})(?:st|nd|rd|th)?[\s./-]+([A-Za-z]{3,9})\.?[\s./,-]+(\d{4}|\d{2})$/;
const RE_MDY_NAME = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}|\d{2})$/;

/** Drop a weekday prefix ("Mon, ") and a time suffix ("00:00:00", "9:30 AM") that spreadsheets sometimes add. */
const cleanDate = (s) => String(s ?? '').trim()
  .replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '')
  .replace(/[\sT]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*([AP]M)?\s*Z?$/i, '')
  .trim();

/** Does the text have the shape of a date (it may still be impossible, like 31/02/2025)? */
export const looksLikeDate = (s) => { const c = cleanDate(s); return RE_YMD.test(c) || RE_NUM.test(c) || RE_DMY_NAME.test(c) || RE_MDY_NAME.test(c); };

/**
 * Read one date. Accepted: YYYY-MM-DD (also with / or .), DD/MM/YYYY or M/D/YYYY (also with - or ., two-digit years
 * mean 20yy; `order` says which one a slash date is: 'dmy' or 'mdy'), and written months ("1 Sep 2025", "Sep 1, 2025").
 * Returns 'YYYY-MM-DD' or null.
 */
export function parseDate(text, order = 'dmy') {
  const c = cleanDate(text);
  let m = RE_YMD.exec(c);
  if (m) return compose(m[1], m[2], m[3]);
  if ((m = RE_NUM.exec(c))) return order === 'mdy' ? compose(fullYear(m[3]), m[1], m[2]) : compose(fullYear(m[3]), m[2], m[1]);
  if ((m = RE_DMY_NAME.exec(c))) { const mo = monthOf(m[2]); return mo === undefined ? null : compose(fullYear(m[3]), mo + 1, m[1]); }
  if ((m = RE_MDY_NAME.exec(c))) { const mo = monthOf(m[1]); return mo === undefined ? null : compose(fullYear(m[3]), mo + 1, m[2]); }
  return null;
}

// ----- Paste from Excel / Google Sheets / Word ------------------------------------------------------------------
const WBS_ONLY = /^\d{1,2}(?:\.\d{1,2}){0,2}\.?$/;
const WBS_PREFIX = /^(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+(\S[\s\S]*)$/;
const HEADER_CELL = /^(wbs|#|no\.?|id|task(?:\s*name)?|name|activity|description|start(?:\s*date)?|end(?:\s*date)?|finish(?:\s*date)?|begin|from|to|due|duration(?:\s*\(?days?\)?)?|days?)$/i;
const unquote = (s) => s.replace(/^\s*"([\s\S]*)"\s*$/, '$1').replace(/""/g, '"');

function splitCSV(line, delim) {
  const out = []; let cur = ''; let quoted = false;
  for (let k = 0; k < line.length; k += 1) {
    const ch = line[k];
    if (quoted) { if (ch === '"' && line[k + 1] === '"') { cur += '"'; k += 1; } else if (ch === '"') quoted = false; else cur += ch; }
    else if (ch === '"' && !cur.trim()) { quoted = true; cur = ''; }
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function splitCells(line) {
  if (line.includes('\t')) return { cells: line.split('\t').map(unquote), delim: '\t' };
  if ((line.match(/;/g) || []).length >= 2) return { cells: splitCSV(line, ';'), delim: ';' };
  if (line.includes(',')) return { cells: splitCSV(line, ','), delim: ',' };
  // Free text ("Design 2025-10-16 2025-10-24"): dates at the end of the line.
  const m = /^([\s\S]*\S)\s+(\d[\d./-]*\d)(?:\s+(?:-|–|—|to|until))?\s+(\d[\d./-]*\d)\s*$/i.exec(line);
  if (m && looksLikeDate(m[2]) && looksLikeDate(m[3])) return { cells: [m[1], m[2], m[3]], delim: ' ' };
  return { cells: [line], delim: ' ' };
}

/**
 * Read rows copied from a spreadsheet or a Word table. Each line is "Task name, Start, End" separated by tabs or
 * commas (or just spaces before two trailing dates). The first cell may carry the level: leading spaces or tabs,
 * leading "-" / "•" marks, or a numeric WBS ("6.1 Name", or "6.1" in its own column). A first row of column titles is
 * skipped. A row with a name but no dates is accepted as a phase when sub-tasks follow it.
 *
 * Returns { rows: [{ name, start, end, level, line }], errors: [{ line, text, code, value? }], dateOrder, ambiguous }.
 * Error codes: 'name' (no task name), 'start' / 'end' (date unreadable, with `value`), 'dates' (dates missing),
 * 'order' (end before start). dateOrder is 'dmy' or 'mdy' (slash dates); `ambiguous` is true when it was a guess.
 */
export function parseTaskRows(text, { dateOrder = 'auto' } = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const lines = [];
  raw.forEach((line, k) => { if (line.trim()) lines.push({ no: k + 1, text: line.replace(/\s+$/, '') }); });

  // 1. Split into cells and take the level markers off the first cell.
  const items = [];
  for (const { no, text: line } of lines) {
    const { cells, delim } = splitCells(line);
    let lead = 0;
    while (cells.length > 1 && !cells[0].trim() && cells.slice(1).some((c) => c.trim())) { cells.shift(); lead += 1; }
    const first = cells[0] ?? '';
    const m = /^([  ]*)((?:[-–—•·*>]+[  ]*)*)([\s\S]*)$/.exec(first);
    const spaces = m[1].length; const marks = m[2].replace(/[  ]/g, '').length;
    cells[0] = m[3];
    let wbsLevel = null;
    if (cells.length >= 2 && WBS_ONLY.test(cells[0].trim()) && cells[1].trim() && !looksLikeDate(cells[1])) {
      wbsLevel = cells[0].trim().replace(/\.$/, '').split('.').length - 1; cells.shift();
    } else {
      const w = WBS_PREFIX.exec(cells[0].trim());
      if (w && !looksLikeDate(cells[0].trim())) { wbsLevel = w[1].split('.').length - 1; cells[0] = w[2]; }
    }
    items.push({ no, line, cells: cells.map((c) => c.trim()), delim, lead, spaces, marks, wbsLevel });
  }

  // 2. A first row of column titles is not a task.
  if (items.length) {
    const filled = items[0].cells.filter(Boolean);
    if (filled.length >= 2 && filled.every((c) => HEADER_CELL.test(c))) items.shift();
  }

  // 3. Slash dates: day-first unless the data says month-first.
  const slash = [];
  for (const it of items) for (const c of it.cells.slice(1)) { const m = RE_NUM.exec(cleanDate(c)); if (m) slash.push([Number(m[1]), Number(m[2])]); }
  let order = dateOrder === 'dmy' || dateOrder === 'mdy' ? dateOrder : null;
  let ambiguous = false;
  if (!order) {
    if (slash.some(([a]) => a > 12)) order = 'dmy';
    else if (slash.some(([, b]) => b > 12)) order = 'mdy';
    else { order = 'dmy'; ambiguous = slash.some(([a, b]) => a !== b); }
  }

  // 4. Levels from indentation: the narrowest indent is level 1, the next level 2.
  const widths = [...new Set(items.filter((it) => it.wbsLevel === null).map((it) => it.spaces + it.lead * 4).filter((w) => w > 0))].sort((a, b) => a - b);
  const levelOf = (it) => {
    if (it.wbsLevel !== null) return Math.min(MAX_LEVEL, it.wbsLevel);
    const w = it.spaces + it.lead * 4;
    return Math.min(MAX_LEVEL, w ? widths.indexOf(w) + 1 : it.marks); // "  - Task" is one level (the dash is just a bullet there)
  };

  // 5. Names and dates.
  const rows = []; const errors = [];
  for (const it of items) {
    const { cells } = it;
    const dateIdx = [];
    cells.forEach((c, k) => { if (k > 0 && looksLikeDate(c)) dateIdx.push(k); });
    const [si, ei] = [dateIdx[0], dateIdx[1]];
    // Tabs never occur inside a name; commas may ("Background, Existing Work"), so those cells are put back together.
    let nameCells = it.delim === '\t' || !dateIdx.length ? cells.slice(0, 1) : cells.slice(0, dateIdx[0]);
    while (nameCells.length > 1 && /^\d+(?:\.\d+)?(?:\s*d(?:ays?)?)?$/i.test(nameCells[nameCells.length - 1])) nameCells = nameCells.slice(0, -1); // a duration column
    const name = nameCells.filter(Boolean).join(`${it.delim.trim()} `).replace(/\s+/g, ' ').trim();
    const row = { name, start: null, end: null, level: levelOf(it), line: it.no };
    const fail = (code, value) => errors.push({ line: it.no, text: it.line.trim(), code, ...(value === undefined ? {} : { value }) });
    if (!name) { fail('name'); continue; }
    if (dateIdx.length === 0) {
      // Name only: a phase if sub-tasks follow (checked below). An unreadable extra cell is reported instead.
      const extra = cells.slice(1).find((c) => c && !/^\d+(\.\d+)?$/.test(c));
      if (extra) { fail(cells.length >= 3 ? 'start' : 'end', extra); continue; }
      row.noDates = true; rows.push(row); continue;
    }
    if (dateIdx.length === 1) {
      const k = dateIdx[0];
      const other = k === 1 ? cells[2] : cells[1];
      if (other && !/^\d+(\.\d+)?$/.test(other)) fail(k === 1 ? 'end' : 'start', other); else fail('dates');
      continue;
    }
    const start = parseDate(cells[si], order); const end = parseDate(cells[ei], order);
    if (!start) { fail('start', cells[si]); continue; }
    if (!end) { fail('end', cells[ei]); continue; }
    if (dayOf(end) < dayOf(start)) { fail('order'); continue; }
    row.start = start; row.end = end; rows.push(row);
  }

  // 6. Rows without dates must be phases.
  const kept = [];
  rows.forEach((row, k) => {
    if (row.noDates) {
      const next = rows[k + 1];
      if (next && next.level > row.level) { const today = todayISO(); kept.push({ ...row, start: today, end: today, noDates: undefined }); return; }
      const it = items.find((x) => x.no === row.line);
      errors.push({ line: row.line, text: it ? it.line.trim() : row.name, code: 'dates' });
      return;
    }
    kept.push(row);
  });
  errors.sort((a, b) => a.line - b.line);

  // Levels are relative to the shallowest row, so a table pasted with an empty first column still starts at level 0.
  const min = kept.length ? Math.min(...kept.map((r) => r.level)) : 0;
  for (const r of kept) r.level -= min;
  return { rows: kept.map(({ noDates, ...r }) => r), errors, dateOrder: order, ambiguous };
}
