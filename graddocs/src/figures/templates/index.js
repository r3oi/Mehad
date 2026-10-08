// Starter templates for each figure type. Every template produces regular,
// fully editable elements — nothing is a flat image.
import { builder, A } from './builder.js';
import { uid } from '../../core/utils.js';

const SOFT = { fill: '#eef2fb', stroke: '#1f2937' };
const NOARROW = { endArrow: 'none' };

export function flowchartTemplate(opts) {
  const b = builder(opts);
  const start = b.node('terminator', 310, 40, 140, 52, 'Start');
  const login = b.node('parallelogram', 280, 140, 200, 60, 'User Login');
  const validate = b.node('rect', 300, 250, 160, 60, 'Validate Credentials');
  const valid = b.node('diamond', 290, 360, 180, 100, 'Credentials Valid?');
  const dash = b.node('rect', 130, 520, 160, 60, 'Dashboard');
  const error = b.node('rect', 470, 520, 160, 60, 'Error Message');
  const end = b.node('terminator', 140, 640, 140, 52, 'End');
  b.edge(start, login);
  b.edge(login, validate);
  b.edge(validate, valid);
  b.edge(valid, dash, { from: 'w', to: 'n', text: 'Yes' });
  b.edge(valid, error, { from: 'e', to: 'n', text: 'No' });
  b.edge(dash, end);
  b.edge(error, login, { from: 'e', to: 'e', text: 'Retry' });
  return b.diagram();
}

export function useCaseTemplate(opts, { system = 'System', actors = ['User', 'Administrator'], cases = ['Register Account', 'Log In', 'Manage Profile', 'Upload Data', 'View Reports', 'Manage Users'] } = {}) {
  const b = builder(opts);
  b.node('frame', 220, 30, 420, 560, system, { fill: 'none' });
  const user = b.node('actor', 70, 170, 44, 84, actors[0]);
  const admin = b.node('actor', 760, 330, 44, 84, actors[1]);
  const uc = cases.map((text, i) => b.node('ellipse', 330, 80 + i * 84, 200, 62, text));
  for (const c of uc.slice(0, 5)) b.edge(user, c, { routing: 'straight', style: NOARROW });
  b.edge(admin, uc[4], { routing: 'straight', style: NOARROW });
  b.edge(admin, uc[5], { routing: 'straight', style: NOARROW });
  b.edge(admin, uc[1], { routing: 'straight', style: NOARROW });
  b.edge(uc[3], uc[1], { text: '«include»', style: { dash: 'dashed', endArrow: 'arrow' }, from: 'e', to: 'e' });
  return b.diagram();
}

export function activityTemplate(opts) {
  const b = builder(opts);
  const init = b.node('circle', 365, 30, 30, 30, '', { fill: '#111827', stroke: '#111827' });
  const receive = b.node('roundRect', 300, 100, 160, 56, 'Receive Request', { radius: 18 });
  const valid = b.node('diamond', 320, 196, 120, 76, 'Valid?');
  const process = b.node('roundRect', 300, 312, 160, 56, 'Process Request', { radius: 18 });
  const fork = b.node('rect', 230, 406, 300, 8, '', { fill: '#111827', stroke: '#111827' });
  const update = b.node('roundRect', 200, 450, 150, 56, 'Update Records', { radius: 18 });
  const notify = b.node('roundRect', 410, 450, 150, 56, 'Notify User', { radius: 18 });
  const join = b.node('rect', 230, 544, 300, 8, '', { fill: '#111827', stroke: '#111827' });
  const reject = b.node('roundRect', 560, 206, 150, 56, 'Reject Request', { radius: 18 });
  const final = b.node('final', 363, 600, 34, 34, '');
  b.edge(init, receive);
  b.edge(receive, valid);
  b.edge(valid, process, { text: '[yes]' });
  b.edge(valid, reject, { from: 'e', to: 'w', text: '[no]' });
  b.edge(process, fork);
  b.edge(fork, update, { from: { x: 0.15, y: 1 }, to: 'n' });
  b.edge(fork, notify, { from: { x: 0.85, y: 1 }, to: 'n' });
  b.edge(update, join, { from: 's', to: { x: 0.15, y: 0 } });
  b.edge(notify, join, { from: 's', to: { x: 0.85, y: 0 } });
  b.edge(join, final);
  b.edge(reject, final, { from: 's', to: 'e' });
  return b.diagram();
}

