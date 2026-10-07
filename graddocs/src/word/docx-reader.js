// Reads a Microsoft Word .docx package without any library.
//   openZip(buffer)  → { names(), has(name), bytes(name), text(name) }
//   readDocx(buffer) → { doc, styles, numbering, rels, core, media(target) }
// A .docx is a ZIP archive: we parse the central directory ourselves, inflate entries with the
// browser's DecompressionStream('deflate-raw') (STORE entries are used as-is) and parse the XML
// parts with DOMParser.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const utf8 = new TextDecoder('utf-8');

export class DocxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new DocxError('unsupported', 'This browser cannot unzip Word files (DecompressionStream is missing).');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Parses the central directory of a ZIP archive held in memory. */
export function openZip(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 22) throw new DocxError('invalid', 'This file is too small to be a Word document.');
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new DocxError('legacy', 'This looks like an old .doc file or a password-protected document. Save it as a regular .docx first.');
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new DocxError('invalid', 'This is not a Word (.docx) file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of central directory record: scan backwards (the archive comment is at most 64 KB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new DocxError('invalid', 'The Word file looks damaged (no ZIP directory found).');
  const total = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  if (pos === 0xffffffff || total === 0xffff) throw new DocxError('invalid', 'ZIP64 archives are not supported.');

  const entries = new Map();
  for (let n = 0; n < total; n += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== SIG_CENTRAL) throw new DocxError('invalid', 'The Word file looks damaged (bad ZIP directory).');
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const size = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const offset = view.getUint32(pos + 42, true);
    const name = utf8.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
    entries.set(name, { name, flags, method, compSize, size, offset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  const cache = new Map();
  async function read(name) {
    if (cache.has(name)) return cache.get(name);
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new DocxError('encrypted', 'This Word file is password-protected.');
    if (view.getUint32(e.offset, true) !== SIG_LOCAL) throw new DocxError('invalid', `The Word file looks damaged (${name}).`);
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    const raw = bytes.subarray(start, start + e.compSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = await inflateRaw(raw);
    else throw new DocxError('invalid', `Unsupported compression method ${e.method} in ${name}.`);
    return data;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    size: (name) => entries.get(name)?.size ?? 0,
    bytes: read,
    async text(name) { const b = await read(name); return b ? utf8.decode(b).replace(/^﻿/, '') : null; },
  };
}

function parseXml(text, label) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('invalid', `The Word file looks damaged (${label} is not valid XML).`);
  return doc;
}

/** word/_rels/document.xml.rels → Map(id → { target, type, external }) with targets resolved to package paths. */
function parseRels(xml, baseDir) {
  const map = new Map();
  if (!xml) return map;
  for (const rel of xml.getElementsByTagName('Relationship')) {
    const id = rel.getAttribute('Id');
    let target = rel.getAttribute('Target') || '';
    const external = rel.getAttribute('TargetMode') === 'External';
    if (!external) {
      if (target.startsWith('/')) target = target.slice(1);
      else {
        const parts = `${baseDir}${target}`.split('/');
        const out = [];
        for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
        target = out.join('/');
      }
    }
    map.set(id, { target, type: (rel.getAttribute('Type') || '').split('/').pop(), external });
  }
  return map;
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' };
export const mimeFromName = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

/** Reads every part we need from a .docx. */
export async function readDocx(input) {
  const zip = openZip(input);
  if (!zip.has('[Content_Types].xml')) throw new DocxError('invalid', 'This is not a Word (.docx) file.');

  // The main document part is named by the package relationships (almost always word/document.xml).
  let mainPath = 'word/document.xml';
  const rootRels = await zip.text('_rels/.rels');
  if (rootRels) {
    const rels = parseXml(rootRels, '_rels/.rels');
    for (const rel of rels.getElementsByTagName('Relationship')) {
      if ((rel.getAttribute('Type') || '').endsWith('/officeDocument')) { mainPath = (rel.getAttribute('Target') || mainPath).replace(/^\//, ''); break; }
    }
  }
  const mainXml = await zip.text(mainPath);
  if (!mainXml) throw new DocxError('invalid', 'The Word file has no document content.');
  const baseDir = mainPath.includes('/') ? mainPath.slice(0, mainPath.lastIndexOf('/') + 1) : '';
  const relsPath = `${baseDir}_rels/${mainPath.split('/').pop()}.rels`;

  const doc = parseXml(mainXml, mainPath);
  const stylesText = await zip.text(`${baseDir}styles.xml`);
  const numberingText = await zip.text(`${baseDir}numbering.xml`);
  const relsText = await zip.text(relsPath);
  const coreText = await zip.text('docProps/core.xml');

  let core = null;
  if (coreText) {
    try {
      const c = parseXml(coreText, 'core.xml');
      const get = (tag) => (c.getElementsByTagNameNS('*', tag)[0]?.textContent || '').trim();
      core = { title: get('title'), creator: get('creator'), subject: get('subject') };
    } catch { core = null; }
  }

  return {
    doc,
    styles: stylesText ? parseXml(stylesText, 'styles.xml') : null,
    numbering: numberingText ? parseXml(numberingText, 'numbering.xml') : null,
    rels: parseRels(relsText ? parseXml(relsText, relsPath) : null, baseDir),
    core,
    /** Raw bytes + mime of a media part, or null. */
    async media(target) {
      const data = await zip.bytes(target);
      return data ? { bytes: data, mime: mimeFromName(target), name: target } : null;
    },
    hasPart: (name) => zip.has(name),
  };
}
