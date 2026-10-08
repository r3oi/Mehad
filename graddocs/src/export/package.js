// Documentation package: one zip with the Word document, every figure and table in the formats
// people actually need, printable lists and a full project backup.
import { getNumbering } from '../core/numbering.js';
import { buildDocument } from '../core/document.js';
import { slugify, pad, clamp } from '../core/utils.js';
import { t } from '../i18n/index.js';
import { renderFigureSVG } from '../figures/render.js';
import { renderTableHTML, renderTableSVG, tableToCSV, pageTextWidthPx } from '../tables/table-render.js';
import { svgToPngBlob } from './png.js';
import { createZip } from './zip.js';
import { buildDocx } from './docx.js';
import {
  wrapHTMLDocument, tocHTML, listOfFiguresHTML, listOfTablesHTML, acronymsHTML, referencesHTML, structureHTML,
} from './print.js';

const pad2 = (n) => pad(n, 2);
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// ---------------------------------------------------------------------------
// Naming and settings helpers (shared with the export view)

/** "Figure-01-feature-fishbone-diagram" — numbering label + 2-digit index + slug of the title. */
export function figureFileBase(project, figure) {
  const info = getNumbering(project).figures.get(figure.id);
  const label = slugify(project.settings?.captions?.figure?.label || 'Figure', 20);
  return `${label}-${pad2(info?.index ?? 0)}-${slugify(figure.title, 48)}`;
}

export function tableFileBase(project, table) {
  const info = getNumbering(project).tables.get(table.id);
  const label = slugify(project.settings?.captions?.table?.label || 'Table', 20);
  return `${label}-${pad2(info?.index ?? 0)}-${slugify(table.title, 48)}`;
}

/** Raster scale for exported PNGs (Settings → Figure defaults → export scale), default 3. */
export const exportScale = (project) => clamp(Number(project.settings?.figureDefaults?.exportScale) || 3, 1, 8);

/** Figure SVG honouring the "transparent background" setting. */
export function figureSVG(project, figure) {
  const transparent = !!project.settings?.figureDefaults?.transparentBackground;
  return renderFigureSVG(figure, { background: transparent ? null : '#ffffff' });
}

/** Table SVG at the width of the page's text area (so it lands at the right size in Word). */
export function tableSVG(project, table) {
  return renderTableSVG(project, table, { width: Math.max(320, Math.round(pageTextWidthPx(project))), caption: false });
}

/** Table as a complete HTML page (caption + Word-friendly markup), ready to open and copy from. */
export function tableHTMLDocument(project, table) {
  const body = renderTableHTML(project, table, { caption: true, forWord: true });
  return wrapHTMLDocument(table.title || 'Table', body, project.settings);
}

/** The bibliography as plain text, one "[1] Author, “Title”, …" line per entry in the order of the References page ('' when empty). */
export function referencesText(project) {
  return buildDocument(project).references.entries.map((e) => `${e.label} ${e.text}`).join('\n');
}

/** Orderly figure list (document order) with its numbering info. */
export function orderedFigures(project) { return buildDocument(project).figures; }
export function orderedTables(project) { return buildDocument(project).tables; }

// ---------------------------------------------------------------------------
// Figures

/** Rasterise one figure → { svg, width, height, png: Blob }. */
export async function renderFigureAssets(project, figure) {
  const { svg, width, height } = figureSVG(project, figure);
  const png = await svgToPngBlob(svg, width, height, { scale: exportScale(project) });
  return { svg, width, height, png };
}

/** Map(figureId → { png: Uint8Array, width, height }) for buildDocx. */
export async function figureImagesForDocx(project, { onProgress } = {}) {
  const map = new Map();
  const figures = orderedFigures(project);
  let done = 0;
  for (const entry of figures) {
    try {
      const { width, height, png } = await renderFigureAssets(project, entry.figure);
      map.set(entry.id, { png: await bytesOf(png), width, height });
    } catch (err) {
      console.warn('[export] could not rasterise', entry.figure.title, err); // the .docx shows a placeholder
    }
    done += 1;
    onProgress?.({ label: t('Rendering figures ({done}/{total})', { done, total: figures.length }), value: done / Math.max(1, figures.length) });
  }
  return map;
}

/** Zip with every figure as SVG + PNG. */
export async function buildFiguresZip(project, { onProgress } = {}) {
  const files = [];
  const figures = orderedFigures(project);
  let done = 0;
  for (const entry of figures) {
    const base = figureFileBase(project, entry.figure);
    const { svg, png } = await renderFigureAssets(project, entry.figure);
    files.push({ path: `${base}.svg`, data: svg }, { path: `${base}.png`, data: png });
    done += 1;
    onProgress?.({ label: t('Rendering figures ({done}/{total})', { done, total: figures.length }), value: done / Math.max(1, figures.length) });
  }
  if (!files.length) throw new Error(t('This project has no figures yet.'));
  return createZip(files);
}

// ---------------------------------------------------------------------------
// Whole package

