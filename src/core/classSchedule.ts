/**
 * The weekly class timetable from each course's meeting times: today's classes, class
 * reminders and calendar events. Times are the student's local clock ("11:00" means 11:00
 * wherever the device is), the same as they were typed in.
 */
import type { UserCourseConfig } from '../types';

export interface ClassOccurrence {
  /** Stable per class meeting: course, date and start time */
  key: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  colorHex?: string;
  start: Date;
  end: Date;
  room: string;
  instructor?: string;
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6
};

export function weekdayIndex(day: string): number | null {
  const i = DAY_INDEX[String(day || '').trim().toLowerCase()];
  return i === undefined ? null : i;
}

function parseClock(value: string): { h: number; m: number } | null {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = +match[1];
  const m = +match[2];
  if (h > 23 || m > 59) return null;
  return { h, m };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every class meeting that starts between `from` and `to`, earliest first. */
export function classOccurrences(courses: UserCourseConfig[], from: Date, to: Date): ClassOccurrence[] {
  const out: ClassOccurrence[] = [];
  if (!(to > from)) return out;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  // Guard against huge ranges: one year at most
  const last = Math.min(to.getTime(), from.getTime() + 366 * 86400000);
  for (; day.getTime() <= last; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay();
    for (const course of courses || []) {
      for (const slot of course?.scheduleSlots || []) {
        if (!(slot.days || []).some(d => weekdayIndex(d) === weekday)) continue;
        const s = parseClock(slot.startTime);
        if (!s) continue;
        const e = parseClock(slot.endTime);
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.h, s.m);
        let end = e ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), e.h, e.m) : new Date(start.getTime() + 60 * 60000);
        if (end <= start) end = new Date(start.getTime() + 60 * 60000);
        if (start < from || start > to) continue;
        out.push({
          key: `${course.id}_${localDateKey(start)}_${pad(s.h)}${pad(s.m)}`,
          courseId: course.id,
          courseName: course.courseName || course.courseCode || 'Class',
          courseCode: course.courseCode || '',
          colorHex: course.colorHex,
          start,
          end,
          room: slot.room || '',
          instructor: slot.instructor
        });
      }
    }
  }
  // Two slots of the same course at the same time (a typo or a duplicate) show once
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.courseName.localeCompare(b.courseName))
    .filter(o => (seen.has(o.key) ? false : (seen.add(o.key), true)));
}

/** The classes on one calendar day. */
export function classesOnDay(courses: UserCourseConfig[], date: Date): ClassOccurrence[] {
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  return classOccurrences(courses, from, to);
}

/**
 * Classes whose reminder is due now: the reminder time (start minus `minutesBefore`) has passed
 * within the last `graceMinutes` and the class has not started more than a few minutes ago.
 * `alreadyReminded` holds the keys reminded before.
 */
export function dueClassReminders(
  courses: UserCourseConfig[],
  now: Date,
  minutesBefore: number,
  alreadyReminded: Record<string, unknown> = {},
  graceMinutes: number = 10
): ClassOccurrence[] {
  if (!(minutesBefore > 0)) return [];
  const from = new Date(now.getTime() - 5 * 60000);
  const to = new Date(now.getTime() + minutesBefore * 60000 + 60000);
  return classOccurrences(courses, from, to).filter(o => {
    if (alreadyReminded[o.key]) return false;
    const remindAt = o.start.getTime() - minutesBefore * 60000;
    return remindAt <= now.getTime() && now.getTime() - remindAt <= graceMinutes * 60000;
  });
}

/** When the next class reminder is due (for an alarm), or null when there are no classes ahead. */
export function nextClassReminderAt(courses: UserCourseConfig[], now: Date, minutesBefore: number): Date | null {
  if (!(minutesBefore > 0)) return null;
  const upcoming = classOccurrences(courses, now, new Date(now.getTime() + 8 * 86400000));
  for (const o of upcoming) {
    const at = o.start.getTime() - minutesBefore * 60000;
    if (at > now.getTime()) return new Date(at);
  }
  return null;
}

export function formatClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "in 25 min", "in 2 h 5 min", "now" */
export function startsIn(start: Date, now: Date): string {
  const mins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** The reminder text, the same in the extension, the phone and pushes. */
export function classReminderText(o: ClassOccurrence, now: Date): { title: string; body: string } {
  const where = o.room ? ` in ${o.room}` : '';
  return {
    title: `Class ${startsIn(o.start, now)}: ${o.courseName}`,
    body: `${formatClock(o.start)} to ${formatClock(o.end)}${where}`
  };
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * The Today's Classes list, shared by the popup and the phone app (same classes in both
 * stylesheets). The class on now and the next one are marked.
 */
export function todaysClassesHtml(
  classes: ClassOccurrence[],
  now: Date,
  colorFor: (o: ClassOccurrence) => string,
  options: { isToday?: boolean; hasSchedule?: boolean } = {}
): string {
  const isToday = options.isToday !== false;
  if (!classes.length) {
    const text = options.hasSchedule === false
      ? 'No class times yet. Add meeting times to your courses to see your classes here.'
      : isToday ? 'No classes today.' : 'No classes on this day.';
    return `<div class="classes-empty">${text}</div>`;
  }
  const t = isToday ? now.getTime() : 0;
  const next = isToday ? classes.find(o => o.start.getTime() > t) : undefined;
  return classes.map(o => {
    const done = isToday && o.end.getTime() <= t;
    const live = isToday && o.start.getTime() <= t && o.end.getTime() > t;
    const state = live ? 'Now' : o === next ? startsIn(o.start, now) : done ? 'Done' : '';
    const cls = `class-row${done ? ' is-done' : ''}${live ? ' is-live' : ''}${o === next ? ' is-next' : ''}`;
    return `<div class="${cls}">
      <span class="class-time">${formatClock(o.start)}<span class="class-time-end">${formatClock(o.end)}</span></span>
      <span class="marks-dot" style="background:${esc(colorFor(o))}"></span>
      <span class="class-main"><span class="class-name">${esc(o.courseName)}</span>${o.room ? `<span class="class-room">${esc(o.room)}</span>` : ''}</span>
      ${state ? `<span class="class-state">${esc(state)}</span>` : ''}
    </div>`;
  }).join('');
}
