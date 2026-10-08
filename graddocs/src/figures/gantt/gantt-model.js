// Gantt charts as data. A figure of type 'gantt' keeps its schedule in figure.gantt and its picture in
// figure.diagram; ganttDiagram() rebuilds the picture from the data after every edit, so exports, the
// Document Preview and Word see an ordinary diagram (vector shapes and text) and never need to know about Gantt.
//
//   figure.gantt = {
//     tasks: [{ id, name, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (inclusive), level: 0 | 1 | 2 }],
//     weekStart: 0 (Sunday) | 1 (Monday), color, showIdle (grey weeks with no task), showWbs, showDates,
//     drawUntil: '' | 'YYYY-MM-DD' (bars and grey weeks stop at this day; the rest of the timeline stays white),
//   }
// A task followed by deeper tasks is a phase: its dates are the span of its sub-tasks and it is drawn as a
// summary bar. WBS numbers (1, 2, 6.1 …) come from the levels; nothing derived is stored.
import { uid } from '../../core/utils.js';
import { builder } from '../templates/builder.js';

export const GANTT_DEFAULTS = { weekStart: 0, color: '#0891B2', showIdle: true, showWbs: true, showDates: true, drawUntil: '' };
const IDLE = '#E3E6EA'; const GRID = '#E5E7EB'; const GRID_STRONG = '#C7CCD3';
const INK = '#111827'; const INK2 = '#4B5563'; const MUTED = '#6B7280';
const DAY = 86400000;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 'YYYY-MM-DD' → UTC day number (no time zones involved). */
export const dayOf = (iso) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
export const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);
/** Today in the user's own time zone as 'YYYY-MM-DD' (toISOString would be a day behind after midnight east of UTC). */
export const todayISO = () => { const d = new Date(); return isoOf(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)); };
/** A real calendar date in 'YYYY-MM-DD' form ('2025-02-31' is rejected: Date.UTC alone would roll it over to March). */
export const isValidISO = (s) => ISO_RE.test(String(s || '')) && isoOf(dayOf(s)) === s;
const validISO = isValidISO;
/** 'YYYY-MM-DD' plus n days. */
export const addDaysISO = (iso, n) => isoOf(dayOf(iso) + n);
/** Inclusive length in days of a start/end pair. */
export const durationDays = (start, end) => dayOf(end) - dayOf(start) + 1;

export function createGanttTask(fields = {}) {
  const today = todayISO();
  return { id: uid('gt'), name: 'New task', start: today, end: today, level: 0, ...fields };
}

export function createGantt(fields = {}) {
  return { ...GANTT_DEFAULTS, tasks: [], ...fields };
}

/** Repair imported / older data: valid dates (end ≥ start), levels 0–2 that never jump by more than one. */
export function normalizeGantt(input) {
  const g = { ...GANTT_DEFAULTS, ...(input && typeof input === 'object' ? input : {}) };
  g.weekStart = Number(g.weekStart) === 1 ? 1 : 0;
  g.color = /^#[0-9a-f]{6}$/i.test(String(g.color || '')) ? g.color : GANTT_DEFAULTS.color;
  for (const k of ['showIdle', 'showWbs', 'showDates']) g[k] = g[k] !== false;
  g.drawUntil = validISO(g.drawUntil) ? g.drawUntil : '';
  let prev = -1;
  g.tasks = (Array.isArray(g.tasks) ? g.tasks : []).filter((t) => t && typeof t === 'object').map((t) => {
    const start = validISO(t.start) ? t.start : todayISO();
    const end = validISO(t.end) && dayOf(t.end) >= dayOf(start) ? t.end : start;
    const level = Math.max(0, Math.min(2, Math.round(Number(t.level) || 0), prev + 1));
    prev = level;
    return { id: t.id || uid('gt'), name: String(t.name ?? '').trim() || 'Untitled task', start, end, level };
  });
  return g;
}

/** Is task i a phase (followed by deeper tasks)? */
export const isPhase = (tasks, i) => i + 1 < tasks.length && tasks[i + 1].level > tasks[i].level;

/** WBS numbers from the levels: ['1', '2', '2.1', '2.2', '3'] */
export function wbsNumbers(tasks) {
  const counters = [];
  return tasks.map((t) => {
    counters.length = t.level + 1;
    counters[t.level] = (counters[t.level] || 0) + 1;
    for (let i = 0; i < t.level; i += 1) if (!counters[i]) counters[i] = 1;
    return counters.join('.');
  });
}

/** Effective [start, end] day numbers: a phase spans its sub-tasks. */
export function effectiveSpans(tasks) {
  const spans = tasks.map((t) => [dayOf(t.start), dayOf(t.end)]);
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    if (!isPhase(tasks, i)) continue;
    let lo = Infinity; let hi = -Infinity;
    for (let j = i + 1; j < tasks.length && tasks[j].level > tasks[i].level; j += 1) {
      if (tasks[j].level !== tasks[i].level + 1) continue;
      lo = Math.min(lo, spans[j][0]); hi = Math.max(hi, spans[j][1]);
    }
    if (lo <= hi) spans[i] = [lo, hi];
  }
  return spans;
}

