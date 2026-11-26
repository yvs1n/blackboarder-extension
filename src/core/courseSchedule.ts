/**
 * Class time and room resolution from the student's own courses (their class times and rooms).
 */
import type { Weekday } from '../types';
import { getActiveScheduleEntries, pickCourseMatch } from './userCourses';
import { normalizeDigits } from './titleLocalization';

export type { Weekday };

export interface CourseScheduleEntry {
  courseId: string;
  courseName: string;
  courseCode: string;
  crn: string;
  days: Weekday[];
  dayIndices: number[]; // 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
  startHour: number;    // 24-hour format
  startMinute: number;
  endHour: number;
  endMinute: number;
  timeRangeDisplay: string;
  location: string;
  room: string;
  instructor: string;
  matcher: RegExp;
}

/**
 * Finds matching course schedule entry by course name, course code, or context.
 */
export function findCourseSchedule(courseNameOrCode: string, extraContext?: string): CourseScheduleEntry | null {
  const combined = `${courseNameOrCode || ''} ${extraContext || ''}`.trim();
  if (!combined) return null;

  // A lab course wins text that mentions a lab over its lecture course
  return pickCourseMatch(getActiveScheduleEntries(), combined, entry => entry.matcher, entry => entry.courseName);
}


/**
 * Resolves the task's due date and time using the student's schedule:
 * 1. If the instructor assigned an explicit time (e.g. 11:59 PM, 10:00 AM) or specifies done at home with a specific time:
 *    Preserve the instructor's assigned date and time!
 * 2. If NO specific time was given by the instructor (or generic default was used):
 *    Set the exact time to the class meeting start time from the student's course!
 */
export function resolveTaskTimeWithSchedule(params: {
  dueDate: Date;
  courseNameOrCode: string;
  hasSpecificTime: boolean;
  announcementText?: string;
  title?: string;
}): { dueDate: Date; hasSpecificTime: boolean; appliedSchedule: boolean; classTimeStr?: string } {
  const { dueDate, courseNameOrCode, hasSpecificTime, announcementText = '', title = '' } = params;

  // If instructor provided an explicit time, keep the instructor's assigned time!
  if (hasSpecificTime) {
    return {
      dueDate,
      hasSpecificTime: true,
      appliedSchedule: false
    };
  }

  // Look up course schedule
  const schedule = findCourseSchedule(courseNameOrCode, `${title} ${announcementText}`);
  if (!schedule) {
    return {
      dueDate,
      hasSpecificTime: false,
      appliedSchedule: false
    };
  }

  // Set the exact class start time
  const adjusted = new Date(dueDate.getTime());
  adjusted.setHours(schedule.startHour, schedule.startMinute, 0, 0);

  const hh = String(schedule.startHour).padStart(2, '0');
  const mm = String(schedule.startMinute).padStart(2, '0');

  return {
    dueDate: adjusted,
    hasSpecificTime: true,
    appliedSchedule: true,
    classTimeStr: `${hh}:${mm}`
  };
}

/**
 * Returns all courses in the student schedule for UI display in Settings.
 */
export function getAllCourseSchedules(): CourseScheduleEntry[] {
  return getActiveScheduleEntries();
}

const ROOM_STOPWORDS = /^(?:temperature|conditions|for|and|or|the|to|with|all|due|today|tomorrow|yesterday|exam|quiz|test|midterm|final|report|rules|details|students|section|only|capacity|open|closed|pm|am)$/i;
const LAB_ASSESSMENT_AFTER_RE = /^\s+(?:exam|quiz|test|midterm|final|report|assignment|hw|homework|project|due|submission|session)\b/i;

function isNegatedOrOldRoomContext(text: string, index: number): boolean {
  const preceding = text.slice(Math.max(0, index - 48), index).toLowerCase();
  return /(?:not\s*(?:take\s*place\s*)?in|not\s*(?:at|in)|(?:will|does|do)\s+not|won't|doesn't|not|never|never\s*in|instead\s*of|rather\s*than|moved\s+from|changed\s+from|rescheduled\s+from|relocated\s+from|shifted\s+from|transferred\s+from|previous(?:ly)?\s+(?:room|location)?|old\s+(?:room|location)|ليس\s*(?:في)?|لن|لا|بدلاً?\s*من|بدل\s*من|نقل\S*\s*من)\s*$/i.test(preceding);
}

function formatNormalizedRoom(raw: string): string {
  return raw
    .trim()
    .replace(/\s*[-–\u2014/:]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^([A-Za-z]{1,3}\d{0,2})\s+([A-Za-z]?\d{2,4}[A-Za-z]?|TH\d{2,4})$/, '$1-$2')
    .toUpperCase();
}

/**
 * Extracts explicit classroom/hall/lab numbers mentioned by professors in announcement text.
 * Supports building-room tokens ("A8-103", "MB-102", "EB2-104", "M9-G05", "A10:006"),
 * "Building M9 Room 104", "Central Lab Men - 105", relocation phrases ("moved from A to B"),
 * and English/Arabic room/hall/lab keywords with Arabic-Indic or ASCII digits.
 */
