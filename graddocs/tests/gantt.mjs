// Pure-logic tests for the Gantt chart figure (no browser): the data model, task operations, the "paste from
// Excel" parser, the generated diagram, the figure type and route. Run: node tests/gantt.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeGantt, createGantt, createGanttTask, wbsNumbers, effectiveSpans, isPhase, weekRange, idleRuns,
  ganttDiagram, dayOf, isoOf, todayISO, isValidISO, addDaysISO, durationDays,
} from '../src/figures/gantt/gantt-model.js';
import * as ops from '../src/figures/gantt/gantt-ops.js';
import { sampleGantt } from '../src/figures/gantt/gantt-sample.js';
import { getFigureType, buildTemplate } from '../src/figures/types.js';
import { parseHash } from '../src/app/routes.js';
import { createProject, createFigure, normalizeProject } from '../src/core/model.js';
import { AR } from '../src/i18n/ar/index.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
};
const task = (name, start, end, level = 0) => createGanttTask({ name, start, end, level });
const names = (tasks) => tasks.map((t) => `${t.level}:${t.name}`);

/** The student's real schedule (see the task description): idle weeks between Software Design and the implementation. */
function realSchedule(fields = {}) {
  const srs = [
    ['Stakeholders', '2025-10-07', '2025-10-08'], ['Interviews', '2025-10-07', '2025-10-09'], ['Functional requirements', '2025-10-08', '2025-10-10'],
    ['Non-functional requirements', '2025-10-09', '2025-10-10'], ['Use cases', '2025-10-10', '2025-10-12'], ['Constraints', '2025-10-10', '2025-10-11'],
    ['Assumptions', '2025-10-11', '2025-10-12'], ['Interfaces', '2025-10-12', '2025-10-13'], ['Priorities', '2025-10-13', '2025-10-14'],
    ['Review with supervisor', '2025-10-14', '2025-10-15'], ['Finalise SRS', '2025-10-15', '2025-10-15'],
  ];
  return createGantt({
    tasks: [
      task('Create Team', '2025-09-01', '2025-09-08'), task('Project Idea', '2025-09-09', '2025-09-16'),
      task('Project Overview', '2025-09-17', '2025-09-18'), task('Introduction', '2025-09-19', '2025-09-26'),
      task('Background / Existing Work', '2025-09-29', '2025-10-06'),
      task('Software Requirements Specification', '2025-10-07', '2025-10-15'),
      ...srs.map(([n, s, e]) => task(n, s, e, 1)),
      task('Software Design', '2025-10-16', '2025-10-24'),
      task('Class diagrams', '2025-10-16', '2025-10-18', 1), task('Sequence diagrams', '2025-10-19', '2025-10-21', 1), task('Database design', '2025-10-22', '2025-10-24', 1),
      task('System Implementation & Validation', '2026-01-26', '2026-05-20'), task('Conclusion and Future Work', '2026-05-21', '2026-06-01'),
    ],
    ...fields,
  });
}

console.log('dates');
test('isoOf / dayOf round trip, validation and arithmetic', () => {
  assert.equal(isoOf(dayOf('2025-09-01')), '2025-09-01');
  assert.equal(dayOf('2025-09-02') - dayOf('2025-09-01'), 1);
  assert.equal(isValidISO('2025-02-28'), true);
  assert.equal(isValidISO('2025-02-31'), false); // would silently roll over to March
  assert.equal(isValidISO('2025-13-01'), false);
  assert.equal(isValidISO('25-01-01'), false);
  assert.equal(isValidISO(''), false);
  assert.equal(addDaysISO('2025-02-28', 1), '2025-03-01');
  assert.equal(durationDays('2025-09-01', '2025-09-08'), 8); // inclusive
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});

