import { Announcement, DeadlineTask, TaskSubmissionUpdate, TaskType } from '../types';
import { parseCourseDetails, sanitizeDoctorAnnouncementText } from '../core/courseHelper';
import { resolveTaskWeight, extractExplicitPoints, extractAssessmentNumber } from '../core/syllabusWeights';
import { resolveTaskRoom } from '../core/courseSchedule';

/**
 * Parses direct deadline cards from Blackboard Ultra activity stream timeline.
 * Example card text from user:
 * "Calculus I for Engineering - 02 - حسبان 1 للمهندسين
 * Due: Assignment-1-Graded
 * Due Date: 9/18/26, 11:59 PM (UTC+4)"
 */
export function parseDirectStreamCard(cardText: string): DeadlineTask | null {
  if (!cardText) return null;

  // 1. Skip submission receipts, confirmation cards, and grade posted alerts
  if (/(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number|grade\s+posted|score\s+posted|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة)/i.test(cardText)) {
    return null;
  }

  // Regex for "Due Date: 9/18/26, 11:59 PM (UTC+4)" or Arabic equivalent
  const dueDateRegex = /(?:Due Date:\s*|تاريخ الاستحقاق:\s*)(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*\((?:UTC)?([+-]?\d+)?\))?/i;
  const dateMatch = cardText.match(dueDateRegex);
  if (!dateMatch) return null;

  let month = parseInt(dateMatch[1], 10);
  let day = parseInt(dateMatch[2], 10);
  let year = parseInt(dateMatch[3], 10);
  if (year < 100) year += 2000;
  let hour = parseInt(dateMatch[4], 10);
  let minute = parseInt(dateMatch[5], 10);
  const isPm = dateMatch[6].toUpperCase() === 'PM';
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  // The card states the time in the viewer's Blackboard time zone, e.g. "(UTC+4)". Honour it so the
  // stored instant is right even when the browser is set to a different time zone.
  const offsetHours = dateMatch[7] !== undefined ? parseInt(dateMatch[7], 10) : NaN;
  const dueDate = !isNaN(offsetHours) && Math.abs(offsetHours) <= 14
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offsetHours * 3600 * 1000)
    : new Date(year, month - 1, day, hour, minute, 0, 0);

  // Extract task title: "Due: <Title>" or "تسليم: <Title>"
  const dueRegex = /(?:Due:\s*|تسليم:\s*)([^\n\r]+)/i;
  const dueMatch = cardText.match(dueRegex);
  let title = dueMatch ? dueMatch[1].trim() : '';

  // Extract course line (usually before "Due:")
  const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let rawCourseText = '';
  const dueIndex = lines.findIndex(l => /(?:Due:|تسليم:)/i.test(l));
  if (dueIndex > 0) {
    const candidate = lines[dueIndex - 1];
    if (!/(?:Due\s*Date|تاريخ\s*الاستحقاق|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(candidate)) {
      rawCourseText = candidate;
    }
  } else if (lines.length > 0 && !/(?:Due:|تسليم:|Due\s*Date|تاريخ\s*الاستحقاق|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(lines[0])) {
    rawCourseText = lines[0];
  }

  // If title was not after "Due:", take the lab report or experiment name from cardText
  if (!title && /lab\.?\s*report|\bexp(?:eriment)?\b/i.test(cardText)) {
    const match = cardText.match(/([^\n\r,]+(?:Lab\.?\s*Report|Exp\.?))/i);
    title = match ? match[1].trim() : 'Lab Report';
  }

  // Sanitize title: strip "Due in 2 days", "Reminder:", etc.
  if (title) {
    title = title.replace(/^(?:due\s*(?:in|date)?|reminder|announcement)[:\s-]*/i, '').trim();
  }

  const courseInfo = parseCourseDetails(rawCourseText);

  // If title is missing or generic (e.g. "Assignment", "Due in...", "Untitled") AND course is generic, discard!
  const isGenericTitle = !title || /^(?:assignment|due(?:\s+in.*)?|untitled|reminder|activity|announcement)$/i.test(title);
  const isGenericCourse = !courseInfo.name || 
                          courseInfo.name === 'General Course' || 
                          courseInfo.name.toLowerCase() === 'uos' ||
                          /^due[:\s-]/i.test(courseInfo.name);
  if (isGenericTitle && isGenericCourse) {
    return null;
  }

  if (!title) {
    title = 'Assignment';
  }

  // Identify type
  let type: TaskType = 'assignment';
  if (/quiz|كويز/i.test(title)) type = 'quiz';
  else if (/exam|midterm|final|امتحان/i.test(title)) type = 'exam';
  else if (/project|مشروع|بحث/i.test(title)) type = 'project';
  else if (/hw|homework|واجب/i.test(title)) type = 'assignment';

  const cleanCourseCode = (courseInfo.code && courseInfo.code !== 'UOS') ? courseInfo.code : '';
  const taskId = `stream_${cleanCourseCode || 'task'}_${title.slice(0, 15).replace(/\s+/g, '')}_${dueDate.getTime()}`;

  const weightInfo = resolveTaskWeight({
    title,
    courseName: courseInfo.name,
    courseCode: cleanCourseCode,
    type,
    sourceSnippet: dateMatch[0]
  });

  return {
    id: taskId,
    courseCode: cleanCourseCode,
    courseName: courseInfo.name,
    title,
    description: '',
    dueDate: dueDate.toISOString(),
    hasSpecificTime: true,
    type,
    priority: 'high',
    status: 'pending',
    sourceSnippet: dateMatch[0],
    confidence: 1.0,
    extractedBy: 'local',
    weight: weightInfo.weight,
    weightDisplay: weightInfo.weightDisplay,
    syllabusNote: weightInfo.syllabusNote,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Parses submission confirmations or grade notification cards from the activity stream.
 * Converts receipts and posted scores into structured TaskSubmissionUpdate objects.
 */
export function parseSubmissionOrGradeCard(cardText: string): import('../types').TaskSubmissionUpdate | null {
  if (!cardText || cardText.length < 5) return null;

  const isSubmission = /(?:you\s+submitted|submission\s+(?:receipt|confirmed)|attempt\s+submitted|تم\s+التسليم|تم\s+إرسال|confirmation\s*number)/i.test(cardText);
  const isGraded = /(?:grade\s+posted|score\s+posted|graded|new\s+grade|grades\s+available|grades\s+released|تم\s+نشر\s+الدرجة|تم\s+رصد\s+الدرجة|درجة\s+جديدة|تم\s+تقييم)/i.test(cardText) ||
    /^\s*["']?\s*\.?\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*["']?\s*$/m.test(cardText);

  if (!isSubmission && !isGraded) return null;

  const lines = cardText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const courseLine = lines[0];
  const { name: courseName, code: courseCode } = parseCourseDetails(courseLine);

  let title = '';
  if (lines.length >= 2) {
    title = lines[1]
      // "Grade posted: HW1" must become "HW1", or the mark never finds its task
      .replace(/^(?:due|graded|grade\s+posted|score\s+posted|new\s+grade(?:\s+available)?|grades?\s+(?:available|released)|grade|you\s+submitted|assignment)\s*:?\s*/i, '')
      .replace(/^(?:تسليم|تم\s+رصد(?:\s+الدرجة)?|تم\s+نشر\s+الدرجة|درجة\s+جديدة)\s*:?\s*/i, '')
      .trim();
  }

  // Look for confirmation receipt
  const receiptMatch = cardText.match(/confirmation\s*(?:number|#)?[:\s]*([#\w-]+)/i);
  const receipt = receiptMatch ? receiptMatch[1] : undefined;

  // Look for submitted date
  const dateMatch = cardText.match(/(?:submitted\s+(?:on\s+)?|تم\s+التسليم\s+في\s+)(\d{1,2}\/\d{1,2}\/\d{2,4}(?:[,\s]+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)/i);
  const submittedAt = dateMatch ? dateMatch[1] : undefined;

  // Pure submission confirmation cards must never invent a score from point values in the title
  if (isSubmission && !isGraded) {
    return {
      courseName: courseName !== 'General Course' ? courseName : undefined,
      courseCode: (courseCode && courseCode !== 'UOS') ? courseCode : undefined,
      title: title || 'Assignment',
      submissionStatus: 'submitted',
      submittedAt,
      submissionReceipt: receipt
    };
  }

  // Look for score fraction: e.g. "9.5 / 10", ".25 / 10", "10/10"
  // Must avoid calendar date fractions like 10/12/26 or 9/18/26
  const fractionMatch = cardText.match(/(?:grade|score|mark|pts?|points?|درجة|علامة)[:\s]*(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[\/\-]\s*\d{2,4})/i) ||
    cardText.match(/^\s*["']?\s*(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*["']?\s*$/m) ||
    cardText.match(/\b(\.?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(?:pts?|points?|marks?|درجة)(?!\s*[\/\-]\s*\d{2,4})/i);
  let score: number | undefined;
  let maxScore: number | undefined;
  let scoreDisplay: string | undefined;

  if (fractionMatch) {
    score = parseFloat(fractionMatch[1]);
    maxScore = parseFloat(fractionMatch[2]);
    if (!isNaN(score) && !isNaN(maxScore) && maxScore > 0) {
      const pct = Math.round((score / maxScore) * 100);
      scoreDisplay = `${score} / ${maxScore} (${pct}%)`;
    }
  }

  // Look for percentage: e.g. "95%"
  if (score === undefined) {
    const pctMatch = cardText.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      score = parseFloat(pctMatch[1]);
      maxScore = 100;
      scoreDisplay = `${score}%`;
    }
  }

  if (score !== undefined || (isGraded && !isSubmission)) {
    return {
      courseName: courseName !== 'General Course' ? courseName : undefined,
      courseCode: (courseCode && courseCode !== 'UOS') ? courseCode : undefined,
      title: title || 'Assignment',
      submissionStatus: 'graded',
      score,
      maxScore,
      scoreDisplay: scoreDisplay || (score !== undefined ? `${score} pts` : undefined),
      submittedAt,
      submissionReceipt: receipt
    };
  }

  if (isSubmission) {
    return {
      courseName: courseName !== 'General Course' ? courseName : undefined,
      courseCode: (courseCode && courseCode !== 'UOS') ? courseCode : undefined,
      title: title || 'Assignment',
      submissionStatus: 'submitted',
      submittedAt,
      submissionReceipt: receipt
    };
  }

  return null;
}

const cleanTitle = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
const cleanCode = (s?: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const cleanName = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');

/**
 * The words that identify an item, without filler: "Free Fall Exp. Student's Lab Report" and
 * "Free Fall Exp. - Lab Report" both become "freefall"; "2nd Quiz (Vector & Free Fall)" becomes "quiz2".
 */
export function coreTitle(s?: string): string {
  if (!s) return '';
  let str = s.toLowerCase();

  // Strip weight and percentage mentions (e.g. "worth 25%", "(25%)", "10%", "بنسبة 20%")
  str = str.replace(/\bworth\s*\d+(?:\.\d+)?%?/gi, ' ');
  str = str.replace(/(?:بنسبة|وزن)?\s*\d+(?:\.\d+)?%/gi, ' ');
  str = str.replace(/\(\s*\d+(?:\.\d+)?\s*%\s*\)/gi, ' ');

  // Normalize course acronyms and exam words so "EAP Midterm Exam" matches "Midterm"
  str = str.replace(/\bmidterm\s+(?:exam|examination|test)\b/gi, 'midterm');
  str = str.replace(/\bfinal\s+(?:exam|examination|test)\b/gi, 'final');

  // Arabic exam normalization
  str = str.replace(/(?:امتحان|اختبار)\s*(?:نصفي|منتصف\s*الفصل)|(?:الامتحان|الاختبار)\s*(?:النصفي)/gi, 'midterm');
  str = str.replace(/(?:امتحان|اختبار)\s*(?:نهائي|فصلي)|(?:الامتحان|الاختبار)\s*(?:النهائي)/gi, 'final');

  // Normalize delivery modes and qualifiers: in-class, online, paper, take-home
  str = str.replace(/\b(?:in[\s_-]*class|take[\s_-]*home|paper|online|bonus)\b/gi, ' ');

  // Normalize ordinals + assessment type into "<type><number>"
  // e.g. "2nd Quiz" -> "quiz 2", "second quiz" -> "quiz 2", "الكويز الثاني" -> "quiz 2"
  str = str.replace(/\b(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(quiz|exam|test|midterm|assignment|homework|hw|lab)\b/gi, '$2 $1');
  str = str.replace(/\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(quiz|exam|test|midterm|assignment|homework|hw|lab)\b/gi, (_, ord, typ) => {
    const ordMap: Record<string, number> = {
      first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
      sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
    };
    return `${typ} ${ordMap[ord.toLowerCase()] || ord}`;
  });
  str = str.replace(/\b(quiz|exam|test|midterm|assignment|homework|hw|lab)\s+(?:#|no\.?)?\s*(i{1,3}|iv|v|vi{0,3}|ix|x)\b/gi, (_, typ, rom) => {
    const romMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5,
      vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    return `${typ} ${romMap[rom.toLowerCase()] || rom}`;
  });

  const arOrdMap: Record<string, number> = {
    'اول': 1, 'أول': 1, 'ثاني': 2, 'ثانى': 2, 'ثالث': 3, 'رابع': 4, 'خامس': 5,
    'سادس': 6, 'سابع': 7, 'ثامن': 8, 'تاسع': 9, 'عاشر': 10
  };

  str = str.replace(/(?:الكويز|كويز|الاختبار|اختبار)\s+(?:ال)?(اول|أول|ثاني|ثانى|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر)/gi, (_, ord) => {
    return `quiz ${arOrdMap[ord] || 1}`;
  });
  str = str.replace(/(?:الواجب|واجب)\s+(?:ال)?(اول|أول|ثاني|ثانى|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر)/gi, (_, ord) => {
    return `assignment ${arOrdMap[ord] || 1}`;
  });
  str = str.replace(/(?:التقرير|تقرير)\s+(?:ال)?(اول|أول|ثاني|ثانى|ثالث|رابع|خامس|سادس|سابع|ثامن|تاسع|عاشر)/gi, (_, ord) => {
    return `lab ${arOrdMap[ord] || 1}`;
  });
  str = str.replace(/(?:المشروع|مشروع|البحث|بحث)\s+(?:ال)?(اول|أول|ثاني|ثانى|ثالث|رابع|خامس)/gi, (_, ord) => {
    return `project ${arOrdMap[ord] || 1}`;
  });

  // Arabic types with digit numbers: واجب 1, كويز 2, تقرير 3, مشروع 1
  str = str.replace(/(?:الكويز|كويز|الاختبار|اختبار)\s*#?\s*(\d+)/gi, 'quiz $1');
  str = str.replace(/(?:الواجب|واجب)\s*#?\s*(\d+)/gi, 'assignment $1');
  str = str.replace(/(?:التقرير|تقرير)\s*#?\s*(\d+)/gi, 'lab $1');
  str = str.replace(/(?:المشروع|مشروع|البحث|بحث)\s*#?\s*(\d+)/gi, 'project $1');

  // Generic exam normalization: if an exam title has no ordinal/number, collapse to core exam name
  if (!/\d/.test(str)) {
    if (/\bmidterm\b/.test(str)) str = 'midterm';
    else if (/\bfinal\b/.test(str)) str = 'final';
  }

  return str
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:pts?|points?|marks?|درجات|درجة|علامات|علامة)/gi, ' ')
    .replace(/(?:تمديد\s*(?:فترة|موعد)?\s*(?:تسليم)?|موعد\s*تسليم|فترة\s*تسليم|(?:و)?محاولات\s*التسليم)/gi, ' ')
    .replace(/\b(?:graded|grades?|marks?|score|submission|submit)\b/g, ' ')
    .replace(/\b(?:students?'?s?|student's|exp|experiment|lab|labs|report|the|of|exam|examination)\b\.?/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff]/g, '');
}

/**
 * Finds the task a posted mark or submission belongs to. The course must agree when both
 * sides know it, and an exact title wins over a partial one, so "Quiz 1" in Calculus never
 * takes the Quiz 1 mark of another course.
 */
/** Practice runs, mock exams and sample papers are separate items from the real one. */
const PRACTICE_RE = /\b(?:practice|practise|mock|sample|trial|dry\s*run|rehearsal|review|revision|preparation|prep)\b|تجريبي|تدريبي|مراجعة/i;
export function isPracticeTitle(s?: string): boolean {
  return PRACTICE_RE.test(s || '');
}

/** A title's words sorted, so word order does not matter. */
function wordsKey(s?: string): string {
  return ((s || '').toLowerCase().match(/[a-z0-9؀-ۿ]+/g) || []).sort().join(' ');
}

/** The numbers in a title ("Quiz 1" -> ["1"]), ignoring point values like "(10 درجات)" or "15 درجة". */
function titleNumbers(s?: string): string[] {
  const cleaned = (s || '')
    .replace(/\bworth\s*\d+(?:\.\d+)?%?/gi, ' ')
    .replace(/(?:بنسبة|وزن)?\s*\d+(?:\.\d+)?%/gi, ' ')
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:pts?|points?|marks?|درجات|درجة|علامات|علامة|%)?\s*\)/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:pts?|points?|marks?|درجات|درجة|علامات|علامة|%)/gi, ' ');
  return (cleaned.match(/\d+/g) || []).map(n => String(Number(n)));
}

/** One side's numbers must all appear on the other ("HW1" fits "HW1_Phys.1_Fall26-27"; "Quiz 1" does not fit "Quiz 10"). */
function numbersAgree(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  return a.every(n => b.includes(n)) || b.every(n => a.includes(n));
}

/** Codes match when one is the other with a section suffix ("1440133" and "144013301"). */
function sameCode(a: string, b: string): boolean {
  return a === b || (a.length >= 6 && b.length >= 6 && (a.startsWith(b) || b.startsWith(a)));
}

const ULTRA_GENERIC_RE = /^(?:assignment|homework|hw\d*|quiz|test|exam|midterm|final|lab|report|project|task|due|untitled|واجب|كويز|امتحان|اختبار|تقرير|مشروع)$/i;
const isExamTitle = (s?: string) => /\b(?:exam|mid[\s_-]*term|final)\b|امتحان|اختبار\s*(?:نصفي|نهائي|فصلي)/i.test(s || '');

export function findAllTasksForUpdate(
  tasks: DeadlineTask[],
  update: import('../types').TaskSubmissionUpdate,
  accept?: (t: DeadlineTask) => boolean
): DeadlineTask[] {
  const want = cleanTitle(update.title);
  if (want.length < 2) return [];
  const upRes = parseCourseDetails(`${update.courseCode || ''} ${update.courseName || ''}`);
  const upCode = cleanCode(upRes.code === 'UOS' ? '' : upRes.code);
  const upName = cleanName(upRes.name === 'General Course' ? '' : upRes.name);
  const upColId = update.sourceId ? update.sourceId.replace(/^(?:gb:|col_)/, '') : '';

  const scored: { task: DeadlineTask; rank: number }[] = [];
  const upPractice = isPracticeTitle(update.title);
  const upNumbers = titleNumbers(update.title);
  const upNum = extractAssessmentNumber(update.title);
  const isUpExam = isExamTitle(update.title);
  const isUpMid = /(?:\bmidterm\b|نصفي)/i.test(update.title);
  const isUpFin = /(?:\bfinal\b|نهائي)/i.test(update.title);
  const isUpQuiz = /quiz|كويز/i.test(update.title);
  const isUpLab = /lab|تقرير/i.test(update.title);
  const isUpAssign = /assignment|hw|homework|واجب/i.test(update.title);
  for (const t of tasks) {
    if (accept && !accept(t)) continue;
    // A gradebook column task (gbcol_<course>_<colId>) only accepts gradebook updates from its own column
    const tColMatch = (t.id || '').match(/^gbcol_.*(_\d+_\d+)$/);
    if (tColMatch && upColId && tColMatch[1] !== upColId) continue;

    const res = parseCourseDetails(`${t.courseCode || ''} ${t.courseName || ''}`);
    const tCode = cleanCode(res.code === 'UOS' ? '' : res.code);
    const tName = cleanName(res.name === 'General Course' ? '' : res.name);
    const namesAgree = !!upName && !!tName && (tName.includes(upName) || upName.includes(tName));
    let courseKnown = false;
    let courseExact = false;
    if (upCode && tCode && sameCode(upCode, tCode)) {
      courseKnown = true;
      courseExact = true;
    } else if (upCode && tCode && !namesAgree) {
      // Different codes and no agreeing name: another course
      continue;
    } else if (upName && tName) {
      // Codes written differently (a task added by hand carries the code from the course list) fall back to the name
      if (!namesAgree) continue;
      courseKnown = true;
      // "Physics 1" is inside "Physics 1 Lab": the exact course must win
      courseExact = tName === upName;
    }
    // A practice mark never lands on the real item, and the other way round
    if (isPracticeTitle(t.title) !== upPractice) continue;
    // Explicit point values in the title (e.g. "15 درجة", "10 pts") must agree with update.maxScore;
    // syllabus weights (e.g. "worth 25%", "20%") do not bound update.maxScore
    const isWeightPhrase = /(?:worth\s*\d|\bweight\b|%|بنسبة|وزن)/i.test(t.title);
    if (!isWeightPhrase) {
      const tExplicit = extractExplicitPoints(t.title);
      if (tExplicit && update.maxScore && Math.abs(tExplicit - update.maxScore) > 0.5) continue;
    }
    // "Quiz 1" and "Quiz 10" share letters but not numbers
    const tNumbers = titleNumbers(t.title);
    if (!numbersAgree(tNumbers, upNumbers)) continue;
    const have = cleanTitle(t.title);
    if (have.length < 2) continue;
    const exact = have === want;
    if (!courseKnown) {
      if (!exact) continue;
      if (ULTRA_GENERIC_RE.test(update.title.trim()) || ULTRA_GENERIC_RE.test(t.title.trim())) continue;
    }
    let matchedApprox = false;
    if (!exact) {
      if (!courseKnown) continue;
      const core = coreTitle(t.title);
      const sameCore = core.length >= 3 && core === coreTitle(update.title);
      const sameWords = wordsKey(t.title).length >= 4 && wordsKey(t.title) === wordsKey(update.title);
      const sub = (have.includes(want) || want.includes(have)) && !ULTRA_GENERIC_RE.test(update.title.trim()) && !ULTRA_GENERIC_RE.test(t.title.trim());

      const tNum = extractAssessmentNumber(t.title);
      const isTQuiz = /quiz|كويز/i.test(t.title);
      const isTLab = /lab|تقرير/i.test(t.title);
      const isTAssign = /assignment|hw|homework|واجب/i.test(t.title);
      const numAgree = Boolean(
        tNum !== null && upNum !== null && tNum === upNum && (
          (isUpQuiz && isTQuiz) ||
          (isUpLab && isTLab) ||
          (isUpAssign && isTAssign)
        )
      );

      const examAgree = Boolean(
        (t.type === 'exam' || isExamTitle(t.title)) && isUpExam && (
          (isUpMid && /(?:\bmidterm\b|نصفي)/i.test(t.title)) ||
          (isUpFin && /(?:\bfinal\b|نهائي)/i.test(t.title))
        ) && (tNum === null || upNum === null || tNum === upNum)
      );

      if (!sameCore && !sameWords && !sub && !numAgree && !examAgree) continue;
      matchedApprox = Boolean(sameCore || numAgree || examAgree);
    }
    scored.push({ task: t, rank: (courseExact ? 6 : 0) + (courseKnown ? 3 : 0) + (exact ? 2 : 0) + (matchedApprox ? 1 : 0) });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.rank - a.rank);
  // With no course to go on, only a single candidate is safe
  const hasCourse = Boolean(upCode || upName);
  if (!hasCourse && scored.filter(s => s.rank === scored[0].rank).length > 1) return [];
  return scored.map(s => s.task);
}

export function findTaskForUpdate(
  tasks: DeadlineTask[],
  update: import('../types').TaskSubmissionUpdate,
  accept?: (t: DeadlineTask) => boolean
): DeadlineTask | undefined {
  return findAllTasksForUpdate(tasks, update, accept)[0];
}

function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/**
 * Parses Blackboard Ultra's `POST /learn/api/v1/streams/ultra` response (`sv_streamEntries`)
 * into direct due-date tasks, announcements, and grade/submission updates without needing a DOM.
 */
export function parseUltraStreamEntries(
  payload: any,
  coursesById: Map<string, { name: string; code: string }>,
  baseUrl: string = '',
  nowIso: string = new Date().toISOString()
): {
  directTasks: DeadlineTask[];
  announcements: Announcement[];
  submissionUpdates: TaskSubmissionUpdate[];
} {
  const directTasks: DeadlineTask[] = [];
  const announcements: Announcement[] = [];
  const submissionUpdates: TaskSubmissionUpdate[] = [];
  const entries: any[] = Array.isArray(payload?.sv_streamEntries)
    ? payload.sv_streamEntries
    : Array.isArray(payload?.results)
      ? payload.results
      : [];

  const seenDirectIds = new Set<string>();
  const seenAnnIds = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const courseId = String(entry.se_courseId || '');
    const courseMeta = coursesById.get(courseId);
    const parsedCourse = courseMeta
      ? parseCourseDetails(`${courseMeta.code || ''} ${courseMeta.name || ''}`.trim())
      : { name: 'General Course', code: '' };
    const courseName = (courseMeta?.name && courseMeta.name !== 'General Course')
      ? courseMeta.name
      : parsedCourse.name;
    const courseCode = (courseMeta?.code && courseMeta.code !== 'UOS')
      ? courseMeta.code
      : (parsedCourse.code !== 'UOS' ? parsedCourse.code : '');

    // Skip orientation / mock sandbox courses
    if (/orientation|توجيه|تهيئة/i.test(courseName) || /orientation/i.test(courseCode) || /orientation/i.test(courseId)) continue;

    const providerId = String(entry.providerId || '');
    const itemData = entry.itemSpecificData || {};
    const notif = itemData.notificationDetails || {};
    const rawTitle = stripHtmlTags(itemData.title || notif.announcementTitle || '').trim();

    if (providerId === 'bb-announcement' || notif.announcementTitle || notif.announcementBody) {
      const annIdRaw = notif.sourceId || entry.se_id || '';
      const annTitle = rawTitle || stripHtmlTags(notif.announcementTitle || '');
      const bodyHtml = String(notif.announcementBody || itemData.body || entry.se_context || '');
      const bodyText = sanitizeDoctorAnnouncementText(stripHtmlTags(bodyHtml) || annTitle, courseName, courseCode, annTitle);
      if (annTitle && bodyText.length > 5) {
        const id = annIdRaw ? `ann_ultra_${annIdRaw}` : `ann_stream_${courseId}_${annTitle.slice(0, 15).replace(/\s+/g, '')}`;
        if (!seenAnnIds.has(id)) {
          seenAnnIds.add(id);
          announcements.push({
            id,
            courseCode,
            courseName,
            title: annTitle,
            postedAt: notif.startDate || entry.se_timestamp || nowIso,
            contentText: bodyText,
            contentHtml: bodyHtml,
            sourceUrl: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/ultra/stream` : '',
            scannedAt: nowIso
          });
        }
      }
      continue;
    }

    if (providerId === 'bb_mygrades' || itemData.gradeDetails) {
      const gd = itemData.gradeDetails || {};
      if (gd.isExempt || (gd.calculationType && gd.calculationType !== 'NON_CALCULATED')) continue;
      if (!rawTitle || /attendance/i.test(rawTitle) || /orientation|توجيه|تهيئة/i.test(rawTitle)) continue;

      const rhs = String(entry.se_rhs || '');
      const colMatch = rhs.match(/gradable_item_id=(_\d+_\d+)/);
      const sourceId = colMatch ? `gb:${colMatch[1]}` : undefined;
      const scoreNum = typeof gd.displayGradeScore === 'number'
        ? gd.displayGradeScore
        : (typeof gd.displayGradeScore === 'string' && gd.displayGradeScore.trim() !== '' ? Number(gd.displayGradeScore) : NaN);
      const maxNum = typeof gd.pointsPossible === 'number'
        ? gd.pointsPossible
        : (typeof gd.pointsPossible === 'string' ? Number(gd.pointsPossible) : NaN);
      const gradedAt = gd.lastGradedDate || gd.gradedDate || entry.se_timestamp;

      if (!isNaN(scoreNum)) {
        const score = Math.round(scoreNum * 100) / 100;
        const maxScore = !isNaN(maxNum) && maxNum > 0 ? Math.round(maxNum * 100) / 100 : undefined;
        submissionUpdates.push({
          courseName: courseName !== 'General Course' ? courseName : undefined,
          courseCode: courseCode || undefined,
          title: rawTitle,
          sourceId,
          gradedAt: gradedAt && !isNaN(new Date(gradedAt).getTime()) ? gradedAt : undefined,
          submissionStatus: 'graded',
          score,
          maxScore,
          scoreDisplay: maxScore ? `${score} / ${maxScore} (${Math.round((score / maxScore) * 100)}%)` : `${score} pts`
        });
      }
      continue;
    }

    if (providerId === 'bb-nautilus' && notif.dueDate && rawTitle) {
      const eventType = String(notif.eventType || '');
      // Skip non-deadline notifications or file-upload noise
      if (/^(?:added|updated|edited|new\s+content)\s*:/i.test(rawTitle)) continue;
      if (/orientation|توجيه|تهيئة/i.test(rawTitle)) continue;
      if (eventType && /GRADED|SUBMITTED/i.test(eventType)) continue;

      const due = new Date(notif.dueDate);
      if (isNaN(due.getTime())) continue;
      if (courseName === 'General Course' && !courseCode) continue;

      const cleanTaskTitle = rawTitle.replace(/^(?:due\s*(?:in|date)?|reminder|announcement)[:\s-]*/i, '').trim();
      if (!cleanTaskTitle) continue;

      let type: TaskType = 'assignment';
      if (/quiz|كويز|اختبار\s*قصير/i.test(cleanTaskTitle)) type = 'quiz';
      else if (/\b(?:exam|mid[\s_-]*term|final)\b|امتحان/i.test(cleanTaskTitle)) type = 'exam';
      else if (/project|مشروع|بحث/i.test(cleanTaskTitle)) type = 'project';

      const taskId = `stream_${courseCode || 'task'}_${cleanTaskTitle.slice(0, 15).replace(/\s+/g, '')}_${due.getTime()}`;
      if (seenDirectIds.has(taskId)) continue;
      seenDirectIds.add(taskId);

      const weightInfo = resolveTaskWeight({
        title: cleanTaskTitle,
        courseName,
        courseCode,
        type,
        sourceSnippet: cleanTaskTitle
      });
      const roomInfo = resolveTaskRoom({
        courseNameOrCode: courseName || courseCode,
        title: cleanTaskTitle,
        type
      });

      directTasks.push({
        id: taskId,
        courseCode,
        courseName,
        title: cleanTaskTitle,
        description: '',
        dueDate: due.toISOString(),
        hasSpecificTime: true,
        type,
        priority: 'high',
        status: 'pending',
        sourceSnippet: `Due Date: ${due.toISOString()}`,
        confidence: 1.0,
        extractedBy: 'local',
        weight: weightInfo.weight,
        weightDisplay: weightInfo.weightDisplay,
        syllabusNote: weightInfo.syllabusNote,
        room: roomInfo.room || undefined,
        createdAt: nowIso,
        updatedAt: nowIso
      });
    }
  }

  return { directTasks, announcements, submissionUpdates };
}
