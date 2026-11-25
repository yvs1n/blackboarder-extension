/**
 * Title normalization, Arabic-to-English assessment localization, and announcement text merging.
 */

/** Convert Arabic-Indic (٠-٩) and Eastern Arabic (۰-۹) digits to ASCII (0-9). */
export function normalizeDigits(text: string): string {
  if (!text) return '';
  return text
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0));
}

/** True for titles that are only a task type word, such as "Exam", "Meeting" or "Other". */
export function isBareTypeTitle(title: string): boolean {
  const trimmed = title.trim();
  if (/^(?:assignment|homework|hw|exam|quiz|test|lab|meeting|other|project|presentation|task|event|deadline)$/i.test(trimmed)) {
    return true;
  }
  return /^(?:واجب|هومورك|كويز|امتحان|اختبار|مشروع|تقرير|مختبر|مهمة|عرض)$/.test(trimmed);
}

/**
 * Normalizes deadline titles to clear, standardized English titles.
 * Translates Arabic assessment titles and normalizes English abbreviations and variants.
 */
export function toEnglishDeadlineTitle(rawTitle: string, taskType?: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return taskType ? (taskType.charAt(0).toUpperCase() + taskType.slice(1)) : 'Assessment';
  }

  let title = rawTitle.trim();
  if (!title) {
    return taskType ? (taskType.charAt(0).toUpperCase() + taskType.slice(1)) : 'Assessment';
  }

  // 1. Strip common announcement and reminder prefixes in English and Arabic
  title = title.replace(/^(?:announcement|reminder|urgent|notice|update|إعلان|تنبيه|تذكير|هام|عاجل|تحديث)\s*[:|-]\s*/i, '');

  // 2. Strip leading course code prefixes like "[CS101] ", "MATH 101 - "
  title = title.replace(/^\s*\[?[A-Z]{2,5}\s*\d{3,4}[A-Z]?\]?\s*[-:|]\s*/i, '');

  // 3. Convert Arabic-Indic / Eastern Arabic digits to ASCII digits (0-9)
  title = normalizeDigits(title);

  const hasArabic = /[\u0600-\u06FF]/.test(title);
  if (!hasArabic) {
    const trimmed = title.trim();
    if (/^hw\s*#?\s*(\d+)$/i.test(trimmed)) return trimmed.replace(/^hw\s*#?\s*(\d+)$/i, 'Homework $1');
    if (/^hw$/i.test(trimmed)) return 'Homework';
    if (/^midterm\s+(?:exam|examination|test)$/i.test(trimmed)) return 'Midterm';
    return title;
  }

  // Extract trailing subtitle/topic if separated by colon or dash (e.g. "HW 1: Calculus Limits")
  let topicSuffix = '';
  const sepMatch = title.match(/^(.+?)\s*([:-])\s*(.+)$/);
  let mainPart = title;
  if (sepMatch) {
    const head = sepMatch[1].trim();
    const tail = sepMatch[3].trim();
    if (/(?:quiz|exam|midterm|final|assignment|homework|hw|lab|project|كويز|واجب|امتحان|اختبار|مشروع|تقرير)/i.test(head)) {
      mainPart = head;
      if (/[a-zA-Z0-9]/.test(tail)) topicSuffix = ` ${sepMatch[2]} ${tail}`;
    }
  }

  const extractNum = (str: string): number | null => {
    const arOrdMap: Record<string, number> = {
      'اول': 1, 'أول': 1, 'الاول': 1, 'الأول': 1,
      'ثاني': 2, 'ثانى': 2, 'الثاني': 2, 'الثانى': 2,
      'ثالث': 3, 'الثالث': 3,
      'رابع': 4, 'الرابع': 4,
      'خامس': 5, 'الخامس': 5,
      'سادس': 6, 'السادس': 6,
      'سابع': 7, 'السابع': 7,
      'ثامن': 8, 'الثامن': 8,
      'تاسع': 9, 'التاسع': 9,
      'عاشر': 10, 'العاشر': 10
    };
    for (const [k, v] of Object.entries(arOrdMap)) {
      if (str.includes(k)) return v;
    }

    const enOrdMap: Record<string, number> = {
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
      sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
    };
    const enMatch = str.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
    if (enMatch) return enOrdMap[enMatch[1].toLowerCase()] || null;

    const digitMatch = str.match(/(?:#|no\.?|part|phase)?\s*(\d+)/i);
    if (digitMatch) return parseInt(digitMatch[1], 10);

    const romMatch = str.match(/\b(i{1,3}|iv|v|vi{0,3}|ix|x)\b/i);
    if (romMatch) {
      const romMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
      return romMap[romMatch[1].toLowerCase()] || null;
    }

    return null;
  };

  const num = extractNum(mainPart);

  const isMidterm = /(?:امتحان|اختبار)\s*(?:نصفي|منتصف\s*الفصل)|(?:الامتحان|الاختبار)\s*(?:النصفي)|\bmid[\s_-]*terms?\b/i.test(mainPart);
  if (isMidterm) {
    return num && num > 1 ? `Midterm ${num}${topicSuffix}` : `Midterm${topicSuffix}`;
  }

  const isFinal = /(?:امتحان|اختبار)\s*(?:نهائي)|(?:الامتحان|الاختبار)\s*(?:النهائي)|\bfinal\s+(?:exam|examination|test)\b|\bfinal\b/i.test(mainPart);
  if (isFinal) return `Final Exam${topicSuffix}`;

  const isExam = (/(?:امتحان|اختبار)|\b(?:exam|examination|test)\b/i.test(mainPart) && (taskType === 'exam' || !taskType));
  if (isExam) return num ? `Exam ${num}${topicSuffix}` : `Exam${topicSuffix}`;

  if (/\bassignment\b/i.test(mainPart)) return num ? `Assignment ${num}${topicSuffix}` : `Assignment${topicSuffix}`;

  const isHw = /(?:الواجب|واجب|هومورك)|\b(?:homework|hw|problem\s*set|asmt)\b/i.test(mainPart) || taskType === 'assignment';
  if (isHw) return num ? `Homework ${num}${topicSuffix}` : `Homework${topicSuffix}`;

  const isQuiz = /(?:الكويز|كويز|الاختبار\s*القصير|اختبار\s*قصير)|\b(?:quiz(?:zes)?)\b/i.test(mainPart) || taskType === 'quiz';
  if (isQuiz) return num ? `Quiz ${num}${topicSuffix}` : `Quiz${topicSuffix}`;

  const isLab = /(?:تقرير\s*(?:مختبر|معمل)?|مختبر|معمل)|\b(?:lab\s*report|labs?|experiments?)\b/i.test(mainPart) || taskType === 'lab';
  if (isLab) {
    const prefix = /(?:تقرير|\breport\b)/i.test(mainPart) ? 'Lab Report' : 'Lab';
    return num ? `${prefix} ${num}${topicSuffix}` : `${prefix}${topicSuffix}`;
  }

  const isProject = /(?:المشروع|مشروع|البحث\s*(?:العلمي)?|بحث)|\b(?:projects?|proposals?)\b/i.test(mainPart) || taskType === 'project';
  if (isProject) return num ? `Course Project ${num}${topicSuffix}` : `Course Project${topicSuffix}`;

  if (/(?:عرض\s*تقديمي|عرض|بريزنتيشن)|\b(?:presentations?)\b/i.test(mainPart)) return `Presentation${topicSuffix}`;

  if (/[\u0600-\u06FF]/.test(title)) {
    if (taskType && taskType !== 'other') {
      const cap = taskType.charAt(0).toUpperCase() + taskType.slice(1);
      return num ? `${cap} ${num}` : cap;
    }
    return 'Course Assessment';
  }

  return title;
}

/**
 * Merges existing announcement descriptions with newly posted professor updates,
 * preserving existing syllabus details and appending new professor information under a clear header.
 */
export function mergeAnnouncementTexts(existingText?: string, incomingText?: string): string {
  const ex = (existingText || '').trim();
  const inc = (incomingText || '').trim();

  const isSynthetic = (s: string) => !s || s.toLowerCase() === 'gradebook' || /^gbcol_/i.test(s);
  if (isSynthetic(ex) && isSynthetic(inc)) return '';
  if (isSynthetic(ex)) return inc;
  if (isSynthetic(inc)) return ex;
  if (ex === inc) return ex;
  if (ex.includes(inc)) return ex;
  if (inc.includes(ex)) return inc;

  const normEx = ex.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  const normInc = inc.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
  if (normEx === normInc) return ex.length >= inc.length ? ex : inc;
  if (normEx.includes(normInc)) return ex;
  if (normInc.includes(normEx)) return inc;

  const incParagraphs = inc.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const newParagraphs: string[] = [];
  for (const p of incParagraphs) {
    const pNorm = p.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
    if (pNorm.length >= 5 && !normEx.includes(pNorm)) newParagraphs.push(p);
  }

  if (newParagraphs.length === 0) return ex.length >= inc.length ? ex : inc;
  return `${ex}\n\n[Professor Update]:\n${newParagraphs.join('\n\n')}`;
}
