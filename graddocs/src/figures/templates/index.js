// Starter templates for each figure type. Every template produces regular,
// fully editable elements — nothing is a flat image.
import { builder, A } from './builder.js';

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

export function sequenceTemplate(opts, { participants = [':User', ':Web App', ':Server', ':Database'] } = {}) {
  const b = builder(opts);
  const top = 30; const h = 440; const gap = 190;
  const lines = participants.map((p, i) => b.node('lifeline', 40 + i * gap, top, 130, h, p));
  const msg = (from, to, y, text, reply = false) => b.edge(lines[from], lines[to], {
    routing: 'straight', text,
    from: { x: 0.5, y: (y - top) / h }, to: { x: 0.5, y: (y - top) / h },
    style: reply ? { dash: 'dashed', endArrow: 'arrow' } : { endArrow: 'triangle' },
  });
  msg(0, 1, 130, '1: enter credentials');
  msg(1, 2, 180, '2: POST /login');
  msg(2, 3, 230, '3: find user');
  msg(3, 2, 280, '4: user record', true);
  msg(2, 1, 330, '5: session token', true);
  msg(1, 0, 380, '6: show dashboard', true);
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

export function genericTemplate(opts) {
  const b = builder(opts);
  return b.diagram();
}

export { A };
