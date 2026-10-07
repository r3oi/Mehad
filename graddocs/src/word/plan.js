// Sync planner: compares a parsed Word document with the open project and produces a *plan*
// (a list of reviewable changes) that can later be applied in one store.update().
//
//   const plan = buildPlan(project, parsed)
//   plan.items  → [{ id, group, kind, unit?, title, context?, detail?, rawDetail?, diff?, checked, requires, destructive, run(ctx) }]
//   await applyPlan(store, plan, selectedIds, { fileInfo })
//
// Rules
//  • Word wins for the text of chapters/sections, tables and pictures it owns.
//  • Diagrams drawn in GradDocs are never replaced: a Word caption that matches a diagram only links it.
//  • Removals are offered, never pre-selected, and only for things that were imported from Word before.
//  • Text is only overwritten when the Word text itself changed since the last sync (or, on the first
//    link, when it differs from what the project has), so edits made in GradDocs survive a sync.
import { uid, clone } from '../core/utils.js';
import {
  createChapter, createSection, createFigure, createTable, createDiagram, createAcronym, createFrontMatterItem, findNode,
} from '../core/model.js';
import { resolveText, makeRef } from '../core/references.js';
import { addVersion } from '../figures/versions.js';
import { snapshotContent, contentKey } from '../tables/table-ops.js';
import { normKey, hashOf, similarity, tidy } from './text-utils.js';
import { prepareImage } from './images.js';

// ---------------------------------------------------------------------------
// Link record (project.wordLink)

export function emptyLink(fileName = '') {
  return {
    fileName, lastModified: 0, lastSyncedAt: null, autoSync: true, history: [],
    map: { chapters: {}, sections: {}, tables: {}, figures: {}, front: {}, acronyms: {} },
    hashes: { containers: {}, tables: {}, figures: {}, front: {} },
  };
}

/** A complete link record (missing parts filled in). Never aliases the input. */
export function normalizeLink(link) {
  const base = emptyLink(link?.fileName || '');
  if (!link) return base;
  const copy = clone(link);
  return {
    ...base, ...copy,
    history: Array.isArray(copy.history) ? copy.history : [],
    map: { ...base.map, ...(copy.map || {}) },
    hashes: { ...base.hashes, ...(copy.hashes || {}) },
  };
}

// ---------------------------------------------------------------------------
// Body text helpers

const TOKEN_LINE = /^\s*\{\{(table|figure):([A-Za-z0-9_-]+)\}\}\s*$/;
const TOKEN_ANY = /\{\{(?:table|figure):[A-Za-z0-9_-]+\}\}/g;
const tokenOf = (kind, id) => `{{${kind}:${id}}}`;

/** The text lines Word contributes to a chapter/section (placements excluded). */
export function wordLinesOf(node) {
  const out = [];
  for (const b of node.blocks) {
    if (b.type !== 'p' && b.type !== 'li') continue;
    const t = tidy(b.text);
    if (t) out.push(b.type === 'li' ? `- ${t}` : t);
  }
  return out;
}

/** The text lines of a project body, comparable with wordLinesOf(). */
export function bodyLines(project, body) {
  return String(body || '').split('\n')
    .filter((l) => !TOKEN_LINE.test(l))
    .map((l) => tidy(resolveText(project, l.replace(TOKEN_ANY, ''))).replace(/^[•*]\s+/, '- '))
    .filter(Boolean);
}

/** Line diff (LCS). → { added: [...], removed: [...] } */
export function diffLines(oldLines, newLines) {
  const a = oldLines.slice(0, 600); const b = newLines.slice(0, 600);
  const m = a.length; const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) for (let j = n - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const added = []; const removed = [];
  let i = 0; let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { i += 1; j += 1; } else if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(a[i]); i += 1; } else { added.push(b[j]); j += 1; }
  }
  while (i < m) { removed.push(a[i]); i += 1; }
  while (j < n) { added.push(b[j]); j += 1; }
  return { added, removed };
}

const wordsOf = (lines) => new Set(normKey(lines.join(' ')).split(' ').filter((w) => w.length > 2));
function bodySimilarity(aLines, bLines) {
  const a = wordsOf(aLines); const b = wordsOf(bLines);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  return common / Math.max(a.size, b.size);
}

// ---------------------------------------------------------------------------
// Table signatures: the content that decides "did this table change?"

const cellSig = (c, text) => (c.hidden ? '~' : `${tidy(text).toLowerCase()}|${c.colspan || 1}|${c.rowspan || 1}`);
const wordTableSig = (t) => JSON.stringify([t.rows.length, t.cols, t.headerRows, t.rows.map((r) => r.map((c) => cellSig(c, c.text)))]);
const projectTableSig = (project, table) => JSON.stringify([table.rows.length, table.columns.length, table.headerRows,
  table.rows.map((r) => r.map((c) => cellSig(c, resolveText(project, c.text || ''))))]);

// ---------------------------------------------------------------------------
// Plan building

const titlesOf = (pn) => { const parts = []; for (let p = pn; p; p = p.parent) parts.unshift(p.word.title); return parts; };
const ancestorPath = (pn) => titlesOf(pn).slice(0, -1).join(' › ');

