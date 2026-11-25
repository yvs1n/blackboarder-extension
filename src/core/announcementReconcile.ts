import type { DeadlineTask, TaskType } from '../types';
import { extractRoomFromText, resolveTaskRoom, resolveTaskTimeWithSchedule } from './courseSchedule';
import { hasExamReviewContent, hasMakeupExamAction, isExamReviewSession } from './courseHelper';
import { resolveTaskWeight } from './syllabusWeights';
import { parseDateString, parseTime } from '../engine/localDateTime';

export interface AnnouncementFieldDelta {
  /** Calendar day (year, 0-indexed month, day) if explicitly stated in this announcement. */
  calendarDay?: { year: number; month: number; day: number };
  /** Clock time (24h hour & minute) if explicitly stated in this announcement. */
  explicitTime?: { hour: number; minute: number };
  /** Physical room/hall/lab if explicitly stated in this announcement. */
  explicitRoom?: string;
  /** Weight info if explicitly stated in this announcement text (not merely a syllabus fallback). */
  explicitWeight?: { weight: number; weightDisplay?: string; syllabusNote?: string };
}

const EXPLICIT_WEIGHT_IN_TEXT_RE = /(?:\b(?:worth|weighted(?:\s+at)?|weight(?:\s+is|\s*:)?|counts?\s+for|accounts?\s+for)\s*\d+(?:\.\d+)?\s*%|\(\s*\d+(?:\.\d+)?\s*%\s*(?:of\s+(?:total|grade|course))?\s*\)|(?:عليه|وزنه?|بنسبة)\s*\d+(?:\.\d+)?\s*%)/i;
const OFFICE_HOURS_OR_REVIEW_RE = /(?:office\s*hours|review\s*session|paper\s*viewing|ساعات\s*مكتبية|مراجعة\s*أوراق)/i;
const TOPIC_ONLY_LINE_RE = /(?:\b(?:lectures?|classes?|material|topics?)\s+(?:from|up\s+to|until|of|covered\s+on)\b|\bcovered\s+(?:on|from|in\s+class)\b|المحاضرات\s+(?:من|حتى))/i;
const SCHEDULE_ACTION_LINE_RE = /(?:\b(?:will\s+be|is\s+(?:now\s+)?(?:on|at)|now\s+on|held|conducted|scheduled|takes?\s+place|due|deadline|postponed|rescheduled|moved|shifted|extended|date\s*:|at\s+\d{1,2}(?:[:.]\d{2}|\s*[ap]\.?m))\b|سيكون|سيعقد|موعد|بتاريخ|تأجيل|تمديد|نقل)/i;

export function isTopicCoverageOnlyLine(line: string): boolean {
  return TOPIC_ONLY_LINE_RE.test(line) && !SCHEDULE_ACTION_LINE_RE.test(line);
}

/**
 * Splits a merged professor-notes description (`mergeAnnouncementTexts`) into chronological
 * announcement segments (oldest first, newest `[Professor Update]:` or legacy `[Doctor Update]:` last).
 */
