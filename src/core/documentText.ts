/**
 * Plain text from a file a student uploads (a syllabus or a class schedule): PDF through pdf.js
 * (each app loads it only when needed and passes it in), Word .docx through a small zip reader,
 * and text, Markdown, CSV or HTML as they are. Everything runs on the device; nothing is uploaded.
 */

export type DocumentKind = 'pdf' | 'docx' | 'text' | 'image' | 'unsupported';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;
const MAX_PDF_PAGES = 40;

export function documentKind(name: string, type = ''): DocumentKind {
  const n = String(name || '').toLowerCase();
  const t = String(type || '').toLowerCase();
  if (n.endsWith('.pdf') || t === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx') || t.includes('wordprocessingml')) return 'docx';
  if (/\.(txt|md|csv|tsv|html?|rtf)$/.test(n) || t.startsWith('text/')) return 'text';
  if (/\.(png|jpe?g|gif|webp|heic|bmp)$/.test(n) || t.startsWith('image/')) return 'image';
  return 'unsupported';
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One file from a zip archive (a .docx is one), or null when it is not there. */
export async function readZipEntry(bytes: Uint8Array, wanted: string): Promise<Uint8Array | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record sits in the last 64 KB
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < entries && p + 46 <= bytes.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) return null;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      if (view.getUint32(local, true) !== 0x04034b50) return null;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** The text of a Word document.xml: paragraphs on their own lines, table rows on one line with tabs between cells. */
export function docxXmlToText(xml: string): string {
  let out = '';
  let inText = false;
  let cellDepth = 0;
  for (const token of String(xml || '').split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (token[0] !== '<') {
      if (inText) out += decodeXmlText(token);
      continue;
    }
    if (/^<w:t[\s>]/.test(token) && !token.endsWith('/>')) inText = true;
    else if (token === '</w:t>') inText = false;
    else if (/^<w:tab\b/.test(token)) out += '\t';
    else if (/^<w:(br|cr)\b/.test(token)) out += cellDepth ? ' ' : '\n';
    else if (token === '</w:p>') out += cellDepth ? ' ' : '\n';
    else if (/^<w:tc[\s>]/.test(token)) cellDepth++;
    else if (token === '</w:tc>') { cellDepth = Math.max(0, cellDepth - 1); out += '\t'; }
    else if (token === '</w:tr>') out += '\n';
  }
  return tidyText(out);
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const xml = await readZipEntry(bytes, 'word/document.xml');
  if (!xml) throw new Error('This Word file could not be opened. Save it again as .docx or PDF and try once more.');
  return docxXmlToText(new TextDecoder().decode(xml));
}

/** Text items from pdf.js (str, transform [a, b, c, d, x, y], width) put back into lines, top to bottom. */
export function pdfItemsToLines(items: { str?: string; transform?: number[]; width?: number }[]): string {
  const parts = (items || [])
    .filter(i => i && typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
    .map(i => ({ str: i.str as string, x: i.transform![4], y: i.transform![5], w: Number(i.width) || 0, h: Math.abs(i.transform![3]) || 10 }));
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: (typeof parts)[] = [];
  for (const part of parts) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - part.y) <= Math.max(2, part.h * 0.4)) line.push(part);
    else lines.push([part]);
  }
  return tidyText(lines.map(line => {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    let end = -Infinity;
    for (const part of line) {
      const gap = part.x - end;
      if (text) text += gap > part.h * 1.5 ? '\t' : gap > part.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(part.str) ? ' ' : '';
      text += part.str;
      end = part.x + part.w;
    }
    return text;
  }).join('\n'));
}

/** What the apps pass in: the pdf.js module (getDocument), already pointed at its worker file. */
export interface PdfJsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<any> };
}

export async function pdfToText(bytes: Uint8Array, pdfjs: PdfJsLike): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(pdfItemsToLines(content.items));
    }
  } finally {
    doc.destroy?.();
  }
  return tidyText(pages.join('\n'));
}

export function htmlToText(html: string): string {
  return tidyText(decodeXmlText(String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')));
}

/** Same spacing everywhere: no non-breaking spaces, at most one blank line, trimmed lines. */
export function tidyText(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .split('\n')
    .map(l => l.replace(/[ ]{2,}/g, ' ').replace(/[ ]*\t[ \t]*/g, '\t').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * The text of an uploaded file. `loadPdfJs` is only called for a PDF. Throws an Error with a
 * message for the student when the file cannot be read.
 */
export async function fileToText(
  file: { name: string; type?: string; size: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> },
  loadPdfJs: () => Promise<PdfJsLike>
): Promise<string> {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('That file is over 15 MB. Upload the syllabus or schedule on its own.');
  const kind = documentKind(file.name, file.type);
  if (kind === 'image') throw new Error('Pictures cannot be read yet. Upload the PDF or Word file, or copy the text and paste it.');
  if (kind === 'unsupported') throw new Error('Upload a PDF, Word (.docx) or text file.');
  if (kind === 'text') {
    const raw = await file.text();
    return /\.html?$/i.test(file.name) || /<\/(p|td|div)>/i.test(raw) ? htmlToText(raw) : tidyText(raw);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === 'docx') return docxToText(bytes);
  const text = await pdfToText(bytes, await loadPdfJs());
  if (!text) throw new Error('This PDF has no text in it (it may be a scan). Copy the text and paste it instead.');
  return text;
}