/** buildPlan(project, parsed) → plan. Pure: nothing in the project changes until the plan is applied. */
export function buildPlan(project, parsed) {
  const link = normalizeLink(project.wordLink);
  const items = [];
  let seq = 0;
  const add = (o) => { const item = { id: `c${(seq += 1)}`, checked: true, requires: null, destructive: false, ...o }; items.push(item); return item; };
  const plan = { items, parsed, link, firstSync: !link.lastSyncedAt, imageBytes: 0, pns: [], tps: [], fps: [], front: [] };

  // ----- 1. chapters and sections -----------------------------------------------------------
  const mappedIds = new Set([...Object.values(link.map.chapters), ...Object.values(link.map.sections)]);
  const reorders = [];

  const matchLevel = (wordNodes, projNodes, parent, chapterHolder) => {
    const isChapter = !parent;
    const claimed = new Set();
    const rows = wordNodes.map((w) => ({ w, p: null }));
    const keyMap = isChapter ? link.map.chapters : link.map.sections;
    for (const r of rows) {
      const id = keyMap[r.w.key];
      const cand = id ? projNodes.find((p) => p.id === id && !claimed.has(p)) : null;
      if (cand) { r.p = cand; claimed.add(cand); }
    }
    for (const r of rows) {
      if (r.p) continue;
      const k = normKey(r.w.title);
      const cand = projNodes.find((p) => !claimed.has(p) && normKey(p.title) === k);
      if (cand) { r.p = cand; claimed.add(cand); }
    }
    // Renamed headings: unmatched Word headings vs. imported-but-missing project headings between the same neighbours.
    // On the very first link nothing is "imported" yet, so near-identical titles are paired too (never duplicated).
    const isMapped = (p) => mappedIds.has(p.id);
    const leftover = projNodes.filter((p) => !claimed.has(p) && (isMapped(p) || plan.firstSync));
    rows.forEach((r, i) => {
      if (r.p || !leftover.length) return;
      let prevIdx = -1; let nextIdx = projNodes.length;
      for (let k = i - 1; k >= 0; k -= 1) if (rows[k].p) { prevIdx = projNodes.indexOf(rows[k].p); break; }
      for (let k = i + 1; k < rows.length; k += 1) if (rows[k].p) { nextIdx = projNodes.indexOf(rows[k].p); break; }
      const wLines = wordLinesOf(r.w);
      let best = null; let bestScore = 0;
      for (const p of leftover) {
        const idx = projNodes.indexOf(p);
        const between = idx > prevIdx && idx < nextIdx;
        const pLines = bodyLines(project, p.body);
        const bodySim = bodySimilarity(wLines, pLines);
        const titleSim = similarity(r.w.title, p.title);
        const bothEmpty = !wLines.length && !pLines.length;
        const ok = bodySim >= 0.6 || titleSim >= 0.7 || (between && (isMapped(p)
          ? (titleSim >= 0.34 || bodySim >= 0.3 || bothEmpty) : (titleSim >= 0.5 || bodySim >= 0.5)));
        const score = bodySim * 0.6 + titleSim * 0.3 + (between ? 0.1 : 0);
        if (ok && score > bestScore) { best = p; bestScore = score; }
      }
      if (best) { r.p = best; claimed.add(best); leftover.splice(leftover.indexOf(best), 1); }
    });

    const list = rows.map((r) => {
      const pn = {
        word: r.w, proj: r.p, id: r.p ? r.p.id : uid(isChapter ? 'ch' : 'sec'), isChapter, isNew: !r.p, parent,
        chapterPN: null, children: [], removed: [], prevSibling: null, textChanged: false, lines: [],
        renamed: !!r.p && normKey(r.p.title) !== normKey(r.w.title),
      };
      pn.chapterPN = isChapter ? pn : chapterHolder;
      return pn;
    });
    list.forEach((pn, i) => { pn.prevSibling = i ? list[i - 1] : null; });
    list.forEach((pn) => {
      const sub = matchLevel(pn.word.children, pn.proj ? (pn.proj.sections || []) : [], pn, pn.chapterPN);
      pn.children = sub.list; pn.removed = sub.removed;
    });
    const removed = projNodes.filter((p) => !claimed.has(p) && isMapped(p));

    const matchedIds = new Set(rows.filter((r) => r.p).map((r) => r.p.id));
    const projOrder = projNodes.filter((p) => matchedIds.has(p.id)).map((p) => p.id);
    const wordOrder = rows.filter((r) => r.p).map((r) => r.p.id);
    if (projOrder.join() !== wordOrder.join()) reorders.push({ parent, wordOrder });
    return { list, removed };
  };

  const root = matchLevel(parsed.chapters, project.chapters, null, null);
  const flatten = (list) => list.forEach((pn) => { plan.pns.push(pn); flatten(pn.children); });
  flatten(root.list);

  // ----- 2. tables and pictures: match first (claims are global), emit items afterwards -------
  const atLocation = (item, pn) => (pn.isChapter ? (!item.sectionId && item.chapterId === pn.id) : item.sectionId === pn.id);
  const matchItems = (kind) => {
    const isTable = kind === 'table';
    const projList = isTable ? project.tables : project.figures;
    const keyMap = isTable ? link.map.tables : link.map.figures;
    const mapped = new Set(Object.values(keyMap));
    const byId = new Map(projList.map((x) => [x.id, x]));
    const claimed = new Set();
    const entries = [];
    for (const pn of plan.pns) {
      for (const blk of pn.word.blocks) {
        if (blk.type !== (isTable ? 'table' : 'image')) continue;
        const word = isTable ? blk.table : blk.image;
        if (isTable && !word.rows.length) continue;
        const e = { kind, word, pn, proj: null, blk, id: null };
        if (isTable) { e.sig = wordTableSig(word); e.hash = hashOf(e.sig); } else e.hash = word.hash;
        entries.push(e);
      }
    }
    const claim = (e, item) => { e.proj = item; claimed.add(item.id); };
    for (const e of entries) {
      const id = keyMap[e.word.key];
      if (id && byId.has(id) && !claimed.has(id)) claim(e, byId.get(id));
    }
    for (const e of entries) {
      if (e.proj || !e.word.title) continue;
      const k = normKey(e.word.title);
      const cand = projList.find((x) => !claimed.has(x.id) && normKey(x.title) === k);
      if (cand) claim(e, cand);
    }
    // Pictures/tables without a caption: identical content in the same place.
    for (const e of entries) {
      if (e.proj || e.word.title || e.pn.isNew) continue;
      const cand = projList.find((x) => !claimed.has(x.id) && atLocation(x, e.pn)
        && (isTable ? projectTableSig(project, x) === e.sig : link.hashes.figures[x.id] === e.hash));
      if (cand) claim(e, cand);
    }
    // Renamed captions: same content, a near-identical caption, or the only unmatched imported item in that place.
    const leftover = projList.filter((x) => !claimed.has(x.id) && (mapped.has(x.id) || plan.firstSync));
    for (const e of entries) {
      if (e.proj || !leftover.length) continue;
      let cand = isTable
        ? leftover.find((x) => projectTableSig(project, x) === e.sig)
        : leftover.find((x) => link.hashes.figures[x.id] === e.hash);
      if (!cand && e.word.title) cand = leftover.find((x) => similarity(x.title, e.word.title) >= 0.7);
      if (!cand && !e.pn.isNew) {
        const here = leftover.filter((x) => mapped.has(x.id) && atLocation(x, e.pn));
        const wordHere = entries.filter((o) => !o.proj && o.pn === e.pn).length;
        if (here.length === 1 && wordHere === 1) [cand] = here;
      }
      if (cand) { claim(e, cand); e.renamed = true; leftover.splice(leftover.indexOf(cand), 1); }
    }
    for (const e of entries) {
      e.isNew = !e.proj;
      e.id = e.proj ? e.proj.id : uid(isTable ? 'tbl' : 'fig');
      e.blk.entry = e;
    }
    return { entries, removed: projList.filter((x) => !claimed.has(x.id) && mapped.has(x.id)) };
  };
  const tableMatch = matchItems('table');
  const figureMatch = matchItems('figure');
  plan.tps = tableMatch.entries; plan.fps = figureMatch.entries;

  // ----- 3. emit items, in document order ----------------------------------------------------------
  const paragraphCount = (pn) => pn.word.blocks.filter((b) => b.type === 'p' || b.type === 'li').length;

  const emitTable = (e, pn) => {
    const wt = e.word;
    const requires = pn.isNew ? pn.addItemId : null;
    if (e.isNew) {
      e.addItemId = add({
        group: 'tables', kind: 'add', title: wt.title || 'Untitled Table', context: pn.word.title,
        detail: ['{rows} rows × {cols} columns', { rows: wt.rows.length, cols: wt.cols }], requires, run: (ctx) => ctx.addTable(e),
      }).id;
      return;
    }
    const stored = link.hashes.tables[e.proj.id];
    const differs = projectTableSig(project, e.proj) !== e.sig;
    e.changed = differs && (stored === undefined || stored !== e.hash);
    e.moved = !atLocation(e.proj, pn);
    if (e.changed || e.moved || e.renamed) {
      const parts = [];
      if (e.changed) parts.push(['Content changed', {}]);
      if (e.moved) parts.push(['Moved to “{to}”', { to: pn.word.title }]);
      if (e.renamed) parts.push(['Caption changed', {}]);
      e.updateItemId = add({
        group: 'tables', kind: e.moved && !e.changed ? 'move' : 'update', title: wt.title || e.proj.title, context: pn.word.title,
        detail: parts[0], extra: parts.slice(1), requires, run: (ctx) => ctx.updateTable(e),
      }).id;
    }
  };

  const emitFigure = (e, pn) => {
    const wi = e.word;
    const requires = pn.isNew ? pn.addItemId : null;
    if (e.isNew) {
      plan.imageBytes += wi.bytes.length;
      e.addItemId = add({
        group: 'figures', kind: 'add', title: wi.title || wi.descr || 'Untitled Figure', context: pn.word.title,
        detail: ['Picture · {kb} KB', { kb: Math.max(1, Math.round(wi.bytes.length / 1024)) }], requires, run: (ctx) => ctx.addFigure(e),
      }).id;
      return;
    }
    e.owned = link.hashes.figures[e.proj.id] !== undefined;
    e.changed = e.owned && link.hashes.figures[e.proj.id] !== wi.hash;
    e.moved = !atLocation(e.proj, pn);
    const renamed = e.renamed && e.owned;
    if (e.changed || e.moved || renamed) {
      if (e.changed) plan.imageBytes += wi.bytes.length;
      const parts = [];
      if (e.changed) parts.push(['Picture replaced', {}]);
      if (e.moved) parts.push(['Moved to “{to}”', { to: pn.word.title }]);
      if (renamed) parts.push(['Caption changed', {}]);
      e.updateItemId = add({
        group: 'figures', kind: e.moved && !e.changed ? 'move' : 'update', title: wi.title || e.proj.title, context: pn.word.title,
        detail: parts[0], extra: parts.slice(1), requires, run: (ctx) => ctx.updateFigure(e),
      }).id;
    }
  };

  const emitContainer = (pn) => {
    const word = pn.word;
    pn.lines = wordLinesOf(word);
    pn.textHash = hashOf(pn.lines.join('\n'));
    const unit = pn.isChapter ? 'chapter' : 'section';
    const context = ancestorPath(pn);
    if (pn.isNew) {
      const n = paragraphCount(pn);
      pn.addItemId = add({
        group: 'structure', kind: 'add', unit, title: word.title, context, detail: n ? (n === 1 ? ['1 paragraph', {}] : ['{n} paragraphs', { n }]) : null,
        requires: pn.parent ? pn.parent.addItemId || null : null, run: (ctx) => ctx.addNode(pn),
      }).id;
    } else {
      if (pn.renamed) {
        add({
          group: 'structure', kind: 'rename', unit, title: word.title, context, detail: ['was “{from}”', { from: pn.proj.title }],
          run: (ctx) => ctx.renameNode(pn),
        });
      }
      const old = bodyLines(project, pn.proj.body);
      const stored = link.hashes.containers[pn.proj.id];
      const same = old.join('\n') === pn.lines.join('\n');
      pn.textChanged = !same && (stored === undefined || stored !== pn.textHash);
      if (pn.textChanged) {
        const diff = diffLines(old, pn.lines);
        add({
          group: 'text', kind: 'update', unit, title: word.title, context,
          detail: ['{added} added, {removed} removed', { added: diff.added.length, removed: diff.removed.length }], diff,
          run: (ctx) => ctx.textApplied.add(pn.id),
        });
      }
    }
    for (const blk of word.blocks) {
      if (!blk.entry) continue;
      if (blk.entry.kind === 'table') emitTable(blk.entry, pn); else emitFigure(blk.entry, pn);
    }
    pn.children.forEach(emitContainer);
    for (const p of pn.removed) emitRemoveNode(p, titlesOf(pn).join(' › '), 'section');
  };

  const emitRemoveNode = (p, context, unit) => add({
    group: 'structure', kind: 'remove', unit, title: p.title, context, detail: ['No longer in the Word file', {}],
    checked: false, destructive: true, run: (ctx) => ctx.removeNode(p.id),
  });

  root.list.forEach(emitContainer);
  for (const p of root.removed) emitRemoveNode(p, '', 'chapter');

  for (const x of tableMatch.removed) {
    add({ group: 'tables', kind: 'remove', title: x.title, context: '', detail: ['No longer in the Word file', {}], checked: false, destructive: true, run: (ctx) => ctx.removeTable(x.id) });
  }
  for (const x of figureMatch.removed) {
    if (link.hashes.figures[x.id] === undefined) continue; // diagrams are never removed by a sync
    add({ group: 'figures', kind: 'remove', title: x.title, context: '', detail: ['No longer in the Word file', {}], checked: false, destructive: true, run: (ctx) => ctx.removeFigure(x.id) });
  }
  for (const r of reorders) {
    const parentNode = r.parent;
    add({
      group: 'structure', kind: 'reorder', unit: parentNode ? 'section' : 'chapter', title: parentNode ? parentNode.word.title : '', context: parentNode ? ancestorPath(parentNode) : '',
      detail: [parentNode ? 'Sections reordered' : 'Chapters reordered', {}], requires: parentNode?.addItemId || null, run: (ctx) => ctx.reorder(parentNode, r.wordOrder),
    });
  }

  // ----- 4. acronyms -----------------------------------------------------------------------------
  const projAcr = new Map(project.acronyms.map((a) => [normKey(a.acronym), a]));
  const wordAcr = new Set();
  for (const wa of parsed.acronyms) {
    const k = normKey(wa.acronym); wordAcr.add(k);
    const ex = projAcr.get(k);
    if (!ex) add({ group: 'acronyms', kind: 'add', title: wa.acronym, context: '', rawDetail: wa.meaning, run: (ctx) => ctx.addAcronym(wa) });
    else if (normKey(ex.meaning) !== normKey(wa.meaning)) add({ group: 'acronyms', kind: 'update', title: wa.acronym, context: '', rawDetail: wa.meaning, run: (ctx) => ctx.updateAcronym(ex.id, wa) });
  }
  for (const [k, id] of Object.entries(link.map.acronyms)) {
    const ex = project.acronyms.find((a) => a.id === id);
    if (ex && !wordAcr.has(k)) add({ group: 'acronyms', kind: 'remove', title: ex.acronym, context: '', rawDetail: ex.meaning, checked: false, destructive: true, run: (ctx) => ctx.removeAcronym(id) });
  }

  // ----- 5. front matter -------------------------------------------------------------------------
  const claimedFront = new Set();
  const BODY_KINDS = new Set(['declaration', 'acknowledgements', 'abstract', 'custom']);
  parsed.front.forEach((wf, index) => {
    if (!BODY_KINDS.has(wf.kind)) return;
    const k = normKey(wf.title);
    const mapId = link.map.front[`${wf.kind}:${k}`];
    const proj = (mapId && project.frontMatter.find((f) => f.id === mapId && !claimedFront.has(f.id)))
      || project.frontMatter.find((f) => !claimedFront.has(f.id) && f.kind === wf.kind && normKey(f.title) === k)
      || (wf.kind !== 'custom' ? project.frontMatter.find((f) => !claimedFront.has(f.id) && f.kind === wf.kind) : null);
    if (proj) claimedFront.add(proj.id);
    const lines = wf.body ? wf.body.split('\n').map(tidy).filter(Boolean) : [];
    const e = { word: wf, index, proj, id: proj ? proj.id : uid('fm'), lines, hash: hashOf(lines.join('\n')), changed: false };
    plan.front.push(e);
    if (!proj) {
      if (lines.length) add({ group: 'front', kind: 'add', title: wf.title, context: '', detail: lines.length === 1 ? ['1 paragraph', {}] : ['{n} paragraphs', { n: lines.length }], run: (ctx) => ctx.addFront(e) });
      return;
    }
    const old = bodyLines(project, proj.body);
    const stored = link.hashes.front[proj.id];
    const same = old.join('\n') === lines.join('\n');
    e.changed = !same && (stored === undefined || stored !== e.hash) && (lines.length > 0 || stored !== undefined);
    if (e.changed) {
      const diff = diffLines(old, lines);
      add({
        group: 'front', kind: 'update', title: proj.title, context: '',
        detail: ['{added} added, {removed} removed', { added: diff.added.length, removed: diff.removed.length }], diff, run: (ctx) => ctx.updateFront(e),
      });
    }
  });

  plan.hasRemovals = items.some((i) => i.kind === 'remove');
  plan.counts = countKinds(items);
  return plan;
}

