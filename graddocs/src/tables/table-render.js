// Table renderers shared by the editor, Document Preview and the exporters.
//   renderTableHTML(project, table, { caption, forWord }) → HTML string (a <table>, optionally with its caption)
//   renderTableSVG(project, table, { width, caption })    → { svg, width, height } (standalone SVG, white background)
//   tableToCSV(table) / tableToTSV(table)                 → text
//   captionParts / renderCaptionHTML                      → caption pieces according to Settings → Captions
//   renderTableMiniHTML(table, { rows, cols })            → tiny HTML preview for lists and galleries
//
// Header rows are bold unless a cell has bold:false; body cells are bold only when bold:true.
import { getNumbering } from '../core/numbering.js';
import { esc } from '../ui/dom.js';
import { fontStack, layoutText, textSVG, xmlEscape } from '../figures/text-layout.js';
import { isCellBold, rectToTSV } from './table-ops.js';

const INK = '#000000';
const ZEBRA = '#F2F2F2';
const PAD_V_PT = 3.75; // ≈ 5px
const PAD_H_PT = 5.25; // ≈ 7px

const typo = (project) => project?.settings?.typography || {};
const fontFamilyOf = (project) => typo(project).fontFamily || 'Times New Roman';
const tableStyle = (table) => {
  const s = table.style || {};
  return {
    fill: s.headerFill || '#D9E2F3',
    ink: s.headerTextColor || '#000000',
    size: Number(s.fontSize) > 0 ? Number(s.fontSize) : 11,
    zebra: !!s.zebra,
    borders: s.borders === 'horizontal' ? 'horizontal' : 'all',
  };
};

/** Width of the text area of the page in CSS pixels (A4/Letter, orientation and margins from Settings). */
export function pageTextWidthPx(project) {
  const page = project?.settings?.page || {};
  const letter = page.size === 'Letter';
  const w = page.orientation === 'landscape' ? (letter ? 27.94 : 29.7) : (letter ? 21.59 : 21);
  const m = page.margins || {};
  const cm = Math.max(5, w - (Number(m.left) || 0) - (Number(m.right) || 0));
  return (cm / 2.54) * 96;
}

// ---------------------------------------------------------------------------
// Captions

/** { label: 'Table 1:', title, cfg } — mirrors captionText() in core/numbering.js but keeps the parts apart. */
export function captionParts(project, table) {
  const cfg = project.settings.captions.table;
  const n = getNumbering(project).tables.get(table.id);
  const sep = cfg.separator === ' —' ? ' —' : cfg.separator;
  return { label: `${n ? n.label : `${cfg.label} ?`}${sep}`, title: table.title || '', cfg };
}

export function renderCaptionHTML(project, table, { forWord = false } = {}) {
  const { label, title, cfg } = captionParts(project, table);
  const above = cfg.position !== 'below';
  const size = Number(typo(project).fontSize) || 12;
  const style = [
    `margin:${above ? '0 0 6pt 0' : '6pt 0 0 0'}`,
    `text-align:${cfg.align || 'center'}`,
    `font-family:${fontStack(fontFamilyOf(project))}`,
    `font-size:${size}pt`,
    above ? 'page-break-after:avoid' : 'page-break-before:avoid',
  ].join(';');
  const l = cfg.labelBold ? `<b>${esc(label)}</b>` : esc(label);
  const t = cfg.titleItalic ? `<i>${esc(title)}</i>` : esc(title);
  return `<p${forWord ? ' class="MsoCaption"' : ''} style="${style}">${l} ${t}</p>`;
}

// ---------------------------------------------------------------------------
// HTML

function cellInner(cell, bold) {
  const body = esc(cell.text ?? '').replace(/\r?\n/g, '<br>');
  const html = body === '' ? '&nbsp;' : body;
  return bold ? `<b>${html}</b>` : html;
}

