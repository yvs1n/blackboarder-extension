/**
 * Reads the Banner Student Exam Page (`StudentExamPage`) table and turns each row into a
 * `DeadlineTask` (Midterm Exam, Final Exam, etc.) with its course, date, start/end time,
 * room, exam method, and syllabus weight.
 */
import type { DeadlineTask } from '../types';
import { resolveCourseInfo, parseCourseDetails } from './courseHelper';
import { getActiveUserCourses, compileCoursePattern } from './userCourses';
import { resolveTaskWeight } from './syllabusWeights';
import { resolveTaskRoom, isPlausibleRoom } from './courseSchedule';

export interface ExamScheduleRow {
  crn: string;
  courseNumber: string;
  courseTitle: string;
  examDate: string;
  fromTime: string;
  toTime: string;
  building: string;
  room: string;
  examType: string;
  examMethod: string;
  comment: string;
}

export interface ParsedExamTime {
  hour: number;
  minute: number;
  display: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function format12Hour(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${pad2(h12)}:${pad2(minute)} ${period}`;
}

/**
 * Parses a Banner exam time such as "08:30AM", "12:30PM", or Banner's 24-hour+PM hybrid
 * like "14:30PM", "17:00PM", "13:30PM", "16:00PM".
 */
export function parseExamTime(raw: string): ParsedExamTime | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const mer = (m[3] || '').toUpperCase();

  if (isNaN(hour) || isNaN(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return null;
  }

  // Banner often outputs 24-hour hours (>= 13) with a redundant "PM" suffix (e.g. "14:30PM")
  if (hour >= 13) {
    // Already 24-hour
  } else if (mer === 'PM' && hour < 12) {
    hour += 12;
  } else if (mer === 'AM' && hour === 12) {
    hour = 0;
  }

  return {
    hour,
    minute,
    display: format12Hour(hour, minute)
  };
}

/**
 * Parses a Banner exam date ("DD/MM/YYYY" or "YYYY-MM-DD") and optional start time into a local Date.
 */
export function parseExamDateTime(examDateRaw: string, fromTimeRaw?: string): { date: Date; hasSpecificTime: boolean } | null {
  const dStr = String(examDateRaw || '').trim();
  if (!dStr) return null;

  let year = 0;
  let month = 0;
  let day = 0;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = dStr.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (dmy) {
    day = parseInt(dmy[1], 10);
    month = parseInt(dmy[2], 10);
    year = parseInt(dmy[3], 10);
  } else {
    // YYYY-MM-DD
    const ymd = dStr.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if (ymd) {
      year = parseInt(ymd[1], 10);
      month = parseInt(ymd[2], 10);
      day = parseInt(ymd[3], 10);
    }
  }

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const parsedTime = fromTimeRaw ? parseExamTime(fromTimeRaw) : null;
  const hour = parsedTime ? parsedTime.hour : 9;
  const minute = parsedTime ? parsedTime.minute : 0;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return {
    date,
    hasSpecificTime: Boolean(parsedTime)
  };
}

/**
 * Normalizes the exam type cell ("MIDTERM", "FINAL", etc.) into a clean task title and key.
 */
export function normalizeExamTypeTitle(examTypeRaw: string): { title: string; kindKey: string } {
  const clean = String(examTypeRaw || '').trim();
  if (/mid[\s_-]*term|نصفي|منتصف/i.test(clean)) {
    return { title: 'Midterm Exam', kindKey: 'midterm' };
  }
  if (/final|نهائي/i.test(clean)) {
    return { title: 'Final Exam', kindKey: 'final' };
  }
  if (!clean) {
    return { title: 'Exam', kindKey: 'exam' };
  }
  const formatted = clean
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, ch => ch.toUpperCase());
  const title = /\bexam\b/i.test(formatted) ? formatted : `${formatted} Exam`;
  const kindKey = clean.toLowerCase().replace(/[^a-z0-9]/g, '') || 'exam';
  return { title, kindKey };
}

/**
 * Formats the exam room from Building, Room, and optional Comment columns.
 * When the Comment column holds a specific room override for the student's section
 * (e.g. "C12 TH005" or "A10-006" while the general column lists "TH007-008"),
 * the comment room is used as the primary room badge and both are preserved in the description.
 */
export function resolveExamRoom(buildingRaw: string, roomRaw: string, commentRaw: string): {
  room: string;
  scheduledHall: string;
  commentRoom: string;
} {
  const bld = String(buildingRaw || '').trim().replace(/\s+/g, ' ');
  const rm = String(roomRaw || '').trim().replace(/\s+/g, ' ');
  const cmt = String(commentRaw || '').trim().replace(/\s+/g, ' ');

  let scheduledHall = '';
  if (bld && rm) {
    if (rm.toUpperCase().startsWith(bld.toUpperCase())) {
      scheduledHall = rm;
    } else if (/^\d/.test(rm) || /^TH\d/i.test(rm) || /^MUL\d/i.test(rm)) {
      scheduledHall = `${bld}-${rm}`;
    } else {
      scheduledHall = `${bld} ${rm}`;
    }
  } else {
    scheduledHall = bld || rm;
  }

  let commentRoom = '';
  if (cmt && isPlausibleRoom(cmt) && /^[A-Za-z]{1,4}\d{1,2}\b/i.test(cmt)) {
    commentRoom = cmt.replace(/^([A-Za-z]\d{1,2})\s+(TH\d+|\d+[A-Za-z]?)$/i, '$1-$2');
  }

  const room = commentRoom || scheduledHall;
  return { room, scheduledHall, commentRoom };
}

function formatExamMethod(raw: string): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (/^paper[\s_-]*based$/i.test(clean)) return 'Paper-based';
  if (/^akindi$/i.test(clean)) return 'Akindi';
  return clean.replace(/_/g, ' ');
}

/**
 * Converts a single ExamScheduleRow into a DeadlineTask, or null if the row has no valid date/course.
 */
export function examScheduleRowToTask(row: ExamScheduleRow, nowIso: string = new Date().toISOString()): DeadlineTask | null {
  if (!row) return null;
  const parsedDate = parseExamDateTime(row.examDate, row.fromTime);
  if (!parsedDate) return null;

  const rawCode = String(row.courseNumber || '').trim().replace(/\s+/g, '');
  const rawTitle = String(row.courseTitle || '').trim();
  if (!rawCode && !rawTitle) return null;

  const parsedCourse = parseCourseDetails(`${rawCode} - ${rawTitle}`);
  const cleanScrapedCode = rawCode || (parsedCourse.code !== 'UOS' ? parsedCourse.code : '');
  const cleanScrapedTitle = rawTitle || (parsedCourse.name !== 'General Course' ? parsedCourse.name : '');

  // Match against the student's Firebase-synced courses first (by code, CRN alias, name, or pattern)
  const userCourses = getActiveUserCourses();
  const normRawCode = cleanScrapedCode.replace(/[\s_-]+/g, '').toLowerCase();
  const normRawTitle = cleanScrapedTitle.toLowerCase();
  const rawCrn = String(row.crn || '').trim().toLowerCase();

  let matchedUserCourse = userCourses.find(uc => {
    const ucCode = (uc.courseCode || '').replace(/[\s_-]+/g, '').toLowerCase();
    if (ucCode && normRawCode && ucCode === normRawCode) return true;
    if (rawCrn && uc.crn && uc.crn.trim().toLowerCase() === rawCrn) return true;
    if (rawCrn && Array.isArray(uc.aliases) && uc.aliases.some(a => a.trim().toLowerCase() === rawCrn)) return true;
    return false;
  });

  if (!matchedUserCourse && (cleanScrapedTitle || cleanScrapedCode)) {
    const combined = `${cleanScrapedCode} ${cleanScrapedTitle}`.trim();
    matchedUserCourse = userCourses.find(uc => {
      const ucName = (uc.courseName || '').trim().toLowerCase();
      if (ucName && normRawTitle && ucName === normRawTitle) return true;
      return compileCoursePattern(uc).test(combined);
    });
  }

  let courseCode = '';
  let courseName = '';
  if (matchedUserCourse) {
    courseCode = matchedUserCourse.courseCode || cleanScrapedCode;
    courseName = matchedUserCourse.courseName || cleanScrapedTitle || courseCode;
  } else {
    courseCode = cleanScrapedCode;
    courseName = cleanScrapedTitle || (cleanScrapedCode ? `Course ${cleanScrapedCode}` : 'General Course');
  }

  const { title, kindKey } = normalizeExamTypeTitle(row.examType);
  const fromParsed = parseExamTime(row.fromTime);
  const toParsed = parseExamTime(row.toTime);
  const timeRangeStr = fromParsed && toParsed
    ? `${fromParsed.display} - ${toParsed.display}`
    : (fromParsed ? fromParsed.display : '');

  const { room: examRoom, scheduledHall, commentRoom } = resolveExamRoom(row.building, row.room, row.comment);
  const fallbackRoom = !examRoom
    ? resolveTaskRoom({ courseNameOrCode: courseName || courseCode, title, type: 'exam' }).room
    : '';
  const finalRoom = examRoom || fallbackRoom || undefined;

  const methodDisplay = formatExamMethod(row.examMethod);
  const commentClean = String(row.comment || '').trim();

  const detailsParts: string[] = [`${title} for ${courseName}${courseCode ? ` (${courseCode})` : ''}.`];
  if (row.examDate.trim()) {
    detailsParts.push(`Date: ${row.examDate.trim()}${timeRangeStr ? ` (${timeRangeStr})` : ''}.`);
  }
  if (commentRoom && scheduledHall && commentRoom !== scheduledHall) {
    detailsParts.push(`Room: ${commentRoom} (Scheduled hall: ${scheduledHall}).`);
  } else if (finalRoom) {
    detailsParts.push(`Room: ${finalRoom}.`);
  }
  if (methodDisplay) {
    detailsParts.push(`Method: ${methodDisplay}.`);
  }
  if (commentClean && !commentRoom) {
    detailsParts.push(`Comment: ${commentClean}.`);
  }
  if (row.crn && row.crn.trim()) {
    detailsParts.push(`CRN: ${row.crn.trim()}.`);
  }

  const description = detailsParts.join(' ');
  const weightInfo = resolveTaskWeight({
    title,
    courseName,
    courseCode,
    type: 'exam',
    description,
    sourceSnippet: description
  });

  const dateKey = `${parsedDate.date.getFullYear()}-${pad2(parsedDate.date.getMonth() + 1)}-${pad2(parsedDate.date.getDate())}`;
  const courseKey = (courseCode || courseName).toLowerCase().replace(/[^a-z0-9]/g, '') || 'course';
  const id = `banner_exam_${courseKey}_${kindKey}_${dateKey}`;

  return {
    id,
    courseCode,
    courseName,
    title,
    description,
    dueDate: parsedDate.date.toISOString(),
    hasSpecificTime: parsedDate.hasSpecificTime,
    type: 'exam',
    priority: 'high',
    status: 'pending',
    sourceSnippet: description,
    confidence: 1.0,
    extractedBy: 'local',
    weight: weightInfo.weight,
    weightDisplay: weightInfo.weightDisplay,
    syllabusNote: weightInfo.syllabusNote,
    room: finalRoom,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

const HEADER_ALIASES: Record<keyof ExamScheduleRow, RegExp> = {
  crn: /\bcrn\b|الرقم\s*المرجعي/i,
  courseNumber: /course\s*(?:number|no\.?|code)|رقم\s*المساق/i,
  courseTitle: /course\s*(?:title|name)|اسم\s*المساق|عنوان\s*المساق/i,
  examDate: /exam\s*date|تاريخ\s*الامتحان/i,
  fromTime: /from\s*\/?\s*time|start\s*time|من\s*وقت|وقت\s*البدء/i,
  toTime: /to\s*\/?\s*time|end\s*time|إلى\s*وقت|وقت\s*الانتهاء/i,
  building: /\bbuilding\b|المبنى/i,
  room: /\broom\b|القاعة/i,
  examType: /exam\s*type|نوع\s*الامتحان/i,
  examMethod: /exam\s*method|طريقة\s*الامتحان/i,
  comment: /\bcomments?\b|ملاحظات/i
};

/**
 * Extracts ExamScheduleRow items from a Document or root Element containing a Banner Student Exam table.
 */
export function extractExamScheduleRowsFromDoc(root: Document | Element): ExamScheduleRow[] {
  const rows: ExamScheduleRow[] = [];
  const tables = Array.from(root.querySelectorAll('table'));

  for (const table of tables) {
    const trs = Array.from(table.querySelectorAll('tr'));
    if (trs.length < 2) continue;

    let headerRowIndex = -1;
    const colMap: Partial<Record<keyof ExamScheduleRow, number>> = {};

    for (let r = 0; r < Math.min(trs.length, 5); r++) {
      const cells = Array.from(trs[r].querySelectorAll('th, td')).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length < 4) continue;

      const candidateMap: Partial<Record<keyof ExamScheduleRow, number>> = {};
      cells.forEach((text, idx) => {
        for (const [field, re] of Object.entries(HEADER_ALIASES) as Array<[keyof ExamScheduleRow, RegExp]>) {
          if (candidateMap[field] === undefined && re.test(text)) {
            candidateMap[field] = idx;
          }
        }
      });

      if (candidateMap.examDate !== undefined && (candidateMap.courseTitle !== undefined || candidateMap.courseNumber !== undefined)) {
        headerRowIndex = r;
        Object.assign(colMap, candidateMap);
        break;
      }
    }

    if (headerRowIndex === -1) continue;

    for (let r = headerRowIndex + 1; r < trs.length; r++) {
      const cells = Array.from(trs[r].querySelectorAll('td')).map(c => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length < 4) continue;

      const getCell = (field: keyof ExamScheduleRow): string => {
        const idx = colMap[field];
        return idx !== undefined && idx < cells.length ? cells[idx] : '';
      };

      const examDate = getCell('examDate');
      const courseNumber = getCell('courseNumber');
      const courseTitle = getCell('courseTitle');
      if (!examDate || (!courseNumber && !courseTitle)) continue;

      rows.push({
        crn: getCell('crn'),
        courseNumber,
        courseTitle,
        examDate,
        fromTime: getCell('fromTime'),
        toTime: getCell('toTime'),
        building: getCell('building'),
        room: getCell('room'),
        examType: getCell('examType'),
        examMethod: getCell('examMethod'),
        comment: getCell('comment')
      });
    }
  }

  return rows;
}

/**
 * Scrapes all exam tasks from a Banner Student Exam Page (`StudentExamPage`) DOM.
 */
export function scrapeExamScheduleFromDoc(root: Document | Element, nowIso: string = new Date().toISOString()): DeadlineTask[] {
  const rows = extractExamScheduleRowsFromDoc(root);
  const tasks: DeadlineTask[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
    const task = examScheduleRowToTask(row, nowIso);
    if (task && !seenIds.has(task.id)) {
      seenIds.add(task.id);
      tasks.push(task);
    }
  }

  return tasks;
}

/**
 * True when the current URL or DOM is a Banner Student Exam Schedule page.
 */
export function isExamSchedulePage(loc: { hostname?: string; pathname?: string; href?: string }, root?: Document | Element | null): boolean {
  const pathname = (loc?.pathname || '').toLowerCase();
  const href = (loc?.href || '').toLowerCase();
  if (
    pathname.includes('studentexampage') ||
    href.includes('studentexampage') ||
    pathname.includes('examschedule') ||
    href.includes('examschedule') ||
    /\/bannerextensibility\/custompage\/page\/.*exam/i.test(pathname)
  ) {
    return true;
  }
  if (root) {
    const rows = extractExamScheduleRowsFromDoc(root);
    if (rows.length > 0) return true;
  }
  return false;
}

function examKindOf(title: string): string {
  if (/mid[\s_-]*terms?|نصفي|منتصف|فصلي/i.test(title)) return 'mid';
  if (/\bfinals?\b|نهائي/i.test(title)) return 'final';
  return '';
}

function sameCourseForExam(a: DeadlineTask, b: DeadlineTask): boolean {
  const codeA = (a.courseCode || '').replace(/\s+/g, '').toLowerCase();
  const codeB = (b.courseCode || '').replace(/\s+/g, '').toLowerCase();
  if (codeA && codeA !== 'uos' && codeB && codeB !== 'uos') {
    return codeA === codeB;
  }
  const nameA = resolveCourseInfo(a).courseName.toLowerCase();
  const nameB = resolveCourseInfo(b).courseName.toLowerCase();
  return Boolean(nameA && nameA !== 'general course' && nameA !== 'uos' && nameA === nameB);
}

/**
 * Merges scraped Banner exam schedule tasks into the existing task list.
 * - Matches by id (`banner_exam_...`) or by course + exam kind (`Midterm Exam` / `Final Exam`).
 * - Never overwrites tasks the student made or edited (`userEdited`, `extractedBy: 'manual'`).
 * - Updates unedited tasks only when a field actually changed, bumping `updatedAt` only then.
 */
export function mergeExamScheduleTasks(
  existingTasks: DeadlineTask[],
  examTasks: DeadlineTask[],
  tombstones: Record<string, string> = {},
  nowIso: string = new Date().toISOString()
): { tasks: DeadlineTask[]; addedCount: number; updatedCount: number } {
  const out = existingTasks.map(t => ({ ...t }));
  let addedCount = 0;
  let updatedCount = 0;

  for (const incoming of examTasks) {
    if (!incoming || tombstones[incoming.id]) continue;

    const kind = examKindOf(incoming.title);
    const matchIdx = out.findIndex(existing => {
      if (existing.id === incoming.id) return true;
      if (existing.type === 'exam' && kind && examKindOf(existing.title) === kind && sameCourseForExam(existing, incoming)) {
        return true;
      }
      return false;
    });

    if (matchIdx === -1) {
      out.push({ ...incoming });
      addedCount++;
      continue;
    }

    const existing = out[matchIdx];
    if (existing.userEdited || existing.extractedBy === 'manual') {
      continue;
    }

    let changed = false;
    if (existing.dueDate !== incoming.dueDate) {
      existing.dueDate = incoming.dueDate;
      changed = true;
    }
    if (existing.hasSpecificTime !== incoming.hasSpecificTime) {
      existing.hasSpecificTime = incoming.hasSpecificTime;
      changed = true;
    }
    if (incoming.room && existing.room !== incoming.room) {
      existing.room = incoming.room;
      changed = true;
    }
    if (!existing.courseCode && incoming.courseCode) {
      existing.courseCode = incoming.courseCode;
      changed = true;
    }
    if ((!existing.courseName || existing.courseName === 'General Course') && incoming.courseName) {
      existing.courseName = incoming.courseName;
      changed = true;
    }
    if (incoming.weight !== undefined && existing.weight === undefined) {
      existing.weight = incoming.weight;
      existing.weightDisplay = incoming.weightDisplay;
      existing.syllabusNote = incoming.syllabusNote;
      changed = true;
    }
    if (incoming.description && existing.description !== incoming.description) {
      existing.description = incoming.description;
      existing.sourceSnippet = incoming.sourceSnippet;
      changed = true;
    }

    if (changed) {
      existing.updatedAt = nowIso;
      updatedCount++;
    }
  }

  return { tasks: out, addedCount, updatedCount };
}

