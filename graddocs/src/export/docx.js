// Word (.docx) export: builds a real Office Open XML package from the linear document model
// (core/document.js) and the project settings, with native styles, Heading 1-4 (so Word's TOC
// picks them up), SEQ / REF / TOC fields, native tables and inline PNG figures.
import { buildDocument } from '../core/document.js';
import { getNumbering } from '../core/numbering.js';
import { REF_RE, refInfo } from '../core/references.js';
import { DEFAULT_SETTINGS } from '../core/model.js';
import { createZip } from './zip.js';

// ---------------------------------------------------------------------------
// XML helpers

const cc = (...codes) => String.fromCharCode(...codes);
// Characters that are illegal in XML 1.0 (control characters, U+FFFE/U+FFFF) and lone surrogates.
const ILLEGAL_XML = new RegExp(`[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F${cc(0xfffe, 0xffff)}]|[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]`, 'g');
const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(ILLEGAL_XML, '');
const X = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

const RTL_RE = new RegExp(`[${cc(0x590)}-${cc(0x8ff)}${cc(0xfb1d)}-${cc(0xfdff)}${cc(0xfe70)}-${cc(0xfeff)}]`);
const STRONG_LATIN_RE = new RegExp(`[A-Za-z${cc(0xc0)}-${cc(0x24f)}]`);
/** True when the first strong character of `text` is right-to-left (Arabic / Hebrew …). */
export function isRtlText(text) {
  const s = String(text || '');
  for (const ch of s) {
    if (RTL_RE.test(ch)) return true;
    if (STRONG_LATIN_RE.test(ch)) return false;
  }
  return false;
}

const hex = (value, fallback) => {
  const v = String(value || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(v)) return v.split('').map((c) => c + c).join('').toUpperCase();
  return fallback;
};
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
const half = (pt) => Math.max(2, Math.round(pt * 2));

function rPr(o = {}) {
  let x = '';
  if (o.font) { const f = X(o.font); x += `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`; }
  if (o.bold) x += '<w:b/><w:bCs/>';
  if (o.italic) x += '<w:i/><w:iCs/>';
  if (o.caps) x += '<w:caps/>';
  if (o.color) x += `<w:color w:val="${o.color}"/>`;
  if (o.size) x += `<w:sz w:val="${half(o.size)}"/><w:szCs w:val="${half(o.size)}"/>`;
  if (o.rtl) x += '<w:rtl/>';
  return x ? `<w:rPr>${x}</w:rPr>` : '';
}

/** One run; "\n" becomes <w:br/>, "\t" becomes <w:tab/>. */
function run(text, o = {}) {
  const props = rPr(o);
  let inner = '';
  for (const piece of clean(text).split(/(\n|\t)/)) {
    if (piece === '\n') inner += '<w:br/>';
    else if (piece === '\t') inner += '<w:tab/>';
    else if (piece) inner += `<w:t xml:space="preserve">${X(piece)}</w:t>`;
  }
  return inner ? `<w:r>${props}${inner}</w:r>` : '';
}
const tabRun = (o = {}) => `<w:r>${rPr(o)}<w:tab/></w:r>`;

const fldChar = (type, o) => `<w:r>${rPr(o)}<w:fldChar w:fldCharType="${type}"/></w:r>`;
/** Complex field: begin / instruction / separate / cached result / end. */
function field(instr, resultXml, o = {}) {
  return `${fldChar('begin', o)}<w:r>${rPr(o)}<w:instrText xml:space="preserve"> ${X(instr)} </w:instrText></w:r>${fldChar('separate', o)}${resultXml}${fldChar('end', o)}`;
}

const spacingXml = (s) => (s ? `<w:spacing${Object.entries(s).map(([k, v]) => ` w:${k}="${v}"`).join('')}/>` : '');

/** <w:pPr> with children in schema order. */
function pPr(o = {}) {
  let x = '';
  if (o.style) x += `<w:pStyle w:val="${o.style}"/>`;
  if (o.keepNext) x += '<w:keepNext/>';
  if (o.keepLines) x += '<w:keepLines/>';
  if (o.pageBreakBefore) x += '<w:pageBreakBefore/>';
  if (o.numId != null) x += `<w:numPr><w:ilvl w:val="${o.ilvl || 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`;
  if (o.tabs) x += `<w:tabs>${o.tabs}</w:tabs>`;
  if (o.bidi) x += '<w:bidi/>';
  x += spacingXml(o.spacing);
  if (o.ind) x += `<w:ind${Object.entries(o.ind).map(([k, v]) => ` w:${k}="${v}"`).join('')}/>`;
  if (o.jc) x += `<w:jc w:val="${o.jc}"/>`;
  if (o.outline != null) x += `<w:outlineLvl w:val="${o.outline}"/>`;
  if (o.sectPr) x += o.sectPr;
  return x ? `<w:pPr>${x}</w:pPr>` : '';
}
const para = (inner, o = {}) => `<w:p>${pPr(o)}${inner || ''}</w:p>`;