export function renderTableHTML(project, table, { caption = false, forWord = false } = {}) {
  const st = tableStyle(table);
  const family = fontFamilyOf(project);
  const line = '1px solid black';
  const border = st.borders === 'all'
    ? `border:${line}`
    : `border-top:${line};border-bottom:${line};border-left:none;border-right:none`;
  const pad = `padding:${PAD_V_PT}pt ${PAD_H_PT}pt`;
  const total = table.columns.reduce((a, c) => a + (Number(c.width) || 0), 0) || 100;
  const pct = table.columns.map((c) => Math.round(((Number(c.width) || 0) / total) * 10000) / 100);
  const header = Math.min(table.headerRows || 0, table.rows.length);

  const renderRow = (row, r) => {
    const isHeader = r < header;
    const bodyIndex = r - header;
    const cells = [];
    row.forEach((cell, c) => {
      if (cell.hidden) return;
      const bold = isCellBold(table, r, cell);
      const cs = Math.max(1, Number(cell.colspan) || 1); const rs = Math.max(1, Number(cell.rowspan) || 1);
      const styles = [border, pad, `text-align:${cell.align || 'left'}`, `vertical-align:${isHeader ? 'middle' : 'top'}`];
      if (isHeader) styles.push(`background-color:${st.fill}`, `color:${st.ink}`);
      else if (st.zebra && bodyIndex % 2 === 1) styles.push(`background-color:${ZEBRA}`);
      if (bold) styles.push('font-weight:bold'); else if (isHeader) styles.push('font-weight:normal');
      if (cell.italic) styles.push('font-style:italic');
      if (r === 0) {
        const w = pct.slice(c, c + cs).reduce((a, b) => a + b, 0);
        styles.push(`width:${Math.round(w * 100) / 100}%`);
      }
      const attrs = [
        cs > 1 ? ` colspan="${cs}"` : '', rs > 1 ? ` rowspan="${rs}"` : '',
        isHeader ? ` scope="col"` : '',
        forWord && isHeader ? ` bgcolor="${st.fill}"` : '',
        forWord && r === 0 ? ` width="${Math.round(pct.slice(c, c + cs).reduce((a, b) => a + b, 0))}%"` : '',
      ].join('');
      const tag = isHeader ? 'th' : 'td';
      const inner = cell.italic ? `<i>${cellInner(cell, bold)}</i>` : cellInner(cell, bold);
      cells.push(`<${tag}${attrs} style="${styles.join(';')}">${inner}</${tag}>`);
    });
    return `<tr>${cells.join('')}</tr>`;
  };

  const head = header ? `<thead>${table.rows.slice(0, header).map((row, r) => renderRow(row, r)).join('')}</thead>` : '';
  const body = `<tbody>${table.rows.slice(header).map((row, i) => renderRow(row, i + header)).join('')}</tbody>`;
  const colgroup = `<colgroup>${pct.map((w) => `<col width="${w}%" style="width:${w}%">`).join('')}</colgroup>`;
  const tableStyleAttr = `border-collapse:collapse;table-layout:fixed;width:100%;font-family:${fontStack(family)};font-size:${st.size}pt;color:${INK}`;
  const html = `<table${forWord ? ' cellspacing="0" cellpadding="0"' : ''} style="${tableStyleAttr}">${colgroup}${head}${body}</table>`;
  if (!caption) return html;
  const cap = renderCaptionHTML(project, table, { forWord });
  return project.settings.captions.table.position === 'below' ? html + cap : cap + html;
}

// ---------------------------------------------------------------------------
// SVG

function captionSVG(project, table, { x, y, w, fontPx }) {
  const { label, title, cfg } = captionParts(project, table);
  const family = fontFamilyOf(project);
  const lh = fontPx * 1.25;
  const font = { fontFamily: family, fontSize: fontPx, fontWeight: cfg.labelBold ? 'bold' : 'normal', fontStyle: 'normal' };
  const full = `${label} ${title}`;
  const layout = layoutText(full, font, Math.max(40, w - 8), 1.25);
  const align = cfg.align === 'left' ? 'left' : cfg.align === 'right' ? 'right' : 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const tx = align === 'left' ? x + 2 : align === 'right' ? x + w - 2 : x + w / 2;
  const italic = cfg.titleItalic ? ' font-style="italic"' : '';
  const lines = layout.lines.map((ln, i) => {
    const baseline = Math.round((y + i * lh + lh / 2 + fontPx * 0.34) * 100) / 100;
    let content;
    if (i === 0 && ln.text.startsWith(label)) {
      const rest = ln.text.slice(label.length);
      content = `<tspan${cfg.labelBold ? ' font-weight="bold"' : ''}>${xmlEscape(label)}</tspan><tspan${italic}>${xmlEscape(rest)}</tspan>`;
    } else content = `<tspan${italic}>${xmlEscape(ln.text)}</tspan>`;
    return `<text x="${tx}" y="${baseline}" text-anchor="${anchor}" font-family="${xmlEscape(fontStack(family))}" font-size="${fontPx}" fill="${INK}" xml:space="preserve">${content}</text>`;
  });
  return { svg: lines.join(''), height: Math.ceil(layout.lines.length * lh) };
}