function readme(project, doc, stamp) {
  const f = doc.figures.length; const tbl = doc.tables.length;
  return `GradDocs documentation package
==============================

Project:   ${project.name}
Type:      ${project.type || '-'}
Exported:  ${stamp}
Contents:  ${project.chapters.length} chapters, ${f} figures, ${tbl} tables, ${doc.acronyms.length} acronyms

WHAT IS IN THIS ZIP
-------------------
documentation.docx      The whole report as an editable Word document: title page, front matter,
                        chapters, numbered figures and tables, captions and cross-references.
figures/                Every figure as a vector SVG and a high-resolution PNG
                        (${exportScale(project)}x, with the DPI stored in the file so Word inserts it at the right size).
tables/                 Every table as SVG, PNG, HTML (paste-ready for Word) and CSV (opens in Excel).
lists/                  Table of contents, list of figures, list of tables, list of acronyms${doc.references.entries.length ? ', the references' : ''}
                        and the document structure as HTML. Open them in a browser and print / "Save as PDF".
${doc.references.entries.length ? `references.txt          The references as plain text, one "[1] …" line per entry (same order as in the report).
` : ''}project.json            A complete backup of the project. Use Export > Import Project in GradDocs to restore it.
README.txt              This file.

HOW TO USE IT IN WORD
---------------------
1. Open documentation.docx. Word asks whether to update the fields in the document: choose Yes.
   This fills in the page numbers of the table of contents and of the lists of figures and tables.
   If you skipped it, press Ctrl+A and then F9 (Mac: Fn+F9) and choose "Update entire table".
2. Insert a figure into another Word file: Insert > Pictures > This Device, then pick
   figures/Figure-NN-....png. Prefer SVG when you want a sharp, resizable image in Microsoft 365.
3. Insert a table: open tables/Table-NN-....html in your browser, select the table, copy it and paste it
   into Word (formatting is kept). Or use "Copy for Word" on the GradDocs Export page.
4. Figure and table numbers in documentation.docx are Word fields (SEQ) and the references in the text
   are cross-reference fields (REF). After you move or add captions, press F9 to renumber them.

Generated by GradDocs.
`;
}

/**
 * buildPackage(project, { onProgress({ label, value }) }) → Promise<Blob> (application/zip)
 */
export async function buildPackage(project, { onProgress } = {}) {
  const doc = buildDocument(project);
  const stamp = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const total = doc.figures.length + doc.tables.length + 3;
  let step = 0;
  const tick = (label) => { step += 1; onProgress?.({ label, value: Math.min(0.97, step / total) }); };
  const files = [];
  const images = new Map();

  onProgress?.({ label: t('Preparing…'), value: 0.01 });
  for (const entry of doc.figures) {
    const base = figureFileBase(project, entry.figure);
    const { svg, width, height, png } = await renderFigureAssets(project, entry.figure);
    files.push({ path: `figures/${base}.svg`, data: svg }, { path: `figures/${base}.png`, data: png });
    images.set(entry.id, { png: await bytesOf(png), width, height });
    tick(t('Rendering {label}', { label: entry.label }));
  }

  for (const entry of doc.tables) {
    const base = tableFileBase(project, entry.table);
    const { svg, width, height } = tableSVG(project, entry.table);
    const png = await svgToPngBlob(svg, width, height, { scale: exportScale(project) });
    files.push(
      { path: `tables/${base}.svg`, data: svg },
      { path: `tables/${base}.png`, data: png },
      { path: `tables/${base}.html`, data: tableHTMLDocument(project, entry.table) },
      { path: `tables/${base}.csv`, data: `﻿${tableToCSV(entry.table)}` },
    );
    tick(t('Rendering {label}', { label: entry.label }));
  }

  const settings = project.settings;
  files.push(
    { path: 'lists/table-of-contents.html', data: wrapHTMLDocument('Table of Contents', tocHTML(project), settings) },
    { path: 'lists/list-of-figures.html', data: wrapHTMLDocument('List of Figures', listOfFiguresHTML(project), settings) },
    { path: 'lists/list-of-tables.html', data: wrapHTMLDocument('List of Tables', listOfTablesHTML(project), settings) },
    { path: 'lists/list-of-acronyms.html', data: wrapHTMLDocument('List of Acronyms and Abbreviations', acronymsHTML(project), settings) },
    ...(doc.references.entries.length ? [{ path: 'lists/references.html', data: wrapHTMLDocument('References', referencesHTML(project), settings) }] : []),
    { path: 'lists/document-structure.html', data: wrapHTMLDocument(`Document Structure - ${project.name}`, structureHTML(project), settings) },
  );
  tick(t('Building lists'));

  onProgress?.({ label: t('Building the Word document…'), value: Math.min(0.97, step / total) });
  files.push({ path: 'documentation.docx', data: await buildDocx(project, { figureImages: images }) });
  tick(t('Building the Word document'));

  if (doc.references.entries.length) files.push({ path: 'references.txt', data: `\uFEFF${referencesText(project)}\n` });
  files.push(
    { path: 'project.json', data: JSON.stringify(project, null, 2) },
    { path: 'README.txt', data: readme(project, doc, stamp) },
  );
  onProgress?.({ label: t('Compressing…'), value: 0.98 });
  const zip = await createZip(files);
  onProgress?.({ label: t('Done'), value: 1 });
  return zip;
}