/** Alignment as stored by the user (visual) → w:jc value, accounting for bidi paragraphs. */
const jcFor = (align, rtl) => {
  if (!align) return undefined;
  if (rtl && align === 'left') return 'right';
  if (rtl && align === 'right') return 'left';
  return align === 'justify' ? 'both' : align;
};

const emptyPara = (o = {}) => para('', o);

// ---------------------------------------------------------------------------

export async function buildDocx(project, { figureImages } = {}) {
  const images = figureImages instanceof Map ? figureImages : new Map(Object.entries(figureImages || {}));
  const settings = { ...DEFAULT_SETTINGS, ...(project.settings || {}) };
  const typo = { ...DEFAULT_SETTINGS.typography, ...(settings.typography || {}) };
  const captionsCfg = {
    figure: { ...DEFAULT_SETTINGS.captions.figure, ...(settings.captions?.figure || {}) },
    table: { ...DEFAULT_SETTINGS.captions.table, ...(settings.captions?.table || {}) },
  };
  const chapterCfg = { ...DEFAULT_SETTINGS.chapterTitle, ...(settings.chapterTitle || {}) };
  const doc = buildDocument(project);
  const numbering = getNumbering(project);

  // ----- Typography & page geometry --------------------------------------
  const font = String(typo.fontFamily || 'Times New Roman');
  const fontSize = num(typo.fontSize, 12);
  const lineSpacing = num(typo.lineSpacing, 1.5);
  const paraAfter = num(typo.paragraphSpacing, 6);
  const sizes = { h1: num(typo.headingSizes?.h1, 18), h2: num(typo.headingSizes?.h2, 16), h3: num(typo.headingSizes?.h3, 14) };
  sizes.h4 = num(typo.headingSizes?.h4, Math.max(fontSize, sizes.h3 - 2));

  const pageCfg = { ...DEFAULT_SETTINGS.page, ...(settings.page || {}) };
  const landscape = pageCfg.orientation === 'landscape';
  const [pageShort, pageLong] = pageCfg.size === 'Letter' ? [12240, 15840] : [11906, 16838];
  const pageW = landscape ? pageLong : pageShort;
  const pageH = landscape ? pageShort : pageLong;
  const cm = (v, d) => Math.round(num(v, d) * 567);
  const mTop = cm(pageCfg.margins?.top, 2.54); const mBottom = cm(pageCfg.margins?.bottom, 2.54);
  const mLeft = cm(pageCfg.margins?.left, 3); const mRight = cm(pageCfg.margins?.right, 2.54);
  const textW = Math.max(2000, pageW - mLeft - mRight);
  const textH = Math.max(2000, pageH - mTop - mBottom);
  const footerDist = Math.max(200, Math.min(708, Math.round(mBottom / 2)));
  const fit = Math.max(0.4, Math.min(1.2, textH / 13900)); // vertical rhythm of the title page
  const sp = (n) => Math.round(n * fit);

  const upperHeadings = chapterCfg.style === 'upper';
  const frontHeading = (title) => (upperHeadings ? String(title || '').toUpperCase() : String(title || ''));

  // ----- State shared by the builders -------------------------------------
  let bmId = 0;
  let drawingId = 0;
  const media = []; // { name, rId, data }
  const bookmark = (name, inner) => { bmId += 1; return `<w:bookmarkStart w:id="${bmId}" w:name="${name}"/>${inner}<w:bookmarkEnd w:id="${bmId}"/>`; };

  const seqId = (kind) => {
    const label = String(captionsCfg[kind].label || '').trim();
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(label) ? label : (kind === 'figure' ? 'Figure' : 'Table');
  };
  const refBookmark = (kind, index) => `_Ref${kind === 'figure' ? 'FIG' : 'TAB'}${index}`;
  const placedFigures = new Set(doc.body.filter((b) => b.type === 'figure').map((b) => b.id));
  const placedTables = new Set(doc.body.filter((b) => b.type === 'table').map((b) => b.id));

  // Bookmarks on headings so the cached table of contents is clickable before Word updates it.
  const tocBookmarks = new Map(doc.toc.map((entry, i) => [entry.id, `_Toc${100000 + i + 1}`]));

  // ----- Inline content ----------------------------------------------------
  /** Text with {{ref:…}} tokens: figure/table refs become REF fields, others plain text. */
  function refRuns(text, o = {}) {
    let out = ''; let last = 0;
    const source = String(text ?? '');
    for (const m of source.matchAll(REF_RE)) {
      out += run(source.slice(last, m.index), o);
      const info = refInfo(project, m[1], m[2]);
      let target = null;
      if (info.ok && m[1] === 'fig' && placedFigures.has(m[2])) target = refBookmark('figure', numbering.figures.get(m[2]).index);
      if (info.ok && m[1] === 'tab' && placedTables.has(m[2])) target = refBookmark('table', numbering.tables.get(m[2]).index);
      out += target ? field(`REF ${target} \\h`, run(info.text, o), o) : run(info.text, o);
      last = m.index + m[0].length;
    }
    return out + run(source.slice(last), o);
  }
  const plainOf = (text) => String(text ?? '').replace(REF_RE, (_, kind, id) => refInfo(project, kind, id).text);

  /** Normal paragraph (or bullet) from model text. */
  function bodyParagraph(block, extra = {}) {
    const rtl = isRtlText(plainOf(block.text));
    const o = { rtl };
    if (block.type === 'bullet') {
      return para(refRuns(block.text, o), { style: 'ListParagraph', numId: 1, bidi: rtl, ...extra });
    }
    return para(refRuns(block.text, o), { bidi: rtl, ...extra });
  }

  // ----- Images --------------------------------------------------------------
  function imageParagraph(figBlock, captionBelow) {
    const img = images.get(figBlock.id);
    const spacing = { before: 120, after: captionBelow ? 60 : 120, line: 240, lineRule: 'auto' };
    if (!img || !img.png) {
      return para(run('[Figure image missing]', { italic: true, color: '888888' }), { jc: 'center', keepNext: captionBelow, spacing });
    }
    const emuPerTwip = 635;
    let cx = Math.max(1, Math.round(num(img.width, 400) * 9525));
    let cy = Math.max(1, Math.round(num(img.height, 300) * 9525));
    const maxW = textW * emuPerTwip;
    const maxH = Math.max(1800, textH - 1800) * emuPerTwip;
    const scale = Math.min(1, maxW / cx, maxH / cy);
    cx = Math.max(1, Math.round(cx * scale)); cy = Math.max(1, Math.round(cy * scale));
    const n = media.length + 1;
    const entry = { name: `image${n}.png`, rId: `rIdImg${n}`, data: img.png };
    media.push(entry);
    drawingId += 1;
    const alt = X(figBlock.caption || '');
    const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="Picture ${drawingId}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${entry.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${entry.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    return para(drawing, { jc: 'center', keepNext: captionBelow, spacing });
  }

  // ----- Captions ------------------------------------------------------------
  function captionParagraph(kind, block, position) {
    const cfg = captionsCfg[kind];
    const info = numbering[kind === 'figure' ? 'figures' : 'tables'].get(block.id);
    const item = kind === 'figure' ? block.figure : block.table;
    const bold = { bold: !!cfg.labelBold };
    const rtl = isRtlText(item.title);
    const id = seqId(kind);
    const numberText = info ? info.number : '?';
    const dot = numberText.lastIndexOf('.');
    let numberXml;
    if (cfg.numbering === 'chapter' && dot > 0) {
      const tail = numberText.slice(dot + 1);
      numberXml = run(numberText.slice(0, dot + 1), bold) + field(`SEQ ${id} \\r ${tail} \\* ARABIC`, run(tail, bold), bold);
    } else {
      numberXml = field(`SEQ ${id} \\* ARABIC`, run(numberText, bold), bold);
    }
    const labelXml = run(`${cfg.label} `, bold) + numberXml;
    const bm = info ? bookmark(refBookmark(kind, info.index), labelXml) : labelXml;
    const title = String(item.title || '').trim();
    const inner = bm + run(cfg.separator || '', bold) + (title ? run(` ${title}`, { italic: !!cfg.titleItalic, rtl }) : '');
    return para(inner, {
      style: 'Caption', keepNext: position === 'above', keepLines: true, bidi: rtl,
      jc: jcFor(cfg.align, rtl) || 'center',
    });
  }

  // ----- Tables --------------------------------------------------------------
  function columnWidths(table) {
    const cols = table.columns;
    const total = cols.reduce((s, c) => s + (Number(c.width) > 0 ? Number(c.width) : 0), 0) || cols.length;
    const fallback = total / cols.length;
    const widths = cols.map((c) => Math.max(360, Math.round(((Number(c.width) > 0 ? Number(c.width) : fallback) / total) * textW)));
    const diff = textW - widths.reduce((a, b) => a + b, 0);
    if (diff) widths[widths.indexOf(Math.max(...widths))] += diff;
    return widths;
  }

  function tableXml(table) {
    const style = { headerFill: '#D9E2F3', headerTextColor: '#000000', fontSize: 11, zebra: false, borders: 'all', ...(table.style || {}) };
    const widths = columnWidths(table);
    const nCols = widths.length;
    const rows = table.rows.length ? table.rows : [widths.map(() => ({ text: '' }))];
    const headerRows = Math.min(rows.length, Math.max(0, Number(table.headerRows) || 0));
    const fill = hex(style.headerFill, 'D9E2F3');
    const headColor = hex(style.headerTextColor, '000000');
    const cellSize = num(style.fontSize, 11);

    // Which grid positions are covered by a merge, and by which origin?
    const covered = new Map();
    rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell || cell.hidden) return;
      const cs = Math.max(1, Math.min(Number(cell.colspan) || 1, nCols - c));
      const rs = Math.max(1, Math.min(Number(cell.rowspan) || 1, rows.length - r));
      for (let i = 0; i < rs; i += 1) for (let j = 0; j < cs; j += 1) if (i || j) covered.set(`${r + i}:${c + j}`, { r, c, i, j, cs, rs });
    }));

    const sz = (n) => Math.round(n);
    const line = (name, val = 4) => `<w:${name} w:val="single" w:sz="${val}" w:space="0" w:color="000000"/>`;
    const none = (name) => `<w:${name} w:val="nil"/>`;
    const borders = style.borders === 'horizontal'
      ? `${line('top', 8)}${none('left')}${line('bottom', 8)}${none('right')}${line('insideH', 4)}${none('insideV')}`
      : `${line('top')}${line('left')}${line('bottom')}${line('right')}${line('insideH')}${line('insideV')}`;

    const cellXml = ({ w, span, vmerge, shade, valign, content }) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${vmerge === 'restart' ? '<w:vMerge w:val="restart"/>' : vmerge === 'continue' ? '<w:vMerge/>' : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}<w:vAlign w:val="${valign}"/></w:tcPr>${content}</w:tc>`;

    let out = '';
    rows.forEach((row, r) => {
      const isHeader = r < headerRows;
      const zebra = !isHeader && style.zebra && (r - headerRows) % 2 === 1;
      const shade = isHeader ? fill : (zebra ? 'F2F2F2' : null);
      let cells = '';
      let c = 0;
      while (c < nCols) {
        const cov = covered.get(`${r}:${c}`);
        const cell = row[c] || { text: '' };
        if (cov && cov.i > 0 && cov.j === 0) {
          // Continuation of a vertically merged cell.
          const w = widths.slice(c, c + cov.cs).reduce((a, b) => a + b, 0);
          cells += cellXml({ w, span: cov.cs, vmerge: 'continue', shade, valign: isHeader ? 'center' : 'top', content: emptyPara({ spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' } }) });
          c += cov.cs;
          continue;
        }
        if (cov) { c += 1; continue; } // covered by a colspan to its left (already counted)
        const cs = cell.hidden ? 1 : Math.max(1, Math.min(Number(cell.colspan) || 1, nCols - c));
        const rs = cell.hidden ? 1 : Math.max(1, Math.min(Number(cell.rowspan) || 1, rows.length - r));
        const w = widths.slice(c, c + cs).reduce((a, b) => a + b, 0);
        const text = plainOf(cell.text);
        const rtl = isRtlText(text);
        const o = { bold: isHeader ? cell.bold !== false : !!cell.bold, italic: !!cell.italic, size: cellSize, color: isHeader ? headColor : undefined, rtl };
        const content = para(run(text, o), {
          bidi: rtl, jc: jcFor(cell.align, rtl) || (rtl ? undefined : 'left'),
          spacing: { before: sz(40), after: sz(40), line: 240, lineRule: 'auto' },
        });
        cells += cellXml({ w, span: cs, vmerge: rs > 1 ? 'restart' : null, shade, valign: isHeader ? 'center' : 'top', content });
        c += cs;
      }
      out += `<w:tr><w:trPr><w:cantSplit/>${isHeader ? '<w:tblHeader/>' : ''}</w:trPr>${cells}</w:tr>`;
    });
    const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${textW}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="29" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="29" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${out}</w:tbl>`;
  }

  const spacerPara = () => para('', { spacing: { before: 0, after: 0, line: 160, lineRule: 'exact' } });

  // ----- Sections -------------------------------------------------------------
  const sectPr = ({ footerRId, fmt, start } = {}) => `<w:sectPr>${footerRId ? `<w:footerReference w:type="default" r:id="${footerRId}"/>` : ''}<w:pgSz w:w="${pageW}" w:h="${pageH}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${mTop}" w:right="${mRight}" w:bottom="${mBottom}" w:left="${mLeft}" w:header="${footerDist}" w:footer="${footerDist}" w:gutter="0"/>${fmt || start ? `<w:pgNumType${fmt ? ` w:fmt="${fmt}"` : ''}${start ? ` w:start="${start}"` : ''}/>` : ''}<w:cols w:space="720"/></w:sectPr>`;
  const sectionBreak = (props) => para('', { spacing: { before: 0, after: 0, line: 240, lineRule: 'auto' }, sectPr: sectPr(props) });

  // ----- Title page -------------------------------------------------------------
  function titlePage() {
    const t = doc.titlePage;
    const out = [];
    const line = (text, o = {}) => {
      if (!String(text || '').trim()) return;
      const rtl = isRtlText(text);
      out.push(para(run(text, { size: o.size, bold: o.bold, italic: o.italic, rtl }), {
        style: o.style, jc: 'center', bidi: rtl, keepNext: true,
        spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 288, lineRule: 'auto' },
      }));
    };
    let first = true;
    const top = (text, o) => { if (!String(text || '').trim()) return; line(text, { ...o, before: first ? sp(600) : 0 }); first = false; };
    top(t.university, { size: 18, bold: true, after: 80 });
    top(t.college, { size: 16, bold: true, after: 80 });
    top(t.department, { size: 14, after: 80 });
    line(t.name, { style: 'Title', size: 28, bold: true, before: sp(first ? 3200 : 2800), after: sp(240) });
    line(t.type, { size: 15, italic: true, after: sp(240) });
    if (t.students.length) {
      line('Prepared by', { size: 12, italic: true, before: sp(1800), after: 80 });
      t.students.forEach((s) => line(s, { size: 14, bold: true, after: 40 }));
    }
    if (t.supervisor) line(`Supervised by: ${t.supervisor}`, { size: 13, before: sp(t.students.length ? 400 : 1800), after: 80 });
    if (t.academicYear) line(t.academicYear, { size: 13, before: sp(500), after: 0 });
    return out;
  }

  // ----- Front matter ------------------------------------------------------------
  const rightTab = `<w:tab w:val="right" w:leader="dot" w:pos="${textW}"/>`;
  const pageHolder = '–';

  function listField(instr, entries, emptyText, style) {
    const o = {};
    if (!entries.length) {
      return [
        para(fldChar('begin', o) + `<w:r><w:instrText xml:space="preserve"> ${X(instr)} </w:instrText></w:r>` + fldChar('separate', o) + run(emptyText, { italic: true }), { style }),
        para(fldChar('end', o), { spacing: { before: 0, after: 0 } }),
      ];
    }
    const out = entries.map((entry, i) => {
      const begin = i === 0 ? `${fldChar('begin', o)}<w:r><w:instrText xml:space="preserve"> ${X(instr)} </w:instrText></w:r>${fldChar('separate', o)}` : '';
      const rtl = isRtlText(entry.text);
      const inner = `${run(entry.text, { rtl })}${tabRun()}${run(pageHolder)}`;
      const linked = entry.anchor ? `<w:hyperlink w:anchor="${entry.anchor}" w:history="1">${inner}</w:hyperlink>` : inner;
      return para(begin + linked, { style: entry.style || style, bidi: rtl });
    });
    out.push(para(fldChar('end', o), { spacing: { before: 0, after: 0 } }));
    return out;
  }

  function frontItem(item, first) {
    const out = [];
    // The first item already starts a fresh page (section break), the others get a page break.
    out.push(para(run(frontHeading(item.title)), { style: 'TOCHeading', pageBreakBefore: !first, bidi: isRtlText(item.title) }));
    if (item.kind === 'toc') {
      const depth = Math.max(1, Math.min(4, Math.round(num(settings.toc?.depth, 3))));
      const entries = doc.toc.map((e) => ({ text: e.text, anchor: tocBookmarks.get(e.id), style: `TOC${Math.min(4, e.level)}` }));
      out.push(...listField(`TOC \\o "1-${depth}" \\h \\z \\u`, entries, 'No table of contents entries found.', 'TOC1'));
    } else if (item.kind === 'lot') {
      const entries = doc.tables.filter((t) => placedTables.has(t.id)).map((t) => ({ text: t.caption, anchor: refBookmark('table', numbering.tables.get(t.id).index) }));
      out.push(...listField(`TOC \\h \\z \\c "${seqId('table')}"`, entries, 'No table of figures entries found.', 'TableofFigures'));
    } else if (item.kind === 'lof') {
      const entries = doc.figures.filter((f) => placedFigures.has(f.id)).map((f) => ({ text: f.caption, anchor: refBookmark('figure', numbering.figures.get(f.id).index) }));
      out.push(...listField(`TOC \\h \\z \\c "${seqId('figure')}"`, entries, 'No table of figures entries found.', 'TableofFigures'));
    } else if (item.kind === 'loa') {
      if (!doc.acronyms.length) out.push(para(run('No acronyms or abbreviations have been defined.', { italic: true })));
      else out.push(acronymTable());
    } else {
      for (const block of item.blocks) out.push(bodyParagraph({ type: block.type === 'li' ? 'bullet' : 'paragraph', text: block.text }));
    }
    return out;
  }

  function acronymTable() {
    const w1 = Math.round(textW * 0.28); const w2 = textW - w1;
    const none = (n) => `<w:${n} w:val="nil"/>`;
    const rows = doc.acronyms.map((a) => {
      const meaning = a.meaning || '';
      const cell = (w, text, o) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${para(run(text, { ...o, rtl: isRtlText(text) }), { jc: 'left', spacing: { before: 40, after: 40, line: 276, lineRule: 'auto' } })}</w:tc>`;
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(w1, a.acronym, { bold: true })}${cell(w2, meaning, {})}</w:tr>`;
    }).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${textW}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(none).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="${w1}"/><w:gridCol w:w="${w2}"/></w:tblGrid>${rows}</w:tbl>`;
  }

  // ----- Body -----------------------------------------------------------------------
  function bodyContent() {
    const out = [];
    let firstBlock = true;
    for (const block of doc.body) {
      const startsSection = firstBlock; firstBlock = false;
      if (block.type === 'chapter') {
        const rtl = isRtlText(block.heading);
        const heading = run(block.heading, { rtl });
        const bm = tocBookmarks.get(block.id);
        out.push(para(bm ? bookmark(bm, heading) : heading, {
          style: block.unassigned ? 'TOCHeading' : 'Heading1', pageBreakBefore: !!chapterCfg.newPage && !startsSection, bidi: rtl,
        }));
      } else if (block.type === 'heading') {
        const level = Math.max(2, Math.min(4, block.level));
        const rtl = isRtlText(block.text);
        const heading = run(block.text, { rtl });
        const bm = tocBookmarks.get(block.id);
        out.push(para(bm ? bookmark(bm, heading) : heading, { style: `Heading${level}`, bidi: rtl }));
      } else if (block.type === 'paragraph' || block.type === 'bullet') {
        out.push(bodyParagraph(block));
      } else if (block.type === 'figure') {
        const position = captionsCfg.figure.position === 'above' ? 'above' : 'below';
        if (position === 'above') { out.push(captionParagraph('figure', block, 'above')); out.push(imageParagraph(block, false)); }
        else { out.push(imageParagraph(block, true)); out.push(captionParagraph('figure', block, 'below')); }
      } else if (block.type === 'table') {
        const position = captionsCfg.table.position === 'below' ? 'below' : 'above';
        if (position === 'above') { out.push(captionParagraph('table', block, 'above')); out.push(tableXml(block.table)); out.push(spacerPara()); }
        else { out.push(tableXml(block.table)); out.push(captionParagraph('table', block, 'below')); }
      }
    }
    if (!out.length) out.push(emptyPara());
    return out;
  }

  // ----- Assemble document.xml -----------------------------------------------------------
  const frontItems = doc.front;
  const bodyXml = [];
  bodyXml.push(...titlePage());
  const hasFront = frontItems.length > 0;
  bodyXml.push(sectionBreak({})); // title page: no footer / number
  if (hasFront) {
    frontItems.forEach((item, i) => bodyXml.push(...frontItem(item, i === 0)));
    bodyXml.push(sectionBreak({ footerRId: 'rIdFooter1', fmt: 'lowerRoman', start: 1 }));
  }
  bodyXml.push(...bodyContent());
  const finalSect = sectPr({ footerRId: 'rIdFooter2', fmt: 'decimal', start: 1 });

  const documentXml = `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${bodyXml.join('')}${finalSect}</w:body></w:document>`;

  // ----- styles.xml -------------------------------------------------------------------------------
  const lineVal = Math.max(240, Math.round(lineSpacing * 240));
  const styles = (() => {
    const fontXml = (f) => `<w:rFonts w:ascii="${X(f)}" w:hAnsi="${X(f)}" w:eastAsia="${X(f)}" w:cs="${X(f)}"/>`;
    const pstyle = ({ id, name, based = 'Normal', next, ui, q = true, ppr = '', rpr = '', hidden = false }) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${based ? `<w:basedOn w:val="${based}"/>` : ''}${next ? `<w:next w:val="${next}"/>` : ''}${ui != null ? `<w:uiPriority w:val="${ui}"/>` : ''}${hidden ? '<w:unhideWhenUsed/>' : ''}${q ? '<w:qFormat/>' : ''}${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
    const black = '<w:color w:val="000000"/>';
    const headSpacing = '<w:spacing w:before="240" w:after="120" w:line="276" w:lineRule="auto"/>';
    const tocBase = (level, indent, extraR = '') => pstyle({
      id: `TOC${level}`, name: `toc ${level}`, next: 'Normal', ui: 39, q: false, hidden: true,
      ppr: `<w:tabs>${rightTab}</w:tabs><w:spacing w:before="${level === 1 ? 120 : 0}" w:after="60" w:line="240" w:lineRule="auto"/><w:ind w:left="${indent}"/><w:jc w:val="left"/>`,
      rpr: extraR,
    });
    const figAlign = captionsCfg.figure.align === 'left' || captionsCfg.figure.align === 'right' ? captionsCfg.figure.align : 'center';
    return `${XML_HEAD}<w:styles xmlns:w="${NS_W}">
<w:docDefaults><w:rPrDefault><w:rPr>${fontXml(font)}<w:sz w:val="${half(fontSize)}"/><w:szCs w:val="${half(fontSize)}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(paraAfter * 20)}" w:line="${lineVal}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>${typo.justify ? '<w:pPr><w:jc w:val="both"/></w:pPr>' : ''}</w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
${pstyle({ id: 'Heading1', name: 'heading 1', next: 'Normal', ui: 9, ppr: `<w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="240" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>`, rpr: `${fontXml(font)}<w:b/><w:bCs/>${black}<w:sz w:val="${half(sizes.h1)}"/><w:szCs w:val="${half(sizes.h1)}"/>` })}
${pstyle({ id: 'Heading2', name: 'heading 2', next: 'Normal', ui: 9, ppr: `<w:keepNext/><w:keepLines/>${headSpacing}<w:jc w:val="left"/><w:outlineLvl w:val="1"/>`, rpr: `${fontXml(font)}<w:b/><w:bCs/>${black}<w:sz w:val="${half(sizes.h2)}"/><w:szCs w:val="${half(sizes.h2)}"/>` })}
${pstyle({ id: 'Heading3', name: 'heading 3', next: 'Normal', ui: 9, ppr: `<w:keepNext/><w:keepLines/>${headSpacing}<w:jc w:val="left"/><w:outlineLvl w:val="2"/>`, rpr: `${fontXml(font)}<w:b/><w:bCs/>${black}<w:sz w:val="${half(sizes.h3)}"/><w:szCs w:val="${half(sizes.h3)}"/>` })}
${pstyle({ id: 'Heading4', name: 'heading 4', next: 'Normal', ui: 9, ppr: `<w:keepNext/><w:keepLines/>${headSpacing}<w:jc w:val="left"/><w:outlineLvl w:val="3"/>`, rpr: `${fontXml(font)}<w:b/><w:bCs/><w:i/><w:iCs/>${black}<w:sz w:val="${half(sizes.h4)}"/><w:szCs w:val="${half(sizes.h4)}"/>` })}
${pstyle({ id: 'Title', name: 'Title', next: 'Normal', ui: 10, ppr: '<w:spacing w:before="0" w:after="240" w:line="288" w:lineRule="auto"/><w:jc w:val="center"/>', rpr: `<w:b/><w:bCs/>${black}<w:sz w:val="56"/><w:szCs w:val="56"/>` })}
${pstyle({ id: 'Caption', name: 'caption', next: 'Normal', ui: 35, ppr: `<w:spacing w:before="120" w:after="160" w:line="240" w:lineRule="auto"/><w:jc w:val="${figAlign}"/>`, rpr: `<w:sz w:val="${half(fontSize)}"/><w:szCs w:val="${half(fontSize)}"/>` })}
${pstyle({ id: 'TOCHeading', name: 'TOC Heading', next: 'Normal', ui: 39, ppr: `<w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="240" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="9"/>`, rpr: `<w:b/><w:bCs/>${black}<w:sz w:val="${half(sizes.h1)}"/><w:szCs w:val="${half(sizes.h1)}"/>` })}
${tocBase(1, 0, '<w:b/><w:bCs/>')}
${tocBase(2, 220)}
${tocBase(3, 440)}
${tocBase(4, 660)}
${pstyle({ id: 'TableofFigures', name: 'table of figures', next: 'Normal', ui: 99, q: false, hidden: true, ppr: `<w:tabs>${rightTab}</w:tabs><w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/>` })}
${pstyle({ id: 'ListParagraph', name: 'List Paragraph', ui: 34, ppr: '<w:ind w:left="720"/><w:contextualSpacing/>' })}
${pstyle({ id: 'Footer', name: 'footer', ui: 99, q: false, hidden: true, ppr: `<w:tabs><w:tab w:val="center" w:pos="${Math.round(textW / 2)}"/><w:tab w:val="right" w:pos="${textW}"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/>` })}
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
  })();

  // ----- Other parts ---------------------------------------------------------------------------------------
  const settingsXml = `${XML_HEAD}<w:settings xmlns:w="${NS_W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const bulletLevel = (i, ch) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${X(font)}" w:hAnsi="${X(font)}" w:cs="${X(font)}" w:hint="default"/></w:rPr></w:lvl>`;
  const numberingXml = `${XML_HEAD}<w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLevel(0, '•')}${bulletLevel(1, '–')}${bulletLevel(2, '•')}${bulletLevel(3, '–')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

  const footerXml = (cached) => `${XML_HEAD}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}">${para(field('PAGE', run(cached)), { style: 'Footer', jc: 'center' })}</w:ftr>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const creator = doc.titlePage.students.join(', ') || 'GradDocs';
  const coreXml = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(project.name)}</dc:title><dc:subject>${X(project.type)}</dc:subject><dc:creator>${X(creator)}</dc:creator><cp:keywords></cp:keywords><dc:description>${X(project.description)}</dc:description><cp:lastModifiedBy>GradDocs</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const appXml = `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>GradDocs</Application><DocSecurity>0</DocSecurity><Company>${X(project.university)}</Company><AppVersion>16.0000</AppVersion></Properties>`;

  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/><Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/><Override PartName="/word/numbering.xml" ContentType="${CT}.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="${CT}.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;

  const docRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="${REL}/settings" Target="settings.xml"/><Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/><Relationship Id="rIdFooter1" Type="${REL}/footer" Target="footer1.xml"/><Relationship Id="rIdFooter2" Type="${REL}/footer" Target="footer2.xml"/>${media.map((m) => `<Relationship Id="${m.rId}" Type="${REL}/image" Target="media/${m.name}"/>`).join('')}</Relationships>`;

  const files = [
    { path: '[Content_Types].xml', data: contentTypes },
    { path: '_rels/.rels', data: rootRels },
    { path: 'docProps/core.xml', data: coreXml },
    { path: 'docProps/app.xml', data: appXml },
    { path: 'word/document.xml', data: documentXml },
    { path: 'word/styles.xml', data: styles },
    { path: 'word/settings.xml', data: settingsXml },
    { path: 'word/numbering.xml', data: numberingXml },
    { path: 'word/footer1.xml', data: footerXml('i') },
    { path: 'word/footer2.xml', data: footerXml('1') },
    { path: 'word/_rels/document.xml.rels', data: docRels },
    ...media.map((m) => ({ path: `word/media/${m.name}`, data: m.data })),
  ];
  const blob = await createZip(files);
  return new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