/**
 * Sequence diagram with the three message kinds of UML 2:
 *   synchronous  — solid line, filled triangle head      (the sender waits for the reply)
 *   asynchronous — solid line, open arrow head           (the sender carries on)
 *   return       — dashed line, open arrow head
 * messages: [{ from, to, text, kind: 'sync' | 'async' | 'return' }] (indexes into participants).
 */
export const MESSAGE_STYLES = {
  sync: { endArrow: 'triangle' },
  async: { endArrow: 'arrow' },
  return: { dash: 'dashed', endArrow: 'arrow' },
};

export function sequenceTemplate(opts, { participants = [':User', ':Web App', ':Server', ':Database'], messages } = {}) {
  const b = builder(opts);
  const top = 30; const first = 120; const step = 50;
  const list = messages || [
    { from: 0, to: 1, text: '1: enter credentials', kind: 'sync' },
    { from: 1, to: 2, text: '2: POST /login', kind: 'sync' },
    { from: 2, to: 3, text: '3: find user', kind: 'sync' },
    { from: 3, to: 2, text: '4: user record', kind: 'return' },
    { from: 2, to: 3, text: '5: log login event', kind: 'async' },
    { from: 2, to: 1, text: '6: session token', kind: 'return' },
    { from: 1, to: 0, text: '7: show dashboard', kind: 'return' },
  ];
  const h = first - top + list.length * step + 40; const gap = 190;
  const lines = participants.map((p, i) => b.node('lifeline', 40 + i * gap, top, 130, h, p));
  list.forEach((m, k) => {
    const y = (first + k * step - top) / h;
    b.edge(lines[m.from], lines[m.to], {
      routing: 'straight', text: m.text, from: { x: 0.5, y }, to: { x: 0.5, y }, style: { ...MESSAGE_STYLES[m.kind || 'sync'] },
    });
  });
  // Legend: what the three arrow styles mean (text layout collapses runs of spaces, hence the bars).
  b.node('text', 40, top + h + 24, 3 * gap + 130, 34, 'Legend:  ► synchronous  |  > asynchronous  |  - - > return', { align: 'left', fontSize: 13, stroke: '#9ca3af', strokeWidth: 1, fill: '#f9fafb' });
  return b.diagram();
}

export function classTemplate(opts) {
  const b = builder(opts);
  const user = b.node('class', 60, 60, 220, 150, 'User\n--\n- id: int\n- name: String\n- email: String\n--\n+ login(): boolean\n+ logout(): void');
  const admin = b.node('class', 60, 330, 220, 100, 'Administrator\n--\n- role: String\n--\n+ manageUsers(): void');
  const workspace = b.node('class', 420, 60, 220, 130, 'Workspace\n--\n- id: int\n- title: String\n--\n+ addDataset(d): void');
  const dataset = b.node('class', 420, 320, 220, 130, 'Dataset\n--\n- id: int\n- fileName: String\n--\n+ analyse(): Report');
  const report = b.node('class', 760, 320, 200, 110, 'Report\n--\n- id: int\n- createdAt: Date\n--\n+ export(): File');
  b.edge(admin, user, { style: { endArrow: 'triangleOpen' } });
  b.edge(user, workspace, { text: '1 owns 0..*', style: { endArrow: 'none' } });
  b.edge(workspace, dataset, { style: { startArrow: 'diamondFilled', endArrow: 'none' }, text: '1..*' });
  b.edge(dataset, report, { style: { endArrow: 'arrow', dash: 'dashed' }, text: 'generates' });
  return b.diagram();
}

export function stateTemplate(opts) {
  const b = builder(opts);
  const init = b.node('circle', 40, 175, 30, 30, '', { fill: '#111827', stroke: '#111827' });
  const idle = b.node('roundRect', 130, 160, 140, 60, 'Idle', { radius: 18 });
  const processing = b.node('roundRect', 380, 160, 160, 60, 'Processing', { radius: 18 });
  const done = b.node('roundRect', 650, 160, 150, 60, 'Completed', { radius: 18 });
  const failed = b.node('roundRect', 380, 330, 160, 60, 'Failed', { radius: 18 });
  const final = b.node('final', 880, 173, 34, 34, '');
  b.edge(init, idle);
  b.edge(idle, processing, { text: 'submit' });
  b.edge(processing, done, { text: 'success' });
  b.edge(processing, failed, { text: 'error', from: { x: 0.35, y: 1 }, to: { x: 0.35, y: 0 } });
  b.edge(failed, processing, { text: 'retry', from: { x: 0.65, y: 0 }, to: { x: 0.65, y: 1 } });
  b.edge(failed, idle, { text: 'cancel', from: 'w', to: 's' });
  b.edge(done, final);
  return b.diagram();
}