console.log('wbsNumbers');
test('numbers follow the levels', () => {
  const tasks = [0, 0, 1, 1, 2, 2, 1, 0, 1].map((level, i) => task(`t${i}`, '2025-01-01', '2025-01-02', level));
  assert.deepEqual(wbsNumbers(tasks), ['1', '2', '2.1', '2.2', '2.2.1', '2.2.2', '2.3', '3', '3.1']);
});
test('a flat list is numbered 1..n and the real schedule has 9 top-level rows', () => {
  assert.deepEqual(wbsNumbers([task('a', '2025-01-01', '2025-01-01'), task('b', '2025-01-01', '2025-01-01')]), ['1', '2']);
  const g = realSchedule();
  const w = wbsNumbers(g.tasks);
  assert.equal(w[5], '6'); assert.equal(w[6], '6.1'); assert.equal(w[16], '6.11'); assert.equal(w[17], '7'); assert.equal(w[18], '7.1');
  assert.equal(w[g.tasks.length - 1], '9');
});
test('isPhase: a task followed by deeper tasks', () => {
  const tasks = [task('a', '2025-01-01', '2025-01-01'), task('b', '2025-01-01', '2025-01-01', 1), task('c', '2025-01-01', '2025-01-01')];
  assert.deepEqual([0, 1, 2].map((i) => isPhase(tasks, i)), [true, false, false]);
});

console.log('effectiveSpans');
test('a phase spans its sub-tasks, whatever its own dates say', () => {
  const tasks = [task('phase', '2030-01-01', '2030-01-02'), task('a', '2025-03-05', '2025-03-10', 1), task('b', '2025-03-01', '2025-03-04', 1), task('x', '2025-05-01', '2025-05-02')];
  const spans = effectiveSpans(tasks).map(([s, e]) => [isoOf(s), isoOf(e)]);
  assert.deepEqual(spans[0], ['2025-03-01', '2025-03-10']);
  assert.deepEqual(spans[3], ['2025-05-01', '2025-05-02']);
});
test('nested phases: the outer phase covers the inner phase and its sub-tasks', () => {
  const tasks = [
    task('outer', '2000-01-01', '2000-01-01'),
    task('inner', '2000-01-01', '2000-01-01', 1), task('i1', '2025-02-10', '2025-02-12', 2), task('i2', '2025-02-20', '2025-02-25', 2),
    task('leaf', '2025-01-05', '2025-01-08', 1),
  ];
  const spans = effectiveSpans(tasks).map(([s, e]) => [isoOf(s), isoOf(e)]);
  assert.deepEqual(spans[1], ['2025-02-10', '2025-02-25']);
  assert.deepEqual(spans[0], ['2025-01-05', '2025-02-25']);
});
test('the real schedule: Software Requirements Specification spans 2025-10-07 → 10-15', () => {
  const g = realSchedule(); const spans = effectiveSpans(g.tasks);
  assert.deepEqual([isoOf(spans[5][0]), isoOf(spans[5][1])], ['2025-10-07', '2025-10-15']);
  assert.equal(g.tasks.filter((t, i) => isPhase(g.tasks, i)).length, 2);
});

console.log('normalizeGantt');
test('bad dates fall back to today, impossible dates are rejected', () => {
  const today = todayISO();
  const g = normalizeGantt({ tasks: [{ name: 'a', start: 'soon', end: '2025-02-31' }, { name: 'b', start: undefined, end: null }, { name: 'c', start: '2025-02-31', end: '2025-03-01' }] });
  for (const t of g.tasks) assert.equal(t.start, today);
  assert.deepEqual(g.tasks.map((t) => t.end), [today, today, today]);
});
test('end before start is repaired to the start', () => {
  const g = normalizeGantt({ tasks: [{ name: 'a', start: '2025-05-10', end: '2025-05-01' }, { name: 'b', start: '2025-05-10', end: '2025-05-10' }] });
  assert.equal(g.tasks[0].end, '2025-05-10'); assert.equal(g.tasks[1].end, '2025-05-10');
});
test('levels are clamped to 0–2 and never jump by more than one', () => {
  const levels = [3, 2, 2, 1, 5, -1, 'x', 1.4].map((level, i) => ({ name: `t${i}`, start: '2025-01-01', end: '2025-01-01', level }));
  assert.deepEqual(normalizeGantt({ tasks: levels }).tasks.map((t) => t.level), [0, 1, 2, 1, 2, 0, 0, 1]);
});
test('names, ids, settings and junk entries are repaired', () => {
  const g = normalizeGantt({ weekStart: 7, color: 'red', showIdle: false, showWbs: 'no', tasks: [null, 5, { name: '   ' }, { id: 'keep', name: ' Trim me ' }] });
  assert.equal(g.tasks.length, 2);
  assert.equal(g.tasks[0].name, 'Untitled task'); assert.equal(g.tasks[1].name, 'Trim me'); assert.equal(g.tasks[1].id, 'keep');
  assert.ok(g.tasks[0].id);
  assert.equal(g.weekStart, 0); assert.equal(g.color, '#0891B2'); assert.equal(g.showIdle, false); assert.equal(g.showWbs, true); assert.equal(g.showDates, true);
  assert.equal(normalizeGantt({ weekStart: 1 }).weekStart, 1);
  assert.deepEqual(normalizeGantt(null).tasks, []);
  assert.deepEqual(normalizeGantt('nonsense').tasks, []);
});
test('normalizeGantt is idempotent and does not touch its input', () => {
  const input = { tasks: [{ name: 'a', start: '2025-05-10', end: '2025-05-01', level: 4 }] };
  const copy = JSON.stringify(input);
  const once = normalizeGantt(input);
  assert.equal(JSON.stringify(input), copy);
  assert.deepEqual(normalizeGantt(once), once);
});

