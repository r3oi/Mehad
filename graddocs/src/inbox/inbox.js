// "Updates from Claude": the student works with Claude (an AI assistant) in a chat. Claude cannot reach this
// browser, but it can commit files to the project's public GitHub repository. GradDocs therefore fetches a small
// inbox file from the repository now and then and offers its items to the matching project. Nothing is applied
// without the student's click, and everything applied can be undone.
//
// inbox.json (version 1):
//   { "version": 1, "items": [ {
//       "id": "unique-string", "project": "Meyar" (name, trimmed, case-insensitive; "*" = any project),
//       "kind": "projectLogo" | "projectIcon" | "figure",
//       "title": "...", "titleAr": "...", "description": "...", "descriptionAr": "...", "createdAt": "ISO date-time",
//       "asset": "assets/meyar-logo.png"                      // projectLogo: relative to the inbox.json URL
//       "figure": { "id", "title", "type", "description", "diagram" | "gantt" },   // figure ('gantt' type: figure.gantt)
//       "place": { "sectionTitles": [...], "chapterTitles": [...] }                // figure, optional
//   } ] }
//
// Per project, project.inbox = { applied: { [itemId]: ts }, dismissed: { [itemId]: ts } } says what was handled; an
// item whose createdAt is newer than that timestamp is offered again (Claude sent a new version).
//
// Everything in the file is untrusted data: shapes are validated, images must be https: / data: images, strings
// are only ever shown through esc(), and nothing in it is executed.
//
// Layout of this file: validation · matching · placement · applying (pure, runs inside store.update) ·
// fetching · the background checker.
import { Emitter } from '../core/events.js';
import { clone } from '../core/utils.js';
import { createFigure, createDiagram, walkSections } from '../core/model.js';
import { addVersion } from '../figures/versions.js';
import { ganttDiagram, normalizeGantt } from '../figures/gantt/gantt-model.js';
import { figureFonts } from '../figures/types.js';
import { renderThumbnail } from '../figures/render.js';
import { prefs } from '../app/prefs.js';
import { logoDataURL } from './logo-image.js';

/** Where the inbox files live (all are read; items with the same id keep the newest). Asset paths are relative to the file's URL. */
export const INBOX_URLS = ['https://raw.githubusercontent.com/r3oi/Mehad/claude/modest-johnson-7im24n/graddocs/inbox/inbox.json'];
export const INBOX_VERSION = 1;
export const CHECK_EVERY = 10 * 60 * 1000; // ms, while the tab is visible
const MIN_GAP = 60 * 1000; // ms between two automatic checks (opening several projects in a row asks once)
const FETCH_TIMEOUT = 12000;
const MAX_FILE_CHARS = 6_000_000;
const MAX_ITEM_CHARS = 3_000_000;
const MAX_ITEMS = 100;
const MAX_ELEMENTS = 5000;
const MAX_ASSET_BYTES = 6_000_000;
const PROJECT_LOGO_MAX_PX = 1200;
const PROJECT_ICON_MAX_PX = 256;
/** Image items and the project field each one fills. */
const IMAGE_KINDS = { projectLogo: 'projectLogo', projectIcon: 'projectIcon' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** Comparison form of a title or project name: trimmed, whitespace collapsed, case-insensitive. */
export const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i;
/** JSON.parse reviver that drops "__proto__" keys. */
const reviver = (key, value) => (key === '__proto__' ? undefined : value);

// ---------------------------------------------------------------------------
// Validation

/** A plain-data copy (JSON round trip: no functions, no shared references), or undefined when it is not serialisable / too big. */
function plain(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > MAX_ITEM_CHARS ? undefined : JSON.parse(text, reviver);
  } catch { return undefined; }
}

/** An asset path / URL resolved against the inbox file's URL; '' unless it is an https: URL or a data: image. */
export function resolveAssetUrl(asset, inboxUrl = '') {
  if (typeof asset !== 'string' || !asset.trim()) return '';
  try {
    const url = inboxUrl ? new URL(asset.trim(), inboxUrl) : new URL(asset.trim());
    if (url.protocol === 'https:') return url.href;
    if (url.protocol === 'data:' && IMAGE_DATA_URL.test(url.href)) return url.href;
  } catch { /* not a URL */ }
  return '';
}