export function erdTemplate(opts) {
  const b = builder(opts);
  const H = { headerFill: '#e8edf7' };
  const user = b.node('entity', 60, 60, 200, 140, 'USER\n--\nPK  user_id\n    full_name\n    email\n    password_hash', H);
  const ws = b.node('entity', 420, 60, 210, 120, 'WORKSPACE\n--\nPK  workspace_id\nFK  user_id\n    title', H);
  const ds = b.node('entity', 420, 300, 210, 140, 'DATASET\n--\nPK  dataset_id\nFK  workspace_id\n    file_name\n    uploaded_at', H);
  const rep = b.node('entity', 780, 300, 200, 120, 'REPORT\n--\nPK  report_id\nFK  dataset_id\n    created_at', H);
  const rel = { startArrow: 'oneOne', endArrow: 'zeroMany' };
  b.edge(user, ws, { style: rel, text: 'owns' });
  b.edge(ws, ds, { style: rel, text: 'contains' });
  b.edge(ds, rep, { style: rel, text: 'produces' });
  return b.diagram();
}

export function architectureTemplate(opts, { name = 'System' } = {}) {
  const b = builder(opts);
  const layer = { fill: '#f5f7fb', radius: 10, align: 'left' };
  b.node('frame', 40, 30, 760, 170, 'Presentation Layer', layer);
  b.node('frame', 40, 240, 760, 190, 'Application Layer', layer);
  b.node('frame', 40, 470, 760, 170, 'Data Layer', layer);
  const web = b.node('browser', 200, 70, 180, 110, 'Web Application');
  const mobile = b.node('mobile', 500, 60, 90, 128, 'Mobile App');
  const api = b.node('roundRect', 300, 290, 200, 56, `${name} API Gateway`, { ...SOFT, radius: 10 });
  const auth = b.node('roundRect', 80, 360, 180, 52, 'Authentication Service', { ...SOFT, radius: 10 });
  const logic = b.node('roundRect', 300, 368, 200, 52, 'Business Logic', { ...SOFT, radius: 10 });
  const ai = b.node('roundRect', 560, 360, 190, 52, 'AI / Analytics Engine', { ...SOFT, radius: 10 });
  const db = b.node('cylinder', 250, 510, 140, 100, 'Relational Database');
  const files = b.node('cylinder', 470, 510, 140, 100, 'File Storage');
  b.edge(web, api, { text: 'HTTPS / REST', from: 's', to: { x: 0.3, y: 0 } });
  b.edge(mobile, api, { from: 's', to: { x: 0.7, y: 0 } });
  b.edge(api, auth, { from: 'w', to: 'n' });
  b.edge(api, logic);
  b.edge(api, ai, { from: 'e', to: 'n' });
  b.edge(logic, db, { from: { x: 0.3, y: 1 }, to: 'n' });
  b.edge(logic, files, { from: { x: 0.7, y: 1 }, to: 'n' });
  b.edge(ai, files, { from: 's', to: 'e' });
  return b.diagram();
}

export function componentTemplate(opts) {
  const b = builder(opts);
  const ui = b.node('component', 60, 60, 190, 70, 'Web UI');
  const api = b.node('component', 340, 60, 190, 70, 'REST API');
  const auth = b.node('component', 620, 20, 190, 70, 'Auth Module');
  const analysis = b.node('component', 620, 140, 190, 70, 'Analysis Module');
  const repo = b.node('component', 340, 240, 190, 70, 'Data Access Layer');
  const db = b.node('cylinder', 375, 380, 120, 90, 'Database');
  b.edge(ui, api, { text: 'uses', style: { dash: 'dashed' } });
  b.edge(api, auth, { from: 'e', to: 'w', style: { dash: 'dashed' } });
  b.edge(api, analysis, { from: 'e', to: 'w', style: { dash: 'dashed' } });
  b.edge(api, repo, { style: { dash: 'dashed' } });
  b.edge(analysis, repo, { from: 's', to: 'e', style: { dash: 'dashed' } });
  b.edge(repo, db);
  return b.diagram();
}