console.log('weeks and idle runs');
test('weekRange starts on the chosen weekday', () => {
  const g = realSchedule();
  const sun = weekRange(g); const mon = weekRange({ ...g, weekStart: 1 });
  assert.equal(isoOf(sun.first), '2025-08-31'); // a Sunday
  assert.equal(new Date(sun.first * 86400000).getUTCDay(), 0);
  assert.equal(isoOf(mon.first), '2025-09-01'); // a Monday
  assert.equal(new Date(mon.first * 86400000).getUTCDay(), 1);
  assert.ok(sun.count >= 4);
  assert.equal(weekRange(createGantt()).count, 8);
});
test('Sunday weeks: exactly one idle run, 13 weeks from 2025-10-26 to 2026-01-24', () => {
  const g = realSchedule({ weekStart: 0 });
  const runs = idleRuns(g); const { first } = weekRange(g);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].to - runs[0].from + 1, 13);
  assert.equal(isoOf(first + runs[0].from * 7), '2025-10-26');
  assert.equal(isoOf(first + (runs[0].to + 1) * 7 - 1), '2026-01-24');
});
test('Monday weeks: one idle run of 13 weeks, 2025-10-27 → 2026-01-25', () => {
  const g = realSchedule({ weekStart: 1 });
  const runs = idleRuns(g); const { first } = weekRange(g);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].to - runs[0].from + 1, 13);
  assert.equal(isoOf(first + runs[0].from * 7), '2025-10-27');
  assert.equal(isoOf(first + (runs[0].to + 1) * 7 - 1), '2026-01-25');
});
test('a schedule without gaps has no idle weeks; two gaps are two runs', () => {
  const dense = createGantt({ tasks: [task('a', '2025-01-05', '2025-01-18'), task('b', '2025-01-19', '2025-02-01')] });
  assert.deepEqual(idleRuns(dense), []);
  const gaps = createGantt({ tasks: [task('a', '2025-01-05', '2025-01-11'), task('b', '2025-02-02', '2025-02-08'), task('c', '2025-03-09', '2025-03-15')] });
  assert.equal(idleRuns(gaps).length, 2);
});

