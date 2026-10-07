// Compare two diagram snapshots → human-readable change list used by
// Version History and Revision Mode ("Data Analysis" → "Data & Analysis Management").
import { getShape } from './shapes.js';

export function elementLabel(el) {
  const text = String(el?.text || '').split('\n').find((l) => l.trim() && !/^--+$/.test(l.trim()));
  if (text) return text.trim().slice(0, 60);
  if (el?.type === 'edge') return 'connector';
  return getShape(el?.shape).name.toLowerCase();
}

const geomKey = (el) => (el.type === 'node' ? `${Math.round(el.x)},${Math.round(el.y)}` : '');
const sizeKey = (el) => (el.type === 'node' ? `${Math.round(el.w)}x${Math.round(el.h)}` : '');
const wireKey = (el) => (el.type === 'edge' ? JSON.stringify([el.source, el.target, el.routing]) : '');
const styleKey = (el) => JSON.stringify(el.style || {}) + (el.type === 'node' ? el.shape : '');

/**
 * diffDiagrams(before, after) → {
 *   added: [{ id, label, type }], removed: [...], renamed: [{ id, from, to }],
 *   moved: [ids], resized: [ids], restyled: [ids], rewired: [ids], changedIds: Map(id → 'added'|'changed')
 * }
 */
export function diffDiagrams(before, after) {
  const a = new Map((before?.elements || []).map((el) => [el.id, el]));
  const b = new Map((after?.elements || []).map((el) => [el.id, el]));
  const out = { added: [], removed: [], renamed: [], moved: [], resized: [], restyled: [], rewired: [], changedIds: new Map() };
  for (const [id, el] of b) {
    const prev = a.get(id);
    if (!prev) { out.added.push({ id, label: elementLabel(el), type: el.type }); out.changedIds.set(id, 'added'); continue; }
    let changed = false;
    if ((prev.text || '') !== (el.text || '')) { out.renamed.push({ id, from: prev.text || '', to: el.text || '', type: el.type }); changed = true; }
    if (geomKey(prev) !== geomKey(el)) { out.moved.push(id); changed = true; }
    if (sizeKey(prev) !== sizeKey(el)) { out.resized.push(id); changed = true; }
    if (styleKey(prev) !== styleKey(el)) { out.restyled.push(id); changed = true; }
    if (wireKey(prev) !== wireKey(el)) { out.rewired.push(id); changed = true; }
    if (changed) out.changedIds.set(id, 'changed');
  }
  for (const [id, el] of a) if (!b.has(id)) out.removed.push({ id, label: elementLabel(el), type: el.type });
  return out;
}

const q = (s) => `“${String(s).replace(/\s+/g, ' ').trim().slice(0, 60)}”`;
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** → ['Added “Data Analysis”', 'Renamed “A” → “B”', 'Moved 3 elements', …] */
export function summarizeDiff(d) {
  const lines = [];
  const meaningful = (list) => list.filter((x) => x.type !== 'edge' || (x.label && x.label !== 'connector'));
  const addedNodes = meaningful(d.added); const removedNodes = meaningful(d.removed);
  for (const x of addedNodes.slice(0, 6)) lines.push(`Added ${q(x.label)}`);
  if (addedNodes.length > 6) lines.push(`Added ${addedNodes.length - 6} more elements`);
  const addedEdges = d.added.length - addedNodes.length;
  if (addedEdges) lines.push(`Added ${n(addedEdges, 'connector')}`);
  for (const x of removedNodes.slice(0, 6)) lines.push(`Removed ${q(x.label)}`);
  if (removedNodes.length > 6) lines.push(`Removed ${removedNodes.length - 6} more elements`);
  const removedEdges = d.removed.length - removedNodes.length;
  if (removedEdges) lines.push(`Removed ${n(removedEdges, 'connector')}`);
  for (const x of d.renamed.slice(0, 8)) {
    if (!x.from) lines.push(`Labelled ${x.type === 'edge' ? 'connector' : 'element'} ${q(x.to)}`);
    else if (!x.to) lines.push(`Cleared label ${q(x.from)}`);
    else lines.push(`Changed ${q(x.from)} → ${q(x.to)}`);
  }
  if (d.renamed.length > 8) lines.push(`Changed ${d.renamed.length - 8} more labels`);
  if (d.moved.length) lines.push(`Moved ${n(d.moved.length, 'element')}`);
  if (d.resized.length) lines.push(`Resized ${n(d.resized.length, 'element')}`);
  if (d.restyled.length) lines.push(`Restyled ${n(d.restyled.length, 'element')}`);
  if (d.rewired.length) lines.push(`Reconnected ${n(d.rewired.length, 'connector')}`);
  return lines;
}

export const hasChanges = (d) => d.added.length + d.removed.length + d.renamed.length + d.moved.length + d.resized.length + d.restyled.length + d.rewired.length > 0;

/** Short default label for an automatic version. */
export function autoLabel(d) {
  if (d.renamed.length && !d.added.length && !d.removed.length) return 'Updated labels';
  const addedNodes = d.added.filter((x) => x.type === 'node');
  const removedNodes = d.removed.filter((x) => x.type === 'node');
  if (addedNodes.length === 1 && !removedNodes.length) return `Added ${addedNodes[0].label}`;
  if (removedNodes.length === 1 && !addedNodes.length) return `Removed ${removedNodes[0].label}`;
  if (addedNodes.length || removedNodes.length) return 'Edited elements';
  if (d.moved.length || d.resized.length) return 'Adjusted layout';
  if (d.restyled.length) return 'Updated styling';
  return 'Edited diagram';
}