export function deploymentTemplate(opts) {
  const b = builder(opts);
  const client = b.node('node3d', 40, 80, 220, 150, '«device»\nClient Device');
  b.node('component', 65, 150, 170, 56, 'Web Browser');
  const server = b.node('node3d', 360, 60, 260, 190, '«server»\nApplication Server');
  b.node('component', 385, 130, 200, 50, 'API Service');
  b.node('component', 385, 188, 200, 50, 'Background Workers');
  const dbs = b.node('node3d', 720, 80, 220, 150, '«server»\nDatabase Server');
  b.node('cylinder', 775, 140, 110, 76, 'PostgreSQL');
  b.edge(client, server, { text: 'HTTPS', style: NOARROW });
  b.edge(server, dbs, { text: 'TCP/IP', style: NOARROW });
  return b.diagram();
}

/**
 * Fishbone (Ishikawa) diagram from data. Element ids are derived from each
 * category key so versions of the same diagram diff cleanly.
 * categories: [{ key, name, causes: [] }]
 */
export function fishboneDiagram(opts, { head = 'Problem', categories } = {}) {
  const cats = categories || [
    { key: 'c1', name: 'Main Cause 1', causes: ['Sub-cause', 'Sub-cause'] },
    { key: 'c2', name: 'Main Cause 2', causes: ['Sub-cause', 'Sub-cause'] },
    { key: 'c3', name: 'Main Cause 3', causes: ['Sub-cause', 'Sub-cause'] },
    { key: 'c4', name: 'Main Cause 4', causes: ['Sub-cause', 'Sub-cause'] },
  ];
  const b = builder(opts);
  const cy = 320; const cols = Math.max(1, Math.ceil(cats.length / 2));
  const colW = 280; const spineStart = 40; const firstJ = spineStart + 300;
  const lastJ = firstJ + (cols - 1) * colW;
  const headNode = b.node('rect', lastJ + 90, cy - 45, 200, 90, head, { fill: '#eef2fb', strokeWidth: 2, fontWeight: 'bold' }, { id: 'fb-head' });
  b.edge({ x: spineStart, y: cy }, headNode, { id: 'fb-spine', routing: 'straight', to: 'w', style: { strokeWidth: 3, endArrow: 'triangle' } });
  cats.forEach((cat, i) => {
    const col = Math.floor(i / 2); const top = i % 2 === 0;
    const jx = firstJ + col * colW;
    const bw = 190; const bh = 46;
    const bx = jx - 120 - bw / 2;
    const by = top ? 60 : cy + 214;
    const box = b.node('rect', bx, by, bw, bh, cat.name, { fill: '#ffffff', strokeWidth: 1.5, fontWeight: 'bold' }, { id: `fb-cat-${cat.key}` });
    const B = { x: bx + bw / 2, y: top ? by + bh : by };
    const J = { x: jx, y: cy };
    b.edge(box, J, { id: `fb-bone-${cat.key}`, routing: 'straight', from: top ? 's' : 'n', style: { strokeWidth: 2, endArrow: 'arrow' } });
    const m = cat.causes.length;
    cat.causes.forEach((cause, k) => {
      const t = (k + 1) / (m + 1);
      const P = { x: B.x + (J.x - B.x) * t, y: B.y + (J.y - B.y) * t };
      const label = b.node('text', P.x - 26 - 160, P.y - 13, 160, 26, cause, { align: 'right', fontSize: 13 }, { id: `fb-cause-${cat.key}-${k}` });
      b.edge(label, P, { id: `fb-tick-${cat.key}-${k}`, routing: 'straight', from: 'e', style: { strokeWidth: 1, endArrow: 'none' } });
    });
  });
  return b.diagram();
}

export function fishboneTemplate(opts) { return fishboneDiagram(opts); }

export function hierarchyTemplate(opts) {
  const b = builder(opts);
  const root = b.node('rect', 420, 30, 200, 56, 'Graduation Project', { fill: '#eef2fb', fontWeight: 'bold' });
  const phases = [
    ['Planning', ['Proposal', 'Schedule']],
    ['Analysis', ['Requirements', 'Use Cases']],
    ['Design', ['Architecture', 'Database']],
    ['Implementation', ['Frontend', 'Backend']],
    ['Testing', ['Unit Tests', 'User Testing']],
  ];
  phases.forEach(([name, kids], i) => {
    const x = 30 + i * 200;
    const node = b.node('rect', x, 150, 170, 50, name);
    b.edge(root, node, { from: 's', to: 'n', style: NOARROW });
    kids.forEach((kid, k) => {
      const child = b.node('rect', x + 22, 250 + k * 76, 148, 46, kid, { fontSize: 13 });
      b.edge(node, child, { from: { x: 0.08, y: 1 }, to: 'w', style: NOARROW });
    });
  });
  return b.diagram();
}