/** A diagram from the file, or null when it could crash the renderer. Image sources other than data: images are removed. */
function cleanDiagram(raw) {
  const d = plain(raw);
  if (!isObj(d) || !Array.isArray(d.elements) || d.elements.length > MAX_ELEMENTS) return null;
  for (const el of d.elements) {
    if (!isObj(el) || typeof el.id !== 'string' || !el.id) return null;
    if (el.type === 'node') {
      if (typeof el.shape !== 'string' || !['x', 'y', 'w', 'h'].every((k) => finite(el[k]))) return null;
    } else if (el.type === 'edge') {
      if (!isObj(el.source) || !isObj(el.target)) return null;
    } else return null;
    if (el.src !== undefined && !(typeof el.src === 'string' && IMAGE_DATA_URL.test(el.src))) el.src = '';
  }
  if (d.defaults !== undefined && !isObj(d.defaults)) delete d.defaults;
  return d;
}

function cleanFigure(raw) {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 120);
  if (!id) return null;
  const type = typeof raw.type === 'string' && /^[a-z][a-z0-9_-]{0,40}$/i.test(raw.type) ? raw.type : 'generic';
  const spec = { id, title: str(raw.title, 200) || 'Untitled Figure', type, description: str(raw.description, 2000) };
  if (type === 'gantt') {
    const gantt = plain(raw.gantt);
    if (!isObj(gantt) || !Array.isArray(gantt.tasks)) return null;
    spec.gantt = gantt;
  } else {
    const diagram = cleanDiagram(raw.diagram);
    if (!diagram) return null;
    spec.diagram = diagram;
  }
  return spec;
}

function cleanPlace(raw) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, 12) : []);
  return isObj(raw) ? { sectionTitles: list(raw.sectionTitles), chapterTitles: list(raw.chapterTitles) } : { sectionTitles: [], chapterTitles: [] };
}

/**
 * One item of the file → a clean item, or null when it is malformed (it is then ignored). `inboxUrl` is the URL the file was
 * read from (asset paths are relative to it). Adds createdMs (0 when createdAt is missing) and, for logos, assetUrl.
 */
export function normalizeItem(raw, inboxUrl = '') {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 200);
  const project = str(raw.project, 200);
  if (!id || !project || (!IMAGE_KINDS[raw.kind] && raw.kind !== 'figure')) return null;
  const created = Date.parse(typeof raw.createdAt === 'string' ? raw.createdAt : '');
  const item = {
    id, project, kind: raw.kind,
    title: str(raw.title, 200), titleAr: str(raw.titleAr, 200),
    description: str(raw.description, 1500), descriptionAr: str(raw.descriptionAr, 1500),
    createdAt: Number.isFinite(created) ? new Date(created).toISOString() : '',
    createdMs: Number.isFinite(created) ? created : 0,
  };
  if (IMAGE_KINDS[item.kind]) {
    item.asset = str(raw.asset, 2000);
    item.assetUrl = resolveAssetUrl(raw.asset, inboxUrl);
    if (!item.assetUrl) return null;
    item.title = item.title || (item.kind === 'projectIcon' ? 'Project icon' : 'Project logo');
  } else {
    item.figure = cleanFigure(raw.figure);
    if (!item.figure) return null;
    item.place = cleanPlace(raw.place);
    item.title = item.title || item.figure.title;
  }
  return item;
}

/** The parsed file → { version, items } with only the valid items (a duplicate id keeps the newest). Never throws. */
export function normalizeInbox(raw, inboxUrl = '') {
  const empty = { version: INBOX_VERSION, items: [] };
  if (!isObj(raw) || !Array.isArray(raw.items)) return empty;
  if (raw.version !== undefined && raw.version !== INBOX_VERSION) return empty; // a newer format this version cannot read
  const byId = new Map();
  for (const entry of raw.items.slice(0, MAX_ITEMS)) {
    let item = null;
    try { item = normalizeItem(entry, inboxUrl); } catch { /* malformed */ }
    if (!item) continue;
    const previous = byId.get(item.id);
    if (!previous || item.createdMs >= previous.createdMs) byId.set(item.id, item);
  }
  return { version: INBOX_VERSION, items: [...byId.values()] };
}

