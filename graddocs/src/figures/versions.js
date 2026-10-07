// Figure version history & supervisor revisions.
// A version stores a full diagram snapshot plus the computed change list
// relative to the previous version.
import { uid, clone } from '../core/utils.js';
import { diffDiagrams, summarizeDiff, autoLabel, hasChanges } from './diff.js';

export const MAX_VERSIONS = 40;

const snapshotKey = (diagram) => JSON.stringify(diagram?.elements || []) + (diagram?.background || '') + JSON.stringify(diagram?.defaults || {});

export const latestVersion = (figure) => figure.versions[figure.versions.length - 1] || null;

/** Does the current diagram differ from the latest saved version? */
export function isDirty(figure) {
  const last = latestVersion(figure);
  return !last || snapshotKey(last.snapshot) !== snapshotKey(figure.diagram);
}

export function pendingChanges(figure) {
  const last = latestVersion(figure);
  return diffDiagrams(last?.snapshot || { elements: [] }, figure.diagram);
}

export const revisionCount = (figure) => figure.versions.filter((v) => v.kind === 'revision').length;

/**
 * Append a version (mutates figure). Returns the version or null if nothing changed.
 * options: { label, note, kind: 'initial'|'version'|'revision'|'auto'|'restore', requestedBy, force, at }
 */
export function addVersion(figure, { label = '', note = '', kind = 'version', requestedBy = '', force = false, at = Date.now() } = {}) {
  const last = latestVersion(figure);
  const diff = diffDiagrams(last?.snapshot || { elements: [] }, figure.diagram);
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
    snapshot: clone(figure.diagram),
  };
  figure.versions.push(version);
  // Keep the first version and the most recent ones.
  if (figure.versions.length > MAX_VERSIONS) figure.versions.splice(1, figure.versions.length - MAX_VERSIONS);
  return version;
}

/** Restore a snapshot as the current diagram and record it as a new version. */
export function restoreVersion(figure, versionId) {
  const v = figure.versions.find((x) => x.id === versionId);
  if (!v) throw new Error('Version not found.');
  figure.diagram = clone(v.snapshot);
  return addVersion(figure, { label: `Restored v${v.number}`, kind: 'restore', force: true });
}

export const versionLabel = (figure) => {
  const last = latestVersion(figure);
  return last ? `v${last.number}` : 'v0';
};