export function countKinds(list) {
  const c = { added: 0, updated: 0, renamed: 0, removed: 0 };
  for (const i of list) {
    if (i.kind === 'add') c.added += 1;
    else if (i.kind === 'rename') c.renamed += 1;
    else if (i.kind === 'remove') c.removed += 1;
    else c.updated += 1;
  }
  return c;
}

export function summarizeCounts(c) {
  const parts = [];
  if (c.added) parts.push(`${c.added} added`);
  if (c.updated) parts.push(`${c.updated} updated`);
  if (c.renamed) parts.push(`${c.renamed} renamed`);
  if (c.removed) parts.push(`${c.removed} removed`);
  return parts.join(', ') || 'No changes';
}

// ---------------------------------------------------------------------------
// Applying a plan

const WORD_REF = /\b(Figure|Fig\.|Table|Section|Chapter)\s+(\d+(?:\.\d+)*)\b/g;

function createContext(project, plan, prepared) {
  const link = project.wordLink;
  const ctx = { project, plan, prepared, link, textApplied: new Set(), created: new Set(), applied: new Set() };
  const arrayFor = (pn) => (pn.isChapter ? project.chapters : (findNode(project, pn.parent.id)?.node.sections || null));
  const locationOf = (pn) => (pn.isChapter ? { chapterId: pn.id, sectionId: null } : { chapterId: pn.chapterPN.id, sectionId: pn.id });

  ctx.addNode = (pn) => {
    const arr = arrayFor(pn);
    if (!arr) return;
    const node = pn.isChapter
      ? createChapter({ id: pn.id, title: pn.word.title })
      : createSection({ id: pn.id, title: pn.word.title, status: pn.lines.length ? 'draft' : 'todo' });
    let idx = pn.prevSibling ? arr.length : 0;
    for (let s = pn.prevSibling; s; s = s.prevSibling) {
      const at = arr.findIndex((x) => x.id === s.id);
      if (at >= 0) { idx = at + 1; break; }
    }
    arr.splice(idx, 0, node);
    ctx.created.add(pn.id);
    ctx.textApplied.add(pn.id);
  };
  ctx.renameNode = (pn) => { const f = findNode(project, pn.id); if (f) f.node.title = pn.word.title; };
  ctx.removeNode = (id) => {
    const f = findNode(project, id);
    if (!f) return;
    const gone = new Set([id]);
    const collect = (n) => (n.sections || []).forEach((s) => { gone.add(s.id); collect(s); });
    collect(f.node);
    for (const item of [...project.tables, ...project.figures]) {
      if (f.kind === 'chapter' && item.chapterId === id) { item.chapterId = null; item.sectionId = null; } else if (item.sectionId && gone.has(item.sectionId)) item.sectionId = f.parent ? f.parent.id : null;
    }
    f.siblings.splice(f.index, 1);
  };
  ctx.reorder = (parentPN, wordOrder) => {
    const arr = parentPN ? findNode(project, parentPN.id)?.node.sections : project.chapters;
    if (!arr) return;
    const present = wordOrder.filter((id) => arr.some((x) => x.id === id));
    const slots = arr.map((x, i) => (present.includes(x.id) ? i : -1)).filter((i) => i >= 0);
    const byId = new Map(arr.map((x) => [x.id, x]));
    present.forEach((id, k) => { arr[slots[k]] = byId.get(id); });
  };

  const tableContent = (e) => ({
    columns: e.word.widths.map((width) => ({ id: uid('col'), width })),
    rows: e.word.rows.map((r) => r.map((c) => ({ ...c }))),
    headerRows: e.word.headerRows,
  });
  ctx.addTable = (e) => {
    project.tables.push(createTable({ id: e.id, title: e.word.title || 'Untitled Table', ...locationOf(e.pn), ...tableContent(e) }));
    ctx.created.add(e.id);
    link.hashes.tables[e.id] = e.hash;
  };
  ctx.updateTable = (e) => {
    const table = project.tables.find((t) => t.id === e.id);
    if (!table) return;
    if (e.changed) {
      const snap = snapshotContent(table);
      const last = table.versions[table.versions.length - 1];
      if (!last || contentKey(last.snapshot) !== contentKey(snap)) {
        table.versions.push({ id: uid('ver'), number: (last?.number || 0) + 1, label: 'Before Word sync', kind: 'auto', createdAt: Date.now(), snapshot: snap });
        if (table.versions.length > 20) table.versions.splice(1, table.versions.length - 20);
      }
      Object.assign(table, tableContent(e));
    }
    if (e.renamed && e.word.title) table.title = e.word.title;
    if (e.moved) Object.assign(table, locationOf(e.pn));
    table.updatedAt = Date.now();
    link.hashes.tables[e.id] = e.hash;
  };
  ctx.removeTable = (id) => { project.tables = project.tables.filter((t) => t.id !== id); };

  const diagramFor = (prep) => {
    let w = 640; let h = Math.round((w * prep.height) / prep.width);
    if (h > 900) { h = 900; w = Math.round((h * prep.width) / prep.height); }
    const pad = 40;
    return createDiagram({
      width: w + pad * 2, height: h + pad * 2, background: '#ffffff',
      elements: [{ id: uid('n'), type: 'node', shape: 'image', x: pad, y: pad, w, h, text: '', src: prep.dataUrl, style: {} }],
    });
  };
  ctx.addFigure = (e) => {
    const prep = prepared.get(e.word);
    if (!prep) return;
    const figure = createFigure({ id: e.id, title: e.word.title || e.word.descr || 'Untitled Figure', type: 'generic', ...locationOf(e.pn), diagram: diagramFor(prep) });
    addVersion(figure, { force: true, label: 'Imported from Word' });
    project.figures.push(figure);
    ctx.created.add(e.id);
    link.hashes.figures[e.id] = e.hash;
  };
  ctx.updateFigure = (e) => {
    const figure = project.figures.find((f) => f.id === e.id);
    if (!figure) return;
    if (e.changed) {
      const prep = prepared.get(e.word);
      if (prep) {
        figure.diagram = diagramFor(prep);
        figure.versions = []; // Word is the source of truth for pictures; keeps storage small
        addVersion(figure, { force: true, label: 'Updated from Word' });
        link.hashes.figures[e.id] = e.hash;
      }
    }
    if (e.renamed && e.owned && e.word.title) figure.title = e.word.title;
    if (e.moved) Object.assign(figure, locationOf(e.pn));
    figure.updatedAt = Date.now();
  };
  ctx.removeFigure = (id) => { project.figures = project.figures.filter((f) => f.id !== id); };

  ctx.addAcronym = (wa) => project.acronyms.push(createAcronym({ acronym: wa.acronym, meaning: wa.meaning }));
  ctx.updateAcronym = (id, wa) => { const a = project.acronyms.find((x) => x.id === id); if (a) a.meaning = wa.meaning; };
  ctx.removeAcronym = (id) => { project.acronyms = project.acronyms.filter((a) => a.id !== id); };

  ctx.addFront = (e) => {
    const item = createFrontMatterItem(e.word.kind, { id: e.id, title: e.word.title, body: e.lines.join('\n') });
    let at = 0; // keep Word's order: right after the previous Word page that exists in the project
    for (let k = e.index - 1; k >= 0; k -= 1) {
      const prev = plan.front.find((x) => x.index === k);
      const idx = prev ? project.frontMatter.findIndex((f) => f.id === prev.id) : -1;
      if (idx >= 0) { at = idx + 1; break; }
    }
    project.frontMatter.splice(at, 0, item);
    ctx.created.add(e.id);
    link.hashes.front[e.id] = e.hash;
  };
  ctx.updateFront = (e) => {
    const fm = project.frontMatter.find((f) => f.id === e.id);
    if (!fm) return;
    fm.body = e.lines.join('\n');
    link.hashes.front[e.id] = e.hash;
  };

  ctx.itemExists = (e) => !!e.proj || ctx.created.has(e.id);
  return ctx;
}