// ---------------------------------------------------------------------------
// Matching

export const matchesProject = (project, item) => item.project === '*' || normName(item.project) === normName(project?.name);

/** project.inbox, created on demand (call it inside store.update). */
export function ensureInbox(project) {
  if (!isObj(project.inbox)) project.inbox = {};
  if (!isObj(project.inbox.applied)) project.inbox.applied = {};
  if (!isObj(project.inbox.dismissed)) project.inbox.dismissed = {};
  return project.inbox;
}

/**
 * The items that are waiting for this project: addressed to it (or to "*"), and not applied / dismissed since they were
 * written. An item whose createdAt is newer than its applied / dismissed time is offered again. Oldest first; each
 * result is the item plus `status`: 'new', or 'update' (applied before and re-sent, or it replaces an existing figure).
 * `inbox` is { items } as returned by normalizeInbox (or the items array itself).
 */
export function matchItems(project, inbox) {
  const items = Array.isArray(inbox) ? inbox : inbox?.items || [];
  const applied = isObj(project?.inbox?.applied) ? project.inbox.applied : {};
  const dismissed = isObj(project?.inbox?.dismissed) ? project.inbox.dismissed : {};
  const out = [];
  for (const item of items) {
    if (!item || !matchesProject(project, item)) continue;
    const handled = Math.max(Number(applied[item.id]) || 0, Number(dismissed[item.id]) || 0);
    if (handled && item.createdMs <= handled) continue;
    const replaces = item.kind === 'figure' && (project.figures || []).some((f) => f.id === item.figure.id);
    out.push({ ...item, status: Number(applied[item.id]) > 0 || replaces ? 'update' : 'new' });
  }
  return out.sort((a, b) => a.createdMs - b.createdMs);
}

// ---------------------------------------------------------------------------
// Placement

/**
 * Where a new figure goes: the first of `place.sectionTitles` (in the order given) that names a section, at any depth,
 * then the first of `place.chapterTitles` that names a chapter. Titles are compared trimmed and case-insensitively.
 * → { chapterId, sectionId } | null (null = unassigned).
 */
export function findPlacement(project, place) {
  for (const title of place?.sectionTitles || []) {
    const wanted = normName(title);
    if (!wanted) continue;
    let found = null;
    walkSections(project, (sec, { chapter }) => {
      if (found) return false;
      if (normName(sec.title) === wanted) found = { chapterId: chapter.id, sectionId: sec.id };
      return undefined;
    });
    if (found) return found;
  }
  for (const title of place?.chapterTitles || []) {
    const wanted = normName(title);
    const chapter = wanted && project.chapters.find((c) => normName(c.title) === wanted);
    if (chapter) return { chapterId: chapter.id, sectionId: null };
  }
  return null;
}

/**
 * Where applying an item puts things: { kind: 'titlePage' } for a logo; for a figure { kind: 'new' | 'update', figure?,
 * chapterId, sectionId } (an update keeps the location of the figure it replaces).
 */
export function describeDestination(project, item) {
  if (item.kind === 'projectLogo') return { kind: 'titlePage' };
  if (item.kind === 'projectIcon') return { kind: 'appIcon' };
  const existing = project.figures.find((f) => f.id === item.figure.id);
  if (existing) return { kind: 'update', figure: existing, chapterId: existing.chapterId || null, sectionId: existing.sectionId || null };
  const place = findPlacement(project, item.place);
  return { kind: 'new', chapterId: place?.chapterId || null, sectionId: place?.sectionId || null };
}

// ---------------------------------------------------------------------------
// Applying

