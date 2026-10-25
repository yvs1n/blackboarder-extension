import { DeadlineTask } from '../types';
import { findCourseSchedule } from '../core/courseSchedule';

/**
 * Formats a Date into Google Calendar UTC string: YYYYMMDDTHHmmssZ or YYYYMMDD.
 */
function formatGCalDate(date: Date, allDay: boolean = false): string {
  if (allDay) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

/**
 * Escapes text for an iCalendar value (RFC 5545 section 3.3.11) instead of dropping commas and semicolons.
 */
function escapeIcsText(text: string): string {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Generates a direct Google Calendar event creation URL.
 */
export function createGoogleCalendarUrl(task: DeadlineTask): string {
  const startDate = new Date(task.dueDate);
  if (isNaN(startDate.getTime())) return '#';
  // Default duration: 1 hour if specific time, or full day
  const endDate = new Date(startDate.getTime() + (task.hasSpecificTime ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));

  const datesParam = `${formatGCalDate(startDate, !task.hasSpecificTime)}/${formatGCalDate(endDate, !task.hasSpecificTime)}`;
  const courseTag = task.courseName
    ? `${task.courseName}${task.courseCode && task.courseCode !== task.courseName ? ` (${task.courseCode})` : ''}`
    : (task.courseCode || 'UOS');
  const isDone = task.status === 'completed';
  const baseTitle = `[${courseTag}] ${task.title}`;
  const title = isDone ? `✓ ${baseTitle} (Done)` : baseTitle;
  
  const details = [
    `Course: ${task.courseName || 'General Course'} (${task.courseCode || 'UOS'})`,
    task.room ? `Room: ${task.room}` : '',
    `Type: ${(task.type || 'other').toUpperCase()}`,
    isDone ? 'Status: Completed (Done)' : 'Status: Pending',
    task.notes ? `Student Notes: ${task.notes}` : '',
    (task.description || task.sourceSnippet) ? `Doctor's Announcement:\n"${task.description || task.sourceSnippet}"` : '',
    '',
    'Added automatically via Blackboarder'
  ].filter(Boolean).join('\n');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: datesParam,
    details,
    location: task.room || task.courseName || 'Blackboard'
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Generates RFC 5545 iCalendar (.ics) string for single or multiple tasks.
 */
export function generateIcsContent(tasks: DeadlineTask[]): string {
  const nowUtc = formatGCalDate(new Date());

  // Tasks can come from the cloud; one without a usable date would produce an invalid VEVENT
  const events = tasks.filter(task => !isNaN(new Date(task.dueDate).getTime())).map(task => {
    const startDate = new Date(task.dueDate);
    const endDate = new Date(startDate.getTime() + (task.hasSpecificTime ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
    const isAllDay = !task.hasSpecificTime;
    const isTaskDone = task.status === 'completed';

    const dtStart = isAllDay
      ? `DTSTART;VALUE=DATE:${formatGCalDate(startDate, true)}`
      : `DTSTART:${formatGCalDate(startDate, false)}`;
    const dtEnd = isAllDay
      ? `DTEND;VALUE=DATE:${formatGCalDate(endDate, true)}`
      : `DTEND:${formatGCalDate(endDate, false)}`;

    const courseTag = task.courseName
      ? `${task.courseName}${task.courseCode && task.courseCode !== task.courseName ? ` (${task.courseCode})` : ''}`
      : (task.courseCode || 'UOS');
    const baseSummary = `[${courseTag}] ${task.title}`;
    const eventSummary = isTaskDone ? `✓ ${baseSummary} (Done)` : baseSummary;
    const cleanDesc = escapeIcsText([
      task.room ? `Room: ${task.room}` : '',
      isTaskDone ? 'Status: Completed (Done)' : 'Status: Pending',
      task.notes ? `Student Notes: ${task.notes}` : '',
      task.description || task.sourceSnippet
    ].filter(Boolean).join('\n'));

    const eventLines = [
      'BEGIN:VEVENT',
      `UID:${task.id}@blackboarder.uos`,
      `DTSTAMP:${nowUtc}`,
      dtStart,
      dtEnd,
      `SUMMARY:${escapeIcsText(eventSummary)}`,
      task.room ? `LOCATION:${escapeIcsText(task.room)}` : null,
      `DESCRIPTION:${cleanDesc}`,
      `CATEGORIES:${(task.type || 'other').toUpperCase()}`,
      // COMPLETED is not a valid VEVENT status; completion is shown in the summary instead
      'STATUS:CONFIRMED',
      'END:VEVENT'
    ].filter(Boolean);

    return eventLines.join('\r\n');
  }).join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Blackboarder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    events,
    'END:VCALENDAR'
  ].join('\r\n');
}

/**
 * Triggers a download of the .ics calendar file in the browser.
 */
export function downloadIcsFile(tasks: DeadlineTask[], filename: string = 'blackboard_deadlines.ics'): void {
  const content = generateIcsContent(tasks);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formats a deadline into a human-friendly countdown label.
 * If the task is marked as completed, returns 'Marked as Done' without showing overdue.
 */
export function formatCountdown(
  dueDateIso: string,
  hasSpecificTime: boolean = true,
  status?: string
): { label: string; urgency: 'overdue' | 'today' | 'tomorrow' | 'soon' | 'future' | 'completed' } {
  if (status === 'completed') {
    return { label: 'Marked as Done', urgency: 'completed' };
  }

  const now = new Date();
  const due = new Date(dueDateIso);
  if (isNaN(due.getTime())) {
    return { label: 'Date pending', urgency: 'future' };
  }

  const diffMs = due.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const absDiffHours = Math.abs(diffMs) / (1000 * 60 * 60);
  const absDiffDays = Math.floor(absDiffHours / 24);

  // Time string if available
  const timeStr = hasSpecificTime
    ? due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  if (isPast) {
    if (absDiffHours < 24) {
      return { label: `Overdue (${Math.round(absDiffHours)}h ago)`, urgency: 'overdue' };
    }
    return { label: `Overdue by ${absDiffDays}d`, urgency: 'overdue' };
  }

  // Today
  const isToday = now.toDateString() === due.toDateString();
  if (isToday) {
    return {
      label: hasSpecificTime ? `Due Today at ${timeStr}` : 'Due Today',
      urgency: 'today'
    };
  }

  // Tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = tomorrow.toDateString() === due.toDateString();
  if (isTomorrow) {
    return {
      label: hasSpecificTime ? `Due Tomorrow at ${timeStr}` : 'Due Tomorrow',
      urgency: 'tomorrow'
    };
  }

  // Within 3-7 days
  if (absDiffDays < 7) {
    const weekday = due.toLocaleDateString([], { weekday: 'short' });
    return {
      label: `${weekday} (in ${absDiffDays} days${hasSpecificTime ? ` at ${timeStr}` : ''})`,
      urgency: 'soon'
    };
  }

  // Future
  const formattedDate = due.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return {
    label: `${formattedDate}${hasSpecificTime ? ` at ${timeStr}` : ''}`,
    urgency: 'future'
  };
}

/**
 * Formats the display time for a deadline task.
 * 1. If task has a specific time, formats as 12-hour AM/PM (e.g. "11:59 PM").
 * 2. If it is scheduled during class, resolves the class time range from schedule.pdf (e.g. "12:30 PM - 01:45 PM (Class time)").
 * 3. Fallback: "During class".
 */
export function formatTaskTime(task: DeadlineTask): string {
  const d = new Date(task.dueDate);
  if (isNaN(d.getTime())) return 'No time specified';

  if (task.hasSpecificTime) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const sched = findCourseSchedule(task.courseName || task.courseCode, task.title);
  if (sched) {
    return `${sched.timeRangeDisplay} (Class time)`;
  }

  if (d.getHours() !== 0 || d.getMinutes() !== 0) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  return 'During class';
}

/**
 * Helper to get the effective timestamp of a task for chronological sorting.
 * If task has specific time, uses its timestamp.
 * If task has no specific time:
 *   - uses resolved class start time if matching course schedule
 *   - otherwise defaults to 23:59 of that day
 */
export function getTaskSortTimestamp(task: DeadlineTask): number {
  if (!task || !task.dueDate) return Infinity;
  const d = new Date(task.dueDate);
  if (isNaN(d.getTime())) return Infinity;

  if (task.hasSpecificTime === false) {
    const sched = findCourseSchedule(task.courseName || task.courseCode, task.title);
    if (sched) {
      const schedDate = new Date(d.getTime());
      schedDate.setHours(sched.startHour, sched.startMinute, 0, 0);
      return schedDate.getTime();
    }
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
      const endOfDay = new Date(d.getTime());
      endOfDay.setHours(23, 59, 0, 0);
      return endOfDay.getTime();
    }
  }

  return d.getTime();
}

/**
 * Chronological comparator for tasks:
 * 1. Earliest effective time comes first.
 * 2. If effective times match, tie-breaks alphabetically by task title.
 */
export function compareTasksByTime(a: DeadlineTask, b: DeadlineTask): number {
  const timeA = getTaskSortTimestamp(a);
  const timeB = getTaskSortTimestamp(b);

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return (a.title || '').localeCompare(b.title || '');
}