/** Word-side numbering ("Figure 3", "Table 2.1", "Section 1.4") → live reference tokens. */
function buildRefLinker(ctx) {
  const { project, plan } = ctx;
  const maps = { fig: new Map(), tab: new Map(), sec: new Map(), ch: new Map() };
  const put = (map, key, id) => { if (key) map.set(key, map.has(key) ? null : id); }; // duplicates are ambiguous → not linked
  for (const e of plan.fps) if (ctx.itemExists(e) && project.figures.some((f) => f.id === e.id)) put(maps.fig, e.word.number, e.id);
  for (const e of plan.tps) if (ctx.itemExists(e) && project.tables.some((t) => t.id === e.id)) put(maps.tab, e.word.number, e.id);
  for (const pn of plan.pns) if (findNode(project, pn.id)) put(pn.isChapter ? maps.ch : maps.sec, pn.word.number, pn.id);
  return (line) => line.replace(WORD_REF, (m, word, num) => {
    const kind = word === 'Figure' || word === 'Fig.' ? 'fig' : word === 'Table' ? 'tab' : word === 'Section' ? 'sec' : 'ch';
    const id = maps[kind].get(num);
    return id ? makeRef(kind, id) : m;
  });
}

function layoutBodies(ctx) {
  const { project, plan, link } = ctx;
  const linkRefs = buildRefLinker(ctx);
  const managed = new Set([...Object.values(link.map.tables), ...Object.values(link.map.figures), ...plan.tps.map((e) => e.id), ...plan.fps.map((e) => e.id)]);
  for (const pn of plan.pns) {
    const found = findNode(project, pn.id);
    if (!found) continue;
    const node = found.node;
    // The tables/pictures Word places here that exist in the project and live in this container.
    const placed = [];
    for (const blk of pn.word.blocks) {
      const e = blk.entry;
      if (!e || !ctx.itemExists(e)) continue;
      const item = e.kind === 'table' ? project.tables.find((t) => t.id === e.id) : project.figures.find((f) => f.id === e.id);
      if (!item) continue;
      const here = pn.isChapter ? (!item.sectionId && item.chapterId === pn.id) : item.sectionId === pn.id;
      if (here) placed.push(e);
    }
    const placedIds = new Set(placed.map((e) => e.id));
    const oldLines = String(node.body || '').split('\n');

    if (pn.isNew || ctx.textApplied.has(pn.id)) {
      const lines = [];
      const wordTokens = new Set();
      for (const blk of pn.word.blocks) {
        if (blk.type === 'p' || blk.type === 'li') {
          const t = tidy(blk.text);
          if (t) lines.push(blk.type === 'li' ? `- ${linkRefs(t)}` : linkRefs(t));
        } else if (blk.entry && placedIds.has(blk.entry.id)) { lines.push(tokenOf(blk.entry.kind, blk.entry.id)); wordTokens.add(blk.entry.id); }
      }
      // placements the user made in GradDocs (diagrams, tables Word does not manage) stay
      for (const l of oldLines) {
        const m = TOKEN_LINE.exec(l);
        if (m && !managed.has(m[2]) && !wordTokens.has(m[2])) lines.push(l.trim());
      }
      node.body = lines.join('\n');
      continue;
    }

    // Text untouched: only (re)position the placement tokens of items Word manages.
    const tokens = oldLines.map((l) => ({ l, m: TOKEN_LINE.exec(l) }));
    const haveManaged = new Set(tokens.filter((x) => x.m && managed.has(x.m[2])).map((x) => x.m[2]));
    if (haveManaged.size === placedIds.size && [...placedIds].every((id) => haveManaged.has(id))) continue;
    const kept = tokens.filter((x) => !x.m || !managed.has(x.m[2]) || placedIds.has(x.m[2]));
    const textOnly = kept.filter((x) => !x.m).map((x) => x.l);
    if (textOnly.filter((l) => l.trim()).length === pn.lines.length) {
      const after = new Map(); // number of text lines before → tokens
      let count = 0;
      for (const blk of pn.word.blocks) {
        if (blk.type === 'p' || blk.type === 'li') { if (tidy(blk.text)) count += 1; } else if (blk.entry && placedIds.has(blk.entry.id)) {
          if (!after.has(count)) after.set(count, []);
          after.get(count).push(tokenOf(blk.entry.kind, blk.entry.id));
        }
      }
      const out = [...(after.get(0) || [])];
      let seen = 0;
      for (const l of textOnly) {
        out.push(l);
        if (l.trim()) { seen += 1; out.push(...(after.get(seen) || [])); }
      }
      out.push(...kept.filter((x) => x.m && !managed.has(x.m[2])).map((x) => x.l)); // the user's own placements
      node.body = out.join('\n');
    } else {
      const have = new Set(kept.filter((x) => x.m).map((x) => x.m[2]));
      node.body = [...kept.map((x) => x.l), ...placed.filter((e) => !have.has(e.id)).map((e) => tokenOf(e.kind, e.id))].join('\n');
    }
  }
}