/** The diagram (and, for a Gantt figure, the normalised schedule) a figure item stands for. Throws when it cannot be drawn. */
export function figureParts(project, item) {
  const spec = item.figure;
  const fonts = figureFonts(project);
  let gantt = null;
  let diagram;
  if (spec.type === 'gantt') {
    gantt = normalizeGantt(spec.gantt);
    diagram = ganttDiagram(gantt, fonts);
  } else {
    diagram = { ...createDiagram(), defaults: { ...fonts }, ...clone(spec.diagram) };
  }
  try { renderThumbnail(diagram); } catch { throw new Error('This figure could not be drawn.'); }
  return { gantt, diagram };
}

function applyFigure(project, item, now) {
  const spec = item.figure;
  const { gantt, diagram } = figureParts(project, item); // may throw: nothing has been changed yet
  const existing = project.figures.find((f) => f.id === spec.id);
  if (existing) {
    // An update: new content, same place in the report. The old drawing stays in the version history.
    if (!gantt) addVersion(existing, { label: 'Before update from Claude', at: now });
    existing.title = spec.title;
    existing.description = spec.description;
    existing.type = spec.type;
    existing.diagram = diagram;
    if (gantt) existing.gantt = gantt; else delete existing.gantt;
    existing.updatedAt = now;
    addVersion(existing, { label: 'Updated by Claude', at: now });
    return { kind: 'figure', figureId: existing.id, created: false };
  }
  const place = findPlacement(project, item.place);
  const figure = createFigure({
    id: spec.id, title: spec.title, type: spec.type, description: spec.description, diagram,
    chapterId: place?.chapterId || null, sectionId: place?.sectionId || null,
    ...(gantt ? { gantt } : {}), createdAt: now, updatedAt: now,
  });
  addVersion(figure, { label: 'Added by Claude', at: now });
  project.figures.push(figure);
  return { kind: 'figure', figureId: figure.id, created: true };
}

const assetOf = (assets, item) => (assets instanceof Map ? assets.get(item.id) : assets?.[item.id]);

/**
 * Apply one item to the project. Call it inside store.update. `assets` holds the downloaded images as data: URLs by item id
 * (Map or plain object). Marks the item applied (at `now`, or at its createdAt when that is later, so a clock that runs
 * behind cannot make it look new again). Throws, before changing anything, when the item cannot be applied.
 * → { kind: 'projectLogo' } | { kind: 'figure', figureId, created }
 */
export function applyItem(project, item, assets = {}, { now = Date.now() } = {}) {
  let result;
  if (IMAGE_KINDS[item.kind]) {
    const dataUrl = assetOf(assets, item);
    if (typeof dataUrl !== 'string' || !IMAGE_DATA_URL.test(dataUrl)) throw new Error('The logo image is missing.');
    project[IMAGE_KINDS[item.kind]] = dataUrl;
    result = { kind: item.kind };
  } else if (item.kind === 'figure') {
    result = applyFigure(project, item, now);
  } else throw new Error('Unknown kind of update.');
  const inbox = ensureInbox(project);
  inbox.applied[item.id] = Math.max(now, item.createdMs || 0);
  delete inbox.dismissed[item.id];
  return result;
}

/** Remember that the student does not want this item (it comes back only if Claude sends a newer version). */
export function dismissItem(project, item, { now = Date.now() } = {}) {
  const inbox = ensureInbox(project);
  inbox.dismissed[item.id] = Math.max(now, item.createdMs || 0);
}

/** What Undo needs to put back: the logo, the figures an apply touches and the applied / dismissed marks of the items. */
export function takeSnapshot(project, items) {
  const ids = [...new Set(items.filter((i) => i.kind === 'figure').map((i) => i.figure.id))];
  return {
    projectId: project.id,
    logo: items.some((i) => i.kind === 'projectLogo') ? (project.projectLogo || '') : undefined,
    icon: items.some((i) => i.kind === 'projectIcon') ? (project.projectIcon || '') : undefined,
    marks: items.map((i) => ({ id: i.id, applied: project.inbox?.applied?.[i.id], dismissed: project.inbox?.dismissed?.[i.id] })),
    figures: ids.map((id) => {
      const index = project.figures.findIndex((f) => f.id === id);
      return { id, index, before: index >= 0 ? clone(project.figures[index]) : null };
    }),
  };
}

