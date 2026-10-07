// PDF export. svgToPdfBlob() produces a real vector PDF (pdf-vector.js: paths, selectable text,
// embedded images) and only falls back to the raster writer below -- one image per page,
// lossless FlateDecode RGB when the browser has CompressionStream, JPEG otherwise -- when the
// vector conversion throws. No dependencies.
import { svgToCanvas } from './png.js';

const enc = new TextEncoder();

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function canvasImage(canvas) {
  const w = canvas.width; const h = canvas.height;
  if (typeof CompressionStream !== 'undefined') {
    const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      const a = data[i + 3] / 255; // composite on white
      rgb[j] = data[i] * a + 255 * (1 - a);
      rgb[j + 1] = data[i + 1] * a + 255 * (1 - a);
      rgb[j + 2] = data[i + 2] * a + 255 * (1 - a);
    }
    return { w, h, filter: 'FlateDecode', bytes: await deflate(rgb) };
  }
  const url = canvas.toDataURL('image/jpeg', 0.95);
  const bin = atob(url.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { w, h, filter: 'DCTDecode', bytes };
}

const pdfString = (s) => `(${String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '')})`;

/**
 * pages: [{ canvas, widthPt, heightPt }] — each canvas is drawn to fill its page
 * (minus `margin` points). Returns a PDF Blob.
 */
export async function canvasesToPdf(pages, { title = 'GradDocs export', margin = 18 } = {}) {
  const chunks = []; const offsets = []; let size = 0;
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const images = await Promise.all(pages.map((p) => canvasImage(p.canvas)));
  // Object numbering: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  obj(3, () => push(`<< /Title ${pdfString(title)} /Producer (GradDocs) >>`));
  pages.forEach((p, i) => {
    const pageN = 4 + i * 3; const contentN = pageN + 1; const imgN = pageN + 2;
    const W = p.widthPt + margin * 2; const H = p.heightPt + margin * 2;
    const content = `q ${p.widthPt.toFixed(2)} 0 0 ${p.heightPt.toFixed(2)} ${margin} ${margin} cm /Im0 Do Q`;
    obj(pageN, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>`));
    obj(contentN, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    const img = images[i];
    obj(imgN, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${img.filter} /Length ${img.bytes.length} >>\nstream\n`);
      push(img.bytes);
      push('\nendstream');
    });
  });
  const total = 4 + pages.length * 3;
  const xref = size;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n += 1) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/** Raster fallback: the SVG drawn to a canvas at `scale` and embedded as one image. */
export async function rasterSvgToPdfBlob(svg, width, height, { scale = 3, title } = {}) {
  const canvas = await svgToCanvas(svg, width, height, { scale, background: '#ffffff' });
  return canvasesToPdf([{ canvas, widthPt: width * 0.75, heightPt: height * 0.75 }], { title });
}

/**
 * SVG (as produced by renderFigureSVG / renderTableSVG) → single-page PDF Blob.
 * Vector by default (sharp at any zoom, selectable text, small); `opts.vector === false` forces the
 * raster path, which is also used automatically if the vector conversion throws.
 * opts: { scale (raster fallback only), title, vector, margin (pt) }
 */
export async function svgToPdfBlob(svg, width, height, { scale = 3, title, vector = true, margin } = {}) {
  if (vector !== false) {
    try {
      const { svgToVectorPdf } = await import('./pdf-vector.js');
      return await svgToVectorPdf(svg, { title, width, height, margin });
    } catch (err) {
      console.warn('[pdf] vector export failed, falling back to a raster PDF:', err);
    }
  }
  return rasterSvgToPdfBlob(svg, width, height, { scale, title });
}
