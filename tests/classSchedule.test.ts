import { describe, it, expect } from 'vitest';
import {
  classOccurrences, classesOnDay, dueClassReminders, nextClassReminderAt, classReminderText, todaysClassesHtml, weekdayIndex, startsIn
} from '../src/core/classSchedule';

const course = (id: string, slots: any[], extra: any = {}) => ({
  id, courseCode: id.toUpperCase(), courseName: `Course ${id}`, colorHex: '#123456', aliases: [], syllabus: [], scheduleSlots: slots, ...extra
});

// Sunday 1 November 2026, local time
const SUNDAY = new Date(2026, 10, 1);
const at = (h: number, m = 0, day = SUNDAY) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);

const courses = [
  course('phys', [{ days: ['Sunday', 'tue'], startTime: '11:00', endTime: '12:15', room: 'A8-103' }]),
  course('calc', [{ days: ['sun', 'wed'], startTime: '08:00', endTime: '09:15', room: 'M1-102' }]),
  course('lab', [{ days: ['mon'], startTime: 'bad', endTime: '10:00', room: '' }])
];

describe('class timetable', () => {
  it('reads full and short day names', () => {
    expect(weekdayIndex('Sunday')).toBe(0);
    expect(weekdayIndex('thu')).toBe(4);
    expect(weekdayIndex('noday')).toBeNull();
  });

  it('lists a day in time order and skips slots without a valid time', () => {
    const day = classesOnDay(courses as any, SUNDAY);
    expect(day.map(o => o.courseId)).toEqual(['calc', 'phys']);
    expect(day[1].room).toBe('A8-103');
    expect(day[1].key).toBe('phys_2026-11-01_1100');
    expect(classesOnDay(courses as any, at(0, 0, new Date(2026, 10, 2)))).toEqual([]);
  });

  it('lists a week of classes', () => {
    const week = classOccurrences(courses as any, SUNDAY, at(23, 59, new Date(2026, 10, 7)));
    expect(week.map(o => o.key)).toEqual([
      'calc_2026-11-01_0800', 'phys_2026-11-01_1100', 'phys_2026-11-03_1100', 'calc_2026-11-04_0800'
    ]);
  });

  it('reminds once, in the window before the class', () => {
    expect(dueClassReminders(courses as any, at(10, 44), 15)).toEqual([]);
    const due = dueClassReminders(courses as any, at(10, 46), 15);
    expect(due.map(o => o.key)).toEqual(['phys_2026-11-01_1100']);
    expect(dueClassReminders(courses as any, at(10, 46), 15, { 'phys_2026-11-01_1100': 1 })).toEqual([]);
    // Too late: the computer was asleep through the reminder
    expect(dueClassReminders(courses as any, at(11, 5), 15)).toEqual([]);
    expect(dueClassReminders(courses as any, at(10, 46), 0)).toEqual([]);
  });

  it('finds when the next reminder is due', () => {
    expect(nextClassReminderAt(courses as any, at(9, 0), 15)).toEqual(at(10, 45));
    expect(nextClassReminderAt(courses as any, at(12, 0), 15)).toEqual(at(10, 45, new Date(2026, 10, 3)));
    expect(nextClassReminderAt([], at(12, 0), 15)).toBeNull();
  });

  it('words the reminder', () => {
    const o = classesOnDay(courses as any, SUNDAY)[1];
    expect(classReminderText(o, at(10, 45))).toEqual({ title: 'Class in 15 min: Course phys', body: '11:00 to 12:15 in A8-103' });
    expect(startsIn(at(13, 5), at(11, 0))).toBe('in 2 h 5 min');
  });

  it('marks the class on now and the next one today, and nothing on another day', () => {
    const day = classesOnDay(courses as any, SUNDAY);
    const html = todaysClassesHtml(day, at(8, 30), () => '#000');
    expect(html).toContain('class-row is-live');
    expect(html).toContain('class-row is-next');
    expect(html).toContain('in 2 h 30 min');
    const other = todaysClassesHtml(day, at(8, 30), () => '#000', { isToday: false });
    expect(other).not.toContain('is-live');
    expect(todaysClassesHtml([], at(8, 30), () => '#000', { hasSchedule: false })).toContain('Add meeting times');
  });

  it('escapes course names', () => {
    const evil = [course('x', [{ days: ['sun'], startTime: '09:00', endTime: '10:00', room: '<img src=x>' }], { courseName: '<b>bad</b>' })];
    const html = todaysClassesHtml(classesOnDay(evil as any, SUNDAY), at(8, 0), () => '#000');
    expect(html).not.toContain('<b>bad</b>');
    expect(html).not.toContain('<img');
  });
});

import { calendarFeedUrl, cleanCalendarFeedShow } from '../src/core/calendarLink';

describe('calendar link', () => {
  it('keeps old deadline links unchanged and adds the choice and time zone otherwise', () => {
    expect(calendarFeedUrl('https://blackboarder.pages.dev/', 'BBS-MADEUP', 'deadlines', { timeZone: 'Asia/Dubai' }))
      .toBe('https://blackboarder.pages.dev/feed.ics?key=BBS-MADEUP');
    expect(calendarFeedUrl('https://blackboarder.pages.dev', 'BBS-MADEUP', 'both', { webcal: true, timeZone: 'Asia/Dubai' }))
      .toBe('webcal://blackboarder.pages.dev/feed.ics?key=BBS-MADEUP&show=both&tz=Asia%2FDubai');
    expect(calendarFeedUrl('http://localhost:3456', '', 'classes', { timeZone: '' }))
      .toBe('http://localhost:3456/feed.ics?show=classes');
    expect(cleanCalendarFeedShow('nonsense')).toBe('both');
  });
});