/** Inverse of applying: call inside store.update. */
export function restoreSnapshot(project, snapshot) {
  if (snapshot.logo !== undefined) project.projectLogo = snapshot.logo;
  if (snapshot.icon !== undefined) project.projectIcon = snapshot.icon;
  for (const f of snapshot.figures) {
    const i = project.figures.findIndex((x) => x.id === f.id);
    if (f.before) {
      if (i >= 0) project.figures[i] = clone(f.before);
      else project.figures.splice(Math.min(Math.max(0, f.index), project.figures.length), 0, clone(f.before));
    } else if (i >= 0) project.figures.splice(i, 1);
  }
  const inbox = ensureInbox(project);
  for (const m of snapshot.marks) {
    if (m.applied === undefined) delete inbox.applied[m.id]; else inbox.applied[m.id] = m.applied;
    if (m.dismissed === undefined) delete inbox.dismissed[m.id]; else inbox.dismissed[m.id] = m.dismissed;
  }
}

/**
 * Apply several items in ONE store.update (one autosave, one activity entry). Images are downloaded first; items whose image
 * cannot be fetched are skipped. → { applied: [items], failed: [{ item, error }], snapshot } — snapshot feeds undoApply.
 */
export async function applyItems(store, items, { getAsset = loadAsset, now = Date.now() } = {}) {
  const project = store.project;
  if (!project || !items.length) return { applied: [], failed: [], snapshot: null };
  const failed = [];
  const assets = new Map();
  for (const item of items) {
    if (!IMAGE_KINDS[item.kind]) continue;
    try { assets.set(item.id, await getAsset(item)); } catch (error) { failed.push({ item, error }); }
  }
  if (store.project?.id !== project.id) throw new Error('The project changed while the update was being prepared.');
  const todo = items.filter((i) => !failed.some((f) => f.item === i));
  const applied = [];
  const snapshot = takeSnapshot(store.project, todo);
  const options = { source: 'inbox' };
  if (todo.length) {
    store.update((p) => {
      let created = false;
      for (const item of todo) {
        try { created = applyItem(p, item, assets, { now }).created === true || created; applied.push(item); } catch (error) { failed.push({ item, error }); }
      }
      // The activity is read after this function has run, so it can describe what was applied.
      if (applied.length) {
        options.activity = {
          text: applied.length === 1 ? `Applied an update from Claude: ${applied[0].title}` : `Applied ${applied.length} updates from Claude`,
          kind: created ? 'create' : 'edit',
        };
      }
    }, options);
  }
  return { applied, failed, snapshot };
}

/** Undo what applyItems did (while the same project is open). Returns false when it no longer can. */
export function undoApply(store, snapshot) {
  if (!snapshot || store.project?.id !== snapshot.projectId) return false;
  store.update((p) => restoreSnapshot(p, snapshot), { activity: 'Undid an update from Claude', source: 'inbox' });
  return true;
}

/** Dismiss one item (stored in the project, so it stays dismissed on reload). */
export function dismissItemInStore(store, item) {
  store.update((p) => dismissItem(p, item), { source: 'inbox' });
}

// ---------------------------------------------------------------------------
// Fetching

let warned = false;
function infoOnce(...args) {
  if (warned) return;
  warned = true;
  console.info('[graddocs] Updates from Claude:', ...args);
}

/**
 * Read the inbox file(s). → { reached: boolean, items: [...] }; `reached` is false when no file could be read (a missing file,
 * 404, counts as reached and empty). Fails quietly: one console.info per page load, never an error.
 */
