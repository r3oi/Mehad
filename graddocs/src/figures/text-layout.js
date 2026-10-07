// Text measurement and wrapping for SVG labels (SVG has no auto-wrap).
// Uses a shared canvas context; results are cached per font+text.

let ctx = null;
const widthCache = new Map();

export const FONT_STACKS = {
  'Times New Roman': "'Times New Roman', Times, 'Liberation Serif', serif",
  Arial: "Arial, 'Liberation Sans', Helvetica, sans-serif",
  Calibri: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif",
  Cambria: "Cambria, Caladea, Georgia, serif",
  Georgia: 'Georgia, serif',
  Helvetica: 'Helvetica, Arial, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  'Segoe UI': "'Segoe UI', Roboto, Arial, sans-serif",
  'Courier New': "'Courier New', Courier, monospace",
};

export const FONT_FAMILIES = Object.keys(FONT_STACKS);
export const fontStack = (family) => FONT_STACKS[family] || `'${family}', serif`;

function context() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

export function measureText(text, { fontFamily, fontSize, fontWeight = 'normal', fontStyle = 'normal' }) {
  const font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontStack(fontFamily)}`;
  const key = `${font}|${text}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    const c = context();
    c.font = font;
    w = c.measureText(text).width;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

/**
 * Greedy word wrap. Respects explicit "\n". Words longer than the width are
 * broken by characters. Returns { lines: [{ text, width }], width, height, lineHeight }.
 */
export function layoutText(text, font, maxWidth = Infinity, lineHeightFactor = 1.2) {
  const lineHeight = font.fontSize * lineHeightFactor;
  const lines = [];
  const paragraphs = String(text ?? '').split('\n');
  for (const para of paragraphs) {
    if (!para.trim()) { lines.push({ text: '', width: 0 }); continue; }
    const words = para.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureText(candidate, font) <= maxWidth || !current) {
        if (!current && measureText(word, font) > maxWidth && maxWidth > font.fontSize) {
          // Break an over-long word.
          let chunk = '';
          for (const ch of word) {
            if (measureText(chunk + ch, font) > maxWidth && chunk) { lines.push({ text: chunk, width: measureText(chunk, font) }); chunk = ch; } else chunk += ch;
          }
          current = chunk;
        } else current = candidate;
      } else {
        lines.push({ text: current, width: measureText(current, font) });
        current = word;
      }
    }
    lines.push({ text: current, width: measureText(current, font) });
  }
  // Drop trailing empty lines produced by a final newline.
  while (lines.length > 1 && !lines[lines.length - 1].text) lines.pop();
  const width = Math.max(0, ...lines.map((l) => l.width));
  return { lines, width, height: lines.length * lineHeight, lineHeight };
}

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const xmlEscape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => XML_ESC[c]);

/**
 * Render wrapped text into an SVG <text> element inside a box.
 * box: { x, y, w, h }  style: resolved style (fontFamily, fontSize, fontWeight, fontStyle, underline, textColor, align, vAlign)
 */
export function textSVG(text, box, style, { padding = 0 } = {}) {
  if (!text && text !== 0) return '';
  const font = { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle };
  const innerW = Math.max(4, box.w - padding * 2);
  const layout = layoutText(text, font, innerW);
  const lh = layout.lineHeight;
  let top;
  if (style.vAlign === 'top') top = box.y + padding;
  else if (style.vAlign === 'bottom') top = box.y + box.h - padding - layout.height;
  else top = box.y + (box.h - layout.height) / 2;
  let x; let anchor;
  if (style.align === 'left') { x = box.x + padding; anchor = 'start'; }
  else if (style.align === 'right') { x = box.x + box.w - padding; anchor = 'end'; }
  else { x = box.x + box.w / 2; anchor = 'middle'; }
  const tspans = layout.lines.map((line, i) => {
    const baseline = top + i * lh + lh / 2 + style.fontSize * 0.34;
    return `<tspan x="${r(x)}" y="${r(baseline)}">${xmlEscape(line.text) || ' '}</tspan>`;
  }).join('');
  const attrs = [
    `font-family="${xmlEscape(fontStack(style.fontFamily))}"`,
    `font-size="${style.fontSize}"`,
    `fill="${style.textColor}"`,
    `text-anchor="${anchor}"`,
    style.fontWeight === 'bold' ? 'font-weight="bold"' : '',
    style.fontStyle === 'italic' ? 'font-style="italic"' : '',
    style.underline ? 'text-decoration="underline"' : '',
  ].filter(Boolean).join(' ');
  return `<text ${attrs}>${tspans}</text>`;
}

export const r = (n) => Math.round(n * 100) / 100;
