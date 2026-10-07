// Pictures inside figures: a file / clipboard image becomes a downscaled data URL
// (at most MAX_SIDE px on the longest side) that an 'image' element can draw.
// Shared by the editor ("Insert image", paste, drop) and the New Figure dialog.
import { t } from '../../i18n/index.js';

export const MAX_SIDE = 1600;
/** A PNG whose data URL is longer than this is stored as JPEG instead (screenshots rarely need transparency). */
export const PNG_LIMIT = 800 * 1024;
/** JPEG quality starts at 0.9 and drops until the data URL fits (or the floor is reached). */
const JPEG_LIMIT = 1100 * 1024;
const SVG_SIDE = 1200; // vector files are rasterised at this size

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

const extensionOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || '')) || [])[1]?.toLowerCase() || '';

/** Is this a picture type the editor can use (png, jpg, webp, gif, svg)? */
export function isImageFile(file) {
  if (!file) return false;
  if (file.type) return /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type);
  return IMAGE_EXTENSIONS.includes(extensionOf(file.name));
}

/** "login-screen_v2.png" → "login screen v2" (prefilled figure title). */
export function titleFromFileName(name) {
  return String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('This image could not be read. Try a PNG or JPG file.'))); };
    img.src = url;
  });
}

/**
 * Read an image file → { src (data URL), width, height, name }.
 * Larger pictures are scaled down in a canvas; PNG stays PNG unless its data URL is
 * over ~800 KB, then it becomes JPEG (quality 0.9) — JPEG, as the source, stays JPEG.
 */
export async function imageFromFile(file) {
  if (!isImageFile(file)) throw new Error(t('Choose an image file (PNG, JPG, WebP, GIF or SVG).'));
  const ext = extensionOf(file.name);
  const mime = file.type || MIME_BY_EXT[ext] || 'image/png';
  const isSvg = /svg/.test(mime);
  const blob = file.type ? file : new Blob([file], { type: mime });
  const img = await loadImage(blob);
  let w = img.naturalWidth || 800; let h = img.naturalHeight || 600;
  const side = Math.max(w, h);
  const target = isSvg ? Math.min(MAX_SIDE, side < 600 ? SVG_SIDE : Math.max(side, SVG_SIDE)) : Math.min(side, MAX_SIDE);
  const k = target / side;
  if (k !== 1) { w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k)); }

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);

  let src;
  if (/jpe?g/.test(mime)) src = jpegOf(canvas);
  else {
    src = canvas.toDataURL('image/png');
    if (src.length > PNG_LIMIT) src = jpegOf(canvas);
  }
  return { src, width: w, height: h, name: file.name || '' };
}

/** JPEG data URL of a canvas on a white background; quality drops from 0.9 until it is small enough. */
function jpegOf(canvas) {
  const flat = document.createElement('canvas');
  flat.width = canvas.width; flat.height = canvas.height;
  const g = flat.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, flat.width, flat.height);
  g.drawImage(canvas, 0, 0);
  let quality = 0.9;
  let out = flat.toDataURL('image/jpeg', quality);
  while (out.length > JPEG_LIMIT && quality > 0.55) { quality -= 0.1; out = flat.toDataURL('image/jpeg', quality); }
  return out;
}

// ---------------------------------------------------------------------------
// Light-weight hrefs for on-screen drawing. A data URL can be ~1 MB; putting it into the
// canvas markup on every pointer move is slow, so the editor and the figures list draw a
// short blob: URL instead (exports always keep the data URL).

const blobUrls = new Map();

export function blobURLFor(src) {
  if (typeof src !== 'string' || !src.startsWith('data:')) return src;
  let url = blobUrls.get(src);
  if (url) return url;
  try {
    const comma = src.indexOf(',');
    const head = src.slice(5, comma);
    const mime = head.split(';')[0] || 'application/octet-stream';
    const raw = /;base64$/i.test(head) ? atob(src.slice(comma + 1)) : decodeURIComponent(src.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch { url = src; }
  blobUrls.set(src, url);
  return url;
}

/** The diagram with every picture pointing at a blob: URL — for thumbnails shown on screen only. */
export function lightDiagram(diagram) {
  const els = diagram?.elements;
  if (!els?.some((el) => el.shape === 'image' && el.src)) return diagram;
  return { ...diagram, elements: els.map((el) => (el.shape === 'image' && el.src ? { ...el, src: blobURLFor(el.src) } : el)) };
}