/** Weeks covered by the chart: { first (day of the first week start), count } — at least 4 weeks. */
export function weekRange(gantt) {
  const spans = effectiveSpans(gantt.tasks);
  if (!spans.length) { const d = dayOf(todayISO()); return { first: weekStartOf(d, gantt.weekStart), count: 8 }; }
  const lo = Math.min(...spans.map((s) => s[0])); const hi = Math.max(...spans.map((s) => s[1]));
  const first = weekStartOf(lo, gantt.weekStart);
  return { first, count: Math.max(4, Math.floor((hi - first) / 7) + 1) };
}
// 1970-01-01 was a Thursday: (day + 4) % 7 is 0 on Sundays.
const weekStartOf = (day, weekStart) => day - (((day + 4 - weekStart) % 7) + 7) % 7;

/** The last day drawn on the timeline (drawUntil), or Infinity when the whole plan is drawn. */
export const lastDrawnDay = (gantt) => (validISO(gantt.drawUntil) ? dayOf(gantt.drawUntil) : Infinity);

/** Runs of consecutive weeks in which no task is scheduled: [{ from, to }] (week indexes). Weeks after drawUntil are never idle. */
export function idleRuns(gantt) {
  const { first, count } = weekRange(gantt);
  const spans = effectiveSpans(gantt.tasks);
  const until = lastDrawnDay(gantt);
  const runs = [];
  for (let w = 0; w < count; w += 1) {
    const a = first + w * 7; const b = a + 6;
    if (a > until) break;
    const busy = spans.some(([s, e]) => s <= Math.min(b, until) && e >= a);
    if (busy) continue;
    if (runs.length && runs[runs.length - 1].to === w - 1) runs[runs.length - 1].to = w;
    else runs.push({ from: w, to: w });
  }
  return runs;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The chart as an ordinary diagram (vector shapes and text). fonts: { fontFamily, fontSize } */
export function ganttDiagram(input, fonts = {}) {
  const g = normalizeGantt(input);
  const b = builder({ fontFamily: fonts.fontFamily, fontSize: 13 });
  const { first, count } = weekRange(g);
  const tasks = g.tasks;
  const wbs = wbsNumbers(tasks);
  const spans = effectiveSpans(tasks);
  const until = lastDrawnDay(g);
  const COL = count > 52 ? 22 : count > 40 ? 28 : 34;
  const ROW = 30; const TOP = 8; const HEAD = 64;
  const xWbs = 16; const xName = g.showWbs ? 64 : 16;
  const nameW = 340;
  const xStart = xName + nameW; const xEnd = xStart + 108;
  const xTL = (g.showDates ? xEnd + 114 : xName + nameW) + 8;
  const W = xTL + count * COL + 16;
  const bodyTop = TOP + HEAD; const bodyH = Math.max(1, tasks.length) * ROW;
  const legendY = bodyTop + bodyH + 18;
  const H = legendY + 28;
  const xOfDay = (day) => xTL + ((day - first) / 7) * COL;
  const line = (x1, y1, x2, y2, stroke = GRID, width = 1) => b.edge({ x: x1, y: y1 }, { x: x2, y: y2 }, { routing: 'straight', style: { stroke, strokeWidth: width, endArrow: 'none' } });
  const label = (x, y, w, h, text, style = {}) => b.node('text', x, y, w, h, text, { align: 'left', fontSize: 13, textColor: INK, ...style });
  const box = (shape, x, y, w, h, fill, style = {}) => b.node(shape, x, y, w, h, '', { fill, stroke: fill, strokeWidth: 0, ...style });

  // Grey weeks with no scheduled task.
  if (g.showIdle) {
    for (const run of idleRuns(g)) {
      const x0 = xTL + run.from * COL; const x1 = xTL + (run.to + 1) * COL;
      box('rect', x0, bodyTop, x1 - x0, bodyH, IDLE);
    }
  }
  // Grid: row lines, week columns, month boundaries.
  for (let r = 0; r <= tasks.length; r += 1) line(xWbs - 8, bodyTop + r * ROW, W - 16, bodyTop + r * ROW);
  for (let k = 0; k <= count; k += 1) line(xTL + k * COL, TOP + HEAD / 2, xTL + k * COL, bodyTop + bodyH);
  // A month owns the weeks whose 4th day falls in it.
  const spansM = [];
  for (let k = 0; k < count; k += 1) {
    const d = new Date((first + k * 7 + 3) * DAY);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const last = spansM[spansM.length - 1];
    if (last && last.key === key) last.to = k; else spansM.push({ key, from: k, to: k, y: d.getUTCFullYear(), m: d.getUTCMonth() });
  }
  for (const s of spansM) {
    const x0 = xTL + s.from * COL; const x1 = xTL + (s.to + 1) * COL;
    line(x0, TOP, x0, bodyTop + bodyH, GRID_STRONG);
    label(x0, TOP + 4, x1 - x0, 24, s.to - s.from >= 2 ? `${MONTHS[s.m]} ${s.y}` : MONTHS[s.m], { align: 'center', fontWeight: 'bold' });
  }
  line(xTL + count * COL, TOP, xTL + count * COL, bodyTop + bodyH, GRID_STRONG);
  for (let k = 0; k < count; k += 1) label(xTL + k * COL, TOP + 36, COL, 24, String(k + 1), { align: 'center', fontSize: 11, textColor: MUTED });
  label(xTL - 60, TOP + 36, 52, 24, 'Week', { align: 'right', fontSize: 11, fontWeight: 'bold', textColor: MUTED });
  // Table header.
  if (g.showWbs) label(xWbs, TOP + 36, 46, 24, 'WBS', { fontWeight: 'bold' });
  label(xName, TOP + 36, nameW - 8, 24, 'Task Name', { fontWeight: 'bold' });
  if (g.showDates) { label(xStart, TOP + 36, 100, 24, 'Start', { fontWeight: 'bold' }); label(xEnd, TOP + 36, 100, 24, 'End', { fontWeight: 'bold' }); }
  line(xWbs - 8, bodyTop, W - 16, bodyTop, INK2, 1.2);
  line(xTL, TOP, xTL, bodyTop + bodyH, INK2, 1.2);

  // Rows.
  tasks.forEach((t, i) => {
    const y = bodyTop + i * ROW;
    const phase = isPhase(tasks, i);
    const weight = phase ? 'bold' : 'normal';
    if (g.showWbs) label(xWbs, y, 46, ROW, wbs[i], { fontSize: 12.5, fontWeight: weight, textColor: INK2 });
    label(xName + t.level * 16, y, nameW - 8 - t.level * 16, ROW, t.name, { fontWeight: weight });
    if (g.showDates) {
      label(xStart, y, 100, ROW, isoOf(spans[i][0]), { fontSize: 12.5, textColor: INK2 });
      label(xEnd, y, 100, ROW, isoOf(spans[i][1]), { fontSize: 12.5, textColor: INK2 });
    }
    if (spans[i][0] > until) return; // after drawUntil: the timeline stays white
    const x0 = xOfDay(spans[i][0]); const x1 = xOfDay(Math.min(spans[i][1], until) + 1);
    if (phase) {
      // Summary bar: a slim bar with a short block at each end.
      box('rect', x0, y + ROW / 2 - 7, x1 - x0, 7, g.color);
      box('rect', x0, y + ROW / 2 - 7, 5, 13, g.color);
      box('rect', x1 - 5, y + ROW / 2 - 7, 5, 13, g.color);
    } else {
      const w = Math.max(x1 - x0, 5);
      box('roundRect', (x0 + x1 - w) / 2, y + 8, w, ROW - 16, g.color, { radius: 3 });
    }
  });

  // Idle labels above the grid lines.
  if (g.showIdle) {
    for (const run of idleRuns(g)) {
      const n = run.to - run.from + 1;
      if (n < 4) continue;
      const cx = xTL + ((run.from + run.to + 1) / 2) * COL; const cy = bodyTop + bodyH / 2;
      b.node('roundRect', cx - 82, cy - 25, 164, 50, `No work scheduled\n${n} weeks`, { fill: '#ffffff', stroke: GRID_STRONG, strokeWidth: 1, radius: 6, fontSize: 13, fontWeight: 'bold', textColor: INK2 });
    }
  }
  // Legend.
  box('roundRect', xWbs, legendY, 26, 12, g.color, { radius: 3 });
  label(xWbs + 34, legendY - 6, 60, 24, 'Task');
  box('rect', xWbs + 100, legendY + 1, 26, 6, g.color);
  box('rect', xWbs + 100, legendY + 1, 4, 11, g.color);
  box('rect', xWbs + 122, legendY + 1, 4, 11, g.color);
  label(xWbs + 134, legendY - 6, 180, 24, 'Phase (group of tasks)');
  if (g.showIdle && idleRuns(g).length) {
    b.node('rect', xWbs + 330, legendY - 1, 26, 14, '', { fill: IDLE, stroke: GRID_STRONG, strokeWidth: 1 });
    label(xWbs + 364, legendY - 6, 240, 24, 'Week with no scheduled work');
  }
  label(W - 316, legendY - 6, 300, 24, g.weekStart === 1 ? 'Weeks run Monday to Sunday' : 'Weeks run Sunday to Saturday', { align: 'right', fontSize: 12, textColor: MUTED });

  return b.diagram({ width: Math.ceil(W), height: Math.ceil(H) });
}