console.log('task operations');
const tree = () => [task('A', '2025-01-01', '2025-01-05'), task('a1', '2025-01-01', '2025-01-02', 1), task('a2', '2025-01-03', '2025-01-05', 1), task('B', '2025-02-01', '2025-02-05'), task('C', '2025-03-01', '2025-03-05')];
test('blockEnd covers a task and its sub-tasks', () => {
  const t = tree();
  assert.equal(ops.blockEnd(t, 0), 3); assert.equal(ops.blockEnd(t, 1), 2); assert.equal(ops.blockEnd(t, 3), 4);
});
test('indent: one level deeper than the row above, never beyond level 2; sub-tasks go along', () => {
  const t = tree();
  assert.equal(ops.indentTask(t, 0), null); // first row
  assert.equal(ops.canIndent(t, 1), false); // already deeper than... level 1 under a level 0 row
  assert.deepEqual(names(ops.indentTask(t, 3)), ['0:A', '1:a1', '1:a2', '1:B', '0:C']);
  const deep = [task('A', '2025-01-01', '2025-01-01'), task('b', '2025-01-01', '2025-01-01', 1), task('c', '2025-01-01', '2025-01-01', 2), task('d', '2025-01-01', '2025-01-01', 2)];
  assert.equal(ops.indentTask(deep, 3), null); // level 3 does not exist
  assert.equal(ops.indentTask(deep, 1), null); // its sub-task would become level 3
  assert.deepEqual(names(ops.indentTask([task('x', '2025-01-01', '2025-01-01'), task('y', '2025-01-01', '2025-01-01'), task('z', '2025-01-01', '2025-01-01', 1)], 1)), ['0:x', '1:y', '2:z']);
  assert.deepEqual(t.map((x) => x.level), [0, 1, 1, 0, 0]); // the input is untouched
});
test('outdent', () => {
  const t = tree();
  assert.equal(ops.outdentTask(t, 0), null);
  assert.deepEqual(names(ops.outdentTask(t, 2)), ['0:A', '1:a1', '0:a2', '0:B', '0:C']);
});
test('move up / down moves a whole block past its sibling', () => {
  const t = tree();
  assert.deepEqual(names(ops.moveTask(t, 3, -1)), ['0:B', '0:A', '1:a1', '1:a2', '0:C']);
  assert.deepEqual(names(ops.moveTask(t, 0, 1)), ['0:B', '0:A', '1:a1', '1:a2', '0:C']);
  assert.deepEqual(names(ops.moveTask(t, 2, -1)), ['0:A', '1:a2', '1:a1', '0:B', '0:C']);
  assert.equal(ops.moveTask(t, 1, -1), null); // first sub-task cannot leave its phase by moving
  assert.equal(ops.moveTask(t, 2, 1), null); // last sub-task
  assert.equal(ops.moveTask(t, 0, -1), null); assert.equal(ops.moveTask(t, 4, 1), null);
  assert.equal(ops.canMoveUp(t, 3), true); assert.equal(ops.canMoveDown(t, 4), false);
});
test('insertBelow puts a new task after the block, at the same level, in the following week', () => {
  const t = tree();
  const r = ops.insertBelow(t, 0);
  assert.deepEqual(names(r.tasks), ['0:A', '1:a1', '1:a2', '0:New task', '0:B', '0:C']);
  assert.equal(r.task.start, '2025-01-06'); assert.equal(r.task.end, '2025-01-12');
  const r2 = ops.insertBelow(t, 1);
  assert.deepEqual(names(r2.tasks), ['0:A', '1:a1', '1:New task', '1:a2', '0:B', '0:C']);
  assert.equal(ops.insertBelow(t, 9), null);
});
test('appendTask keeps the last row\'s level; appendPhase adds a phase with its first sub-task', () => {
  assert.deepEqual(names(ops.appendTask([]).tasks), ['0:New task']);
  assert.deepEqual(names(ops.appendTask(tree().slice(0, 3)).tasks), ['0:A', '1:a1', '1:a2', '1:New task']);
  const r = ops.appendPhase(tree());
  assert.deepEqual(names(r.tasks).slice(-2), ['0:New phase', '1:New task']);
  assert.equal(isPhase(r.tasks, r.tasks.length - 2), true);
});
test('removeTask deletes the block, or only the row and promotes its sub-tasks', () => {
  const t = tree();
  assert.deepEqual(names(ops.removeTask(t, 0)), ['0:B', '0:C']);
  assert.deepEqual(names(ops.removeTask(t, 0, { keepChildren: true })), ['0:a1', '0:a2', '0:B', '0:C']);
  assert.deepEqual(names(ops.removeTask(t, 1)), ['0:A', '1:a2', '0:B', '0:C']);
});
test('syncPhases writes the span of the sub-tasks into the phase dates', () => {
  const t = tree(); t[0].start = '1999-01-01'; t[0].end = '1999-01-02';
  ops.syncPhases(t);
  assert.deepEqual([t[0].start, t[0].end], ['2025-01-01', '2025-01-05']);
  assert.deepEqual([t[3].start, t[3].end], ['2025-02-01', '2025-02-05']); // leaves keep their own
});
test('operations never leave an invalid outline once normalised', () => {
  let tasks = tree();
  for (const step of [(x) => ops.moveTask(x, 3, -1), (x) => ops.outdentTask(x, 3), (x) => ops.removeTask(x, 0, { keepChildren: true }), (x) => ops.indentTask(x, 1), (x) => ops.insertBelow(x, 0)?.tasks]) {
    tasks = normalizeGantt({ tasks: step(tasks) ?? tasks }).tasks;
    let prev = -1;
    for (const t of tasks) { assert.ok(t.level >= 0 && t.level <= 2 && t.level <= prev + 1); prev = t.level; }
  }
});