/** Gantt-style timeline: month columns, task bars and milestones — all editable elements. */
export function timelineTemplate(opts, { months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'], tasks } = {}) {
  const list = tasks || [
    ['Project Proposal', 0, 1], ['Requirements Analysis', 0.5, 1.5], ['System Design', 1.5, 2],
    ['Implementation', 3, 3], ['Testing', 5.5, 1.5], ['Documentation', 1, 6], ['Final Presentation', 7, 0.8],
  ];
  const b = builder(opts);
  const left = 220; const colW = 90; const top = 40; const rowH = 46;
  const width = months.length * colW;
  b.node('rect', 20, top, left - 20 + width, 36, '', { fill: '#eef2fb', strokeWidth: 1 });
  b.node('text', 28, top, left - 36, 36, 'Task', { align: 'left', fontWeight: 'bold' });
  months.forEach((m, i) => {
    b.node('text', left + i * colW, top, colW, 36, m, { fontWeight: 'bold' });
    b.edge({ x: left + i * colW, y: top }, { x: left + i * colW, y: top + 36 + list.length * rowH }, { routing: 'straight', style: { stroke: '#cbd5e1', strokeWidth: 1, endArrow: 'none' } });
  });
  list.forEach(([name, start, dur], i) => {
    const y = top + 36 + i * rowH;
    b.node('text', 28, y, left - 36, rowH, name, { align: 'left', fontSize: 13 });
    b.node('roundRect', left + start * colW + 4, y + 11, Math.max(16, dur * colW - 8), rowH - 22, '', { fill: '#6366f1', stroke: '#4338ca', radius: 6 });
  });
  b.edge({ x: 20, y: top + 36 + list.length * rowH }, { x: left + width, y: top + 36 + list.length * rowH }, { routing: 'straight', style: { strokeWidth: 1, endArrow: 'none' } });
  return b.diagram();
}

// ---------------------------------------------------------------------------
// Context diagram: one system (circle) in the middle, external entities around it and a
// labelled data flow for every arrow. Every connector is attached to its shapes, so it follows them.

/** Where a ray from `from` in direction `dir` first meets the circle (centre c, radius r). */
function rayHitsCircle(from, dir, c, r) {
  const fx = from.x - c.x; const fy = from.y - c.y;
  const b = fx * dir.x + fy * dir.y;
  const disc = b * b - (fx * fx + fy * fy - r * r);
  if (disc < 0) return { x: c.x - dir.x * r, y: c.y - dir.y * r };
  const k = -b - Math.sqrt(disc);
  return { x: from.x + dir.x * k, y: from.y + dir.y * k };
}

const fraction = (n, p) => ({ x: Math.round(((p.x - n.x) / n.w) * 1000) / 1000, y: Math.round(((p.y - n.y) / n.h) * 1000) / 1000 });

/**
 * contextDiagram(opts, { system, systemId?, entities: [{ name, id?, w?, h?, flows: [{ label, dir: 'out' | 'in', style? }] }] })
 * 'out' = the entity sends data to the system, 'in' = the system sends data to the entity.
 * Entities alternate between the left and the right column; each gets one parallel pair of arrows per
 * direction, spread along the side that faces the system.
 */
export function contextDiagram(opts, { system = 'Meyar System', systemId, entities, systemSize = 240, flowStyle = {} } = {}) {
  const list = entities || [
    { name: 'Student', flows: [{ label: 'Project data', dir: 'out' }, { label: 'Reports', dir: 'in' }] },
    { name: 'Supervisor', flows: [{ label: 'Comments', dir: 'out' }, { label: 'Progress reports', dir: 'in' }] },
    { name: 'Administrator', flows: [{ label: 'User accounts', dir: 'out' }, { label: 'Usage statistics', dir: 'in' }] },
    { name: 'External Service', flows: [{ label: 'Delivery status', dir: 'out' }, { label: 'Notification requests', dir: 'in' }] },
  ];
  const b = builder(opts);
  const left = list.filter((_, i) => i % 2 === 0); const right = list.filter((_, i) => i % 2 === 1);
  const rows = Math.max(left.length, right.length, 1);
  // An entity with several flows is taller, so its arrows stay ~46 px apart and their labels do not touch.
  const heightOf = (ent) => Math.max(ent.h || 72, 30 + ((ent.flows || []).length - 1) * 46);
  const tallest = Math.max(72, ...list.map(heightOf));
  const edgeX = Math.max(230, ...list.map((ent) => (ent.w || 190) + 40)); // distance of the entity columns' inner edges from the sides
  const pitch = rows <= 1 ? 0 : Math.max(tallest + 60, rows === 2 ? 280 : rows === 3 ? 230 : 190);
  const margin = 30;
  const R = systemSize / 2;
  const width = Math.max(1100, 2 * (edgeX + R + 200));
  const cx = width / 2; const cy = margin + Math.max(R, ((rows - 1) * pitch) / 2 + tallest / 2);
  const sys = b.node('circle', cx - R, cy - R, systemSize, systemSize, system, { fill: '#eef2fb', strokeWidth: 2, fontWeight: 'bold' }, { id: systemId });
  const C = { x: cx, y: cy };

  // `edgeX` is the edge of the column that faces the system: the right edge on the left, the left edge on the right.
  const place = (items, edgeX, facing) => {
    items.forEach((ent, j) => {
      const w = ent.w || 190;
      const yc = cy + (j - (items.length - 1) / 2) * pitch;
      const h = heightOf(ent);
      const node = b.node('rect', facing === 'e' ? edgeX - w : edgeX, Math.round(yc - h / 2), w, h, ent.name, { fill: '#ffffff' }, { id: ent.id });
      const flows = ent.flows || [];
      // Arrows run in the direction of the circle's centre, side by side along the facing edge.
      const dx = C.x - (node.x + node.w / 2); const dy = C.y - yc; const len = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / len, y: dy / len };
      const gapPx = flows.length > 1 ? Math.min(46, (node.h - 26) / (flows.length - 1)) : 0;
      flows.forEach((flow, i) => {
        const off = (i - (flows.length - 1) / 2) * gapPx;
        const A = { x: facing === 'e' ? node.x + node.w : node.x, y: yc + off };
        const B = rayHitsCircle(A, dir, C, R);
        const aEnd = { id: node.id, anchor: fraction(node, A) }; const bEnd = { id: sys.id, anchor: fraction(sys, B) };
        const out = flow.dir !== 'in';
        b.elements.push({
          id: uid('e'), type: 'edge', source: out ? aEnd : bEnd, target: out ? bEnd : aEnd, routing: 'straight', text: flow.label || '',
          style: { endArrow: 'triangle', ...flowStyle, ...(flow.style || {}) },
        });
      });
    });
  };
  place(left, edgeX, 'e');
  place(right, width - edgeX, 'w');
  return b.diagram({ width, height: Math.round(cy * 2) });
}