export function splitAnnouncementNotes(text?: string): string[] {
  const raw = (text || '').trim();
  if (!raw || raw.toLowerCase() === 'gradebook' || /^gbcol_/i.test(raw)) return [];
  return raw
    .split(/\n+\s*\[(?:Professor|Doctor) Update\]:\s*\n+|\n\s*---+\s*\n/i)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Extracts only the fields explicitly stated in a single announcement or note segment.
 * Fields not mentioned in this segment are left `undefined` so prior values stay intact.
 */
export function extractAnnouncementFieldDelta(params: {
  title?: string;
  bodyText?: string;
  baseDate?: Date;
  courseNameOrCode?: string;
  taskTitle?: string;
  taskType?: TaskType | string;
}): AnnouncementFieldDelta {
  const title = (params.title || '').trim();
  const body = (params.bodyText || '').trim();
  const combined = `${title}\n${body}`.trim();
  if (!combined) return {};
  if (isExamReviewSession(title, body) && !hasMakeupExamAction(combined)) {
    return {};
  }

  const baseDate = params.baseDate && !isNaN(params.baseDate.getTime()) ? params.baseDate : new Date();
  const cleanType = String(params.taskType || '').toLowerCase();
  const isTakeHome = cleanType === 'assignment' || cleanType === 'hw' || cleanType === 'project';

  const delta: AnnouncementFieldDelta = {};

  // 1. Explicit room (ignored for homework/assignments/projects)
  if (!isTakeHome) {
    const room = extractRoomFromText(combined);
    if (room) delta.explicitRoom = room;
  }

  // 2. Explicit date & clock time (skip lines that are purely office hours or post-exam paper viewing)
  if (!OFFICE_HOURS_OR_REVIEW_RE.test(combined) || hasMakeupExamAction(combined)) {
    const lines = combined
      .split(/\r?\n+|(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length >= 3 && (!hasExamReviewContent(s) || hasMakeupExamAction(s)) && !isTopicCoverageOnlyLine(s));

    for (const line of lines) {
      const dm = parseDateString(line, baseDate);
      if (dm) {
        delta.calendarDay = {
          year: dm.date.getFullYear(),
          month: dm.date.getMonth(),
          day: dm.date.getDate()
        };
        if (dm.hasSpecificTime) {
          delta.explicitTime = {
            hour: dm.date.getHours(),
            minute: dm.date.getMinutes()
          };
        }
        break;
      }
    }

    if (!delta.explicitTime) {
      const tm = parseTime(combined);
      if (tm.hasTime) {
        delta.explicitTime = { hour: tm.hour, minute: tm.minute };
      }
    }
  }

  // 3. Explicit weight percentage stated in this announcement
  if (EXPLICIT_WEIGHT_IN_TEXT_RE.test(combined)) {
    const w = resolveTaskWeight(
      {
        title: params.taskTitle || title,
        courseName: params.courseNameOrCode || '',
        courseCode: params.courseNameOrCode || '',
        type: (params.taskType as TaskType) || 'other',
        description: combined,
        sourceSnippet: combined
      },
      params.courseNameOrCode
    );
    if (w.weight !== undefined) {
      delta.explicitWeight = {
        weight: w.weight,
        weightDisplay: w.weightDisplay,
        syllabusNote: w.syllabusNote
      };
    }
  }

  return delta;
}

/**
 * Applies a single announcement's extracted field delta to an existing unedited task:
 * - Unmentioned fields keep their previous values.
 * - Identical values cause no mutation (`changed = false`).
 * - Newly announced date, time, room, or weight updates the corresponding field cleanly.
 * - When `onlyFillMissing` is true (an older announcement discovered out-of-order after a newer one),
 *   it only fills fields the task is still missing without overwriting newer updates.
 */
export function applyAnnouncementDeltaToTask(
  task: DeadlineTask,
  delta: AnnouncementFieldDelta,
  options: { onlyFillMissing?: boolean } = {}
): boolean {
  if (!task || task.userEdited || task.extractedBy === 'manual') return false;
  const { onlyFillMissing = false } = options;
  let changed = false;

  const cleanType = String(task.type || '').toLowerCase();
  const isTakeHome = cleanType === 'assignment' || cleanType === 'hw' || cleanType === 'project';

  // 1. Room reconciliation
  if (isTakeHome) {
    if (task.room) {
      task.room = undefined;
      changed = true;
    }
  } else if (delta.explicitRoom) {
    if (!onlyFillMissing || !task.room) {
      if (task.room !== delta.explicitRoom) {
        task.room = delta.explicitRoom;
        changed = true;
      }
    }
  } else if (!task.room) {
    const fallbackRoom = resolveTaskRoom({
      courseNameOrCode: task.courseName || task.courseCode,
      title: task.title,
      type: task.type
    });
    if (fallbackRoom.room && fallbackRoom.room !== task.room) {
      task.room = fallbackRoom.room;
      changed = true;
    }
  }

  // 2. Date & Time reconciliation (independent so a date-only postponement preserves prior explicit time,
  //    and a time-only update preserves the scheduled date)
  const currentDue = task.dueDate ? new Date(task.dueDate) : null;
  const hasValidDue = Boolean(currentDue && !isNaN(currentDue.getTime()));

  if (delta.calendarDay || delta.explicitTime) {
    const base = hasValidDue ? new Date(currentDue!.getTime()) : new Date();
    let dateUpdated = false;
    let timeUpdated = false;

    if (delta.calendarDay && (!onlyFillMissing || !hasValidDue)) {
      if (
        !hasValidDue ||
        base.getFullYear() !== delta.calendarDay.year ||
        base.getMonth() !== delta.calendarDay.month ||
        base.getDate() !== delta.calendarDay.day
      ) {
        base.setFullYear(delta.calendarDay.year, delta.calendarDay.month, delta.calendarDay.day);
        dateUpdated = true;
      }
    }

    if (delta.explicitTime && (!onlyFillMissing || task.timeSource !== 'explicit')) {
      if (
        !hasValidDue ||
        !task.hasSpecificTime ||
        task.timeSource !== 'explicit' ||
        base.getHours() !== delta.explicitTime.hour ||
        base.getMinutes() !== delta.explicitTime.minute
      ) {
        base.setHours(delta.explicitTime.hour, delta.explicitTime.minute, 0, 0);
        task.hasSpecificTime = true;
        task.timeSource = 'explicit';
        timeUpdated = true;
      }
    } else if (dateUpdated && !delta.explicitTime && task.timeSource !== 'explicit') {
      // Date moved without an explicit time and prior time was schedule/default: re-align with course schedule if any
      const sched = resolveTaskTimeWithSchedule({
        dueDate: base,
        courseNameOrCode: task.courseName || task.courseCode,
        hasSpecificTime: false,
        title: task.title
      });
      base.setTime(sched.dueDate.getTime());
      task.hasSpecificTime = sched.hasSpecificTime;
      task.timeSource = sched.appliedSchedule ? 'schedule' : (task.timeSource || 'default');
    }

    if (dateUpdated || timeUpdated) {
      const nextIso = base.toISOString();
      if (nextIso !== task.dueDate) {
        task.dueDate = nextIso;
        changed = true;
      }
    }
  }

  // 3. Weight reconciliation
  if (delta.explicitWeight && delta.explicitWeight.weight !== undefined) {
    if (!onlyFillMissing || task.weight === undefined || task.weight === null) {
      if (task.weight !== delta.explicitWeight.weight || task.weightDisplay !== delta.explicitWeight.weightDisplay) {
        task.weight = delta.explicitWeight.weight;
        task.weightDisplay = delta.explicitWeight.weightDisplay;
        task.syllabusNote = delta.explicitWeight.syllabusNote;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * Walks all chronological segments in a task's professor notes (`description` / `sourceSnippet`)
 * from oldest to newest so the latest explicit room/time/weight in `[Professor Update]:` (or legacy `[Doctor Update]:`) segments wins,
 * rather than letting the first segment shadow later professor updates.
 */
export function resolveLatestFieldsFromNotes(params: {
  title?: string;
  notesText?: string;
  courseNameOrCode?: string;
  taskType?: TaskType | string;
  baseDate?: Date;
}): { latestRoom?: string; latestTime?: { hour: number; minute: number }; latestWeight?: AnnouncementFieldDelta['explicitWeight'] } {
  const segments = splitAnnouncementNotes(params.notesText);
  let latestRoom: string | undefined;
  let latestTime: { hour: number; minute: number } | undefined;
  let latestWeight: AnnouncementFieldDelta['explicitWeight'] | undefined;

  if (params.title) {
    const titleRoom = extractRoomFromText(params.title);
    if (titleRoom) latestRoom = titleRoom;
  }

  for (let i = 0; i < segments.length; i++) {
    const d = extractAnnouncementFieldDelta({
      title: i === 0 ? params.title : '',
      bodyText: segments[i],
      baseDate: params.baseDate,
      courseNameOrCode: params.courseNameOrCode,
      taskTitle: params.title,
      taskType: params.taskType
    });
    if (d.explicitRoom) latestRoom = d.explicitRoom;
    if (d.explicitTime) latestTime = d.explicitTime;
    if (d.explicitWeight) latestWeight = d.explicitWeight;
  }

  return { latestRoom, latestTime, latestWeight };
}