console.log('paste parser');
const parse = (text, opts) => ops.parseTaskRows(text, opts);
test('tab-separated rows, a header row and CRLF line ends', () => {
  const r = parse('Task name\tStart\tEnd\r\nCreate Team\t2025-09-01\t2025-09-08\r\nProject Idea\t2025-09-09\t2025-09-16\r\n');
  assert.deepEqual(r.rows.map((x) => [x.name, x.start, x.end, x.level]), [['Create Team', '2025-09-01', '2025-09-08', 0], ['Project Idea', '2025-09-09', '2025-09-16', 0]]);
  assert.deepEqual(r.errors, []);
});
test('comma-separated rows; commas inside a name and quoted names survive', () => {
  const r = parse('Background, Existing Work, 2025-09-29, 2025-10-06\n"Design, review",2025-10-07,2025-10-08');
  assert.deepEqual(r.rows.map((x) => x.name), ['Background, Existing Work', 'Design, review']);
  assert.equal(r.rows[0].start, '2025-09-29');
});
test('date formats: ISO, DD/MM/YYYY, M/D/YYYY, written months', () => {
  assert.equal(ops.parseDate('2025-09-01'), '2025-09-01');
  assert.equal(ops.parseDate('2025/9/1'), '2025-09-01');
  assert.equal(ops.parseDate('01/09/2025'), '2025-09-01'); // day first by default
  assert.equal(ops.parseDate('9/1/2025', 'mdy'), '2025-09-01');
  assert.equal(ops.parseDate('13/09/2025'), '2025-09-13');
  assert.equal(ops.parseDate('1 Sep 2025'), '2025-09-01');
  assert.equal(ops.parseDate('1-Sep-25'), '2025-09-01');
  assert.equal(ops.parseDate('September 1, 2025'), '2025-09-01');
  assert.equal(ops.parseDate('Mon 1 Sep 2025'), '2025-09-01');
  assert.equal(ops.parseDate('2025-09-01 00:00:00'), '2025-09-01');
  assert.equal(ops.parseDate('31/02/2025'), null);
  assert.equal(ops.parseDate('soon'), null);
  assert.equal(ops.parseDate(''), null);
});
test('slash dates: the data decides between day/month and month/day, and the choice can be forced', () => {
  const dmy = parse('a\t13/09/2025\t14/09/2025\nb\t03/04/2025\t05/04/2025');
  assert.equal(dmy.dateOrder, 'dmy'); assert.equal(dmy.rows[1].start, '2025-04-03');
  const mdy = parse('a\t09/13/2025\t09/14/2025\nb\t03/04/2025\t03/05/2025');
  assert.equal(mdy.dateOrder, 'mdy'); assert.equal(mdy.rows[1].start, '2025-03-04');
  const guess = parse('b\t03/04/2025\t05/04/2025');
  assert.equal(guess.dateOrder, 'dmy'); assert.equal(guess.ambiguous, true);
  assert.equal(parse('b\t03/04/2025\t05/04/2025', { dateOrder: 'mdy' }).rows[0].start, '2025-03-04');
});
test('levels from indentation, dashes and numeric WBS', () => {
  const r = parse([
    'Phase\t2025-01-01\t2025-01-31',
    '  Spaces one\t2025-01-01\t2025-01-10',
    '    Spaces two\t2025-01-02\t2025-01-03',
    '- Dash one\t2025-01-11\t2025-01-20',
    '-- Dash two\t2025-01-12\t2025-01-13',
    '7 Next\t2025-02-01\t2025-02-10',
    '7.1 Sub\t2025-02-01\t2025-02-02',
    '7.1.1 Sub-sub\t2025-02-01\t2025-02-01',
    '8\tSeparate WBS column\t2025-03-01\t2025-03-02',
    '8.1\tChild in a column\t2025-03-01\t2025-03-02',
    '  - Bullet in an indented list\t2025-03-03\t2025-03-04',
  ].join('\n'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => x.level), [0, 1, 2, 1, 2, 0, 1, 2, 0, 1, 1]);
  assert.equal(r.rows[6].name, 'Sub'); assert.equal(r.rows[8].name, 'Separate WBS column');
});
test('tab-indented rows and a whole table pasted with an empty first column start at level 0', () => {
  const r = parse('\tA\t2025-01-01\t2025-01-02\n\tB\t2025-01-03\t2025-01-04');
  assert.deepEqual(r.rows.map((x) => x.level), [0, 0]);
  const t = parse('A\t2025-01-01\t2025-01-30\n\tB\t2025-01-03\t2025-01-04');
  assert.deepEqual(t.rows.map((x) => x.level), [0, 1]);
});
test('a phase row may have no dates when sub-tasks follow it', () => {
  const r = parse('Design\n  Class diagrams\t2025-10-16\t2025-10-18\n  Database\t2025-10-19\t2025-10-24');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(names(r.rows), ['0:Design', '1:Class diagrams', '1:Database']);
});
test('free text with two dates at the end of the line', () => {
  const r = parse('Design 2025-10-16 2025-10-24\n- Review 2025-10-16 - 2025-10-18');
  assert.deepEqual(r.rows.map((x) => [x.name, x.start, x.end, x.level]), [['Design', '2025-10-16', '2025-10-24', 0], ['Review', '2025-10-16', '2025-10-18', 1]]);
});
test('unreadable rows are reported with their line number and a reason, and the rest is kept', () => {
  const r = parse([
    'Good\t2025-01-01\t2025-01-02',
    'Impossible\t31/02/2025\t01/03/2025',
    'Not a date\t2025-01-01\tsoon',
    'Missing end\t2025-01-01',
    'Backwards\t2025-05-01\t2025-04-01',
    'Orphan without dates',
    '\t2025-01-01\t2025-01-02',
    'Fine too\t2025-02-01\t2025-02-02',
  ].join('\n'));
  assert.deepEqual(r.rows.map((x) => x.name), ['Good', 'Fine too']);
  assert.deepEqual(r.errors.map((e) => [e.line, e.code]), [[2, 'start'], [3, 'end'], [4, 'dates'], [5, 'order'], [6, 'dates'], [7, 'dates']]);
  assert.equal(r.errors[0].value, '31/02/2025'); assert.equal(r.errors[1].value, 'soon');
  assert.equal(r.errors[0].text, 'Impossible\t31/02/2025\t01/03/2025');
});
test('empty input and blank lines', () => {
  assert.deepEqual(parse(''), { rows: [], errors: [], dateOrder: 'dmy', ambiguous: false });
  assert.equal(parse('\n\n  \n').rows.length, 0);
});
test('parsed rows normalise into a clean schedule', () => {
  const r = parse('A\t2025-01-01\t2025-01-30\n  B\t2025-01-02\t2025-01-03\n      C\t2025-01-04\t2025-01-05');
  const g = normalizeGantt({ tasks: r.rows });
  assert.deepEqual(g.tasks.map((x) => x.level), [0, 1, 2]);
});

