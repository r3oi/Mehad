// Figure version history & supervisor revisions.
// A version stores a full diagram snapshot plus the computed change list
// relative to the previous version.
// Image elements (screenshots) carry ~1 MB data URLs, so snapshots store them once per figure: the snapshot's
// `src` is "pool:<key>" and figure.imagePool[key] holds the data URL. Use versionSnapshot() to read a snapshot.
import { uid, clone } from '../core/utils.js';
import { diffDiagrams, summarizeDiff, autoLabel, hasChanges } from './diff.js';

export const MAX_VERSIONS = 40;

const POOL = 'pool:';

function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${(h >>> 0).toString(36)}${text.length.toString(36)}`;
}

/** Copy of a diagram whose data-URL images point into figure.imagePool (added to the pool). */
function pooled(figure, diagram) {
  const snap = clone(diagram || { elements: [] });
  for (const el of snap.elements || []) {
    if (typeof el.src !== 'string' || !el.src.startsWith('data:')) continue;
    if (!figure.imagePool) figure.imagePool = {};
    const key = hashText(el.src);
    figure.imagePool[key] = el.src;
    el.src = POOL + key;
  }
  return snap;
}

/** The current diagram in snapshot form, without touching the pool (for comparisons). */
function comparable(diagram) {
  if (!(diagram?.elements || []).some((el) => typeof el.src === 'string' && el.src.startsWith('data:'))) return diagram;
  return { ...diagram, elements: diagram.elements.map((el) => (typeof el.src === 'string' && el.src.startsWith('data:') ? { ...el, src: POOL + hashText(el.src) } : el)) };
}

/** A version's diagram with its images restored (safe to render, export or restore). */
export function versionSnapshot(figure, version) {
  const snap = version?.snapshot;
  if (!snap || !(snap.elements || []).some((el) => typeof el.src === 'string' && el.src.startsWith(POOL))) return snap;
  return { ...snap, elements: snap.elements.map((el) => (typeof el.src === 'string' && el.src.startsWith(POOL) ? { ...el, src: figure.imagePool?.[el.src.slice(POOL.length)] || '' } : el)) };
}

/** Drop pooled images no version uses any more. */
function prunePool(figure) {
  if (!figure.imagePool) return;
  const used = new Set();
  for (const v of figure.versions) for (const el of v.snapshot?.elements || []) if (typeof el.src === 'string' && el.src.startsWith(POOL)) used.add(el.src.slice(POOL.length));
  for (const key of Object.keys(figure.imagePool)) if (!used.has(key)) delete figure.imagePool[key];
  if (!Object.keys(figure.imagePool).length) delete figure.imagePool;
}

const snapshotKey = (diagram) => JSON.stringify(diagram?.elements || []) + (diagram?.background || '') + JSON.stringify(diagram?.defaults || {});

export const latestVersion = (figure) => figure.versions[figure.versions.length - 1] || null;

/** Does the current diagram differ from the latest saved version? */
export function isDirty(figure) {
  const last = latestVersion(figure);
  return !last || snapshotKey(last.snapshot) !== snapshotKey(comparable(figure.diagram));
}

export function pendingChanges(figure) {
  const last = latestVersion(figure);
  return diffDiagrams(last?.snapshot || { elements: [] }, comparable(figure.diagram));
}

export const revisionCount = (figure) => figure.versions.filter((v) => v.kind === 'revision').length;

/**
 * Append a version (mutates figure). Returns the version or null if nothing changed.
 * options: { label, note, kind: 'initial'|'version'|'revision'|'auto'|'restore', requestedBy, force, at }
 */
export function addVersion(figure, { label = '', note = '', kind = 'version', requestedBy = '', force = false, at = Date.now() } = {}) {
  const last = latestVersion(figure);
  const diff = diffDiagrams(last?.snapshot || { elements: [] }, comparable(figure.diagram));
  if (last && !force && !hasChanges(diff)) return null;
  const changes = last ? summarizeDiff(diff) : ['Initial diagram'];
  const version = {
    id: uid('ver'),
    number: (last?.number || 0) + 1,
    kind: last ? kind : 'initial',
    label: label || (last ? autoLabel(diff) : 'Initial diagram'),
    note,
    requestedBy,
    revision: kind === 'revision' ? revisionCount(figure) + 1 : null,
    changes,
    renamed: diff.renamed.slice(0, 20).map(({ from, to }) => ({ from, to })),
    createdAt: at,
    snapshot: pooled(figure, figure.diagram),
  };
  figure.versions.push(version);
  // Keep the first version and the most recent ones.
  if (figure.versions.length > MAX_VERSIONS) { figure.versions.splice(1, figure.versions.length - MAX_VERSIONS); prunePool(figure); }
  return version;
}

/** Restore a snapshot as the current diagram and record it as a new version. */
export function restoreVersion(figure, versionId) {
  const v = figure.versions.find((x) => x.id === versionId);
  if (!v) throw new Error('Version not found.');
  figure.diagram = clone(versionSnapshot(figure, v));
  return addVersion(figure, { label: `Restored v${v.number}`, kind: 'restore', force: true });
}

export const versionLabel = (figure) => {
  const last = latestVersion(figure);
  return last ? `v${last.number}` : 'v0';
};
