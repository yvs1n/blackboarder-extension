/**
 * Extracts student identity metadata (ID, name, college, major) from Banner Student Exam pages.
 */

export interface ExtractedStudentInfo {
  studentName?: string;
  studentId?: string;
  college?: string;
  major?: string;
}

const isHeaderKeyword = (txt: string): boolean => {
  const t = (txt || '').trim().toLowerCase();
  if (!t) return false;
  return t.replace(/student\s*id|id\s*number|رقم\s*الطالب|student\s*name|اسم\s*الطالب|college|الكلية|major|التخصص|[\s/()_:\-：]/gi, '').length === 0;
};

function assignStudentFieldFromCells(result: ExtractedStudentInfo, rows: string[][], headerRowOnlyTh: boolean): boolean {
  if (rows.length === 0) return false;
  if (rows.length >= 2 && headerRowOnlyTh && rows[0].length >= 2) {
    let idIdx = -1, nameIdx = -1, colIdx = -1, majIdx = -1;
    rows[0].forEach((raw, idx) => {
      const h = raw.toLowerCase();
      if (/student\s*id|id\s*number|رقم\s*الطالب/i.test(h)) idIdx = idx;
      else if (/student\s*name|اسم\s*الطالب/i.test(h)) nameIdx = idx;
      else if (/college|الكلية/i.test(h)) colIdx = idx;
      else if (/major|التخصص/i.test(h)) majIdx = idx;
    });
    const dataCells = rows[1] || [];
    if (idIdx !== -1 && dataCells[idIdx]) result.studentId = dataCells[idIdx];
    if (nameIdx !== -1 && dataCells[nameIdx]) result.studentName = dataCells[nameIdx];
    if (colIdx !== -1 && dataCells[colIdx]) result.college = dataCells[colIdx];
    if (majIdx !== -1 && dataCells[majIdx]) result.major = dataCells[majIdx];
    if (result.studentId || result.studentName) return true;
  }

  for (const cells of rows) {
    for (let i = 0; i < cells.length - 1; i++) {
      const label = cells[i].toLowerCase();
      const val = cells[i + 1];
      if (!val || isHeaderKeyword(val)) continue;
      if (/student\s*id|id\s*number|رقم\s*الطالب/i.test(label) && !result.studentId) result.studentId = val;
      else if (/student\s*name|اسم\s*الطالب/i.test(label) && !result.studentName) result.studentName = val;
      else if (/college|الكلية/i.test(label) && !result.college) result.college = val;
      else if (/major|التخصص/i.test(label) && !result.major) result.major = val;
    }
  }
  return Boolean(result.studentId || result.studentName);
}

/** Extracts student profile information (ID, name, college, major) from a Banner Student Exam Schedule DOM. */
export function extractStudentFromExamDoc(root: Document | Element): ExtractedStudentInfo | null {
  const result: ExtractedStudentInfo = {};
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const trs = Array.from(table.querySelectorAll('tr'));
    if (trs.length === 0) continue;
    const headerOnlyTh = trs[0].querySelectorAll('td').length === 0 && trs[0].querySelectorAll('th').length >= 2;
    const rows = trs.map(tr => Array.from(tr.querySelectorAll('th, td')).map(c => (c.textContent || '').trim()));
    if (assignStudentFieldFromCells(result, rows, headerOnlyTh)) return result;
  }
  return result.studentId || result.studentName ? result : null;
}

/** Extracts student profile information (ID, name, college, major) from raw Banner Student Exam Schedule HTML. */
export function extractStudentFromExamHtml(html: string): ExtractedStudentInfo | null {
  if (!html) return null;
  const result: ExtractedStudentInfo = {};
  const tableMatches = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  for (const tableHtml of tableMatches) {
    const trMatches = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    if (trMatches.length === 0) continue;
    const firstTr = trMatches[0] || '';
    const headerOnlyTh = !/<td\b/i.test(firstTr) && (firstTr.match(/<th\b/gi) || []).length >= 2;
    const rows = trMatches.map(tr =>
      (tr.match(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, '').trim())
    );
    if (assignStudentFieldFromCells(result, rows, headerOnlyTh)) return result;
  }

  const idMatch = html.match(/(?:Student\s*ID|رقم\s*الطالب)\s*[:：]?\s*<[^>]*>?\s*([Uu0-9]{6,12})/i);
  if (idMatch) result.studentId = idMatch[1].trim();
  const nameMatch = html.match(/(?:Student\s*Name|اسم\s*الطالب)\s*[:：]?\s*<[^>]*>?\s*([^<\n\r]{2,50})/i);
  if (nameMatch) {
    const clean = nameMatch[1].replace(/<[^>]+>/g, '').trim();
    if (clean && !clean.toLowerCase().includes('student')) result.studentName = clean;
  }
  return result.studentId || result.studentName ? result : null;
}