console.log('diagram');
test('ganttDiagram returns an ordinary diagram', () => {
  const d = ganttDiagram(realSchedule(), { fontFamily: 'Times New Roman' });
  assert.ok(d.width > 600 && d.height > 300);
  assert.ok(Array.isArray(d.elements) && d.elements.length > 100);
  assert.equal(d.defaults.fontFamily, 'Times New Roman');
  assert.equal(d.background, '#ffffff');
  for (const el of d.elements) { assert.ok(el.id); assert.ok(el.type === 'node' || el.type === 'edge'); }
  const text = d.elements.map((e) => e.text || '').join('\n');
  assert.ok(text.includes('Create Team') && text.includes('Software Design') && text.includes('6.11') && text.includes('Task Name'));
  assert.ok(text.includes('No work scheduled\n13 weeks'));
});
test('settings change the picture', () => {
  const g = realSchedule();
  const base = ganttDiagram(g);
  const textOf = (d) => d.elements.map((e) => e.text || '').join('\n');
  assert.ok(textOf(ganttDiagram({ ...g, weekStart: 1 })).includes('Weeks run Monday to Sunday'));
  assert.ok(textOf(base).includes('Weeks run Sunday to Saturday'));
  assert.ok(!textOf(ganttDiagram({ ...g, showIdle: false })).includes('No work scheduled'));
  assert.ok(ganttDiagram({ ...g, showDates: false }).width < base.width);
  assert.ok(!textOf(ganttDiagram({ ...g, showWbs: false })).includes('WBS'));
  assert.ok(ganttDiagram({ ...g, color: '#7C3AED' }).elements.some((e) => e.style?.fill === '#7C3AED'));
  assert.ok(ganttDiagram(g).height < ganttDiagram({ ...g, tasks: [...g.tasks, ...g.tasks] }).height);
});
test('an empty schedule still draws a chart; bad input is repaired', () => {
  const d = ganttDiagram(createGantt());
  assert.ok(d.width > 0 && d.height > 0 && d.elements.length > 0);
  assert.ok(ganttDiagram(null).elements.length > 0);
  assert.ok(ganttDiagram({ tasks: [{ name: 'x', start: 'nope', end: 'nope', level: 9 }] }).elements.length > 0);
});

