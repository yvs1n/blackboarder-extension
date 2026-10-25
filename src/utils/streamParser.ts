import { DeadlineTask, TaskType } from '../types';
import { parseCourseDetails } from '../core/courseHelper';
import { resolveTaskWeight } from '../core/syllabusWeights';

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

  // If title was not after "Due:", extract meaningful lab/assignment name from cardText
  if (!title) {
    if (/measuring\s*density/i.test(cardText)) {
      title = 'Measuring Density - Lab Report';
    } else if (/free\s*fall/i.test(cardText)) {
      title = 'Free Fall Exp. - Lab Report';
    } else if (/lab\.?\s*report/i.test(cardText)) {
      const match = cardText.match(/([^\n\r,]+(?:Lab\.?\s*Report|Exp\.?))/i);
      title = match ? match[1].trim() : 'Lab Report';
    }
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

  // Look for confirmation receipt
  const receiptMatch = cardText.match(/confirmation\s*(?:number|#)?[:\s]*([#\w-]+)/i);
  const receipt = receiptMatch ? receiptMatch[1] : undefined;

  // Look for submitted date
  const dateMatch = cardText.match(/(?:submitted\s+(?:on\s+)?|تم\s+التسليم\s+في\s+)(\d{1,2}\/\d{1,2}\/\d{2,4}(?:[,\s]+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)/i);
  const submittedAt = dateMatch ? dateMatch[1] : undefined;

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
  return (s || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:graded|grades?|marks?|score|submission|submit)\b/g, ' ')
    .replace(/\b(\d+)(?:st|nd|rd|th)\s+(quiz|exam|test|assignment|homework|hw|lab)\b/g, '$2 $1')
    .replace(/\b(?:students?'?s?|student's|exp|experiment|lab|labs|report|the|of)\b\.?/g, ' ')
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

/** The numbers in a title ("Quiz 1" -> ["1"]). */
function titleNumbers(s?: string): string[] {
  return ((s || '').match(/\d+/g) || []).map(n => String(Number(n)));
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

export function findTaskForUpdate(
  tasks: DeadlineTask[],
  update: import('../types').TaskSubmissionUpdate,
  accept?: (t: DeadlineTask) => boolean
): DeadlineTask | undefined {
  const want = cleanTitle(update.title);
  if (want.length < 3) return undefined;
  const upCode = cleanCode(update.courseCode === 'UOS' ? '' : update.courseCode);
  const upName = cleanName(update.courseName);

  const scored: { task: DeadlineTask; rank: number }[] = [];
  const upPractice = isPracticeTitle(update.title);
  const upNumbers = titleNumbers(update.title);
  for (const t of tasks) {
    if (accept && !accept(t)) continue;
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
    // "Quiz 1" and "Quiz 10" share letters but not numbers
    const tNumbers = titleNumbers(t.title);
    if (!numbersAgree(tNumbers, upNumbers)) continue;
    const have = cleanTitle(t.title);
    if (have.length < 3) continue;
    const exact = have === want;
    if (!exact && !have.includes(want) && !want.includes(have)) {
      // Looser match on the identifying words, only inside a course known to be the same
      const core = coreTitle(t.title);
      const sameCore = core.length >= 4 && core === coreTitle(update.title);
      // Same words in another order ("Practice Midterm" / "Midterm Practice")
      const sameWords = wordsKey(t.title).length >= 4 && wordsKey(t.title) === wordsKey(update.title);
      if (!courseKnown || (!sameCore && !sameWords)) continue;
    }
    scored.push({ task: t, rank: (courseExact ? 4 : 0) + (courseKnown ? 2 : 0) + (exact ? 1 : 0) });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.rank - a.rank);
  // With no course to go on, only a single candidate is safe
  if (scored[0].rank < 2 && scored.filter(s => s.rank === scored[0].rank).length > 1) return undefined;
  return scored[0].task;
}
