// The schedule a new Gantt figure starts with: a typical graduation-project plan whose dates begin on the first
// day of the current month. It is report content (task names stay English), so nothing here goes through t().
import { createGantt, createGanttTask, dayOf, isoOf } from './gantt-model.js';
import { syncPhases } from './gantt-ops.js';

// [name, level, first day (offset from the start), length in days]
const SAMPLE = [
  ['Form Team', 0, 0, 7],
  ['Project Idea and Proposal', 0, 7, 14],
  ['Requirements Analysis', 0, 21, 0],
  ['Literature Review', 1, 21, 10],
  ['Software Requirements Specification', 1, 31, 14],
  ['System Design', 0, 45, 21],
  ['Implementation', 0, 66, 42],
  ['Testing and Validation', 0, 108, 21],
  ['Final Report and Presentation', 0, 129, 14],
];

/** A small, ready-to-edit schedule (9 rows, one phase). `today` is injectable for tests. */
export function sampleGantt(today = new Date()) {
  const first = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), 1) / 86400000);
  const start = isoOf(first);
  return createGantt({
    tasks: syncPhases(SAMPLE.map(([name, level, offset, days]) => {
      const s = isoOf(dayOf(start) + offset);
      return createGanttTask({ name, level, start: s, end: isoOf(dayOf(s) + Math.max(0, days - 1)) });
    })),
  });
}
