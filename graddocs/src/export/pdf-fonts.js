// Standard-14 font data for the vector PDF writer: Adobe AFM advance widths (1/1000 em) for the
// WinAnsi codes 32..255 of Times, Helvetica and Courier, the Unicode -> WinAnsi byte mapping and the
// CSS font-family -> PDF base font mapping. Pure data/functions, no DOM access.

const T_ROMAN = [
  250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,
  921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,
  556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,
  333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,
  500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,350,
  500,350,333,500,444,1000,500,500,333,1000,556,333,889,350,611,350,
  350,333,333,444,444,350,500,1000,333,980,389,333,722,350,444,722,
  250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,
  400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,
  722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,
  722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,
  444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,
  500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500,
];
const T_BOLD = [
  250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
  930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,
  611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,
  333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,
  556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,350,
  500,350,333,500,500,1000,500,500,333,1000,556,333,1000,350,667,350,
  350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,444,722,
  250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,
  400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,
  722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,
  722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,
  500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,
  500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500,
];
const T_ITALIC = [
  250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,
  920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,
  611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,
  333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,
  500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,350,
  500,350,333,500,556,889,500,500,333,1000,500,333,944,350,556,350,
  350,333,333,556,556,350,500,889,333,980,389,333,667,350,389,556,
  250,389,500,500,500,500,275,500,333,760,276,500,675,333,760,333,
  400,675,300,300,333,500,523,250,333,300,310,500,750,750,750,500,
  611,611,611,611,611,611,889,667,611,611,611,611,333,333,333,333,
  722,667,722,722,722,722,722,675,722,722,722,722,722,556,611,500,
  500,500,500,500,500,500,667,444,444,444,444,444,278,278,278,278,
  500,500,500,500,500,500,500,675,500,500,500,500,500,444,500,444,
];
const T_BOLDITALIC = [
  250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,
  500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,
  832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,
  611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,
  333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,
  500,500,389,389,278,556,444,667,500,444,389,348,220,348,570,350,
  500,350,333,500,500,1000,500,500,333,1000,556,333,944,350,611,350,
  350,333,333,500,500,350,500,1000,333,1000,389,333,722,350,389,611,
  250,389,500,500,500,500,220,500,333,747,266,500,606,333,747,333,
  400,570,300,300,333,576,500,250,333,300,300,500,750,750,750,500,
  667,667,667,667,667,667,944,667,667,667,667,667,389,389,389,389,
  722,722,722,722,722,722,722,570,722,722,722,722,722,611,611,500,
  500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,
  500,556,500,500,500,500,500,570,500,556,556,556,556,444,500,444,
];
const H_REGULAR = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,
  556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,
  350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,
  278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,
  400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,
  667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
  556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,
  556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500,
]; // Helvetica-Oblique uses the same widths
const H_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,
  556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,
  350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,
  278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,
  400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,
  722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
  556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,
  611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556,
]; // Helvetica-BoldOblique uses the same widths

const COURIER_WIDTH = 600;

// ---------------------------------------------------------------------------
// Font selection

/** The 12 standard fonts we use, keyed by `${kind}|${bold}|${italic}`. */
const FONTS = {
  'times|0|0': { base: 'Times-Roman', widths: T_ROMAN },
  'times|1|0': { base: 'Times-Bold', widths: T_BOLD },
  'times|0|1': { base: 'Times-Italic', widths: T_ITALIC },
  'times|1|1': { base: 'Times-BoldItalic', widths: T_BOLDITALIC },
  'helvetica|0|0': { base: 'Helvetica', widths: H_REGULAR },
  'helvetica|1|0': { base: 'Helvetica-Bold', widths: H_BOLD },
  'helvetica|0|1': { base: 'Helvetica-Oblique', widths: H_REGULAR },
  'helvetica|1|1': { base: 'Helvetica-BoldOblique', widths: H_BOLD },
  'courier|0|0': { base: 'Courier', widths: null },
  'courier|1|0': { base: 'Courier-Bold', widths: null },
  'courier|0|1': { base: 'Courier-Oblique', widths: null },
  'courier|1|1': { base: 'Courier-BoldOblique', widths: null },
};

