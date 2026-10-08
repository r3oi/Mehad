// Turns a picture found in a Word file into a compact data: URL for a GradDocs figure.
// Large pictures are scaled down (max 1600 px on the long side) and re-encoded as JPEG (q 0.85),
// except PNGs that really use transparency, which stay PNG. Small PNG/JPEG files are kept untouched.

const MAX_SIDE = 1600;
const KEEP_BELOW_BYTES = 600 * 1024;
const cache = new Map(); // image hash → { dataUrl, width, height }

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read picture'));
    reader.readAsDataURL(blob);
  });
}

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { const bmp = await createImageBitmap(blob); if (bmp.width && bmp.height) return bmp; } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 400, height: img.naturalHeight || 300, source: img };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
}

function hasTransparency(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/**
 * prepareImage({ bytes, mime, hash }) → { dataUrl, width, height } where width/height are the stored picture's pixels.
 * Results are cached per picture hash, so repeated syncs never decode the same picture twice.
 */
export async function prepareImage(image) {
  const hit = image.hash && cache.get(image.hash);
  if (hit) return hit;
  const blob = new Blob([image.bytes], { type: image.mime });
  const bmp = await decode(blob);
  const w0 = bmp.width; const h0 = bmp.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  let result;
  if (scale === 1 && (image.mime === 'image/png' || image.mime === 'image/jpeg') && image.bytes.length <= KEEP_BELOW_BYTES) {
    result = { dataUrl: await toDataUrl(blob), width: w0, height: h0 };
  } else {
    const w = Math.max(1, Math.round(w0 * scale)); const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp.source || bmp, 0, 0, w, h);
    const alpha = image.mime !== 'image/jpeg' && hasTransparency(ctx, w, h);
    let dataUrl = alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
    // Never make a picture bigger than the original we were given.
    if (scale === 1 && (image.mime === 'image/png' || image.mime === 'image/jpeg') && dataUrl.length > image.bytes.length * 1.37) dataUrl = await toDataUrl(blob);
    result = { dataUrl, width: w, height: h };
  }
  if (bmp.close) bmp.close();
  if (image.hash) { cache.set(image.hash, result); if (cache.size > 8) cache.delete(cache.keys().next().value); }
  return result;
}
