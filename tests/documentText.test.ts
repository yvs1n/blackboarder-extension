import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { documentKind, docxXmlToText, fileToText, pdfItemsToLines, readZipEntry, htmlToText } from '../src/core/documentText';
import { analyzeCourseDocument } from '../src/core/courseDocument';

/** A one-page PDF with Helvetica text lines, built by hand so the test needs no fixture file. */
function makePdf(lines: string[]): Uint8Array {
  const content = lines.map((l, i) => `BT /F1 11 Tf 72 ${740 - i * 16} Td (${l.replace(/[()\\]/g, m => '\\' + m)}) Tj ET`).join('\n');
  const stream = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    null
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((obj, i) => {
    offsets.push(length);
    const body = obj === null
      ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1')])
      : Buffer.from(`${i + 1} 0 obj\n${obj}\nendobj\n`, 'latin1');
    parts.push(body);
    length += body.length;
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** A zip with one deflated file, the way Word stores word/document.xml. */
function makeZip(name: string, text: string): Uint8Array {
  const data = Buffer.from(text, 'utf8');
  const packed = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, packed]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralPart.length, 12); end.writeUInt32LE(localPart.length, 16);
  return new Uint8Array(Buffer.concat([localPart, centralPart, end]));
}

const asFile = (name: string, bytes: Uint8Array | string, type = '') => {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
  return { name, type, size: buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), text: async () => buf.toString('utf8') };
};

const loadPdfJs = async () => (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;

describe('reading uploaded files', () => {
  it('knows what each file is', () => {
    expect(documentKind('Syllabus.PDF')).toBe('pdf');
    expect(documentKind('outline.docx')).toBe('docx');
    expect(documentKind('x', 'text/plain')).toBe('text');
    expect(documentKind('timetable.png')).toBe('image');
    expect(documentKind('old.doc')).toBe('unsupported');
  });

  it('reads a PDF syllabus all the way to its courses', async () => {
    const pdf = makePdf([
      'Course Code: CSC 201',
      'Course Title: Data Structures',
      'Credit Hours: 3',
      'Lectures: Sunday and Tuesday 11:00 - 12:15, Room A8-103',
      'Assessment',
      'Quizzes (4) 20%',
      'Midterm Exam 30%',
      'Final Exam 50%'
    ]);
    const text = await fileToText(asFile('syllabus.pdf', pdf, 'application/pdf'), loadPdfJs);
    expect(text).toContain('Course Code: CSC 201');
    expect(text.split('\n')).toHaveLength(8);
    const c = analyzeCourseDocument(text).courses[0];
    expect(c).toMatchObject({ courseCode: 'CSC 201', courseName: 'Data Structures', creditHours: 3 });
    expect(c.syllabus.map(s => s.totalWeight)).toEqual([20, 30, 50]);
    expect(c.scheduleSlots[0]).toMatchObject({ days: ['Sunday', 'Tuesday'], startTime: '11:00', room: 'A8-103' });
  }, 20000);

  it('reads a Word file, keeping table rows on one line', async () => {
    const xml = '<w:document><w:body>'
      + '<w:p><w:r><w:t>Course Code: MTH 210</w:t></w:r></w:p>'
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Midterm</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t xml:space="preserve">30%</w:t></w:r></w:p></w:tc></w:tr>'
      + '<w:tr><w:tc><w:p><w:r><w:t>Final &amp; Project</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>70%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      + '</w:body></w:document>';
    expect(docxXmlToText(xml)).toBe('Course Code: MTH 210\nMidterm\t30%\nFinal & Project\t70%');
    const zip = makeZip('word/document.xml', xml);
    expect(await readZipEntry(zip, 'missing.xml')).toBeNull();
    const text = await fileToText(asFile('outline.docx', zip), loadPdfJs);
    expect(text).toContain('Final & Project\t70%');
  });

  it('turns pdf.js pieces back into lines, with cells apart', () => {
    const t = (str: string, x: number, y: number, width: number) => ({ str, transform: [10, 0, 0, 10, x, y], width });
    expect(pdfItemsToLines([
      t('Midterm', 72, 700, 40), t('30%', 300, 700, 15),
      t('Data', 72, 720, 20), t('Structures', 94, 720.5, 50)
    ])).toBe('Data Structures\nMidterm\t30%');
  });

  it('reads HTML and says why a file cannot be read', async () => {
    expect(htmlToText('<table><tr><td>Quiz</td><td>10%</td></tr></table><script>x()</script>')).toBe('Quiz\t10%');
    await expect(fileToText(asFile('photo.jpg', 'x'), loadPdfJs)).rejects.toThrow(/Pictures/);
    await expect(fileToText(asFile('a.doc', 'x'), loadPdfJs)).rejects.toThrow(/PDF, Word/);
    await expect(fileToText({ ...asFile('big.pdf', 'x'), size: 20 * 1024 * 1024 }, loadPdfJs)).rejects.toThrow(/15 MB/);
  });
});