export function extractRoomFromText(text: string): string | null {
  if (!text) return null;
  const norm = normalizeDigits(text).replace(/\u00a0/g, ' ');

  // 0. Relocation / explicit venue cues (global scan so positive target beats earlier old room)
  const relocCueRe = /(?:(?:moved|relocated|transferred|changed|shifted|switched)\s+(?:from\s+\S+(?:\s+\S+)?\s+)?to(?:\s+(?:the\s+)?(?:new\s+)?(?:room|hall|lab|classroom|building|bldg\.?))?|new\s+(?:room|hall|lab|location|venue)|updated\s+(?:room|location|venue)|venue|location|held\s+in|takes?\s+place\s+(?:in|at)|will\s+be\s+(?:in|at|held\s+in)|in\s+(?:room|classroom|hall|auditorium)|at\s+(?:room|hall|auditorium)|(?:في|ب|بال)\s*(?:قاعة|غرفة|مدرج|مختبر)|قاعة(?:\s+(?:جديدة|الامتحان))?|تم\s*نقل\S*(?:\s+\S+){0,4}?\s*إلى(?:\s+(?:القاعة|قاعة))?)\s*[:\-–]?\s*(?:(?:building|bldg\.?|wing|block|مبنى)\s+([A-Za-z0-9]{1,5})\s*,?\s*(?:room|rm\.?|hall|lab|قاعة|غرفة|مختبر)?\s*(?:#|no\.?|رقم)?\s*[:\-–]?\s*([A-Za-z]?\d{2,4}[A-Za-z]?|TH\d{2,4})|([A-Za-z]{1,4}\d{0,2}\s*(?:[-–\u2014/\s]|:(?=\d{3}))\s*(?:TH\d{2,4}|Lab\s*\d+|[A-Za-z]?\d{2,4}[A-Za-z]?)))\b/gi;
  for (const m of norm.matchAll(relocCueRe)) {
    const idx = m.index ?? 0;
    if (isNegatedOrOldRoomContext(norm, idx)) continue;
    if (m[1] && m[2]) {
      return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
    }
    if (m[3]) {
      const candidate = formatNormalizedRoom(m[3]);
      if (/\d/.test(candidate)) return candidate;
    }
  }

  // Also check explicit "new/moved/updated room: <digits>" without building prefix
  const relocPlainRoomRe = /(?:(?:moved|relocated|transferred|changed)\s+(?:from\s+(?:room\s+)?\S+\s+)?to\s+(?:the\s+)?(?:new\s+)?(?:room|hall|lab|قاعة|مختبر)|new\s+(?:room|hall|lab)|قاعة\s*جديدة)\s*(?:#|no\.?|رقم)?\s*[:\-–]?\s*([A-Za-z]?\d{2,4}[A-Za-z]?)\b/gi;
  for (const m of norm.matchAll(relocPlainRoomRe)) {
    const idx = m.index ?? 0;
    if (!isNegatedOrOldRoomContext(norm, idx)) {
      return m[1].trim().toUpperCase();
    }
  }

  // 1. "Building M9, Room 104" / "Bldg EB2 Hall 201"
  const bldgWordRoomRe = /(?:building|bldg\.?|مبنى)\s+([A-Za-z0-9]{1,5})\s*,?\s*(?:room|rm\.?|hall|lab|قاعة|غرفة|مختبر)\s*(?:#|no\.?|رقم)?\s*[:\-–]?\s*([A-Za-z]?\d{2,4}[A-Za-z]?|TH\d{2,4})\b/gi;
  for (const m of norm.matchAll(bldgWordRoomRe)) {
    if (!isNegatedOrOldRoomContext(norm, m.index ?? 0)) {
      return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
    }
  }

  // 2. Central lab pattern ("Central Lab Men - 105", "Central Laboratories (Men) 105") - check before Building+Room tokens
  const centralLabRe = /\b(?:central\s*lab(?:orator(?:y|ies))?(?:\s*\(?men\)?)?)\s*[-–\u2014:]*\s*(\d{2,4}[A-Za-z]?)\b/gi;
  for (const m of norm.matchAll(centralLabRe)) {
    if (!isNegatedOrOldRoomContext(norm, m.index ?? 0)) {
      return `Central Lab Men - ${m[1]}`;
    }
  }

  // 3. Explicit Building + Room/Lab tokens:
  //    - Letter + digits building ("A8-103", "EB2-104", "A10:006", "M9-G05", "W4-B12", "W8-Lab 3")
  //    - Multi-letter building with alpha room suffix ("MB-G05", "ESB-TH005")
  //    - Cued multi-letter building + digit room ("in MB-102", "at ESB-201") or spaced building-with-digit ("in M9 104")
  const bldTokenRe = /\b([A-Za-z]{1,3}\d{1,2}\s*(?:[-–\u2014/]|:(?=\d{3}))\s*(?:TH\d{2,4}(?:-[A-Za-z]+\d+)?|Lab\s*\d+|[A-Za-z]?\d{2,4}[A-Za-z]?)|[A-Za-z]{2,4}\s*[-–\u2014/]\s*(?:TH\d{2,4}(?:-[A-Za-z]+\d+)?|Lab\s*\d+|[A-Za-z]\d{2,4}[A-Za-z]?))\b/gi;
  for (const m of norm.matchAll(bldTokenRe)) {
    if (!isNegatedOrOldRoomContext(norm, m.index ?? 0)) {
      return formatNormalizedRoom(m[1]);
    }
  }
  const cuedMultiLetterBldRe = /(?:room|hall|auditorium|lab|location|venue|building|bldg\.?|held\s+in|in|at|في|ب|بالقاعة|قاعة)\s*[:\-–]?\s*([A-Za-z]{2,4}\s*[-–\u2014/]\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?)|[A-Za-z]{1,3}\d{1,2}\s+(?:TH\d{2,4}|[A-Za-z]?\d{2,4}[A-Za-z]?))\b/gi;
  for (const m of norm.matchAll(cuedMultiLetterBldRe)) {
    const idx = m.index ?? 0;
    const after = norm.slice(idx + m[0].length, idx + m[0].length + 20);
    if (
      !isNegatedOrOldRoomContext(norm, idx) &&
      !/^(?:men|women|boys|girls|male|female)\b/i.test(m[1]) &&
      !/^\s*(?:class|course|section|students)\b/i.test(after)
    ) {
      return formatNormalizedRoom(m[1]);
    }
  }

  // 4. English keywords: loop over ALL matches so "Lab 2 exam ... Room 205" skips Lab 2 and returns 205
  const enRoomRe = /\b(?:(in|at)\s+)?(room|rm\.?|classroom|hall|auditorium|lecture\s*hall|lab|laboratory)\b\s*(?:#|no\.?|number)?\s*[:\-–]?\s*([A-Za-z]?\d?\s+[A-Za-z]?\d{2,4}[A-Za-z]?|[A-Za-z0-9]{1,6}(?:\s*[-–\u2014/]\s*[A-Za-z0-9]{1,6})?)\b/gi;
  for (const m of norm.matchAll(enRoomRe)) {
    const idx = m.index ?? 0;
    if (isNegatedOrOldRoomContext(norm, idx)) continue;
    const prep = m[1];
    const kw = m[2].toLowerCase();
    const raw = m[3].trim();
    if (!/\d/.test(raw) || ROOM_STOPWORDS.test(raw)) continue;
    const after = norm.slice(idx + m[0].length, idx + m[0].length + 24);
    if ((kw === 'lab' || kw === 'laboratory') && !prep && raw.length <= 2 && LAB_ASSESSMENT_AFTER_RE.test(after)) {
      continue;
    }
    return formatNormalizedRoom(raw);
  }

  // 5. Arabic keywords with .matchAll and no \b around Arabic words
  const arRoomRe = /(?:^|[\s,(:\-–])(?:في\s+ال|في\s+|بال|ب)?(?:قاعة|غرفة|مدرج|مختبر|معمل)\s*(?:رقم)?\s*[:\-–]?\s*([A-Za-z0-9]{1,8}(?:\s*[-–\u2014/]\s*[A-Za-z0-9]{1,8})?)/gi;
  for (const m of norm.matchAll(arRoomRe)) {
    const idx = m.index ?? 0;
    if (isNegatedOrOldRoomContext(norm, idx)) continue;
    const raw = m[1].trim();
    if (raw && /\d/.test(raw)) {
      return formatNormalizedRoom(raw);
    }
  }

  return null;
}

/** A saved room is only kept when it looks like one: it has a number ("s" and "Please" do not). */
export function isPlausibleRoom(room?: string): boolean {
  const r = (room || '').trim();
  return r.length >= 2 && r.length <= 30 && /\d/.test(r);
}

/**
 * Resolves the classroom/room for a task:
 * 1. If the professor explicitly posted a room in the announcement, return that custom room!
 * 2. Otherwise, look up the course in the student schedule and return the default room number.
 */
export function resolveTaskRoom(params: {
  courseNameOrCode: string;
  announcementText?: string;
  title?: string;
  existingRoom?: string;
  type?: string;
}): { room: string; isCustom: boolean } {
  const { courseNameOrCode, announcementText = '', title = '', existingRoom, type = '' } = params;
  const cleanType = (type || '').toLowerCase();

  // Assignments/Homework and Projects do not take place in a physical classroom
  if (cleanType === 'assignment' || cleanType === 'hw' || cleanType === 'project') {
    return { room: '', isCustom: false };
  }

  const combinedText = `${title} ${announcementText}`.trim();

  // 1. Check if professor posted an explicit room number in the announcement.
  // An announced room from the doctor ALWAYS takes precedence over a schedule default room!
  const announcedRoom = extractRoomFromText(combinedText);
  if (announcedRoom) {
    return { room: announcedRoom, isCustom: true };
  }

  // 2. If already specified and valid, keep it
  if (isPlausibleRoom(existingRoom)) {
    return { room: existingRoom!.trim(), isCustom: true };
  }

  // 3. Otherwise fall back to the room on the student's course
  const schedule = findCourseSchedule(courseNameOrCode, combinedText);
  if (schedule && schedule.room) {
    return { room: schedule.room, isCustom: false };
  }

  return { room: '', isCustom: false };
}
