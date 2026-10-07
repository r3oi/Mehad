// Minimal ZIP writer (no dependencies).
//   createZip([{ path, data: Uint8Array | ArrayBuffer | string | Blob, date? }], { onProgress }) → Promise<Blob>
// Entries are DEFLATE-compressed through CompressionStream('deflate-raw') when the browser has it
// (and the result is actually smaller), otherwise STOREd. File names are UTF-8 (general purpose
// flag bit 11), CRC-32 is real, and a DOS date/time is written for every entry, so the archive
// opens in Windows Explorer, macOS Archive Utility, `unzip` and Microsoft Word (for .docx).
import { crc32Final } from './png.js';
import { t, isRTL } from '../i18n/index.js';

const enc = new TextEncoder();
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const INCOMPRESSIBLE = /\.(png|jpe?g|gif|webp|zip|docx|xlsx|pptx|woff2?|mp4|mp3)$/i;

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return enc.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new TypeError('createZip: unsupported entry data type');
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** DOS date/time words for a JS Date (local time, 2-second resolution, year ≥ 1980). */
export function dosDateTime(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function cleanPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export async function createZip(files, { onProgress } = {}) {
  const canDeflate = typeof CompressionStream !== 'undefined';
  const parts = []; // Uint8Array chunks, in file order
  const central = [];
  let offset = 0;
  const seen = new Set();
  const list = (files || []).filter((f) => f && f.path);
  if (list.length > 0xfffe) throw new Error(t('Too many files for a ZIP archive.'));

  let index = 0;
  for (const file of list) {
    const path = cleanPath(file.path);
    if (!path || seen.has(path)) continue; // skip empty / duplicate names
    seen.add(path);
    const name = enc.encode(path);
    const raw = await toBytes(file.data ?? '');
    if (raw.length > 0xfffffffe || offset > 0xfffffffe) throw new Error(t('"{path}" is too large for a ZIP archive.', { path: isRTL ? `\u2066${path}\u2069` : path })); // file names stay left-to-right
    const crc = crc32Final(raw);
    let method = 0; let body = raw;
    if (canDeflate && raw.length > 64 && !INCOMPRESSIBLE.test(path)) {
      try {
        const packed = await deflateRaw(raw);
        if (packed.length < raw.length) { method = 8; body = packed; }
      } catch { /* fall back to STORE */ }
    }
    const { time, date } = dosDateTime(file.date);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    parts.push(local, body);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, (3 << 8) | 20, true); // made by: Unix, spec 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    // 30 extra, 32 comment, 34 disk, 36 internal attrs = 0
    cv.setUint32(38, ((0o100644 << 16) >>> 0), true); // external attrs: regular file rw-r--r--
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + body.length;
    index += 1;
    onProgress?.(index / list.length, path);
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_END, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