const MONO = new Set(['courier', 'courier new', 'couriernew', 'consolas', 'monaco', 'menlo', 'lucida console', 'liberation mono', 'dejavu sans mono', 'monospace', 'ui-monospace', 'sf mono', 'sfmono-regular', 'fira code', 'fira mono', 'source code pro', 'andale mono', 'cousine', 'freemono', 'roboto mono', 'jetbrains mono', 'cascadia code', 'cascadia mono']);
const SERIF = new Set(['times', 'times new roman', 'timesnewroman', 'times-roman', 'tinos', 'liberation serif', 'cambria', 'caladea', 'georgia', 'serif', 'ui-serif', 'garamond', 'palatino', 'palatino linotype', 'book antiqua', 'bookman', 'bookman old style', 'century', 'century schoolbook', 'constantia', 'didot', 'baskerville', 'noto serif', 'dejavu serif', 'charter', 'merriweather', 'playfair display', 'cormorant', 'libre baskerville', 'lora', 'pt serif', 'source serif pro', 'droid serif', 'freeserif', 'sylfaen', 'simsun', 'mingliu']);
const SANS = new Set(['arial', 'helvetica', 'helvetica neue', 'calibri', 'carlito', 'segoe ui', 'verdana', 'geneva', 'inter', 'roboto', 'tahoma', 'trebuchet ms', 'liberation sans', 'arimo', 'sans-serif', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'ui-sans-serif', 'open sans', 'noto sans', 'lato', 'dejavu sans', 'gill sans', 'myriad pro', 'ubuntu', 'cantarell', 'fira sans', 'source sans pro', 'droid sans', 'candara', 'corbel', 'century gothic', 'franklin gothic medium', 'lucida sans', 'lucida grande', 'montserrat', 'poppins', 'segoe', 'sf pro text', 'microsoft sans serif', 'arial unicode ms']);

/** Split a CSS font-family list into lower-case names without quotes. */
export function parseFontFamilies(value) {
  const out = [];
  let cur = ''; let quote = '';
  for (const ch of String(value ?? '')) {
    if (quote) { if (ch === quote) quote = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { if (cur.trim()) out.push(cur.trim().toLowerCase()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim().toLowerCase());
  return out;
}

/** 'times' | 'helvetica' | 'courier' for a CSS font-family value (first recognised family wins; unknown → serif). */
export function fontKind(familyValue) {
  for (const name of parseFontFamilies(familyValue)) {
    if (MONO.has(name)) return 'courier';
    if (SERIF.has(name)) return 'times';
    if (SANS.has(name)) return 'helvetica';
  }
  return 'times';
}

export const isBoldWeight = (w) => {
  const s = String(w ?? '').trim().toLowerCase();
  if (s === 'bold' || s === 'bolder') return true;
  const n = Number(s);
  return Number.isFinite(n) && n >= 600;
};
export const isItalicStyle = (s) => /^(italic|oblique)/i.test(String(s ?? '').trim());

/** → { key, base, kind, bold, italic, widths } */
export function pickFont(familyValue, bold = false, italic = false) {
  const kind = fontKind(familyValue);
  const key = `${kind}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
  return { key, kind, bold: !!bold, italic: !!italic, ...FONTS[key] };
}

// ---------------------------------------------------------------------------
// WinAnsi (cp1252) encoding

const CP1252_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87],
  [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e],
  [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  [0x2010, 0x2d], [0x2011, 0x2d],
]);

/** Characters that have no glyph of their own: dropped from the text run. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** WinAnsi byte for a code point, or -1 when the character is not in the encoding. */
export function winAnsiByte(cp) {
  if (cp >= 0x20 && cp <= 0x7e) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return CP1252_HIGH.get(cp) ?? -1;
}

/** Strip invisible characters. */
export const cleanText = (s) => String(s ?? '').replace(INVISIBLE, '');

/** → Uint8Array of WinAnsi bytes, or null when any character cannot be encoded. */
export function encodeWinAnsi(text) {
  const str = cleanText(text);
  const out = new Uint8Array([...str].length);
  let i = 0;
  for (const ch of str) {
    const b = winAnsiByte(ch.codePointAt(0));
    if (b < 0) return null;
    out[i] = b; i += 1;
  }
  return out;
}

/** Advance width of WinAnsi bytes in 1/1000 em. */
export function bytesWidth(bytes, font) {
  if (!font.widths) return bytes.length * COURIER_WIDTH;
  let w = 0;
  for (let i = 0; i < bytes.length; i += 1) w += font.widths[bytes[i] - 32] ?? 0;
  return w;
}

/** Width in points/px of a string set in `font` at `size` (null when not encodable). */
export function textWidth(text, font, size) {
  const b = encodeWinAnsi(text);
  return b ? (bytesWidth(b, font) * size) / 1000 : null;
}

/** PDF literal string `(...)` for WinAnsi bytes. */
export function pdfLiteral(bytes) {
  let s = '(';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else s += `\\${b.toString(8).padStart(3, '0')}`;
  }
  return `${s})`;
}

/** PDF text string for document info: literal when ASCII, UTF-16BE hex otherwise. */
export function pdfTextString(value) {
  const s = String(value ?? '');
  if (/^[\x20-\x7e]*$/.test(s)) return pdfLiteral(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i += 1) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return `<${hex.toUpperCase()}>`;
}

/** Underline / strike-through geometry in em units for a font. */
export const decorationMetrics = (font) => ({
  underlineOffset: 0.1,
  thickness: font.kind === 'helvetica' && font.bold ? 0.07 : 0.05,
  strikeOffset: 0.27,
});