function recordLink(ctx, fileInfo) {
  const { project, plan, link } = ctx;
  const { map, hashes } = link;
  const exists = {
    node: (id) => !!findNode(project, id),
    table: (id) => project.tables.some((t) => t.id === id),
    figure: (id) => project.figures.some((f) => f.id === id),
    front: (id) => project.frontMatter.some((f) => f.id === id),
    acronym: (id) => project.acronyms.some((a) => a.id === id),
  };
  const prune = (obj, test) => { for (const [k, id] of Object.entries(obj)) if (!test(id)) delete obj[k]; }; // key → id maps
  const pruneKeys = (obj, test) => { for (const id of Object.keys(obj)) if (!test(id)) delete obj[id]; }; // id → hash maps
  const dropValue = (obj, id) => { for (const [k, v] of Object.entries(obj)) if (v === id) delete obj[k]; };
  prune(map.chapters, exists.node); prune(map.sections, exists.node); prune(map.tables, exists.table);
  prune(map.figures, exists.figure); prune(map.front, exists.front); prune(map.acronyms, exists.acronym);
  pruneKeys(hashes.containers, exists.node); pruneKeys(hashes.tables, exists.table); pruneKeys(hashes.figures, exists.figure); pruneKeys(hashes.front, exists.front);

  for (const pn of plan.pns) {
    if (!exists.node(pn.id)) continue;
    const target = pn.isChapter ? map.chapters : map.sections;
    dropValue(target, pn.id); target[pn.word.key] = pn.id;
    if (pn.isNew || ctx.textApplied.has(pn.id) || !pn.textChanged) hashes.containers[pn.id] = pn.textHash;
  }
  for (const e of plan.tps) {
    if (!exists.table(e.id) || !ctx.itemExists(e)) continue;
    dropValue(map.tables, e.id); map.tables[e.word.key] = e.id;
    if (!e.isNew && !e.changed) hashes.tables[e.id] = e.hash;
  }
  for (const e of plan.fps) {
    if (!exists.figure(e.id) || !ctx.itemExists(e)) continue;
    dropValue(map.figures, e.id); map.figures[e.word.key] = e.id;
    if (!e.isNew && e.owned && !e.changed) hashes.figures[e.id] = e.hash;
  }
  for (const e of plan.front) {
    if (!exists.front(e.id)) continue;
    dropValue(map.front, e.id); map.front[`${e.word.kind}:${normKey(e.word.title)}`] = e.id;
    if (!e.changed) hashes.front[e.id] = e.hash;
  }
  for (const wa of plan.parsed.acronyms) {
    const k = normKey(wa.acronym);
    const a = project.acronyms.find((x) => normKey(x.acronym) === k);
    if (a) map.acronyms[k] = a.id;
  }
  link.fileName = fileInfo.name || link.fileName;
  link.lastModified = fileInfo.lastModified || link.lastModified || 0;
  link.lastSyncedAt = Date.now();
}

