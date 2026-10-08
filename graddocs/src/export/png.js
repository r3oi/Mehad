// SVG → PNG rasterisation with correct DPI metadata (pHYs chunk), so a 3× PNG
// is inserted into Microsoft Word at its intended physical size.
import { t } from '../i18n/index.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
export const crc32Final = (bytes) => (crc32(bytes) ^ 0xffffffff) >>> 0;

export function loadSvgImage(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('Could not rasterise the SVG.'))); };
    img.src = url;
  });
}

/** Draw an SVG string to a canvas at `scale`. background: CSS colour or null for transparent. */
export async function svgToCanvas(svg, width, height, { scale = 3, background = null } = {}) {
  const img = await loadSvgImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Canvas export failed.')))), type, quality));
}

/** Insert/replace the pHYs chunk of a PNG so viewers know its DPI. */
export async function setPngDpi(blob, dpi) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32Final(chunk.subarray(4, 17)));
  // Rebuild: signature + IHDR + pHYs + every other chunk except an old pHYs.
  const parts = [bytes.subarray(0, 8)];
  let off = 8; let inserted = false;
  while (off < bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== 'pHYs') parts.push(bytes.subarray(off, end));
    if (type === 'IHDR' && !inserted) { parts.push(chunk); inserted = true; }
    off = end;
  }
  return new Blob(parts, { type: 'image/png' });
}

/**
 * svgToPngBlob(svg, width, height, { scale = 3, dpi = 96 * scale, background })
 * → Promise<Blob> (PNG with DPI metadata).
 */
export async function svgToPngBlob(svg, width, height, { scale = 3, dpi, background = null } = {}) {
  const canvas = await svgToCanvas(svg, width, height, { scale, background });
  const blob = await canvasToBlob(canvas, 'image/png');
  return setPngDpi(blob, dpi || Math.round(96 * scale));
}

/** Copy a PNG blob to the clipboard (paste straight into Word). */
export async function copyPngToClipboard(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(t('This browser cannot copy images to the clipboard. Download the PNG instead.'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