export async function fetchInbox(urls = INBOX_URLS, { fetchImpl = globalThis.fetch?.bind(globalThis), timeout = FETCH_TIMEOUT } = {}) {
  const byId = new Map();
  let reached = false;
  for (const url of urls) {
    let timer;
    try {
      if (!fetchImpl) throw new Error('fetch is not available');
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
      if (res.status === 404) { reached = true; continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_FILE_CHARS) throw new Error('the file is too large');
      const inbox = normalizeInbox(JSON.parse(text, reviver), url);
      reached = true;
      for (const item of inbox.items) {
        const previous = byId.get(item.id);
        if (!previous || item.createdMs >= previous.createdMs) byId.set(item.id, item);
      }
    } catch (err) {
      infoOnce('could not read', url, '-', err?.message || err);
    } finally { clearTimeout(timer); }
  }
  return { reached, items: [...byId.values()] };
}

const assetCache = new Map();

/** The image of a projectLogo / projectIcon item as a data: URL (PNG; SVG kept), scaled to at most 1200 / 256 px. Cached per item version. */
export function loadAsset(item, { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const key = `${item.assetUrl}|${item.createdMs}`;
  if (!assetCache.has(key)) {
    const job = (async () => {
      const res = await fetchImpl(item.assetUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > MAX_ASSET_BYTES) throw new Error('The image is too large.');
      return logoDataURL(blob, { max: item.kind === 'projectIcon' ? PROJECT_ICON_MAX_PX : PROJECT_LOGO_MAX_PX });
    })();
    assetCache.set(key, job);
    job.catch(() => assetCache.delete(key));
  }
  return assetCache.get(key);
}

// ---------------------------------------------------------------------------
// The checker: state shared by the shell, the dashboard, the dialog and Settings

export const inboxEvents = new Emitter(); // 'update' whenever the state or the setting changes
export const inboxState = { items: [], checkedAt: 0, attemptedAt: 0, checking: false, reached: null };
let running = null;

export const isInboxEnabled = () => prefs.get('inboxEnabled', true) !== false;

/** The pending items of the open project (none while the feature is switched off). */
export const pendingItems = (project) => (project && isInboxEnabled() ? matchItems(project, inboxState) : []);

/**
 * Look at the inbox now. → { reached, pending } (pending = number of items waiting for `project`, when given).
 * Concurrent calls share one request.
 */
export function checkInbox({ project, urls = INBOX_URLS, fetchImpl } = {}) {
  if (!running) {
    inboxState.checking = true;
    inboxEvents.emit('update');
    running = fetchInbox(urls, { fetchImpl }).then((result) => {
      inboxState.attemptedAt = Date.now();
      inboxState.reached = result.reached;
      if (result.reached) { inboxState.items = result.items; inboxState.checkedAt = inboxState.attemptedAt; }
      return result;
    }).catch((err) => {
      infoOnce(err?.message || err);
      inboxState.attemptedAt = Date.now();
      inboxState.reached = false;
      return { reached: false, items: inboxState.items };
    }).finally(() => {
      running = null;
      inboxState.checking = false;
      inboxEvents.emit('update');
    });
  }
  return running.then((result) => ({ reached: result.reached, pending: project ? pendingItems(project).length : 0 }));
}

export function setInboxEnabled(enabled) {
  prefs.set('inboxEnabled', !!enabled);
  inboxEvents.emit('update');
  if (enabled) checkInbox().catch(() => {});
}

let started = false;

/**
 * Start the background checker (call once): it looks at the inbox when a project opens, every 10 minutes while the tab is
 * visible, and keeps the notice in the top bar (shell.setInboxCount) up to date.
 */
export function startInboxChecker(store, shell) {
  if (started) return;
  started = true;
  const refresh = () => shell?.setInboxCount?.(pendingItems(store.project).length);
  const due = (gap) => isInboxEnabled() && !!store.project && !inboxState.checking && Date.now() - inboxState.attemptedAt >= gap;
  const check = (gap = MIN_GAP) => { if (due(gap)) checkInbox({ project: store.project }).catch(() => {}); };

  inboxEvents.on('update', refresh);
  store.on('change', refresh);
  store.on('project', () => { refresh(); check(); });
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(CHECK_EVERY); });
  refresh();
  check(0);
}
