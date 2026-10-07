// WordprocessingML → intermediate document model.
//
//   const parsed = await parseDocx(arrayBuffer, { fileName })
//
//   parsed = {
//     fileName, title, author, titlePage: { name, university, college, department, supervisor, students, academicYear },
//     front:    [{ kind, title, body }],                 // declaration / acknowledgements / abstract / custom (+ generated kinds, no body)
//     acronyms: [{ acronym, meaning }],
//     chapters: [Node],  Node = { depth, title, key, blocks: [Block], children: [Node] }
//     Block  =  { type: 'p' | 'li', text }  |  { type: 'table', table }  |  { type: 'image', image }
//     tables / images: flat lists in document order (blocks point at the same objects)
//     warnings: [{ code, count }],  stats: { chapters, sections, paragraphs, tables, images, acronyms }
//   }
//
// Direction is Word → GradDocs only: nothing here ever writes to the document.
import { readDocx } from './docx-reader.js';
import {
  tidy, normKey, hashOf, asciiDigits, cleanTitle, isChapterLabelOnly, parseCaption, frontKindOf, looksLikeChapter, parseAcronymLine,
} from './text-utils.js';

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  v: 'urn:schemas-microsoft-com:vml',
};
const W = NS.w;

// ---------------------------------------------------------------------------
// Small XML helpers