/**
 * Standalone SVG of the table. `width` is the image width in px; text is scaled so the
 * result matches the page: a 680px image at full text width has the same proportions as the document.
 */
export function renderTableSVG(project, table, { width = 680, caption = false } = {}) {
  const st = tableStyle(table);
  const family = fontFamilyOf(project);
  const scale = width / pageTextWidthPx(project);
  const fontPx = Math.round(((st.size * 96) / 72) * scale * 100) / 100;
  const padV = (PAD_V_PT * 96 / 72) * scale; const padH = (PAD_H_PT * 96 / 72) * scale;
  const margin = 1;
  const innerW = width - margin * 2;
  const header = Math.min(table.headerRows || 0, table.rows.length);
  const nRows = table.rows.length; const nCols = table.columns.length;

  // Column boundaries (rounded to whole pixels so borders stay crisp).
  const total = table.columns.reduce((a, c) => a + (Number(c.width) || 0), 0) || 100;
  const xs = [margin]; let acc = 0;
  table.columns.forEach((c, i) => {
    acc += ((Number(c.width) || 0) / total) * innerW;
    xs.push(i === nCols - 1 ? margin + innerW : margin + Math.round(acc));
  });

  const fontFor = (r, cell) => ({
    fontFamily: family, fontSize: fontPx,
    fontWeight: isCellBold(table, r, cell) ? 'bold' : 'normal',
    fontStyle: cell.italic ? 'italic' : 'normal',
  });

  // Row heights grow to fit wrapped text; spanning cells push the last spanned row if needed.
  const minH = Math.ceil(fontPx * 1.2 + padV * 2);
  const heights = Array(nRows).fill(minH);
  const spanning = [];
  table.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.hidden) return;
    const cs = Math.max(1, Math.min(Number(cell.colspan) || 1, nCols - c)); const rs = Math.max(1, Math.min(Number(cell.rowspan) || 1, nRows - r));
    const w = xs[c + cs] - xs[c];
    const need = Math.ceil(layoutText(cell.text ?? '', fontFor(r, cell), Math.max(4, w - padH * 2), 1.2).height + padV * 2);
    if (rs === 1) heights[r] = Math.max(heights[r], need); else spanning.push({ r, rs, need });
  }));
  spanning.sort((a, b) => a.rs - b.rs).forEach(({ r, rs, need }) => {
    const have = heights.slice(r, r + rs).reduce((a, b) => a + b, 0);
    if (have < need) heights[r + rs - 1] += need - have;
  });
  const ys = [0]; heights.forEach((h) => ys.push(ys[ys.length - 1] + h));

  // Optional caption above / below.
  const capFont = Math.round(((Number(typo(project).fontSize) || 12) * 96 / 72) * scale * 100) / 100;
  const gap = Math.round(8 * scale);
  let top = margin; let capAbove = ''; let capBelow = ''; let height;
  const tableH = ys[ys.length - 1];
  if (caption) {
    const above = project.settings.captions.table.position !== 'below';
    if (above) {
      const cap = captionSVG(project, table, { x: margin, y: margin, w: innerW, fontPx: capFont });
      capAbove = cap.svg; top = margin + cap.height + gap; height = top + tableH + margin;
    } else {
      const cap = captionSVG(project, table, { x: margin, y: top + tableH + gap, w: innerW, fontPx: capFont });
      capBelow = cap.svg; height = top + tableH + gap + cap.height + margin;
    }
  } else height = top + tableH + margin;

  const fills = []; const borders = []; const texts = [];
  table.rows.forEach((row, r) => row.forEach((cell, c) => {
    if (cell.hidden) return;
    const cs = Math.max(1, Math.min(Number(cell.colspan) || 1, nCols - c)); const rs = Math.max(1, Math.min(Number(cell.rowspan) || 1, nRows - r));
    const x = xs[c]; const x2 = xs[c + cs]; const y = top + ys[r]; const y2 = top + ys[r + rs];
    const isHeader = r < header;
    const fill = isHeader ? st.fill : (st.zebra && (r - header) % 2 === 1 ? ZEBRA : null);
    if (fill) fills.push(`<rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}" fill="${fill}"/>`);
    if (st.borders === 'all') borders.push(`M${x + 0.5} ${y + 0.5}H${x2 - 0.5}V${y2 - 0.5}H${x + 0.5}Z`);
    else borders.push(`M${x} ${y + 0.5}H${x2}M${x} ${y2 - 0.5}H${x2}`);
    if (String(cell.text ?? '') !== '') {
      const f = fontFor(r, cell);
      const inset = padH - padV; // textSVG applies one padding to both axes
      texts.push(textSVG(cell.text, { x, y: y - inset, w: x2 - x, h: y2 - y + inset * 2 }, {
        fontFamily: family, fontSize: fontPx, fontWeight: f.fontWeight, fontStyle: f.fontStyle,
        textColor: isHeader ? st.ink : INK, align: cell.align || 'left', vAlign: isHeader ? 'middle' : 'top',
      }, { padding: padH }));
    }
  }));

  const w = Math.round(width); const h = Math.ceil(height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="#ffffff"/>${capAbove}`
    + `<g>${fills.join('')}</g>`
    + `<path d="${borders.join('')}" fill="none" stroke="${INK}" stroke-width="1" shape-rendering="crispEdges"/>`
    + `<g>${texts.join('')}</g>${capBelow}</svg>`;
  return { svg, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Text formats

/** RFC 4180 CSV (CRLF line endings, quotes doubled). Cells covered by a merge are exported empty. */
export function tableToCSV(table) {
  const q = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return table.rows.map((row) => row.map((c) => q(c.hidden ? '' : String(c.text ?? ''))).join(',')).join('\r\n');
}

/** Tab-separated text (pastes into Excel, Word and plain-text editors). */
export function tableToTSV(table) {
  return rectToTSV(table, { r1: 0, c1: 0, r2: table.rows.length - 1, c2: table.columns.length - 1 });
}

// ---------------------------------------------------------------------------
// Mini preview (lists, template gallery, version history)

export function renderTableMiniHTML(table, { rows = 4, cols = 4 } = {}) {
  const st = tableStyle(table);
  const nCols = Math.max(1, Math.min(cols, table.columns.length));
  const nRows = Math.max(1, Math.min(rows, table.rows.length));
  const sum = table.columns.slice(0, nCols).reduce((a, c) => a + (Number(c.width) || 1), 0) || 1;
  const colgroup = table.columns.slice(0, nCols).map((c) => `<col style="width:${(((Number(c.width) || 1) / sum) * 100).toFixed(2)}%">`).join('');
  const header = table.headerRows || 0;
  const trs = [];
  for (let r = 0; r < nRows; r += 1) {
    const tds = [];
    for (let c = 0; c < nCols; c += 1) {
      const cell = table.rows[r][c];
      if (cell.hidden) continue;
      const cs = Math.min(Math.max(1, Number(cell.colspan) || 1), nCols - c); const rs = Math.min(Math.max(1, Number(cell.rowspan) || 1), nRows - r);
      const isHeader = r < header;
      const style = [isHeader ? `background:${st.fill};color:${st.ink}` : (st.zebra && (r - header) % 2 === 1 ? `background:${ZEBRA}` : ''),
        cell.align ? `text-align:${cell.align}` : ''].filter(Boolean).join(';');
      const text = String(cell.text ?? '').replace(/\s+/g, ' ').trim();
      tds.push(`<td${cs > 1 ? ` colspan="${cs}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}${isHeader ? ' class="h"' : ''}${style ? ` style="${style}"` : ''}>${esc(text)}</td>`);
    }
    trs.push(`<tr>${tds.join('')}</tr>`);
  }
  return `<table class="tbl-mini${st.borders === 'horizontal' ? ' horizontal' : ''}"><colgroup>${colgroup}</colgroup><tbody>${trs.join('')}</tbody></table>`;
}
