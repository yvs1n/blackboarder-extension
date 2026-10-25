import { describe, it, expect, beforeEach } from 'vitest';
import { createGoogleCalendarUrl, generateIcsContent, formatTaskTime, compareTasksByTime, formatCountdown } from '../src/utils/calendar';
import { DeadlineTask } from '../src/types';
import { setActiveUserCourses, DEFAULT_USER_COURSES } from '../src/core/userCourses';

describe('Calendar Utilities', () => {
  beforeEach(() => {
    setActiveUserCourses(DEFAULT_USER_COURSES);
  });
  const sampleTask: DeadlineTask = {
    id: 'test-task-1',
    courseCode: '0401201',
    courseName: 'Computer Programming',
    title: 'Quiz 2: Arrays & Functions',
    description: 'Bring pencils and student ID.',
    dueDate: '2026-10-15T14:00:00.000Z',
    hasSpecificTime: true,
    type: 'quiz',
    priority: 'high',
    status: 'pending',
    sourceSnippet: 'Quiz 2 will be on Thursday',
    confidence: 0.9,
    extractedBy: 'local',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  };

  it('generates a valid Google Calendar URL with encoded parameters', () => {
    const url = createGoogleCalendarUrl(sampleTask);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('calendar.google.com');
    expect(parsed.pathname).toBe('/calendar/render');
    expect(parsed.searchParams.get('action')).toBe('TEMPLATE');
    expect(parsed.searchParams.get('text')).toBe('[Computer Programming (0401201)] Quiz 2: Arrays & Functions');
    expect(parsed.searchParams.get('dates')).toBe('20261015T140000Z/20261015T150000Z');
  });

  it('reflects completed status with checkmark and Done suffix in Google Calendar URL', () => {
    const completedTask: DeadlineTask = { ...sampleTask, status: 'completed' };
    const url = createGoogleCalendarUrl(completedTask);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('text')).toBe('✓ [Computer Programming (0401201)] Quiz 2: Arrays & Functions (Done)');
    expect(parsed.searchParams.get('details')).toContain('Status: Completed (Done)');
  });

  it('generates a valid RFC 5545 iCalendar content format', () => {
    const ics = generateIcsContent([sampleTask]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:[Computer Programming (0401201)] Quiz 2: Arrays & Functions');
    expect(ics).toContain('CATEGORIES:QUIZ');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('reflects completed status with checkmark and Done suffix in RFC 5545 iCalendar content', () => {
    const completedTask: DeadlineTask = { ...sampleTask, status: 'completed' };
    const ics = generateIcsContent([completedTask]);
    expect(ics).toContain('SUMMARY:✓ [Computer Programming (0401201)] Quiz 2: Arrays & Functions (Done)');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).not.toContain('STATUS:COMPLETED');
    expect(ics).toContain('Status: Completed (Done)');
  });

  it('formats task time for specific time tasks', () => {
    const timeStr = formatTaskTime(sampleTask);
    expect(timeStr).toMatch(/\d{1,2}:\d{2}\s*(?:AM|PM)/i);
  });

  it('resolves class meeting time for tasks without specific time using schedule.pdf', () => {
    const calcTask: DeadlineTask = {
      ...sampleTask,
      courseName: 'Calculus I for Engineering',
      courseCode: '1440 133 02',
      title: 'Midterm Exam',
      hasSpecificTime: false
    };
    const timeStr = formatTaskTime(calcTask);
    expect(timeStr).toBe('12:30 PM - 01:45 PM (Class time)');
  });

  describe('Chronological Time Sorting for Day Items', () => {
    it('sorts tasks on the same day in order of their time (earliest first)', () => {
      const taskMorning: DeadlineTask = {
        ...sampleTask,
        id: 't-morning',
        title: 'Morning Quiz',
        dueDate: '2026-10-15T09:00:00',
        hasSpecificTime: true
      };
      const taskNoon: DeadlineTask = {
        ...sampleTask,
        id: 't-noon',
        title: 'Noon Lab',
        dueDate: '2026-10-15T12:00:00',
        hasSpecificTime: true
      };
      const taskAfternoon: DeadlineTask = {
        ...sampleTask,
        id: 't-afternoon',
        title: 'Afternoon Submission',
        dueDate: '2026-10-15T15:30:00',
        hasSpecificTime: true
      };

      const dayItems = [taskAfternoon, taskMorning, taskNoon];
      dayItems.sort(compareTasksByTime);

      expect(dayItems.map(t => t.id)).toEqual(['t-morning', 't-noon', 't-afternoon']);
    });

    it('handles tasks without specific time by placing them at resolved class time or end-of-day', () => {
      // Calculus 1 class time is 12:30 PM
      const taskCalcClassTime: DeadlineTask = {
        ...sampleTask,
        id: 't-calc',
        courseName: 'Calculus I for Engineering',
        courseCode: '1440 133 02',
        title: 'Class Midterm',
        dueDate: '2026-10-15T00:00:00',
        hasSpecificTime: false
      };
      const taskEarly: DeadlineTask = {
        ...sampleTask,
        id: 't-early',
        courseName: 'Physics 1',
        title: 'Early Quiz',
        dueDate: '2026-10-15T09:00:00',
        hasSpecificTime: true
      };
      const taskLate: DeadlineTask = {
        ...sampleTask,
        id: 't-late',
        courseName: 'English',
        title: 'Evening Paper',
        dueDate: '2026-10-15T16:00:00',
        hasSpecificTime: true
      };
      const taskNoSchedule: DeadlineTask = {
        ...sampleTask,
        id: 't-unscheduled',
        courseName: 'General Unknown Course',
        courseCode: 'GEN999',
        title: 'Midnight HW',
        dueDate: '2026-10-15T00:00:00',
        hasSpecificTime: false
      };

      const items = [taskNoSchedule, taskLate, taskCalcClassTime, taskEarly];
      items.sort(compareTasksByTime);

      // Early (9:00 AM) -> Calc (12:30 PM class time) -> Late (4:00 PM) -> Unscheduled (defaults to 23:59)
      expect(items.map(t => t.id)).toEqual(['t-early', 't-calc', 't-late', 't-unscheduled']);
    });

    it('immediately re-sorts tasks when task time is edited', () => {
      const taskA: DeadlineTask = {
        ...sampleTask,
        id: 'task-a',
        title: 'Task A',
        dueDate: '2026-10-15T10:00:00',
        hasSpecificTime: true
      };
      const taskB: DeadlineTask = {
        ...sampleTask,
        id: 'task-b',
        title: 'Task B',
        dueDate: '2026-10-15T14:00:00',
        hasSpecificTime: true
      };

      let list = [taskA, taskB];
      list.sort(compareTasksByTime);
      expect(list[0].id).toBe('task-a');
      expect(list[1].id).toBe('task-b');

      // Edit Task B to 08:00 AM (earlier than Task A)
      const editedB: DeadlineTask = {
        ...taskB,
        dueDate: '2026-10-15T08:00:00',
        hasSpecificTime: true
      };
      list = list.map(t => (t.id === 'task-b' ? editedB : t));
      list.sort(compareTasksByTime);

      // Task B must immediately move to first position
      expect(list[0].id).toBe('task-b');
      expect(list[1].id).toBe('task-a');
    });

    it('breaks ties deterministically by title when timestamps match', () => {
      const taskBeta: DeadlineTask = {
        ...sampleTask,
        id: 't-beta',
        title: 'Beta Assessment',
        dueDate: '2026-10-15T11:00:00',
        hasSpecificTime: true
      };
      const taskAlpha: DeadlineTask = {
        ...sampleTask,
        id: 't-alpha',
        title: 'Alpha Assessment',
        dueDate: '2026-10-15T11:00:00',
        hasSpecificTime: true
      };

      const list = [taskBeta, taskAlpha];
      list.sort(compareTasksByTime);

      expect(list.map(t => t.id)).toEqual(['t-alpha', 't-beta']);
    });
  });

  describe('Monday First Day of Week Calendar Grid', () => {
    function getMondayFirstLeadingDays(year: number, month: number): number {
      const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon ...
      return (firstDayIndex + 6) % 7;
    }

    it('aligns Monday as the first day with 0 leading days when month starts on Monday', () => {
      // February 2021 started on Monday (Feb 1, 2021 was Mon)
      expect(getMondayFirstLeadingDays(2021, 1)).toBe(0);
    });

    it('has 6 leading days when month starts on Sunday', () => {
      // May 2022 started on Sunday (May 1, 2022 was Sun)
      expect(getMondayFirstLeadingDays(2022, 4)).toBe(6);
    });

    it('has 3 leading days (Mon, Tue, Wed) when month starts on Thursday', () => {
      // October 2026 starts on Thursday (Oct 1, 2026 is Thu)
      expect(getMondayFirstLeadingDays(2026, 9)).toBe(3);
    });

    it('has 5 leading days when month starts on Saturday', () => {
      // August 2026 starts on Saturday (Aug 1, 2026 is Sat)
      expect(getMondayFirstLeadingDays(2026, 7)).toBe(5);
    });

    it('ensures remaining trailing cells complete a full 7-day row', () => {
      // October 2026: 31 days + 3 leading days = 34 cells.
      // Trailing needed: (7 - (34 % 7)) % 7 = (7 - 6) % 7 = 1 trailing day.
      const leading = getMondayFirstLeadingDays(2026, 9);
      const daysInMonth = 31;
      const totalCells = leading + daysInMonth;
      const remainingCells = (7 - (totalCells % 7)) % 7;
      expect((totalCells + remainingCells) % 7).toBe(0);
    });
  });

  describe('formatCountdown with Completed vs Overdue Status', () => {
    it('returns "Overdue" when task is past due date and status is pending', () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatCountdown(pastDate, true, 'pending');
      expect(result.urgency).toBe('overdue');
      expect(result.label).toContain('Overdue');
    });

    it('returns "Marked as Done" with completed urgency when task is past due date but marked as completed', () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatCountdown(pastDate, true, 'completed');
      expect(result.urgency).toBe('completed');
      expect(result.label).toBe('Marked as Done');
      expect(result.label).not.toContain('Overdue');
    });

    it('returns "Marked as Done" for future tasks that are marked as completed', () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const result = formatCountdown(futureDate, true, 'completed');
      expect(result.urgency).toBe('completed');
      expect(result.label).toBe('Marked as Done');
    });
  });
});