/** Decode/scale the pictures that will be written; switch to IndexedDB when localStorage could not hold them. */
async function preparePictures(store, plan, selected) {
  const prepared = new Map();
  let total = 0;
  for (const e of plan.fps) {
    const itemId = e.isNew ? e.addItemId : e.updateItemId;
    if (!itemId || !selected.has(itemId) || !(e.isNew || e.changed)) continue;
    try {
      const prep = await prepareImage(e.word);
      prepared.set(e.word, prep);
      total += prep.dataUrl.length;
    } catch (err) { // a picture the browser cannot decode must not stop the whole sync
      console.warn('[word] could not read a picture', err);
      plan.failedImages = (plan.failedImages || 0) + 1;
    }
  }
  if (total && store.repo.engine === 'localStorage' && typeof indexedDB !== 'undefined') {
    let used = 0; let quota = 10 * 1024 * 1024;
    try { ({ used, quota } = await store.repo.usage()); } catch { /* assume small */ }
    // A data URL is stored in the diagram, again in its first version, and the project is kept in up to 6 copies (backups).
    if (used + total * 24 > quota * 0.6) {
      try { await store.switchEngine('indexedDB'); plan.switchedStorage = true; } catch (err) { console.warn('[word] could not switch storage', err); }
    }
  }
  return prepared;
}