/** "Meyar System" for a project called "Meyar"; a long or missing name keeps the sample. */
export function systemNameOf(project) {
  const name = String(project?.name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 28) return undefined;
  return /system$/i.test(name) ? name : `${name} System`;
}

export function contextTemplate(opts, { system, project } = {}) {
  const name = system || systemNameOf(project);
  return contextDiagram(opts, name ? { system: name } : {});
}

// ---------------------------------------------------------------------------
// Screenshot / image figure: one picture filling the canvas (annotate it with shapes, arrows and text).

/**
 * screenshotDiagram(opts, image?) — image = { src, width, height } (a data URL from image-import.js).
 * The canvas takes the picture's proportions, at most 1200 wide. Without an image a placeholder box is drawn.
 */
export function screenshotDiagram(opts, image = null) {
  const b = builder(opts);
  const iw = image?.width || 800; const ih = image?.height || 500;
  const w = Math.min(1200, iw); const h = Math.max(1, Math.round((w * ih) / iw));
  const el = b.node('image', 0, 0, w, h, '', {});
  if (image?.src) el.src = image.src;
  return b.diagram({ width: w, height: h });
}

export function screenshotTemplate(opts) { return screenshotDiagram(opts, null); }

export function genericTemplate(opts) {
  const b = builder(opts);
  return b.diagram();
}

export { A };
