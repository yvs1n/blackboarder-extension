/**
 * Class time and room resolution from the student's own courses (their class times and rooms).
 */
import type { Weekday } from '../types';
import { getActiveScheduleEntries, pickCourseMatch } from './userCourses';

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

/**
 * Extracts explicit classroom/hall/lab numbers mentioned by professors in announcement text.
 * Supports UOS formats: "A8-103", "A12 - 110", "A3-184", "A8-TH005", "Central Lab Men - 105",
 * as well as keywords like "room 103", "hall TH005", "lab 3", "قاعة 103", "مختبر 105", "مدرج TH005".
 */
export function extractRoomFromText(text: string): string | null {
  if (!text) return null;

  // 0. Positive relocation / explicit room indicator (e.g. "moved to room A8-204", "held in A8-103", "in room A8-204", "قاعة A8-204")
  const targetRoomRegex = /(?:moved\s*to(?:\s*room)?|transferred\s*to|held\s*in|location:?|venue:?|in\s*room|في\s*قاعة|قاعة)\s*[:\-–]?\s*([A-Za-z]\d{1,2}\s*(?:[-–—/]|:(?=\d{3}))\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/i;
  const targetMatch = text.match(targetRoomRegex);
  if (targetMatch) {
    return targetMatch[1].replace(/\s*[-–—/:]\s*/, '-').toUpperCase();
  }

  // 1. Explicit Building + Room or Lab patterns (e.g. "A8-103", "A12 - 110", "A3-184", "A8-TH005", "W8-Lab 3", "M9-102")
  // Exclude rooms explicitly negated (e.g. "NOT in A12-110", "not take place in A12-110")
  const allBldMatches = Array.from(text.matchAll(/\b([A-Za-z]\d{1,2}\s*(?:[-–—/]|:(?=\d{3}))\s*(?:TH\d{2,4}|Lab\s*\d+|\d{2,4}[A-Za-z]?))\b/gi));
  for (const m of allBldMatches) {
    const matchIndex = m.index ?? 0;
    const precedingSnippet = text.slice(Math.max(0, matchIndex - 35), matchIndex).toLowerCase();
    const isNegated = /not\s*(?:take\s*place\s*)?in\s*$|not\s*in\s*$|never\s*in\s*$|instead\s*of\s*$|ليس\s*في\s*$/i.test(precedingSnippet);
    if (!isNegated) {
      return m[1].replace(/\s*[-–—/:]\s*/, '-').toUpperCase();
    }
  }

  // 2. Central lab pattern (e.g. "Central Lab Men - 105", "Central Laboratories 105")
  const centralLabRegex = /\b(?:central\s*lab(?:orator(?:y|ies))?(?:\s*\(?men\)?)?)\s*[-–—:]*\s*(\d{2,4}[A-Za-z]?)\b/i;
  const centralMatch = text.match(centralLabRegex);
  if (centralMatch) {
    return `Central Lab Men - ${centralMatch[1]}`;
  }

  // 3. English keywords: room / classroom / hall / lab / auditorium (e.g. "in room A8-204", "room 103", "hall TH005")
  // The keyword must be a whole word and the room token must contain a digit; otherwise
  // "lab report", "label" or "classroom rules" were read as rooms ("report", "el", "rules").
  const enRoomRegex = /\b(?:in\s+)?(?:room|rm|classroom|hall|auditorium|lecture\s*hall|lab|laboratory)\b\s*(?:#|no\.?|number)?\s*[:\-–]?\s*([A-Za-z0-9]{1,6}(?:\s*[-–—/]\s*[A-Za-z0-9]+)?)\b/i;
  const enMatch = text.match(enRoomRegex);
  if (enMatch) {
    const raw = enMatch[1].trim();
    if (/\d/.test(raw) && !/^(?:temperature|conditions|for|and|or|the|to|with|all|due|today|tomorrow|yesterday)$/i.test(raw)) {
      return raw.replace(/\s*[-–—/]\s*/, '-');
    }
  }

  // 4. Arabic keywords: قاعة / غرفة / مدرج / مختبر / معمل (e.g. "قاعة 103", "مختبر 105", "مدرج TH005")
  const arRoomRegex = /(?:في\s+)?(?:قاعة|غرفة|مدرج|مختبر|معمل)\s*(?:رقم)?\s*[:\-–]?\s*([A-Za-z0-9\s/–-]{2,15})/i;
  const arMatch = text.match(arRoomRegex);
  if (arMatch) {
    const raw = arMatch[1].trim();
    if (raw && /\d/.test(raw) && !/^(?:الامتحان|الدراسة|المحاضرة|اليوم|أمس|غدا|غداً)$/i.test(raw)) {
      return raw.replace(/\s*[-–—/]\s*/, '-');
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