/**
 * applyPlan(store, plan, selectedIds, { fileInfo: { name, lastModified }, backup = true, activity })
 * → { count, counts, summary, backup, applied: [items], switchedStorage }
 */
export async function applyPlan(store, plan, selectedIds, { fileInfo = {}, backup = true, reason = 'Before Word sync', activity = true } = {}) {
  const selected = new Set(selectedIds);
  for (const item of plan.items) if (selected.has(item.id) && item.requires && !selected.has(item.requires)) selected.delete(item.id);
  const prepared = await preparePictures(store, plan, selected);
  const backupRecord = backup ? await store.createBackup(reason) : null;

  const applied = [];
  const log = { text: 'Synced with Word', kind: 'sync' };
  store.update((project) => {
    project.wordLink = normalizeLink(project.wordLink);
    const ctx = createContext(project, plan, prepared);
    for (const item of plan.items) {
      if (!selected.has(item.id)) continue;
      item.run(ctx);
      ctx.applied.add(item.id);
      applied.push(item);
    }
    layoutBodies(ctx);
    recordLink(ctx, fileInfo);
    const counts = countKinds(applied);
    if (applied.length || plan.firstSync) {
      project.wordLink.history = [{ at: Date.now(), summary: summarizeCounts(counts), counts, file: fileInfo.name || project.wordLink.fileName, first: plan.firstSync }, ...project.wordLink.history].slice(0, 20);
    }
    log.text = applied.length ? `Synced with Word: ${applied.length} change${applied.length === 1 ? '' : 's'}` : 'Linked to a Word file';
  }, { activity: activity ? log : undefined, source: 'word-sync' });
  try { await store.flush(); } catch (err) { console.warn('[word] flush failed', err); }
  const counts = countKinds(applied);
  return { count: applied.length, counts, summary: summarizeCounts(counts), backup: backupRecord, applied, switchedStorage: !!plan.switchedStorage, failedImages: plan.failedImages || 0 };
}