console.log('sample, type and route');
test('sampleGantt: a small schedule with one phase that starts this month', () => {
  const g = sampleGantt(new Date(2026, 4, 17));
  assert.ok(g.tasks.length >= 6 && g.tasks.length <= 10);
  assert.equal(g.tasks.filter((t, i) => isPhase(g.tasks, i)).length, 1);
  assert.equal(g.tasks[0].start, '2026-05-01');
  assert.deepEqual(normalizeGantt(g).tasks.map((t) => [t.level, t.start, t.end]), g.tasks.map((t) => [t.level, t.start, t.end])); // already clean
  const i = g.tasks.findIndex((t, k) => isPhase(g.tasks, k));
  assert.deepEqual([g.tasks[i].start, g.tasks[i].end], [g.tasks[i + 1].start, g.tasks[i + 2].end]); // phase dates follow the sub-tasks
  assert.equal(idleRuns(g).length, 0);
  assert.equal(new Set(g.tasks.map((t) => t.id)).size, g.tasks.length);
});
test("the 'gantt' figure type is registered next to the free-drawing 'timeline'", () => {
  const ft = getFigureType('gantt');
  assert.equal(ft.id, 'gantt'); assert.equal(ft.name, 'Gantt Chart'); assert.equal(ft.defaultTitle, 'Project Schedule (Gantt Chart)'); assert.equal(ft.icon, 'tTimeline');
  assert.ok(ft.description.length > 20);
  assert.equal(ft.dataDriven, true); // a drawing cannot be switched to it
  assert.equal(getFigureType('timeline').dataDriven, undefined);
  assert.equal(getFigureType('timeline').id, 'timeline');
  const d = buildTemplate('gantt', createProject({ name: 'T' }));
  assert.ok(d.width > 0 && d.elements.length > 50);
});
test('#/p/<id>/gantt/<figureId> opens the gantt editor under Figures', () => {
  assert.deepEqual(parseHash('#/p/prj_1/gantt/fig_2'), { view: 'gantt-editor', section: 'figures', projectId: 'prj_1', params: { id: 'fig_2', query: {} } });
  assert.equal(parseHash('#/p/prj_1/figures/fig_2').view, 'figure-editor');
  assert.equal(parseHash('#/p/prj_1/gantt').view, 'dashboard'); // no figure: not a page
});
test('figure.gantt survives project normalisation (save, load, import, duplicate)', () => {
  const gantt = finalizeForTest(sampleGantt());
  const fig = createFigure({ title: 'Plan', type: 'gantt', gantt, diagram: ganttDiagram(gantt) });
  const p = normalizeProject(JSON.parse(JSON.stringify(createProject({ name: 'T', figures: [fig] }))));
  assert.equal(p.figures[0].type, 'gantt');
  assert.deepEqual(p.figures[0].gantt, gantt);
  assert.equal(p.figures[0].diagram.elements.length, fig.diagram.elements.length);
  const copy = structuredClone(p.figures[0]);
  assert.deepEqual(copy.gantt, gantt);
});
function finalizeForTest(g) { const n = normalizeGantt(g); ops.syncPhases(n.tasks); return n; }

console.log('translations');
test('every interface string of the Gantt editor has an Arabic translation with the same placeholders', () => {
  const sources = ['../src/figures/gantt/gantt-editor.js', '../src/figures/types.js', '../src/figures/figures-view.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'));
  const keys = new Set();
  for (const src of sources) for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"));
  const gantt = (readFileSync(new URL('../src/figures/gantt/gantt-editor.js', import.meta.url), 'utf8').match(/\bt\('((?:[^'\\]|\\.)*)'/g) || []).length;
  assert.ok(gantt > 60, 'the scan found the editor strings');
  const missing = [...keys].filter((k) => !(k in AR));
  assert.deepEqual(missing, []);
  const holders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const bad = [...keys].filter((k) => holders(k) !== holders(AR[k]));
  assert.deepEqual(bad, []);
});

console.log(`\n${passed} passed${process.exitCode ? ' — with failures' : ''}`);
