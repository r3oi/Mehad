// Logo images → data: URLs. Shared by Settings (uploading the university / project logo) and the
// "Updates from Claude" inbox (a logo that Claude committed to the repository).
//   SVG                  kept as it is (a data: URL, at most 1.5 MB)
//   PNG / JPG / WebP     drawn into a canvas, scaled down so the long side is at most `max` px, stored as PNG
import { t } from '../i18n/index.js';

export const SVG_MAX_BYTES = 1_500_000;

const readDataURL = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error || new Error('read'));
  reader.readAsDataURL(blob);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('decode'));
  img.src = src;
});

/** 'png' | 'jpeg' | 'webp' | 'svg' | 'gif' from the first bytes of a file, or '' when it is none of them. */
export function sniffImageType(bytes) {
  const b = bytes || [];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return '';
}

/** What kind of image a File / Blob is: from its first bytes, then from its type and name. '' = not a supported image. */
async function imageKind(file) {
  let head = [];
  try { head = new Uint8Array(await file.slice(0, 2048).arrayBuffer()); } catch { /* fall back to type and name */ }
  const sniffed = sniffImageType(head);
  if (sniffed) return sniffed === 'gif' ? '' : sniffed;
  if (head.length && /<svg[\s>]/i.test(new TextDecoder().decode(head))) return 'svg';
  const name = String(file.name || '');
  if (/svg/i.test(file.type) || /\.svg$/i.test(name)) return 'svg';
  if (/^image\/(png|jpeg|webp)$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(name)) return 'raster';
  return '';
}

/**
 * An uploaded (or downloaded) logo → data: URL. Throws an Error with a translated message when the file is not usable.
 * `max` = longest side in px of a raster logo (600 for the university logo, 1200 for the wider project logo).
 */
export async function logoDataURL(file, { max = 600 } = {}) {
  const kind = await imageKind(file);
  if (kind === 'svg') {
    if (file.size > SVG_MAX_BYTES) throw new Error(t('That SVG file is too large (the limit is 1.5 MB).'));
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) throw new Error(t('That file is not a valid SVG image.'));
    return readDataURL(new Blob([text], { type: 'image/svg+xml' }));
  }
  if (!kind) throw new Error(t('Choose a PNG, JPG, SVG or WebP image.'));
  let img;
  try { img = await loadImage(await readDataURL(file)); } catch { throw new Error(t('That image could not be read.')); }
  const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}