const isW = (el, name) => el.namespaceURI === W && el.localName === name;
const child = (el, name) => { if (!el) return null; for (const k of el.children) if (isW(k, name)) return k; return null; };
const childrenW = (el, name) => (el ? [...el.children].filter((k) => isW(k, name)) : []);
const wval = (el) => (el ? (el.getAttributeNS(W, 'val') ?? el.getAttribute('w:val')) : null);
const onOff = (el) => { if (!el) return false; const v = wval(el); return !(v === '0' || v === 'false' || v === 'off'); };
const intAttr = (el, name) => { const v = el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`); const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------------------------------------------------------------------------
// Styles & numbering

const HEADING_NAME = /^(?:heading|عنوان|العنوان)\s*([1-9])$/i;

function buildStyles(stylesDoc) {
  const raw = new Map();
  if (stylesDoc) {
    for (const s of stylesDoc.getElementsByTagNameNS(W, 'style')) {
      const id = s.getAttributeNS(W, 'styleId') || s.getAttribute('w:styleId');
      if (!id) continue;
      const pPr = child(s, 'pPr'); const rPr = child(s, 'rPr');
      const numPr = child(pPr, 'numPr');
      raw.set(id, {
        id,
        name: tidy(wval(child(s, 'name')) || id),
        basedOn: wval(child(s, 'basedOn')),
        outline: child(pPr, 'outlineLvl') ? intAttr(child(pPr, 'outlineLvl'), 'val') : null,
        list: numPr ? (child(numPr, 'numId') ? intAttr(child(numPr, 'numId'), 'val') !== 0 : false) : null,
        bold: child(rPr, 'b') ? onOff(child(rPr, 'b')) : null,
        italic: child(rPr, 'i') ? onOff(child(rPr, 'i')) : null,
        jc: child(pPr, 'jc') ? wval(child(pPr, 'jc')) : null,
      });
    }
  }
  const resolved = new Map();
  const resolve = (id) => {
    if (!id) return NONE_STYLE;
    if (resolved.has(id)) return resolved.get(id);
    const own = raw.get(id);
    if (!own) { const s = { ...NONE_STYLE, id, name: id }; resolved.set(id, s); return s; }
    const out = { ...own };
    let cur = own; let depth = 0;
    while (cur.basedOn && depth < 12) {
      const base = raw.get(cur.basedOn);
      if (!base) break;
      for (const k of ['outline', 'list', 'bold', 'italic', 'jc']) if (out[k] === null) out[k] = base[k];
      cur = base; depth += 1;
    }
    const lname = out.name.toLowerCase();
    const hm = HEADING_NAME.exec(lname) || HEADING_NAME.exec(out.id);
    out.headingLevel = hm ? Number(hm[1]) : 0;
    out.isTitle = lname === 'title' || lname === 'subtitle' || out.id === 'Title';
    out.isCaption = lname === 'caption' || out.id === 'Caption';
    out.isToc = /^(toc\s*\d|table of figures|table of authorities|index\s*\d|tof\b)/.test(lname);
    out.isTocHeading = lname === 'toc heading' || out.id === 'TOCHeading';
    out.isListName = /^list\s*(paragraph|bullet|number|continue)/.test(lname);
    resolved.set(id, out);
    return out;
  };
  return resolve;
}
const NONE_STYLE = { id: '', name: '', basedOn: null, outline: null, list: null, bold: null, italic: null, jc: null, headingLevel: 0, isTitle: false, isCaption: false, isToc: false, isTocHeading: false, isListName: false };

/** numId → numFmt of level 0 ('bullet' | 'decimal' | 'none' …) from numbering.xml. */
function buildNumbering(numDoc) {
  const abstract = new Map(); const nums = new Map();
  if (numDoc) {
    for (const a of numDoc.getElementsByTagNameNS(W, 'abstractNum')) {
      const fmts = new Map();
      for (const lvl of childrenW(a, 'lvl')) fmts.set(intAttr(lvl, 'ilvl') ?? 0, wval(child(lvl, 'numFmt')) || 'decimal');
      abstract.set(intAttr(a, 'abstractNumId'), fmts);
    }
    for (const n of numDoc.getElementsByTagNameNS(W, 'num')) nums.set(intAttr(n, 'numId'), intAttr(child(n, 'abstractNumId'), 'val'));
  }
  return (numId, ilvl = 0) => {
    const fmts = abstract.get(nums.get(numId));
    return fmts ? (fmts.get(ilvl) ?? fmts.get(0) ?? null) : null;
  };
}

// ---------------------------------------------------------------------------
// Paragraph / run reading

const EMU_PX = 9525;

/** Alt text → a usable figure title: Word's auto text and file names are dropped. */
function cleanAlt(raw) {
  const t = tidy(String(raw).replace(/\s*Description automatically generated\.?/i, ''));
  if (!t || t.length > 90 || /\.(png|jpe?g|gif|bmp|emf|wmf|svg)$/i.test(t) || /^(picture|image|graphic)\s*\d*$/i.test(t)) return '';
  return t;
}

function readDrawing(drawing, ctx) {
  const blips = drawing.getElementsByTagNameNS(NS.a, 'blip');
  if (!blips.length) { ctx.unsupported += 1; return; }
  const extent = drawing.getElementsByTagNameNS(NS.wp, 'extent')[0];
  const docPr = drawing.getElementsByTagNameNS(NS.wp, 'docPr')[0];
  const cx = Number(extent?.getAttribute('cx')) || 0; const cy = Number(extent?.getAttribute('cy')) || 0;
  for (const blip of blips) {
    const rid = blip.getAttributeNS(NS.r, 'embed') || blip.getAttributeNS(NS.r, 'link');
    if (!rid) continue;
    ctx.images.push({
      rid, linked: !blip.getAttributeNS(NS.r, 'embed'),
      w: blips.length === 1 && cx ? Math.round(cx / EMU_PX) : null, h: blips.length === 1 && cy ? Math.round(cy / EMU_PX) : null,
      descr: cleanAlt(docPr?.getAttribute('descr') || docPr?.getAttribute('title') || ''),
    });
  }
}

function readPict(pict, ctx) {
  const images = pict.getElementsByTagNameNS(NS.v, 'imagedata');
  if (!images.length) { ctx.unsupported += 1; return; }
  for (const im of images) {
    const rid = im.getAttributeNS(NS.r, 'id') || im.getAttributeNS(NS.r, 'embed');
    if (!rid) continue;
    const style = pict.getElementsByTagNameNS(NS.v, 'shape')[0]?.getAttribute('style') || '';
    const wm = /width:\s*([\d.]+)pt/.exec(style); const hm = /height:\s*([\d.]+)pt/.exec(style);
    ctx.images.push({ rid, linked: false, w: wm ? Math.round(Number(wm[1]) * 4 / 3) : null, h: hm ? Math.round(Number(hm[1]) * 4 / 3) : null, descr: '' });
  }
}

function readRunChildren(container, ctx, fmt) {
  for (const k of container.children) {
    if (k.namespaceURI === NS.mc && k.localName === 'AlternateContent') {
      const kids = [...k.children];
      const pick = kids.find((x) => x.localName === 'Choice') || kids.find((x) => x.localName === 'Fallback');
      if (pick) readRunChildren(pick, ctx, fmt);
      continue;
    }
    if (k.namespaceURI !== W) continue;
    switch (k.localName) {
      case 't': {
        const s = k.textContent || '';
        ctx.text += s;
        const n = s.replace(/\s/g, '').length;
        if (n) { ctx.letters += n; if (fmt.bold) ctx.boldLetters += n; if (fmt.italic) ctx.italicLetters += n; }
        break;
      }
      case 'tab': ctx.text += '\t'; break;
      case 'br': { const type = k.getAttributeNS(W, 'type') || k.getAttribute('w:type'); if (type === 'page' || type === 'column') ctx.pageBreak = true; else ctx.text += '\n'; break; }
      case 'cr': ctx.text += '\n'; break;
      case 'noBreakHyphen': ctx.text += '-'; break;
      case 'drawing': readDrawing(k, ctx); break;
      case 'pict': case 'object': readPict(k, ctx); break;
      default: break;
    }
  }
}

function readRun(r, ctx, styleRes, paraStyle) {
  const rPr = child(r, 'rPr');
  if (rPr && onOff(child(rPr, 'vanish'))) return;
  const rs = styleRes(wval(child(rPr, 'rStyle')));
  const bold = child(rPr, 'b') ? onOff(child(rPr, 'b')) : (rs.bold ?? paraStyle.bold ?? false);
  const italic = child(rPr, 'i') ? onOff(child(rPr, 'i')) : (rs.italic ?? paraStyle.italic ?? false);
  readRunChildren(r, ctx, { bold, italic });
}

const INLINE_CONTAINERS = new Set(['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'moveTo', 'dir', 'bdo']);
function walkInline(el, ctx, styleRes, paraStyle) {
  for (const k of el.children) {
    if (k.namespaceURI === NS.mc && k.localName === 'AlternateContent') {
      const options = [...k.children];
      const pick = options.find((x) => x.localName === 'Choice') || options.find((x) => x.localName === 'Fallback');
      if (pick) walkInline(pick, ctx, styleRes, paraStyle);
      continue;
    }
    if (k.namespaceURI !== W) continue;
    if (k.localName === 'r') readRun(k, ctx, styleRes, paraStyle);
    else if (INLINE_CONTAINERS.has(k.localName)) walkInline(k, ctx, styleRes, paraStyle);
    else if (k.localName === 'sdt') walkInline(child(k, 'sdtContent') || k, ctx, styleRes, paraStyle);
  }
}

/** Reads one w:p into a plain object. */
function readParagraph(p, env) {
  const pPr = child(p, 'pPr');
  const st = env.style(wval(child(pPr, 'pStyle')));
  const ctx = { text: '', images: [], unsupported: 0, letters: 0, boldLetters: 0, italicLetters: 0, pageBreak: false };
  walkInline(p, ctx, env.style, st);

  // Heading level: direct outline level > style name "Heading N" > style outline level.
  let level = 0;
  const direct = child(pPr, 'outlineLvl') ? intAttr(child(pPr, 'outlineLvl'), 'val') : null;
  if (direct !== null) level = direct <= 8 ? direct + 1 : 0;
  else level = st.headingLevel || (st.outline !== null && st.outline <= 8 ? st.outline + 1 : 0);
  if (st.isTitle || st.isToc || st.isTocHeading || st.isCaption) level = 0;

  const numPr = child(pPr, 'numPr');
  const numId = child(numPr, 'numId') ? intAttr(child(numPr, 'numId'), 'val') : null;
  let list = false;
  if (numId !== null) list = numId !== 0 && env.numFmt(numId, intAttr(child(numPr, 'ilvl'), 'val') ?? 0) !== 'none';
  else list = st.list === true || st.isListName;

  let jc = child(pPr, 'jc') ? wval(child(pPr, 'jc')) : st.jc;
  const bidi = !!child(pPr, 'bidi') && onOff(child(pPr, 'bidi'));
  if (jc === 'start') jc = bidi ? 'right' : 'left';
  else if (jc === 'end') jc = bidi ? 'left' : 'right';
  // In a right-to-left paragraph Word's left/right mean "start/end": convert to what the reader sees.
  let visual = jc;
  if (bidi && jc === 'left') visual = 'right'; else if (bidi && jc === 'right') visual = 'left';

  const text = ctx.text.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/^[\s]+|[\s]+$/g, '');
  return {
    kind: 'p', styleName: st.name, style: st, level, list, align: visual === 'center' ? 'center' : visual === 'right' ? 'right' : visual === 'left' ? 'left' : null,
    bidi, text: text.replace(/ /g, ' '), allBold: ctx.letters > 0 && ctx.boldLetters >= ctx.letters * 0.98,
    allItalic: ctx.letters > 0 && ctx.italicLetters >= ctx.letters * 0.98,
    images: ctx.images, unsupported: ctx.unsupported, pageBreak: ctx.pageBreak,
  };
}

// ---------------------------------------------------------------------------
// Tables

function percentWidths(widths, n) {
  let w = widths.length === n ? widths.map((x) => Math.max(0, x)) : [];
  let sum = w.reduce((a, b) => a + b, 0);
  if (!sum) { w = Array(n).fill(1); sum = n; }
  const pct = w.map((x) => Math.round((x / sum) * 10000) / 100);
  const drift = Math.round((100 - pct.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (drift) pct[pct.indexOf(Math.max(...pct))] = Math.round((pct[pct.indexOf(Math.max(...pct))] + drift) * 100) / 100;
  return pct;
}

const isShaded = (tcPr) => {
  const shd = child(tcPr, 'shd');
  if (!shd) return false;
  const fill = (shd.getAttributeNS(W, 'fill') || shd.getAttribute('w:fill') || '').toLowerCase();
  return !!fill && fill !== 'auto' && fill !== 'ffffff' && fill !== 'transparent';
};

function readTable(tbl, env) {
  const gridEl = child(tbl, 'tblGrid');
  const gridCols = childrenW(gridEl, 'gridCol').map((c) => intAttr(c, 'w') || 0);
  const images = []; let unsupported = 0;
  const rows = [];
  for (const tr of childrenW(tbl, 'tr')) {
    const trPr = child(tr, 'trPr');
    const items = [];
    const gridBefore = intAttr(child(trPr, 'gridBefore'), 'val') || 0;
    const collectCells = (container) => {
      for (const tc of container.children) {
        if (isW(tc, 'sdt')) { const c = child(tc, 'sdtContent'); if (c) collectCells(c); continue; }
        if (!isW(tc, 'tc')) continue;
        const tcPr = child(tc, 'tcPr');
        const span = Math.max(1, intAttr(child(tcPr, 'gridSpan'), 'val') || 1);
        const vm = child(tcPr, 'vMerge');
        const paras = []; let nested = '';
        for (const k of tc.children) {
          if (isW(k, 'p')) paras.push(readParagraph(k, env));
          else if (isW(k, 'tbl')) nested += `${[...k.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join(' ')}\n`;
        }
        const withText = paras.filter((q) => q.text);
        for (const q of paras) { images.push(...q.images.map((im) => ({ ...im }))); unsupported += q.unsupported; }
        const parts = paras.map((q) => q.text);
        if (nested.trim()) parts.push(nested.trim());
        const text = parts.join('\n').replace(/\n+/g, '\n').trim();
        items.push({
          span, vmerge: vm ? (wval(vm) === 'restart' ? 'restart' : 'continue') : null, shaded: isShaded(tcPr),
          text, bold: withText.length > 0 && withText.every((q) => q.allBold), italic: withText.length > 0 && withText.every((q) => q.allItalic),
          align: paras.find((q) => q.text)?.align || null, width: intAttr(child(tcPr, 'tcW'), 'w') || 0,
        });
      }
    };
    collectCells(tr);
    rows.push({ items, gridBefore, header: !!child(trPr, 'tblHeader') && onOff(child(trPr, 'tblHeader')) });
  }

  const nCols = Math.max(gridCols.length, ...rows.map((r) => r.gridBefore + r.items.reduce((s, it) => s + it.span, 0)), 1);
  const grid = []; const origin = []; // origin[r][c] = [r0, c0] of the anchor cell
  rows.forEach((row, r) => {
    grid[r] = Array.from({ length: nCols }, () => ({ text: '' }));
    origin[r] = Array(nCols).fill(null);
    let c = row.gridBefore;
    for (const it of row.items) {
      if (c >= nCols) break;
      const span = Math.min(it.span, nCols - c);
      let anchor = null;
      if (it.vmerge === 'continue' && r > 0 && origin[r - 1][c]) {
        const [r0, c0] = origin[r - 1][c];
        anchor = grid[r0][c0];
        if (anchor && c0 === c) anchor.rowspan = r - r0 + 1;
        for (let j = 0; j < span; j += 1) { grid[r][c + j] = { text: '', hidden: true }; origin[r][c + j] = [r0, c0]; }
      } else {
        const cell = { text: it.text };
        if (it.bold) cell.bold = true;
        if (it.italic) cell.italic = true;
        if (it.align === 'center' || it.align === 'right') cell.align = it.align;
        if (span > 1) cell.colspan = span;
        grid[r][c] = cell; origin[r][c] = [r, c];
        for (let j = 1; j < span; j += 1) { grid[r][c + j] = { text: '', hidden: true }; origin[r][c + j] = [r, c]; }
      }
      c += span;
    }
  });

  // Header rows: explicit "repeat as header row" first, otherwise a shaded or fully bold first row.
  let headerRows = 0;
  while (headerRows < rows.length && rows[headerRows].header) headerRows += 1;
  if (!headerRows && rows.length >= 2) {
    const first = rows[0].items;
    if (first.length && (first.every((it) => it.shaded) || first.every((it) => it.bold || !it.text))) headerRows = 1;
    if (headerRows && first.every((it) => !it.text)) headerRows = 0;
  }
  headerRows = rows.length >= 2 ? Math.min(headerRows, rows.length - 1) : 0;
  const widths = gridCols.length === nCols && gridCols.some(Boolean) ? gridCols : (() => {
    const w = Array(nCols).fill(0); const first = rows.find((r) => r.items.length === nCols && !r.gridBefore);
    if (first) first.items.forEach((it, i) => { w[i] = it.width; });
    return w;
  })();
  const hasText = grid.some((row) => row.some((cell) => cell.text));
  return {
    kind: 'table', rows: grid, cols: nCols, headerRows, widths: percentWidths(widths, nCols), hasText, images, unsupported,
    shaded: rows[0]?.items.every((it) => it.shaded) || false,
  };
}

// ---------------------------------------------------------------------------
// Document walk

function collectBlocks(container, env, out) {
  for (const k of container.children) {
    if (k.namespaceURI !== W) {
      if (k.namespaceURI === NS.mc && k.localName === 'AlternateContent') { const c = [...k.children].find((x) => x.localName === 'Choice'); if (c) collectBlocks(c, env, out); }
      continue;
    }
    if (k.localName === 'p') out.push(readParagraph(k, env));
    else if (k.localName === 'tbl') out.push(readTable(k, env));
    else if (k.localName === 'sdt') {
      const gallery = k.getElementsByTagNameNS(W, 'docPartGallery')[0];
      const g = wval(gallery) || '';
      if (/table of contents|toc/i.test(g)) { out.push({ kind: 'toc-sdt' }); continue; }
      const content = child(k, 'sdtContent');
      if (content) collectBlocks(content, env, out);
    } else if (k.localName === 'customXml' || k.localName === 'ins') collectBlocks(k, env, out);
  }
}

// ---------------------------------------------------------------------------
// Analysis

const CHAPTER_LIKE_LIMIT = 12;

function titleOfBlock(p) { return tidy(p.text.replace(/\n/g, ' ')); }

function analyze(raw) {
  const warnings = new Map();
  const warn = (code, n = 1) => warnings.set(code, (warnings.get(code) || 0) + n);

  // Pseudo headings: documents that never use heading styles still get a structure (bold, numbered lines).
  if (!raw.some((b) => b.kind === 'p' && b.level > 0)) {
    for (const b of raw) {
      if (b.kind !== 'p' || !b.text || b.text.length > 110 || b.text.includes('\n') || b.list || b.style.isToc || b.style.isCaption || !b.allBold) continue;
      if (/^(chapter|الفصل)\s+\S+/i.test(b.text)) b.level = 1;
      else {
        const m = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+\S/.exec(asciiDigits(b.text));
        if (m && !/[.:;]$/.test(b.text)) b.level = m[1].split('.').length;
      }
    }
    if (raw.some((b) => b.kind === 'p' && b.level > 0)) warn('pseudo-headings');
  }

  const headingBlocks = raw.filter((b) => b.kind === 'p' && b.level > 0 && !frontKindOf(b.text));
  const chapterLevel = headingBlocks.length ? Math.min(...headingBlocks.map((b) => b.level)) : 1;
  const maxDepth = 3; // chapter + Heading 2..4

  const titleLines = [];
  const front = []; const acronyms = [];
  const chapters = [];
  const stack = [];
  let phase = 'title';
  let curFront = null;
  let pendingChapterLabel = false;
  let seenBlocks = 0;
  const laterChapterLike = (from) => raw.slice(from + 1).some((b) => b.kind === 'p' && b.level === chapterLevel && !frontKindOf(b.text) && looksLikeChapter(b.text));
  const mkNode = (depth, rawTitle) => ({ depth, rawTitle, title: '', key: '', blocks: [], children: [] });
  const cur = () => stack[stack.length - 1] || null;

  const startChapter = (rawTitle) => {
    const node = mkNode(0, rawTitle);
    chapters.push(node); stack.length = 0; stack.push(node);
    phase = 'body'; curFront = null;
  };
  const startSection = (depth, rawTitle) => {
    if (depth > stack.length) depth = stack.length; // skipped heading level: attach to the deepest parent
    stack.length = depth;
    const node = mkNode(depth, rawTitle);
    stack[depth - 1].children.push(node); stack.push(node);
  };
  const addAcronymLine = (text) => {
    for (const line of String(text).split('\n')) { const a = parseAcronymLine(line); if (a) acronyms.push(a); }
  };

  raw.forEach((b, index) => {
    if (b.kind === 'toc-sdt') { if (phase === 'title') phase = 'front'; curFront = { kind: 'toc', title: 'Table of Contents', lines: [], generated: true }; front.push(curFront); return; }

    // ----- tables
    if (b.kind === 'table') {
      seenBlocks += 1;
      if (phase === 'front' && curFront?.kind === 'loa') {
        const rows = b.rows.filter((r) => r.some((c) => c.text));
        rows.forEach((r, i) => {
          const [first, second, third] = r.map((c) => c.text);
          if (i === 0 && /^(acronym|abbreviation|abbreviations|acronyms|abbrev\.?|short form|symbol|term|الاختصار|الاختصارات|المختصر|الرمز|المصطلح)$/i.test(tidy(first || '')) && rows.length > 1) return;
          if (first && second) acronyms.push({ acronym: tidy(first), meaning: tidy(second.replace(/\n/g, ' ')) });
          else if (first && !second && third === undefined) addAcronymLine(first);
        });
      } else if (phase === 'body' && cur()) {
        if (b.cols === 1 && b.rows.length === 1) {
          // A one-cell table is a text box / call-out: keep its text.
          for (const line of b.rows[0][0].text.split('\n')) if (line.trim()) cur().blocks.push({ type: 'p', text: tidy(line) });
        } else if (!b.hasText && b.images.length) {
          for (const im of b.images) cur().blocks.push({ type: 'image', ref: im });
        } else {
          if (b.images.length) warn('table-images', b.images.length);
          cur().blocks.push({ type: 'table', table: b });
        }
        if (b.unsupported) warn('drawings', b.unsupported);
      }
      return;
    }

    const p = b;
    if (p.style.isToc) return;
    const text = p.text;
    const flat = titleOfBlock(p);
    const hasImages = p.images.length > 0;
    if (!flat && !hasImages && !p.unsupported) return;
    seenBlocks += 1;

    // ----- front-matter title?
    if (phase !== 'body' && flat && flat.length <= 70) {
      const kind = frontKindOf(flat);
      const formatted = p.level > 0 || p.style.isTocHeading || p.allBold || p.align === 'center' || flat === flat.toUpperCase();
      if (kind && formatted) {
        phase = 'front';
        curFront = { kind, title: flat, lines: [], generated: kind === 'toc' || kind === 'lot' || kind === 'lof' };
        front.push(curFront);
        return;
      }
    }

    // ----- title style
    if (p.style.isTitle) {
      if (phase === 'title') titleLines.push({ text: flat, title: true });
      else if (phase === 'body' && cur() && flat) cur().blocks.push({ type: 'p', text: flat });
      return;
    }

    // ----- headings
    if (p.level > 0 && flat) {
      const depth = p.level - chapterLevel;
      if (depth <= 0) {
        if (pendingChapterLabel && phase === 'body') { cur().rawTitle = `${cur().rawTitle} ${flat}`; pendingChapterLabel = false; return; }
        if (phase === 'title' && !looksLikeChapter(flat) && laterChapterLike(index) && seenBlocks < CHAPTER_LIKE_LIMIT) { titleLines.push({ text: flat, heading: true }); return; }
        if (isChapterLabelOnly(flat)) { startChapter(flat); pendingChapterLabel = true; return; }
        pendingChapterLabel = false;
        startChapter(flat);
        return;
      }
      if (phase === 'body' && depth <= maxDepth) { pendingChapterLabel = false; startSection(depth, flat); return; }
      if (phase === 'title') { titleLines.push({ text: flat, heading: true }); return; }
      // too deep (Heading 5+) or outside a chapter: keep the text as a paragraph.
    }
    if (pendingChapterLabel && phase === 'body' && flat && flat.length < 90 && !p.list && cur()?.blocks.length === 0 && cur().depth === 0 && !parseCaption(flat)) {
      cur().rawTitle = `${cur().rawTitle} ${flat}`; pendingChapterLabel = false; return;
    }
    pendingChapterLabel = false;

    // ----- body content
    if (phase === 'title') { if (flat) titleLines.push({ text: flat, align: p.align, bold: p.allBold }); return; }
    if (phase === 'front') {
      if (!curFront || curFront.generated) return;
      if (curFront.kind === 'loa') { addAcronymLine(text); return; }
      if (flat) curFront.lines.push(p.list ? `- ${flat}` : text.replace(/\s*\n\s*/g, ' ').trim());
      return;
    }
    const node = cur();
    if (!node) return;
    if (p.unsupported) warn('drawings', p.unsupported);
    const cap = flat && (p.style.isCaption || (flat.length <= 220 && parseCaption(flat))) ? parseCaption(flat, { loose: p.style.isCaption }) : null;
    const captionLike = !!cap || (p.style.isCaption && flat);
    if (captionLike) {
      for (const im of p.images) node.blocks.push({ type: 'image', ref: im });
      node.blocks.push({ type: 'cap', kind: cap?.kind || null, number: cap?.number || '', title: cap ? cap.title : flat, text: flat });
      return;
    }
    if (flat) node.blocks.push({ type: p.list ? 'li' : 'p', text: tidy(text.replace(/\n/g, ' ')) });
    for (const im of p.images) node.blocks.push({ type: 'image', ref: im });
  });

  return { titleLines, front, acronyms, chapters, warnings };
}

/** Attach caption paragraphs to the nearest table (usually below) / picture (usually above). */
function associateCaptions(node) {
  const blocks = node.blocks;
  for (let i = 0; i < blocks.length; i += 1) {
    const cap = blocks[i];
    if (cap.type !== 'cap') continue;
    const find = (type, j) => (blocks[j] && blocks[j].type === type && !blocks[j].caption ? blocks[j] : null);
    let target = null;
    if (cap.kind === 'table') target = find('table', i + 1) || find('table', i - 1);
    else if (cap.kind === 'figure') target = find('image', i - 1) || find('image', i + 1);
    else target = find('image', i - 1) || find('table', i + 1) || find('image', i + 1) || find('table', i - 1);
    if (target) {
      target.caption = { kind: target.type === 'table' ? 'table' : 'figure', number: cap.number, title: cap.title };
      blocks.splice(i, 1); i -= 1;
    } else {
      blocks[i] = { type: 'p', text: cap.text };
    }
  }
  node.children.forEach(associateCaptions);
}

// ---------------------------------------------------------------------------

function sniffTitlePage(lines) {
  const info = { university: '', college: '', department: '', supervisor: '', students: '', academicYear: '' };
  const students = [];
  let inStudents = false;
  for (const { text } of lines) {
    const t = tidy(text);
    let m;
    if ((m = /^(?:supervised by|supervisor|under the supervision of|إشراف|بإشراف|المشرف)\s*[:：\-–]?\s*(.*)$/i.exec(t)) && m[1]) { info.supervisor = info.supervisor || m[1]; inStudents = false; continue; }
    if (/^(?:prepared by|submitted by|by|students?|team members?|إعداد|اعداد|من إعداد|الطلاب|الطالب)\s*[:：]?\s*$/i.test(t)) { inStudents = true; continue; }
    if ((m = /^(?:prepared by|submitted by|students?|إعداد|اعداد|من إعداد)\s*[:：\-–]\s*(.+)$/i.exec(t))) { students.push(...m[1].split(/\s*[,;،]\s*|\s+and\s+/i)); continue; }
    if (/^(?:20\d{2}|19\d{2})(?:\s*[-–/]\s*(?:20)?\d{2})?$/.test(asciiDigits(t))) { info.academicYear = asciiDigits(t); inStudents = false; continue; }
    if (!info.university && /\b(university|institute|polytechnic)\b|جامعة|معهد/i.test(t)) { info.university = t; continue; }
    if (!info.college && /\b(college|faculty|school of)\b|كلية/i.test(t)) { info.college = t; continue; }
    if (!info.department && /\bdepartment\b|قسم/i.test(t)) { info.department = t; continue; }
    if (inStudents && t.length < 60 && !/[.:]$/.test(t)) students.push(t);
  }
  info.students = students.map(tidy).filter(Boolean).join('\n');
  return info;
}

/** Walk every node: clean titles, compute stable keys and numbers. */
function finalize(parsed, keep) {
  const visit = (nodes, parentKey, numberPrefix, chapterLevel) => {
    const used = new Map();
    nodes.forEach((node, i) => {
      node.title = cleanTitle(node.rawTitle, { chapter: chapterLevel, keep });
      let k = normKey(node.title) || `untitled-${i + 1}`;
      const n = (used.get(k) || 0) + 1; used.set(k, n);
      if (n > 1) k = `${k}~${n}`;
      node.key = parentKey ? `${parentKey}/${k}` : k;
      node.number = chapterLevel ? String(i + 1) : `${numberPrefix}.${i + 1}`;
      node.wordIndex = i;
      visit(node.children, node.key, node.number, false);
    });
  };
  visit(parsed.chapters, '', '', true);
}

async function loadImages(refs, pkg) {
  const cache = new Map();
  const unique = [];
  for (const ref of refs) {
    const rel = pkg.rels.get(ref.rid);
    if (!rel || rel.external || ref.linked) { ref.missing = true; continue; }
    ref.target = rel.target;
    if (!cache.has(rel.target)) {
      const entry = { target: rel.target };
      cache.set(rel.target, entry);
      unique.push(entry);
    }
    ref.entry = cache.get(rel.target);
  }
  for (const entry of unique) {
    const media = await pkg.media(entry.target);
    if (media) { entry.bytes = media.bytes; entry.mime = media.mime; entry.hash = hashOf(media.bytes); }
  }
  for (const ref of refs) {
    if (!ref.entry?.bytes) { ref.missing = true; continue; }
    ref.bytes = ref.entry.bytes; ref.mime = ref.entry.mime; ref.hash = ref.entry.hash;
  }
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml', 'image/tiff']);

export async function parseDocx(input, { fileName = '' } = {}) {
  const buffer = input instanceof Uint8Array ? input : new Uint8Array(input);
  const pkg = await readDocx(buffer);
  const env = { style: buildStyles(pkg.styles), numFmt: buildNumbering(pkg.numbering) };
  const body = pkg.doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('The Word file has no document body.');
  const raw = [];
  collectBlocks(body, env, raw);

  // Pictures: load bytes for everything referenced, then analyse.
  const refs = [];
  for (const b of raw) {
    if (b.kind === 'p') refs.push(...b.images);
    else if (b.kind === 'table') refs.push(...b.images);
  }
  await loadImages(refs, pkg);

  const a = analyze(raw);
  const warn = (code, n = 1) => a.warnings.set(code, (a.warnings.get(code) || 0) + n);
  for (const node of a.chapters) associateCaptions(node);

  // Acronyms first: their upper-case spellings are kept inside Title Case headings.
  const seenAcr = new Set(); const acronyms = [];
  for (const x of a.acronyms) { const k = normKey(x.acronym); if (!k || seenAcr.has(k)) continue; seenAcr.add(k); acronyms.push({ acronym: x.acronym, meaning: x.meaning }); }
  const keep = new Set(acronyms.map((x) => x.acronym.toUpperCase()));
  finalize({ chapters: a.chapters }, keep);

  // Flatten tables / images in reading order and turn their refs into final objects.
  const tables = []; const images = []; let smallSkipped = 0;
  const visit = (node, chapter) => {
    const kept = [];
    let tableIndex = 0; let imageIndex = 0;
    for (const blk of node.blocks) {
      if (blk.type === 'table') {
        tableIndex += 1;
        const t = blk.table;
        const table = {
          kind: 'table', caption: blk.caption || null, title: blk.caption?.title || '', number: blk.caption?.number || '',
          rows: t.rows, cols: t.cols, headerRows: t.headerRows, widths: t.widths, sectionKey: node.key, index: tableIndex, hasText: t.hasText,
        };
        table.key = table.caption?.title ? `t:${normKey(table.caption.title)}` : `t:${node.key}#${tableIndex}`;
        tables.push(table); kept.push({ type: 'table', table });
      } else if (blk.type === 'image') {
        const ref = blk.ref;
        imageIndex += 1;
        if (ref.missing) { warn('images-missing'); continue; }
        if (!IMAGE_MIMES.has(ref.mime)) { warn('images-unsupported'); continue; }
        if (ref.w && ref.h && ref.w < 40 && ref.h < 40) { smallSkipped += 1; continue; }
        const image = {
          kind: 'image', caption: blk.caption || null, title: blk.caption?.title || '', number: blk.caption?.number || '', mime: ref.mime,
          bytes: ref.bytes, hash: ref.hash, width: ref.w, height: ref.h, descr: ref.descr, sectionKey: node.key, index: imageIndex,
        };
        image.key = image.caption?.title ? `f:${normKey(image.caption.title)}` : `f:${node.key}#${imageIndex}`;
        images.push(image); kept.push({ type: 'image', image });
      } else kept.push(blk);
    }
    node.blocks = kept;
    node.chapter = chapter || node;
    node.children.forEach((c) => visit(c, node.chapter));
  };
  a.chapters.forEach((c) => visit(c, c));
  if (smallSkipped) warn('images-small', smallSkipped);

  // Make caption-based keys unique.
  for (const list of [tables, images]) {
    const used = new Map();
    for (const item of list) { const n = (used.get(item.key) || 0) + 1; used.set(item.key, n); if (n > 1) item.key = `${item.key}~${n}`; }
  }

  // Title page and project name.
  const titleEntries = a.titleLines;
  const titleStyle = titleEntries.find((l) => l.title)?.text;
  const coreTitle = tidy(pkg.core?.title || '');
  const firstHeading = a.chapters[0]?.title || '';
  const baseName = tidy(String(fileName).replace(/\.docx$/i, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - '));
  const generic = /^(document\d*|untitled|new document|microsoft word.*|مستند\d*)$/i;
  const title = titleStyle || (coreTitle && !generic.test(coreTitle) ? coreTitle : '') || titleEntries.find((l) => l.heading)?.text || firstHeading || baseName || 'Untitled Project';
  const titlePage = sniffTitlePage(titleEntries.filter((l) => !l.title));

  // Front matter bodies.
  const frontOut = a.front.map((f) => ({ kind: f.kind, title: cleanTitle(f.title, { keep }), generated: f.generated, body: f.generated ? '' : f.lines.join('\n') }));

  const countNodes = (nodes) => nodes.reduce((n, x) => n + 1 + countNodes(x.children), 0);
  let paragraphs = 0;
  const countP = (nodes) => nodes.forEach((n) => { paragraphs += n.blocks.filter((b) => b.type === 'p' || b.type === 'li').length; countP(n.children); });
  countP(a.chapters);
  if (!a.chapters.length) warn('no-headings');

  return {
    fileName, title: cleanTitle(title, { keep }) || title, rawTitle: title, author: tidy(pkg.core?.creator || ''), titlePage,
    front: frontOut, acronyms, chapters: a.chapters, tables, images,
    warnings: [...a.warnings].map(([code, count]) => ({ code, count })),
    stats: { chapters: a.chapters.length, sections: countNodes(a.chapters) - a.chapters.length, paragraphs, tables: tables.length, images: images.length, acronyms: acronyms.length },
  };
}

